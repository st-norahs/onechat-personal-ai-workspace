import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const gatewayKey = process.env.AI_GATEWAY_API_KEY;
const providers = { openai:'openai/', claude:'anthropic/', gemini:'google/', grok:'xai/', deepseek:'deepseek/', perplexity:'perplexity/' };
let modelCache = { expires: 0, models: [] };
const chatRequests = [];

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function getModels() {
  if (modelCache.expires > Date.now()) return modelCache.models;
  const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
    headers: { Authorization: `Bearer ${gatewayKey}` }, signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Object.assign(new Error('Could not load the model catalog.'), { status: response.status === 401 ? 503 : 502 });
  const result = await response.json();
  modelCache = { expires: Date.now() + 5 * 60 * 1000, models: (result.data || []).map(item => ({ id: item.id, name: item.name || item.id })) };
  return modelCache.models;
}

async function api(req, res, pathname) {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && pathname === '/api/status') return send(200, { configured: Boolean(gatewayKey) });
  if (!gatewayKey) return send(503, { error: 'Live models are not configured yet. Add AI_GATEWAY_API_KEY to the server environment and restart OneChat.' });
  if (req.method === 'GET' && pathname === '/api/models') {
    try {
      const catalog = await getModels();
      return send(200, Object.fromEntries(Object.entries(providers).map(([provider, prefix]) => [provider, catalog.filter(item => item.id.startsWith(prefix))])));
    } catch (error) { return send(error.status || 502, { error: error.message }); }
  }
  if (req.method !== 'POST' || pathname !== '/api/chat') return send(404, { error: 'Not found.' });
  const origin = req.headers.origin;
  const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  if (!allowedOrigins.has(origin) || !allowedOrigins.has(`http://${req.headers.host}`)) return send(403, { error: 'Requests must come from this OneChat origin.' });
  const now = Date.now();
  while (chatRequests.length && chatRequests[0] < now - 10 * 60 * 1000) chatRequests.shift();
  if (chatRequests.length >= 30) return send(429, { error: 'Local chat limit reached. Try again in a few minutes.' });
  try {
    const body = await readJson(req);
    const providerPrefix = providers[body.provider];
    if (!providerPrefix || typeof body.model !== 'string' || !body.model.startsWith(providerPrefix)) return send(400, { error: 'Choose a model offered for the selected provider.' });
    if (!(await getModels()).some(item => item.id === body.model)) return send(400, { error: 'That model is not in the current model catalog.' });
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 40) return send(400, { error: 'Include between 1 and 40 chat messages.' });
    const messages = body.messages.map(message => {
      if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 16000) throw Object.assign(new Error('A chat message is invalid or too long.'), { status: 400 });
      return { role: message.role, content: message.content };
    });
    chatRequests.push(now);
    const upstream = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${gatewayKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: body.model, messages, stream: true }), signal: AbortSignal.timeout(90000),
    });
    if (!upstream.ok) {
      return send(upstream.status === 429 ? 429 : 502, { error: upstream.status === 401 ? 'The Gateway key was rejected.' : `The model request failed (${upstream.status}).` });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff', Connection: 'keep-alive' });
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (error) {
    if (res.headersSent) return res.end();
    return send(error.status || 502, { error: error.status ? error.message : 'The model service could not be reached.' });
  }
}

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    const safePath = normalize(pathname).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '');
    let path = join(root, safePath || 'index.html');
    try { if ((await stat(path)).isDirectory()) path = join(path, 'index.html'); } catch {}
    let body;
    try { body = await readFile(path); } catch { path = join(root, 'index.html'); body = await readFile(path); }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    res.end(body);
  } catch { res.writeHead(400); res.end('Bad request'); }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => console.log(`OneChat is available at http://localhost:${port}`));

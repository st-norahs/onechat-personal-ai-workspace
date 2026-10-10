import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleDevApi, serveProjectPreview, staticFiles } from './dev-workspace.mjs';
import { ensureAvatarLibrary, handleAvatarApi, serveAvatarAsset } from './avatar-library.mjs';
import { closeMcpConnections, handleMcpApi } from './mcp-client.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const gatewayKey = process.env.AI_GATEWAY_API_KEY;
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
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
  const checkOrigin = request => {
    const origin=request.headers.origin;const allowed=new Set([`http://localhost:${port}`,`http://127.0.0.1:${port}`]);
    if(!allowed.has(origin)||!allowed.has(`http://${request.headers.host}`))throw Object.assign(new Error('Requests must come from this Salt origin.'),{status:403});
  };
  if(pathname.startsWith('/api/dev/')) {
    try { const result=await handleDevApi(req,res,pathname,readJson,send,checkOrigin);if(result!==false)return result; }
    catch(error){return send(error.status||500,{error:error.status?error.message:'The local development request failed.'});}
  }
  if(pathname.startsWith('/api/avatar/')) {
    try { const result=await handleAvatarApi(req,pathname,readJson,send,checkOrigin);if(result!==false)return result; }
    catch(error){return send(error.status||500,{error:error.status?error.message:'The local avatar library could not be updated.'});}
  }
  if(pathname.startsWith('/api/mcp/')) {
    try { const result=await handleMcpApi(req,pathname,readJson,send,checkOrigin);if(result!==false)return result; }
    catch(error){return send(error.status||502,{error:error.status?error.message:'The MCP request failed. Check the server connection and try again.'});}
  }
  if (req.method === 'GET' && pathname === '/api/status') return send(200, { configured: Boolean(gatewayKey), googleClientId });
  if (!gatewayKey) return send(503, { error: 'Live models are not configured yet. Add AI_GATEWAY_API_KEY to the server environment and restart Salt.' });
  if (req.method === 'GET' && pathname === '/api/models') {
    try {
      const catalog = await getModels();
      return send(200, Object.fromEntries(Object.entries(providers).map(([provider, prefix]) => [provider, catalog.filter(item => item.id.startsWith(prefix))])));
    } catch (error) { return send(error.status || 502, { error: error.message }); }
  }
  if (req.method !== 'POST' || pathname !== '/api/chat') return send(404, { error: 'Not found.' });
  const origin = req.headers.origin;
  const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  if (!allowedOrigins.has(origin) || !allowedOrigins.has(`http://${req.headers.host}`)) return send(403, { error: 'Requests must come from this Salt origin.' });
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
    if(pathname.startsWith('/workspace/')) return await serveProjectPreview(res,pathname,error=>{res.writeHead(error.status||404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(error.status?error.message:'Preview file not found.');});
    if(pathname.startsWith('/avatar/')) return await serveAvatarAsset(res,pathname);
    const safePath = normalize(pathname).replaceAll('\\','/').replace(/^(\.\.\/)+/, '').replace(/^\/+/, '') || 'index.html';
    if(!staticFiles.has(safePath)&&!/^build\/chunks\/[A-Za-z0-9_-]+\.js$/.test(safePath)) { res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found.'); }
    const path = join(root, safePath);
    let body;try { body=await readFile(path); } catch { res.writeHead(503);return res.end('Build the app with npm run build first.'); }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com; style-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com; worker-src 'self' blob:; frame-src 'self' https://accounts.google.com https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    res.end(body);
  } catch { res.writeHead(400); res.end('Bad request'); }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => {
  ensureAvatarLibrary().then(() => console.log(`Salt is available at http://localhost:${port}`)).catch(() => { console.error('Salt could not initialize its local avatar folders.'); process.exitCode=1; });
});
server.on('close',()=>{void closeMcpConnections()});

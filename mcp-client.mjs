import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const clients = new Map();
const maxConnections = 12;
const maxNameLength = 80;
const maxResultChars = 48_000;

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out.`), { status: 504 })), ms); })]).finally(() => clearTimeout(timer));
}
function isLoopback(host) { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase()); }
function isPrivateAddress(address) {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (ipVersion === 6) {
    const value = address.toLowerCase();
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('::ffff:');
  }
  return true;
}
async function validatedHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('Enter a valid MCP server URL.'); }
  if (url.username || url.password || url.search || url.hash) fail('Put credentials in the credential field; server URLs cannot contain credentials, query parameters, or fragments.');
  const local = isLoopback(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) fail('Remote MCP servers must use HTTPS. Plain HTTP is allowed only for localhost.');
  if (!local) {
    const literal = isIP(url.hostname);
    const addresses = literal ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
    if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) fail('The MCP server must resolve to a public address. Private-network and metadata-service targets are blocked.');
  }
  return url;
}
function validText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} must be 1–${max} characters.`);
  return value.trim();
}
function validateEnv(value) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail('Environment variables must be a JSON object.');
  const env = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || typeof item !== 'string' || item.length > 4096) fail('Local server environment entries must use valid names and string values under 4 KB.');
    env[key] = item;
  }
  return env;
}
function compactList(items, kind) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 100).map(item => kind === 'tools'
    ? { name: String(item.name || '').slice(0, 128), description: String(item.description || '').slice(0, 500), inputSchema: item.inputSchema || { type: 'object', properties: {} } }
    : { name: String(item.name || '').slice(0, 200), uri: String(item.uri || '').slice(0, 2000), description: String(item.description || '').slice(0, 500), mimeType: String(item.mimeType || '').slice(0, 128) });
}
async function capabilities(client) {
  const [toolResponse, resourceResponse, promptResponse] = await Promise.all([
    client.listTools().catch(() => ({ tools: [] })),
    client.listResources().catch(() => ({ resources: [] })),
    client.listPrompts().catch(() => ({ prompts: [] })),
  ]);
  return {
    tools: compactList(toolResponse.tools, 'tools'),
    resources: compactList(resourceResponse.resources, 'resources'),
    prompts: Array.isArray(promptResponse.prompts) ? promptResponse.prompts.slice(0, 100).map(item => ({ name: String(item.name || '').slice(0, 128), description: String(item.description || '').slice(0, 500) })) : [],
  };
}
function publicConnection(connection) {
  return { id: connection.id, name: connection.name, transport: connection.transportName, endpoint: connection.publicEndpoint, serverInfo: connection.serverInfo, ...connection.capabilities };
}
function trimResult(value) {
  const json = JSON.stringify(value, (_key, item) => typeof item === 'string' && item.length > maxResultChars ? `${item.slice(0, maxResultChars)}… [truncated]` : item);
  if (json.length <= maxResultChars) return JSON.parse(json);
  return { truncated: true, preview: json.slice(0, maxResultChars) };
}
function requireConnection(id) {
  const connection = clients.get(id);
  if (!connection) fail('This MCP connection is no longer active. Reconnect it and try again.', 404);
  return connection;
}

export async function handleMcpApi(req, pathname, readJson, send, checkOrigin) {
  if (req.method === 'GET' && pathname === '/api/mcp/status') {
    return send(200, { servers: [...clients.values()].map(publicConnection) });
  }
  if (req.method === 'POST' && pathname === '/api/mcp/connect') {
    checkOrigin(req);
    const body = await readJson(req, 32 * 1024);
    const name = validText(body.name, maxNameLength, 'Server name');
    if (clients.size >= maxConnections) fail(`Salt supports up to ${maxConnections} active MCP connections. Disconnect one first.`, 429);
    let client, transport, transportName, endpoint, publicEndpoint;
    if (body.transport === 'http') {
      const url = await validatedHttpUrl(validText(body.url, 2048, 'Server URL'));
      const token = typeof body.bearerToken === 'string' ? body.bearerToken.trim() : '';
      if (token.length > 4096) fail('Bearer token is too long.');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      transport = new StreamableHTTPClientTransport(url, { requestInit: { headers, redirect: 'error' } });
      transportName = 'Streamable HTTP';
      endpoint = url.origin + url.pathname;
      publicEndpoint = url.origin;
    } else if (body.transport === 'stdio') {
      if (body.trustLocalProcess !== true) fail('Confirm that you trust and want to run this local MCP server command.');
      const command = validText(body.command, 256, 'Command');
      if (!Array.isArray(body.args) || body.args.length > 32 || body.args.some(arg => typeof arg !== 'string' || arg.length > 2048)) fail('Use a list of at most 32 string arguments.');
      const env = validateEnv(body.env);
      transport = new StdioClientTransport({ command, args: body.args, env, stderr: 'pipe' });
      transportName = 'Local process';
      endpoint = 'Local MCP process';
      publicEndpoint = endpoint;
    } else fail('Choose Streamable HTTP or a local stdio process.');

    client = new Client({ name: 'salt-personal-workspace', version: '0.3.0' });
    try {
      await withTimeout(client.connect(transport), 25_000, 'MCP connection');
      const connection = { id: randomUUID(), name, transportName, endpoint, publicEndpoint, client, serverInfo: client.getServerVersion() || null, capabilities: await capabilities(client) };
      clients.set(connection.id, connection);
      return send(201, publicConnection(connection));
    } catch (error) {
      await client?.close().catch(() => {});
      throw Object.assign(new Error(error.status ? error.message : 'Could not connect to that MCP server. Check its URL, transport, authentication, and availability.'), { status: error.status || 502 });
    }
  }
  const match = pathname.match(/^\/api\/mcp\/server\/([0-9a-f-]{36})(?:\/(tool|resource|prompt))?$/i);
  if (match && req.method === 'DELETE' && !match[2]) {
    checkOrigin(req);
    const connection = requireConnection(match[1]);
    clients.delete(connection.id);
    await connection.client.close().catch(() => {});
    return send(200, { disconnected: true });
  }
  if (match && req.method === 'POST' && match[2]) {
    checkOrigin(req);
    const connection = requireConnection(match[1]);
    const body = await readJson(req, 32 * 1024);
    if (match[2] === 'tool') {
      const name = validText(body.name, 128, 'Tool name');
      if (!connection.capabilities.tools.some(tool => tool.name === name)) fail('That tool is not in the connected server’s advertised tool list.', 404);
      if (!body.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments)) fail('Tool arguments must be a JSON object.');
      const response = await withTimeout(connection.client.callTool({ name, arguments: body.arguments }), 60_000, 'MCP tool call');
      return send(200, trimResult(response));
    }
    if (match[2] === 'resource') {
      const uri = validText(body.uri, 2000, 'Resource URI');
      if (!connection.capabilities.resources.some(resource => resource.uri === uri)) fail('Choose a resource advertised by this MCP server.', 404);
      const response = await withTimeout(connection.client.readResource({ uri }), 30_000, 'MCP resource read');
      return send(200, trimResult(response));
    }
    if (match[2] === 'prompt') {
      const name = validText(body.name, 128, 'Prompt name');
      if (!connection.capabilities.prompts.some(prompt => prompt.name === name)) fail('Choose a prompt advertised by this MCP server.', 404);
      if (!body.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments)) fail('Prompt arguments must be a JSON object.');
      const response = await withTimeout(connection.client.getPrompt({ name, arguments: body.arguments }), 30_000, 'MCP prompt');
      return send(200, trimResult(response));
    }
  }
  if (pathname.startsWith('/api/mcp/')) return send(404, { error: 'MCP endpoint not found.' });
  return false;
}

export async function closeMcpConnections() {
  const active = [...clients.values()];
  clients.clear();
  await Promise.all(active.map(connection => connection.client.close().catch(() => {})));
}

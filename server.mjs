import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 4173);
const hopByHopHeaders = new Set(['connection', 'host', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxy(request, response, target) {
  try {
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value == null || hopByHopHeaders.has(name.toLowerCase()) || name.toLowerCase() === 'content-length') continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });
    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      if (hopByHopHeaders.has(name.toLowerCase()) || name.toLowerCase() === 'content-encoding' || name.toLowerCase() === 'content-length') continue;
      responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    if (response.headersSent) return response.end();
    response.writeHead(error?.name === 'TimeoutError' ? 504 : 502, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: error?.name === 'TimeoutError' ? 'Upstream request timed out' : 'Upstream service is unavailable' }));
  }
}

function serveFile(response, file) {
  response.writeHead(200, {
    'content-type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(response);
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/api/laliga' || pathname.startsWith('/api/laliga/')) {
    const endpoint = pathname.slice('/api/laliga'.length);
    return proxy(request, response, `https://fantasy-api.llt-services.com/api${endpoint}${requestUrl.search}`);
  }
  if (pathname === '/auth/provider/token') {
    return proxy(request, response, `https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token${requestUrl.search}`);
  }

  if (!existsSync(dist)) {
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    return response.end('Build the frontend first with npm run build.');
  }

  let file;
  try {
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
    file = path.resolve(dist, relative || 'index.html');
    if (!file.startsWith(`${dist}${path.sep}`) && file !== path.join(dist, 'index.html')) file = path.join(dist, 'index.html');
  } catch {
    file = path.join(dist, 'index.html');
  }
  if (existsSync(file) && statSync(file).isFile()) return serveFile(response, file);
  return serveFile(response, path.join(dist, 'index.html'));
});

server.listen(port, '0.0.0.0', () => console.log(`Fantasy web running on http://0.0.0.0:${port}`));

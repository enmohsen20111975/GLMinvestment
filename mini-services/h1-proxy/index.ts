/**
 * HTTP/1.1-only reverse proxy
 * Accepts any connection and forwards via HTTP/1.1 to Next.js on port 3001
 * This prevents Caddy's HTTP/2 from crashing Next.js dev server.
 */
import http from 'http';
import { execSync } from 'child_process';

const NEXT_PORT = 3001;
const PROXY_PORT = 3000;

// Simple round-robin connection pooling
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  keepAliveMsecs: 30000,
});

const server = http.createServer((clientReq, clientRes) => {
  const opts = {
    hostname: '127.0.0.1',
    port: NEXT_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers },
    agent: agent,
  };
  
  // Fix host header
  opts.headers.host = `127.0.0.1:${NEXT_PORT}`;
  opts.headers['x-forwarded-host'] = clientReq.headers.host || 'localhost';
  opts.headers['x-real-ip'] = clientReq.socket.remoteAddress || '127.0.0.1';
  
  const proxyReq = http.request(opts, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode!, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });
  
  proxyReq.on('error', (err) => {
    console.error(`[proxy] Error: ${err.message}`);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    clientRes.end('Bad Gateway: Next.js is not available');
  });
  
  clientReq.pipe(proxyReq);
  
  clientReq.on('error', (err) => {
    console.error(`[proxy] Client error: ${err.message}`);
    proxyReq.destroy();
  });
});

server.on('error', (err) => {
  console.error(`[proxy] Server error: ${err.message}`);
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[h1-proxy] HTTP/1.1 proxy listening on :${PROXY_PORT} → :${NEXT_PORT}`);
});

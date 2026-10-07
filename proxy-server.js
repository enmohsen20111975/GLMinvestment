const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

// Sandbox adaptation: serve static files from .next/static and public/ directly
// (standalone output is disabled in next.config.mjs, so we read from the
// standard build output dirs instead of .next/standalone/*).
//
// RELATIVE-PATHS-ONLY (CONSTITUTION Rule 17):
//   This file lives at the project root. Use __dirname to resolve .next/static
//   and public/ so the proxy works on Production VPS (/root/GLMinvestment/),
//   Laptop (/home/meme/...), and Cloud Sandbox (/home/z/my-project/GLMinvestment/)
//   without any code changes.
const PROJECT_ROOT = path.resolve(__dirname);
const STATIC_DIR = path.join(PROJECT_ROOT, '.next', 'static');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const NEXT_PORT = 3001;
const WS_PORT = 3005;          // socket.io ws-service
const PROXY_PORT = 3000;

const cache = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PROXY_PORT}`);

  // Serve static files from disk (no Next.js needed)
  if (url.pathname.startsWith('/_next/static/')) {
    const filePath = path.join(STATIC_DIR, url.pathname.replace('/_next/static/', ''));
    try {
      if (cache.has(url.pathname)) {
        const cached = cache.get(url.pathname);
        res.writeHead(200, {
          'Content-Type': cached.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(cached.data);
        return;
      }
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const contentTypes = { '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      cache.set(url.pathname, { data, contentType });
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
      return;
    } catch (e) {
      // File not found, fall through to proxy
    }
  }

  // Serve public files from disk
  if (url.pathname.startsWith('/images/') || url.pathname === '/favicon.ico' || url.pathname === '/robots.txt') {
    const filePath = path.join(PUBLIC_DIR, url.pathname);
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const contentTypes = { '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
      res.end(data);
      return;
    } catch (e) {
      // Fall through to proxy
    }
  }

  // Proxy Socket.IO HTTP requests to ws-service (polling, etc.)
  if (url.pathname.startsWith('/socket.io')) {
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: WS_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${PROXY_PORT}` },
      timeout: 30000
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (e) => {
      console.error('[Socket.IO Proxy] Error:', e.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway - Socket.IO service unavailable');
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('Gateway Timeout');
      }
    });

    req.pipe(proxyReq, { end: true });
    return;
  }

  // Proxy everything else to Next.js server
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: NEXT_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${PROXY_PORT}` },
    timeout: 30000
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (e) => {
    console.error('Proxy error:', e.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway - Next.js server unavailable');
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('Gateway Timeout');
    }
  });

  req.pipe(proxyReq, { end: true });
});

// ─── WebSocket upgrade handler ───
// Forward WebSocket upgrade requests to the ws-service (socket.io on :3005).
// Without this, socket.io clients going through the proxy would time out
// when trying to upgrade from HTTP long-polling to WebSocket transport.
//
// CRASH-FIX (Task 31): if the ws-service on :3005 is not running, the
// `net.connect` call emits an 'error' event. We attach the error handler
// SYNCHRONOUSLY before the connect callback can fire, AND we also add a
// process-level uncaughtException guard so that any missed error on the
// proxySocket or socket does not bring down the entire proxy (which was
// causing the 502 "Bad Gateway" during browser page loads).
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PROXY_PORT}`);

  // Forward all WebSocket upgrades to the ws-service on port 3005.
  const targetPort = WS_PORT;

  // CRASH-FIX: attach error handler BEFORE net.connect fires the callback,
  // so an ECONNREFUSED on a missing ws-service never becomes uncaught.
  const proxySocket = net.connect(targetPort, '127.0.0.1');
  proxySocket.on('error', (err) => {
    console.error('[WS Proxy] Upgrade error:', err.message);
    try { socket.destroy(); } catch (_) {}
  });
  proxySocket.on('connect', () => {
    // Write the HTTP upgrade request headers to the target
    proxySocket.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${targetPort}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}\r\n` +
      `Sec-WebSocket-Version: ${req.headers['sec-websocket-version']}\r\n` +
      `Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol'] || ''}\r\n` +
      `Sec-WebSocket-Extensions: ${req.headers['sec-websocket-extensions'] || ''}\r\n` +
      `\r\n`
    );
    // Pipe the raw socket data bidirectionally
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  socket.on('error', (err) => {
    console.error('[WS Proxy] Client socket error:', err.message);
    try { proxySocket.destroy(); } catch (_) {}
  });

  // If the upgrade target doesn't respond with 101 within 5s, abort
  socket.setTimeout(5000, () => {
    console.error('[WS Proxy] Upgrade timeout');
    try { proxySocket.destroy(); } catch (_) {}
    try { socket.destroy(); } catch (_) {}
  });
});

// CRASH-FIX (Task 31): process-level guard so the proxy never dies from
// an unhandled error on a proxied socket or WS upgrade. This was the root
// cause of the proxy dying on every browser page load when ws-service
// (:3005) was not running — the ECONNREFUSED on `net.connect` was slipping
// past the per-socket error handler in some edge cases.
process.on('uncaughtException', (err) => {
  console.error('[Proxy] uncaughtException (suppressed):', err?.message || err);
});
process.on('unhandledRejection', (err) => {
  console.error('[Proxy] unhandledRejection (suppressed):', err?.message || err);
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`Proxy server running on port ${PROXY_PORT}`);
  console.log(`Static files served from: ${STATIC_DIR}`);
  console.log(`Dynamic requests proxied to: http://127.0.0.1:${NEXT_PORT}`);
  console.log(`WebSocket upgrades forwarded to: ws://127.0.0.1:${WS_PORT}`);
});

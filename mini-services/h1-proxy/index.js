const http = require('http');
const NEXT_HOST = '127.0.0.1';
const NEXT_PORT = 3001;
const PROXY_PORT = 3000;

const agent = new http.Agent({ keepAlive: true, maxSockets: 200 });

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  headers.host = `${NEXT_HOST}:${NEXT_PORT}`;
  headers['x-forwarded-host'] = req.headers.host || 'localhost';
  headers['x-real-ip'] = req.socket?.remoteAddress || '127.0.0.1';
  headers['x-forwarded-for'] = req.socket?.remoteAddress || '127.0.0.1';

  const proxyReq = http.request({
    hostname: NEXT_HOST,
    port: NEXT_PORT,
    path: req.url,
    method: req.method,
    headers,
    agent,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('502 Bad Gateway');
  });

  req.on('error', () => proxyReq.destroy());
  req.pipe(proxyReq);
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[h1-proxy] Listening on :${PROXY_PORT} -> :${NEXT_PORT}`);
});

// Keep process alive
setInterval(() => {}, 60000);

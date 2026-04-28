/**
 * EGX Static Server — Serves pre-built HTML + cached API JSON files.
 * No sql.js, no WASM, no compilation — pure static file serving.
 * This survives the sandbox process limits.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = path.join(__dirname, '.next');
const API_CACHE = path.join(ROOT, 'server', 'api-cache');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

// Map API routes to cached JSON files
const API_MAP = {
  '/api/market/overview': 'market-overview.json',
  '/api/market/currency': 'currency.json',
  '/api/market/gold': 'gold.json',
  '/api/market/recommendations/ai-insights': 'ai-insights.json',
  '/api/stocks': 'stocks.json',
};

const server = http.createServer((req, res) => {
  const url = req.url ? req.url.split('?')[0] : '/';

  try {
    // API Routes — serve from cache
    if (url.startsWith('/api/')) {
      // Find matching cache file
      let cacheFile = null;
      for (const [apiPath, fileName] of Object.entries(API_MAP)) {
        if (url === apiPath || url.startsWith(apiPath + '/')) {
          cacheFile = path.join(API_CACHE, fileName);
          break;
        }
      }

      if (cacheFile && fs.existsSync(cacheFile)) {
        const data = fs.readFileSync(cacheFile);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        });
        res.end(data);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Endpoint not cached', url }));
      }
      return;
    }

    // Static file serving
    let filePath;
    if (url === '/' || url === '') {
      filePath = path.join(ROOT, 'server', 'app', 'index.html');
    } else if (url.startsWith('/_next/') || url.startsWith('/favicon') || url.startsWith('/logo')) {
      filePath = path.join(ROOT, url);
    } else {
      // SPA fallback
      filePath = path.join(ROOT, 'server', 'app', 'index.html');
    }

    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'application/octet-stream';

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } else {
      const indexPath = path.join(ROOT, 'server', 'app', 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(indexPath));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.writeHead(500);
    res.end('Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`[STATIC] Server on http://localhost:${PORT}`);
  console.log(`[STATIC] API cache: ${API_CACHE}`);
  console.log(`[STATIC] Cached endpoints: ${Object.keys(API_MAP).join(', ')}`);
});

const http = require('http');
const fs = require('fs');
const path = require('path');

const ZIP_PATH = '/home/z/my-project/public/egx-platform-deploy.zip';
const PORT = 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/egx-platform-deploy.zip' || req.url === '/') {
    if (fs.existsSync(ZIP_PATH)) {
      const stat = fs.statSync(ZIP_PATH);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="egx-platform-deploy.zip"',
        'Content-Length': stat.size,
      });
      fs.createReadStream(ZIP_PATH).pipe(res);
      console.log(`[${new Date().toISOString()}] Download served: ${stat.size} bytes`);
    } else {
      res.writeHead(404);
      res.end('File not found');
    }
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>EGX Platform - Download</title></head>
<body style="font-family:system-ui;direction:rtl;text-align:center;padding:60px">
<h1>📦 EGX Platform Deployment Package</h1>
<p>الحجم: ${(fs.existsSync(ZIP_PATH) ? (fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1) : '?')} MB</p>
<br>
<a href="/egx-platform-deploy.zip" download style="display:inline-block;padding:16px 32px;background:#16a34a;color:#fff;text-decoration:none;border-radius:12px;font-size:20px;font-weight:bold">⬇️ تحميل ملف التثبيت</a>
</body></html>`);
  }
});

server.listen(PORT, () => {
  console.log(`File server running on http://localhost:${PORT}`);
  console.log(`Serving: ${ZIP_PATH}`);
  if (fs.existsSync(ZIP_PATH)) {
    console.log(`File size: ${(fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1)} MB`);
  }
});

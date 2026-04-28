/**
 * EGX Production Server — Node.js with native http module.
 * Uses sql.js for portable SQLite access (no native addons).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PORT = 3000;
const STATIC_DIR = path.join(__dirname, ".next", "static");
const PUBLIC_DIR = path.join(__dirname, "public");
const HTML_PATH = path.join(__dirname, ".next", "server", "app", "index.html");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

let db = null;
let dbReady = false;
let dbLoading = false;

async function initDb() {
  if (dbReady || dbLoading) return dbReady;
  dbLoading = true;
  try {
    if (global.gc) global.gc();

    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({
      locateFile: (f) => path.join(__dirname, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    });
    const dbPath = path.join(__dirname, "db", "egx_investment.db");
    if (fs.existsSync(dbPath)) {
      // Buffer IS a Uint8Array — pass directly to avoid memory doubling
      const buf = fs.readFileSync(dbPath);
      db = new SQL.Database(buf);
      console.log("[DB] Loaded:", (buf.length / 1024 / 1024).toFixed(1), "MB");
    } else {
      db = new SQL.Database();
    }
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    dbReady = true;
    if (global.gc) global.gc(); // free temp memory
    console.log("[DB] Ready");
  } catch (e) {
    console.error("[DB] Error:", e.message);
    dbReady = false;
  }
  dbLoading = false;
  return dbReady;
}

function dbQuery(sql, params) {
  if (!db) return [];
  try {
    let result = db.exec(sql, params || []);
    if (result.length === 0) return [];
    const cols = result[0].columns;
    return result[0].values.map(v => {
    const row = {};
      cols.forEach((c, i) => {
        let val = v[i];
        if (val instanceof Uint8Array) {
          try { val = new TextDecoder().decode(val); } catch { val = null; }
        }
        row[c] = val;
      });
      return row;
    });
  } catch (e) {
    return [];
  }
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=60",
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendFile(res, filePath) {
  try {
    const ext = path.extname(filePath);
    const mime = MIME[ext] || "application/octet-stream";
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function send404(res) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

let htmlCache = null;
function getHtml() {
  if (!htmlCache) {
    try {
      htmlCache = fs.readFileSync(HTML_PATH, "utf-8");
    } catch {
      htmlCache = "<html><body><h1>EGX Platform</h1></body></html>";
    }
  }
  return htmlCache;
}

function handleApi(req, res, pathname) {
  // Auth routes — no DB needed
  if (pathname === "/api/auth/session" || pathname === "/api/auth/csrf" || pathname === "/api/auth/providers") {
    sendJson(res, {});
    return;
  }
  if (pathname === "/api/auth/_log") {
    sendJson(res, { ok: true });
    return;
  }

  // Non-DB routes
  if (pathname === "/api/subscription/plans") {
    sendJson(res, { plans: [{id:"free",name:"Free",price:0},{id:"basic",name:"Basic",price:99},{id:"pro",name:"Pro",price:249},{id:"premium",name:"Premium",price:499}] });
    return;
  }

  // DB routes — use setImmediate to avoid blocking event loop
  setImmediate(() => {
    if (!dbReady) { sendJson(res, { error: "DB not ready" }, 503); return; }

    try {
      if (pathname === "/api/market/overview") {
        const indices = dbQuery("SELECT * FROM market_indices ORDER BY id");
        const topStocks = dbQuery("SELECT ticker, name_ar, current_price, change_percent FROM stocks WHERE is_active = 1 ORDER BY volume DESC LIMIT 10");
        sendJson(res, { indices, topStocks, marketStatus: "open" });
        return;
      }
      if (pathname === "/api/market/currency") {
        sendJson(res, { rates: dbQuery("SELECT * FROM currency_rates ORDER BY id") });
        return;
      }
      if (pathname === "/api/market/gold") {
        const gold = dbQuery("SELECT * FROM gold_prices ORDER BY id DESC LIMIT 1");
        sendJson(res, { current: gold[0] || {}, history: dbQuery("SELECT * FROM gold_price_history ORDER BY date DESC LIMIT 30") });
        return;
      }
      if (pathname === "/api/market/recommendations/ai-insights") {
        sendJson(res, { insights: dbQuery("SELECT ticker, name_ar, recommendation, composite_score, confidence, predicted_direction, target_price FROM prediction_logs WHERE validated = 1 AND composite_score IS NOT NULL ORDER BY composite_score DESC LIMIT 5") });
        return;
      }
      if (pathname === "/api/stocks" || pathname.startsWith("/api/stocks?")) {
        const stocks = dbQuery("SELECT * FROM stocks WHERE is_active = 1 ORDER BY volume DESC LIMIT 50");
        sendJson(res, { stocks, total: stocks.length });
        return;
      }
      if (pathname.startsWith("/api/stocks/")) {
        const ticker = pathname.split("/").pop().replace(/\.json$/, "");
        if (ticker) {
          const stock = dbQuery("SELECT * FROM stocks WHERE ticker = ?", [ticker]);
          sendJson(res, stock.length > 0 ? stock[0] : { error: "Not found" }, stock.length > 0 ? 200 : 404);
          return;
        }
      }
      if (pathname === "/api/watchlist") {
        sendJson(res, { items: dbQuery("SELECT * FROM WatchlistItem WHERE user_id = 'anonymous' ORDER BY added_at DESC") });
        return;
      }
      if (pathname === "/api/v2/feedback/status") {
        sendJson(res, { summary: dbQuery("SELECT * FROM feedback_accuracy_summary ORDER BY evaluated_at DESC LIMIT 3") });
        return;
      }
      if (pathname === "/api/notifications") {
        sendJson(res, { notifications: dbQuery("SELECT * FROM NotificationLog WHERE user_id = 'anonymous' ORDER BY created_at DESC LIMIT 20") });
        return;
      }
      sendJson(res, { status: "ok" });
    } catch(e) {
      console.error("[API] Error:", e.message);
      sendJson(res, { error: "Internal error" }, 500);
    }
  });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  // API routes
  if (pathname.startsWith("/api/")) {
    return handleApi(req, res, pathname);
  }

  // Next.js static assets
  if (pathname.startsWith("/_next/static/")) {
    const filePath = path.join(STATIC_DIR, pathname.replace("/_next/static/", ""));
    if (sendFile(res, filePath)) return;
  }

  // Next.js media assets
  if (pathname.startsWith("/_next/static/media/")) {
    const filePath = path.join(STATIC_DIR, "media", pathname.split("/_next/static/media/")[1]);
    if (sendFile(res, filePath)) return;
  }

  // Public files
  if (pathname === "/favicon.ico" || pathname.endsWith(".png") || pathname.endsWith(".svg")) {
    if (sendFile(res, path.join(PUBLIC_DIR, pathname))) return;
  }

  // HTML page
  sendHtml(res, getHtml());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ EGX Server on http://0.0.0.0:${PORT}`);
});

// Pre-init DB in background
setTimeout(() => initDb(), 1000);

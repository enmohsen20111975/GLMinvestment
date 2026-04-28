/**
 * Lightweight EGX production server using Bun's native HTTP.
 */
const { readFile, stat } = require("node:fs/promises");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const PORT = 3000;
const STATIC_DIR = join(__dirname, ".next", "static");
const PUBLIC_DIR = join(__dirname, "public");
const HTML_PATH = join(__dirname, ".next", "server", "app", "index.html");

// MIME types
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

// Lazy DB init
let db = null;
let dbReady = false;

async function initDb() {
  if (dbReady) return;
  if (dbReady === "loading") return; // prevent double-init
  dbReady = "loading";
  try {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({
      locateFile: (f) => join(__dirname, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    });
    const dbPath = join(__dirname, "db", "egx_investment.db");
    if (existsSync(dbPath)) {
      // Use Buffer instead of Uint8Array to reduce memory pressure
      const buf = readFileSync(dbPath);
      db = new SQL.Database(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      console.log("[DB] Database loaded, size:", (buf.length / 1024 / 1024).toFixed(1), "MB");
    } else {
      db = new SQL.Database();
    }
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    dbReady = true;
    console.log("[DB] Ready");
  } catch (e) {
    console.error("[DB] Error:", e.message);
    dbReady = false;
  }
}

function dbQuery(sql, params) {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    const ps = params ? params.map(p => p ?? null) : [];
    if (ps.length > 0) stmt.bind(ps);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject({ useAsNull: true }));
    stmt.free();
    return rows;
  } catch (e) {
    console.error("[DB] Query error:", sql, e.message);
    return [];
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}

// Pre-read HTML
let htmlCache = null;
async function getHtml() {
  if (htmlCache) return htmlCache;
  try {
    htmlCache = readFileSync(HTML_PATH, "utf-8");
    return htmlCache;
  } catch {
    return "<html><body><h1>EGX Platform — Build not found</h1></body></html>";
  }
}

async function serveStatic(filePath) {
  try {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const mime = MIME[ext] || "application/octet-stream";
    const content = await readFile(filePath);
    return new Response(content, {
      headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return null;
  }
}

async function handleApi(pathname) {
  if (pathname === "/api/auth/session" || pathname === "/api/auth/csrf" || pathname === "/api/auth/providers") {
    return json({});
  }
  if (pathname === "/api/auth/_log") {
    return json({ ok: true });
  }

  if (pathname === "/api/market/overview") {
    await initDb();
    const indices = dbQuery("SELECT * FROM market_indices ORDER BY id");
    const topStocks = dbQuery("SELECT ticker, name_ar, current_price, change_percent FROM stocks WHERE is_active = 1 ORDER BY volume DESC LIMIT 10");
    return json({ indices, topStocks, marketStatus: "open" });
  }

  if (pathname === "/api/market/currency") {
    await initDb();
    const rates = dbQuery("SELECT * FROM currency_rates ORDER BY id");
    return json({ rates });
  }

  if (pathname === "/api/market/gold") {
    await initDb();
    const gold = dbQuery("SELECT * FROM gold_prices ORDER BY id DESC LIMIT 1");
    const history = dbQuery("SELECT * FROM gold_price_history ORDER BY date DESC LIMIT 30");
    return json({ current: gold[0] || {}, history });
  }

  if (pathname === "/api/market/recommendations/ai-insights") {
    await initDb();
    const topRecs = dbQuery("SELECT ticker, name_ar, recommendation, composite_score, confidence, predicted_direction, target_price FROM prediction_logs WHERE validated = 1 AND composite_score IS NOT NULL ORDER BY composite_score DESC LIMIT 5");
    return json({ insights: topRecs });
  }

  if (pathname === "/api/stocks" || pathname.startsWith("/api/stocks?")) {
    await initDb();
    const stocks = dbQuery("SELECT * FROM stocks WHERE is_active = 1 ORDER BY volume DESC LIMIT 50");
    return json({ stocks, total: stocks.length });
  }

  if (pathname === "/api/watchlist") {
    await initDb();
    const items = dbQuery("SELECT * FROM WatchlistItem WHERE user_id = 'anonymous' ORDER BY added_at DESC");
    return json({ items });
  }

  if (pathname === "/api/v2/feedback/status") {
    await initDb();
    const summary = dbQuery("SELECT * FROM feedback_accuracy_summary ORDER BY evaluated_at DESC LIMIT 3");
    return json({ summary });
  }

  if (pathname === "/api/subscription/plans") {
    return json({
      plans: [
        { id: "free", name: "مجاني", price: 0 },
        { id: "basic", name: "أساسي", price: 99 },
        { id: "pro", name: "احترافي", price: 249 },
        { id: "premium", name: "متميز", price: 499 },
      ],
    });
  }

  if (pathname === "/api/notifications") {
    await initDb();
    const notifs = dbQuery("SELECT * FROM NotificationLog WHERE user_id = 'anonymous' ORDER BY created_at DESC LIMIT 20");
    return json({ notifications: notifs });
  }

  // Catch-all for other API routes — return empty success
  if (pathname.startsWith("/api/")) {
    return json({ status: "ok" });
  }

  return json({ error: "Not found" }, 404);
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      return handleApi(pathname);
    }

    if (pathname.startsWith("/_next/static/")) {
      const filePath = join(STATIC_DIR, pathname.replace("/_next/static/", ""));
      const resp = await serveStatic(filePath);
      if (resp) return resp;
    }

    // Public files
    if (pathname === "/favicon.ico" || pathname === "/favicon-32x32.png" || pathname === "/favicon-16x16.png" || pathname.endsWith(".png") || pathname.endsWith(".svg")) {
      const resp = await serveStatic(join(PUBLIC_DIR, pathname));
      if (resp) return resp;
    }

    // HTML page
    const html = await getHtml();
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`✓ EGX Server running on http://0.0.0.0:${PORT}`);

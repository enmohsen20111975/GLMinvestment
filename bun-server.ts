/**
 * Lightweight EGX production server using Bun's native HTTP.
 * Much more memory-efficient than Node.js standalone server.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const PORT = 3000;
const STATIC_DIR = join(import.meta.dir, ".next", "static");
const PUBLIC_DIR = join(import.meta.dir, "public");
const BUILD_ID_FILE = join(import.meta.dir, ".next", "BUILD_ID");

// Read build ID
const BUILD_ID = await readFile(BUILD_ID_FILE, "utf-8").then(b => b.trim()).catch(() => "dev");

// MIME types
const MIME: Record<string, string> = {
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

// Dynamic imports for sql.js and route handlers
let sqlJsModule: any = null;
let db: any = null;
let dbReady = false;

async function initDb() {
  if (dbReady) return;
  try {
    const initSqlJs = (await import("sql.js")).default;
    sqlJsModule = await initSqlJs({
      locateFile: (file: string) => join(import.meta.dir, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    });
    const dbPath = join(import.meta.dir, "db", "egx_investment.db");
    if (existsSync(dbPath)) {
      const buf = await readFile(dbPath);
      db = new sqlJsModule.Database(buf);
    } else {
      db = new sqlJsModule.Database();
    }
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    dbReady = true;
    console.log("[DB] Database loaded successfully");
  } catch (e) {
    console.error("[DB] Error loading database:", e);
    dbReady = false;
  }
}

function dbQuery(sql: string, params?: any[]): any[] {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    if (params && params.length > 0) stmt.bind(params.map(p => p ?? null));
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject({ useAsNull: true }));
    stmt.free();
    return rows;
  } catch (e) {
    console.error("[DB] Query error:", sql, e);
    return [];
  }
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}

// API route handlers
async function handleApi(pathname: string): Promise<Response> {
  // Auth session
  if (pathname === "/api/auth/session") {
    return jsonResponse({});
  }

  // Market overview
  if (pathname === "/api/market/overview") {
    await initDb();
    const indices = dbQuery("SELECT * FROM market_indices ORDER BY id");
    const topStocks = dbQuery("SELECT ticker, name_ar, current_price, change_percent FROM stocks WHERE is_active = 1 ORDER BY volume DESC LIMIT 10");
    return jsonResponse({ indices, topStocks, marketStatus: "open" });
  }

  // Currency rates
  if (pathname === "/api/market/currency") {
    await initDb();
    const rates = dbQuery("SELECT * FROM currency_rates ORDER BY id");
    return jsonResponse({ rates });
  }

  // Gold price
  if (pathname === "/api/market/gold") {
    await initDb();
    const gold = dbQuery("SELECT * FROM gold_prices ORDER BY id DESC LIMIT 1");
    const history = dbQuery("SELECT * FROM gold_price_history ORDER BY date DESC LIMIT 30");
    return jsonResponse({ current: gold[0] || {}, history });
  }

  // AI insights
  if (pathname === "/api/market/recommendations/ai-insights") {
    await initDb();
    const topRecs = dbQuery(`
      SELECT ticker, name_ar, recommendation, composite_score, confidence, predicted_direction, target_price
      FROM prediction_logs 
      WHERE validated = 1 AND composite_score IS NOT NULL
      ORDER BY composite_score DESC LIMIT 5
    `);
    return jsonResponse({ insights: topRecs });
  }

  // Stocks list
  if (pathname === "/api/stocks") {
    await initDb();
    const stocks = dbQuery("SELECT * FROM stocks WHERE is_active = 1 ORDER BY volume DESC LIMIT 50");
    return jsonResponse({ stocks, total: stocks.length });
  }

  // Watchlist
  if (pathname === "/api/watchlist") {
    await initDb();
    const items = dbQuery("SELECT * FROM WatchlistItem WHERE user_id = 'anonymous' ORDER BY added_at DESC");
    return jsonResponse({ items });
  }

  // Feedback status
  if (pathname === "/api/v2/feedback/status") {
    await initDb();
    const summary = dbQuery("SELECT * FROM feedback_accuracy_summary ORDER BY evaluated_at DESC LIMIT 3");
    return jsonResponse({ summary });
  }

  // Subscription plans
  if (pathname === "/api/subscription/plans") {
    return jsonResponse({
      plans: [
        { id: "free", name: "مجاني", price: 0, features: ["أساسيات السوق", "5 أسهم في قائمة المراقبة"] },
        { id: "basic", name: "أساسي", price: 99, features: ["تحليلات متقدمة", "20 سهم في قائمة المراقبة", "تنبيهات الأسعار"] },
        { id: "pro", name: "احترافي", price: 249, features: ["جميع الميزات", "تنبيهات الشراء/البيع", "تقارير يومية"] },
        { id: "premium", name: "متميز", price: 499, features: ["كل شيء غير محدود", "توصيات AI متقدمة", "دعم أولوي"] },
      ],
    });
  }

  // Notification log
  if (pathname === "/api/notifications") {
    await initDb();
    const notifs = dbQuery("SELECT * FROM NotificationLog WHERE user_id = 'anonymous' ORDER BY created_at DESC LIMIT 20");
    return jsonResponse({ notifications: notifs });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

// Serve static file
async function serveStatic(filePath: string): Promise<Response | null> {
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

// Main request handler
const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    // API routes
    if (pathname.startsWith("/api/")) {
      return handleApi(pathname);
    }

    // Next.js static assets (_next/static/*)
    if (pathname.startsWith("/_next/static/")) {
      const filePath = join(STATIC_DIR, pathname.replace("/_next/static/", ""));
      const resp = await serveStatic(filePath);
      if (resp) return resp;
    }

    // Public files (favicon, etc.)
    const publicResp = await serveStatic(join(PUBLIC_DIR, pathname));
    if (publicResp) return publicResp;

    // HTML page — serve the pre-built index.html
    const htmlPath = join(import.meta.dir, ".next", "server", "app", "index.html");
    let html: string;
    try {
      html = await readFile(htmlPath, "utf-8");
    } catch {
      return new Response("EGX Platform — build not found", { status: 503 });
    }

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`✓ EGX Server running on http://0.0.0.0:${PORT}`);
console.log(`✓ Static dir: ${STATIC_DIR}`);
console.log(`✓ Build ID: ${BUILD_ID}`);

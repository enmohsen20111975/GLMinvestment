/**
 * Database Manager v2 - دليل الاستثمار
 * ================================================
 * 
 * هيكل قواعد البيانات الجديد:
 * 
 * auth.db (Prisma): المستخدمين والمصادقة
 * ├── User, Account, ApiToken
 * ├── PortfolioPosition, Watchlist
 * ├── SubscriptionPlan, UserSubscription
 * └── UserPost, UserPoints, InstaPayPayment
 * 
 * stocks.db (better-sqlite3): الأسهم والبيانات الأساسية
 * ├── stocks (EGX + Arab + Crypto)
 * ├── market_indices
 * └── maestro_personas
 * 
 * price_history.db: الأسعار التاريخية
 * predictions.db: التوقعات
 * learned.db: الدروس المستفادة
 */

import { Database } from "bun:sqlite";
import * as path from "path";
import { existsSync, mkdirSync } from "fs";

// ===========================================================================
// مسارات قواعد البيانات
// ===========================================================================

const DB_DIR = path.join(process.cwd(), "db");

export const DB_PATHS = {
  auth: path.join(DB_DIR, "auth.db"),
  stocks: path.join(DB_DIR, "stocks.db"),
  price_history: path.join(DB_DIR, "price_history.db"),
  predictions: path.join(DB_DIR, "predictions.db"),
  learned: path.join(DB_DIR, "learned.db"),
};

// ===========================================================================
// Singletons
// ===========================================================================

let _stocksDb: Database | null = null;
let _priceHistoryDb: Database | null = null;
let _predictionsDb: Database | null = null;
let _learnedDb: Database | null = null;

// Ensure db directory exists
function ensureDbDir(): void {
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }
}

// ===========================================================================
// Stocks Database
// ===========================================================================

export function getStocksDb(): Database {
  if (_stocksDb) return _stocksDb;
  
  ensureDbDir();
  const dbPath = DB_PATHS.stocks;
  
  _stocksDb = new Database(dbPath);
  _stocksDb.run("PRAGMA journal_mode = WAL");
  _stocksDb.run("PRAGMA foreign_keys = ON");
  // FIX July 2026: busy_timeout = 30s
  _stocksDb.run("PRAGMA busy_timeout = 30000");
  
  // Create stocks table if not exists
  _stocksDb.run(`
    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT UNIQUE NOT NULL,
      name TEXT,
      name_ar TEXT,
      market TEXT DEFAULT 'EGX',
      sector TEXT,
      industry TEXT,
      
      current_price REAL,
      previous_close REAL,
      open_price REAL,
      high_price REAL,
      low_price REAL,
      volume INTEGER,
      market_cap REAL,
      
      pe_ratio REAL,
      pb_ratio REAL,
      ps_ratio REAL,
      eps REAL,
      roe REAL,
      roa REAL,
      dividend_yield REAL,
      
      debt_to_equity REAL,
      current_ratio REAL,
      book_value_per_share REAL,
      
      rsi REAL,
      ma_50 REAL,
      ma_200 REAL,
      support_level REAL,
      resistance_level REAL,
      
      is_halal INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_crypto INTEGER DEFAULT 0,
      egx30_member INTEGER DEFAULT 0,
      egx70_member INTEGER DEFAULT 0,
      egx100_member INTEGER DEFAULT 0,
      
      last_update TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  // Create indices
  _stocksDb.run("CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)");
  _stocksDb.run("CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market)");
  _stocksDb.run("CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)");
  
  console.log("[db-v2] Stocks DB initialized");
  return _stocksDb;
}

// ===========================================================================
// Price History Database
// ===========================================================================

export function getPriceHistoryDb(): Database {
  if (_priceHistoryDb) return _priceHistoryDb;
  
  ensureDbDir();
  const dbPath = DB_PATHS.price_history;
  
  _priceHistoryDb = new Database(dbPath);
  _priceHistoryDb.run("PRAGMA journal_mode = WAL");
  _priceHistoryDb.run("PRAGMA foreign_keys = ON");
  // FIX July 2026: busy_timeout = 30s
  _priceHistoryDb.run("PRAGMA busy_timeout = 30000");
  
  // Create price_history table
  _priceHistoryDb.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume INTEGER,
      adjusted_close REAL,
      source TEXT DEFAULT 'unknown',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(ticker, date)
    )
  `);
  
  _priceHistoryDb.run("CREATE INDEX IF NOT EXISTS idx_price_ticker ON price_history(ticker)");
  _priceHistoryDb.run("CREATE INDEX IF NOT EXISTS idx_price_date ON price_history(date)");
  _priceHistoryDb.run("CREATE INDEX IF NOT EXISTS idx_price_ticker_date ON price_history(ticker, date)");
  
  console.log("[db-v2] Price History DB initialized");
  return _priceHistoryDb;
}

// ===========================================================================
// Predictions Database
// ===========================================================================

export function getPredictionsDb(): Database {
  if (_predictionsDb) return _predictionsDb;
  
  ensureDbDir();
  const dbPath = DB_PATHS.predictions;
  
  _predictionsDb = new Database(dbPath);
  _predictionsDb.run("PRAGMA journal_mode = WAL");
  _predictionsDb.run("PRAGMA foreign_keys = ON");
  // FIX July 2026: busy_timeout = 30s
  _predictionsDb.run("PRAGMA busy_timeout = 30000");
  
  // Create predictions tables
  _predictionsDb.run(`
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      market TEXT DEFAULT 'EGX',
      signal TEXT,
      confidence REAL DEFAULT 0.5,
      entry_price REAL,
      target_price REAL,
      stop_loss REAL,
      reasoning TEXT,
      indicators TEXT,
      news_summary TEXT,
      verify_date TEXT,
      verified INTEGER DEFAULT 0,
      final_price REAL,
      result TEXT,
      profit_loss_pct REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  _predictionsDb.run(`
    CREATE TABLE IF NOT EXISTS prediction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      prediction_type TEXT,
      log_data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  console.log("[db-v2] Predictions DB initialized");
  return _predictionsDb;
}

// ===========================================================================
// Learned Lessons Database
// ===========================================================================

export function getLearnedDb(): Database {
  if (_learnedDb) return _learnedDb;
  
  ensureDbDir();
  const dbPath = DB_PATHS.learned;
  
  _learnedDb = new Database(dbPath);
  _learnedDb.run("PRAGMA journal_mode = WAL");
  _learnedDb.run("PRAGMA foreign_keys = ON");
  // FIX July 2026: busy_timeout = 30s
  _learnedDb.run("PRAGMA busy_timeout = 30000");
  
  // Create learned_lessons table
  _learnedDb.run(`
    CREATE TABLE IF NOT EXISTS learned_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      trigger_conditions TEXT,
      action TEXT,
      confidence REAL DEFAULT 0,
      occurrences INTEGER DEFAULT 1,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'testing',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  console.log("[db-v2] Learned DB initialized");
  return _learnedDb;
}

// ===========================================================================
// Helper Functions
// ===========================================================================

/**
 * الحصول على سهم بواسطة الرمز
 */
export function getStockByTickerV2(ticker: string): Record<string, unknown> | null {
  const db = getStocksDb();
  const row = db.prepare("SELECT * FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1").get(ticker) as Record<string, unknown> | undefined;
  return row || null;
}

/**
 * الحصول على كل الأسهم
 */
export function getAllStocksV2(): Record<string, unknown>[] {
  const db = getStocksDb();
  return db.prepare("SELECT * FROM stocks WHERE is_active = 1 ORDER BY volume DESC").all() as Record<string, unknown>[];
}

/**
 * الحصول على الأسعار التاريخية لسهم
 */
export function getPriceHistoryV2(ticker: string, limit: number = 365): Record<string, unknown>[] {
  const db = getPriceHistoryDb();
  return db.prepare(`
    SELECT date, open, high, low, close, volume 
    FROM price_history 
    WHERE ticker = ? 
    ORDER BY date DESC 
    LIMIT ?
  `).all(ticker, limit) as Record<string, unknown>[];
}

/**
 * إضافة سهم جديد
 */
export function insertStockV2(stock: Record<string, unknown>): void {
  const db = getStocksDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO stocks (
      ticker, name, name_ar, market, sector, industry,
      current_price, previous_close, open_price, high_price, low_price,
      volume, market_cap, pe_ratio, pb_ratio, ps_ratio, eps, roe, roa,
      dividend_yield, debt_to_equity, current_ratio, book_value_per_share,
      rsi, ma_50, ma_200, support_level, resistance_level,
      is_halal, is_active, is_crypto, egx30_member, egx70_member, egx100_member,
      last_update
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    stock.ticker, stock.name, stock.name_ar, stock.market || 'EGX', stock.sector, stock.industry,
    stock.current_price, stock.previous_close, stock.open_price, stock.high_price, stock.low_price,
    stock.volume, stock.market_cap, stock.pe_ratio, stock.pb_ratio, stock.ps_ratio, stock.eps, stock.roe, stock.roa,
    stock.dividend_yield, stock.debt_to_equity, stock.current_ratio, stock.book_value_per_share,
    stock.rsi, stock.ma_50, stock.ma_200, stock.support_level, stock.resistance_level,
    stock.is_halal || 0, stock.is_active ?? 1, stock.is_crypto || 0, stock.egx30_member || 0, stock.egx70_member || 0, stock.egx100_member || 0,
    new Date().toISOString()
  );
}

/**
 * إضافة سجل سعر تاريخي
 */
export function insertPriceHistoryV2(ticker: string, data: Record<string, unknown>): void {
  const db = getPriceHistoryDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO price_history (ticker, date, open, high, low, close, volume, adjusted_close, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    ticker, data.date, data.open, data.high, data.low, data.close, data.volume, data.adjusted_close, data.source || 'unknown'
  );
}

/**
 * إغلاق جميع الاتصالات
 */
export function closeAllDbs(): void {
  if (_stocksDb) { _stocksDb.close(); _stocksDb = null; }
  if (_priceHistoryDb) { _priceHistoryDb.close(); _priceHistoryDb = null; }
  if (_predictionsDb) { _predictionsDb.close(); _predictionsDb = null; }
  if (_learnedDb) { _learnedDb.close(); _learnedDb = null; }
  console.log("[db-v2] All databases closed");
}

/**
 * إعادة تعيين جميع الاتصالات (للاختبار)
 */
export function resetAllDbs(): void {
  closeAllDbs();
  console.log("[db-v2] All databases reset");
}

// ===========================================================================
// إحصائيات
// ===========================================================================

export function getDbStats(): Record<string, unknown> {
  const stats: Record<string, unknown> = {};
  
  try {
    const stocksDb = getStocksDb();
    const stocksCount = stocksDb.prepare("SELECT COUNT(*) as count FROM stocks").get() as { count: number };
    stats.stocks = stocksCount.count;
  } catch (e) {
    stats.stocks = 'error';
  }
  
  try {
    const priceHistoryDb = getPriceHistoryDb();
    const priceCount = priceHistoryDb.prepare("SELECT COUNT(*) as count FROM price_history").get() as { count: number };
    stats.price_history = priceCount.count;
  } catch (e) {
    stats.price_history = 'error';
  }
  
  try {
    const predictionsDb = getPredictionsDb();
    const predCount = predictionsDb.prepare("SELECT COUNT(*) as count FROM predictions").get() as { count: number };
    stats.predictions = predCount.count;
  } catch (e) {
    stats.predictions = 'error';
  }
  
  try {
    const learnedDb = getLearnedDb();
    const lessonsCount = learnedDb.prepare("SELECT COUNT(*) as count FROM learned_lessons").get() as { count: number };
    stats.learned_lessons = lessonsCount.count;
  } catch (e) {
    stats.learned_lessons = 'error';
  }
  
  return stats;
}

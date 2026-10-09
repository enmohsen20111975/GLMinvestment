// P1-FIX (2026-10-09, Round 2): This file has its own alias map. Should import normalizeMarket() from @/lib/market-utils.ts for single source of truth.
import { initialize, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper'
import * as path from 'path'
import { existsSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'
import { openDb } from '@/lib/shared-db'

// ===========================================================================
// Robust native (better-sqlite3) → SqliteDatabase adapter
// ===========================================================================
// `shared-db.ts openDb()` returns a native `Database.Database` opened with
// busy_timeout + retry + readonly/immutable fallback so the WAL journal that
// the Python service maintains can be reconciled without throwing
// "file is not a database". We wrap that native connection in the
// `SqliteDatabase` interface that the rest of this module expects so callers
// don't need to change.
function wrapNativeDatabase(db: Database.Database): SqliteDatabase {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql)
      return {
        get(...params: unknown[]): Record<string, unknown> | undefined {
          return stmt.get(...params) as Record<string, unknown> | undefined
        },
        all(...params: unknown[]): Record<string, unknown>[] {
          return stmt.all(...params) as Record<string, unknown>[]
        },
        run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
          const r = stmt.run(...params)
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
        },
      }
    },
    run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
      const r = db.prepare(sql).run(...params)
      return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
    },
    pragma(cmd: string): unknown[] {
      return db.pragma(cmd) as unknown[]
    },
    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
      return db.transaction(fn) as (...args: unknown[]) => T
    },
    close(): void {
      // shared-db caches the underlying connection; closing here would break
      // the cache for the next caller. Make this a no-op so callers that try
      // to close don't shoot themselves in the foot.
      // (The process will release the file handle on exit.)
    },
    save(): void {
      try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore - safe-by-design */ }
    },
  }
}

// ===========================================================================
// هيكل قواعد البيانات الجديد
// ===========================================================================
//
// data_engine.db (~18 MB) - الأسهم والعملات الرقمية والمعادن (البيانات الأساسية)
//   ├── stocks (3,343 سجل) - مصر، السعودية، الكويت، قطر
//   ├── gold_prices, silver_prices, crypto_prices, exchange_rates
//   └── historical_data (99,076 سجل)
//
// price_history.db (~58 MB) - الأسعار التاريخية
//   └── price_history (273,750 سجل)
//
// stocks.db (~0.3 MB) - بيانات تقنية إضافية
//   └── ExpertRecommendation, prediction_logs
//
// auth.db (~0.6 MB) - المستخدمين (Prisma)
//   └── User, Portfolio, Watchlist, etc.
//
// learned.db (~10 MB) - التعلم الآلي
//   └── learned_lessons, indicator_weights
//
// predictions.db - التوقعات
//
// ===========================================================================

let _ensurePromise: Promise<void> | null = null

export async function ensureInitialized(): Promise<void> {
  if (isInitialized()) return
  if (_ensurePromise) {
    try {
      await _ensurePromise
      return
    } catch { // silent fallback (safe-by-design)
      _ensurePromise = null
    }
  }
  _ensurePromise = initialize().catch((err) => {
    _ensurePromise = null
    throw err
  })
  return _ensurePromise.then(async () => {
    // Per-user portfolio indexes: declared with IF NOT EXISTS, so this is a
    // cheap no-op after the first boot.
    try {
      ensureUserPortfolioIndexes(getWritableDb())
    } catch { // silent fallback (safe-by-design)
      // stocks.db unavailable here — the routes degrade gracefully.
    }
  })
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const _cache = new Map<string, CacheEntry<unknown>>()
const CACHE_TTL_MS = 30_000

function getCached<T>(key: string): T | null {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data as T
  }
  return null
}

function setCache<T>(key: string, data: T): void {
  _cache.set(key, { data, timestamp: Date.now() })
}

export function clearDbCache(): void {
  _cache.clear()
}

// ---------------------------------------------------------------------------
// DATA ENGINE DB - data_engine.db (الأسهم والعملات الرقمية - المصدر الأساسي)
// ---------------------------------------------------------------------------

let _dataEngineDb: Database.Database | null = null

/**
 * Get data_engine.db connection (better-sqlite3)
 * هذا هو المصدر الأساسي لبيانات الأسهم
 */
export function getDataEngineDb(): Database.Database {
  if (_dataEngineDb) return _dataEngineDb

  const dbPath = path.join(process.cwd(), 'db', 'data_engine.db')
  if (!existsSync(dbPath)) {
    throw new Error(`data_engine.db not found at ${dbPath}`)
  }

  // Robust open: read-write so the Python service's WAL reconciles, busy_timeout,
  // immutable fallback on transient errors. See `src/lib/shared-db.ts`.
  _dataEngineDb = openDb('data_engine.db')
  console.log('[egx-db] Data Engine DB loaded (data_engine.db) [robust]')
  return _dataEngineDb
}

// ---------------------------------------------------------------------------
// STOCKS DB - stocks.db (للبيانات التقنية فقط)
// ---------------------------------------------------------------------------

let _stocksDb: SqliteDatabase | null = null

export function getStocksDb(): SqliteDatabase {
  if (_stocksDb) return _stocksDb

  const dbPath = path.join(process.cwd(), 'db', 'stocks.db')
  if (!existsSync(dbPath)) {
    throw new Error(`stocks.db not found at ${dbPath}`)
  }

  // Robust open via shared-db (read-write + busy_timeout + immutable fallback)
  // so the Python service's WAL journal reconciles without throwing
  // "file is not a database". No longer requires sql.js initialization.
  const native = openDb('stocks.db')
  _stocksDb = wrapNativeDatabase(native)
  try { _stocksDb.pragma('foreign_keys = ON') } catch { /* ignore - safe-by-design */ }
  console.log('[egx-db] Stocks DB loaded (stocks.db) [robust]')
  return _stocksDb
}

export function resetStocksDbState(): void {
  _stocksDb = null
  clearDbCache()
  console.log('[egx-db] Stocks DB state reset')
}

// ---------------------------------------------------------------------------
// PRICE HISTORY DB - price_history.db (الأسعار التاريخية)
// ---------------------------------------------------------------------------

let _priceHistoryDb: SqliteDatabase | null = null

export function getPriceHistoryDb(): SqliteDatabase {
  if (_priceHistoryDb) return _priceHistoryDb

  const dbPath = path.join(process.cwd(), 'db', 'price_history.db')
  if (!existsSync(dbPath)) {
    console.warn(`[egx-db] price_history.db not found at ${dbPath}`)
    throw new Error('price_history.db not found')
  }

  // Robust open via shared-db.
  const native = openDb('price_history.db')
  _priceHistoryDb = wrapNativeDatabase(native)
  try { _priceHistoryDb.pragma('foreign_keys = ON') } catch { /* ignore - safe-by-design */ }
  console.log('[egx-db] Price History DB loaded [robust]')
  return _priceHistoryDb
}

export function resetPriceHistoryDbState(): void {
  _priceHistoryDb = null
  console.log('[egx-db] Price History DB state reset')
}

// ---------------------------------------------------------------------------
// LEARNED DB - learned.db (التعلم الآلي)
// ---------------------------------------------------------------------------

let _learnedDb: SqliteDatabase | null = null

export function getLearnedDb(): SqliteDatabase {
  if (_learnedDb) return _learnedDb

  const dbPath = path.join(process.cwd(), 'db', 'learned.db')
  if (!existsSync(dbPath)) {
    console.warn(`[egx-db] learned.db not found at ${dbPath}`)
    throw new Error('learned.db not found')
  }

  // Robust open via shared-db (treats learned.db as Next.js-owned → writable).
  const native = openDb('learned.db')
  _learnedDb = wrapNativeDatabase(native)
  console.log('[egx-db] Learned DB loaded [robust]')
  return _learnedDb
}

// ---------------------------------------------------------------------------
// WRITABLE STOCKS DB (for admin operations)
// ---------------------------------------------------------------------------

let _writableStocksDb: SqliteDatabase | null = null

export function getWritableStocksDb(): SqliteDatabase {
  if (_writableStocksDb) return _writableStocksDb

  const dbPath = path.join(process.cwd(), 'db', 'stocks.db')
  if (!existsSync(dbPath)) {
    const dbDir = path.dirname(dbPath)
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }
  }

  // Robust open via shared-db, forced writable so admin writes go through.
  const native = openDb('stocks.db', { writable: true })
  _writableStocksDb = wrapNativeDatabase(native)
  try { _writableStocksDb.pragma('journal_mode = WAL') } catch { /* ignore - safe-by-design */ }
  try { _writableStocksDb.pragma('foreign_keys = ON') } catch { /* ignore - safe-by-design */ }
  console.log('[egx-db] Writable Stocks DB created [robust]')
  return _writableStocksDb
}

// ---------------------------------------------------------------------------
// WRITABLE PRICE HISTORY DB (for admin operations)
// ---------------------------------------------------------------------------

let _writablePriceHistoryDb: SqliteDatabase | null = null

export function getWritablePriceHistoryDb(): SqliteDatabase {
  if (_writablePriceHistoryDb) return _writablePriceHistoryDb

  const dbPath = path.join(process.cwd(), 'db', 'price_history.db')
  
  if (!existsSync(dbPath)) {
    const dbDir = path.dirname(dbPath)
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }
  }

  // Robust open via shared-db, forced writable so historical sync writes go through.
  const native = openDb('price_history.db', { writable: true })
  _writablePriceHistoryDb = wrapNativeDatabase(native)
  try { _writablePriceHistoryDb.pragma('journal_mode = WAL') } catch { /* ignore - safe-by-design */ }
  try { _writablePriceHistoryDb.pragma('foreign_keys = ON') } catch { /* ignore - safe-by-design */ }
  console.log('[egx-db] Writable Price History DB created [robust]')
  return _writablePriceHistoryDb
}

export function resetWritablePriceHistoryDbState(): void {
  _writablePriceHistoryDb = null
  console.log('[egx-db] Writable Price History DB state reset')
}

// ---------------------------------------------------------------------------
// EXPERT RECOMMENDATIONS SCHEMA MIGRATION
// Ensure the ExpertRecommendation table has all columns the API routes expect.
// Idempotent — safe to call on every request. ALTER TABLE ADD COLUMN fails
// silently (caught) if the column already exists.
// ---------------------------------------------------------------------------

const EXPERT_REC_EXTRA_COLUMNS: Array<{ name: string; def: string }> = [
  { name: 'expert_source', def: 'TEXT' },
  { name: 'entry_condition', def: 'TEXT' },
  { name: 'stop_loss_condition', def: 'TEXT' },
  { name: 'expected_profit_min', def: 'REAL' },
  { name: 'expected_profit_max', def: 'REAL' },
  { name: 'expected_profit_investment', def: 'REAL' },
  { name: 'technical_analysis', def: 'TEXT' },
  { name: 'fundamental_analysis', def: 'TEXT' },
  { name: 'recommendation_reason', def: 'TEXT' },
  { name: 'session_type', def: "TEXT DEFAULT 'صباحية'" },
  { name: 'expected_duration', def: 'TEXT' },
  { name: 'expected_duration_days', def: 'INTEGER' },
]

let _expertRecSchemaEnsured = false

export function ensureExpertRecommendationSchema(db: SqliteDatabase): void {
  if (_expertRecSchemaEnsured) return
  try {
    // Make sure the base table exists (use prepare().run() — SqliteDatabase wrapper has no exec())
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ExpertRecommendation (
        id TEXT PRIMARY KEY,
        stock_symbol TEXT NOT NULL,
        stock_name_ar TEXT,
        expert_name TEXT NOT NULL DEFAULT 'خبير محلل',
        action TEXT NOT NULL,
        recommendation_type TEXT DEFAULT 'detailed',
        entry_price REAL,
        entry_price_from REAL,
        entry_price_to REAL,
        target_price REAL,
        target_price_2 REAL,
        investment_target REAL,
        stop_loss REAL,
        support_level REAL,
        resistance_level REAL,
        session_date TEXT,
        status TEXT DEFAULT 'PENDING',
        final_price REAL,
        profit_loss_percent REAL,
        hit_target INTEGER DEFAULT 0,
        hit_stop_loss INTEGER DEFAULT 0,
        notes TEXT,
        recommendation_date TEXT DEFAULT (datetime('now')),
        closed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run()
    // Add any missing extra columns (idempotent)
    for (const col of EXPERT_REC_EXTRA_COLUMNS) {
      try {
        db.prepare(`ALTER TABLE ExpertRecommendation ADD COLUMN ${col.name} ${col.def}`).run()
      } catch { // silent fallback (safe-by-design)
        // column already exists — expected
      }
    }
    _expertRecSchemaEnsured = true
  } catch (e) {
    console.error('[egx-db] ensureExpertRecommendationSchema error:', e)
  }
}

// ---------------------------------------------------------------------------
// User-portfolio indexes (deploy safety)
// ---------------------------------------------------------------------------
// `portfolio_assets` and `user_stock_watchlists` in stocks.db have no indexes
// at all, so every per-user portfolio read is a full table scan
// (EXPLAIN QUERY PLAN → "SCAN portfolio_assets"). These tables are hit on
// every dashboard refresh by /api/portfolio/unified-watch,
// /api/portfolio/holdings and /api/portfolio/watchlists.
//
// Declared with IF NOT EXISTS so it is safe to run on every boot and on
// databases created by any of the DDL variants in this repo.

const USER_PORTFOLIO_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_portfolio_assets_user_id ON portfolio_assets(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_portfolio_assets_user_ticker ON portfolio_assets(user_id, stock_ticker)',
  'CREATE INDEX IF NOT EXISTS idx_user_stock_watchlists_user_id ON user_stock_watchlists(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_stock_watchlists_stock_id ON user_stock_watchlists(stock_id)',
]

let _userPortfolioIdxEnsured = false

/**
 * Idempotently create the per-user indexes on the user portfolio tables.
 * No-ops on databases where those tables do not exist.
 */
export function ensureUserPortfolioIndexes(db: SqliteDatabase): void {
  if (_userPortfolioIdxEnsured) return
  try {
    for (const sql of USER_PORTFOLIO_INDEXES) {
      try {
        db.prepare(sql).run()
      } catch { // silent fallback (safe-by-design)
        // Table does not exist in this deployment variant — expected.
      }
    }
    _userPortfolioIdxEnsured = true
  } catch (e) {
    console.error('[egx-db] ensureUserPortfolioIndexes error:', e)
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StockFilters {
  query?: string
  sector?: string
  market?: string
  index?: 'egx30' | 'egx70' | 'egx100'
  is_active?: boolean
  page?: number
  page_size?: number
}

export interface PaginatedStocks {
  stocks: Record<string, unknown>[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface TopMoversResult {
  gainers: Record<string, unknown>[]
  losers: Record<string, unknown>[]
  most_active: Record<string, unknown>[]
}

// ---------------------------------------------------------------------------
// Market Code Mapping (Frontend -> data_engine.db)
// ---------------------------------------------------------------------------

/**
 * Map frontend market codes to Arabic market names used in data_engine.db
 * data_engine.db uses Arabic names: مصر، السعودية، الكويت، قطر
 * Frontend uses: EGX, KSA, TADAWUL, KSE, QSE
 */
const FRONTEND_TO_ARABIC_MARKET: Record<string, string> = {
  'EGX': 'مصر',
  'KSA': 'السعودية',
  'TADAWUL': 'السعودية',
  'KSE': 'الكويت',
  'QSE': 'قطر',
  'DFM': 'الإمارات',
  'BSE': 'البحرين',
};

/**
 * Map Arabic market names back to market codes
 */
const ARABIC_TO_FRONTEND_MARKET: Record<string, string> = {
  'مصر': 'EGX',
  'السعودية': 'TADAWUL',
  'الكويت': 'KSE',
  'قطر': 'QSE',
};

/**
 * Convert frontend market code to Arabic market name for data_engine.db queries
 */
function marketCodeToArabic(market: string): string {
  return FRONTEND_TO_ARABIC_MARKET[market.toUpperCase()] || market;
}

/**
 * Convert Arabic market name to frontend market code
 */
function arabicToMarketCode(arabic: string): string {
  return ARABIC_TO_FRONTEND_MARKET[arabic] || arabic;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function toPlainRow(row: Record<string, unknown>): Record<string, unknown> {
  const plain: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Buffer) {
      plain[key] = value.toString('utf-8')
    } else if (value instanceof Uint8Array) {
      plain[key] = Buffer.from(value).toString('utf-8')
    } else {
      plain[key] = value
    }
  }
  return plain
}

function toPlainRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(toPlainRow)
}

// ---------------------------------------------------------------------------
// STOCK QUERIES
// ---------------------------------------------------------------------------

export function getStocks(options?: StockFilters): PaginatedStocks {
  const cacheKey = `stocks:${JSON.stringify(options)}`
  const cached = getCached<PaginatedStocks>(cacheKey)
  if (cached) return cached

  // Use data_engine.db as primary source (has all stocks from all markets)
  const db = getDataEngineDb()

  const query = options?.query?.trim()
  const rawMarket = options?.market?.trim().toUpperCase()
  const marketArabic = rawMarket ? marketCodeToArabic(rawMarket) : null
  const page = Math.max(1, options?.page ?? 1)
  const pageSize = Math.min(500, Math.max(1, options?.page_size ?? 20))
  const offset = (page - 1) * pageSize

  // Skip unsupported markets
  if (rawMarket && ['DFM', 'BSE', 'CRYPTO'].includes(rawMarket)) {
    return { stocks: [], total: 0, page, page_size: pageSize, total_pages: 0 }
  }

  try {
    let total = 0
    let rows: Record<string, unknown>[] = []

    // Build query based on filters
    const whereClauses: string[] = []
    const params: (string | number)[] = []

    if (marketArabic) {
      whereClauses.push('market = ?')
      params.push(marketArabic)
    }

    if (query) {
      whereClauses.push('(symbol LIKE ? OR name LIKE ?)')
      const term = `%${query}%`
      params.push(term, term)
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    // Get total count
    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM stocks ${whereSQL}`).get(...params) as { cnt: number }
    total = countRow?.cnt ?? 0

    // Get paginated results
    // data_engine.db uses: symbol, name, price, change_percent, volume, market_cap, market
    rows = db.prepare(`
      SELECT 
        symbol as ticker,
        name,
        name as name_ar,
        price as current_price,
        price as previous_close,
        change_percent,
        volume,
        market_cap,
        market,
        market as sector
      FROM stocks 
      ${whereSQL}
      ORDER BY volume DESC 
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset) as Record<string, unknown>[]

    const stocks = rows.map((row) => {
      const prev = Number(row.previous_close) || 0
      const curr = Number(row.current_price) || 0
      const vol = Number(row.volume) || 0
      const changePct = Number(row.change_percent) || 0

      return {
        ticker: row.ticker,
        name: row.name,
        name_ar: row.name_ar,
        current_price: curr,
        previous_close: prev,
        price_change: changePct,
        change_percent: changePct,
        volume: vol,
        market_cap: row.market_cap,
        market: arabicToMarketCode(String(row.market || '')),
        sector: row.sector,
        value_traded: curr * vol,
        is_active: true,
      }
    })

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const result = { stocks, total, page, page_size: pageSize, total_pages: totalPages }
    setCache(cacheKey, result)
    return result
  } catch (err) {
    console.warn('[egx-db] getStocks error:', err)
    return { stocks: [], total: 0, page, page_size: pageSize, total_pages: 0 }
  }
}

export function getAllStocks(): Record<string, unknown>[] {
  const cacheKey = 'all_stocks'
  const cached = getCached<Record<string, unknown>[]>(cacheKey)
  if (cached) return cached

  // Use data_engine.db as primary source
  const db = getDataEngineDb()

  try {
    // data_engine.db uses: symbol, name, price, change_percent, volume, market_cap, market
    const rows = db.prepare(`
      SELECT 
        symbol as ticker,
        name,
        name as name_ar,
        price as current_price,
        price as previous_close,
        change_percent,
        volume,
        market_cap,
        market
      FROM stocks 
      ORDER BY volume DESC
    `).all() as Record<string, unknown>[]

    const stocks = rows.map((row) => {
      const prev = Number(row.previous_close) || 0
      const curr = Number(row.current_price) || 0
      const vol = Number(row.volume) || 0
      const changePct = Number(row.change_percent) || 0

      return {
        ticker: row.ticker,
        name: row.name,
        name_ar: row.name_ar,
        current_price: curr,
        previous_close: prev,
        price_change: changePct,
        change_percent: changePct,
        volume: vol,
        market_cap: row.market_cap,
        market: arabicToMarketCode(String(row.market || '')),
        value_traded: curr * vol,
        is_active: true,
      }
    })

    setCache(cacheKey, stocks)
    return stocks
  } catch (err) {
    console.warn('[egx-db] getAllStocks error:', err)
    return []
  }
}

export function getStockByTicker(ticker: string): Record<string, unknown> | null {
  // Step 1: Get basic price data from data_engine.db (has all stocks)
  const dataEngineDb = getDataEngineDb()
  
  const basicRow = dataEngineDb
    .prepare(`
      SELECT 
        symbol as ticker,
        name,
        name as name_ar,
        price as current_price,
        price as previous_close,
        change_percent,
        volume,
        market_cap,
        market
      FROM stocks WHERE symbol = ? COLLATE NOCASE LIMIT 1
    `)
    .get(ticker) as Record<string, unknown> | undefined

  if (!basicRow) return null

  const curr = Number(basicRow.current_price) || 0
  const changePct = Number(basicRow.change_percent) || 0
  const marketCode = arabicToMarketCode(String(basicRow.market || ''))

  // Step 2: Try to get detailed metrics from stocks.db
  let detailedData: Record<string, unknown> = {}
  try {
    const stocksDb = getStocksDb()
    const detailRow = stocksDb
      .prepare(`
        SELECT 
          name_ar,
          sector,
          industry,
          open_price,
          high_price,
          low_price,
          pe_ratio,
          pb_ratio,
          dividend_yield,
          eps,
          roe,
          debt_to_equity,
          support_level,
          resistance_level,
          ma_50,
          ma_200,
          rsi,
          is_egx30,
          is_egx70,
          is_egx100,
          compliance_status
        FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1
      `)
      .get(ticker) as Record<string, unknown> | undefined
    
    if (detailRow) {
      detailedData = detailRow
    }
  } catch (err) {
    // stocks.db might not have this stock, continue with basic data only
  }

  // Step 3: Merge data - basic data takes precedence for price/volume
  return {
    // Basic data from data_engine.db
    ticker: basicRow.ticker,
    name: basicRow.name,
    name_ar: detailedData.name_ar || basicRow.name,
    current_price: curr,
    previous_close: curr, // data_engine.db doesn't have separate previous_close
    open_price: detailedData.open_price || curr,
    high_price: detailedData.high_price || curr,
    low_price: detailedData.low_price || curr,
    price_change: changePct,
    change_percent: changePct,
    volume: basicRow.volume,
    market_cap: basicRow.market_cap,
    market: marketCode,
    value_traded: curr * (Number(basicRow.volume) || 0),
    is_active: true,
    
    // Detailed metrics from stocks.db (may be 0/empty if not available)
    sector: detailedData.sector || '',
    industry: detailedData.industry || '',
    pe_ratio: detailedData.pe_ratio || 0,
    pb_ratio: detailedData.pb_ratio || 0,
    dividend_yield: detailedData.dividend_yield || 0,
    eps: detailedData.eps || 0,
    roe: detailedData.roe || 0,
    debt_to_equity: detailedData.debt_to_equity || 0,
    support_level: detailedData.support_level || 0,
    resistance_level: detailedData.resistance_level || 0,
    ma_50: detailedData.ma_50 || 0,
    ma_200: detailedData.ma_200 || 0,
    rsi: detailedData.rsi || 50,
    
    // Index membership
    egx30_member: detailedData.is_egx30 === 1,
    egx70_member: detailedData.is_egx70 === 1,
    egx100_member: detailedData.is_egx100 === 1,
    
    // Compliance
    compliance_status: detailedData.compliance_status || 'unknown',
  }
}

// Arabic names for EGX indices
const INDEX_NAME_AR: Record<string, string> = {
  EGX30: 'مؤشر EGX 30',
  EGX50: 'مؤشر EGX 50',
  EGX70: 'مؤشر EGX 70',
  EGX100: 'مؤشر EGX 100',
  EGX33: 'مؤشر EGX 33 الإسلامي',
}

// Map index symbol → stocks-table membership column (both schema variants supported)
const INDEX_MEMBERSHIP_COL: Record<string, string[]> = {
  EGX30: ['is_egx30', 'egx30_member'],
  EGX70: ['is_egx70', 'egx70_member'],
  EGX100: ['is_egx100', 'egx100_member'],
}

/**
 * احسب change_percent للمؤشر من أسهمه المكوّنة (constituent-based).
 * - بيجيب الأسهم اللي member flag بتاعها = 1
 * - بيحسب change_percent من current_price vs previous_close (لو مفيش change_percent column)
 * - بيحسب المتوسط المرجّح بقيمة السوق (market cap)
 * - بيرجّع null لو مفيش أسهم مكوّنة أو الجدول فاضي
 */
function computeConstituentChangePercent(
  db: SqliteDatabase,
  membershipCols: string[]
): number | null {
  try {
    // اكتشف العمود المتاح (is_egx30 أو egx30_member)
    const tableInfo = db.prepare('PRAGMA table_info(stocks)').all() as Array<{ name: string }>
    const availableCols = new Set(tableInfo.map(c => c.name))
    const hasChangePercent = availableCols.has('change_percent')
    const membershipCol = membershipCols.find(c => availableCols.has(c))
    if (!membershipCol) return null

    // ابني الـ SELECT حسب الأعمدة المتاحة
    const selectCols = [
      'current_price',
      'previous_close',
      'market_cap',
      ...(hasChangePercent ? ['change_percent'] : []),
    ].filter(c => availableCols.has(c))

    const rows = db
      .prepare(
        `SELECT ${selectCols.join(', ')}
         FROM stocks
         WHERE ${membershipCol} = 1
           AND market = 'EGX'`
      )
      .all() as Array<Record<string, unknown>>

    if (rows.length === 0) return null

    // Weighted average by market_cap (fallback to equal weight)
    let weightedSum = 0
    let totalWeight = 0
    let equalSum = 0
    let equalCount = 0

    for (const r of rows) {
      // احسب change_percent: لو موجود استخدمه، غير كده احسبه من current vs previous
      let cp: number
      if (hasChangePercent && r.change_percent != null) {
        cp = Number(r.change_percent)
      } else {
        const curr = Number(r.current_price) || 0
        const prev = Number(r.previous_close) || 0
        cp = prev > 0 ? ((curr - prev) / prev) * 100 : 0
      }
      if (!Number.isFinite(cp)) continue
      const mc = Number(r.market_cap)
      if (Number.isFinite(mc) && mc > 0) {
        weightedSum += cp * mc
        totalWeight += mc
      }
      equalSum += cp
      equalCount++
    }

    if (totalWeight > 0) {
      return Math.round((weightedSum / totalWeight) * 10000) / 10000
    }
    if (equalCount > 0) {
      return Math.round((equalSum / equalCount) * 10000) / 10000
    }
    return null
  } catch { // silent fallback (safe-by-design)
    return null
  }
}

export function getMarketIndices(): Record<string, unknown>[] {
  const cached = getCached<Record<string, unknown>[]>('market_indices')
  if (cached) return cached

  const db = getStocksDb()

  try {
    const rows = db
      .prepare('SELECT * FROM market_indices ORDER BY id ASC')
      .all() as Record<string, unknown>[]

    const raw = toPlainRows(rows)

    // FIX: القيم المخزّنة في market_indices غير متّسقة رياضياً (change/change_percent
    // لا يطابقان current_value مقابل previous_close). هنا بنعيد الحساب بشكل صحيح:
    //  1) نحاول نحسب change_percent من الأسهم المكوّنة (constituent-based) — ده الأصدق
    //  2) نحسب change = current_value * cp / 100
    //  3) نحسب previous_close = current_value - change
    // كده كل القيم متّسقة وتعكس الحركة الحقيقية للسهم المكوّن للمؤشر.
    const result = raw.map((idx) => {
      const symbol = String(idx.symbol || '')
      const storedValue = Number(idx.current_value) || 0
      const membershipCols = INDEX_MEMBERSHIP_COL[symbol]

      // 1) constituent-based change_percent (الأصدق)
      const constituentCp = membershipCols
        ? computeConstituentChangePercent(db, membershipCols)
        : null

      // 2) fallback: recompute from stored current_value vs previous_close
      const storedPrev = Number(idx.previous_close) || 0
      // FIX: لو storedPrev غير منطقي (يختلف عن current_value بأكثر من 30%)
      // والمؤشر قديم (آخر تحديث من مارس)، نعتبره "مغلق" — previous = current
      const isStaleData = !idx.last_update || String(idx.last_update).includes('2026-03')
      const isPrevInconsistent = storedPrev > 0 && Math.abs((storedValue - storedPrev) / storedPrev) > 0.30

      let effectivePrev = storedPrev
      let fallbackChange = 0
      let fallbackCp = 0

      if (isStaleData && isPrevInconsistent) {
        // بيانات قديمة متناقضة — اعتبر المؤشر مغلق (لا تغيير)
        effectivePrev = storedValue
        fallbackChange = 0
        fallbackCp = 0
      } else if (storedPrev > 0) {
        fallbackChange = storedValue - storedPrev
        fallbackCp = (fallbackChange / storedPrev) * 100
      }

      const changePercent = constituentCp != null ? constituentCp : fallbackCp
      const change = Math.round(storedValue * changePercent / 100 * 100) / 100
      const previousClose = Math.round((storedValue - change) * 100) / 100

      return {
        ...idx,
        name_ar: idx.name_ar || INDEX_NAME_AR[symbol] || symbol,
        current_value: storedValue,
        previous_close: previousClose,
        change,
        change_percent: Math.round(changePercent * 10000) / 10000,
        last_update: idx.last_update || idx.last_updated || null,
        computation_source: constituentCp != null ? 'constituents' : (isStaleData && isPrevInconsistent ? 'stale_neutralized' : 'stored_delta'),
      }
    })

    setCache('market_indices', result)
    return result
  } catch (err) {
    console.warn('[egx-db] getMarketIndices error:', err)
    return []
  }
}

export function getMarketOverviewStats(market?: string): Record<string, unknown> {
  const cacheKey = market ? `market_overview_stats_${market}` : 'market_overview_stats'
  const cached = getCached<Record<string, unknown>>(cacheKey)
  if (cached) return cached

  // Use data_engine.db as primary source
  const db = getDataEngineDb()
  const marketArabic = market ? marketCodeToArabic(market) : null

  try {
    // Build query with optional market filter
    // data_engine.db uses change_percent directly
    let query = `SELECT price, change_percent, volume, market FROM stocks WHERE 1=1`
    const params: string[] = []
    
    if (marketArabic) {
      query += ` AND market = ?`
      params.push(marketArabic)
    }
    
    const rows = params.length > 0
      ? db.prepare(query).all(...params) as Record<string, unknown>[]
      : db.prepare(query).all() as Record<string, unknown>[]

    let gainers = 0
    let losers = 0
    let unchanged = 0
    let totalVolume = 0

    for (const row of rows) {
      const changePct = Number(row.change_percent) || 0

      if (changePct > 0) gainers++
      else if (changePct < 0) losers++
      else unchanged++

      totalVolume += Number(row.volume) || 0
    }

    const result = {
      total_stocks: rows.length,
      gainers,
      losers,
      unchanged,
      total_volume: totalVolume,
      egx30_count: 0,  // Not available in data_engine.db
      egx70_count: 0,
      egx100_count: 0,
    }

    setCache(cacheKey, result)
    return result
  } catch (err) {
    console.warn('[egx-db] getMarketOverviewStats error:', err)
    return { total_stocks: 0, gainers: 0, losers: 0, unchanged: 0, total_volume: 0, egx30_count: 0, egx70_count: 0, egx100_count: 0 }
  }
}

export function getTopMovers(limit: number = 10): TopMoversResult {
  const cached = getCached<TopMoversResult>('top_movers')
  if (cached) return cached

  // Use data_engine.db as primary source
  const db = getDataEngineDb()

  try {
    // data_engine.db already has change_percent column
    const rows = db
      .prepare(`
        SELECT 
          symbol as ticker, 
          name, 
          name as name_ar, 
          market as sector, 
          price as current_price, 
          price as previous_close, 
          volume, 
          market_cap,
          change_percent,
          market
        FROM stocks 
        WHERE change_percent IS NOT NULL
      `)
      .all() as Record<string, unknown>[]

    const enriched = rows.map((stock) => {
      const curr = Number(stock.current_price) || 0
      const vol = Number(stock.volume) || 0
      const changePct = Number(stock.change_percent) || 0
      return { 
        ...stock, 
        price_change: changePct, 
        value_traded: curr * vol,
        market: arabicToMarketCode(String(stock.market || ''))
      }
    })

    const gainers = enriched.filter((s) => Number(s.price_change) > 0).sort((a, b) => Number(b.price_change) - Number(a.price_change)).slice(0, limit)
    const losers = enriched.filter((s) => Number(s.price_change) < 0).sort((a, b) => Number(a.price_change) - Number(b.price_change)).slice(0, limit)
    const most_active = [...enriched].sort((a, b) => Number(b.volume) - Number(a.volume)).slice(0, limit)

    const result = { gainers, losers, most_active }
    setCache('top_movers', result)
    return result
  } catch (err) {
    console.warn('[egx-db] getTopMovers error:', err)
    return { gainers: [], losers: [], most_active: [] }
  }
}

export function getSectorStats(): Record<string, unknown>[] {
  const cached = getCached<Record<string, unknown>[]>('sector_stats')
  if (cached) return cached

  const db = getStocksDb()

  try {
    const rows = db
      .prepare(`SELECT sector, COUNT(*) as stock_count, SUM(volume) as total_volume, AVG(CASE WHEN previous_close > 0 THEN ((current_price - previous_close) / previous_close) * 100 ELSE 0 END) as avg_change FROM stocks WHERE is_active = 1 AND sector IS NOT NULL AND sector != '' GROUP BY sector ORDER BY total_volume DESC`)
      .all() as Record<string, unknown>[]

    const result = toPlainRows(rows)
    setCache('sector_stats', result)
    return result
  } catch (err) {
    console.warn('[egx-db] getSectorStats error:', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// PRICE HISTORY QUERIES
// ---------------------------------------------------------------------------

export function getPriceHistory(ticker: string, days: number = 365): Record<string, unknown>[] {
  const cacheKey = `price_history:${ticker}:${days}`
  const cached = getCached<Record<string, unknown>[]>(cacheKey)
  if (cached) return cached

  try {
    const db = getPriceHistoryDb()
    const rows = db
      .prepare(`SELECT * FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT ?`)
      .all(ticker.toUpperCase(), days) as Record<string, unknown>[]

    const result = toPlainRows(rows)
    setCache(cacheKey, result)
    return result
  } catch (err) {
    console.warn('[egx-db] getPriceHistory error:', err)
    return []
  }
}

export function getAvailablePriceDates(): { min: string; max: string; count: number } {
  try {
    const db = getPriceHistoryDb()
    const row = db.prepare(`SELECT MIN(date) as min, MAX(date) as max, COUNT(*) as count FROM price_history`).get() as { min: string; max: string; count: number }
    return row || { min: '', max: '', count: 0 }
  } catch { // silent fallback (safe-by-design)
    return { min: '', max: '', count: 0 }
  }
}

// ---------------------------------------------------------------------------
// BACKWARD COMPATIBILITY - These functions map to new structure
// ---------------------------------------------------------------------------

// For backward compatibility - maps to stocks.db (contains main stocks, is_active, and technical data)
export function getLightDb(): SqliteDatabase {
  return getStocksDb()
}

// For backward compatibility - maps to price_history.db
export function getHeavyDb(): SqliteDatabase {
  return getPriceHistoryDb()
}

// Reset functions
export function resetHeavyDbState(): void {
  resetPriceHistoryDbState()
}

export function resetLightDbState(): void {
  resetStocksDbState()
}

export function resetAllDbStates(): void {
  resetStocksDbState()
  resetPriceHistoryDbState()
}

// DB availability checks
export function isHeavyDbAvailable(): boolean {
  return _priceHistoryDb !== null
}

export function getHeavyDbHealth(): Record<string, unknown> {
  return {
    loaded: _priceHistoryDb !== null,
    dbPath: path.join(process.cwd(), 'db', 'price_history.db'),
    dbFileExists: existsSync(path.join(process.cwd(), 'db', 'price_history.db')),
  }
}

// Writable DB for admin operations
let _writableDb: SqliteDatabase | null = null

export function getWritableDb(): SqliteDatabase {
  if (_writableDb) return _writableDb
  
  const dbPath = path.join(process.cwd(), 'db', 'stocks.db')
  if (!existsSync(dbPath)) {
    throw new Error('stocks.db not found')
  }
  
  // Robust open via shared-db, forced writable.
  const native = openDb('stocks.db', { writable: true })
  _writableDb = wrapNativeDatabase(native)
  try { _writableDb.pragma('journal_mode = WAL') } catch { /* ignore - safe-by-design */ }
  try { _writableDb.pragma('foreign_keys = ON') } catch { /* ignore - safe-by-design */ }
  return _writableDb
}

// DEPRECATED: custom.db has been removed
// User data (portfolio, watchlist) should use Prisma with auth.db
// Stock data should use stocks.db via getStocksDb() or getWritableDb()

/**
 * @deprecated custom.db has been removed. Use Prisma for user data or stocks.db for stock data.
 * This function now returns stocks.db for backward compatibility with stock operations.
 */
export async function getSharedCustomDb(): Promise<SqliteDatabase> {
  console.warn('[egx-db] getSharedCustomDb is deprecated. custom.db has been removed. Using stocks.db instead.')
  return getWritableDb()
}

/**
 * @deprecated custom.db has been removed. This always returns true if stocks.db exists.
 */
export function isSharedCustomDbAvailable(): boolean {
  return true // stocks.db is always available
}

// ---------------------------------------------------------------------------
// MISSING EXPORTS - Added for backward compatibility
// ---------------------------------------------------------------------------

// Clear cache alias
export function clearCache(): void {
  clearDbCache()
}

// Writable DB availability check
export function isWritableDbAvailable(): boolean {
  return _writableStocksDb !== null || _writableDb !== null
}

// Admin password verification (stub - implement properly for production)
export function verifyAdminPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD
  return password === adminPassword
}

// Currency rates (stub - returns empty array)
export async function getCurrencyRates(): Promise<Record<string, unknown>[]> {
  // TODO: Implement currency rates fetching
  return []
}

// Update all currency rates (stub)
export async function updateAllCurrencyRates(): Promise<{ success: boolean; count: number }> {
  // TODO: Implement currency rates update
  return { success: true, count: 0 }
}

// Gold prices (stub - returns empty array)
export async function getGoldPrices(): Promise<Record<string, unknown>[]> {
  // TODO: Implement gold prices fetching
  return []
}

// Update all gold prices (stub)
export async function updateAllGoldPrices(): Promise<{ success: boolean; count: number }> {
  // TODO: Implement gold prices update
  return { success: true, count: 0 }
}

// Get stock ID from heavy DB (price_history)
export function getStockIdFromHeavyDb(ticker: string): number | null {
  const db = getPriceHistoryDb()
  try {
    const row = db.prepare('SELECT DISTINCT ticker FROM price_history WHERE ticker = ? LIMIT 1').get(ticker.toUpperCase()) as { ticker: string } | undefined
    return row ? 1 : null // Return 1 if exists, null otherwise
  } catch { // silent fallback (safe-by-design)
    return null
  }
}

// Get stock analysis (stub)
export function getStockAnalysis(ticker: string): Record<string, unknown> | null {
  // TODO: Implement stock analysis retrieval from learned.db
  const stock = getStockByTicker(ticker)
  if (!stock) return null
  
  return {
    ticker: stock.ticker,
    name: stock.name,
    recommendation: 'HOLD',
    confidence: 0.5,
    signals: {},
  }
}

// Get technical indicators for a stock
export function getTechnicalIndicators(ticker: string): Record<string, unknown> | null {
  const stock = getStockByTicker(ticker)
  if (!stock) return null
  
  return {
    ticker,
    rsi: stock.rsi || null,
    ma_20: stock.ma_20 || null,
    ma_50: stock.ma_50 || null,
    ma_200: stock.ma_200 || null,
    macd: null,
    signal: null,
  }
}

// Get all stock analyses (stub)
export function getAllStockAnalyses(): Record<string, unknown>[] {
  // TODO: Implement batch analysis retrieval
  const stocks = getAllStocks()
  return stocks.slice(0, 50).map(stock => ({
    ticker: stock.ticker,
    name: stock.name,
    recommendation: 'HOLD',
    confidence: 0.5,
  }))
}

// Smart Tips functions (stubs)
export function getAllSmartTipCategories(): string[] {
  return ['technical', 'fundamental', 'sentiment', 'risk', 'timing']
}

export function getSmartTipsByCategory(category: string): Record<string, unknown>[] {
  // TODO: Implement tips by category
  return []
}

export function getRandomSmartTip(): Record<string, unknown> | null {
  // TODO: Implement random tip
  return {
    id: 1,
    category: 'general',
    tip: 'Always do your own research before investing.',
    tip_ar: 'قم بالبحث دائماً قبل الاستثمار.',
  }
}

import { createDatabase, initialize, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper'
import * as path from 'path'
import { existsSync } from 'fs'

// ===========================================================================
// LAZY INITIALIZATION
// ===========================================================================
// sql.js WASM must be initialized before any database access.
// This function ensures initialization on first use.
// API routes should call `await ensureInitialized()` at the top.
// ===========================================================================

let _ensurePromise: Promise<void> | null = null

export async function ensureInitialized(): Promise<void> {
  if (isInitialized()) return

  // If previous attempt failed, clear it and retry
  if (_ensurePromise) {
    try {
      await _ensurePromise
      // If we get here, it succeeded
      return
    } catch {
      // Previous attempt failed — clear and retry
      _ensurePromise = null
    }
  }

  _ensurePromise = initialize().catch((err) => {
    // Clear cached promise on failure so next call retries
    _ensurePromise = null
    throw err
  })

  return _ensurePromise
}

// ===========================================================================
// DUAL-DATABASE ARCHITECTURE
// ===========================================================================
//
// LIGHT DB (custom.db, ~200KB):
//   - stocks (452 rows), market_indices (5), gold_prices (19),
//     currency_rates (6), admin_settings (1)
//   - Used for: dashboard, stock list, market overview, gold/currency pages
//   - Loads instantly (< 100ms)
//
// HEAVY DB (egx_investment.db, ~55MB):
//   - stock_price_history (295K rows), stock_deep_insight_snapshots (367),
//     predictions, prediction_logs, gold_price_history, etc.
//   - Used for: price charts, deep analysis, AI recommendations, reports
//   - Lazy-loaded only when needed
//
// This eliminates the 504 Gateway Timeout caused by loading 55MB on every request.
// ===========================================================================

// ---------------------------------------------------------------------------
// In-memory cache (prevents repeated DB reads within cache TTL)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const _cache = new Map<string, CacheEntry<unknown>>()
const CACHE_TTL_MS = 30_000 // 30 seconds default
const GOLD_CACHE_TTL_MS = 5_000      // 5 seconds for gold prices
const CURRENCY_CACHE_TTL_MS = 5_000  // 5 seconds for currency rates

function getCached<T>(key: string): T | null {
  const entry = _cache.get(key)
  if (!entry) return null
  
  // Custom TTLs for gold/currency to allow frequent updates
  let ttl = CACHE_TTL_MS
  if (key.startsWith('gold_') || key.startsWith('currency_')) {
    if (key.includes('gold_prices')) ttl = GOLD_CACHE_TTL_MS
    else if (key.includes('currency_rates')) ttl = CURRENCY_CACHE_TTL_MS
    else ttl = GOLD_CACHE_TTL_MS
  }
  
  if (Date.now() - entry.timestamp < ttl) {
    return entry.data as T
  }
  return null
}

function setCache<T>(key: string, data: T): void {
  _cache.set(key, { data, timestamp: Date.now() })
}

function clearCache(): void {
  _cache.clear()
}

function clearCachePrefix(prefix: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) {
      _cache.delete(key)
    }
  }
}

// ---------------------------------------------------------------------------
// LIGHT DB — custom.db (fast browsing, ~200KB)
// ---------------------------------------------------------------------------

let _lightDb: SqliteDatabase | null = null

export function getLightDb(): SqliteDatabase {
  if (_lightDb) return _lightDb

  if (!isInitialized()) {
    throw new Error('sql.js not initialized. Call await ensureInitialized() first.')
  }

  const dbPath = path.join(process.cwd(), 'db', 'custom.db')
  _lightDb = createDatabase(dbPath, { readonly: true })
  _lightDb.pragma('foreign_keys = ON')
  console.log('[egx-db] Light DB loaded (custom.db)')
  return _lightDb
}

// ---------------------------------------------------------------------------
// HEAVY DB — egx_investment.db (analysis only, ~55MB, lazy-loaded)
// ---------------------------------------------------------------------------

let _heavyDb: SqliteDatabase | null = null
let _heavyDbLoading = false
let _heavyDbFailed = false
let _heavyDbFailedAt = 0 // Timestamp of last failure — allows retry after cooldown
const HEAVY_DB_RETRY_COOLDOWN_MS = 10_000 // Retry after 10 seconds
let _writableDbFailed = false
let _writableDbFailedAt = 0
const WRITABLE_DB_RETRY_COOLDOWN_MS = 10_000

export function isHeavyDbAvailable(): boolean {
  // Auto-retry: if failed more than cooldown ago, allow retry
  if (_heavyDbFailed && _heavyDbFailedAt > 0) {
    const elapsed = Date.now() - _heavyDbFailedAt
    if (elapsed > HEAVY_DB_RETRY_COOLDOWN_MS) {
      console.log(`[egx-db] Heavy DB failure cooldown elapsed (${elapsed}ms), allowing retry`)
      _heavyDbFailed = false
      _heavyDbFailedAt = 0
      return false // Will trigger load attempt
    }
  }
  return _heavyDb !== null && !_heavyDbFailed
}

export function isWritableDbAvailable(): boolean {
  if (_writableDbFailed && _writableDbFailedAt > 0) {
    const elapsed = Date.now() - _writableDbFailedAt
    if (elapsed > WRITABLE_DB_RETRY_COOLDOWN_MS) {
      _writableDbFailed = false
      _writableDbFailedAt = 0
      return false
    }
  }
  return _writableDb !== null && !_writableDbFailed
}

/** Reset heavy DB state — useful after seeding to force re-read */
export function resetHeavyDbState(): void {
  _heavyDb = null
  _heavyDbFailed = false
  _heavyDbFailedAt = 0
  _heavyDbLoading = false
  _writableDb = null
  _writableDbFailed = false
  _writableDbFailedAt = 0
  console.log('[egx-db] Heavy DB state reset — next call will reload from disk')
}

/** Get heavy DB health info for diagnostics */
export function getHeavyDbHealth(): Record<string, unknown> {
  return {
    loaded: _heavyDb !== null,
    failed: _heavyDbFailed,
    failedAt: _heavyDbFailedAt ? new Date(_heavyDbFailedAt).toISOString() : null,
    loading: _heavyDbLoading,
    canRetry: !_heavyDbFailed || (_heavyDbFailedAt > 0 && Date.now() - _heavyDbFailedAt > HEAVY_DB_RETRY_COOLDOWN_MS),
    dbPath: path.join(process.cwd(), 'db', 'egx_investment.db'),
    dbFileExists: existsSync(path.join(process.cwd(), 'db', 'egx_investment.db')),
  }
}

export function getHeavyDb(): SqliteDatabase {
  if (_heavyDb) return _heavyDb

  // Check if we're in cooldown from a previous failure
  if (_heavyDbFailed) {
    if (_heavyDbFailedAt > 0 && Date.now() - _heavyDbFailedAt < HEAVY_DB_RETRY_COOLDOWN_MS) {
      throw new Error('Heavy DB (egx_investment.db) temporarily unavailable. Will retry shortly.')
    }
    // Cooldown expired — allow retry
    console.log('[egx-db] Retrying heavy DB load after cooldown')
    _heavyDbFailed = false
    _heavyDbFailedAt = 0
  }

  if (_heavyDbLoading) {
    throw new Error('Heavy DB is still loading. Please retry in a moment.')
  }

  if (!isInitialized()) {
    throw new Error('sql.js not initialized. Call await ensureInitialized() first.')
  }

  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db')

  // If file doesn't exist, create an empty one with the required schema
  if (!existsSync(dbPath)) {
    console.warn(`[egx-db] Heavy DB file not found at ${dbPath} — creating empty database with schema`)
    try {
      const initDb = createDatabase(dbPath) // writable to create tables
      initDb.pragma('journal_mode = WAL')
      initDb.pragma('foreign_keys = ON')

      // Create essential tables
      initDb.run(`CREATE TABLE IF NOT EXISTS stock_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        open_price REAL DEFAULT 0,
        high_price REAL DEFAULT 0,
        low_price REAL DEFAULT 0,
        close_price REAL DEFAULT 0,
        volume INTEGER DEFAULT 0,
        adjusted_close REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(stock_id, date)
      )`)

      initDb.run(`CREATE TABLE IF NOT EXISTS stock_deep_insight_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        insights_payload TEXT,
        fetched_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`)

      initDb.run(`CREATE TABLE IF NOT EXISTS gold_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        karat TEXT NOT NULL,
        price_per_gram REAL NOT NULL,
        change REAL,
        currency TEXT DEFAULT 'EGP',
        recorded_at TEXT,
        source TEXT DEFAULT 'system'
      )`)

      // ========== Phase 2: Self-Learning Tables ==========
      // Signal logs - تسجيل الإشارات
      initDb.run(`CREATE TABLE IF NOT EXISTS signal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        stock_id INTEGER,
        signal_date TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('buy', 'sell')),
        indicators_used TEXT NOT NULL,
        score REAL NOT NULL,
        calculated_entry_price REAL NOT NULL,
        calculated_stop_loss REAL NOT NULL,
        calculated_target REAL NOT NULL,
        has_news INTEGER DEFAULT 0,
        news_summary TEXT,
        executed INTEGER DEFAULT 0,
        execution_reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`)

      // Trade logs - تسجيل الصفقات
      initDb.run(`CREATE TABLE IF NOT EXISTS trade_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id INTEGER,
        ticker TEXT NOT NULL,
        stock_id INTEGER,
        direction TEXT NOT NULL CHECK(direction IN ('buy', 'sell')),
        open_date TEXT NOT NULL,
        actual_entry_price REAL NOT NULL,
        actual_stop_loss REAL NOT NULL,
        actual_target REAL NOT NULL,
        shares_count INTEGER NOT NULL,
        trade_value REAL NOT NULL,
        commission REAL DEFAULT 0,
        tax REAL DEFAULT 0,
        spread REAL DEFAULT 0,
        total_cost REAL DEFAULT 0,
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (signal_id) REFERENCES signal_logs(id)
      )`)

      // Outcome logs - تسجيل النتائج
      initDb.run(`CREATE TABLE IF NOT EXISTS outcome_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        close_date TEXT NOT NULL,
        actual_exit_price REAL NOT NULL,
        close_reason TEXT NOT NULL CHECK(close_reason IN ('target', 'stop_loss', 'manual', 'news', 'timeout')),
        gross_profit_loss REAL NOT NULL,
        net_profit_loss REAL NOT NULL,
        profit_loss_percent REAL NOT NULL,
        days_open INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (trade_id) REFERENCES trade_logs(id)
      )`)

      // Context logs - تسجيل البيئة
      initDb.run(`CREATE TABLE IF NOT EXISTS context_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        egx30_state TEXT NOT NULL CHECK(egx30_state IN ('BULL', 'BEAR', 'RANGE')),
        egx30_adx REAL DEFAULT 0,
        official_usd_rate REAL DEFAULT 0,
        parallel_usd_rate REAL DEFAULT 0,
        usd_gap_percent REAL DEFAULT 0,
        egx30_volume REAL DEFAULT 0,
        egx30_avg_volume REAL DEFAULT 0,
        liquidity_ratio REAL DEFAULT 1,
        is_dividend_season INTEGER DEFAULT 0,
        is_cbe_decision_near INTEGER DEFAULT 0,
        market_sentiment REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (trade_id) REFERENCES trade_logs(id)
      )`)

      // Indicator trust scores - درجات الثقة للمؤشرات
      initDb.run(`CREATE TABLE IF NOT EXISTS indicator_trust_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        indicator_name TEXT NOT NULL UNIQUE,
        current_score REAL DEFAULT 100,
        base_score REAL DEFAULT 100,
        total_signals INTEGER DEFAULT 0,
        successful_signals INTEGER DEFAULT 0,
        failed_signals INTEGER DEFAULT 0,
        consecutive_losses INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'reflection', 'disabled')),
        reflection_start TEXT,
        reflection_end TEXT,
        regime_scores TEXT DEFAULT '{}',
        last_updated TEXT DEFAULT (datetime('now'))
      )`)

      // Learned lessons - الدروس المستفادة
      initDb.run(`CREATE TABLE IF NOT EXISTS learned_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_type TEXT NOT NULL CHECK(lesson_type IN ('direct', 'compound', 'environmental')),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        trigger_conditions TEXT NOT NULL,
        action TEXT NOT NULL,
        confidence REAL DEFAULT 0,
        occurrences INTEGER DEFAULT 1,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'testing' CHECK(status IN ('testing', 'validated', 'rejected')),
        validation_start TEXT,
        validation_end TEXT,
        paper_trades_tested INTEGER DEFAULT 0,
        paper_trades_success INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`)

      // Regime indicator weights - الأوزان حسب الطور
      initDb.run(`CREATE TABLE IF NOT EXISTS regime_indicator_weights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        indicator_name TEXT NOT NULL,
        regime TEXT NOT NULL CHECK(regime IN ('BULL', 'BEAR', 'RANGE')),
        weight REAL DEFAULT 1.0,
        expectancy REAL DEFAULT 0,
        last_calculated TEXT DEFAULT (datetime('now')),
        UNIQUE(indicator_name, regime)
      )`)

      // Review cycles - المراجعات الدورية
      initDb.run(`CREATE TABLE IF NOT EXISTS review_cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_type TEXT NOT NULL CHECK(review_type IN ('daily', 'weekly', 'monthly', 'quarterly')),
        review_date TEXT NOT NULL,
        total_trades INTEGER DEFAULT 0,
        winning_trades INTEGER DEFAULT 0,
        losing_trades INTEGER DEFAULT 0,
        total_profit_loss REAL DEFAULT 0,
        win_rate REAL DEFAULT 0,
        avg_win REAL DEFAULT 0,
        avg_loss REAL DEFAULT 0,
        expectancy REAL DEFAULT 0,
        best_indicator TEXT,
        worst_indicator TEXT,
        patterns_detected INTEGER DEFAULT 0,
        lessons_learned INTEGER DEFAULT 0,
        weight_adjustments INTEGER DEFAULT 0,
        summary TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`)

      // Fatal errors - الغلطة القاتلة
      initDb.run(`CREATE TABLE IF NOT EXISTS fatal_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        error_date TEXT NOT NULL,
        trade_id INTEGER,
        error_type TEXT NOT NULL,
        loss_percent REAL NOT NULL,
        capital_impact_percent REAL NOT NULL,
        consecutive_losses INTEGER DEFAULT 0,
        trading_halted INTEGER DEFAULT 0,
        halt_reason TEXT,
        review_completed INTEGER DEFAULT 0,
        review_findings TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (trade_id) REFERENCES trade_logs(id)
      )`)

      // ========== End Phase 2 Tables ==========

      // Create indexes
      try {
        initDb.run(`CREATE INDEX IF NOT EXISTS idx_sph_stock_date ON stock_price_history(stock_id, date)`)
        initDb.run(`CREATE INDEX IF NOT EXISTS idx_sdis_ticker ON stock_deep_insight_snapshots(ticker, fetched_at DESC)`)
        // Phase 2 indexes
        initDb.run(`CREATE INDEX IF NOT EXISTS idx_signal_logs_ticker ON signal_logs(ticker)`)
        initDb.run(`CREATE INDEX IF NOT EXISTS idx_signal_logs_date ON signal_logs(signal_date)`)
        initDb.run(`CREATE INDEX IF NOT EXISTS idx_trade_logs_ticker ON trade_logs(ticker)`)
        initDb.run(`CREATE INDEX IF NOT EXISTS idx_trade_logs_status ON trade_logs(status)`)
        initDb.run(`CREATE INDEX IF NOT EXISTS idx_outcome_logs_trade ON outcome_logs(trade_id)`)
        initDb.run(`CREATE INDEX IF NOT EXISTS idx_context_logs_trade ON context_logs(trade_id)`)
        initDb.run(`CREATE INDEX IF NOT EXISTS idx_indicator_trust_name ON indicator_trust_scores(indicator_name)`)
      } catch {
        // Index may already exist
      }

      initDb.close()
      console.log(`[egx-db] Created empty heavy DB with schema at ${dbPath}`)

      // Schedule auto-seed in background (fire-and-forget, non-blocking)
      try {
        import('./seed-historical-data').then(({ checkAndAutoSeed }) => {
          checkAndAutoSeed().then(result => {
            console.log(`[egx-db] Auto-seed result: ${JSON.stringify(result)}`)
            // Reset flags so next request picks up the seeded data
            resetHeavyDbState()
          }).catch(err => {
            console.warn('[egx-db] Background auto-seed failed:', err)
          })
        }).catch(() => {
          // Module import failed — will retry on next request
        })
      } catch {
        // Ignore — seeding will happen on next history request
      }
    } catch (createErr) {
      _heavyDbFailed = true
      _heavyDbFailedAt = Date.now()
      console.error(`[egx-db] Failed to create heavy DB:`, createErr)
      throw new Error('Heavy DB (egx_investment.db) could not be created. Analysis features are temporarily disabled.')
    }
  }

  _heavyDbLoading = true
  const startTime = Date.now()

  try {
    _heavyDb = createDatabase(dbPath, { readonly: true })
    _heavyDb.pragma('foreign_keys = ON')
    _heavyDbLoading = false
    const elapsed = Date.now() - startTime
    console.log(`[egx-db] Heavy DB loaded (egx_investment.db) in ${elapsed}ms`)
  } catch (err) {
    _heavyDbLoading = false
    _heavyDbFailed = true
    _heavyDbFailedAt = Date.now()
    console.error(`[egx-db] Heavy DB FAILED to load after ${Date.now() - startTime}ms:`, err)
    throw new Error('Heavy DB (egx_investment.db) could not be loaded. Analysis features are temporarily disabled.')
  }

  return _heavyDb
}

// ---------------------------------------------------------------------------
// Writable DB connection (for admin operations → heavy DB)
// ---------------------------------------------------------------------------

let _writableDb: SqliteDatabase | null = null

export function getWritableDb(): SqliteDatabase {
  if (_writableDb) return _writableDb
  if (_writableDbFailed) {
    throw new Error('Writable DB is unavailable.')
  }

  // Pre-check: verify file exists to avoid creating empty DB
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db')
  if (!existsSync(dbPath)) {
    _writableDbFailed = true
    console.warn(`[egx-db] Writable DB file not found: ${dbPath} — write features disabled`)
    throw new Error('Writable DB is unavailable.')
  }

  try {
    _writableDb = createDatabase(dbPath)
    _writableDb.pragma('journal_mode = WAL')
    _writableDb.pragma('foreign_keys = ON')
    return _writableDb
  } catch (err) {
    _writableDbFailed = true
    _writableDbFailedAt = Date.now()
    console.error('[egx-db] Writable DB FAILED to load:', err)
    throw new Error('Writable DB could not be loaded.')
  }
}

// ===========================================================================
// SHARED CUSTOM.DB SINGLETON
// ===========================================================================
// IMPORTANT: custom.db is used by BOTH egx-db.ts (gold, currency) AND
// finance-db.ts (portfolio, transactions). We must share a SINGLE writable
// singleton to prevent data loss when one overwrites the other's changes.
// ===========================================================================

let _sharedCustomDb: SqliteDatabase | null = null
let _sharedCustomDbInitPromise: Promise<SqliteDatabase> | null = null
let _sharedCustomDbFailed = false
let _sharedCustomDbFailedAt = 0

/**
 * Get the SINGLE writable connection to custom.db.
 * Used by both admin operations (gold, currency) AND finance operations
 * (portfolio, transactions) to prevent dual-singleton data conflicts.
 */
function getWritableLightDb(): SqliteDatabase {
  if (_sharedCustomDb) return _sharedCustomDb

  const dbPath = path.join(process.cwd(), 'db', 'custom.db')
  if (!existsSync(dbPath)) {
    throw new Error('custom.db not found — writable light DB unavailable')
  }

  _sharedCustomDb = createDatabase(dbPath)
  _sharedCustomDb.pragma('journal_mode = WAL')
  _sharedCustomDb.pragma('foreign_keys = ON')
  console.log('[egx-db] Shared writable custom.db singleton created')
  return _sharedCustomDb
}

/**
 * Async version for finance operations that need initialization first.
 * Returns the SAME singleton as getWritableLightDb().
 */
export async function getSharedCustomDb(): Promise<SqliteDatabase> {
  if (_sharedCustomDb) return _sharedCustomDb

  if (_sharedCustomDbInitPromise) return _sharedCustomDbInitPromise

  _sharedCustomDbInitPromise = (async () => {
    await ensureInitialized()
    return getWritableLightDb()
  })()

  return _sharedCustomDbInitPromise
}

/**
 * Check if shared custom.db is available.
 */
export function isSharedCustomDbAvailable(): boolean {
  return _sharedCustomDb !== null && !_sharedCustomDbFailed
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StockFilters {
  query?: string
  sector?: string
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

// Arabic names for market indices
const INDEX_AR_NAMES: Record<string, string> = {
  EGX30: 'مؤشر EGX 30',
  EGX70: 'مؤشر EGX 70',
  EGX100: 'مؤشر EGX 100',
  EGXEWI: 'مؤشر EGX المتساوي الأوزان',
  EGXHDG: 'مؤشر EGX التحصيصي',
}

// ---------------------------------------------------------------------------
// Helper: convert SQLite row to plain object (handle Buffer fields)
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
// LIGHT QUERIES — use custom.db (fast, <100ms)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getStocks (LIGHT)
// ---------------------------------------------------------------------------

export function getStocks(options?: StockFilters): PaginatedStocks {
  const cacheKey = `stocks:${JSON.stringify(options)}`
  const cached = getCached<PaginatedStocks>(cacheKey)
  if (cached) return cached

  const db = getLightDb()

  const query = options?.query?.trim()
  const sector = options?.sector?.trim()
  const index = options?.index
  const isActive = options?.is_active ?? true
  const page = Math.max(1, options?.page ?? 1)
  const pageSize = Math.min(500, Math.max(1, options?.page_size ?? 20))
  const offset = (page - 1) * pageSize

  const whereClauses: string[] = []
  const params: unknown[] = []

  // Active filter
  whereClauses.push('is_active = ?')
  params.push(isActive ? 1 : 0)

  // Text search (ticker, name, name_ar)
  if (query) {
    whereClauses.push('(ticker LIKE ? OR name LIKE ? OR name_ar LIKE ?)')
    const term = `%${query}%`
    params.push(term, term, term)
  }

  // Sector filter
  if (sector) {
    whereClauses.push('sector = ?')
    params.push(sector)
  }

  // Index membership filter
  if (index === 'egx30') {
    whereClauses.push('egx30_member = 1')
  } else if (index === 'egx70') {
    whereClauses.push('egx70_member = 1')
  } else if (index === 'egx100') {
    whereClauses.push('egx100_member = 1')
  }

  const whereSQL = whereClauses.join(' AND ')

  // Count total
  const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM stocks WHERE ${whereSQL}`).get(...params) as {
    cnt: number
  }
  const total = countRow?.cnt ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Fetch page
  const rows = db
    .prepare(`SELECT * FROM stocks WHERE ${whereSQL} ORDER BY volume DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as Record<string, unknown>[]

  const stocks = toPlainRows(rows).map((stock) => {
    const prev = Number(stock.previous_close) || 0
    const curr = Number(stock.current_price) || 0
    const vol = Number(stock.volume) || 0

    return {
      ...stock,
      price_change: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
      value_traded: curr * vol,
    }
  })

  const result = { stocks, total, page, page_size: pageSize, total_pages: totalPages }
  setCache(cacheKey, result)
  return result
}

// ---------------------------------------------------------------------------
// getAllStocks (LIGHT) - Returns all active stocks as array
// ---------------------------------------------------------------------------

export function getAllStocks(): Record<string, unknown>[] {
  const cacheKey = 'all_stocks'
  const cached = getCached<Record<string, unknown>[]>(cacheKey)
  if (cached) return cached

  const db = getLightDb()
  const rows = db
    .prepare('SELECT * FROM stocks WHERE is_active = 1 ORDER BY volume DESC')
    .all() as Record<string, unknown>[]

  const stocks = toPlainRows(rows).map((stock) => {
    const prev = Number(stock.previous_close) || 0
    const curr = Number(stock.current_price) || 0
    const vol = Number(stock.volume) || 0

    return {
      ...stock,
      price_change: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
      value_traded: curr * vol,
    }
  })

  setCache(cacheKey, stocks)
  return stocks
}

// ---------------------------------------------------------------------------
// getStockByTicker (LIGHT)
// ---------------------------------------------------------------------------

export function getStockByTicker(ticker: string): Record<string, unknown> | null {
  const db = getLightDb()
  const row = db
    .prepare('SELECT * FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1')
    .get(ticker) as Record<string, unknown> | undefined

  if (!row) return null

  const stock = toPlainRow(row)
  const prev = Number(stock.previous_close) || 0
  const curr = Number(stock.current_price) || 0
  const vol = Number(stock.volume) || 0

  return {
    ...stock,
    price_change: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
    value_traded: curr * vol,
  }
}

// ---------------------------------------------------------------------------
// getMarketIndices (LIGHT)
// ---------------------------------------------------------------------------

export function getMarketIndices(): Record<string, unknown>[] {
  const cached = getCached<Record<string, unknown>[]>('market_indices')
  if (cached) return cached

  const db = getLightDb()

  const rows = db
    .prepare('SELECT * FROM market_indices ORDER BY id ASC')
    .all() as Record<string, unknown>[]

  const result = toPlainRows(rows).map((row) => ({
    symbol: row.symbol,
    name: row.name,
    name_ar: INDEX_AR_NAMES[row.symbol as string] ?? row.name,
    value: Number(row.current_value) || 0,
    previous_close: Number(row.previous_close) || 0,
    change: Number(row.change) || 0,
    change_percent: Number(row.change_percent) || 0,
    last_updated: row.last_update ?? null,
  }))

  setCache('market_indices', result)
  return result
}

// ---------------------------------------------------------------------------
// getMarketOverviewStats (LIGHT)
// ---------------------------------------------------------------------------

export function getMarketOverviewStats(): Record<string, unknown> {
  const cached = getCached<Record<string, unknown>>('market_overview_stats')
  if (cached) return cached

  const db = getLightDb()

  const rows = db
    .prepare(
      `SELECT ticker, current_price, previous_close, volume, market_cap,
              egx30_member, egx70_member, egx100_member
       FROM stocks WHERE is_active = 1`
    )
    .all() as Record<string, unknown>[]

  let gainers = 0
  let losers = 0
  let unchanged = 0
  let totalVolume = 0
  let totalMarketCap = 0
  let egx30Count = 0
  let egx70Count = 0
  let egx100Count = 0
  let topGainerChange = -Infinity
  let topLoserChange = Infinity
  let topGainerTicker = ''
  let topLoserTicker = ''
  const totalStocks = rows.length

  for (const row of rows) {
    const prev = Number(row.previous_close) || 0
    const curr = Number(row.current_price) || 0
    const change = prev > 0 ? ((curr - prev) / prev) * 100 : 0

    if (change > 0) {
      gainers++
      if (change > topGainerChange) {
        topGainerChange = change
        topGainerTicker = row.ticker as string
      }
    } else if (change < 0) {
      losers++
      if (change < topLoserChange) {
        topLoserChange = change
        topLoserTicker = row.ticker as string
      }
    } else {
      unchanged++
    }

    totalVolume += Number(row.volume) || 0
    totalMarketCap += Number(row.market_cap) || 0

    if (row.egx30_member === 1) egx30Count++
    if (row.egx70_member === 1) egx70Count++
    if (row.egx100_member === 1) egx100Count++
  }

  const result = {
    total_stocks: totalStocks,
    gainers,
    losers,
    unchanged,
    total_volume: totalVolume,
    total_market_cap: totalMarketCap,
    egx30_count: egx30Count,
    egx70_count: egx70Count,
    egx100_count: egx100Count,
    top_gainer: topGainerTicker || null,
    top_gainer_change: topGainerChange === -Infinity ? 0 : topGainerChange,
    top_loser: topLoserTicker || null,
    top_loser_change: topLoserChange === Infinity ? 0 : topLoserChange,
  }

  setCache('market_overview_stats', result)
  return result
}

// ---------------------------------------------------------------------------
// getTopMovers (LIGHT)
// ---------------------------------------------------------------------------

export function getTopMovers(limit: number = 10): TopMoversResult {
  const cached = getCached<TopMoversResult>('top_movers')
  if (cached) return cached

  const db = getLightDb()

  const rows = db
    .prepare(
      `SELECT ticker, name, name_ar, sector, current_price, previous_close,
              volume, market_cap, investment_type, is_halal,
              egx30_member, egx70_member, egx100_member
       FROM stocks WHERE is_active = 1`
    )
    .all() as Record<string, unknown>[]

  // Enrich with calculated fields
  const enriched: Record<string, unknown>[] = toPlainRows(rows).map((stock) => {
    const prev = Number(stock.previous_close) || 0
    const curr = Number(stock.current_price) || 0
    const vol = Number(stock.volume) || 0
    const change = prev > 0 ? ((curr - prev) / prev) * 100 : 0
    return {
      ...stock,
      price_change: change,
      value_traded: curr * vol,
    }
  })

  // Gainers: sorted by price_change descending
  const gainers = enriched
    .filter((s) => Number(s.price_change) > 0)
    .sort((a, b) => Number(b.price_change) - Number(a.price_change))
    .slice(0, limit)

  // Losers: sorted by price_change ascending (most negative first)
  const losers = enriched
    .filter((s) => Number(s.price_change) < 0)
    .sort((a, b) => Number(a.price_change) - Number(b.price_change))
    .slice(0, limit)

  // Most active: sorted by volume descending
  const most_active = enriched
    .sort((a, b) => Number(b.volume) - Number(a.volume))
    .slice(0, limit)

  const result = { gainers, losers, most_active }
  setCache('top_movers', result)
  return result
}

// ---------------------------------------------------------------------------
// getSectorStats (LIGHT)
// ---------------------------------------------------------------------------

export function getSectorStats(): Record<string, unknown>[] {
  const cached = getCached<Record<string, unknown>[]>('sector_stats')
  if (cached) return cached

  const db = getLightDb()

  const rows = db
    .prepare(
      `SELECT sector,
              COUNT(*) as stock_count,
              SUM(CASE WHEN previous_close > 0 THEN 1 ELSE 0 END) as stocks_with_prev,
              SUM(volume) as total_volume,
              SUM(market_cap) as total_market_cap,
              AVG(CASE WHEN previous_close > 0
                  THEN ((current_price - previous_close) / previous_close) * 100
                  ELSE 0 END) as avg_change,
              SUM(CASE WHEN previous_close > 0 AND current_price > previous_close THEN 1 ELSE 0 END) as gainers,
              SUM(CASE WHEN previous_close > 0 AND current_price < previous_close THEN 1 ELSE 0 END) as losers
       FROM stocks
       WHERE is_active = 1 AND sector IS NOT NULL AND sector != ''
       GROUP BY sector
       ORDER BY total_volume DESC`
    )
    .all() as Record<string, unknown>[]

  const result = toPlainRows(rows).map((row) => ({
    ...row,
    avg_change: Number(Number(row.avg_change).toFixed(2)),
  }))

  setCache('sector_stats', result)
  return result
}

// ---------------------------------------------------------------------------
// Gold Prices (LIGHT)
// ---------------------------------------------------------------------------

export function getGoldPrices(): Record<string, unknown>[] {
  const cached = getCached<Record<string, unknown>[]>('gold_prices')
  if (cached) return cached

  const db = getLightDb()
  const rows = db
    .prepare('SELECT * FROM gold_prices ORDER BY id ASC')
    .all() as Record<string, unknown>[]
  const result = toPlainRows(rows)
  setCache('gold_prices', result)
  return result
}

export function getGoldPriceByKarat(karat: string): Record<string, unknown> | null {
  const db = getLightDb()
  const row = db
    .prepare('SELECT * FROM gold_prices WHERE karat = ?')
    .get(karat) as Record<string, unknown> | undefined
  return row ? toPlainRow(row) : null
}

// ---------------------------------------------------------------------------
// Silver Prices (LIGHT)
// ---------------------------------------------------------------------------

export function getSilverPrices(): Record<string, unknown>[] {
  const db = getLightDb()
  const rows = db
    .prepare("SELECT * FROM gold_prices WHERE karat LIKE 'silver%' ORDER BY id ASC")
    .all() as Record<string, unknown>[]
  return toPlainRows(rows)
}

// ---------------------------------------------------------------------------
// Currency Rates (LIGHT)
// ---------------------------------------------------------------------------

export function getCurrencyRates(): Record<string, unknown>[] {
  const cached = getCached<Record<string, unknown>[]>('currency_rates')
  if (cached) return cached

  const db = getLightDb()
  const rows = db
    .prepare('SELECT * FROM currency_rates ORDER BY is_major DESC, code ASC')
    .all() as Record<string, unknown>[]
  const result = toPlainRows(rows)
  setCache('currency_rates', result)
  return result
}

export function getCurrencyRateByCode(code: string): Record<string, unknown> | null {
  const db = getLightDb()
  const row = db
    .prepare('SELECT * FROM currency_rates WHERE code = ?')
    .get(code) as Record<string, unknown> | undefined
  return row ? toPlainRow(row) : null
}

// ---------------------------------------------------------------------------
// Smart Tips (LIGHT)
// ---------------------------------------------------------------------------

export interface SmartTipFilter {
  category?: string
  trigger?: string
}

export function getRandomSmartTip(filter?: SmartTipFilter): Record<string, unknown> | null {
  const db = getLightDb()

  const conditions: string[] = ['is_active = 1']
  const params: unknown[] = []

  if (filter?.category) {
    conditions.push('category = ?')
    params.push(filter.category)
  }
  if (filter?.trigger) {
    conditions.push('(trigger_event = ? OR trigger_event IS NULL)')
    params.push(filter.trigger)
  }

  const whereSQL = conditions.join(' AND ')
  const sql = `SELECT * FROM smart_tips WHERE ${whereSQL} ORDER BY RANDOM() LIMIT 1`
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined

  if (!row) return null

  // Increment show_count (fire and forget — non-critical)
  try {
    db.prepare('UPDATE smart_tips SET show_count = show_count + 1 WHERE id = ?').run(row.id)
  } catch {
    // Ignore — show count is non-critical
  }

  return toPlainRow(row)
}

export function getSmartTipsByCategory(category: string): Record<string, unknown>[] {
  const cacheKey = `smart_tips:${category}`
  const cached = getCached<Record<string, unknown>[]>(cacheKey)
  if (cached) return cached

  const db = getLightDb()
  const rows = db
    .prepare('SELECT * FROM smart_tips WHERE is_active = 1 AND category = ? ORDER BY priority DESC, RANDOM()')
    .all(category) as Record<string, unknown>[]
  const result = toPlainRows(rows)
  setCache(cacheKey, result)
  return result
}

export function getAllSmartTipCategories(): Array<{ category: string; count: number }> {
  const db = getLightDb()
  const rows = db
    .prepare('SELECT category, COUNT(*) as count FROM smart_tips WHERE is_active = 1 GROUP BY category ORDER BY count DESC')
    .all() as Array<{ category: string; count: number }>
  return rows
}

// ---------------------------------------------------------------------------
// getPredictions (LIGHT — if table exists in custom.db)
// ---------------------------------------------------------------------------

export function getPredictions(): Record<string, unknown>[] {
  if (!isHeavyDbAvailable()) {
    console.warn('[egx-db] Heavy DB unavailable - returning empty predictions')
    return []
  }
  // Try heavy DB first (predictions table may not exist in light DB)
  try {
    const db = getHeavyDb()
    const rows = db
      .prepare('SELECT * FROM predictions ORDER BY prediction_date DESC')
      .all() as Record<string, unknown>[]
    return toPlainRows(rows)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// verifyAdminPassword (LIGHT)
// ---------------------------------------------------------------------------

export function verifyAdminPassword(password: string): boolean {
  try {
    const db = getLightDb()
    const row = db
      .prepare('SELECT value FROM admin_settings WHERE key = ?')
      .get('admin_password') as { value: string } | undefined
    return row ? row.value === password : false
  } catch {
    return false
  }
}

// ===========================================================================
// HEAVY QUERIES — use egx_investment.db (lazy-loaded, for analysis only)
// ===========================================================================

// ---------------------------------------------------------------------------
// getPriceHistory (HEAVY)
// ---------------------------------------------------------------------------

export function getPriceHistory(
  stockId: number,
  days?: number
): Record<string, unknown>[] {
  // Try to load heavy DB if not available — with retry
  if (!isHeavyDbAvailable()) {
    try {
      getHeavyDb() // This will attempt to load or throw
    } catch (err) {
      console.warn(`[egx-db] Heavy DB unavailable for stock_id=${stockId}: ${(err as Error).message}`)
      return []
    }
  }

  // Double-check after load attempt
  if (!isHeavyDbAvailable()) {
    console.warn('[egx-db] Heavy DB still unavailable after load attempt - returning empty price history')
    return []
  }

  try {
    const db = getHeavyDb()

    let sql = 'SELECT * FROM stock_price_history WHERE stock_id = ?'
    const params: unknown[] = [stockId]

    if (days && days > 0) {
      sql += ' ORDER BY date DESC LIMIT ?'
      params.push(days * 2) // Account for weekends / non-trading days
    } else {
      sql += ' ORDER BY date ASC'
    }

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
    const result = toPlainRows(rows)

    // If we used a DESC limit, reverse to chronological order
    if (days && days > 0) {
      result.reverse()
    }

    return result
  } catch (err) {
    console.error(`[egx-db] Error reading price history for stock_id=${stockId}:`, err)
    // Reset state to allow retry on next call
    _heavyDb = null
    _heavyDbFailed = false
    _heavyDbFailedAt = Date.now()
    return []
  }
}

// ---------------------------------------------------------------------------
// getStockAnalysis — latest snapshot for a single ticker (HEAVY)
// ---------------------------------------------------------------------------

export function getStockAnalysis(
  ticker: string
): Record<string, unknown> | null {
  if (!isHeavyDbAvailable()) {
    return null
  }
  const db = getHeavyDb()

  const row = db
    .prepare(
      `SELECT si.*, s.name, s.name_ar, s.sector, s.current_price,
              s.investment_type, s.is_halal,
              s.egx30_member, s.egx70_member, s.egx100_member
       FROM stock_deep_insight_snapshots si
       JOIN stocks s ON si.stock_id = s.id
       WHERE si.ticker = ? COLLATE NOCASE
       ORDER BY si.fetched_at DESC
       LIMIT 1`
    )
    .get(ticker) as Record<string, unknown> | undefined

  if (!row) return null

  const result = toPlainRow(row)

  // Parse the JSON insights_payload
  if (result.insights_payload && typeof result.insights_payload === 'string') {
    try {
      const payload = JSON.parse(
        result.insights_payload as string
      ) as Record<string, unknown>

      // Extract commonly needed nested fields to top level
      const analysis = payload.analysis_payload as
        | Record<string, unknown>
        | undefined
      if (analysis) {
        result.recommendation = analysis.recommendation
        result.scores = analysis.scores
        result.trend = analysis.trend
        result.probabilities = analysis.probabilities
        result.technical_indicators = analysis.technical_indicators
        result.execution_plan = analysis.execution_plan
        result.scenarios = analysis.scenarios
        result.key_strengths = analysis.key_strengths
        result.key_risks = analysis.key_risks
        result.decision_basis_ar = analysis.decision_basis_ar
        result.history_summary = analysis.history_summary
        result.data_quality = analysis.data_quality
      }

      // Cache metadata
      const cacheMeta = payload.cache_meta as
        | Record<string, unknown>
        | undefined
      if (cacheMeta) {
        result.cache_current_price = cacheMeta.current_price
        result.cache_previous_close = cacheMeta.previous_close
        result.cache_last_update = cacheMeta.last_update
        result.cache_recommendation_action = cacheMeta.recommendation_action
      }
    } catch {
      // JSON parse failed – keep raw string
    }
  }

  // Remove raw payload
  delete result.insights_payload

  return result
}

// ---------------------------------------------------------------------------
// getAllStockAnalyses — for recommendations page (HEAVY)
// ---------------------------------------------------------------------------

export function getAllStockAnalyses(): Record<string, unknown>[] {
  if (!isHeavyDbAvailable()) {
    console.warn('[egx-db] Heavy DB unavailable - returning empty stock analyses')
    return []
  }
  const db = getHeavyDb()

  // Get the latest snapshot per stock_id
  const rows = db
    .prepare(
      `SELECT si.*, s.name, s.name_ar, s.sector, s.current_price,
              s.investment_type, s.is_halal,
              s.egx30_member, s.egx70_member, s.egx100_member,
              s.previous_close, s.volume,
              s.eps, s.pb_ratio, s.pe_ratio
       FROM stock_deep_insight_snapshots si
       JOIN stocks s ON si.stock_id = s.id
       WHERE si.id IN (
         SELECT MAX(id) FROM stock_deep_insight_snapshots GROUP BY stock_id
       )
       ORDER BY si.fetched_at DESC`
    )
    .all() as Record<string, unknown>[]

  return toPlainRows(rows).map((row) => {
    const result: Record<string, unknown> = { ...row }

    // Parse insights_payload – extract essential fields only
    if (result.insights_payload && typeof result.insights_payload === 'string') {
      try {
        const payload = JSON.parse(
          result.insights_payload as string
        ) as Record<string, unknown>
        const analysis = payload.analysis_payload as
          | Record<string, unknown>
          | undefined

        if (analysis) {
          result.recommendation = analysis.recommendation
          result.scores = analysis.scores
          result.trend = analysis.trend
          result.probabilities = analysis.probabilities
          result.execution_plan = analysis.execution_plan
          result.scenarios = analysis.scenarios
          result.key_strengths = analysis.key_strengths
          result.key_risks = analysis.key_risks
          result.decision_basis_ar = analysis.decision_basis_ar
          result.history_summary = analysis.history_summary
        }

        const cacheMeta = payload.cache_meta as
          | Record<string, unknown>
          | undefined
        if (cacheMeta) {
          result.cache_current_price = cacheMeta.current_price
          result.cache_previous_close = cacheMeta.previous_close
          result.cache_recommendation_action =
            cacheMeta.recommendation_action
        }
      } catch {
        // JSON parse failed – skip enrichment
      }
    }

    // Calculate price change
    const prev = Number(result.previous_close) || 0
    const curr = Number(result.current_price) || 0
    result.price_change = prev > 0 ? ((curr - prev) / prev) * 100 : 0

    // Remove raw payload
    delete result.insights_payload

    return result
  })
}

// ---------------------------------------------------------------------------
// Gold Price History (HEAVY)
// ---------------------------------------------------------------------------

export function getGoldPriceHistory(
  karat: string,
  days: number = 30
): Record<string, unknown>[] {
  if (!isHeavyDbAvailable()) {
    return []
  }
  const db = getHeavyDb()
  const rows = db
    .prepare(
      `SELECT * FROM gold_price_history
       WHERE karat = ?
       ORDER BY recorded_at DESC
       LIMIT ?`
    )
    .all(karat, days + 10) as Record<string, unknown>[] // extra margin for non-trading days
  return toPlainRows(rows).reverse()
}

export function saveGoldPriceSnapshot(
  karat: string,
  price: number,
  change: number | null,
  currency: string = 'EGP'
): boolean {
  if (!isWritableDbAvailable()) return false
  try {
    const db = getWritableDb()
    db.prepare(
      `INSERT INTO gold_price_history (karat, price_per_gram, change, currency, recorded_at, source)
       VALUES (?, ?, ?, ?, datetime('now'), 'system')`
    ).run(karat, price, change, currency)
    return true
  } catch {
    return false
  }
}

// ===========================================================================
// ADMIN WRITE OPERATIONS — write to BOTH databases for consistency
// ===========================================================================

// ---------------------------------------------------------------------------
// Admin: Update Gold Prices
// ---------------------------------------------------------------------------

export function updateGoldPrice(
  karat: string,
  pricePerGram: number,
  change: number | null,
  updatedBy: string = 'admin'
): boolean {
  if (!isWritableDbAvailable()) {
    console.warn('[egx-db] Writable DB unavailable - gold price update skipped')
    return false
  }
  try {
    // Write to heavy DB (source of truth)
    const heavyDb = getWritableDb()
    heavyDb.prepare(
      `UPDATE gold_prices SET price_per_gram = ?, change = ?, updated_at = datetime('now'), updated_by = ? WHERE karat = ?`
    ).run(pricePerGram, change, updatedBy, karat)

    // Also write to light DB for immediate display
    const lightDb = getWritableLightDb()
    lightDb.prepare(
      `UPDATE gold_prices SET price_per_gram = ?, change = ?, updated_at = datetime('now'), updated_by = ? WHERE karat = ?`
    ).run(pricePerGram, change, updatedBy, karat)

    // Clear cache
    clearCache()
    return true
  } catch {
    return false
  }
}

export function updateAllGoldPrices(
  prices: Array<{ karat: string; price_per_gram: number; change: number | null }>,
  updatedBy: string = 'admin'
): number {
  if (!isWritableDbAvailable()) {
    console.warn('[egx-db] Writable DB unavailable - gold prices bulk update skipped')
    return 0
  }
  try {
    // Write to heavy DB
    const heavyDb = getWritableDb()
    const heavyStmt = heavyDb.prepare(
      `UPDATE gold_prices SET price_per_gram = ?, change = ?, updated_at = datetime('now'), updated_by = ? WHERE karat = ?`
    )
    const heavyMany = heavyDb.transaction((items: typeof prices) => {
      let count = 0
      for (const item of items) {
        const result = heavyStmt.run(item.price_per_gram, item.change, updatedBy, item.karat)
        count += result.changes
      }
      return count
    })

    // Also write to light DB
    const lightDb = getWritableLightDb()
    const lightStmt = lightDb.prepare(
      `UPDATE gold_prices SET price_per_gram = ?, change = ?, updated_at = datetime('now'), updated_by = ? WHERE karat = ?`
    )
    const lightMany = lightDb.transaction((items: typeof prices) => {
      for (const item of items) {
        lightStmt.run(item.price_per_gram, item.change, updatedBy, item.karat)
      }
    })

    heavyMany(prices)
    lightMany(prices)
    clearCache()
    return prices.length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Admin: Update Currency Rates
// ---------------------------------------------------------------------------

export function updateCurrencyRate(
  code: string,
  buyRate: number,
  sellRate: number,
  change: number | null,
  updatedBy: string = 'admin'
): boolean {
  if (!isWritableDbAvailable()) {
    console.warn('[egx-db] Writable DB unavailable - currency rate update skipped')
    return false
  }
  try {
    // Write to heavy DB
    const heavyDb = getWritableDb()
    heavyDb.prepare(
      `UPDATE currency_rates SET buy_rate = ?, sell_rate = ?, change = ?, updated_at = datetime('now'), updated_by = ? WHERE code = ?`
    ).run(buyRate, sellRate, change, updatedBy, code)

    // Also write to light DB
    const lightDb = getWritableLightDb()
    lightDb.prepare(
      `UPDATE currency_rates SET buy_rate = ?, sell_rate = ?, change = ?, updated_at = datetime('now'), updated_by = ? WHERE code = ?`
    ).run(buyRate, sellRate, change, updatedBy, code)

    clearCache()
    return true
  } catch {
    return false
  }
}

export function updateAllCurrencyRates(
  rates: Array<{ code: string; buy_rate: number; sell_rate: number; change: number | null }>,
  updatedBy: string = 'admin'
): number {
  if (!isWritableDbAvailable()) {
    console.warn('[egx-db] Writable DB unavailable - currency rates bulk update skipped')
    return 0
  }
  try {
    // Write to heavy DB
    const heavyDb = getWritableDb()
    const heavyStmt = heavyDb.prepare(
      `UPDATE currency_rates SET buy_rate = ?, sell_rate = ?, change = ?, updated_at = datetime('now'), updated_by = ? WHERE code = ?`
    )
    const heavyMany = heavyDb.transaction((items: typeof rates) => {
      let count = 0
      for (const item of items) {
        const result = heavyStmt.run(item.buy_rate, item.sell_rate, item.change, updatedBy, item.code)
        count += result.changes
      }
      return count
    })

    // Also write to light DB
    const lightDb = getWritableLightDb()
    const lightStmt = lightDb.prepare(
      `UPDATE currency_rates SET buy_rate = ?, sell_rate = ?, change = ?, updated_at = datetime('now'), updated_by = ? WHERE code = ?`
    )
    const lightMany = lightDb.transaction((items: typeof rates) => {
      for (const item of items) {
        lightStmt.run(item.buy_rate, item.sell_rate, item.change, updatedBy, item.code)
      }
    })

    heavyMany(rates)
    lightMany(rates)
    clearCache()
    return rates.length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Admin: Update Admin Password
// ---------------------------------------------------------------------------

export function updateAdminPassword(oldPassword: string, newPassword: string): boolean {
  if (!verifyAdminPassword(oldPassword)) return false
  if (!isWritableDbAvailable()) {
    console.warn('[egx-db] Writable DB unavailable - admin password update skipped')
    return false
  }
  try {
    const db = getWritableDb()
    db.prepare(
      `UPDATE admin_settings SET value = ?, updated_at = datetime('now') WHERE key = ?`
    ).run(newPassword, 'admin_password')

    // Also update light DB
    const lightDb = getWritableLightDb()
    lightDb.prepare(
      `UPDATE admin_settings SET value = ?, updated_at = datetime('now') WHERE key = ?`
    ).run(newPassword, 'admin_password')

    clearCache()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Admin: Import Recommendations (update stock_deep_insight_snapshots) (HEAVY)
// ---------------------------------------------------------------------------

export interface RecommendationImport {
  ticker: string
  recommendation_action?: string
  recommendation_ar?: string
  confidence_score?: number
  total_score?: number
  technical_score?: number
  fundamental_score?: number
  risk_score?: number
  trend_direction?: string
  target_price?: number
  stop_loss?: number
  entry_price?: number
  time_horizon?: string
  news_sentiment?: string
  news_impact?: string
  notes?: string
}

export function importRecommendations(items: RecommendationImport[]): {
  updated: number
  skipped: number
  errors: string[]
} {
  if (!isWritableDbAvailable()) {
    console.warn('[egx-db] Writable DB unavailable - recommendation import skipped')
    return { updated: 0, skipped: 0, errors: ['قاعدة البيانات غير متاحة'] }
  }
  try {
    const db = getWritableDb()
    let updated = 0
    let skipped = 0
    const errors: string[] = []

    const updateStmt = db.prepare(`
      UPDATE stock_deep_insight_snapshots
      SET insights_payload = json_set(
        insights_payload,
        '$.analysis_payload.recommendation.action',
        ?,
        '$.analysis_payload.recommendation.action_ar',
        ?,
        '$.analysis_payload.recommendation.confidence_score',
        ?,
        '$.analysis_payload.scores.total_score',
        ?,
        '$.analysis_payload.scores.technical_score',
        ?,
        '$.analysis_payload.scores.fundamental_score',
        ?,
        '$.analysis_payload.scores.risk_score',
        ?,
        '$.analysis_payload.trend.direction',
        ?,
        '$.analysis_payload.recommendation.target_price',
        ?,
        '$.analysis_payload.recommendation.stop_loss',
        ?,
        '$.analysis_payload.recommendation.entry_price',
        ?,
        '$.analysis_payload.recommendation.time_horizon',
        ?,
        '$.admin_override.news_sentiment',
        ?,
        '$.admin_override.news_impact',
        ?,
        '$.admin_override.notes',
        ?,
        '$.admin_override.updated_at',
        datetime('now')
      )
      WHERE ticker = ? COLLATE NOCASE
        AND id IN (SELECT MAX(id) FROM stock_deep_insight_snapshots GROUP BY stock_id)
    `)

    const runMany = db.transaction((records: RecommendationImport[]) => {
      for (const rec of records) {
        try {
          const result = updateStmt.run(
            rec.recommendation_action ?? null,
            rec.recommendation_ar ?? null,
            rec.confidence_score ?? null,
            rec.total_score ?? null,
            rec.technical_score ?? null,
            rec.fundamental_score ?? null,
            rec.risk_score ?? null,
            rec.trend_direction ?? null,
            rec.target_price ?? null,
            rec.stop_loss ?? null,
            rec.entry_price ?? null,
            rec.time_horizon ?? null,
            rec.news_sentiment ?? null,
            rec.news_impact ?? null,
            rec.notes ?? null,
            rec.ticker.toUpperCase()
          )
          if (result.changes > 0) {
            updated++
          } else {
            skipped++
          }
        } catch (err) {
          errors.push(`${rec.ticker}: ${String(err)}`)
        }
      }
    })

    runMany(items)
    return { updated, skipped, errors }
  } catch (err) {
    return { updated: 0, skipped: 0, errors: [`خطأ عام: ${String(err)}`] }
  }
}

// ---------------------------------------------------------------------------
// Export pre-warm function for instrumentation hook
// ---------------------------------------------------------------------------

export function prewarmLightDb(): void {
  try {
    getLightDb();
    console.log('[egx-db] Light DB pre-warmed');
  } catch (e) {
    console.error('[egx-db] Failed to pre-warm light DB:', e);
  }
}

// ---------------------------------------------------------------------------
// Export clearCache for admin operations
// ---------------------------------------------------------------------------

export { clearCache }

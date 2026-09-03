/**
 * Data Engine Database Client - sql.js edition (WASM-based, zero native modules)
 * =============================================================================
 * Uses sql.js (WebAssembly SQLite) to avoid the better-sqlite3 native module
 * issue with Next.js bundler. Loaded lazily to not block startup.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { SqlJsStatic, Database as SqlJsDatabase } from 'sql.js';

// ===========================================================================
// STATE
// ===========================================================================

let _sqlJs: SqlJsStatic | null = null;
let _dataEngineDb: SqlJsDatabase | null = null;
let _stocksDb: SqlJsDatabase | null = null;
let _initPromise: Promise<void> | null = null;

/**
 * Init sql.js wasm (lazy, once)
 */
async function ensureInit(): Promise<SqlJsStatic> {
    if (_sqlJs) return _sqlJs;
    if (_initPromise) return _initPromise.then(() => _sqlJs!);
    _initPromise = (async () => {
        // sql.js is auto-loaded; the wasm file is copied during postbuild
        const initSqlJs = (await import('sql.js')).default;
        _sqlJs = await initSqlJs();
    })();
    await _initPromise;
    return _sqlJs!;
}

/**
 * Open a sql.js database from a file path (read-only copy to avoid WAL issues).
 * Sql.js can't work with WAL mode files directly, so we copy to a temp snapshot.
 */
function openReadonly(sqlJs: SqlJsStatic, dbPath: string): SqlJsDatabase {
    const buffer = fs.readFileSync(dbPath);
    return new sqlJs.Database(buffer);
}

/**
 * Open a sql.js database read-write: copy file, open, and enable auto-save.
 */
function openReadWrite(sqlJs: SqlJsStatic, dbPath: string): SqlJsDatabase {
    const buffer = fs.readFileSync(dbPath);
    const db = new sqlJs.Database(buffer);
    return db;
}

// ===========================================================================
// DATABASE CONNECTIONS
// ===========================================================================

/**
 * Get data_engine.db connection (read-only via sql.js)
 */
export async function getDataEngineDbSqlJs(): Promise<SqlJsDatabase> {
    if (_dataEngineDb) return _dataEngineDb;

    const dbPath = path.join(process.cwd(), 'db', 'data_engine.db');
    if (!fs.existsSync(dbPath)) {
        throw new Error(`Data Engine DB not found at ${dbPath}`);
    }

    const sqlJs = await ensureInit();
    _dataEngineDb = openReadonly(sqlJs, dbPath);
    return _dataEngineDb;
}

/**
 * Get data_engine.db connection (read-only via sql.js) — also used for price history.
 * (price_history.db was removed; egksco_price_history table in data_engine.db is now the source.)
 */
export async function getPriceHistoryDbSqlJs(): Promise<SqlJsDatabase> {
    // Backward-compatible: route to data_engine.db connection
    return getDataEngineDbSqlJs();
}

/**
 * Get stocks.db connection (read-only via sql.js)
 */
export async function getStocksDbSqlJs(): Promise<SqlJsDatabase> {
    if (_stocksDb) return _stocksDb;

    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(dbPath)) {
        throw new Error(`Stocks DB not found at ${dbPath}`);
    }

    const sqlJs = await ensureInit();
    _stocksDb = openReadonly(sqlJs, dbPath);
    return _stocksDb;
}

// ===========================================================================
// COMPAT LAYER — wraps async SqlJsDatabase into a mock Database.Database
// ===========================================================================

/**
 * Light wrapper so existing route.ts code works without changes.
 */
class DbCompat {
    private _db: SqlJsDatabase;
    private _name: string;

    constructor(db: SqlJsDatabase, name: string) {
        this._db = db;
        this._name = name;
    }

    prepare(sql: string): any {
        const stmt = this._db.prepare(sql);
        return {
            get: (...params: any[]) => {
                stmt.bind(params);
                if (stmt.step()) {
                    const row = stmt.getAsObject();
                    stmt.free();
                    return row;
                }
                stmt.free();
                return undefined;
            },
            all: (...params: any[]) => {
                stmt.bind(params);
                const rows: any[] = [];
                while (stmt.step()) rows.push(stmt.getAsObject());
                stmt.free();
                return rows;
            },
            run: (...params: any[]) => {
                stmt.bind(params);
                stmt.step();
                stmt.free();
                return { changes: this._db.getRowsModified() };
            },
        };
    }

    exec(sql: string): void {
        this._db.run(sql);
    }

    pragma(): any[] {
        return [];
    }

    close(): void {
        this._db.close();
    }
}

// ===========================================================================
// RE-EXPORT with same names as original data-engine-db
// ===========================================================================

export type Database = DbCompat;
export const DatabaseConstructor = DbCompat;

// Fallback functions that return sync-style wrappers (they init async internally)
let _dataEngineCompat: DbCompat | null = null;
let _priceHistoryCompat: DbCompat | null = null;
let _stocksCompat: DbCompat | null = null;

async function _ensureDataEngineCompat(): Promise<DbCompat> {
    if (_dataEngineCompat) return _dataEngineCompat;
    const db = await getDataEngineDbSqlJs();
    _dataEngineCompat = new DbCompat(db, 'data_engine.db');
    return _dataEngineCompat;
}

async function _ensurePriceHistoryCompat(): Promise<DbCompat> {
    if (_priceHistoryCompat) return _priceHistoryCompat;
    const db = await getPriceHistoryDbSqlJs();
    _priceHistoryCompat = new DbCompat(db, 'data_engine.db');
    return _priceHistoryCompat;
}

async function _ensureStocksCompat(): Promise<DbCompat> {
    if (_stocksCompat) return _stocksCompat;
    const db = await getStocksDbSqlJs();
    _stocksCompat = new DbCompat(db, 'stocks.db');
    return _stocksCompat;
}

// ===========================================================================
// MARKET CODE MAPPING (same as original)
// ===========================================================================

const MARKET_CODE_TO_ARABIC: Record<string, string> = {
    'EGX': 'مصر',
    'TADAWUL': 'السعودية',
    'KSA': 'السعودية',
    'KSE': 'الكويت',
    'QSE': 'قطر',
    'DFM': 'الإمارات',
    'ADX': 'الإمارات',
    'BSE': 'البحرين',
};

export function marketCodeToArabic(code: string): string {
    return MARKET_CODE_TO_ARABIC[code.toUpperCase()] || code;
}

// ===========================================================================
// STOCK QUERIES
// ===========================================================================

export interface DataEngineStock {
    id: number;
    symbol: string;
    name: string | null;
    price: number | null;
    change_percent: number | null;
    volume: string | null;
    market_cap: string | null;
    market: string;
    created_at: string | null;
}

export interface MarketStats {
    total: number;
    rising: number;
    falling: number;
    unchanged: number;
}

export interface MarketBreakdown {
    market: string;
    market_code: string;
    market_name: string;
    country: string;
    flag: string;
    count: number;
    rising: number;
    falling: number;
}

export interface DataEngineGoldPrice {
    id: number;
    timestamp: string;
    country: string;
    currency: string;
    karat: string;
    price_per_gram: number | null;
    price_per_ounce: number | null;
}

export interface DataEngineSilverPrice {
    id: number;
    timestamp: string;
    country: string;
    currency: string;
    price_per_gram: number | null;
    price_per_ounce: number | null;
}

export interface DataEngineExchangeRate {
    id: number;
    timestamp: string;
    currency: string;
    rate_to_usd: number | null;
}

export interface DataEngineCrypto {
    id: number;
    timestamp: string;
    rank: number | null;
    symbol: string;
    name: string;
    price_usd: number | null;
    price_change_24h: number | null;
    price_change_7d: number | null;
    market_cap: number | null;
    market_cap_rank: number | null;
    total_volume: number | null;
    circulating_supply: number | null;
}

export interface PriceHistoryRecord {
    id: number;
    ticker: string;
    name: string | null;
    category: string | null;
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    market: string | null;
}

// ===========================================================================
// QUERIES — same API as original data-engine-db but async-friendly
// ===========================================================================

export async function getMarketStats(market?: string): Promise<MarketStats> {
    const db = await _ensureDataEngineCompat();
    const marketName = market ? marketCodeToArabic(market) : null;

    try {
        let total = 0, rising = 0, falling = 0, unchanged = 0;

        if (marketName) {
            total = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE market = ?').get(marketName) as any)?.count || 0;
            rising = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent > 0 AND market = ?').get(marketName) as any)?.count || 0;
            falling = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent < 0 AND market = ?').get(marketName) as any)?.count || 0;
            unchanged = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE (change_percent = 0 OR change_percent IS NULL) AND market = ?').get(marketName) as any)?.count || 0;
        } else {
            total = (db.prepare('SELECT COUNT(*) as count FROM stocks').get() as any)?.count || 0;
            rising = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent > 0').get() as any)?.count || 0;
            falling = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent < 0').get() as any)?.count || 0;
            unchanged = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent = 0 OR change_percent IS NULL').get() as any)?.count || 0;
        }

        return { total, rising, falling, unchanged };
    } catch (err) {
        console.warn('[data-engine-db/sqljs] getMarketStats error:', err);
        return { total: 0, rising: 0, falling: 0, unchanged: 0 };
    }
}

export async function getStocksByMarket(market: string, limit: number = 50): Promise<DataEngineStock[]> {
    const db = await _ensureDataEngineCompat();
    const marketName = marketCodeToArabic(market);

    try {
        return db.prepare('SELECT * FROM stocks WHERE market = ? ORDER BY volume DESC LIMIT ?').all(marketName, limit) as DataEngineStock[];
    } catch (err) {
        console.warn('[data-engine-db/sqljs] getStocksByMarket error:', err);
        return [];
    }
}

export async function getTopMovers(market?: string, limit: number = 10): Promise<{ gainers: DataEngineStock[]; losers: DataEngineStock[] }> {
    const db = await _ensureDataEngineCompat();
    const marketName = market ? marketCodeToArabic(market) : null;

    try {
        let stocks: DataEngineStock[];
        if (marketName) {
            stocks = db.prepare('SELECT * FROM stocks WHERE change_percent IS NOT NULL AND market = ?').all(marketName) as DataEngineStock[];
        } else {
            stocks = db.prepare('SELECT * FROM stocks WHERE change_percent IS NOT NULL').all() as DataEngineStock[];
        }

        return {
            gainers: stocks.filter(s => (s.change_percent || 0) > 0).sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0)).slice(0, limit),
            losers: stocks.filter(s => (s.change_percent || 0) < 0).sort((a, b) => (a.change_percent || 0) - (b.change_percent || 0)).slice(0, limit),
        };
    } catch (err) {
        console.warn('[data-engine-db/sqljs] getTopMovers error:', err);
        return { gainers: [], losers: [] };
    }
}

export async function getMarketBreakdown(): Promise<MarketBreakdown[]> {
    const db = await _ensureDataEngineCompat();

    const marketInfo: Record<string, { code: string; name: string; country: string; flag: string }> = {
        'مصر': { code: 'EGX', name: 'البورصة المصرية', country: 'مصر', flag: '🇪🇬' },
        'السعودية': { code: 'TADAWUL', name: 'تداول السعودية', country: 'السعودية', flag: '🇸🇦' },
        'الكويت': { code: 'KSE', name: 'بورصة الكويت', country: 'الكويت', flag: '🇰🇼' },
        'قطر': { code: 'QSE', name: 'بورصة قطر', country: 'قطر', flag: '🇶🇦' },
    };

    try {
        const rows = db.prepare('SELECT market, COUNT(*) as count, SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as rising, SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as falling FROM stocks GROUP BY market ORDER BY count DESC').all() as any[];

        return rows.map((row: any) => {
            const info = marketInfo[row.market] || { code: row.market, name: row.market, country: row.market, flag: '🌐' };
            return { market: row.market, market_code: info.code, market_name: info.name, country: info.country, flag: info.flag, count: row.count, rising: row.rising || 0, falling: row.falling || 0 };
        });
    } catch (err) {
        console.warn('[data-engine-db/sqljs] getMarketBreakdown error:', err);
        return [];
    }
}

export async function getLatestGoldPrices(): Promise<DataEngineGoldPrice[]> {
    const db = await _ensureDataEngineCompat();
    try {
        return db.prepare('SELECT * FROM gold_prices WHERE timestamp = (SELECT MAX(timestamp) FROM gold_prices) ORDER BY country, karat').all() as DataEngineGoldPrice[];
    } catch { return []; }
}

export async function getLatestCryptoPrices(limit: number = 50): Promise<DataEngineCrypto[]> {
    const db = await _ensureDataEngineCompat();
    try {
        return db.prepare('SELECT * FROM crypto_prices WHERE timestamp = (SELECT MAX(timestamp) FROM crypto_prices) ORDER BY rank ASC LIMIT ?').all(limit) as DataEngineCrypto[];
    } catch { return []; }
}

export async function getLatestExchangeRates(): Promise<DataEngineExchangeRate[]> {
    const db = await _ensureDataEngineCompat();
    try {
        return db.prepare('SELECT * FROM exchange_rates WHERE timestamp = (SELECT MAX(timestamp) FROM exchange_rates) ORDER BY currency').all() as DataEngineExchangeRate[];
    } catch { return []; }
}

export async function getLatestSilverPrices(): Promise<DataEngineSilverPrice[]> {
    const db = await _ensureDataEngineCompat();
    try {
        return db.prepare('SELECT * FROM silver_prices WHERE timestamp = (SELECT MAX(timestamp) FROM silver_prices) ORDER BY country').all() as DataEngineSilverPrice[];
    } catch { return []; }
}

export async function getHistoricalData(symbol: string, limit: number = 100): Promise<PriceHistoryRecord[]> {
    const db = await _ensurePriceHistoryCompat();
    try {
        // egksco_price_history: id, symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover
        return db.prepare(`
            SELECT 
                id,
                symbol AS ticker,
                NULL AS name,
                NULL AS category,
                price_date AS date,
                open_price AS open,
                high_price AS high,
                low_price AS low,
                close_price AS close,
                volume,
                NULL AS market
            FROM egksco_price_history
            WHERE symbol = ?
            ORDER BY price_date DESC
            LIMIT ?
        `).all(symbol, limit) as PriceHistoryRecord[];
    } catch { return []; }
}
/**
 * P31-CHART-PORTFOLIO-DATA-BINDING: Get the most recent clean close price for a ticker.
 * =========================================================================
 * This is the MISSING LINK that caused "Live Price = 0" in the portfolio.
 * stocks.db is frequently empty/stale (TradingView feed gaps), so the fallback
 * chain in calculate-values/route.ts dead-ends at avg_buy_price (P&L = 0%).
 *
 * Reads from data_engine.db.egksco_price_history (migrated from price_history.db).
 * Note: egksco_price_history has no `source` column — all rows are from EGKSCO.
 * Previously, price_history.db had `source` (yahoo_clean / egksco), but yahoo_clean
 * was never populated (verified empty), so we now just use egksco directly.
 *
 * Ticker is normalized: "COMI.CA" / "comi" -> "COMI" (base ticker before first dot).
 *
 * Returns { price: 0, source: 'none' } if no price found (caller falls back to avg_buy_price).
 */
export async function getLastCleanClose(ticker: string): Promise<{ price: number; source: string; date: string }> {
    const db = await _ensurePriceHistoryCompat();
    const base = (ticker || '').toUpperCase().trim().split('.')[0];
    if (!base) return { price: 0, source: 'none', date: '' };

    try {
        // egksco_price_history: SELECT most recent close_price WHERE symbol = ?
        const row = db.prepare(
            "SELECT close_price, price_date AS date FROM egksco_price_history WHERE symbol = ? AND close_price > 0 ORDER BY price_date DESC LIMIT 1"
        ).get(base) as any;
        if (row && Number(row.close_price) > 0) {
            return { price: Number(row.close_price), source: 'egksco', date: String(row.date || '') };
        }
    } catch (err) {
        console.warn('[data-engine-db/sqljs] getLastCleanClose error:', err);
    }
    return { price: 0, source: 'none', date: '' };
}

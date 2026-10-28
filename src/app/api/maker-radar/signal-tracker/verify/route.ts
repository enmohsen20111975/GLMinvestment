import { NextRequest, NextResponse } from 'next/server';
import { access } from 'fs/promises';
import path from 'path';
import type Database from 'better-sqlite3';
import { openDb, openDbWritable } from '@/lib/db-manager';
import { normalizeMarket, sqlMarketVariants, type CanonicalMarket } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/maker-radar/signal-tracker/verify
 * body: { max_age_days?: 45 }
 *
 * Verifies pending radar signals:
 *   1. SELECT pending signals between 7 and max_age_days (default 45) old.
 *   2. For each, fetch up to 30 trading days of prices AFTER the signal_date.
 *   3. Compute outcome_7d / outcome_14d / outcome_30d (% return vs entry_price).
 *   4. Track max_price_after / min_price_after (true excursion).
 *   5. Update status:
 *        - outcome_30d available → verified_win / verified_loss / verified_neutral
 *        - else if outcome_14d available → keep pending (record partial outcomes)
 *   6. Return summary.
 */

const PROJECT_ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────
// Price-source resolver — tries multiple DB schemas (same pattern as radar-db)
// ─────────────────────────────────────────────────────────────────────────────

interface PriceSource {
  dbFile: string;
  table: string;
  tickerCol: string;
  dateCol: string;
  closeCol: string;
  highCol: string;
  lowCol: string;
}

const PRICE_SOURCES: PriceSource[] = [
  // 1. data_engine.db.egksco_price_history (price_date column)
  {
    dbFile: 'data_engine.db',
    table: 'egksco_price_history',
    tickerCol: 'symbol',
    dateCol: 'price_date',
    closeCol: 'close_price',
    highCol: 'high_price',
    lowCol: 'low_price',
  },
  // 2. stocks.db.egksco_price_history (date column — different schema!)
  {
    dbFile: 'stocks.db',
    table: 'egksco_price_history',
    tickerCol: 'symbol',
    dateCol: 'date',
    closeCol: 'close_price',
    highCol: 'high_price',
    lowCol: 'low_price',
  },
  // 3. stocks.db.stock_daily_prices
  {
    dbFile: 'stocks.db',
    table: 'stock_daily_prices',
    tickerCol: 'ticker',
    dateCol: 'price_date',
    closeCol: 'close',
    highCol: 'high',
    lowCol: 'low',
  },
  // 4. data_engine.db.historical_data (non-EGX fallback)
  {
    dbFile: 'data_engine.db',
    table: 'historical_data',
    tickerCol: 'symbol',
    dateCol: 'date',
    closeCol: 'close',
    highCol: 'high',
    lowCol: 'low',
  },
];

interface PricePoint {
  date: string;
  close: number;
  high: number;
  low: number;
}

/** Fetch up to `limit` trading-day prices strictly AFTER signalDate for ticker. */
// P0-14-ASYNC fix (2026-09-27): now async — uses access() instead of existsSync
// per candidate DB so the event loop is not blocked.
// FIX (FIX-API-MARKET #7): accept an optional canonical market so the price-source
// query doesn't hardcode `market = 'EGX'`. When the caller passes a market, we
// bind `sqlMarketVariants()` placeholders so cross-market contamination (e.g.
// US-tagged rows for an EGX ticker) is filtered out for the right market.
async function fetchPricesAfter(
  ticker: string,
  signalDate: string,
  limit: number,
  market: CanonicalMarket = 'EGX'
): Promise<{ prices: PricePoint[]; source: string | null }> {
  const marketVariants = sqlMarketVariants(market);
  const marketPlaceholders = marketVariants.map(() => '?').join(',');
  for (const src of PRICE_SOURCES) {
    const db = openDb(src.dbFile);
    if (!db) continue;
    try {
      // Quick table existence check
      const tbl = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        )
        .get(src.table) as any;
      if (!tbl) {
        db.close();
        continue;
      }
      // C2 FIX: check if table has market column, add market filter to prevent
      // cross-market contamination (US-tagged rows for EGX tickers).
      // FIX (FIX-API-MARKET #7): use bound `IN (?, ?, ?)` with the canonical
      // market's variants so TADAWUL signals also match rows stored as 'KSA'
      // or 'السعودية', etc.
      const tableInfo = db.prepare(`PRAGMA table_info(${src.table})`).all() as any[];
      const hasMarketCol = tableInfo.some((c: any) => c.name === 'market');
      const marketClause = hasMarketCol
        ? `AND market IN (${marketPlaceholders})`
        : '';
      const rows = db
        .prepare(
          `SELECT ${src.dateCol} AS d, ${src.closeCol} AS c,
                  ${src.highCol} AS h, ${src.lowCol} AS l
           FROM ${src.table}
           WHERE ${src.tickerCol} = ?
             AND ${src.dateCol} > ?
             AND ${src.closeCol} IS NOT NULL
             AND ${src.closeCol} > 0
             ${marketClause}
           ORDER BY ${src.dateCol} ASC
           LIMIT ?`
        )
        .all(
          ticker,
          signalDate,
          ...(hasMarketCol ? marketVariants : []),
          limit
        ) as any[];

      if (rows.length === 0) {
        db.close();
        continue;
      }

      const prices: PricePoint[] = rows.map((r) => ({
        date: String(r.d),
        close: num(r.c),
        high: r.h != null ? num(r.h) : num(r.c),
        low: r.l != null ? num(r.l) : num(r.c),
      }));
      const sourceLabel = `${src.dbPath.split('/').pop()}::${src.table}`;
      db.close();
      return { prices, source: sourceLabel };
    } catch (e) {
      try { if (db) db.close(); } catch {}
      continue;
    }
  }
  return { prices: [], source: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracker DB resolver — reuses the radar-db pattern (prefer stocks.db)
// ─────────────────────────────────────────────────────────────────────────────

const TRACKER_DB_CANDIDATES = ['stocks.db', 'data_engine.db'];

// P0-14-ASYNC fix (2026-09-27): openTrackerDb is now async — uses access().
async function openTrackerDb(): Promise<Database.Database | null> {
  for (const file of TRACKER_DB_CANDIDATES) {
    const db = openDbWritable(file);
    if (db) {
      try {
        ensureSchema(db);
        return db;
      } catch {
        try { db.close(); } catch { /* ignore */ }
      }
    }
  }
  return null;
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS radar_signal_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      signal_date TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      entry_price REAL NOT NULL,
      path TEXT,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      outcome_7d REAL,
      outcome_14d REAL,
      outcome_30d REAL,
      max_price_after REAL,
      min_price_after REAL,
      verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_radar_sig_ticker ON radar_signal_tracking(ticker);
    CREATE INDEX IF NOT EXISTS idx_radar_sig_status ON radar_signal_tracking(status);
    CREATE INDEX IF NOT EXISTS idx_radar_sig_type ON radar_signal_tracking(signal_type);
    CREATE INDEX IF NOT EXISTS idx_radar_sig_date ON radar_signal_tracking(signal_date);
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const maxAgeDays = Math.max(7, Math.min(180, Number(body?.max_age_days ?? 45)));
    // FIX (FIX-API-MARKET #7): read optional `market` from the request body so
    // callers can verify signals for non-EGX markets. Defaults to EGX to preserve
    // existing behaviour.
    const market: CanonicalMarket = normalizeMarket(body?.market) || 'EGX';

    const db = await openTrackerDb();
    if (!db) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Cannot open tracker DB at db/stocks.db or db/data_engine.db',
        },
        { status: 503 }
      );
    }

    try {
      // ── 1. Select pending signals in the verification window ─────────
      const pendingRows = db
        .prepare(
          `SELECT id, ticker, signal_date, entry_price
           FROM radar_signal_tracking
           WHERE status = 'pending'
             AND signal_date <= date('now', '-7 days')
             AND signal_date >= date('now', '-${maxAgeDays} days')
           ORDER BY signal_date ASC
           LIMIT 500`
        )
        .all() as any[];

      if (pendingRows.length === 0) {
        db.close();
        return NextResponse.json({
          success: true,
          verified_count: 0,
          win_count: 0,
          loss_count: 0,
          neutral_count: 0,
          pending_partial_count: 0,
          errors: [],
          message: 'لا توجد إشارات بانتظار التحقق في النطاق المحدد',
        });
      }

      // ── 2. Verify each pending signal ────────────────────────────────
      const updateStmt = db.prepare(
        `UPDATE radar_signal_tracking
         SET outcome_7d = ?, outcome_14d = ?, outcome_30d = ?,
             max_price_after = ?, min_price_after = ?,
             status = ?, verified_at = ?
         WHERE id = ?`
      );

      let verifiedCount = 0;
      let winCount = 0;
      let lossCount = 0;
      let neutralCount = 0;
      let pendingPartialCount = 0;
      const errors: { id: number; ticker: string; signal_date: string; error: string }[] = [];

      const nowIso = new Date().toISOString();

      for (const row of pendingRows) {
        const id = row.id as number;
        const ticker = String(row.ticker);
        const signalDate = String(row.signal_date);
        const entryPrice = Number(row.entry_price);
        if (!isFinite(entryPrice) || entryPrice <= 0) {
          errors.push({
            id,
            ticker,
            signal_date: signalDate,
            error: 'invalid entry_price',
          });
          continue;
        }

        try {
          // Fetch up to 30 trading days after signal_date.
          const { prices } = await fetchPricesAfter(ticker, signalDate, 30, market);
          if (prices.length === 0) {
            // No price data available yet — leave as pending.
            continue;
          }

          // ── Outcome calculations ────────────────────────────────────
          // outcome_Nd = ((close_at_Nd - entry) / entry) * 100
          // We treat prices[0] as day-1 after signal, prices[6] as day-7, etc.
          const outcome7d =
            prices.length >= 7 && prices[6].close > 0
              ? ((prices[6].close - entryPrice) / entryPrice) * 100
              : null;
          const outcome14d =
            prices.length >= 14 && prices[13].close > 0
              ? ((prices[13].close - entryPrice) / entryPrice) * 100
              : null;
          const outcome30d =
            prices.length >= 30 && prices[29].close > 0
              ? ((prices[29].close - entryPrice) / entryPrice) * 100
              : null;

          // ── Max / min excursion (true range after signal) ──────────
          const highs = prices.map((p) => p.high).filter((v) => v > 0);
          const lows = prices.map((p) => p.low).filter((v) => v > 0);
          const maxPrice = highs.length > 0 ? Math.max(...highs) : null;
          const minPrice = lows.length > 0 ? Math.min(...lows) : null;

          // ── Determine new status ──────────────────────────────────
          let newStatus = 'pending';
          let verifiedAt: string | null = null;
          if (outcome30d != null) {
            if (outcome30d > 0.5) {
              newStatus = 'verified_win';
              winCount++;
            } else if (outcome30d < -0.5) {
              newStatus = 'verified_loss';
              lossCount++;
            } else {
              newStatus = 'verified_neutral';
              neutralCount++;
            }
            verifiedAt = nowIso;
            verifiedCount++;
          } else {
            // Partial outcomes available — keep pending but record metrics.
            newStatus = 'pending';
            pendingPartialCount++;
          }

          updateStmt.run(
            outcome7d,
            outcome14d,
            outcome30d,
            maxPrice,
            minPrice,
            newStatus,
            verifiedAt,
            id
          );
        } catch (e: any) {
          errors.push({
            id,
            ticker,
            signal_date: signalDate,
            error: e?.message || 'verify error',
          });
        }
      }

      db.close();

      return NextResponse.json({
        success: true,
        verified_count: verifiedCount,
        win_count: winCount,
        loss_count: lossCount,
        neutral_count: neutralCount,
        pending_partial_count: pendingPartialCount,
        scanned_count: pendingRows.length,
        errors,
        verified_at: nowIso,
      });
    } catch (error: any) {
      try { db.close(); } catch {}
      throw error;
    }
  } catch (error: any) {
    console.error('[signal-tracker/verify] error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function num(v: any): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

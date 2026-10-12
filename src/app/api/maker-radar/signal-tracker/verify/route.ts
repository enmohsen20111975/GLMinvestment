import { NextRequest, NextResponse } from 'next/server';
// P0-14-ASYNC fix (2026-09-27): replaced sync existsSync with async access
// from fs/promises in fetchPricesAfter / openTrackerDb so the verify POST
// handler never blocks the event loop per price-source candidate.
import { access } from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/maker-radar/signal-tracker/verify
 * body: { max_age_days?: 45 }
 *
 * Verifies pending radar signals (GLM5.2-RADAR-S2-VERIFY-ENGINE):
 *   1. SELECT pending signals between 7 and max_age_days (default 45) old.
 *   2. For each, fetch up to 30 trading days of prices AFTER the signal_date
 *      from `stock_daily_prices` (db/stocks.db).
 *   3. Compute outcome_7d / outcome_14d / outcome_30d (% return vs entry_price)
 *      using the threshold logic below.
 *   4. Track max_price_after / min_price_after (true excursion).
 *   5. Update status:
 *        - No price data in stock_daily_prices → status='stale_data'
 *          (NOT verified; keep outcome_* NULL).
 *        - Stop-loss breach: min_price_after <= entry_price * 0.95
 *          → status='verified_loss' (independent of horizon).
 *        - outcome_7d: FIRST close in trading days 1..7 with pct >= +2.5%
 *          → status='verified_win' (early exit).
 *        - outcome_14d: FIRST close in trading days 1..14 with pct >= +4.0%
 *          → status='verified_win' (mid-horizon exit).
 *        - outcome_30d: ((close_30d - entry) / entry) * 100 (only when 30
 *          trading days have elapsed).
 *        - If outcome_30d available:
 *            outcome_30d >= +2.5% → verified_win
 *            outcome_30d <= -5.0% → verified_loss
 *            else → verified_neutral
 *        - Otherwise → keep 'pending' (record partial outcomes only).
 *   6. Return summary.
 *
 * Thresholds (GLM5.2-RADAR-S2):
 *   WIN_7D_PCT    = +2.5    // 7-day  early-win threshold
 *   WIN_14D_PCT   = +4.0    // 14-day mid-win   threshold
 *   STOP_LOSS_PCT = -5.0    // stop-loss breach (any day)
 *   NEUTRAL_LO  = -5.0     // 30d lower bound for "win" zone
 *   NEUTRAL_HI  = +2.5     // 30d upper bound for "loss" zone
 */

const PROJECT_ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────
// Price-source resolver — tries multiple DB schemas (same pattern as radar-db)
//
// NOTE (GLM5.2-RADAR-S2): `db/price_history.db` is MALFORMED
// ("database disk image is malformed") and cannot be used. The authoritative
// source of EGX / US daily prices is `stock_daily_prices` in `db/stocks.db`
// (100,619 candles; ticker, price_date, open, high, low, close, volume).
// It is therefore listed FIRST. `high`/`low` may be NULL on some rows — callers
// must fall back to `close` when high/low are absent (handled in fetchPricesAfter).
// ─────────────────────────────────────────────────────────────────────────────

interface PriceSource {
  dbPath: string;
  table: string;
  tickerCol: string;
  dateCol: string;
  closeCol: string;
  highCol: string;
  lowCol: string;
}

const PRICE_SOURCES: PriceSource[] = [
  // 1. stocks.db.stock_daily_prices (PRIMARY — 100,619 candles)
  //    price_history.db is malformed; this is the authoritative source.
  {
    dbPath: path.join(PROJECT_ROOT, 'db', 'stocks.db'),
    table: 'stock_daily_prices',
    tickerCol: 'ticker',
    dateCol: 'price_date',
    closeCol: 'close',
    highCol: 'high',
    lowCol: 'low',
  },
  // 2. data_engine.db.egksco_price_history (price_date column)
  {
    dbPath: path.join(PROJECT_ROOT, 'db', 'data_engine.db'),
    table: 'egksco_price_history',
    tickerCol: 'symbol',
    dateCol: 'price_date',
    closeCol: 'close_price',
    highCol: 'high_price',
    lowCol: 'low_price',
  },
  // 3. stocks.db.egksco_price_history (date column — different schema!)
  {
    dbPath: path.join(PROJECT_ROOT, 'db', 'stocks.db'),
    table: 'egksco_price_history',
    tickerCol: 'symbol',
    dateCol: 'date',
    closeCol: 'close_price',
    highCol: 'high_price',
    lowCol: 'low_price',
  },
  // 4. data_engine.db.historical_data (non-EGX fallback)
  {
    dbPath: path.join(PROJECT_ROOT, 'db', 'data_engine.db'),
    table: 'historical_data',
    tickerCol: 'symbol',
    dateCol: 'date',
    closeCol: 'close',
    highCol: 'high',
    lowCol: 'low',
  },
];

// Verification thresholds (percent, signed — gains are positive, losses negative).
const WIN_7D_PCT = 2.5;
const WIN_14D_PCT = 4.0;
const STOP_LOSS_PCT = -5.0;
const NEUTRAL_LO_PCT = -5.0; // outcome_30d <= this  → verified_loss
const NEUTRAL_HI_PCT = 2.5;  // outcome_30d >= this  → verified_win

interface PricePoint {
  date: string;
  close: number;
  high: number;
  low: number;
}

/** Fetch up to `limit` trading-day prices strictly AFTER signalDate for ticker. */
// P0-14-ASYNC fix (2026-09-27): now async — uses access() instead of existsSync
// per candidate DB so the event loop is not blocked.
async function fetchPricesAfter(
  ticker: string,
  signalDate: string,
  limit: number
): Promise<{ prices: PricePoint[]; source: string | null }> {
  for (const src of PRICE_SOURCES) {
    try {
      await access(src.dbPath);
    } catch { // silent fallback (safe-by-design)
      continue;
    }
    let db: Database.Database | null = null;
    try {
      db = new Database(src.dbPath, { readonly: true, fileMustExist: true });
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
      const rows = db
        .prepare(
          `SELECT ${src.dateCol} AS d, ${src.closeCol} AS c,
                  ${src.highCol} AS h, ${src.lowCol} AS l
           FROM ${src.table}
           WHERE ${src.tickerCol} = ?
             AND ${src.dateCol} > ?
             AND ${src.closeCol} IS NOT NULL
             AND ${src.closeCol} > 0
           ORDER BY ${src.dateCol} ASC
           LIMIT ?`
        )
        .all(ticker, signalDate, limit) as any[];

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
      try { if (db) db.close(); } catch { /* safe-by-design */ }
      continue;
    }
  }
  return { prices: [], source: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracker DB resolver — reuses the radar-db pattern (prefer stocks.db)
// ─────────────────────────────────────────────────────────────────────────────

const TRACKER_DB_CANDIDATES = [
  path.join(PROJECT_ROOT, 'db', 'stocks.db'),
  path.join(PROJECT_ROOT, 'db', 'data_engine.db'),
];

// P0-14-ASYNC fix (2026-09-27): openTrackerDb is now async — uses access().
async function openTrackerDb(): Promise<Database.Database | null> {
  for (const p of TRACKER_DB_CANDIDATES) {
    try {
      await access(p);
      const db = new Database(p);
      ensureSchema(db);
      return db;
    } catch { // silent fallback (safe-by-design)
      // try next candidate
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
    } catch { // silent fallback (safe-by-design)
      body = {};
    }
    const maxAgeDays = Math.max(7, Math.min(180, Number(body?.max_age_days ?? 45)));

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
      // GLM5.2-RADAR-S2: include NULL status (defensive — schema defaults
      // to 'pending', but NULL rows are treated as pending for safety).
      // stale_data rows are intentionally excluded (entry_price unreliable
      // per backfill_stale_radar_signals.py).
      const pendingRows = db
        .prepare(
          `SELECT id, ticker, signal_date, entry_price
           FROM radar_signal_tracking
           WHERE (status = 'pending' OR status IS NULL)
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
          stale_count: 0,
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
      let staleCount = 0;
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
          const { prices } = await fetchPricesAfter(ticker, signalDate, 30);

          // ── Stale data: NO price data in stock_daily_prices → keep stale ──
          // Rule 27 (NO-FAKE-DATA): never fabricate prices. If we have zero
          // rows for this ticker after signal_date, mark it stale_data so it
          // is NOT counted as verified.
          if (prices.length === 0) {
            updateStmt.run(
              null, // outcome_7d
              null, // outcome_14d
              null, // outcome_30d
              null, // max_price_after
              null, // min_price_after
              'stale_data',
              null, // verified_at — NOT verified
              id
            );
            staleCount++;
            continue;
          }

          // ── Outcome calculations ────────────────────────────────────
          // GLM5.2-RADAR-S2 thresholds:
          //   outcome_7d  = FIRST close in trading days 1..7  with pct >= +2.5%
          //   outcome_14d = FIRST close in trading days 1..14 with pct >= +4.0%
          //   outcome_30d = ((close_30d - entry) / entry) * 100  (only if 30d elapsed)
          // pct = ((close - entry) / entry) * 100
          const firstWin7d = prices
            .slice(0, 7)
            .find((p) => p.close > 0 && ((p.close - entryPrice) / entryPrice) * 100 >= WIN_7D_PCT);
          const outcome7d = firstWin7d
            ? ((firstWin7d.close - entryPrice) / entryPrice) * 100
            : null;

          const firstWin14d = prices
            .slice(0, 14)
            .find((p) => p.close > 0 && ((p.close - entryPrice) / entryPrice) * 100 >= WIN_14D_PCT);
          const outcome14d = firstWin14d
            ? ((firstWin14d.close - entryPrice) / entryPrice) * 100
            : null;

          const outcome30d =
            prices.length >= 30 && prices[29].close > 0
              ? ((prices[29].close - entryPrice) / entryPrice) * 100
              : null;

          // ── Max / min excursion (true range after signal) ──────────
          // high/low may be NULL in stock_daily_prices — caller already
          // falls back to close in fetchPricesAfter, so this is safe.
          const highs = prices.map((p) => p.high).filter((v) => v > 0);
          const lows = prices.map((p) => p.low).filter((v) => v > 0);
          const maxPrice = highs.length > 0 ? Math.max(...highs) : null;
          const minPrice = lows.length > 0 ? Math.min(...lows) : null;

          // ── Determine new status ──────────────────────────────────
          // Priority order (highest first):
          //   1. Stop-loss breach (any day): min_price_after <= entry * (1 + STOP_LOSS_PCT/100)
          //      → verified_loss (independent of horizon)
          //   2. outcome_7d (early-win ≥ +2.5% within 7 days) → verified_win
          //   3. outcome_14d (mid-win ≥ +4.0% within 14 days) → verified_win
          //   4. outcome_30d available → win/loss/neutral by threshold
          //   5. else → keep pending (record partial outcomes)
          let newStatus = 'pending';
          let verifiedAt: string | null = null;

          const stopLossTriggered =
            minPrice != null &&
            minPrice > 0 &&
            minPrice <= entryPrice * (1 + STOP_LOSS_PCT / 100);

          if (stopLossTriggered) {
            newStatus = 'verified_loss';
            verifiedAt = nowIso;
            lossCount++;
            verifiedCount++;
          } else if (outcome7d != null) {
            newStatus = 'verified_win';
            verifiedAt = nowIso;
            winCount++;
            verifiedCount++;
          } else if (outcome14d != null) {
            newStatus = 'verified_win';
            verifiedAt = nowIso;
            winCount++;
            verifiedCount++;
          } else if (outcome30d != null) {
            if (outcome30d >= NEUTRAL_HI_PCT) {
              newStatus = 'verified_win';
              winCount++;
            } else if (outcome30d <= NEUTRAL_LO_PCT) {
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
        stale_count: staleCount,
        pending_partial_count: pendingPartialCount,
        scanned_count: pendingRows.length,
        errors,
        verified_at: nowIso,
      });
    } catch (error: any) {
      try { db.close(); } catch { /* safe-by-design */ }
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

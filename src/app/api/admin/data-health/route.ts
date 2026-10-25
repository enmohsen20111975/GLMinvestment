import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/data-health
 * ==========================
 * FRONTEND-1 (Data Health Dashboard — backend probe).
 *
 * Surfaces backend data freshness to the frontend by querying the four
 * local SQLite databases that the Python data engine + Next.js share:
 *
 *   1. stocks.db           — stocks, stock_daily_prices
 *   2. price_history.db    — price_history (long-term OHLCV)
 *   3. intraday.db         — stock_intraday (today's ticks)
 *   4. data_engine.db      — egksco_stocks, historical_data (freeze check)
 *
 * Returns a JSON health report grouped by market (EGX / TADAWUL / KSE / QSE / US)
 * with a per-source freshness cell + an overall GREEN/YELLOW/RED verdict.
 *
 * The route is READ-ONLY — every query is a SELECT. We use `openDb` from
 * `@/lib/shared-db` which opens the DBs in read-write mode so the WAL journal
 * the Python service maintains can reconcile (better-sqlite3 readonly mode
 * throws "file is not a database" when WAL pages are mid-checkpoint). We never
 * execute any INSERT/UPDATE/DELETE — `openDb`'s read-write open is purely for
 * WAL reconciliation, as documented in shared-db.ts.
 *
 * Auth:
 *   - Admin via `requireAdminAsync` (cookie/token/NextAuth/localhost-bypass).
 *   - `?public=1` query param bypasses admin auth so a public trust badge
 *     can read the same JSON on the liquidity radar screen without a session.
 */

import { openDb, safeQuery, safeQueryOne } from '@/lib/shared-db';
import { requireAdminAsync } from '@/lib/admin-guard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HealthLevel = 'GREEN' | 'YELLOW' | 'RED';
type CellLevel = 'fresh' | 'aging' | 'stale' | 'unknown';

interface MarketStocks {
  active: number;
  fresh: number;
  stale: number;
  latest_update: string | null;
}

interface MarketDailyPrices {
  latest: string | null;
  rows_today: number;
  rows_total: number;
}

interface MarketPriceHistory {
  latest: string | null;
  rows: number;
  sampled_tickers: number;
  frozen: boolean;
}

interface MarketIntraday {
  tickers_today: number;
  rows_today: number;
  latest_today: string | null;
  latest_any: string | null;
  tickers_any: number;
}

interface MarketHistoricalData {
  latest: string | null;
  rows: number;
  frozen: boolean;
}

interface MarketHealth {
  stocks: MarketStocks;
  daily_prices: MarketDailyPrices;
  price_history: MarketPriceHistory;
  intraday: MarketIntraday;
  historical_data: MarketHistoricalData;
}

interface EgkscoStocks {
  rows: number;
  latest: string | null;
  expected: number;
  ok: boolean;
  status: 'healthy' | 'stale' | 'empty';
}

interface Summary {
  total_active: number;
  total_fresh: number;
  total_stale: number;
  frozen_markets: string[];
}

interface DataHealthResponse {
  success: boolean;
  timestamp: string;
  markets: Record<string, MarketHealth>;
  egksco_stocks: EgkscoStocks;
  overall_health: HealthLevel;
  overall_health_ar: string;
  summary: Summary;
  errors: string[];
  error?: 'db_locked';
  partial: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPECTED_EGKSCO_ROWS = 1205; // FIX-3 target (per worklog 2026-10-22)

const HEALTH_AR: Record<HealthLevel, string> = {
  GREEN: 'أخضر',
  YELLOW: 'أصفر',
  RED: 'أحمر',
};

/**
 * Classify a date/datetime string by age.
 *   fresh   = within 3 days
 *   aging   = 4-7 days
 *   stale   = older than 7 days (or NULL)  — matches "frozen" threshold
 *   unknown = parse error
 */
function classifyAge(dateStr: string | null | undefined): CellLevel {
  if (!dateStr) return 'stale';
  // Accept both 'YYYY-MM-DD' and ISO 'YYYY-MM-DDTHH:MM:SS'
  const iso = dateStr.length >= 10 ? dateStr.slice(0, 10) : dateStr;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return 'unknown';
  const ageDays = (Date.now() - t) / (24 * 60 * 60 * 1000);
  if (ageDays <= 3) return 'fresh';
  if (ageDays <= 7) return 'aging';
  return 'stale';
}

/**
 * Roll up the per-market cells into an overall health verdict.
 *   RED    = any market's price_history frozen (older than 7 days)
 *            OR egksco_stocks empty
 *            OR any cell stale
 *   YELLOW = 1-2 sources stale/aging
 *   GREEN  = all markets have price_history latest >= today-3 AND
 *            egksco_stocks.rows > 1000 AND all intraday markets have
 *            tickers_today > 0
 */
function computeOverallHealth(
  markets: Record<string, MarketHealth>,
  egksco: EgkscoStocks,
): HealthLevel {
  // Hard-fail conditions → RED.
  if (egksco.rows === 0) return 'RED';

  let staleCount = 0;
  let anyAging = false;
  let allIntradayFresh = true;

  for (const m of Object.values(markets)) {
    if (m.price_history.frozen) return 'RED';

    const phLevel = classifyAge(m.price_history.latest);
    if (phLevel === 'stale' || phLevel === 'unknown') staleCount++;
    else if (phLevel === 'aging') anyAging = true;

    const stLevel = classifyAge(m.stocks.latest_update);
    if (stLevel === 'stale' || stLevel === 'unknown') staleCount++;
    else if (stLevel === 'aging') anyAging = true;

    if (m.intraday.tickers_today === 0) allIntradayFresh = false;
  }

  if (staleCount >= 3) return 'RED';
  if (staleCount >= 1 || anyAging) return 'YELLOW';

  // GREEN requires both egksco well-populated AND intraday live for every market.
  if (egksco.rows > 1000 && allIntradayFresh) return 'GREEN';
  return 'YELLOW';
}

function egkscoStatus(rows: number, latest: string | null): EgkscoStocks['status'] {
  if (rows === 0) return 'empty';
  if (classifyAge(latest) === 'stale') return 'stale';
  return 'healthy';
}

function isLockedError(msg: string): boolean {
  return (
    msg.includes('database is locked') ||
    msg.includes('SQLITE_BUSY') ||
    msg.includes('database is locked') ||
    msg.includes('file is not a database') ||
    msg.includes('SQLITE_NOTADB')
  );
}

/**
 * Open a DB with graceful fallback. Returns null if the file is missing
 * or cannot be opened — the caller records the error and continues with
 * partial data instead of failing the whole response.
 */
function tryOpen(name: string, errors: string[]): ReturnType<typeof openDb> | null {
  try {
    return openDb(name);
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    errors.push(`${name}: open failed — ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-DB probes
// ---------------------------------------------------------------------------

interface StocksProbe {
  byMarket: Record<string, {
    active: number;
    fresh: number;
    stale: number;
    latest_update: string | null;
  }>;
  dailyPricesByMarket: Record<string, { latest: string | null; rows_total: number }>;
  dailyPricesTodayByMarket: Record<string, number>;
  tickerByMarket: Record<string, string[]>;
}

function probeStocksDb(errors: string[]): StocksProbe | null {
  const db = tryOpen('stocks.db', errors);
  if (!db) return null;

  const byMarket: StocksProbe['byMarket'] = {};
  const dailyPricesByMarket: StocksProbe['dailyPricesByMarket'] = {};
  const dailyPricesTodayByMarket: StocksProbe['dailyPricesTodayByMarket'] = {};
  const tickerByMarket: StocksProbe['tickerByMarket'] = {};

  try {
    // (1) Active / fresh / stale counts + latest last_update per market.
    const rows = safeQuery<{
      market: string;
      active: number;
      fresh: number;
      stale: number;
    }>(
      db,
      `SELECT market,
              COUNT(*)                                              AS active,
              SUM(CASE WHEN strftime('%Y-%m-%d', last_update)
                            >= date('now','-3 days') THEN 1 ELSE 0 END) AS fresh,
              SUM(CASE WHEN last_update IS NULL
                            OR strftime('%Y-%m-%d', last_update)
                               < date('now','-14 days') THEN 1 ELSE 0 END) AS stale
         FROM stocks
        WHERE is_active = 1
        GROUP BY market`,
    );
    for (const r of rows) {
      byMarket[r.market] = {
        active: r.active ?? 0,
        fresh: r.fresh ?? 0,
        stale: r.stale ?? 0,
        latest_update: null,
      };
    }

    // Latest last_update per market (string max works for ISO timestamps).
    const latestRows = safeQuery<{ market: string; latest: string | null }>(
      db,
      `SELECT market, MAX(last_update) AS latest
         FROM stocks
        WHERE is_active = 1
        GROUP BY market`,
    );
    for (const r of latestRows) {
      if (byMarket[r.market]) {
        byMarket[r.market].latest_update = r.latest;
      }
    }

    // (2) Per-market ticker list (sample up to 100 per market for the
    // price_history probe). Used to map tickers → markets since
    // price_history.db has no market column.
    const tickerRows = safeQuery<{ market: string; ticker: string }>(
      db,
      `SELECT market, ticker
         FROM stocks
        WHERE is_active = 1
        ORDER BY market, ticker`,
    );
    for (const r of tickerRows) {
      if (!tickerByMarket[r.market]) tickerByMarket[r.market] = [];
      tickerByMarket[r.market].push(r.ticker);
    }

    // (3) stock_daily_prices — has a `market` column. Total rows + latest
    // price_date per market.
    const dpRows = safeQuery<{ market: string; latest: string | null; rows: number }>(
      db,
      `SELECT market,
              MAX(price_date) AS latest,
              COUNT(*)        AS rows
         FROM stock_daily_prices
        GROUP BY market`,
    );
    for (const r of dpRows) {
      dailyPricesByMarket[r.market] = { latest: r.latest, rows_total: r.rows ?? 0 };
    }

    // (4) Daily prices today per market (rows inserted in the last 24h window).
    const dpTodayRows = safeQuery<{ market: string; rows: number }>(
      db,
      `SELECT market,
              COUNT(*) AS rows
         FROM stock_daily_prices
        WHERE price_date >= date('now','-1 day')
        GROUP BY market`,
    );
    for (const r of dpTodayRows) {
      dailyPricesTodayByMarket[r.market] = r.rows ?? 0;
    }
  } catch (err) {
    errors.push(`stocks.db: query failed — ${String((err as Error)?.message || err)}`);
  }

  return {
    byMarket,
    dailyPricesByMarket,
    dailyPricesTodayByMarket,
    tickerByMarket,
  };
}

function probePriceHistoryDb(
  tickerByMarket: Record<string, string[]>,
  errors: string[],
): Record<string, { latest: string | null; rows: number; sampled: number; frozen: boolean }> | null {
  const db = tryOpen('price_history.db', errors);
  if (!db) return null;

  const out: Record<string, { latest: string | null; rows: number; sampled: number; frozen: boolean }> = {};

  try {
    for (const [market, allTickers] of Object.entries(tickerByMarket)) {
      // Sample up to 100 tickers per market — keeps the IN-clause small
      // and the COUNT(*) fast. Stratified by every Nth ticker so the
      // sample isn't biased to alphabetically-early tickers.
      const SAMPLE_SIZE = 100;
      const sampled: string[] = [];
      if (allTickers.length <= SAMPLE_SIZE) {
        sampled.push(...allTickers);
      } else {
        const step = allTickers.length / SAMPLE_SIZE;
        for (let i = 0; i < SAMPLE_SIZE; i++) {
          sampled.push(allTickers[Math.floor(i * step)]);
        }
      }
      if (sampled.length === 0) {
        out[market] = { latest: null, rows: 0, sampled: 0, frozen: true };
        continue;
      }
      const placeholders = sampled.map(() => '?').join(',');
      const row = safeQueryOne<{ latest: string | null; rows: number }>(
        db,
        `SELECT MAX(date)  AS latest,
                COUNT(*)   AS rows
           FROM price_history
          WHERE ticker IN (${placeholders})`,
        sampled,
      );
      const latest = row?.latest ?? null;
      out[market] = {
        latest,
        rows: row?.rows ?? 0,
        sampled: sampled.length,
        // "frozen" = no fresh rows in the last 7 days for this market's sample.
        frozen: classifyAge(latest) === 'stale' || classifyAge(latest) === 'unknown',
      };
    }
  } catch (err) {
    errors.push(`price_history.db: query failed — ${String((err as Error)?.message || err)}`);
  }

  return out;
}

function probeIntradayDb(
  errors: string[],
): Record<string, {
  tickers_today: number;
  rows_today: number;
  latest_today: string | null;
  latest_any: string | null;
  tickers_any: number;
}> | null {
  const db = tryOpen('intraday.db', errors);
  if (!db) return null;

  const out: Record<string, {
    tickers_today: number;
    rows_today: number;
    latest_today: string | null;
    latest_any: string | null;
    tickers_any: number;
  }> = {};

  try {
    // Today's intraday ticks per market.
    const todayRows = safeQuery<{
      market: string;
      tickers: number;
      latest: string | null;
      rows: number;
    }>(
      db,
      `SELECT market,
              COUNT(DISTINCT ticker) AS tickers,
              MAX(timestamp)         AS latest,
              COUNT(*)               AS rows
         FROM stock_intraday
        WHERE DATE(timestamp) = DATE('now')
        GROUP BY market`,
    );
    for (const r of todayRows) {
      out[r.market] = {
        tickers_today: r.tickers ?? 0,
        rows_today: r.rows ?? 0,
        latest_today: r.latest,
        latest_any: null,
        tickers_any: 0,
      };
    }

    // All-time intraday per market (so the cell still shows something even
    // if today is a market holiday or the cron hasn't run yet today).
    const anyRows = safeQuery<{
      market: string;
      tickers: number;
      latest: string | null;
    }>(
      db,
      `SELECT market,
              COUNT(DISTINCT ticker) AS tickers,
              MAX(timestamp)         AS latest
         FROM stock_intraday
        GROUP BY market`,
    );
    for (const r of anyRows) {
      if (!out[r.market]) {
        out[r.market] = {
          tickers_today: 0,
          rows_today: 0,
          latest_today: null,
          latest_any: r.latest,
          tickers_any: r.tickers ?? 0,
        };
      } else {
        out[r.market].latest_any = r.latest;
        out[r.market].tickers_any = r.tickers ?? 0;
      }
    }
  } catch (err) {
    errors.push(`intraday.db: query failed — ${String((err as Error)?.message || err)}`);
  }

  return out;
}

function probeDataEngineDb(
  errors: string[],
): {
  egksco: EgkscoStocks;
  historicalByMarket: Record<string, { latest: string | null; rows: number; frozen: boolean }>;
} | null {
  const db = tryOpen('data_engine.db', errors);
  if (!db) return null;

  let egkscoRows = 0;
  let egkscoLatest: string | null = null;
  const historicalByMarket: Record<string, { latest: string | null; rows: number; frozen: boolean }> = {};

  try {
    const egkscoCount = safeQueryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM egksco_stocks`,
    );
    egkscoRows = egkscoCount?.c ?? 0;

    const egkscoLatestRow = safeQueryOne<{ latest: string | null }>(
      db,
      `SELECT MAX(last_updated) AS latest FROM egksco_stocks`,
    );
    egkscoLatest = egkscoLatestRow?.latest ?? null;
  } catch (err) {
    errors.push(`data_engine.db.egksco_stocks: ${String((err as Error)?.message || err)}`);
  }

  try {
    // historical_data has a `market` column — freeze check (any market where
    // the latest date is older than 7 days = a frozen scraper).
    const histRows = safeQuery<{ market: string; latest: string | null; rows: number }>(
      db,
      `SELECT market, MAX(date) AS latest, COUNT(*) AS rows
         FROM historical_data
        GROUP BY market`,
    );
    for (const r of histRows) {
      historicalByMarket[r.market] = {
        latest: r.latest,
        rows: r.rows ?? 0,
        frozen: classifyAge(r.latest) === 'stale' || classifyAge(r.latest) === 'unknown',
      };
    }
  } catch (err) {
    errors.push(`data_engine.db.historical_data: ${String((err as Error)?.message || err)}`);
  }

  const egkscoOk =
    egkscoRows >= EXPECTED_EGKSCO_ROWS * 0.9 && // allow 10% slack (cleansing churn)
    classifyAge(egkscoLatest) !== 'stale';

  return {
    egksco: {
      rows: egkscoRows,
      latest: egkscoLatest,
      expected: EXPECTED_EGKSCO_ROWS,
      ok: egkscoOk,
      status: egkscoStatus(egkscoRows, egkscoLatest),
    },
    historicalByMarket,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Auth — admin-only, UNLESS `?public=1` is set (for the public trust badge).
  const url = new URL(request.url);
  const isPublic = url.searchParams.get('public') === '1';
  if (!isPublic) {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;
  }

  const errors: string[] = [];

  // Probe each DB independently so a single DB failure doesn't kill the
  // whole response. We always return 200 with `partial: true` if any DB
  // was unavailable.
  const stocksProbe = probeStocksDb(errors);
  const intradayProbe = probeIntradayDb(errors);
  const dataEngineProbe = probeDataEngineDb(errors);
  const priceHistoryProbe = stocksProbe
    ? probePriceHistoryDb(stocksProbe.tickerByMarket, errors)
    : null;

  // Build the unified per-market report.
  const allMarkets = new Set<string>([
    'EGX', 'TADAWUL', 'KSE', 'QSE', 'US',
  ]);
  if (stocksProbe) {
    for (const m of Object.keys(stocksProbe.byMarket)) allMarkets.add(m);
  }
  if (intradayProbe) {
    for (const m of Object.keys(intradayProbe)) allMarkets.add(m);
  }
  if (dataEngineProbe) {
    for (const m of Object.keys(dataEngineProbe.historicalByMarket)) allMarkets.add(m);
  }

  const markets: Record<string, MarketHealth> = {};
  let totalActive = 0;
  let totalFresh = 0;
  let totalStale = 0;
  const frozenMarkets: string[] = [];

  for (const market of Array.from(allMarkets).sort()) {
    const s = stocksProbe?.byMarket[market];
    const dp = stocksProbe?.dailyPricesByMarket[market];
    const dpToday = stocksProbe?.dailyPricesTodayByMarket[market] ?? 0;
    const ph = priceHistoryProbe?.[market];
    const inP = intradayProbe?.[market];
    const hd = dataEngineProbe?.historicalByMarket[market];

    totalActive += s?.active ?? 0;
    totalFresh += s?.fresh ?? 0;
    totalStale += s?.stale ?? 0;

    if (ph?.frozen) frozenMarkets.push(`price_history:${market}`);
    if (hd?.frozen) frozenMarkets.push(`historical_data:${market}`);

    markets[market] = {
      stocks: {
        active: s?.active ?? 0,
        fresh: s?.fresh ?? 0,
        stale: s?.stale ?? 0,
        latest_update: s?.latest_update ?? null,
      },
      daily_prices: {
        latest: dp?.latest ?? null,
        rows_today: dpToday,
        rows_total: dp?.rows_total ?? 0,
      },
      price_history: {
        latest: ph?.latest ?? null,
        rows: ph?.rows ?? 0,
        sampled_tickers: ph?.sampled ?? 0,
        frozen: ph?.frozen ?? true,
      },
      intraday: {
        tickers_today: inP?.tickers_today ?? 0,
        rows_today: inP?.rows_today ?? 0,
        latest_today: inP?.latest_today ?? null,
        latest_any: inP?.latest_any ?? null,
        tickers_any: inP?.tickers_any ?? 0,
      },
      historical_data: {
        latest: hd?.latest ?? null,
        rows: hd?.rows ?? 0,
        frozen: hd?.frozen ?? true,
      },
    };
  }

  const egksco: EgkscoStocks = dataEngineProbe?.egksco ?? {
    rows: 0,
    latest: null,
    expected: EXPECTED_EGKSCO_ROWS,
    ok: false,
    status: 'empty',
  };

  const overall_health = computeOverallHealth(markets, egksco);

  // If any error looks like a DB lock, flag it at the top level too so the
  // public badge can show a "partial" state without scaring users.
  const lockedFlag = errors.some(isLockedError) ? 'db_locked' as const : undefined;

  const body: DataHealthResponse = {
    success: true,
    timestamp: new Date().toISOString(),
    markets,
    egksco_stocks: egksco,
    overall_health,
    overall_health_ar: HEALTH_AR[overall_health],
    summary: {
      total_active: totalActive,
      total_fresh: totalFresh,
      total_stale: totalStale,
      frozen_markets: frozenMarkets,
    },
    errors,
    partial: errors.length > 0,
    ...(lockedFlag ? { error: lockedFlag } : {}),
  };

  return NextResponse.json(body, {
    headers: {
      // Always-fresh — this endpoint is a live probe.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

// Exported for potential unit-test reuse (not required by route contract).
export const __test = {
  classifyAge,
  computeOverallHealth,
  egkscoStatus,
  EXPECTED_EGKSCO_ROWS,
};

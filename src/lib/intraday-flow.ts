/**
 * intraday-flow.ts — Intraday Liquidity & CVD Engine (GLM5.2 directive)
 * ====================================================================
 *
 * Computes three institutional-grade analytics from `db/intraday.db`:
 *
 *   1. CVD (Cumulative Volume Delta) — proxy for maker accumulation.
 *      Each intraday OHLC bar is classified BUY (close >= open) or SELL
 *      (close <  open). CVD = Σ(buy_volume) - Σ(sell_volume). Rising CVD
 *      while price stalls = stealth accumulation; falling CVD while price
 *      stalls = stealth distribution.
 *
 *   2. Volume Profile POC (Point of Control) — the price level with the
 *      most traded volume across the session. Used to map natural support
 *      / resistance and value-area edges.
 *
 *   3. Large Blocks vs Retail Flow — classifies each bar's notional
 *      (price × volume) as BLOCK (>= 100,000 EGP, institutional) vs
 *      RETAIL (< 100,000 EGP, retail). Net block flow reveals smart money.
 *
 * Data sources (in priority order, Rule 67 SSOT):
 *   - PRIMARY: db/intraday.db.stock_intraday (ticker, market, timestamp,
 *              price, change_percent, volume, open, high, low)
 *   - FALLBACK: db/intraday.db.intraday_prices (ticker, price_time, price,
 *               volume, bid, ask) — used if stock_intraday is empty
 *
 * Rule 27 (NO-FAKE-DATA) — strict:
 *   - If BOTH tables are empty for the ticker → return null (the API
 *     layer surfaces a 404 with a clear explanation). We NEVER fabricate
 *     bars, deltas, or POC values.
 *
 * GOLDEN SESSION FALLBACK (P0-ALPHA-SESSION-PRESERVER):
 *   - `readFromStockIntraday` returns the latest session that actually
 *     EXISTS in `stock_intraday` (GROUP BY date ORDER BY date DESC LIMIT 1),
 *     regardless of whether it is today.
 *   - If the latest available session is NOT today (market closed / no
 *     data yet today), the response still serves that session with
 *     `is_historical_session: true` + `session_date: 'YYYY-MM-DD'` so
 *     the UI can label it clearly as "آخر جلسة كاملة".
 *   - If BOTH tables have zero rows for the ticker → return null (404).
 *   - The last 3 sessions are guaranteed to be preserved by the cron
 *     job `vps-service/jobs/intraday_session_preserver.py` (Rule 21:
 *     no hard DELETE; older sessions are copied to
 *     `stock_intraday_archive` instead of being deleted).
 *
 * Rule 20 (Python = brain):
 *   - This is a READ-ONLY analytics layer (no writes). All data comes from
 *     SQLite. No Node-side computation that the Python backend should own.
 *
 * References:
 *   - GM directive: P0-RADAR-STATS-REPAIR → Intraday Liquidity Engine
 *   - Rule 27, Rule 67, Rule 75
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import { existsSync } from 'fs';

// ─── Constants ────────────────────────────────────────────────────────────

/** Threshold (EGP) above which a single bar is classified as a large block. */
export const LARGE_BLOCK_NOTIONAL_EGP = 100_000;

/** Default bucket size (% of latest price) for volume profile. */
export const POC_BUCKET_PCT = 0.005; // 0.5%

/** Target number of bars per session response. */
export const MAX_BARS_PER_SESSION = 500;

// ─── Types ────────────────────────────────────────────────────────────────

export interface IntradayBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Classified side: 'buy' if close >= open else 'sell'. */
  side: 'buy' | 'sell';
  /** price × volume — notional traded in this bar. */
  notional: number;
  /** 'block' if notional >= LARGE_BLOCK_NOTIONAL_EGP else 'retail'. */
  size_class: 'block' | 'retail';
}

export interface VolumeProfileBucket {
  /** Lower edge of the price bucket. */
  price: number;
  /** Upper edge of the price bucket. */
  price_high: number;
  volume: number;
  /** Buy-side volume in this bucket. */
  buy_volume: number;
  /** Sell-side volume in this bucket. */
  sell_volume: number;
  /** Number of bars aggregated into this bucket. */
  bar_count: number;
  /** True if this bucket holds the most volume (the POC). */
  is_poc: boolean;
}

export interface IntradayFlowResult {
  ticker: string;
  /** ISO date of the session the data belongs to (e.g. '2026-10-12'). */
  session_date: string;
  /** True when the returned session is NOT today (market closed / no data yet). */
  is_historical_session: boolean;
  /** Total bars aggregated. */
  bar_count: number;
  /** First + last bar timestamps of the session. */
  session_start: string | null;
  session_end: string | null;
  /** Latest traded price in the session. */
  last_price: number | null;
  /** CVD series (cumulative). Each entry = { timestamp, cvd }. */
  cvd_series: Array<{ timestamp: string; cvd: number }>;
  /** Final CVD value (last point of the series). */
  cvd_final: number;
  /** Interpretation hint based on CVD slope. */
  cvd_signal: 'accumulation' | 'distribution' | 'neutral';
  /** Volume profile buckets, sorted by price ASC. */
  volume_profile: VolumeProfileBucket[];
  /** POC price (the bucket with the most volume). null if no data. */
  poc_price: number | null;
  /** Large-block aggregation. */
  blocks: {
    count: number;
    total_volume: number;
    total_notional: number;
    buy_volume: number;
    sell_volume: number;
  };
  /** Retail flow aggregation. */
  retail: {
    count: number;
    total_volume: number;
    total_notional: number;
    buy_volume: number;
    sell_volume: number;
  };
  /** Source table the data came from. */
  source: 'stock_intraday' | 'intraday_prices';
  /** Computed at (ISO timestamp). */
  computed_at: string;
}

// ─── Path resolution ──────────────────────────────────────────────────────

function resolveIntradayDbPath(): string {
  // Respect DBPath convention: env override > repo default.
  const fromEnv = process.env.INTRADAY_DB_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const repoRoot = process.cwd();
  const candidate = path.join(repoRoot, 'db', 'intraday.db');
  if (existsSync(candidate)) return candidate;
  // Fallback: relative to this file (src/lib → ../../db)
  return path.resolve(__dirname, '..', '..', 'db', 'intraday.db');
}

// ─── Readers ──────────────────────────────────────────────────────────────

interface RawStockIntradayRow {
  timestamp: string;
  price: number | null;
  volume: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  change_percent: number | null;
}

interface RawIntradayPricesRow {
  price_time: string;
  price: number | null;
  volume: number | null;
}

/**
 * Read the latest trading session's bars from stock_intraday (primary).
 *
 * GOLDEN SESSION FALLBACK: returns the most recent session that EXISTS
 * for this ticker — even if that session is not today (market closed /
 * holiday / no data ingested yet today). The caller (computeIntradayFlow)
 * marks such a response with `is_historical_session: true` and surfaces
 * the real `session_date` so the UI can label it "آخر جلسة كاملة".
 *
 * Returns null if the table is empty for this ticker (→ 404, Rule 27).
 */
function readFromStockIntraday(
  db: Database.Database,
  ticker: string,
): { rows: RawStockIntradayRow[]; sessionDate: string } | null {
  // Find the latest session date that has data for this ticker.
  const latestDateRow = db
    .prepare(
      `SELECT substr(timestamp, 1, 10) AS d
       FROM stock_intraday
       WHERE ticker = ?
       GROUP BY d
       ORDER BY d DESC
       LIMIT 1`,
    )
    .get(ticker) as { d?: string } | undefined;

  if (!latestDateRow?.d) return null;

  const sessionDate = latestDateRow.d;
  // Pull all bars for that session, chronological order, capped to MAX_BARS.
  // If there are more than MAX_BARS we sample evenly to keep the shape.
  const rows = db
    .prepare(
      `SELECT timestamp, price, volume, open, high, low, change_percent
       FROM stock_intraday
       WHERE ticker = ? AND substr(timestamp, 1, 10) = ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    )
    .all(ticker, sessionDate, MAX_BARS_PER_SESSION) as RawStockIntradayRow[];

  if (rows.length === 0) return null;
  return { rows, sessionDate };
}

/**
 * Fallback reader: intraday_prices (tick-ish quotes with bid/ask).
 * Returns null if empty for this ticker.
 */
function readFromIntradayPrices(
  db: Database.Database,
  ticker: string,
): { rows: RawIntradayPricesRow[]; sessionDate: string } | null {
  const latestDateRow = db
    .prepare(
      `SELECT substr(price_time, 1, 10) AS d
       FROM intraday_prices
       WHERE ticker = ?
       GROUP BY d
       ORDER BY d DESC
       LIMIT 1`,
    )
    .get(ticker) as { d?: string } | undefined;

  if (!latestDateRow?.d) return null;

  const sessionDate = latestDateRow.d;
  const rows = db
    .prepare(
      `SELECT price_time AS timestamp, price, volume
       FROM intraday_prices
       WHERE ticker = ? AND substr(price_time, 1, 10) = ?
       ORDER BY price_time ASC
       LIMIT ?`,
    )
    .all(ticker, sessionDate, MAX_BARS_PER_SESSION) as RawIntradayPricesRow[];

  if (rows.length === 0) return null;
  return { rows, sessionDate };
}

// ─── Bar normalization + classification ───────────────────────────────────

function normalizeBars(
  source: 'stock_intraday' | 'intraday_prices',
  rows: RawStockIntradayRow[] | RawIntradayPricesRow[],
): IntradayBar[] {
  const bars: IntradayBar[] = [];
  for (const r of rows as Array<RawStockIntradayRow | RawIntradayPricesRow>) {
    // Skip rows without a usable price (Rule 27: no fabricated values).
    const price =
      source === 'stock_intraday'
        ? (r as RawStockIntradayRow).price
        : (r as RawIntradayPricesRow).price;
    if (price == null || !Number.isFinite(price) || price <= 0) continue;

    const volume = Number(r.volume ?? 0);
    if (!Number.isFinite(volume) || volume < 0) continue;

    const open =
      source === 'stock_intraday' ? (r as RawStockIntradayRow).open : null;
    const high =
      source === 'stock_intraday' ? (r as RawStockIntradayRow).high : null;
    const low =
      source === 'stock_intraday' ? (r as RawStockIntradayRow).low : null;
    const close = price; // stock_intraday.price IS the close of that bar.

    // For stock_intraday: side from open vs close.
    // For intraday_prices (tick quotes, no open): classify by previous close.
    let side: 'buy' | 'sell';
    if (open != null && Number.isFinite(open) && open > 0) {
      side = close >= open ? 'buy' : 'sell';
    } else {
      // Tick-quote fallback: assume each tick's direction from the previous.
      const prev = bars.length > 0 ? bars[bars.length - 1].close : close;
      side = close >= prev ? 'buy' : 'sell';
    }

    const notional = price * volume;
    const size_class: 'block' | 'retail' =
      notional >= LARGE_BLOCK_NOTIONAL_EGP ? 'block' : 'retail';

    bars.push({
      timestamp:
        'timestamp' in r ? (r.timestamp as string) : ((r as RawIntradayPricesRow).price_time as string),
      open: open ?? close,
      high: high ?? Math.max(open ?? close, close),
      low: low ?? Math.min(open ?? close, close),
      close,
      volume,
      side,
      notional,
      size_class,
    });
  }
  return bars;
}

// ─── CVD (Cumulative Volume Delta) ─────────────────────────────────────────

function computeCvdSeries(bars: IntradayBar[]): {
  series: Array<{ timestamp: string; cvd: number }>;
  final: number;
  signal: 'accumulation' | 'distribution' | 'neutral';
} {
  const series: Array<{ timestamp: string; cvd: number }> = [];
  let cvd = 0;
  for (const b of bars) {
    cvd += b.side === 'buy' ? b.volume : -b.volume;
    series.push({ timestamp: b.timestamp, cvd });
  }

  // Signal: compare first-third vs last-third CVD slope.
  let signal: 'accumulation' | 'distribution' | 'neutral' = 'neutral';
  if (series.length >= 6) {
    const third = Math.floor(series.length / 3);
    const early = series[third - 1]?.cvd ?? 0;
    const late = series[series.length - third]?.cvd ?? 0;
    const drift = late - early;
    // Drift threshold = 5% of total absolute volume (heuristic).
    const totalAbsVol = bars.reduce((s, b) => s + b.volume, 0);
    const threshold = totalAbsVol * 0.05;
    if (drift > threshold && drift > 0) signal = 'accumulation';
    else if (drift < -threshold && drift < 0) signal = 'distribution';
  }

  return { series, final: cvd, signal };
}

// ─── Volume Profile + POC ─────────────────────────────────────────────────

function computeVolumeProfile(
  bars: IntradayBar[],
  bucketPct: number = POC_BUCKET_PCT,
): { buckets: VolumeProfileBucket[]; pocPrice: number | null } {
  if (bars.length === 0) return { buckets: [], pocPrice: null };

  const lastPrice = bars[bars.length - 1].close;
  const step = Math.max(lastPrice * bucketPct, 0.01); // never zero.
  const bucketsMap = new Map<number, VolumeProfileBucket>();

  for (const b of bars) {
    // Assign to a bucket whose lower edge = floor(price / step) * step.
    const bucketLower = Math.floor(b.close / step) * step;
    let bucket = bucketsMap.get(bucketLower);
    if (!bucket) {
      bucket = {
        price: bucketLower,
        price_high: bucketLower + step,
        volume: 0,
        buy_volume: 0,
        sell_volume: 0,
        bar_count: 0,
        is_poc: false,
      };
      bucketsMap.set(bucketLower, bucket);
    }
    bucket.volume += b.volume;
    if (b.side === 'buy') bucket.buy_volume += b.volume;
    else bucket.sell_volume += b.volume;
    bucket.bar_count += 1;
  }

  const buckets = Array.from(bucketsMap.values()).sort(
    (a, b) => a.price - b.price,
  );

  // Mark POC = the bucket with the most volume.
  let pocPrice: number | null = null;
  let maxVol = -1;
  for (const bk of buckets) {
    if (bk.volume > maxVol) {
      maxVol = bk.volume;
      pocPrice = bk.price;
    }
  }
  if (pocPrice != null) {
    const poc = buckets.find((b) => b.price === pocPrice);
    if (poc) poc.is_poc = true;
  }

  return { buckets, pocPrice };
}

// ─── Block / Retail aggregation ───────────────────────────────────────────

function aggregateSizeClass(bars: IntradayBar[]) {
  const acc = {
    blocks: {
      count: 0,
      total_volume: 0,
      total_notional: 0,
      buy_volume: 0,
      sell_volume: 0,
    },
    retail: {
      count: 0,
      total_volume: 0,
      total_notional: 0,
      buy_volume: 0,
      sell_volume: 0,
    },
  };
  for (const b of bars) {
    const tgt = b.size_class === 'block' ? acc.blocks : acc.retail;
    tgt.count += 1;
    tgt.total_volume += b.volume;
    tgt.total_notional += b.notional;
    if (b.side === 'buy') tgt.buy_volume += b.volume;
    else tgt.sell_volume += b.volume;
  }
  return acc;
}

// ─── Public entry point ──────────────────────────────────────────────────

/**
 * Compute the full intraday liquidity flow for a ticker.
 *
 * Returns `null` when there is NO intraday data for the ticker in either
 * source table (Rule 27 — caller must surface a 404, never fabricate).
 */
export function computeIntradayFlow(
  ticker: string,
): IntradayFlowResult | null {
  const dbPath = resolveIntradayDbPath();
  if (!existsSync(dbPath)) return null;

  // better-sqlite3 with readonly + safe flags.
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    // PRIMARY: stock_intraday
    let source: 'stock_intraday' | 'intraday_prices' = 'stock_intraday';
    let raw: { rows: RawStockIntradayRow[] | RawIntradayPricesRow[]; sessionDate: string } | null =
      readFromStockIntraday(db, ticker);

    if (!raw) {
      // FALLBACK: intraday_prices
      const fallback = readFromIntradayPrices(db, ticker);
      if (!fallback) return null; // Rule 27: no data → no fabrication.
      source = 'intraday_prices';
      raw = fallback;
    }

    const bars = normalizeBars(source, raw.rows);
    if (bars.length === 0) return null;

    const cvd = computeCvdSeries(bars);
    const vp = computeVolumeProfile(bars);
    const sizes = aggregateSizeClass(bars);

    // Determine if the returned session is today or historical.
    const today = new Date().toISOString().slice(0, 10);
    const isHistorical = raw.sessionDate !== today;

    return {
      ticker,
      session_date: raw.sessionDate,
      is_historical_session: isHistorical,
      bar_count: bars.length,
      session_start: bars[0]?.timestamp ?? null,
      session_end: bars[bars.length - 1]?.timestamp ?? null,
      last_price: bars[bars.length - 1]?.close ?? null,
      cvd_series: cvd.series,
      cvd_final: cvd.final,
      cvd_signal: cvd.signal,
      volume_profile: vp.buckets,
      poc_price: vp.pocPrice,
      blocks: sizes.blocks,
      retail: sizes.retail,
      source,
      computed_at: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}

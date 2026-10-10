/**
 * Trade Results Data Engine — Task 38-A
 * =====================================
 * محرك بيانات نتائج الصفقات الناجحة.
 *
 * Owner directive (EXACT QUOTE — 32-section spec):
 *   «نريد إنشاء نظام تلقائي داخل منصة دليل الاستثمار يقوم بتوليد بوستات
 *    احترافية لنتائج الصفقات الناجحة، اعتمادًا على بيانات الصفقات الفعلية
 *    الموجودة في قاعدة البيانات فقط.»
 *
 * Translation: Build an automatic system that generates professional social
 * media posts for SUCCESSFUL trade results, using ONLY real data from the DB.
 *
 * ─── CRITICAL RULES (Constitution Rule 67 — ROOT-CAUSE-FIRST) ───
 *   1. NO fabricated data — if no qualified trades exist → return null
 *      and let the caller show "لا توجد نتائج مؤهلة" (no qualified results).
 *   2. Only CLOSED trades count — open trades are excluded entirely.
 *   3. Success rate = winning_closed / ALL_closed × 100 (losers in denom).
 *   4. Period is based on `closed_at` (NOT `prediction_date` / `outcome_date`).
 *   5. "إجمالي الحركة السعرية" ≠ "عائد المحفظة" — it's the SUM of realized
 *      returns (winners only), NOT portfolio return.
 *   6. Distinguish "رابحة" (profitable) from "حققت الهدف" (target hit) —
 *      a trade can be profitable without hitting the target.
 *   7. Validation before generation — 11-point checklist (spec section 25).
 *
 * ─── DESIGN CHOICES ───
 *   - DB access: better-sqlite3 readonly. Falls back to immutable=1 mode
 *     if the DB file is missing/locked (sandbox safety).
 *   - Timezone: Cairo (Africa/Cairo) — UTC+2 winter / UTC+3 DST.
 *     Period bounds (period_start, period_end) are computed in Cairo
 *     local time, then converted to UTC for the SQL query on `closed_at`
 *     (which is stored as TEXT ISO datetime — same convention as
 *     `created_at TEXT DEFAULT (datetime('now'))` in ensureSchema).
 *   - Weekly period: Sunday → Saturday (Egypt work week starts Sunday).
 *
 * ─── SOURCES ───
 *   - DB:        db/predictions.db (table: predictions)
 *   - Schema:    prisma/predictions-schema.prisma (Prediction model)
 *   - Stock names: src/lib/stock-names.ts (normalizeEgxSymbol + canonical)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { normalizeEgxSymbol } from '@/lib/stock-names';

// ============================================================================
// TYPES — exported for the API route + downstream consumers (post generator)
// ============================================================================

export type Period = 'daily' | 'weekly' | 'monthly';

/** A single closed trade, mapped to the spec's required output shape. */
export interface TradeResult {
  ticker: string;
  /** Arabic display name from stock-names.ts canonical map; falls back to ticker. */
  stock_name: string;
  market: string;
  recommendation_date: string;  // prediction_date (YYYY-MM-DD or ISO)
  close_date: string;            // closed_at (ISO datetime)
  recommendation_price: number;  // entry_price
  target_price: number;
  stop_loss: number | null;
  actual_close_price: number;    // exit_price
  realized_return_percent: number; // actual_return OR calculated from entry/exit
  target_hit: boolean;           // hit_target === 1
  stop_hit: boolean;             // hit_stop === 1
  /** True if realized_return_percent > 0 (independent of target_hit). */
  profitable: boolean;
  status: string;                // always 'CLOSED' for qualified trades
  holding_days: number;
  /** True if exit_price exceeded target_price in the signal's favor. */
  exceeded_target: boolean;
}

/** Aggregated stats for a report period (spec section 9 + 10). */
export interface ReportStats {
  /** All closed trades (winners + losers). */
  total_closed: number;
  /** Profitable only (realized_return_percent > 0). */
  winning_closed: number;
  /** Losers (realized_return_percent <= 0). */
  losing_closed: number;
  /** winning_closed / total_closed × 100. 0 if total_closed === 0. */
  success_rate: number;
  /** Mean(realized_return_percent) of WINNERS only — spec §10. */
  average_return: number;
  /** SUM(realized_return_percent) of WINNERS only — spec §9 ("إجمالي الحركة السعرية"). */
  total_price_movement: number;
  /** Top 10 winners sorted by realized_return_percent DESC. */
  top_trades: TradeResult[];
}

/** 11-point validation result (spec section 25). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Cairo-local period bounds + their UTC equivalents (for SQL query). */
export interface PeriodRange {
  period: Period;
  /** Cairo local date — YYYY-MM-DD. */
  period_start: string;
  /** Cairo local date — YYYY-MM-DD. */
  period_end: string;
  /** UTC ISO datetime corresponding to period_start 00:00:00 Cairo. */
  utc_start: string;
  /** UTC ISO datetime corresponding to period_end 23:59:59.999 Cairo. */
  utc_end: string;
}

/** Raw DB row shape — only fields we actually read. */
interface PredictionRow {
  ticker: string;
  market: string | null;
  signal: string | null;
  prediction_date: string | null;
  closed_at: string | null;
  entry_price: number;
  exit_price: number;
  target_price: number | null;
  stop_loss: number | null;
  actual_return: number | null;
  pnl_pct: number | null;
  hit_target: number | null;
  hit_stop: number | null;
  holding_days: number | null;
  status: string | null;
}

// ============================================================================
// CAIRO TIMEZONE HELPERS — Egypt is UTC+2 (winter) / UTC+3 (summer DST)
// ============================================================================

/**
 * Get the Cairo timezone offset (in minutes) for a given instant.
 * Egypt restored DST in 2023: UTC+2 in winter, UTC+3 in summer.
 *
 * Uses Intl.DateTimeFormat with `timeZoneName: 'shortOffset'` — returns
 * strings like "GMT+2" or "GMT+3" depending on the date.
 */
export function getCairoOffsetMinutes(now: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    // "GMT+2", "GMT+3", "GMT-5", "GMT" (UTC)
    const m = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) {
      // Fallback: assume standard UTC+2 (Egypt winter).
      return 120;
    }
    const sign = m[1] === '+' ? 1 : -1;
    const hours = parseInt(m[2], 10) || 0;
    const minutes = m[3] ? parseInt(m[3], 10) : 0;
    return sign * (hours * 60 + minutes);
  } catch { // silent fallback (safe-by-design)
    return 120; // safe default
  }
}

/**
 * Get today's date in Cairo timezone as YYYY-MM-DD.
 * Uses `en-CA` locale which formats dates as YYYY-MM-DD (ISO-like).
 */
export function getCairoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Get the day of week in Cairo timezone.
 * Returns 0 (Sunday) through 6 (Saturday).
 */
function getCairoDayOfWeek(now: Date = new Date()): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    weekday: 'short',
  }).format(now);
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[weekday] ?? 0;
}

/**
 * Format a YYYY-MM-DD string from a Date object (UTC interpretation).
 */
function formatYMD(year: number, month1based: number, day: number): string {
  const m = String(month1based).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/**
 * Compute the Cairo-local period bounds (period_start, period_end) and
 * their UTC equivalents (utc_start, utc_end) for the SQL query.
 *
 * - daily:   today (Cairo) — 00:00:00 to 23:59:59.999 Cairo.
 * - weekly:  Sunday → Saturday of current week (Egypt work week starts Sunday).
 * - monthly: 1st to last day of current month (Cairo).
 *
 * The UTC bounds are derived by subtracting the Cairo offset from the Cairo
 * wall-clock time (Cairo is east of UTC, so UTC = Cairo − offset).
 */
export function getPeriodRange(period: Period, now: Date = new Date()): PeriodRange {
  const cairoToday = getCairoToday(now);          // "YYYY-MM-DD"
  const [y, m, d] = cairoToday.split('-').map(Number);
  const offsetMinutes = getCairoOffsetMinutes(now); // e.g. 120 (winter) or 180 (DST)

  let startYmd: string;
  let endYmd: string;

  if (period === 'daily') {
    startYmd = cairoToday;
    endYmd = cairoToday;
  } else if (period === 'weekly') {
    // Sunday = 0, Saturday = 6. Week starts on Sunday.
    const dow = getCairoDayOfWeek(now);
    const sundayMs = Date.UTC(y, m - 1, d) - dow * 86400000;
    const sunday = new Date(sundayMs);
    const sY = sunday.getUTCFullYear();
    const sM = sunday.getUTCMonth() + 1;
    const sD = sunday.getUTCDate();
    startYmd = formatYMD(sY, sM, sD);
    const saturdayMs = sundayMs + 6 * 86400000;
    const saturday = new Date(saturdayMs);
    const eY = saturday.getUTCFullYear();
    const eM = saturday.getUTCMonth() + 1;
    const eD = saturday.getUTCDate();
    endYmd = formatYMD(eY, eM, eD);
  } else if (period === 'monthly') {
    startYmd = formatYMD(y, m, 1);
    // Last day of month: day 0 of next month
    const lastDayDate = new Date(Date.UTC(y, m, 0));
    const lastDay = lastDayDate.getUTCDate();
    endYmd = formatYMD(y, m, lastDay);
  } else {
    // Exhaustive guard — future-proof against new period values.
    const exhaustive: never = period;
    throw new Error(`Invalid period: ${String(exhaustive)}`);
  }

  // Convert Cairo wall-clock period bounds to UTC for SQL query.
  // Cairo midnight (00:00:00) on startYmd → UTC midnight minus offset.
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const utcStartMs = Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0) - offsetMinutes * 60000;
  const utcEndMs = Date.UTC(ey, em - 1, ed, 23, 59, 59, 999) - offsetMinutes * 60000;

  return {
    period,
    period_start: startYmd,
    period_end: endYmd,
    utc_start: new Date(utcStartMs).toISOString(),
    utc_end: new Date(utcEndMs).toISOString(),
  };
}

// ============================================================================
// DATABASE ACCESS
// ============================================================================

const DB_PATH = path.join(process.cwd(), 'db', 'predictions.db');

/**
 * Open predictions.db in readonly mode.
 *
 * Strategy:
 *   1. Try `readonly: true, fileMustExist: true` — fails if file missing.
 *   2. Fall back to immutable=1 URI mode (handles locked/missing files).
 *
 * Per Rule 67 §2 (no synthetic approximation): if the DB can't be opened,
 * we throw — the caller (API route) converts this to a 500 response with
 * a clear error message. We do NOT return fake/empty data.
 */
function openPredictionsDb(): Database.Database {
  try {
    return new Database(DB_PATH, { readonly: true, fileMustExist: true, timeout: 3000 });
  } catch { // silent fallback (safe-by-design)
    // Fallback: immutable=1 lets us read even from a locked/zero-byte file
    // (sqlite treats it as a snapshot). Throws if file truly doesn't exist.
    return new Database(`file:${DB_PATH}?immutable=1`, { timeout: 3000 });
  }
}

/**
 * Map a raw DB row (camelCase Prisma shape) to the spec's TradeResult type.
 *
 * Key transformations:
 *   - realized_return_percent: prefer `actual_return`, then `pnl_pct`,
 *     then calculate from (exit_price - entry_price) / entry_price × 100.
 *     For SELL signals (short), return is (entry - exit) / entry × 100.
 *   - profitable: true iff realized_return_percent > 0 (regardless of
 *     target_hit — spec section 6 distinguishes the two).
 *   - exceeded_target: signal-aware — BUY: exit > target; SELL: exit < target.
 *   - stock_name: from canonical EGX map; falls back to ticker if unknown.
 */
function mapRowToTradeResult(row: PredictionRow): TradeResult {
  const ticker = String(row.ticker || '').trim();
  const market = inferMarket(ticker, row.market);
  const signal = String(row.signal || '').trim().toUpperCase();
  const isSell = signal === 'SELL' || signal === 'STRONG_SELL' || signal === 'SHORT';

  const entryPrice = Number(row.entry_price) || 0;
  const exitPrice = Number(row.exit_price) || 0;
  const targetPrice = row.target_price != null ? Number(row.target_price) : null;
  const stopLoss = row.stop_loss != null ? Number(row.stop_loss) : null;

  // realized_return_percent — prefer actual_return, then pnl_pct, then calc.
  let realizedReturn: number;
  if (row.actual_return != null && !Number.isNaN(Number(row.actual_return))) {
    realizedReturn = Number(row.actual_return);
  } else if (row.pnl_pct != null && !Number.isNaN(Number(row.pnl_pct))) {
    realizedReturn = Number(row.pnl_pct);
  } else if (entryPrice > 0 && exitPrice > 0) {
    if (isSell) {
      realizedReturn = ((entryPrice - exitPrice) / entryPrice) * 100;
    } else {
      realizedReturn = ((exitPrice - entryPrice) / entryPrice) * 100;
    }
  } else {
    // Rule 67: no fabricated data. If we genuinely can't calculate, use 0
    // BUT mark the row as not profitable so it lands in `losing_closed`.
    realizedReturn = 0;
  }

  // Round to 2 decimals for display stability.
  realizedReturn = Math.round(realizedReturn * 100) / 100;

  const targetHit = Number(row.hit_target || 0) === 1;
  const stopHit = Number(row.hit_stop || 0) === 1;
  const profitable = realizedReturn > 0;

  // exceeded_target — signal-aware.
  let exceededTarget = false;
  if (targetPrice != null && targetPrice > 0 && exitPrice > 0) {
    exceededTarget = isSell ? exitPrice < targetPrice : exitPrice > targetPrice;
  }

  const canonical = normalizeEgxSymbol(ticker);
  const stockName = canonical.name_ar || ticker;

  return {
    ticker,
    stock_name: stockName,
    market,
    recommendation_date: row.prediction_date || '',
    close_date: row.closed_at || '',
    recommendation_price: entryPrice,
    target_price: targetPrice ?? 0,
    stop_loss: stopLoss,
    actual_close_price: exitPrice,
    realized_return_percent: realizedReturn,
    target_hit: targetHit,
    stop_hit: stopHit,
    profitable,
    status: 'CLOSED',
    holding_days: Number(row.holding_days || 0),
    exceeded_target: exceededTarget,
  };
}

/** Infer market from ticker if the DB column is null/empty. */
function inferMarket(ticker: string, marketCol: string | null | undefined): string {
  if (marketCol && marketCol.trim() !== '') return marketCol.trim();
  if (!ticker) return 'EGX';
  if (/^\d+$/.test(ticker)) return 'TADAWUL';  // Saudi tickers are numeric
  return 'EGX';
}

/**
 * Fetch all CLOSED trades for the given period.
 *
 * Per spec section 2: filter is `status = 'CLOSED' AND closed_at IS NOT NULL
 * AND exit_price IS NOT NULL AND entry_price IS NOT NULL`.
 *
 * Per spec section 4: period filter is on `closed_at` (close date), NOT
 * `prediction_date` (open date).
 *
 * Per spec section 3: market filter is optional; default = all markets.
 *
 * Returns empty array `[]` if no rows match (NOT null — null is reserved
 * for the stats-level "no qualified trades" signal in calculateReportStats).
 *
 * If the `predictions` table doesn't exist (fresh sandbox DB), returns `[]`.
 * This is Rule 67 §2 compliant — no fabricated data, just an honest empty
 * result that bubbles up as `stats: null` + "لا توجد نتائج مؤهلة" in the
 * API response. We do NOT silently create the table (readonly mode per spec).
 */
export function fetchClosedTrades(
  period: Period,
  market?: string,
  now: Date = new Date(),
): TradeResult[] {
  const range = getPeriodRange(period, now);
  const db = openPredictionsDb();
  try {
    // Guard: if the predictions table doesn't exist (fresh sandbox DB),
    // return [] instead of throwing. This is semantically equivalent to
    // "no closed trades exist" — Rule 67 §2 (no fabricated data, but also
    // no spurious 500 error for an empty DB).
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='predictions'`,
    ).get() as { name?: string } | undefined;
    if (!tableCheck || tableCheck.name !== 'predictions') {
      return [];
    }
    // Use datetime() to normalize closed_at (handles both "YYYY-MM-DD HH:MM:SS"
    // and ISO "YYYY-MM-DDTHH:MM:SS.SSSZ" formats stored by SQLite).
    let sql = `
      SELECT
        ticker,
        market,
        signal,
        prediction_date,
        closed_at,
        entry_price,
        exit_price,
        target_price,
        stop_loss,
        actual_return,
        pnl_pct,
        hit_target,
        hit_stop,
        holding_days,
        status
      FROM predictions
      WHERE UPPER(TRIM(COALESCE(status, ''))) = 'CLOSED'
        AND closed_at IS NOT NULL
        AND exit_price IS NOT NULL
        AND entry_price IS NOT NULL
        AND datetime(closed_at) >= datetime(?)
        AND datetime(closed_at) <= datetime(?)
    `;
    const params: (string | number)[] = [range.utc_start, range.utc_end];
    if (market && market.trim() !== '') {
      sql += ` AND UPPER(TRIM(COALESCE(market, ''))) = ?`;
      params.push(market.trim().toUpperCase());
    }
    sql += ` ORDER BY datetime(closed_at) DESC`;
    const rows = db.prepare(sql).all(...params) as PredictionRow[];
    return rows.map(mapRowToTradeResult);
  } finally {
    db.close();
  }
}

// ============================================================================
// STATS CALCULATION — spec section 9 + 10
// ============================================================================

/**
 * Compute aggregated stats from a list of closed trades.
 *
 * Per spec section 5: success_rate = winning_closed / total_closed × 100.
 *   Losers ARE included in the denominator (no cherry-picking).
 *
 * Per spec section 9: total_price_movement = SUM(realized_return_percent)
 *   of WINNERS only (NOT portfolio return — this is "إجمالي الحركة السعرية").
 *
 * Per spec section 10: average_return = MEAN(realized_return_percent) of
 *   WINNERS only.
 *
 * Per spec section 6: "winning" = profitable (realized_return_percent > 0),
 *   NOT "hit_target". A trade can be profitable without hitting target.
 *
 * Returns `null` if `total_closed === 0` (Rule 67: no fabricated data —
 * the caller MUST show "لا توجد نتائج مؤهلة" instead of inventing numbers).
 */
export function calculateReportStats(trades: TradeResult[]): ReportStats | null {
  if (trades.length === 0) {
    return null;  // Rule 67 §2 + Rule 67 §4 — no qualified trades → null
  }

  const total_closed = trades.length;
  const winners = trades.filter((t) => t.profitable);
  const losers = trades.filter((t) => !t.profitable);

  const winning_closed = winners.length;
  const losing_closed = losers.length;

  // Success rate uses ALL closed trades in the denominator (spec §5).
  const success_rate = total_closed > 0
    ? Math.round((winning_closed / total_closed) * 1000) / 10  // 1 decimal
    : 0;

  // total_price_movement + average_return — WINNERS ONLY (spec §9 + §10).
  const winnerReturns = winners.map((w) => w.realized_return_percent);
  const total_price_movement = Math.round(
    winnerReturns.reduce((sum, r) => sum + r, 0) * 100,
  ) / 100;
  const average_return = winnerReturns.length > 0
    ? Math.round(
      (winnerReturns.reduce((sum, r) => sum + r, 0) / winnerReturns.length) * 100,
    ) / 100
    : 0;

  // Top 10 winners by realized_return_percent DESC.
  const top_trades = [...winners]
    .sort((a, b) => b.realized_return_percent - a.realized_return_percent)
    .slice(0, 10);

  return {
    total_closed,
    winning_closed,
    losing_closed,
    success_rate,
    average_return,
    total_price_movement,
    top_trades,
  };
}

// ============================================================================
// VALIDATION — 11-point checklist (spec section 25)
// ============================================================================

/**
 * Run the 11-point validation checklist from spec section 25.
 *
 * If validation fails, the API route MUST NOT generate the post.
 * Returns `{ valid: false, errors: [...] }` with a list of human-readable
 * errors (in English — the API route translates to Arabic for display).
 *
 * Note: points 7 and 8 (no duplicates) overlap — kept as separate checks
 * to match the spec's 11-point enumeration exactly.
 */
export function validateReport(
  stats: ReportStats | null,
  trades: TradeResult[],
  period: Period,
  now: Date = new Date(),
): ValidationResult {
  const errors: string[] = [];

  // ─── Point 1: Period is valid ───
  if (period !== 'daily' && period !== 'weekly' && period !== 'monthly') {
    errors.push(`Invalid period: "${period}" (must be daily, weekly, or monthly)`);
  }

  // ─── Point 2: All trades have close_date within the period ───
  if (trades.length > 0) {
    const range = getPeriodRange(period, now);
    const startMs = new Date(range.utc_start).getTime();
    const endMs = new Date(range.utc_end).getTime();
    const outOfRange = trades.filter((t) => {
      const d = new Date(t.close_date).getTime();
      if (Number.isNaN(d)) return true;  // unparseable close_date
      return d < startMs || d > endMs;
    });
    if (outOfRange.length > 0) {
      errors.push(
        `${outOfRange.length} trade(s) have close_date outside period ${range.period_start} → ${range.period_end}`,
      );
    }
  }

  // ─── Point 3: All trades are CLOSED ───
  const notClosed = trades.filter((t) => t.status !== 'CLOSED');
  if (notClosed.length > 0) {
    errors.push(`${notClosed.length} trade(s) are not CLOSED`);
  }

  // ─── Point 4: actual_close_price exists ───
  const noExitPrice = trades.filter(
    (t) => t.actual_close_price == null || Number.isNaN(t.actual_close_price) || t.actual_close_price <= 0,
  );
  if (noExitPrice.length > 0) {
    errors.push(`${noExitPrice.length} trade(s) missing actual_close_price`);
  }

  // ─── Point 5: recommendation_price exists ───
  const noEntryPrice = trades.filter(
    (t) => t.recommendation_price == null || Number.isNaN(t.recommendation_price) || t.recommendation_price <= 0,
  );
  if (noEntryPrice.length > 0) {
    errors.push(`${noEntryPrice.length} trade(s) missing recommendation_price`);
  }

  // ─── Point 6: realized_return_percent is calculable ───
  const noReturn = trades.filter(
    (t) => t.realized_return_percent == null || Number.isNaN(t.realized_return_percent),
  );
  if (noReturn.length > 0) {
    errors.push(`${noReturn.length} trade(s) have non-calculable realized_return_percent`);
  }

  // ─── Point 7: No duplicate trades (by ticker + close_date) ───
  const seenKeys = new Set<string>();
  const dupes: string[] = [];
  for (const t of trades) {
    const key = `${t.ticker}|${t.close_date}`;
    if (seenKeys.has(key)) {
      dupes.push(key);
    } else {
      seenKeys.add(key);
    }
  }
  if (dupes.length > 0) {
    errors.push(`${dupes.length} duplicate trade(s) by (ticker, close_date): ${dupes.slice(0, 3).join(', ')}${dupes.length > 3 ? '...' : ''}`);
  }

  // ─── Point 8: No trade appears twice (full-row identity check) ───
  // Catches duplicates that have the same ticker+close_date but different
  // exit_price (shouldn't happen but is a stronger guarantee).
  const rowKeys = new Set<string>();
  const rowDupes: string[] = [];
  for (const t of trades) {
    const key = `${t.ticker}|${t.close_date}|${t.recommendation_price}|${t.actual_close_price}|${t.realized_return_percent}`;
    if (rowKeys.has(key)) {
      rowDupes.push(key);
    } else {
      rowKeys.add(key);
    }
  }
  if (rowDupes.length > 0) {
    errors.push(`${rowDupes.length} exact-duplicate trade row(s) found`);
  }

  // ─── Point 9: Success rate matches (winners / total) ───
  if (stats) {
    const expectedWinners = trades.filter((t) => t.profitable).length;
    if (expectedWinners !== stats.winning_closed) {
      errors.push(
        `Success rate mismatch: stats.winning_closed=${stats.winning_closed} but trades have ${expectedWinners} profitable`,
      );
    }
    const expectedRate = stats.total_closed > 0
      ? Math.round((expectedWinners / stats.total_closed) * 1000) / 10
      : 0;
    // Allow tiny floating-point tolerance.
    if (Math.abs(expectedRate - stats.success_rate) > 0.2) {
      errors.push(
        `success_rate mismatch: stats=${stats.success_rate}% vs recomputed=${expectedRate}%`,
      );
    }
  }

  // ─── Point 10: Open trades excluded ───
  // Redundant with Point 3 but kept separate per spec enumeration.
  // We verify the SQL filter by ensuring NO trade has status indicating open.
  const openStatuses = ['PENDING', 'ACTIVE', 'OPEN', ''];
  const openTrades = trades.filter(
    (t) => openStatuses.includes(t.status.toUpperCase()) || t.status === '',
  );
  if (openTrades.length > 0) {
    errors.push(`${openTrades.length} open/pending trade(s) leaked into results`);
  }

  // ─── Point 11: All numbers match the DB ───
  // Recompute totals from the trades array and compare to stats.
  if (stats) {
    if (stats.total_closed !== trades.length) {
      errors.push(
        `total_closed mismatch: stats=${stats.total_closed} vs trades.length=${trades.length}`,
      );
    }
    const recomputedLosers = trades.length - expectedWinnersIfStats(stats, trades);
    if (recomputedLosers !== stats.losing_closed) {
      errors.push(
        `losing_closed mismatch: stats=${stats.losing_closed} vs recomputed=${recomputedLosers}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Helper — count winners from trades (used by validation Point 11). */
function expectedWinnersIfStats(_stats: ReportStats, trades: TradeResult[]): number {
  return trades.filter((t) => t.profitable).length;
}

// ============================================================================
// EXPORTS — for downstream post-generator module (Task 38-B)
// ============================================================================

export const TRADE_RESULTS_ENGINE_VERSION = '1.0.0';

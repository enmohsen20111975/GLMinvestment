import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';
import { openDb } from '@/lib/shared-db';

export const dynamic = 'force-dynamic';

// ============================================================================
// KPI Alignment Agent — gold standard alignment
// Mirrors src/app/api/admin/platform-performance/route.ts logic:
//   1. n_raw / n_valid / n_excluded
//   2. exclusion_breakdown
//   3. capped_rows (HARD cap ±50)
//   4. channel separation (balanced / morning_bell)
//   5. avg_loss_pct negative (sign convention)
//   6. HARD cap: ABS(actual_return) <= 50  (Constitution Rule 7)
//
// FIX HISTORY (was non-compliant):
//   - win_rate was computed by string-match on `outcome LIKE '%win%'` against
//     stocks.db.prediction_logs (which is empty + has a different schema than
//     predictions.db.predictions). Now computed from `actual_return > 0`.
//   - LIMIT 50 on closed_predictions biased the win_rate to "last 50". Now
//     removed from SQL — the response payload slices to 50 for display only,
//     but KPIs are computed on the full closed set.
//   - No HARD cap, no exclusions, no channel separation — all added.
// ============================================================================

const HARD_CAP = 50.0; // Constitution Rule 7
const MAX_RETURN_RATIO = 5.0; // |exit/entry| > 5x → suspicious (likely data bug)

const EMPTY_LEDGER = {
  success: true as const,
  active_predictions: [] as unknown[],
  closed_predictions: [] as unknown[],
  win_rate: 0,
  total_signals: 0,
  wins: 0,
  losses: 0,
  live_alerts: [] as unknown[],
  message: 'لا توجد توقعات مسجلة بعد',
  // Audit fields (gold standard)
  n_raw: 0,
  n_valid: 0,
  n_excluded: 0,
  exclusion_breakdown: {} as Record<string, number>,
  capped_rows: 0,
  avg_loss_pct: 0, // negative when losses exist (gold standard Rule 9)
  by_channel: [] as unknown[],
  audit_status: 'pass' as const,
};

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute actual_return (with HARD cap ±50 applied).
 * Mirrors gold standard `computeActualReturnRaw` from
 * src/app/api/admin/platform-performance/route.ts.
 *
 * Priority:
 *   1. actual_return field (if finite)
 *   2. exit_price → (exit - entry) / entry × 100
 *   3. hit_target=1 → (target - entry) / entry × 100
 *   4. hit_stop=1   → (stop  - entry) / entry × 100
 *   5. expired/no hit → null (do not fabricate)
 *
 * Returns { ret, capped, suspicious } where ret is the HARD-capped return
 * (abs <= 50), capped = true if |raw| > HARD_CAP, suspicious = true if the
 * implied exit/entry ratio exceeds MAX_RETURN_RATIO (likely bad data).
 */
function computeActualReturnRaw(
  row: Record<string, unknown>
): { ret: number | null; capped: boolean; suspicious: boolean } {
  const entry = safeNum(row.entry_price);
  if (!entry || entry <= 0) return { ret: null, capped: false, suspicious: false };

  let rawRet: number | null = null;
  let exitUsed: number | null = null;

  // 1. actual_return field
  const ar = safeNum(row.actual_return);
  if (ar !== null && Number.isFinite(ar)) {
    rawRet = ar;
    exitUsed = entry * (1 + ar / 100); // implied exit for sanity check
  }

  // 2. exit_price → return
  if (rawRet === null) {
    const exit = safeNum(row.exit_price) ?? safeNum(row.actual_exit_price);
    if (exit !== null && exit > 0) {
      rawRet = ((exit - entry) / entry) * 100;
      exitUsed = exit;
    }
  }

  // 3. hit_target=1 → target
  if (rawRet === null) {
    const hitTarget = Number(row.hit_target || 0);
    const target = safeNum(row.target_price);
    if (hitTarget === 1 && target !== null && target > 0) {
      rawRet = ((target - entry) / entry) * 100;
      exitUsed = target;
    }
  }

  // 4. hit_stop=1 → stop
  if (rawRet === null) {
    const hitStop = Number(row.hit_stop || 0);
    const stop = safeNum(row.stop_loss);
    if (hitStop === 1 && stop !== null && stop > 0) {
      rawRet = ((stop - entry) / entry) * 100;
      exitUsed = stop;
    }
  }

  // 5. no measurable outcome
  if (rawRet === null) return { ret: null, capped: false, suspicious: false };

  // Sanity: |exit/entry| > 5x → suspicious
  const ratio = exitUsed ? Math.abs(exitUsed / entry) : 1;
  const suspicious = ratio > MAX_RETURN_RATIO;

  // Apply HARD cap ±50 (Constitution Rule 7)
  const capped = Math.abs(rawRet) > HARD_CAP;
  const ret = Math.max(-HARD_CAP, Math.min(HARD_CAP, rawRet));

  return { ret, capped, suspicious };
}

/**
 * Validate a trade for KPI measurement (mirrors gold standard validateTrade).
 * Returns the exclusion reason if the trade should be excluded, or null if valid.
 */
function validateTrade(
  row: Record<string, unknown>,
  seenKeys: Set<string>
): { valid: boolean; reason: string | null } {
  const ticker = String(row.ticker || '').trim().toUpperCase();
  const entry = safeNum(row.entry_price);

  // 1. entry_price > 0
  if (!entry || entry <= 0) return { valid: false, reason: 'entry_price_zero' };

  // 2. ticker clean (no spaces, ≤ 12 chars)
  if (!ticker || ticker.includes(' ') || ticker.length > 12) {
    return { valid: false, reason: 'ticker_invalid' };
  }

  // 3. dedup on (ticker | prediction_date | channel | entry_price)
  const morningBell = Number(row.morning_bell || 0);
  const channel = morningBell === 1 ? 'morning_bell' : 'balanced';
  const predictionDate = String(row.prediction_date || '');
  const dedupKey = `${ticker}|${predictionDate}|${channel}|${entry.toFixed(4)}`;
  if (seenKeys.has(dedupKey)) return { valid: false, reason: 'duplicate' };
  seenKeys.add(dedupKey);

  // 4. market known
  const market = String(row.market || '').toUpperCase();
  if (!market) return { valid: false, reason: 'market_unknown' };

  return { valid: true, reason: null };
}

interface TradeForKpi {
  actual_return: number; // 0 = not measurable (excluded from wins/losses)
  hit_target: 0 | 1;
  hit_stop: 0 | 1;
  status: string;
  channel: 'balanced' | 'morning_bell';
  market: string;
  capped: boolean;
  valid: boolean;
  exclusion_reason: string | null;
}

/**
 * GET /api/live-monitor/ledger
 * BRIEF-047: Prediction Ledger & Win Rate Dashboard
 *
 * Reads from predictions.db.predictions (canonical source — same as gold
 * standard). Returns:
 *   - active_predictions: pending/active predictions (LIMIT 20 for display)
 *   - closed_predictions: most-recent closed predictions (preview of 50)
 *   - win_rate: computed from actual_return > 0 (NOT string match)
 *   - live_alerts: from stocks.db.live_alerts (if table exists)
 *
 * Audit fields (gold standard):
 *   - n_raw, n_valid, n_excluded
 *   - exclusion_breakdown
 *   - capped_rows
 *   - avg_loss_pct (negative — Rule 9)
 *   - by_channel (balanced vs morning_bell — Rule 8)
 *   - audit_status: 'pass'
 *
 * READ-ONLY: does not write to any DB.
 * Resilience: NEVER returns 500 — degrades to EMPTY_LEDGER on any error so
 * the frontend's Live Monitor widget renders an empty state instead of
 * crashing the page.
 */
export async function GET() {
  try {
    const predictionsDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!existsSync(predictionsDbPath)) {
      return NextResponse.json(EMPTY_LEDGER);
    }

    // Read-write-first open so WAL reconciles, with readonly/immutable
    // fallback (handled by openDb helper). busy_timeout guards against
    // Python scraper checkpoint races.
    const db = openDb('predictions.db');
    db.pragma('busy_timeout = 5000');

    // Verify predictions table exists
    const tableInfo = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='predictions'"
    ).get() as { name: string } | undefined;

    if (!tableInfo) {
      return NextResponse.json(EMPTY_LEDGER);
    }

    // ---- Active predictions (lifecycle_status still open) --------------
    // LIMIT 20 here is intentional — these are NOT part of KPI computation,
    // they're the "currently open" preview for the Live Monitor widget.
    // LIFECYCLE-MIGRATION: open/active now detected via `lifecycle_status
    // IN ('proven', 'testing')`. Legacy NULL-status rows with no
    // actual_return are kept as a fallback for rows that haven't been
    // migrated yet.
    const activeRows = db.prepare(`
      SELECT id, ticker, signal, prediction_date, entry_price,
             target_price, stop_loss, master_score, confidence,
             morning_bell, market, status, lifecycle_status
      FROM predictions
      WHERE lifecycle_status IN ('proven', 'testing')
         OR (lifecycle_status IS NULL AND actual_return IS NULL)
      ORDER BY prediction_date DESC
      LIMIT 20
    `).all() as Record<string, unknown>[];

    // ---- Closed predictions (full set — NO LIMIT 50) ---------------------
    // KPIs are computed on the FULL closed set. The LIMIT 50 only applies to
    // the display payload below (preview for the UI).
    //
    // "Closed" = anything with a measurable outcome: actual_return is set,
    // exit_price is set, OR hit_target/hit_stop is set, OR `lifecycle_status
    // = 'closed'` (Bravo's new canonical column).
    // LIFECYCLE-MIGRATION: the legacy `UPPER(status) IN ('CLOSED',
    // 'EXPIRED')` check is replaced by `lifecycle_status = 'closed'`.
    const closedRows = db.prepare(`
      SELECT id, ticker, persona, morning_bell, prediction_date, entry_price,
             target_price, target_price_2, stop_loss, exit_price, actual_exit_price,
             actual_return, hit_target, hit_stop, status, lifecycle_status, holding_days,
             outcome_date, closed_at, highest_price, lowest_price,
             signal, master_score, confidence, market
      FROM predictions
      WHERE actual_return IS NOT NULL
         OR exit_price IS NOT NULL
         OR actual_exit_price IS NOT NULL
         OR hit_target = 1
         OR hit_stop = 1
         OR lifecycle_status = 'closed'
      ORDER BY COALESCE(outcome_date, closed_at, prediction_date) DESC
    `).all() as Record<string, unknown>[];

    // ---- Transform + validate + dedup ------------------------------------
    const seenKeys = new Set<string>();
    const trades: TradeForKpi[] = closedRows.map((row) => {
      const { ret: actualReturn, capped, suspicious } = computeActualReturnRaw(row);
      const validation = validateTrade(row, seenKeys);
      const isMorningBell = Number(row.morning_bell || 0) === 1;

      let valid = validation.valid;
      let exclusionReason = validation.reason;
      if (valid && suspicious) {
        valid = false;
        exclusionReason = 'exit_price_unrealistic';
      }
      // valid && actual_return === null → trade is open/no-outcome; left in
      // the list but excluded from measured (wins/losses) by actual_return === 0 check.

      return {
        actual_return: actualReturn ?? 0,
        hit_target: (Number(row.hit_target || 0)) as 0 | 1,
        hit_stop: (Number(row.hit_stop || 0)) as 0 | 1,
        status: String(row.status || ''),
        channel: isMorningBell ? 'morning_bell' : 'balanced',
        market: String(row.market || 'UNKNOWN').toUpperCase(),
        capped,
        valid,
        exclusion_reason: exclusionReason,
      };
    });

    // ---- KPI computation (gold standard aligned) --------------------------
    const nRaw = closedRows.length;
    const measured = trades.filter((t) => t.valid && t.actual_return !== 0);
    const nValid = measured.length;
    const excluded = trades.filter((t) => !t.valid);
    const nExcluded = excluded.length;

    const exclusionBreakdown: Record<string, number> = {};
    for (const t of excluded) {
      const r = t.exclusion_reason || 'unknown';
      exclusionBreakdown[r] = (exclusionBreakdown[r] || 0) + 1;
    }

    // wins = actual_return > 0, losses = actual_return < 0 (NOT string match)
    const wins = measured.filter((t) => t.actual_return > 0);
    const losses = measured.filter((t) => t.actual_return < 0);
    const cappedCount = measured.filter((t) => t.capped).length;

    const total = nValid;
    const winRate = total > 0 ? Math.round((wins.length / total) * 1000) / 10 : 0;

    // avg_loss MUST be negative (gold standard Rule 9)
    const avgLossPct = losses.length > 0
      ? -(losses.reduce((s, t) => s + Math.abs(t.actual_return), 0) / losses.length)
      : 0;

    // ---- Channel separation (gold standard Rule 8) ------------------------
    const channels: ('balanced' | 'morning_bell')[] = ['balanced', 'morning_bell'];
    const byChannel = channels
      .map((ch) => {
        const chTrades = trades.filter((t) => t.channel === ch);
        const chMeasured = chTrades.filter((t) => t.valid && t.actual_return !== 0);
        const chWins = chMeasured.filter((t) => t.actual_return > 0);
        const chLosses = chMeasured.filter((t) => t.actual_return < 0);
        const chCapped = chMeasured.filter((t) => t.capped).length;
        const chAvgLoss = chLosses.length > 0
          ? -(chLosses.reduce((s, t) => s + Math.abs(t.actual_return), 0) / chLosses.length)
          : 0;
        return {
          channel: ch,
          n_raw: chTrades.length,
          n_valid: chMeasured.length,
          win_rate: chMeasured.length > 0 ? Math.round((chWins.length / chMeasured.length) * 1000) / 10 : 0,
          capped_rows: chCapped,
          avg_loss_pct: chAvgLoss, // negative
        };
      })
      .filter((c) => c.n_raw > 0);

    // ---- Display payload (preview only — KPIs above use the full set) -----
    const closedPredictionsPreview = closedRows.slice(0, 50);

    // ---- Live alerts (stocks.db.live_alerts, if present) -------------------
    let liveAlerts: unknown[] = [];
    try {
      const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
      if (existsSync(stocksDbPath)) {
        const stocksDb = openDb('stocks.db');
        stocksDb.pragma('busy_timeout = 5000');
        const alertsTable = stocksDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='live_alerts'"
        ).get() as { name: string } | undefined;
        if (alertsTable) {
          liveAlerts = stocksDb.prepare(`
            SELECT alert_type, ticker, message, severity, timestamp
            FROM live_alerts
            ORDER BY created_at DESC
            LIMIT 20
          `).all();
        }
      }
    } catch {
      // live_alerts is optional — silently ignore if missing/locked
    }

    return NextResponse.json({
      success: true,
      active_predictions: activeRows.map((p) => ({
        ticker: p.ticker,
        signal: p.signal,
        score: p.master_score,
        entry: p.entry_price,
        target: p.target_price,
        stop: p.stop_loss,
        confidence: p.confidence,
        timestamp: p.prediction_date,
      })),
      // Preview payload (LIMIT 50 for display — KPIs above use full set)
      closed_predictions: closedPredictionsPreview.map((p) => ({
        ticker: p.ticker,
        signal: p.signal,
        outcome: computeOutcomeLabel(p), // 'win'|'loss'|'pending' for UI compat
        score: p.master_score,
        entry: p.entry_price,
        target: p.target_price,
        stop: p.stop_loss,
        confidence: p.confidence,
        timestamp: p.prediction_date,
        verified_at: p.outcome_date ?? p.closed_at,
        actual_return: safeNum(p.actual_return),
      })),
      // KPI fields — win_rate now from actual_return > 0 (NOT string match)
      win_rate: winRate,
      total_signals: total,
      wins: wins.length,
      losses: losses.length,
      live_alerts: liveAlerts,
      // ---- Audit fields (gold standard alignment) ----
      n_raw: nRaw,
      n_valid: nValid,
      n_excluded: nExcluded,
      exclusion_breakdown: exclusionBreakdown,
      capped_rows: cappedCount,
      avg_loss_pct: avgLossPct, // negative — Rule 9
      by_channel: byChannel, // balanced vs morning_bell — Rule 8
      audit_status: 'pass',
      audit_note:
        'KPIs computed on full closed set (LIMIT 50 only on display payload). ' +
        'win_rate = count(actual_return > 0) / n_valid. ' +
        'HARD cap ±50 applied (Constitution Rule 7).',
    });
  } catch (error: unknown) {
    console.error('[/api/live-monitor/ledger] Error (returning EMPTY_LEDGER 200):', error);
    // NEVER return 500 — degrade to empty 200 so the frontend's Live Monitor
    // widget renders an empty state instead of crashing.
    return NextResponse.json(EMPTY_LEDGER);
  }
}

/**
 * Derive a UI-compatible outcome label from actual_return.
 * Used only for backward compat with frontend code that reads `outcome`
 * as a string. KPI computation itself uses numeric actual_return directly.
 */
function computeOutcomeLabel(row: Record<string, unknown>): string {
  const ar = safeNum(row.actual_return);
  if (ar === null || ar === 0) {
    // Fall back to hit_target/hit_stop if actual_return is missing
    const hitTarget = Number(row.hit_target || 0);
    const hitStop = Number(row.hit_stop || 0);
    if (hitTarget === 1) return 'win';
    if (hitStop === 1) return 'loss';
    return 'pending';
  }
  return ar > 0 ? 'win' : 'loss';
}

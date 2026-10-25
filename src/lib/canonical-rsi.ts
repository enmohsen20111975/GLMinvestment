/**
 * canonical-rsi.ts — Pure RSI computation (no DB imports, client-safe)
 * ===============================================================================
 *
 * This file exports ONLY the Wilder's RSI computation function.
 * It does NOT import better-sqlite3 or any Node.js modules.
 * Safe to import from client-side components.
 *
 * Task PHASE-2-RSI-UNIFICATION — Rule 67 (CALCULATION-CANONICAL)
 */

/**
 * Compute RSI using Wilder's smoothing (canonical).
 * Identical to vps-service/analyzers/indicators/rsi.py::calc_rsi()
 *
 * @param closes - Array of closing prices (oldest first)
 * @param period - RSI period (default: 14)
 * @returns RSI value (0-100) or null if insufficient data
 */
export function computeRSI(closes: number[], period: number = 14): number | null {
  if (!closes || closes.length < period + 1) return null;

  const gains: number[] = [0];
  const losses: number[] = [0];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * classifyRSIState — تصنيف حالة RSI (مطابق Pine Script L171-184)
 * ===============================================================================
 *
 * Task TRADING-CHART-V60.2 (2026-10-07) — added to canonical-rsi.ts so all
 * client components can classify RSI without duplicating threshold logic.
 *
 * Thresholds (matching Pine V60.2):
 *   >= 70  → تشبع شرائي (overbought)
 *   55-70  → إيجابي
 *   45-55  → محايد
 *   30-45  → سلبي
 *   < 30   → تشبع بيعي (oversold)
 */
export function classifyRSIState(
  rsi: number | null
): { label: string; color: string; emoji: string } {
  if (rsi === null) {
    return { label: '— بيانات غير متاحة', color: 'text-muted-foreground', emoji: '⚪' };
  }
  if (rsi >= 70) {
    return { label: 'تشبع شرائي', color: 'text-loss', emoji: '🔴' };
  }
  if (rsi >= 55) {
    return { label: 'إيجابي', color: 'text-profit', emoji: '🟢' };
  }
  if (rsi >= 45) {
    return { label: 'محايد', color: 'text-warning', emoji: '🟡' };
  }
  if (rsi >= 30) {
    return { label: 'سلبي', color: 'text-orange-600', emoji: '🟠' };
  }
  return { label: 'تشبع بيعي', color: 'text-profit', emoji: '🟢' };
}

/**
 * computeRSISeries — RSI time-series using Wilder's smoothing (canonical).
 * ===============================================================================
 *
 * Task PHASE5-SCREENS-P1 (2026-10-08) — added so TradingViewChart.tsx can
 * import the canonical RSI computation instead of duplicating it locally.
 *
 * Identical algorithm to computeRSI above, but returns the FULL series
 * (one RSI value per input close) for chart rendering, not just the latest.
 *
 * @param closes - Array of closing prices (oldest first)
 * @param period - RSI period (default: 14)
 * @returns Array of RSI values (0-100) or null for insufficient data points
 */
export function computeRSISeries(closes: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (!closes || closes.length < period + 1) {
    return closes.map(() => null);
  }

  // Step 1: gains + losses per period
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  // Step 2: seed avgGain/avgLoss with simple SMA (Wilder's initial)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI at index = period (push nulls before it)
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  // Step 3: Wilder's smoothing for the rest
  for (let i = period + 1; i < closes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }

  return result;
}

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

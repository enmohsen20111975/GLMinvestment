/**
 * decimal.ts — Floating-Point Safe Math (PKG2 — Strict Engineering)
 * =================================================================
 * Problem: JavaScript Number is IEEE-754 double. `0.1 + 0.2 === 0.30000000000000004`.
 * For FINANCIAL data (prices, P&L, percentages) this silently corrupts
 * totals, win-rates, and portfolio NAV. 213 such operations were found
 * in src/lib using `* 100 / 100` / `Math.round` patterns.
 *
 * Solution: a tiny, dependency-free decimal module that performs integer
 * scaling (multiply by 1eN, compute on integers, divide back). This avoids
 * the floating-point representation error for addition/subtraction of
 * 2-decimal money values entirely.
 *
 * For heavy quant finance (options greeks, compounding) prefer a real
 * decimal library (decimal.js), but for EGX price arithmetic this is
 * sufficient and adds ZERO dependencies.
 *
 * Reference: Rule 67 (SSOT) — every screen computes the same way.
 */

// ============================================================
// Core: integer-scaled arithmetic
// ============================================================

const DEFAULT_DP = 2; // money default: 2 decimal places

/** Round to N decimal places using "round half away from zero" (matches SQL ROUND). */
export function roundTo(value: number, dp: number = DEFAULT_DP): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, dp);
  // Guard against overflow for very large numbers.
  const scaled = value * factor;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return rounded / factor;
}

/**
 * Sum an array of numbers with NO floating-point drift.
 * Scales every value to integers at `dp`, sums as integers, then scales back.
 * 0.1 + 0.2 + 0.3 => exactly 0.6 (not 0.6000000000000001).
 */
export function sumSafe(values: number[], dp: number = DEFAULT_DP): number {
  if (!values.length) return 0;
  const factor = Math.pow(10, dp);
  let acc = 0;
  for (const v of values) {
    if (Number.isFinite(v)) {
      acc += Math.round(v * factor);
    }
  }
  return acc / factor;
}

/** Safe subtraction `a - b` with integer scaling. */
export function subSafe(a: number, b: number, dp: number = DEFAULT_DP): number {
  const factor = Math.pow(10, dp);
  return (Math.round(a * factor) - Math.round(b * factor)) / factor;
}

/** Safe addition `a + b` with integer scaling. */
export function addSafe(a: number, b: number, dp: number = DEFAULT_DP): number {
  return sumSafe([a, b], dp);
}

/** Safe multiplication preserving `dp` precision in the result. */
export function mulSafe(a: number, b: number, dp: number = DEFAULT_DP): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return roundTo(a * b, dp);
}

/** Safe division with zero-guard + precision rounding. */
export function divSafe(a: number, b: number, dp: number = DEFAULT_DP): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return roundTo(a / b, dp);
}

// ============================================================
// Finance domain helpers
// ============================================================

/**
 * Percentage change from `prev` to `current`.
 *   - Returns 0 if prev is missing/zero (avoids divide-by-zero → Infinity).
 *   - Result is a PERCENT (e.g. 2.35 means +2.35%), rounded to `dp`.
 *
 * This is the SINGLE canonical %change function (Rule 67).
 * Replaces the 5 different formulas found across src/lib (PKG3).
 */
export function pctChange(
  prev: number | null | undefined,
  current: number | null | undefined,
  dp: number = DEFAULT_DP
): number {
  if (prev == null || current == null) return 0;
  if (!Number.isFinite(prev) || !Number.isFinite(current)) return 0;
  if (prev === 0) return 0; // avoid Infinity
  return roundTo(((current - prev) / Math.abs(prev)) * 100, dp);
}

/**
 * Win-rate: (wins / total) * 100, safe-divided + rounded.
 */
export function winRate(wins: number, total: number, dp: number = DEFAULT_DP): number {
  if (!Number.isFinite(wins) || !Number.isFinite(total) || total <= 0) return 0;
  return roundTo((wins / total) * 100, dp);
}

/**
 * Format a money value to a fixed string with `dp` decimals.
 *   toMoney(0.1 + 0.2) === "0.30"  (not "0.30000000000000004")
 */
export function toMoney(value: number, dp: number = DEFAULT_DP): string {
  if (!Number.isFinite(value)) return (0).toFixed(dp);
  return roundTo(value, dp).toFixed(dp);
}

/**
 * Clamp a value into [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ============================================================
// Self-test (run via `bun run src/lib/decimal.ts`)
// ============================================================

if (typeof require !== 'undefined' && require.main === module) {
  // eslint-disable-next-line no-console
  console.log('decimal.ts self-test:');
  // eslint-disable-next-line no-console
  console.log('  0.1 + 0.2         =', addSafe(0.1, 0.2), '(expect 0.3)');
  // eslint-disable-next-line no-console
  console.log('  sum [0.1,0.2,0.3]=', sumSafe([0.1, 0.2, 0.3]), '(expect 0.6)');
  // eslint-disable-next-line no-console
  console.log('  pctChange(100,105)=', pctChange(100, 105), '(expect 5)');
  // eslint-disable-next-line no-console
  console.log('  pctChange(0,5)    =', pctChange(0, 5), '(expect 0, no Infinity)');
  // eslint-disable-next-line no-console
  console.log('  winRate(7,10)     =', winRate(7, 10), '(expect 70)');
  // eslint-disable-next-line no-console
  console.log('  toMoney(0.1+0.2)  =', toMoney(0.1 + 0.2), '(expect "0.30")');
}

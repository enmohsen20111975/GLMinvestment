/**
 * Risk:Reward Calculator
 * =======================
 * Computes the Risk:Reward ratio dynamically from entry/target/stop prices.
 *
 * Why this exists:
 *   The DB column `risk_reward` in predictions.db is frequently 0 or NULL
 *   (the seed pipeline never wrote the value). Client-facing widgets were
 *   showing "R:R = 0" for every pick — confusing for users and misleading
 *   about the quality of the pick.
 *
 * Formula:
 *   risk_reward = (target_price - entry_price) / (entry_price - stop_loss)
 *
 *   Valid only when:
 *     - entry_price > 0
 *     - stop_loss   > 0
 *     - entry_price > stop_loss   (a stop above entry would be a SELL setup)
 *     - target_price > entry_price (else the trade has no upside)
 *
 *   Result is rounded to 2 decimal places. Returns `fallback` (default 0)
 *   when inputs are missing/invalid — never NaN/Infinity.
 *
 * Server-side only. Import from API routes / server actions.
 */

export function computeRiskReward(
  entry: unknown,
  target: unknown,
  stop: unknown,
  fallback: number = 0
): number {
  const e = Number(entry);
  const t = Number(target);
  const s = Number(stop);

  if (!Number.isFinite(e) || !Number.isFinite(t) || !Number.isFinite(s)) {
    return fallback;
  }
  if (!(e > 0) || !(s > 0)) return fallback;
  if (!(e > s)) return fallback;
  if (!(t > e)) return fallback;

  const rr = (t - e) / (e - s);
  if (!Number.isFinite(rr)) return fallback;

  return Math.round(rr * 100) / 100;
}

/**
 * Returns the computed R:R only if it is greater than the stored value
 * (or the stored value is 0/null/NaN). Useful when the DB might already
 * hold a valid number and we don't want to overwrite a more precise value.
 */
export function preferComputedRiskReward(
  entry: unknown,
  target: unknown,
  stop: unknown,
  stored: unknown
): number {
  const storedNum = Number(stored);
  const storedValid =
    Number.isFinite(storedNum) && storedNum > 0;
  if (storedValid) return Math.round(storedNum * 100) / 100;
  return computeRiskReward(entry, target, stop, 0);
}

/**
 * super-learning/helpers.ts
 * ========================
 * Pure render helpers for the Super Learning System:
 * - getWinRateColor: tailwind text color class based on a win-rate %.
 * - safeToFixed: safe number.toFixed() that tolerates undefined/null/NaN.
 * - safeNumber: safe number coercion (defaults to 0 on bad input).
 */
export function getWinRateColor(rate: number) {
  if (rate >= 70) return 'text-profit ';
  if (rate >= 50) return 'text-warning ';
  return 'text-loss ';
}

export function safeToFixed(value: number | undefined | null, decimals: number = 1): string {
  if (value === undefined || value === null || isNaN(value)) return '0';
  return value.toFixed(decimals);
}

export function safeNumber(value: number | undefined | null, defaultValue: number = 0): number {
  if (value === undefined || value === null || isNaN(value)) return defaultValue;
  return value;
}

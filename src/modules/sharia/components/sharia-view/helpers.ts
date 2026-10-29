// ShariaView helpers (Phase 3)
export function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(2) + '%';
}
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
}

// Re-export JSX-helpers (Alert + formatPct + deriveOverallStatus + IslamicPattern)
// so `./helpers` resolves uniformly for all consumers.
export { Alert, formatPct, deriveOverallStatus, IslamicPattern, safeNumber, GoldBorder, OrnamentDivider } from './helpers.tsx';

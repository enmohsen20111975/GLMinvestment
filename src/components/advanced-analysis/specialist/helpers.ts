/**
 * specialist/helpers.ts — Safe accessors + formatters (Rule 67: never fabricate).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 105–154).
 * - safeNum/safeStr: never throw, return null on garbage (no fabrication).
 * - fmtNum/fmtPct/fmtInt/fmtCompact: format numbers for display (—"—" on null).
 *
 * Rule 20 (Node.js = display only) — all numbers come from real DB/API responses.
 * Rule 27 (show "—" if missing) — every formatter returns "—" on null/undefined.
 */

/**
 * Coerce any value to a finite number or null.
 * Accepts number/string/boolean. Strings like "12.5" parse; "abc" → null.
 */
export function safeNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

/**
 * Coerce any value to a string or null.
 * Accepts string/number/boolean. Objects → null.
 */
export function safeStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/**
 * Format a number with fixed digits. Returns "—" on null/non-finite.
 */
export function fmtNum(v: unknown, digits = 2): string {
  const n = safeNum(v);
  if (n == null) return '—';
  return n.toFixed(digits);
}

/**
 * Format a number as percentage with given digits. Returns "—" on null.
 */
export function fmtPct(v: unknown, digits = 1): string {
  const n = safeNum(v);
  if (n == null) return '—';
  return `${n.toFixed(digits)}%`;
}

/**
 * Format a number as integer with locale grouping. Returns "—" on null.
 */
export function fmtInt(v: unknown): string {
  const n = safeNum(v);
  if (n == null) return '—';
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Compact volume/money formatter: 1.2K / 3.4M / 5.6B (Rule 67 — real number, no fabrication).
 * Optional suffix appended to the formatted value (e.g. " ج.م" for EGP).
 */
export function fmtCompact(v: unknown, suffix = ''): string {
  const n = safeNum(v);
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B${suffix}`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M${suffix}`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K${suffix}`;
  return `${(n ?? 0).toFixed(2)}${suffix}`;
}

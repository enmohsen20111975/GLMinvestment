/**
 * indicators/rsi.ts — Backward-compat re-export shim
 * ===============================================================================
 *
 * CANONICAL source of computeRSI is now: src/lib/canonical-rsi.ts
 * (adopted by the team in commit b2a7dd0 — same Wilder's formula, same Rule 67).
 *
 * This file is kept as a thin re-export for backward compatibility with any
 * imports that still reference '@/lib/indicators/rsi'. New code MUST import
 * directly from '@/lib/canonical-rsi' (the canonical single source of truth).
 *
 * Rule 67 (CALCULATION-CANONICAL) — Wilder's smoothing, period=14.
 */
export { computeRSI, classifyRSIState } from '@/lib/canonical-rsi';

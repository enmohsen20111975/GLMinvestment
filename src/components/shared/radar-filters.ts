/**
 * radar-filters.ts — B3 (Task 2-a) Liquidity Radar filter helpers
 * =====================================================================
 * Pure functions for computing filter counts + filtering the radar
 * stocks by canonical classification. NO React, NO side effects, NO
 * fabricated data — every count comes from the REAL `results` array.
 *
 * The B3 contract from `scripts/maker_radar.py::_classify_scanned_result`:
 *   classification ∈ {
 *     'quiet_accumulation',     // تجميع هادئ — bullish path matched
 *     'distribution',           // خطر تصريف — distribution signals
 *     'dead_trap',              // مصيدة — limit_up_trap / kill_switch
 *     'liquidity_drought',      // جفاف سيولة — avg_turnover_20d < 100k
 *     'rule80_downtrend',       // هبوط — drop_from_peak < -20%
 *     'unclassified',           // غير مصنف — scanned but no rule matched
 *     'INSUFFICIENT_DATA',      // بيانات غير مكتملة — < 15 days history
 *     'DATA_INVALID',           // بيانات غير صالحة — B1 price_sanity rejected
 *   }
 *
 * HARD CONSTRAINTS (Task 2-b / A1):
 *   #3 — Filter counts must come from REAL API data — NO hardcoded numbers.
 *   #4 — Don't double-count a stock in the total if it meets multiple
 *         classifications. (Each stock has exactly ONE classification, so
 *         summing by `classification` is naturally de-duplicated.)
 *   #5 — Show DATA_INVALID / INSUFFICIENT_DATA stocks as a SEPARATE state
 *         — NOT as "dead trap".
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Canonical B3 classification enum — mirrors the API contract verbatim.
 * Exported so consumers (UI + tests) share a single source of truth.
 */
export type RadarClassification =
  | 'quiet_accumulation'
  | 'distribution'
  | 'dead_trap'
  | 'liquidity_drought'
  | 'rule80_downtrend'
  | 'unclassified'
  | 'INSUFFICIENT_DATA'
  | 'DATA_INVALID';

/**
 * RadarStock — minimal shape required by the filter helpers. The full UI
 * type in `LiquidityRadarView.tsx` extends this with display fields.
 * `classification` is OPTIONAL on the wire (legacy cache entries may not
 * have it) — helpers treat missing as `'unclassified'`.
 */
export interface RadarStockLike {
  ticker: string;
  classification?: RadarClassification | string | null;
  data_quality_status?: 'OK' | 'STALE' | 'INVALID' | 'UNAVAILABLE' | string | null;
  sanity_status?: 'OK' | 'DATA_INVALID' | 'STALE' | 'DATA_UNAVAILABLE' | string | null;
  reasons?: string[] | null;
  sanity_reasons?: string[] | null;
  [key: string]: unknown;
}

/**
 * RadarSummary — mirrors the API's `summary` block. All fields optional
 * because older cache files might not emit `summary` at all.
 */
export interface RadarSummaryLike {
  source_count?: number;
  scanned_count?: number;
  valid_data_count?: number;
  classified_count?: number;
  unclassified_count?: number;
  data_error_count?: number;
  scan_timestamp?: string | null;
}

/**
 * RadarFilterKey — the filter chip keys. `data_invalid` is the SEPARATE
 * state for DATA_INVALID + INSUFFICIENT_DATA stocks (combined because
 * both share the "no actionable signal — bad data" semantic).
 */
export type RadarFilterKey =
  | 'all'
  | 'quiet_accumulation'
  | 'distribution'
  | 'dead_trap'
  | 'liquidity_drought'
  | 'rule80_downtrend'
  | 'unclassified'
  | 'data_invalid';

// ============================================================================
// Filter definitions (UI metadata — labels, icons, colors)
// ============================================================================

export interface RadarFilterDef {
  key: RadarFilterKey;
  /** Arabic label shown on the chip. */
  label: string;
  /** Emoji / icon glyph. */
  icon: string;
  /** Tailwind classes for the chip when active. */
  cls: string;
}

/**
 * RADAR_FILTERS — the canonical filter set. Order matters: this is the
 * order the chips render in the UI. NO indigo / blue colors (per project
 * Rule 30 — emerald/teal/rose/amber only).
 *
 * NOTE: NO trade recommendation is implied by any filter. The labels are
 * purely descriptive of the underlying classification.
 */
export const RADAR_FILTERS: readonly RadarFilterDef[] = [
  {
    key: 'all',
    label: 'الكل',
    icon: '📋',
    cls: 'bg-muted text-muted-foreground border-border',
  },
  {
    key: 'quiet_accumulation',
    label: 'تجميع هادئ',
    icon: '🟢',
    cls: 'bg-whale/10 text-whale border-whale/20',
  },
  {
    key: 'distribution',
    label: 'خطر تصريف',
    icon: '⚠️',
    cls: 'bg-warning/10 text-warning border-warning/20',
  },
  {
    key: 'dead_trap',
    label: 'مصيدة',
    icon: '⛔',
    cls: 'bg-loss/10 text-loss border-loss/20',
  },
  {
    key: 'liquidity_drought',
    label: 'جفاف سيولة',
    icon: '🔵',
    cls: 'bg-whale/10 text-whale border-whale/20',
  },
  {
    key: 'rule80_downtrend',
    label: 'هبوط',
    icon: '🩸',
    cls: 'bg-loss/10 text-loss border-loss/20',
  },
  // (ALPHA-UX-FIX): أخفينا «غير مصنف» + «بيانات غير مكتملة» من العميل.
  // مش مفروض العميل يشوف بيانات ناقصة أو غير مصنفة — ده بـ يخوّفه.
  // الكلاسيفكيشنز لسه موجودة في البيانات (للشفافية الداخلية) لكن مش بتظهر كـ filter chips.
  // {
  //   key: 'unclassified',
  //   label: 'غير مصنف',
  //   icon: '❓',
  //   cls: 'bg-muted text-muted-foreground border-border',
  // },
  // {
  //   key: 'data_invalid',
  //   label: 'بيانات غير مكتملة',
  //   icon: '🚫',
  //   cls: 'bg-warning/10 text-warning border-warning/20',
  // },
] as const;

// ============================================================================
// Helpers (pure — no React, no side effects)
// ============================================================================

/**
 * classifyStock — returns the canonical classification for a stock.
 * Falls back to `'unclassified'` when the API didn't send one (defensive
 * — older cache files won't have `classification` set).
 *
 * Treats a missing/null/empty classification as `'unclassified'` (NOT as
 * `'dead_trap'` — HARD CONSTRAINT #6).
 */
export function classifyStock(stock: RadarStockLike): RadarClassification {
  const c = stock?.classification;
  if (typeof c !== 'string' || !c) return 'unclassified';
  // Accept the value verbatim if it matches the enum; otherwise coerce.
  const known: RadarClassification[] = [
    'quiet_accumulation',
    'distribution',
    'dead_trap',
    'liquidity_drought',
    'rule80_downtrend',
    'unclassified',
    'INSUFFICIENT_DATA',
    'DATA_INVALID',
  ];
  return (known as string[]).includes(c) ? (c as RadarClassification) : 'unclassified';
}

/**
 * isDataInvalidStock — returns true if the stock is in the "bad data"
 * state (DATA_INVALID or INSUFFICIENT_DATA). Such stocks MUST render
 * separately from "dead_trap" (HARD CONSTRAINT #5).
 */
export function isDataInvalidStock(stock: RadarStockLike): boolean {
  const c = classifyStock(stock);
  return c === 'DATA_INVALID' || c === 'INSUFFICIENT_DATA';
}

/**
 * filterKeyMatchesClassification — maps a stock's classification to the
 * filter chip key it belongs under. Returns `null` if the stock should
 * NOT appear under any chip (which doesn't happen — every classification
 * maps to exactly one chip).
 *
 * The mapping is 1:1 EXCEPT for the `data_invalid` filter, which collects
 * BOTH `DATA_INVALID` and `INSUFFICIENT_DATA` (both share the "bad data"
 * semantic and the user-facing treatment).
 */
export function filterKeyForStock(stock: RadarStockLike): RadarFilterKey {
  const c = classifyStock(stock);
  if (c === 'DATA_INVALID' || c === 'INSUFFICIENT_DATA') return 'data_invalid';
  // All other classifications map 1:1 to their filter key.
  return c as Exclude<RadarClassification, 'DATA_INVALID' | 'INSUFFICIENT_DATA'>;
}

/**
 * filterStocksByClassification — returns the subset of `stocks` that
 * belongs under `filterKey`. The `all` filter returns every stock.
 *
 * Use this in the UI table to drive the visible rows.
 */
export function filterStocksByClassification<S extends RadarStockLike>(
  stocks: readonly S[],
  filterKey: RadarFilterKey,
): S[] {
  if (filterKey === 'all') return [...stocks];
  return stocks.filter((s) => filterKeyForStock(s) === filterKey);
}

/**
 * getRadarFilterCount — returns the count of stocks in `stocks` that
 * belong under `filterKey`. Computed in O(n) from the REAL array — no
 * hardcoding, no double-counting.
 *
 * For `filterKey === 'all'`, prefers `summary.scanned_count` when
 * available (it's the canonical "total scanned" number from the backend)
 * and falls back to `stocks.length` only when `summary` is missing.
 *
 * HARD CONSTRAINT #3: counts come from REAL API data.
 * HARD CONSTRAINT #4: no double-counting — every stock contributes to
 *   exactly ONE classification chip (DATA_INVALID + INSUFFICIENT_DATA
 *   share the `data_invalid` chip, but a single stock can only be one
 *   or the other, never both).
 */
export function getRadarFilterCount<S extends RadarStockLike>(
  stocks: readonly S[],
  filterKey: RadarFilterKey,
  summary?: RadarSummaryLike | null,
): number {
  if (filterKey === 'all') {
    // Prefer the canonical scanned_count from the backend (the source
    // of truth — `stocks.length` is the same array but the summary
    // number is what the engine reported).
    if (summary && typeof summary.scanned_count === 'number') {
      return summary.scanned_count;
    }
    return stocks.length;
  }
  return stocks.filter((s) => filterKeyForStock(s) === filterKey).length;
}

/**
 * buildRadarFilterCounts — convenience: returns a Record<RadarFilterKey, number>
 * of counts for ALL filters in one pass. Use this to render the chip row
 * without re-iterating the array once per chip.
 */
export function buildRadarFilterCounts<S extends RadarStockLike>(
  stocks: readonly S[],
  summary?: RadarSummaryLike | null,
): Record<RadarFilterKey, number> {
  const counts: Record<RadarFilterKey, number> = {
    all: 0,
    quiet_accumulation: 0,
    distribution: 0,
    dead_trap: 0,
    liquidity_drought: 0,
    rule80_downtrend: 0,
    unclassified: 0,
    data_invalid: 0,
  };
  for (const s of stocks) {
    const key = filterKeyForStock(s);
    counts[key] += 1;
  }
  // `all` is the canonical scanned total — prefer summary when available.
  counts.all =
    summary && typeof summary.scanned_count === 'number'
      ? summary.scanned_count
      : stocks.length;
  return counts;
}

/**
 * getRadarStatusReasons — returns the human-readable reasons explaining
 * WHY a stock got its classification. Used by the UI to show context
 * for DATA_INVALID / INSUFFICIENT_DATA stocks (HARD CONSTRAINT #5:
 * "Show the `reasons` / `sanity_status` so the user understands WHY").
 *
 * Returns a deduplicated, non-empty array of reasons (joined from
 * `reasons` + `sanity_reasons`). Returns `[]` if no reasons are present
 * (the UI then shows a generic fallback message).
 */
export function getRadarStatusReasons(stock: RadarStockLike): string[] {
  const out: string[] = [];
  if (Array.isArray(stock.reasons)) {
    for (const r of stock.reasons) {
      if (typeof r === 'string' && r.trim()) out.push(r.trim());
    }
  }
  if (Array.isArray(stock.sanity_reasons)) {
    for (const r of stock.sanity_reasons) {
      if (typeof r === 'string' && r.trim()) out.push(r.trim());
    }
  }
  // Deduplicate while preserving order.
  return Array.from(new Set(out));
}

/**
 * describeRadarStatus — returns a short human-readable status string for
 * a stock, suitable for the table's "status" column. Used for the
 * `data_invalid` filter view (where `phase` is misleading — it would
 * show "غير معروفة" for DATA_INVALID stocks).
 *
 * NO trade recommendation — purely descriptive.
 */
export function describeRadarStatus(stock: RadarStockLike): string {
  const c = classifyStock(stock);
  switch (c) {
    case 'DATA_INVALID':
      return 'بيانات غير صالحة';
    case 'INSUFFICIENT_DATA':
      return 'بيانات غير مكتملة';
    case 'unclassified':
      return 'غير مصنف';
    case 'quiet_accumulation':
      return 'تجميع هادئ';
    case 'distribution':
      return 'خطر تصريف';
    case 'dead_trap':
      return 'مصيدة';
    case 'liquidity_drought':
      return 'جفاف سيولة';
    case 'rule80_downtrend':
      return 'هبوط';
    default:
      return 'غير معروفة';
  }
}

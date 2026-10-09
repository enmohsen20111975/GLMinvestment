/**
 * market-utils.ts — Market normalization + segregation helpers
 * ===============================================================================
 *
 * Task PHASE3-MARKET-SEGREGATION (Rule 73 — DEEP-MARKET-SEPARATION)
 *
 * PROBLEM:
 *   There are 3 different naming conventions for the Saudi market:
 *     1. UI/store.ts     → 'TADAWUL'  (MarketType union)
 *     2. MARKET_CODES     → 'KSA'     (sent to API in some legacy components)
 *     3. stocks.db       → 'TADAWUL'  (390 rows)
 *     4. predictions.db  → 'EGX' only (no TADAWUL yet)
 *     5. unified_config.py → 'KSA'   (MarketProfile key)
 *
 *   When the frontend sends `market=KSA`, the stocks.db query
 *   `WHERE market = 'KSA'` returns 0 rows because the DB stores 'TADAWUL'.
 *   When the frontend sends `market=TADAWUL`, the Python backend's
 *   MARKET_PROFILES lookup fails because the key is 'KSA'.
 *
 * SOLUTION:
 *   Single helper `normalizeMarket()` that maps all aliases to a canonical
 *   value for each DB / API surface. All API routes that filter by market
 *   MUST use this helper instead of comparing raw user input.
 *
 * Rule 27 (NO-FAKE-DATA): when no predictions exist for a non-EGX market,
 *   return `{ success: true, predictions: [], message: "..." }` instead
 *   of HTTP 500.
 */

import type { MarketType } from '@/lib/store';

// ─── Canonical market codes ────────────────────────────────────────────────
// The frontend's MarketType union is the canonical source of truth.
// All other surfaces (DB columns, Python config, cache filenames) MUST
// map back to one of these 6 values.

export type CanonicalMarket = MarketType; // 'EGX'|'TADAWUL'|'KSE'|'QSE'|'US'|'CRYPTO'

// ─── Market alias map ──────────────────────────────────────────────────────
// All known aliases for each market. Used by `normalizeMarket()`.
const MARKET_ALIASES: Record<string, CanonicalMarket> = {
  // EGX
  egx: 'EGX',
  egypt: 'EGX',
  'مصر': 'EGX',
  egyptian: 'EGX',

  // TADAWUL (Saudi)
  tadawul: 'TADAWUL',
  ksa: 'TADAWUL',
  saudi: 'TADAWUL',
  'السعودية': 'TADAWUL',
  sa: 'TADAWUL',
  'تداول': 'TADAWUL',

  // KSE (Kuwait)
  kse: 'KSE',
  kuwait: 'KSE',
  'الكويت': 'KSE',

  // QSE (Qatar)
  qse: 'QSE',
  qatar: 'QSE',
  'قطر': 'QSE',

  // US
  us: 'US',
  usa: 'US',
  america: 'US',
  nyse: 'US',
  nasdaq: 'US',

  // CRYPTO
  crypto: 'CRYPTO',
  'كريبتو': 'CRYPTO',
  cryptocurrency: 'CRYPTO',
};

/**
 * Convert any market alias to the canonical MarketType value.
 * Returns null if the input doesn't match any known alias.
 *
 * Examples:
 *   normalizeMarket('KSA')        → 'TADAWUL'
 *   normalizeMarket('TADAWUL')     → 'TADAWUL'
 *   normalizeMarket('tadawul')     → 'TADAWUL'
 *   normalizeMarket('السعودية')    → 'TADAWUL'
 *   normalizeMarket('all')         → null  (no specific market)
 *   normalizeMarket('')            → null
 */
export function normalizeMarket(input: string | null | undefined): CanonicalMarket | null {
  if (!input) return null;
  const key = String(input).trim().toLowerCase();
  if (!key || key === 'all' || key === '*') return null;
  return MARKET_ALIASES[key] ?? null;
}

/**
 * Returns the SQL `WHERE market` variants for a given canonical market.
 * Different DBs store different aliases for the same market, so we list
 * all possible stored values.
 *
 * Examples:
 *   sqlMarketVariants('EGX')      → ['EGX', 'مصر']
 *   sqlMarketVariants('TADAWUL')  → ['TADAWUL', 'KSA', 'السعودية']
 *   sqlMarketVariants('KSE')      → ['KSE', 'الكويت']
 *   sqlMarketVariants('US')       → ['US', 'USA']
 */
export function sqlMarketVariants(market: CanonicalMarket): string[] {
  switch (market) {
    case 'EGX':
      return ['EGX', 'مصر'];
    case 'TADAWUL':
      // stocks.db stores 'TADAWUL' (390 rows).
      // predictions.db (production) stores 'KSA'.
      // Some legacy rows store 'السعودية'.
      return ['TADAWUL', 'KSA', 'السعودية'];
    case 'KSE':
      return ['KSE', 'الكويت'];
    case 'QSE':
      return ['QSE', 'قطر'];
    case 'US':
      return ['US', 'USA'];
    case 'CRYPTO':
      return ['CRYPTO'];
    default:
      return [];
  }
}

/**
 * Build a SQL `market IN (?, ?, ...)` clause for the given canonical market.
 * Returns `{ clause: '...', params: string[] }` or `{ clause: '', params: [] }`
 * if no filter is needed (market === null).
 *
 * Usage:
 *   const f = buildMarketFilter('TADAWUL');
 *   db.prepare(`SELECT * FROM predictions ${f.clause}`).all(...f.params);
 */
export function buildMarketFilter(
  market: CanonicalMarket | null,
  column: string = 'market'
): { clause: string; params: string[] } {
  if (!market) return { clause: '', params: [] };
  const variants = sqlMarketVariants(market);
  if (variants.length === 0) return { clause: '', params: [] };
  const placeholders = variants.map(() => '?').join(',');
  return {
    clause: `${column} IN (${placeholders})`,
    params: variants,
  };
}

/**
 * Returns the canonical market code used by the Python unified_config.py
 * MARKET_PROFILES dict. Some Python services still use 'KSA' instead of
 * 'TADAWUL', so we need to convert before calling Python endpoints.
 *
 * Examples:
 *   pythonMarketCode('TADAWUL')  → 'KSA'
 *   pythonMarketCode('EGX')      → 'EGX'
 *   pythonMarketCode('CRYPTO')   → 'CRYPTO'
 */
export function pythonMarketCode(market: CanonicalMarket): string {
  // unified_config.py uses 'KSA' as the MarketProfile key (line 394).
  // All other markets match the canonical name.
  if (market === 'TADAWUL') return 'KSA';
  return market;
}

/**
 * Arabic message shown when an API returns 0 results for a non-EGX market
 * (because predictions.db is sandbox-limited to EGX=153 rows).
 *
 * Rule 27 (NO-FAKE-DATA): do NOT fabricate predictions. Be honest about
 * the data gap and let the UI show a graceful empty state.
 */
export const NO_PREDICTIONS_MESSAGE_AR =
  'لا توجد توقعات متاحة لهذا السوق حالياً. يتم توليد التوقعات للسوق المصري أولاً، ثم تُضاف بقية الأسواق تدريجياً.';

/**
 * Arabic message shown when /api/stocks returns 0 stocks for a known market
 * (sandbox limitation: US has 0 rows in stocks.db; CRYPTO is handled via
 * a separate /api/crypto/coins endpoint).
 */
export const NO_STOCKS_MESSAGE_AR =
  'لا توجد أسهم متاحة لهذا السوق حالياً. يتم إضافة الأسهم تدريجياً لكل سوق. للعملات الرقمية، استخدم قائمة الكريبتو المخصصة.';

/**
 * Arabic message shown when an API call fails but the user should still
 * see a graceful response (instead of HTTP 500).
 */
export const INTERNAL_ERROR_MESSAGE_AR =
  'حدث خطأ داخلي مؤقت. يرجى المحاولة مرة أخرى خلال لحظات.';

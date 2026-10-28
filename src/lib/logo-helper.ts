/**
 * logo-helper.ts — عقيدة السعر الواحد (Single Source of Truth) لـ logo_url
 * =====================================================================
 * (ALPHA-DAL — owner directive 2026-10-27):
 * «عند عمل enrichWithLogos، احقن الخاصيتين معاً:
 *   record['logo_url'] = logo;
 *   record['logoUrl'] = logo;»
 *
 * ده الـ ROOT FIX لكارثة الـ casing mismatch: الـ API بيرجع logo_url (snake_case)
 * بس الـ components بتقرأ logoUrl (camelCase) → undefined → الدايرة الحمرا الفاضية.
 * بحقن الاتنين، أي component بيقرا أي casing هيلاقي الأيقونة.
 *
 * المصدر الموحد الآن هو DbManager.getUnifiedLogos() — DAL المقفل.
 */

// (ALPHA-DAL): redirect logo lookup to the unified DbManager (single DAL).
// الـ backward-compat: كل الـ imports الـ قديمة بتاعت logo-helper لسه شغّالة.
import { getUnifiedLogos as _getUnifiedLogos, getLogoUrl as _getLogoUrl } from './db-manager';

let _logoCache: Map<string, string> | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build logo lookup map (delegates to DbManager).
 * @deprecated Use DbManager.getUnifiedLogos() directly for new code.
 * Kept for backward-compat with existing callers.
 */
export function getLogoLookup(): Map<string, string> {
  const now = Date.now();
  if (_logoCache && (now - _cacheTimestamp) < CACHE_TTL_MS) {
    return _logoCache;
  }
  _logoCache = _getUnifiedLogos();
  _cacheTimestamp = now;
  return _logoCache;
}

/**
 * Get logo_url for a single ticker.
 * Returns null if not found (frontend will use fallback icon).
 */
export function getLogoUrl(ticker: string | null | undefined): string | null {
  return _getLogoUrl(ticker);
}

/**
 * Enrich an array of items with logos.
 * (ALPHA-DAL ROOT FIX): injects BOTH `logo_url` (snake_case) AND `logoUrl` (camelCase)
 * so ALL components — regardless of which casing they read — find the icon.
 *
 * Owner directive: «احقن الخاصيتين معاً: record['logo_url'] = logo; record['logoUrl'] = logo;»
 */
export function enrichWithLogos<T extends Record<string, unknown>>(
  items: T[],
  tickerField: string = 'ticker'
): T[] {
  const lookup = getLogoLookup();
  for (const item of items) {
    const record = item as Record<string, unknown>;
    const ticker = String(record[tickerField] || record['symbol'] || '').toUpperCase();
    if (ticker) {
      const logo = lookup.get(ticker);
      if (logo) {
        // ROOT FIX: inject BOTH casing variants so ALL components work.
        record['logo_url'] = logo;
        record['logoUrl'] = logo;
      }
    }
  }
  return items;
}

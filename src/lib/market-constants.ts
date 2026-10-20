/**
 * lib/market-constants.ts
 * ============================================================================
 * P0-COMPONENT-UNIFICATION (Phase 0.1): Canonical market constants — single
 * source of truth for ALL market-related constants (names, codes, currencies,
 * flags, index labels, options).
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 23+ أماكن بـ تعرّف نفس الـ market constants:
 *
 *   canonical (existing in lib/store.ts):
 *     - MARKET_NAMES_AR        lib/store.ts:589
 *     - MARKET_CODES            lib/store.ts:599
 *     - MARKET_CURRENCY_LABEL   lib/store.ts:609
 *
 *   duplicate (will be migrated in Phase 2):
 *     - MARKET_NAMES_AR (CONFLICTING!) lib/market-data-access.ts:394
 *       (TADAWUL = 'تداول السعودية' vs canonical 'السوق السعودي')
 *     - MARKET_FLAGS            MarketStatusImageCard.tsx:35 (canonical here now)
 *     - MARKET_CURRENCY         MarketStatusImageCard.tsx:44 (= MARKET_CURRENCY_LABEL)
 *     - MARKET_INDEX_LABEL      MarketStatusImageCard.tsx:53 (canonical here now)
 *     - MARKET_CODES            MarketStatusExport.tsx:21 (duplicate of store.ts)
 *     - MARKET_CODES            market-analysis/components/helpers.ts:189 (duplicate)
 *     - MARKET_FLAGS (dup)      PredictionsImageCard.tsx:75 (identical to canonical)
 *     - MARKET_OPTIONS (3 copies) lib/hashtag-library.ts:122 + MultiPortfolioSelector.tsx:77
 *         + PricingView.tsx:46 + shared/LiquidityRadarView.tsx:204 + layout/TopBar.tsx:73
 *     - MARKET_ALIASES         lib/market-data-access.ts:403 (kept there)
 *     - MARKET_MAP (7+ in API routes) app/api/predictions/daily-picks/route.ts:26
 *         + active-management/route.ts:22 + expert-recommendations/route.ts:52
 *         + stocks/search/route.ts:6 + stocks/top-performers/route.ts:18
 *         + screener/advanced/route.ts:40 + stored-analysis/results/route.ts:26
 *
 * Conflict resolution for TADAWUL translation:
 *   - lib/store.ts:        TADAWUL = 'السوق السعودي' (literal: "Saudi Market")
 *   - lib/market-data-access.ts: TADAWUL = 'تداول السعودية' (using official name)
 *   - Decision: keep 'السوق السعودي' (canonical — the more natural Arabic
 *     phrase used by mainstream users). 'تداول' is the official exchange name
 *     but 'السوق السعودي' is what people actually say. Phase 2 codemod بـ يـ
 *     يـستبدل كل الاستخدامات الـ conflicting.
 *
 * Migration (Phase 2): كل الأماكن الـ duplicate هـ تـستورد من هنا.
 * ============================================================================
 */

import type { MarketType } from '@/lib/store';

// ============================================================
// Re-exports من canonical sources (lib/store.ts)
// ============================================================
// ملاحظة: MARKET_NAMES_AR + MARKET_CODES + MARKET_CURRENCY_LABEL موجودة أصلاً
// في lib/store.ts و متـستخدمة في كذا مكان. مش هانقلهم هنا عشان ما نكسرش
// الـ imports الموجودة. بدل ده، بـ نـعمل re-export عشان الـ new code يقدر
// يستورد كل الـ market constants من مكان واحد.
export {
  MARKET_NAMES_AR,
  MARKET_CODES,
  MARKET_CURRENCY_LABEL,
  type MarketType,
} from '@/lib/store';

// ============================================================
// NEW canonical constants (لم تكن موجودة في lib/)
// ============================================================

/**
 * أعلام الدول لكل سوق (emoji flags). للـ UI فقط.
 *
 * @example
 * <span>{MARKET_FLAGS[market]} {MARKET_NAMES_AR[market]}</span>
 */
export const MARKET_FLAGS: Record<MarketType, string> = {
  EGX: '🇪🇬',
  TADAWUL: '🇸🇦',
  KSE: '🇰🇼',
  QSE: '🇶🇦',
  US: '🇺🇸',
  CRYPTO: '🪙',
} as const;

/**
 * وحدة العملة لكل سوق (مختصر عربي). مطابق لـ MARKET_CURRENCY_LABEL.
 *
 * @example
 * <span>{price} {MARKET_CURRENCY[market]}</span>  // → "125.50 ج.م"
 *
 * @deprecated استخدم `MARKET_CURRENCY_LABEL` من '@/lib/store' مباشرة.
 *   ده alias للـ backward compat فقط.
 */
export const MARKET_CURRENCY: Record<MarketType, string> = {
  EGX: 'ج.م',
  TADAWUL: 'ريال',
  KSE: 'د.ك',
  QSE: 'ر.ق',
  US: '$',
  CRYPTO: '$',
} as const;

/**
 * اسم المؤشر الرئيسي لكل سوق. للـ UI (لما بـ نـعرض "EGX30" بدل "البورصة المصرية"
 * لما بـ نتكلم عن المؤشر مش السوق نفسه).
 *
 * @example
 * <span>{MARKET_INDEX_LABEL[market]}: {indexValue}</span>
 * // → "مؤشر EGX30: 27,500"
 */
export const MARKET_INDEX_LABEL: Record<MarketType, string> = {
  EGX: 'مؤشر EGX30',
  TADAWUL: 'مؤشر تاسي',
  KSE: 'مؤشر السوق الكويتي',
  QSE: 'مؤشر بورصة قطر',
  US: 'مؤشر S&P 500 (SPY)',
  CRYPTO: 'العملات الرقمية',
} as const;

// ============================================================
// Market options (للـ dropdowns + selectors)
// ============================================================

/**
 * قائمة كل الأسواق بـ flag + label. للـ MarketSelector + dropdowns.
 *
 * @example
 * MARKET_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.flag} {m.label}</option>)
 */
export const MARKET_OPTIONS: ReadonlyArray<{
  value: Lowercase<MarketType>;
  label: string;
  flag: string;
}> = [
  { value: 'egx', label: 'مصر', flag: '🇪🇬' },
  { value: 'tadawul', label: 'السعودية', flag: '🇸🇦' },
  { value: 'kse', label: 'الكويت', flag: '🇰🇼' },
  { value: 'qse', label: 'قطر', flag: '🇶🇦' },
  { value: 'us', label: 'أمريكا', flag: '🇺🇸' },
  { value: 'crypto', label: 'كريبتو', flag: '₿' },
] as const;

/**
 * Khريطة من الـ lowercase value للـ uppercase MarketType.
 * للـ URL params اللي بـ تكون lowercase.
 *
 * @example
 * parseMarketValue('egx')      // → 'EGX'
 * parseMarketValue('tadawul') // → 'TADAWUL'
 * parseMarketValue('unknown') // → null
 */
export function parseMarketValue(value: string | null | undefined): MarketType | null {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  const found = MARKET_OPTIONS.find(o => o.value === v);
  return found ? (found.value.toUpperCase() as MarketType) : null;
}

/**
 * Khريطة من الـ uppercase MarketType لـ lowercase string (للـ URL params).
 *
 * @example
 * marketToValue('EGX')      // → 'egx'
 * marketToValue('TADAWUL') // → 'tadawul'
 */
export function marketToValue(market: MarketType): string {
  return market.toLowerCase();
}

// ============================================================
// MARKET_MAP (للـ API routes) — canonical version
// ============================================================

/**
 * خريطة من الـ uppercase MarketType لـ lowercase market code المستخدم في
 * الـ API params + DB queries. مفيد للـ API routes اللي بـ تستقبل market
 * كـ uppercase و بـ تحتاجه lowercase للـ DB.
 *
 * ملاحظة: ده مطابق لـ MARKET_CODES في lib/store.ts. الفرق: MARKET_CODES
 * بيرجّع 'KSA' لـ TADAWUL (للـ backend) و ده بيرجّع 'tadawul' (للـ DB).
 * الـ 7+ duplicate MARKET_MAP في الـ API routes بـ تستخدم ده بس.
 *
 * @example (API route)
 * const marketMap = MARKET_API_CODE_MAP;
 * const code = marketMap[req.query.market as MarketType];
 */
export const MARKET_API_CODE_MAP: Record<MarketType, string> = {
  EGX: 'egx',
  TADAWUL: 'tadawul',
  KSE: 'kse',
  QSE: 'qse',
  US: 'us',
  CRYPTO: 'crypto',
} as const;

/**
 * @deprecated Alias للـ backward compat مع الـ API routes اللي بـ تستخدم
 *   اسم `MARKET_MAP`. استخدم `MARKET_API_CODE_MAP` بدل ده.
 */
export const MARKET_MAP: Record<MarketType, string> = MARKET_API_CODE_MAP;

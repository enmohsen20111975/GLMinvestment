/**
 * modules/market-analysis/lib/sector-map.ts
 * ============================================================================
 * P0-COMPONENT-UNIFICATION (Phase 0.6): Canonical SECTOR_ARABIC_MAP + arSector().
 * ----------------------------------------------------------------------------
 * قبل كده: SECTOR_ARABIC_MAP + arSector() كانوا مـعرّفين محلياً في
 * SectorTrackingTab.tsx:108-134. لو أي مكان تاني احتاجهم (زي admin reports
 * أو image cards)، كان لازم يـنسخهم. كده هنا = single source of truth.
 *
 * Migration (Phase 2): SectorTrackingTab.tsx هـ يـستورد من هنا بدل التعريف
 * المحلي. أي مكان تاني محتاج تعريب قطاع بـ يستورد من هنا.
 * ============================================================================
 */

/**
 * خريطة تعريب القطاعات الإنجليزية للعربية.
 * مفاتيح الـ backend بـ يـرجّع القطاعات بالاسم الإنجليزي الرسمي
 * (GICS-style classification اللي بـ تستخدمه EGX).
 */
export const SECTOR_ARABIC_MAP: Record<string, string> = {
  // الأقطار الأساسية
  'Finance': 'القطاع المالي',
  'Banks': 'البنوك',
  'Process Industries': 'الصناعات الإجرائية',
  'Utilities': 'المرافق',
  'Producer Manufacturing': 'التصنيع والإنتاج',
  'Industrial Services': 'الخدمات الصناعية',
  // المواد والطاقة
  'Materials': 'المواد الأساسية',
  'Basic Materials': 'المواد الأساسية',
  'Energy': 'الطاقة',
  // الخدمات
  'Health Care': 'الرعاية الصحية',
  'Consumer Discretionary': 'السلع الاستهلاكية المختارة',
  'Consumer Staples': 'السلع الاستهلاكية الأساسية',
  'Real Estate': 'العقارات',
  'Communication Services': 'خدمات الاتصالات',
  'Information Technology': 'تكنولوجيا المعلومات',
  // مالية وتأمين
  'Insurance': 'التأمين',
  'Conglomerates': 'الشركات القابضة',
  // النقل والسياحة
  'Transportation': 'النقل والمواصلات',
  'Tourism': 'السياحة',
} as const;

/**
 * تعريب اسم القطاع الإنجليزي للعربية.
 * - لو الاسم موجود في الخريطة → بـ يـرجّع الترجمة العربية.
 * - لو الاسم null/undefined/فارغ → بـ يـرجّع 'غير محدد'.
 * - لو الاسم مش في الخريطة → بـ يـرجّعه زي ما هو (للقطاعات الجديدة اللي
 *   ممكن الـ backend يـرجّعها وأحنا لسه ما أضفناهش).
 *
 * @example
 * arSector('Finance')     // → 'القطاع المالي'
 * arSector('Banks')       // → 'البنوك'
 * arSector('Unknown')     // → 'Unknown'
 * arSector(null)          // → 'غير محدد'
 */
export function arSector(sector: string | null | undefined): string {
  if (!sector) return 'غير محدد';
  return SECTOR_ARABIC_MAP[sector] || sector;
}

/**
 * قائمة كل القطاعات العربية (للـ dropdowns + filters).
 * بـ تـتـستخرج من SECTOR_ARABIC_MAP اتوماتيكياً عشان ما يحصلش تكرار.
 *
 * @example
 * SECTOR_AR_OPTIONS.forEach(o => <option value={o.en}>{o.ar}</option>)
 */
export const SECTOR_AR_OPTIONS: ReadonlyArray<{ en: string; ar: string }> =
  Object.entries(SECTOR_ARABIC_MAP)
    // نشيل الـ duplicates اللي بـ تـرجّع نفس الترجمة (زي 'Materials' + 'Basic Materials')
    .filter(([en], i, arr) => arr.findIndex(([e]) => e === en) === i)
    .map(([en, ar]) => ({ en, ar }));

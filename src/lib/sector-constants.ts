/**
 * lib/sector-constants.ts
 * ============================================================================
 * P0-COMPONENT-UNIFICATION (Phase 0.2): Canonical sector color maps.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 2 copies بـ conventions مختلفة:
 *
 *   1) HEX colors (للـ charts/recharts fills):
 *      - modules/simulation/components/SimulationView.tsx:151
 *        SECTOR_COLORS: Record<string,string> = { 'البناء والتشييد': '#f59e0b', ... }
 *
 *   2) Tailwind badge classes (للـ badges/labels):
 *      - modules/stock-analysis/components/StocksView.tsx:247
 *        SECTOR_COLOR_MAP: Record<string,string> = { 'Financials': 'bg-profit text-profit/30 ', ... }
 *
 *      فيه bug مشهور: trailing spaces في `'bg-profit text-profit/30 '`
 *      (نفس نوع الباج اللي اتصلّح في helpers.ts. الصفحة دي بـ تنضّفهم).
 *
 * الاتنين موجودين هنا بـ أسماء واضحة عشان ما يحصلش خلط:
 *   - SECTOR_HEX_COLORS (للـ chart elements)
 *   - SECTOR_BADGE_CLASSES (للـ badge/label backgrounds)
 *
 * Migration (Phase 2): SimulationView + StocksView هـ يستوردوا من هنا.
 * ============================================================================
 */

// ============================================================
// HEX colors (للـ chart elements — recharts fills, inline styles)
// ============================================================

/**
 * خريطة من اسم القطاع (بالعربي) لـ HEX color.
 * للـ chart elements (recharts `<Cell fill="...">` و `style={{ backgroundColor }}`).
 *
 * ملاحظة: القطاعات هنا بـ الأسماء العربية الـ simulation-specific
 * (البناء والتشييد، الإعلام والاتصالات، …). للـ القطاعات الإنجليزية
 * الرسمية استخدم SECTOR_ARABIC_MAP من modules/market-analysis/lib/sector-map.
 *
 * @example
 * <Cell fill={SECTOR_HEX_COLORS[sector] || '#888'} />
 * <div style={{ backgroundColor: SECTOR_HEX_COLORS[sector] }} />
 */
export const SECTOR_HEX_COLORS: Record<string, string> = {
  'البناء والتشييد': '#f59e0b',
  'الإعلام والاتصالات': '#3b82f6',
  'العقارات': '#8b5cf6',
  'الخدمات المالية': '#10b981',
  'التأمين': '#ef4444',
  'الخدمات': '#06b6d4',
  'الأدوية': '#ec4899',
  'الصناعة': '#f97316',
  'الاستثمار': '#14b8a6',
  'البنوك': '#6366f1',
} as const;

/**
 * HEX fallback color للـ sectors غير الموجودة في الخريطة.
 */
export const SECTOR_HEX_FALLBACK = '#888888';

// ============================================================
// Tailwind badge classes (للـ badges/labels)
// ============================================================

/**
 * خريطة من اسم القطاع (إنجليزي أو عربي) لـ Tailwind badge classes.
 *
 * BUG FIX (P0): الـ StocksView.tsx القديم كان فيه bug مشهور — trailing
 * spaces في `'bg-profit text-profit/30 '`. الـ classes كانت invalid و
 * الـ `/30 ` ما كانش بـ يـ apply صح. هنا اتـصلّح: مفيش trailing spaces
 * و الـ opacity بتـعمل صح (`text-profit/30`).
 *
 * @example
 * <Badge className={cn('border', SECTOR_BADGE_CLASSES[sector])}>...</Badge>
 */
export const SECTOR_BADGE_CLASSES: Record<string, string> = {
  // Financials
  'Financials': 'bg-profit text-profit/30',
  'القطاع المالي': 'bg-profit text-profit/30',
  'الخدمات المالية': 'bg-profit text-profit/30',
  // Basic Materials
  'Basic Materials': 'bg-warning text-warning/30',
  'الأساسية': 'bg-warning text-warning/30',
  'المواد الأساسية': 'bg-warning text-warning/30',
  // Real Estate
  'Real Estate': 'bg-primary text-primary/30',
  'العقارات': 'bg-primary text-primary/30',
  // Consumer Goods
  'Consumer Goods': 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  'الاستهلاكية': 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  // Industrials
  'Industrials': 'bg-whale text-whale/30',
  'الصناعات التحويلية': 'bg-whale text-whale/30',
  'الصناعة': 'bg-whale text-whale/30',
  // Food & Beverage
  'Food & Beverage': 'bg-warning text-warning/30',
  'الأغذية والمشروبات': 'bg-warning text-warning/30',
  // Technology
  'Technology': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  'التكنولوجيا': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  'الإعلام والاتصالات': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  // Consumer Services
  'Consumer Services': 'bg-loss text-loss/30',
  'الخدمات الاستهلاكية': 'bg-loss text-loss/30',
  // Healthcare
  'Healthcare': 'bg-loss text-loss/30',
  'الرعاية الصحية': 'bg-loss text-loss/30',
  'الأدوية': 'bg-loss text-loss/30',
  // Energy
  'Energy': 'bg-warning text-warning/30',
  'الطاقة': 'bg-warning text-warning/30',
  // Telecommunications
  'Telecommunications': 'bg-whale text-whale/30',
  'الاتصالات': 'bg-whale text-whale/30',
  // Insurance
  'Insurance': 'bg-loss text-loss/30',
  'التأمين': 'bg-loss text-loss/30',
  // Banks (subset of Financials)
  'Banks': 'bg-profit text-profit/30',
  'البنوك': 'bg-profit text-profit/30',
  // Real Estate (Arabic simulation-specific)
  'الاستثمار': 'bg-warning text-warning/30',
  'البناء والتشييد': 'bg-whale text-whale/30',
  'الخدمات': 'bg-info text-info/30',
} as const;

/**
 * Fallback badge classes للـ sectors غير الموجودة في الخريطة.
 */
export const SECTOR_BADGE_FALLBACK = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';

// ============================================================
// Helper functions
// ============================================================

/**
 * بيرجّع HEX color للقطاع (للـ chart elements).
 * - لو القطاع موجود → بيرجّع HEX color.
 * - لو لأ → بيرجّع SECTOR_HEX_FALLBACK ('#888888').
 *
 * @example
 * <Cell fill={getSectorHex(sector)} />
 */
export function getSectorHex(sector: string | null | undefined): string {
  if (!sector) return SECTOR_HEX_FALLBACK;
  return SECTOR_HEX_COLORS[sector] || SECTOR_HEX_FALLBACK;
}

/**
 * بيرجّع Tailwind badge classes للقطاع (للـ badges/labels).
 * - محاولة مطابقة دقيقة (exact match) الأول.
 * - لو ما فيش، بـ يدور substring match (القطاعات العربية بـ تيجي بـ suffixes
 *   زي "القطاع المالي - بنوك" → بـ تطابق "القطاع المالي").
 * - لو كل المحاولات فشلت → بيرجّع SECTOR_BADGE_FALLBACK.
 *
 * @example
 * <Badge className={cn('border', getSectorBadgeClass(sector))}>...</Badge>
 */
export function getSectorBadgeClass(sector: string | null | undefined): string {
  if (!sector) return SECTOR_BADGE_FALLBACK;
  // (1) Exact match first
  if (SECTOR_BADGE_CLASSES[sector]) return SECTOR_BADGE_CLASSES[sector];
  // (2) Substring match (القطاعات العربية بـ تـحتوي suffixes)
  for (const key of Object.keys(SECTOR_BADGE_CLASSES)) {
    if (sector.includes(key) || key.includes(sector)) return SECTOR_BADGE_CLASSES[key];
  }
  // (3) Fallback
  return SECTOR_BADGE_FALLBACK;
}

/**
 * @deprecated Legacy alias للـ StocksView. استخدم `getSectorBadgeClass` بدل ده.
 */
export const SECTOR_COLOR_MAP = SECTOR_BADGE_CLASSES;

/**
 * @deprecated Legacy alias للـ StocksView. استخدم `getSectorBadgeClass` بدل ده.
 */
export function getSectorColor(sector: string | null | undefined): string {
  return getSectorBadgeClass(sector);
}

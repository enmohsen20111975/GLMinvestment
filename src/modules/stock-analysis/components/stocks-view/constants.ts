/**
 * stocks-view/constants.ts
 * ============================================================================
 * F-Phase3-Split-StocksView: All static constants used by StocksView and
 * its sub-components.
 *
 * قبل كده: كل الـ constants كانوا inline في StocksView.tsx أعلى الـ file.
 * دلوقتي: مستوردين من هنا → الـ container مفيش فيه constants blocks.
 * ============================================================================
 */

import type { QuickFilterKey } from './types';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  Flame,
  Shield,
} from 'lucide-react';

/** Curated EGX sector list (English names that match EGX data). */
export const SECTORS = [
  'الكل',
  'Financials',
  'Basic Materials',
  'Real Estate',
  'Consumer Goods',
  'Industrials',
  'Food & Beverage',
  'Technology',
  'Consumer Services',
  'Healthcare',
  'Energy',
  'Telecommunications',
];

/** Index filter chips per market (EGX30/70/100, TASI, etc.). */
export const INDEX_FILTERS: Record<string, Array<{ key: string; label: string }>> = {
  EGX: [
    { key: 'all', label: 'الكل' },
    { key: 'egx30', label: 'EGX 30' },
    { key: 'egx70', label: 'EGX 70' },
    { key: 'egx100', label: 'EGX 100' },
  ],
  TADAWUL: [
    { key: 'all', label: 'الكل' },
    { key: 'tasi', label: 'تاسي' },
  ],
  KSE: [
    { key: 'all', label: 'الكل' },
    { key: 'bursa', label: 'المؤشر العام' },
  ],
  QSE: [
    { key: 'all', label: 'الكل' },
    { key: 'qeindex', label: 'المؤشر العام' },
  ],
  US: [
    { key: 'all', label: 'الكل' },
    { key: 'sp500', label: 'S&P 500' },
    { key: 'nasdaq', label: 'NASDAQ' },
    { key: 'dow', label: 'Dow Jones' },
  ],
  CRYPTO: [{ key: 'all', label: 'الكل' }],
  GOLD: [{ key: 'all', label: 'الكل' }],
};

/** Default fallback (when currentMarket has no entry in INDEX_FILTERS). */
export const DEFAULT_INDEX_FILTERS = [{ key: 'all', label: 'الكل' }];

/**
 * (Task STOCKS-TABLE-V2) Quick filter chips — صف واحد مدمج من الفلاتر الأكثر
 * استخداماً: 3 فلاتر مؤشر (all/egx30/egx70) + 3 فلاتر قائمة مسبقة
 * (top_gainers/top_losers/most_active). تحل محل الـ 3 مستويات بحث السابقة.
 */
export const QUICK_FILTERS: Array<{ key: QuickFilterKey; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'egx30', label: 'EGX30' },
  { key: 'egx70', label: 'EGX70' },
  { key: 'top_gainers', label: 'الأعلى ارتفاعاً' },
  { key: 'top_losers', label: 'الأكثر انخفاضاً' },
  { key: 'most_active', label: 'الأنشط تداولاً' },
];

/** Default sort key (مستخدم في initialSort لـ UnifiedTable + في نص النشر). */
export const DEFAULT_SORT_KEY = 'change_1d';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

/** Price range preset buckets for the dropdown. */
export const PRICE_RANGE_OPTIONS = [
  { key: 'all', label: 'كل الأسعار' },
  { key: 'under-10', label: 'أقل من 10' },
  { key: '10-50', label: '10 - 50' },
  { key: '50-100', label: '50 - 100' },
  { key: 'over-100', label: 'أكثر من 100' },
];

/** Change filter preset buckets for the dropdown. */
export const CHANGE_FILTER_OPTIONS = [
  { key: 'all', label: 'الكل' },
  { key: 'gainers', label: 'المرتفعة فقط' },
  { key: 'losers', label: 'المنخفضة فقط' },
  { key: 'unchanged', label: 'الثابتة فقط' },
];

/** Mobile pagination page size. */
export const PAGE_SIZE = 20;

/** Guest freemium preview limit (ALPHA-UX-FIX-5). */
export const GUEST_STOCK_LIMIT = 50;

/** Preset dropdown options (with icons). */
export const PRESET_OPTIONS = [
  { key: 'all', label: 'كل الأسهم', icon: '📋' },
  { key: 'most_active', label: 'الأكثر نشاطا', icon: null },
  { key: 'top_gainers', label: 'الأكثر ربحا', icon: null },
  { key: 'top_losers', label: 'الأكثر خسارة', icon: '📉' },
  { key: 'undervalued', label: 'الأقل من القيمة العادلة', icon: null },
  { key: 'overvalued', label: 'الأعلى من القيمة العادلة', icon: '⚠️' },
];

/**
 * Preset buttons row (top of stocks tab) — same keys as PRESET_OPTIONS but
 * rendered as full-width buttons with lucide icons.
 */
export const PRESET_BUTTONS: Array<{
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}> = [
  { key: 'most_active', label: 'الأكثر نشاطا', icon: Flame, hint: 'حسب القيمة السوقية المتداولة' },
  { key: 'undervalued', label: 'أقل من القيمة العادلة', icon: DollarSign, hint: 'فرصة صعود > 5%' },
  { key: 'overvalued', label: 'أعلى من القيمة العادلة', icon: AlertTriangle, hint: 'فرصة هبوط > 5%' },
  { key: 'top_gainers', label: 'الأكثر ربحا', icon: TrendingUp, hint: 'أعلى تغير إيجابي' },
  { key: 'top_losers', label: 'الأكثر خسارة', icon: TrendingDown, hint: 'أعلى تغير سلبي' },
  { key: 'top_dividends', label: 'الأكثر توزيعات', icon: DollarSign, hint: 'أعلى عائد توزيعات نقدية' },
  { key: 'lowest_risk', label: 'الأقل مخاطرة', icon: Shield, hint: 'أقل تذبذب + أفضل ملاءة' },
];

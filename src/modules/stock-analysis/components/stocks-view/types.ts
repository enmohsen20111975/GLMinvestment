/**
 * stocks-view/types.ts
 * ============================================================================
 * F-Phase3-Split-StocksView: type aliases + prop-shape interfaces shared
 * between the StocksView container and its extracted sub-components.
 *
 * قبل كده: كل الـ types كانوا inline في StocksView.tsx (2,287 LOC).
 * دلوقتي: كل sub-component بـ يستورد نوعه من هنا → single source of truth.
 * ============================================================================
 */

import type { Stock } from '@/types';

/** Translation function signature (matches I18nContextValue.t from @/lib/i18n-context). */
export type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

/** Quick filter chip key — row of 6 chips at the top of the stocks card. */
export type QuickFilterKey =
  | 'all'
  | 'egx30'
  | 'egx70'
  | 'top_gainers'
  | 'top_losers'
  | 'most_active';

/** Active tab in StocksView (الأسهم / السندات / الفلاتر). */
export type StockTab = 'stocks' | 'bonds' | 'filters';

/** Row shape consumed by the desktop UnifiedTable (preset rows + Stock rows merged). */
export type DesktopRow = Record<string, unknown>;

/** Props for the OverviewSummary memo component. */
export interface OverviewSummaryProps {
  total: number;
  gainers: number;
  losers: number;
  unchanged: number;
  avgChange: number;
}

/** Props for the StockCard memo component (desktop card grid). */
export interface StockCardProps {
  stock: Stock;
  onClick: () => void;
}

/** Props for the MobileStockRow memo component (mobile list). */
export interface MobileStockRowProps {
  stock: Stock;
  onClick: () => void;
}

/** Props for the PresetButtonsRow memo component. */
export interface PresetButtonsRowProps {
  activePreset: string;
  onSelect: (preset: string) => void;
}

/** Props for the AdvancedFilters memo component (collapsible). */
export interface AdvancedFiltersProps {
  selectedSectors: string[];
  onToggleSector: (sector: string) => void;
  priceMin: string;
  priceMax: string;
  onPriceMinChange: (v: string) => void;
  onPriceMaxChange: (v: string) => void;
  changeMin: string;
  changeMax: string;
  onChangeMinChange: (v: string) => void;
  onChangeMaxChange: (v: string) => void;
  onReset: () => void;
  availableSectors: string[];
}

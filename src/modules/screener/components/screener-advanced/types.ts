// src/modules/screener/components/screener-advanced/types.ts
// F-Phase3-Split-Screener — كل interfaces/types المستخدمة في StockScreenerAdvanced
//及相关 sub-components. الـ domain types (ScreenerStock / TopPerformerStock /
// TopPerformersResponse) ما اتنقلتش هنا عشان هي أصلاً مُصدَّرة من
// `@/hooks/useScreenerData` (Phase 2 / F-Strangler-Screener)؛ نعيد تصديرها هنا
// عشان الـ sub-components تشتغل import من مكان واحد (single source of truth).

export type {
  ScreenerStock,
  TopPerformerStock,
  TopPerformersResponse,
} from '@/hooks/useScreenerData';

import type { ScreenerStock } from '@/hooks/useScreenerData';

// ─── Sort field types (client-side header click sorting) ────────────────────

export type SortField =
  | 'ticker'
  | 'current_price'
  | 'change_percent'
  | 'volume'
  | 'turnover_egp'
  | 'pe_ratio'
  | 'roe'
  | 'rsi'
  | 'stock_state'
  | 'momentum_score'
  | 'above_ma_50'
  | 'distance_from_52w_high';

export type SortDir = 'asc' | 'desc';

// ─── (UNIFIED-TABLE-UPGRADE) One-Click Trader Presets types ─────────────────

export interface ExtraClientFilter {
  label: string;
  test: (s: ScreenerStock) => boolean;
}

// ─── Collapsible section (UNIFIED-MARKET-UX / Task 3) ───────────────────────

export interface CollapsibleSectionProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

// ─── Main component props ───────────────────────────────────────────────────

export interface StockScreenerAdvancedProps {
  initialTab?: 'advanced' | 'top-performers';
  initialMarket?: string;
}

// ─── AdvancedFiltersTab props ────────────────────────────────────────────────

export interface AdvancedFiltersTabProps {
  initialMarket?: string;
}

// ─── Sub-component props ─────────────────────────────────────────────────────

export interface FilterFieldProps {
  label: string;
  help?: string;
  children: React.ReactNode;
}

export interface CheckboxFieldProps {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export interface KPIBoxProps {
  label: string;
  value: React.ReactNode;
  color?: string;
}

// ─── StateBadge component ────────────────────────────────────────────────────

export interface StateBadgeProps {
  state: string;
  reason?: string;
}

// ─── Reusable export dropdown (نص / WhatsApp / Facebook / CSV) ────────────────

export interface ExportDropdownProps {
  shareText: string;
  disabled?: boolean;
  showCsv?: boolean;
  onExportCsv?: () => void;
}

// ─── WhatsAppIcon (inline SVG — lucide has no WhatsApp export) ──────────────

export interface WhatsAppIconProps {
  className?: string;
}

// ─── Translation function type (shared shortcut) ─────────────────────────────

export type TFunc = (k: string, p?: any) => string;

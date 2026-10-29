// TradeResults types (Phase 3)
export const COLORS: Record<string, string> = {
  profit: '#10b981',
  loss: '#ef4444',
  neutral: '#6b7280',
  bg: '#0a0e1a',
  card: '#111827',
  border: '#1f2937',
  text: '#e5e7eb',
  muted: '#6b7280',
  // Extended fields used by SharedUi.tsx
  gold: '#f59e0b',
  cyan: '#06b6d4',
  textPrimary: '#e5e7eb',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  positive: '#10b981',
  negative: '#ef4444',
  bgCard: '#111827',
  bgCardAlt: '#0f172a',
  goldGlow: 'rgba(245, 158, 11, 0.35)',
};
export const FONT_FAMILY = 'system-ui, -apple-system, sans-serif';

export interface TradeResult {
  ticker: string;
  recommendation_price: number;
  target_price: number;
  exit_price: number | null;
  realized_return_pct: number;
  signal?: string;
  entry_price?: number;
  pnl_pct?: number | null;
  [key: string]: unknown;
}

export interface ReportStats {
  total_trades?: number;
  success_rate?: number;
  average_return?: number;
  total_price_movement?: number;
  top_trades?: TradeResult[];
  [key: string]: unknown;
}

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

export interface ReportData {
  date?: string;
  period_start?: string;
  period_end?: string;
  period?: ReportPeriod;
  stats?: ReportStats | null;
  validation?: { valid: boolean; errors: string[] };
  trades?: Array<{ ticker: string; signal: string; entry_price: number; exit_price: number | null; pnl_pct: number | null; }>;
  summary?: { total: number; wins: number; losses: number; win_rate: number; };
  [key: string]: unknown;
}

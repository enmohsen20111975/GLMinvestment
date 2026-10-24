// TradeResults types (Phase 3)
export const COLORS = {
  profit: '#10b981',
  loss: '#ef4444',
  neutral: '#6b7280',
  bg: '#0a0e1a',
  card: '#111827',
  border: '#1f2937',
  text: '#e5e7eb',
  muted: '#6b7280',
};
export const FONT_FAMILY = 'system-ui, -apple-system, sans-serif';
export interface ReportData {
  date: string;
  trades: Array<{ ticker: string; signal: string; entry_price: number; exit_price: number | null; pnl_pct: number | null; }>;
  summary: { total: number; wins: number; losses: number; win_rate: number; };
}

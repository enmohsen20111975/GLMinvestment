// PaperTrading types — full type definitions (Phase 3)
export type AssetType = 'stock' | 'crypto' | 'gold';
export type CloseReason = 'target_hit' | 'stop_loss' | 'manual' | 'timeout';

export interface PaperOrder {
  id: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  shares: number;
  entry_price: number;
  stop_loss: number | null;
  target_price: number | null;
  status: 'OPEN' | 'CLOSED';
  close_price: number | null;
  close_reason: CloseReason | null;
  opened_at: string;
  closed_at: string | null;
  pnl: number | null;
  pnl_pct: number | null;
  // Runtime-computed extras for OPEN positions (paper-trading-ws):
  order_type?: 'BUY' | 'SELL';
  asset_type?: AssetType;
  current_price?: number;
  market_value?: number;
  unrealized_pnl?: number;
  unrealized_pnl_pct?: number;
  take_profit?: number | null;
}

export interface ClosedOrder extends PaperOrder {
  status: 'CLOSED';
  close_price: number;
  close_reason: CloseReason;
  closed_at: string;
  pnl: number;
  pnl_pct: number;
}

export interface EquityHistoryPoint {
  time: string;
  equity: number;
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  stock: 'سهم',
  crypto: 'عملة رقمية',
  gold: 'ذهب',
};

export const CLOSE_REASON_BADGE_CLASS: Record<CloseReason, string> = {
  target_hit: 'bg-profit/10 text-profit border-profit/20',
  stop_loss: 'bg-loss/10 text-loss border-loss/20',
  manual: 'bg-muted text-muted-foreground border-border',
  timeout: 'bg-warning/10 text-warning border-warning/20',
};

export const CLOSE_REASON_LABELS_AR: Record<CloseReason, string> = {
  target_hit: 'ضرب الهدف',
  stop_loss: 'ضرب الوقف',
  manual: 'إغلاق يدوي',
  timeout: 'انتهاء المدة',
};

export const HISTORY_PAGE_SIZE = 20;

export const LIVE_PRICE_POLL_MS = 5000;
export const POLL_INTERVAL_MS = 10000;
export type OrderType = 'BUY' | 'SELL';
export type AutoClosedEntry = { order: PaperOrder; reason: string } & { status: 'CLOSED' };
export type OpenPosition = PaperOrder & { status: 'OPEN' };
export interface PaperTradingAccount {
  id: string;
  cash: number;
  initial_capital: number;
  created_at: string;
  // Extended fields used by AccountHeaderBar
  virtual_balance?: number;
  total_equity?: number;
  total_pnl?: number;
  win_rate?: number;
  total_trades?: number;
  [key: string]: unknown;
}

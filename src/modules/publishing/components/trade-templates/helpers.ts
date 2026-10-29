// TradeResults helpers (Phase 3)
export function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function fmtDate(dateStr: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return '—';
  try { return new Intl.DateTimeFormat('ar-EG', opts ?? { day: 'numeric', month: 'short' }).format(new Date(dateStr)); }
  catch { return dateStr; }
}
export function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return sign + v.toFixed(2) + '%';
}

export function isTradeExceedingTarget(trade: { exit_price?: number | null; target_price?: number | null }): boolean {
  if (trade.exit_price == null || trade.target_price == null) return false;
  return trade.exit_price >= trade.target_price;
}

export function isTradeStopLoss(trade: { exit_price?: number | null; stop_loss?: number | null }): boolean {
  if (trade.exit_price == null || trade.stop_loss == null) return false;
  return trade.exit_price <= trade.stop_loss;
}
export function isTradeProfitable(trade: { pnl_pct?: number | null; realized_return_pct?: number }): boolean {
  const v = trade.pnl_pct != null ? trade.pnl_pct : (trade as any).realized_return_pct;
  return v != null && v > 0;
}
export function normalizeReportData(data: any): any { return data; } // TODO: Phase 3 stub

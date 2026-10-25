// SingleStockAnalysis helpers (Phase 3)
export function buildAnalysisUrl(ticker: string, market: string): string {
  return `/api/stocks/${encodeURIComponent(ticker)}/unified?market=${encodeURIComponent(market)}`;
}
export function buildTvSymbol(ticker: string, market: string): string {
  if (market === 'CRYPTO' || ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].includes(ticker)) return `BINANCE:${ticker}USDT`;
  if (market === 'TADAWUL' || /^\d{4}$/.test(ticker)) return `TADAWUL:${ticker}`;
  if (market === 'US') return `NASDAQ:${ticker}`;
  return `EGX:${ticker}`;
}
export function timeframeToTvInterval(timeframe: string): string {
  const map: Record<string, string> = { '1D': '1', '1W': '60', '1M': 'D', '3M': 'W' };
  return map[timeframe] || 'D';
}
export async function captureCardScreenshot(element: HTMLElement): Promise<string | null> {
  try {
    const { toPng } = await import('html-to-image');
    return await toPng(element);
  } catch { return null; }
}
export async function quickAddAlert(ticker: string, currentPrice: number, dropPct: number = -3): Promise<boolean> {
  try {
    const res = await fetch('/api/alerts/quick-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, current_price: currentPrice, drop_pct: dropPct }),
    });
    return res.ok;
  } catch { return false; }
}

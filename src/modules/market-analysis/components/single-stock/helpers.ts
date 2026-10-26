export interface BuildAnalysisUrlOptions {
  ticker?: string;
  timeframe?: string;
  userState?: 'buyer' | 'owner' | string;
  isCrypto?: boolean;
  userId?: string;
  entryPrice?: number;
  entryQty?: number;
  market?: string;
}

export function buildAnalysisUrl(
  arg: string | BuildAnalysisUrlOptions,
  marketFallback?: string
): string {
  if (typeof arg === 'string') {
    const cleanTk = arg.trim().toUpperCase();
    const mkt = marketFallback || 'EGX';
    return `/api/stocks/${encodeURIComponent(cleanTk)}/unified?market=${encodeURIComponent(mkt)}`;
  }
  const opts = arg || {};
  const tk = String(opts.ticker || '').trim().toUpperCase();
  const tf = opts.timeframe || '1D';
  if (opts.isCrypto) {
    const p = new URLSearchParams({
      symbol: tk,
      timeframe: tf,
      limit: '120',
      _t: String(Date.now()),
    });
    return `/api/crypto/full-analysis?${p.toString()}`;
  }
  const p = new URLSearchParams({
    ticker: tk,
    timeframe: tf,
    limit: '120',
    state: opts.userState || 'buyer',
    _t: String(Date.now()),
  });
  if (opts.userId) p.set('user_id', opts.userId);
  if (opts.entryPrice != null && opts.entryPrice > 0) p.set('entry_price', String(opts.entryPrice));
  if (opts.entryQty != null && opts.entryQty > 0) p.set('entry_qty', String(opts.entryQty));
  return `/api/v2/chart/full-analysis?${p.toString()}`;
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

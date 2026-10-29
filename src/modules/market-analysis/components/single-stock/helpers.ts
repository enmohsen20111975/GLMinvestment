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
export async function captureCardScreenshot(element: HTMLElement, _label?: string): Promise<string | null> {
  try {
    const { toPng } = await import('html-to-image');
    return await toPng(element);
  } catch { return null; }
}

export interface QuickAddAlertOptions {
  ticker: string;
  refPrice: number;
  currentPrice?: number;
  dropPct?: number;
  addClientAlert?: (alert: any) => void;
}

export async function quickAddAlert(
  tickerOrOpts: string | QuickAddAlertOptions,
  currentPriceOrDropPct?: number,
  dropPct: number = -3,
): Promise<boolean> {
  try {
    let ticker: string;
    let currentPrice: number;
    let dpct: number = dropPct;
    if (typeof tickerOrOpts === 'string') {
      ticker = tickerOrOpts;
      currentPrice = (typeof currentPriceOrDropPct === 'number' ? currentPriceOrDropPct : 0);
    } else {
      const opts = tickerOrOpts || ({} as QuickAddAlertOptions);
      ticker = opts.ticker;
      currentPrice = opts.currentPrice ?? opts.refPrice ?? 0;
      if (typeof opts.dropPct === 'number') dpct = opts.dropPct;
      // Register client-side alert if callback provided
      if (typeof opts.addClientAlert === 'function') {
        try {
          opts.addClientAlert({
            ticker: ticker.toUpperCase(),
            type: 'price_drop',
            ref_price: opts.refPrice ?? currentPrice,
            threshold_pct: dpct,
            enabled: true,
          });
        } catch { /* ignore */ }
      }
    }
    const res = await fetch('/api/alerts/quick-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, current_price: currentPrice, drop_pct: dpct }),
    });
    return res.ok;
  } catch { return false; }
}

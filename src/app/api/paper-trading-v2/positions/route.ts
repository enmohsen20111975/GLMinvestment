/**
 * GET /api/paper-trading-v2/positions
 * ====================================
 * P40-Academy Pillar 1: Get open positions enriched with live prices + unrealized P&L.
 *
 * Fetches current prices for each open position's ticker from:
 *   - /api/stocks/[ticker]      (for EGX stocks)
 *   - /api/crypto               (for crypto — single fetch, then match by symbol)
 *   - /api/gold-silver          (for gold)
 *
 * Also runs the auto stop-loss / take-profit trigger check — if any open
 * order's SL or TP has been hit by the live price, it auto-closes it and
 * includes the closure in the `autoClosed` array (for UI toast notifications).
 *
 * Returns: {
 *   success, account, positions: OpenPosition[], autoClosed: [...], generatedAt
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getOrCreateAccount,
  getOpenOrders,
  recomputeEquity,
  checkAutoCloseTriggers,
  getPaperTradingUserId,
  type OpenPosition,
} from '@/lib/paper-trading-v2-db';
import { getSelfBaseUrl } from '@/lib/server-url';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

/** Fetch the live price for a single ticker (best-effort, 3s timeout). */
async function fetchLivePrice(request: NextRequest, ticker: string, assetType: string): Promise<number | null> {
  try {
    if (assetType === 'crypto') {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${PYTHON_BACKEND}/api/crypto/price?symbol=${encodeURIComponent(ticker)}`, {
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = await res.json();
      const price = data.price ?? data.current_price ?? data.last_price;
      return typeof price === 'number' ? price : null;
    }
    if (assetType === 'gold') {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${PYTHON_BACKEND}/api/gold-silver`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = await res.json();
      const price = data?.gold?.price_per_gram ?? data?.gold_price ?? null;
      return typeof price === 'number' ? price : null;
    }
    // stock — try the local Next.js API first (proxies to Python).
    // Use getSelfBaseUrl() to respect x-forwarded-host behind Caddy/Nginx.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const selfBase = getSelfBaseUrl(request);
    const res = await fetch(`${selfBase}/api/stocks/${encodeURIComponent(ticker)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const stock = data.stock || data;
    const price = stock?.current_price ?? stock?.last_price ?? stock?.close ?? null;
    return typeof price === 'number' ? price : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getPaperTradingUserId();
    const account = getOrCreateAccount(userId);
    const openOrders = getOpenOrders(userId);

    // Gather unique tickers + their asset types
    const tickerMap = new Map<string, string>();
    for (const o of openOrders) {
      if (!tickerMap.has(o.ticker)) tickerMap.set(o.ticker, o.asset_type);
    }

    // Fetch live prices in parallel
    const livePrices: Record<string, number> = {};
    await Promise.all(
      Array.from(tickerMap.entries()).map(async ([ticker, assetType]) => {
        const price = await fetchLivePrice(request, ticker, assetType);
        if (price != null) livePrices[ticker] = price;
      }),
    );

    // Auto-close any orders whose SL/TP has been hit
    const autoClosed = checkAutoCloseTriggers(userId, livePrices);

    // Recompute equity with the live prices
    const updatedAccount = recomputeEquity(userId, livePrices);

    // Build positions with unrealized P&L
    const positions: OpenPosition[] = openOrders
      .filter((o) => o.status === 'OPEN') // re-check after auto-close
      .map((o) => {
        const currentPrice = livePrices[o.ticker] ?? o.entry_price;
        const positionValue = o.shares * o.entry_price;
        const marketValue = o.shares * currentPrice;
        const unrealizedPnl = o.order_type === 'BUY'
          ? (currentPrice - o.entry_price) * o.shares
          : (o.entry_price - currentPrice) * o.shares;
        const unrealizedPnlPct = positionValue > 0
          ? (unrealizedPnl / positionValue) * 100
          : 0;
        return {
          ...o,
          current_price: currentPrice,
          market_value: Math.round(marketValue * 100) / 100,
          unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
          unrealized_pnl_pct: Math.round(unrealizedPnlPct * 100) / 100,
          position_value: Math.round(positionValue * 100) / 100,
        };
      });

    return NextResponse.json({
      success: true,
      account: {
        ...updatedAccount,
        win_rate: updatedAccount.total_trades > 0
          ? Math.round((updatedAccount.winning_trades / updatedAccount.total_trades) * 1000) / 10
          : 0,
      },
      positions,
      autoClosed,
      livePrices,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[paper-trading-v2/positions] Error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'فشل تحميل المراكز' },
      { status: 500 },
    );
  }
}

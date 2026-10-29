/**
 * GET /api/portfolio/holdings
 * ===========================
 * MONEY-TIER1.1: REAL holdings from portfolio_assets.
 *
 * BEFORE: proxied to Python backend on :8010 and, on failure, returned a
 *         HARDCODED mock of 5 imaginary stocks (COMI/ABUK/EAST/SWDY/HRHO).
 *         This lied to the customer — showing fake positions while the
 *         real portfolio sat unread in portfolio_assets.
 *
 * AFTER:  reads the customer's REAL holdings directly from portfolio_assets
 *         (stocks.db), computes live current_value per asset using the
 *         fallback chain: stocks.current_price → stock_price_history →
 *         data_engine clean close → avg_buy_price.
 *
 * The Python proxy is still attempted first (in case it returns richer
 * signals), but the fallback is now REAL DATA, never mock.
 *
 * Query params:
 *   user_id  — optional, override session user (mobile/admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { getLastCleanClose } from '@/lib/data-engine-db-sqljs';
import { getLiveEgyptGoldPrices } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

function dbExists(p: string): boolean {
  try { return fs.existsSync(p) && fs.statSync(p).size > 0; } catch { return false; }
}

async function tryPythonHoldings(userId: string | undefined): Promise<any | null> {
  const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
  try {
    const url = userId
      ? `${PY}/api/portfolio/holdings?user_id=${encodeURIComponent(userId)}`
      : `${PY}/api/portfolio/holdings`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data.holdings) && data.holdings.length > 0) return data;
    return null;
  } catch { return null; }
}

function fetchGoldPrices(): { '24k': number; '21k': number; '18k': number } {
  const fallback = { '24k': 4200, '21k': 3675, '18k': 3150 };
  try {
    const live = getLiveEgyptGoldPrices();
    if (live) {
      return {
        '24k': live['24k'] || fallback['24k'],
        '21k': live['21k'] || fallback['21k'],
        '18k': live['18k'] || fallback['18k'],
      };
    }
  } catch { /* ignore */ }
  return fallback;
}

function fetchUsdRate(db: any): number {
  try {
    const row = db.prepare(
      "SELECT rate FROM exchange_rates WHERE currency_from = 'USD' ORDER BY id DESC LIMIT 1"
    ).get() as any;
    if (row && Number(row.rate) > 0) return Number(row.rate);
  } catch { /* ignore */ }
  return 48.5;
}

let _cryptoCache: { ts: number; prices: Record<string, number> } = { ts: 0, prices: {} };
const CRYPTO_TTL_MS = 60_000;
async function fetchCryptoPrices(): Promise<Record<string, number>> {
  const now = Date.now();
  if (now - _cryptoCache.ts < CRYPTO_TTL_MS && Object.keys(_cryptoCache.prices).length > 0) {
    return _cryptoCache.prices;
  }
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const all = (await res.json()) as Array<{ symbol: string; lastPrice: string }>;
      const prices: Record<string, number> = {};
      for (const t of all) {
        if (t.symbol.endsWith('USDT') && t.lastPrice) {
          const sym = t.symbol.slice(0, -4);
          const price = Number(t.lastPrice);
          if (price > 0) prices[sym] = price;
        }
      }
      _cryptoCache = { ts: now, prices };
      return prices;
    }
  } catch { /* keep stale */ }
  return _cryptoCache.prices;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    let userId: string | undefined = url.searchParams.get('user_id') || undefined;
    if (!userId) {
      try {
        const session = await getSessionUserId();
        userId = session.userId || undefined;
      } catch { /* ignore */ }
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', holdings: [], total_items: 0 },
        { status: 401 }
      );
    }

    // 1) Try Python first (optional — richer signals when alive)
    const py = await tryPythonHoldings(userId);
    if (py) return NextResponse.json(py);

    // 2) REAL FALLBACK — read from portfolio_assets (truthful data)
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!dbExists(stocksDbPath)) {
      return NextResponse.json({
        success: true,
        holdings: [],
        total_items: 0,
        source: 'sqlite_fallback',
        error: 'stocks.db not found',
      });
    }

    const db = await getFinanceDb();
    const goldPrices = fetchGoldPrices();
    const usdRate = fetchUsdRate(db);
    const cryptoPrices = await fetchCryptoPrices();

    const assets = db.prepare(
      "SELECT * FROM portfolio_assets WHERE user_id = ? ORDER BY id DESC"
    ).all(userId) as any[];

    const holdings: any[] = [];
    let totalInvested = 0;
    let totalCurrent = 0;

    for (const asset of assets) {
      const type = String(asset.type || 'other').toLowerCase();
      let invested = Number(asset.total_invested || 0);
      let current = Number(asset.current_value || 0);
      let buyPrice = 0;
      let currentPrice = 0;
      let quantity = Number(asset.quantity || 0);
      let ticker = asset.stock_ticker || '';
      let name = asset.name || '';
      let market = asset.market || 'EGX';

      if (type === 'stock' && ticker) {
        const avgBuy = Number(asset.avg_buy_price || 0);
        if (invested <= 0 && quantity > 0 && avgBuy > 0) invested = quantity * avgBuy;
        buyPrice = avgBuy;

        let livePrice = 0;
        try {
          const stockRow = db.prepare(
            "SELECT current_price, previous_close, name, name_ar FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1"
          ).get(ticker) as any;
          if (stockRow) {
            if (Number(stockRow.current_price) > 0) livePrice = Number(stockRow.current_price);
            else if (Number(stockRow.previous_close) > 0) livePrice = Number(stockRow.previous_close);
            if (!name) name = stockRow.name_ar || stockRow.name || ticker;
          }
        } catch { /* ignore */ }

        if (livePrice <= 0) {
          try {
            const histRow = db.prepare(
              "SELECT close_price FROM stock_price_history WHERE stock_id = (SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1) ORDER BY date DESC LIMIT 1"
            ).get(ticker) as any;
            if (histRow && Number(histRow.close_price) > 0) livePrice = Number(histRow.close_price);
          } catch { /* ignore */ }
        }

        if (livePrice <= 0) {
          try {
            const cleanClose = await getLastCleanClose(ticker);
            if (cleanClose.price > 0) livePrice = cleanClose.price;
          } catch { /* ignore */ }
        }

        if (livePrice <= 0 && avgBuy > 0) livePrice = avgBuy;
        currentPrice = livePrice;
        if (livePrice > 0 && quantity > 0) current = livePrice * quantity;

      } else if (type === 'crypto') {
        const symbol = (ticker || asset.name || '').toUpperCase().trim();
        const avgBuyUsd = Number(asset.avg_buy_price || 0);
        if (invested <= 0 && quantity > 0 && avgBuyUsd > 0) {
          invested = quantity * avgBuyUsd * usdRate;
        }
        buyPrice = avgBuyUsd * usdRate;
        const liveUsd = cryptoPrices[symbol] || cryptoPrices[symbol + 'USDT'] || 0;
        if (liveUsd > 0 && quantity > 0) {
          current = liveUsd * quantity * usdRate;
          currentPrice = liveUsd * usdRate;
        } else if (current <= 0 && invested > 0) {
          current = invested;
        }
        if (!ticker) ticker = symbol;

      } else if (type === 'gold' || type === 'silver') {
        const weightGrams = Number(asset.weight_grams || 0);
        const karat = Number(asset.karat || 24);
        const purchasePricePerGram = Number(asset.purchase_price_per_gram || 0);
        if (invested <= 0 && weightGrams > 0 && purchasePricePerGram > 0) {
          invested = weightGrams * purchasePricePerGram;
        }
        buyPrice = purchasePricePerGram;
        const pricePerGram = karat === 24 ? goldPrices['24k']
                          : karat === 21 ? goldPrices['21k']
                          : karat === 18 ? goldPrices['18k']
                          : goldPrices['24k'];
        if (weightGrams > 0 && pricePerGram > 0) {
          current = pricePerGram * weightGrams;
          currentPrice = pricePerGram;
        }
        if (!name) name = `${karat} عيار ذهب`;

      } else if (['bank', 'certificate', 'fund', 'deposit', 'bond', 'savings_account'].includes(type)) {
        if (current <= 0 || Math.abs(current - invested) < 0.01) current = invested;
        buyPrice = invested;
        currentPrice = invested;

      } else {
        if (current <= 0 && invested > 0) current = invested;
        buyPrice = invested;
        currentPrice = current;
      }

      if (current <= 0 && invested > 0) current = invested;

      const pnlAmount = current - invested;
      const pnlPercent = invested > 0 ? (pnlAmount / invested) * 100 : 0;

      let holdingDays = 0;
      try {
        if (asset.added_at) {
          const added = new Date(String(asset.added_at).replace(' ', 'T'));
          holdingDays = Math.max(0, Math.floor((Date.now() - added.getTime()) / 86400000));
        }
      } catch { /* ignore */ }

      let subPortfolioName = 'المحفظة الافتراضية';
      try {
        if (asset.portfolio_id && asset.portfolio_id !== 'default') {
          const sp = db.prepare(
            "SELECT name FROM portfolios WHERE id = ? OR CAST(id AS TEXT) = ? LIMIT 1"
          ).get(asset.portfolio_id, String(asset.portfolio_id)) as any;
          if (sp?.name) subPortfolioName = sp.name;
        }
      } catch { /* ignore */ }

      let inWatchlist = false;
      try {
        const wl = db.prepare(
          "SELECT 1 FROM user_stock_watchlists w JOIN stocks s ON w.stock_id = s.id WHERE w.user_id = ? AND s.ticker = ? COLLATE NOCASE LIMIT 1"
        ).get(userId, ticker) as any;
        inWatchlist = !!wl;
      } catch { /* ignore */ }

      totalInvested += invested;
      totalCurrent += current;

      holdings.push({
        ticker,
        name: name || ticker,
        asset_type: type,
        sub_portfolio: subPortfolioName,
        portfolio_id: asset.portfolio_id || 'default',
        market,
        currency: asset.currency || (market === 'CRYPTO' ? 'USD' : 'EGP'),
        buy_price: Math.round(buyPrice * 100) / 100,
        current_price: Math.round(currentPrice * 100) / 100,
        quantity,
        invested_amount: Math.round(invested * 100) / 100,
        current_value: Math.round(current * 100) / 100,
        pnl_amount: Math.round(pnlAmount * 100) / 100,
        pnl_percent: Math.round(pnlPercent * 100) / 100,
        holding_days: holdingDays,
        in_watchlist: inWatchlist,
        is_holding: true,
      });
    }

    holdings.sort((a, b) => {
      if (a.asset_type === 'stock' && b.asset_type !== 'stock') return -1;
      if (a.asset_type !== 'stock' && b.asset_type === 'stock') return 1;
      return b.pnl_percent - a.pnl_percent;
    });

    return NextResponse.json({
      success: true,
      holdings,
      total_items: holdings.length,
      summary: {
        total_invested: Math.round(totalInvested * 100) / 100,
        total_current_value: Math.round(totalCurrent * 100) / 100,
        total_pnl: Math.round((totalCurrent - totalInvested) * 100) / 100,
        total_pnl_pct: totalInvested > 0
          ? Math.round(((totalCurrent - totalInvested) / totalInvested) * 10000) / 100
          : 0,
        winners: holdings.filter(h => h.pnl_percent > 0).length,
        losers: holdings.filter(h => h.pnl_percent < 0).length,
        usd_rate: usdRate,
        gold_prices: goldPrices,
      },
      source: 'sqlite_fallback',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/portfolio/holdings] Error:', e);
    return NextResponse.json(
      { success: false, error: 'internal_error', holdings: [], total_items: 0 },
      { status: 500 }
    );
  }
}

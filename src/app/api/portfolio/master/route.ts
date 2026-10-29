import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { getLastCleanClose } from '@/lib/data-engine-db-sqljs';
import { getLiveEgyptGoldPrices } from '@/lib/data-engine-db';
import type Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

/** Generic SQL row returned by better-sqlite3. */
type SqlRow = Record<string, unknown>;

// ── P31-PORTFOLIO-SMART-MATH: asset classification (mirrors calculate-values) ──
const YIELD_ASSET_TYPES = new Set(['bank', 'certificate', 'fund', 'bond', 'savings_account', 'deposit']);
const DEFAULT_BANK_YIELD_PCT = 20;

// ---------------------------------------------------------------------------
// P30 TASK 3: Master Portfolio Aggregation
// ---------------------------------------------------------------------------
// BUG: The old code only iterated over sub-portfolios from the `portfolios`
// table. If the user had assets in `portfolio_assets` but NO sub-portfolios,
// the master total stayed 0.
//
// FIX: Always read ALL user assets from `portfolio_assets` and compute the
// true master total. Sub-portfolios are still shown for display, but the
// aggregated total includes every asset the user owns — including those in
// the "default" portfolio (no portfolio_id).
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    // Try session auth first, fall back to query param (for mobile/admin)
    let userId: string | undefined = url.searchParams.get('user_id') || undefined;
    if (!userId) {
      try {
        const session = await getSessionUserId();
        userId = session.userId || undefined;
      } catch { /* ignore */ }
    }
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const db = await getFinanceDb();

    // Ensure portfolios table exists
    db.prepare(`
      CREATE TABLE IF NOT EXISTS portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        broker TEXT DEFAULT 'manual',
        market TEXT DEFAULT 'EGX',
        currency TEXT DEFAULT 'EGP',
        color TEXT DEFAULT 'blue',
        is_master INTEGER DEFAULT 0,
        initial_capital REAL DEFAULT 100000,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    // ── STEP 1: Fetch ALL user assets (no portfolio_id filter) ──
    // This is the source of truth for the master total.
    // NOTE: Use `id DESC` not `added_at DESC` — some DB instances don't have the added_at column.
    const allAssets = db.prepare(
      "SELECT * FROM portfolio_assets WHERE user_id = ? ORDER BY id DESC"
    ).all(userId) as Array<SqlRow>;

    // ── STEP 2: Compute live current_value for each asset ──
    // (reuse the fallback chain from calculate-values for stocks)
    const goldPrices = await getGoldPrices(db);
    // P34 TASK 2: fetch exchange rates so crypto (USD) can be converted to EGP
    const exchangeRates = await getExchangeRates(db);
    let totalInvestedAll = 0;
    let totalCurrentAll = 0;
    const assetsByPortfolio: Record<string, Array<SqlRow & { _live_current?: number; _live_invested?: number }>> = {};

    for (const asset of allAssets) {
      const type = asset.type || 'other';
      let invested = Number(asset.total_invested || 0);
      let current = Number(asset.current_value || 0);

      if (type === 'stock' && asset.stock_ticker) {
        const qty = Number(asset.quantity || 0);
        const avgBuy = Number(asset.avg_buy_price || 0);
        if (invested <= 0 && qty > 0 && avgBuy > 0) invested = qty * avgBuy;

        try {
          const stockRow = db.prepare(
            "SELECT current_price, previous_close FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1"
          ).get(asset.stock_ticker) as { current_price?: number | string; previous_close?: number | string } | undefined;
          let livePrice = 0;
          if (stockRow) {
            if (Number(stockRow.current_price) > 0) livePrice = Number(stockRow.current_price);
            else if (Number(stockRow.previous_close) > 0) livePrice = Number(stockRow.previous_close);
          }
          if (livePrice <= 0) {
            try {
              // (ALPHA-DAL-WAVE2 — owner directive 2026-10-27):
              // «جلب السعر المباشر من stocks.db.stock_daily_prices أو عمود stocks.current_price».
              // نقرأ آخر إغلاق من stock_daily_prices (المصدر الحي المحدث يوميًا)
              // بدل stock_price_history القديم.
              const histRow = db.prepare(
                "SELECT close_price FROM stock_daily_prices WHERE ticker = ? AND close_price > 0 ORDER BY price_date DESC LIMIT 1"
              ).get(asset.stock_ticker) as { close_price?: number | string } | undefined;
              if (histRow && Number(histRow.close_price) > 0) livePrice = Number(histRow.close_price);
            } catch { /* table may not exist */ }
          }
          // ── P31 TASK 2: data_engine.db fallback (egksco_price_history) ──
          // (ALPHA-DAL-WAVE2): updated from price_history.db (dead) to
          // data_engine.db.egksco_price_history (migrated, working). Used as
          // emergency fallback if stocks.db has no candle data.
          if (livePrice <= 0) {
            try {
              const cleanClose = await getLastCleanClose(String(asset.stock_ticker));
              if (cleanClose.price > 0) livePrice = cleanClose.price;
            } catch { /* safe skip */ }
          }
          if (livePrice <= 0 && avgBuy > 0) livePrice = avgBuy;
          if (livePrice > 0 && qty > 0) current = livePrice * qty;
        } catch { /* ignore */ }
      } else if (type === 'crypto') {
        // ── P34 TASK 2: FX CONVERSION FIX ──
        // Crypto is priced in USD. Convert to EGP using the live USD/EGP rate
        // before adding to portfolio totals.
        // Formula: crypto_value_egp = quantity × live_price_usd × usd_egp_rate
        const symbol = String(asset.stock_ticker || asset.name || '').toUpperCase().trim();
        const qty = Number(asset.quantity || 0);
        const avgBuyUsd = Number(asset.avg_buy_price || 0);
        const usdRate = exchangeRates['USD'] || 48.5;
        if (invested <= 0 && qty > 0 && avgBuyUsd > 0) {
          invested = qty * avgBuyUsd * usdRate; // USD → EGP
        }
        try {
          const livePriceUsd = await getCryptoLivePrice(symbol);
          if (livePriceUsd > 0 && qty > 0) {
            current = livePriceUsd * qty * usdRate; // EGP
          } else if (current <= 0 && invested > 0) {
            current = invested;
          }
        } catch {
          if (current <= 0 && invested > 0) current = invested;
        }
      } else if (type === 'gold' || type === 'silver') {
        const weightGrams = Number(asset.weight_grams || 0);
        const karat = Number(asset.karat || 24);
        const purchasePricePerGram = Number(asset.purchase_price_per_gram || 0);
        if (invested <= 0 && weightGrams > 0 && purchasePricePerGram > 0) invested = weightGrams * purchasePricePerGram;
        const pricePerGram = karat === 24 ? goldPrices['24k'] : karat === 21 ? goldPrices['21k'] : karat === 18 ? goldPrices['18k'] : goldPrices['24k'];
        if (weightGrams > 0 && pricePerGram > 0) current = pricePerGram * weightGrams;
      } else if (['bank', 'certificate', 'fund', 'deposit'].includes(String(type))) {
        // Bank/certificate: current = invested + accrued interest
        if (current <= 0 || Math.abs(current - invested) < 0.01) current = invested;
      } else {
        if (current <= 0 && invested > 0) current = invested;
      }

      if (current <= 0 && invested > 0) current = invested;

      totalInvestedAll += invested;
      totalCurrentAll += current;

      // Group by portfolio_id for display
      const pid = String(asset.portfolio_id || 'default');
      if (!assetsByPortfolio[pid]) assetsByPortfolio[pid] = [];
      assetsByPortfolio[pid].push({ ...asset, _live_current: current, _live_invested: invested });
    }

    // ── STEP 3: Fetch sub-portfolios for display ──
    const subPortfolios = db.prepare(
      "SELECT * FROM portfolios WHERE (user_id = ? OR user_id = 'default') AND is_master = 0 ORDER BY id ASC"
    ).all(userId) as Array<SqlRow>;

    const aggregated = {
      total_value: 0,
      cash: 0,
      invested_amount: 0,
      net_pnl: 0,
      net_pnl_pct: 0,
    };

    const portfolioDetails: Array<SqlRow> = [];
    const seenPortfolioIds = new Set<string>();

    // ── STEP 4: Build sub-portfolio details ──
    for (const sp of subPortfolios) {
      const spId = String(sp.id);
      seenPortfolioIds.add(spId);
      const spCash = Number(sp.initial_capital) || 0;

      const spAssets = assetsByPortfolio[spId] || [];
      let spInvested = spAssets.reduce((s, a) => s + (a._live_invested || 0), 0);
      let spAssetsVal = spAssets.reduce((s, a) => s + (a._live_current || 0), 0);

      const spVal = spAssetsVal + spCash;
      const spPnl = spAssetsVal - spInvested;
      const pnlPct = spInvested > 0 ? (spPnl / spInvested) * 100 : 0;

      aggregated.total_value += spVal;
      aggregated.cash += spCash;
      aggregated.invested_amount += spInvested;
      aggregated.net_pnl += spPnl;

      portfolioDetails.push({
        id: sp.id,
        name: sp.name,
        broker: sp.broker,
        market: sp.market,
        currency: sp.currency,
        color: sp.color || 'blue',
        initial_capital: Number(sp.initial_capital) || 0,
        current_value: Math.round(spVal * 100) / 100,
        cash: Math.round(spCash * 100) / 100,
        invested: Math.round(spInvested * 100) / 100,
        pnl: Math.round(spPnl * 100) / 100,
        pnl_pct: Math.round(pnlPct * 100) / 100,
        positions_count: spAssets.length,
      });
    }

    // ── STEP 5: Add "Default Portfolio" for assets not in any sub-portfolio ──
    // This is the KEY FIX: assets with portfolio_id='default' or NULL are now counted.
    const defaultAssets = assetsByPortfolio['default'] || [];
    if (defaultAssets.length > 0) {
      const dpInvested = defaultAssets.reduce((s, a) => s + (a._live_invested || 0), 0);
      const dpAssetsVal = defaultAssets.reduce((s, a) => s + (a._live_current || 0), 0);
      const dpPnl = dpAssetsVal - dpInvested;
      const dpPnlPct = dpInvested > 0 ? (dpPnl / dpInvested) * 100 : 0;

      aggregated.total_value += dpAssetsVal;
      aggregated.invested_amount += dpInvested;
      aggregated.net_pnl += dpPnl;

      portfolioDetails.push({
        id: 'default',
        name: 'المحفظة الافتراضية',
        broker: 'manual',
        market: 'EGX',
        currency: 'EGP',
        color: 'emerald',
        initial_capital: 0,
        current_value: Math.round(dpAssetsVal * 100) / 100,
        cash: 0,
        invested: Math.round(dpInvested * 100) / 100,
        pnl: Math.round(dpPnl * 100) / 100,
        pnl_pct: Math.round(dpPnlPct * 100) / 100,
        positions_count: defaultAssets.length,
      });
    }

    // ── STEP 6: Safety net — if still 0 but user has assets, use raw totals ──
    if (aggregated.invested_amount === 0 && allAssets.length > 0) {
      aggregated.total_value = Math.round(totalCurrentAll * 100) / 100;
      aggregated.invested_amount = Math.round(totalInvestedAll * 100) / 100;
      aggregated.net_pnl = Math.round((totalCurrentAll - totalInvestedAll) * 100) / 100;
    }

    if (aggregated.invested_amount > 0) {
      aggregated.net_pnl_pct = Math.round((aggregated.net_pnl / aggregated.invested_amount) * 10000) / 100;
    }
    aggregated.total_value = Math.round(aggregated.total_value * 100) / 100;
    aggregated.cash = Math.round(aggregated.cash * 100) / 100;
    aggregated.invested_amount = Math.round(aggregated.invested_amount * 100) / 100;
    aggregated.net_pnl = Math.round(aggregated.net_pnl * 100) / 100;

    // ── P31-PORTFOLIO-SMART-MATH (Task 1+2): wealth/yield split for the master view ──
    let wealthAssetsValue = 0;
    let yieldAssetsValue = 0;
    let annualYieldEgp = 0;
    for (const a of allAssets) {
      const t = String(a.type || 'other').toLowerCase();
      const cv = Number(a._live_current || a.current_value || 0);
      const inv = Number(a._live_invested || a.total_invested || 0);
      if (YIELD_ASSET_TYPES.has(t)) {
        yieldAssetsValue += cv;
        let rate = Number(a.interest_rate || a.certificate_return_rate || a.annual_return_rate || a.return_rate || a.annual_yield || 0);
        if (rate <= 0) rate = DEFAULT_BANK_YIELD_PCT;
        annualYieldEgp += inv * (rate / 100);
      } else {
        wealthAssetsValue += cv;
      }
    }

    // ── P34 TASK 3: DEBT DEDUCTION (Net Worth = Assets − Liabilities) ──
    // Read active obligations and subtract from gross assets value.
    const totalObligationsEgp = await getTotalObligations(db, userId);
    const netWorthEgp = totalCurrentAll - totalObligationsEgp;

    const smartMath = {
      wealth_assets_value: Math.round(wealthAssetsValue * 100) / 100,
      yield_assets_value: Math.round(yieldAssetsValue * 100) / 100,
      annual_yield_egp: Math.round(annualYieldEgp * 100) / 100,
      monthly_yield_egp: Math.round((annualYieldEgp / 12) * 100) / 100,
      // P34: net_worth_egp now deducts active debts (loans/installments)
      net_worth_egp: Math.round(netWorthEgp * 100) / 100,
      total_obligations_egp: Math.round(totalObligationsEgp * 100) / 100,
      gross_assets_egp: Math.round(totalCurrentAll * 100) / 100,
    };

    return NextResponse.json({
      success: true,
      aggregated,
      sub_portfolios: portfolioDetails,
      equity_curve: [],
      assets_count: allAssets.length,
      // P34: expose net worth + obligations at the top level for the UI
      total_obligations_egp: Math.round(totalObligationsEgp * 100) / 100,
      net_worth_egp: Math.round(netWorthEgp * 100) / 100,
      exchange_rates: exchangeRates,
      smart_math: smartMath,
    });
  } catch (e) {
    console.error('[GET /api/portfolio/master] Error:', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}

// ── Gold prices helper (v3.65.1: canonical source = data_engine.db) ──
// The `db` parameter is kept for signature compatibility but ignored — gold prices
// are no longer read from stocks.db (which had 3 stale rows from 2026-06-03).
// See Documentation/DB_CLEANUP_PLAN_v3.65.1.md P0-2.
async function getGoldPrices(db: Database.Database): Promise<{ '24k': number; '21k': number; '18k': number }> {
  void db; // gold prices are sourced from data_engine (see v3.65.1)
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
    return fallback;
  } catch {
    return fallback;
  }
}

// ── P34 TASK 2: Exchange rates helper (mirrors calculate-values) ──
// Needed so crypto (USD-denominated) can be converted to EGP.
async function getExchangeRates(db: Database.Database): Promise<Record<string, number>> {
  const fallback: Record<string, number> = { USD: 48.5, EUR: 52.8, GBP: 62.5, SAR: 12.9, AED: 13.2 };
  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='exchange_rates'").get() as SqlRow | undefined;
    if (!tableCheck) return fallback;
    const rows = db.prepare("SELECT currency_from, rate FROM exchange_rates").all() as Array<{ currency_from: string; rate: number | string }>;
    for (const r of rows) {
      if (r.currency_from && Number(r.rate) > 0) {
        fallback[r.currency_from.toUpperCase()] = Number(r.rate);
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

// ── P34 TASK 3: Active obligations reader (debt deduction) ──
// Mirrors calculate-values. Returns sum of remaining_amount for active debts.
async function getTotalObligations(db: Database.Database, userId: string): Promise<number> {
  try {
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='financial_obligations'"
    ).get() as SqlRow | undefined;
    if (!tableCheck) return 0;
    const row = db.prepare(
      "SELECT COALESCE(SUM(remaining_amount), 0) AS total " +
      "FROM financial_obligations " +
      "WHERE user_id = ? AND (status = 'active' OR status IS NULL OR status = '')"
    ).get(userId) as SqlRow | undefined;
    return Number(row?.total || 0);
  } catch {
    return 0;
  }
}

// ── P34 TASK 2: Live crypto price (mirrors calculate-values) ──
// Fetches the live USD price for a single crypto symbol from Binance.
// 60-second in-memory cache. Returns 0 on failure.
let _cryptoPriceCache: { ts: number; prices: Record<string, number> } = { ts: 0, prices: {} };
const CRYPTO_CACHE_TTL_MS = 60_000;

async function getCryptoLivePrice(symbol: string): Promise<number> {
  if (!symbol) return 0;
  const now = Date.now();
  if (now - _cryptoPriceCache.ts > CRYPTO_CACHE_TTL_MS) {
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const all = await res.json() as Array<{ symbol: string; lastPrice: string }>;
        const prices: Record<string, number> = {};
        for (const t of all) {
          if (t.symbol.endsWith('USDT') && t.lastPrice) {
            const sym = t.symbol.slice(0, -4);
            const price = Number(t.lastPrice);
            if (price > 0) prices[sym] = price;
          }
        }
        _cryptoPriceCache = { ts: now, prices };
      }
    } catch {
      // keep stale cache
    }
  }
  return _cryptoPriceCache.prices[symbol]
    || _cryptoPriceCache.prices[symbol + 'USDT']
    || 0;
}

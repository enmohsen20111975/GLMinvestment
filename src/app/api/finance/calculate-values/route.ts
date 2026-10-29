/**
 * GET /api/finance/calculate-values
 * =================================
 * FIX: was proxying to /api/live-monitor (wrong!).
 * Now reads portfolio_assets from stocks.db, enriches with current prices,
 * and returns the full asset list + summary + gold prices.
 *
 * Returns: { success, items: [...], gold_prices: {...},
 *            total_invested, total_current_value, total_profit_loss,
 *            profit_loss_percent, assets_count, by_type }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { getLastCleanClose } from '@/lib/data-engine-db-sqljs';
import { getLiveEgyptGoldPrices } from '@/lib/data-engine-db';
import type Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

/** Generic SQL row returned by better-sqlite3. */
type SqlRow = Record<string, unknown>;

// ── P31-PORTFOLIO-SMART-MATH: Wealth vs Yield asset classification ──
// Wealth Assets (تحفظ الثروة): value from market, Yield = 0% (gold, real_estate, car, stock, crypto).
// Yield Assets (تولد العائد): bank, certificate, fund, bond, deposit — generate annual yield.
const WEALTH_ASSET_TYPES = new Set(['gold', 'silver', 'real_estate', 'car', 'stock', 'crypto', 'currency', 'forex', 'other']);
const YIELD_ASSET_TYPES = new Set(['bank', 'certificate', 'fund', 'bond', 'savings_account', 'deposit']);
const DEFAULT_BANK_YIELD_PCT = 20; // fallback yield for bank/cert/fund without explicit rate

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'يجب تسجيل الدخول',
      }, { status: 401 });
    }

    const db = await getFinanceDb();

    // Check if portfolio_assets table exists
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_assets'").get() as SqlRow | undefined;
      if (!tableCheck) {
        return NextResponse.json({
          success: true,
          items: [],
          gold_prices: null,
          total_invested: 0,
          total_current_value: 0,
          total_profit_loss: 0,
          profit_loss_percent: 0,
          assets_count: 0,
          by_type: {},
          message: 'Portfolio table not initialized',
        });
      }
    } catch {
      return NextResponse.json({
        success: true,
        items: [],
        gold_prices: null,
        total_invested: 0,
        total_current_value: 0,
        total_profit_loss: 0,
        profit_loss_percent: 0,
        assets_count: 0,
        by_type: {},
      });
    }

    const { searchParams } = new URL(request.url);
    const portfolioId = searchParams.get('portfolio_id');

    // Fetch assets for the user (strictly filtered by portfolio_id if specified)
    let querySql = "SELECT * FROM portfolio_assets WHERE user_id = ?";
    const queryParams: unknown[] = [userId];

    if (portfolioId && portfolioId !== 'master' && portfolioId !== 'all') {
      if (portfolioId === 'default') {
        querySql += " AND (portfolio_id = 'default' OR portfolio_id IS NULL OR portfolio_id = '')";
      } else {
        querySql += " AND (portfolio_id = ? OR portfolio_id = CAST(? AS TEXT))";
        queryParams.push(portfolioId, portfolioId);
      }
    }

    // P30: Use id DESC — some DB instances don't have the added_at column
    querySql += " ORDER BY id DESC";
    const assets = db.prepare(querySql).all(...queryParams) as Array<SqlRow>;

    // Fetch gold prices & exchange rates
    const goldPrices = await getGoldPrices(db);
    const exchangeRates = await getExchangeRates(db);

    if (assets.length === 0) {
      return NextResponse.json({
        success: true,
        items: [],
        gold_prices: goldPrices,
        exchange_rates: exchangeRates,
        total_invested: 0,
        total_current_value: 0,
        total_profit_loss: 0,
        profit_loss_percent: 0,
        assets_count: 0,
        by_type: {},
      });
    }

    let totalInvested = 0;
    let totalCurrentValue = 0;
    const byType: Record<string, { count: number; invested: number; current: number; profit_loss: number }> = {};

    const now = new Date();

    for (const asset of assets) {
      let invested = Number(asset.total_invested || 0);
      let current = Number(asset.current_value || 0);
      const type = String(asset.type || 'other');

      if (type === 'stock' && asset.stock_ticker) {
        try {
          const qty = Number(asset.quantity || 0);
          const avgBuy = Number(asset.avg_buy_price || 0);
          if (invested <= 0 && qty > 0 && avgBuy > 0) {
            invested = qty * avgBuy;
            asset.total_invested = invested;
          }

          // ── P30 TASK 1: Fallback chain for live price ──
          // (1) stocks.current_price (live TradingView)
          // (2) stocks.previous_close (yesterday's close)
          // (3) stock_price_history.close_price (last historical)
          // (4) avg_buy_price (purchase price — P&L = 0, not -100%)
          const stockRow = db.prepare(
            "SELECT current_price, previous_close FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1"
          ).get(String(asset.stock_ticker)) as { current_price?: number | string; previous_close?: number | string } | undefined;

          let livePrice = 0;
          let priceSource = 'none';

          if (stockRow) {
            if (Number(stockRow.current_price) > 0) {
              livePrice = Number(stockRow.current_price);
              priceSource = 'stocks.current_price';
            } else if (Number(stockRow.previous_close) > 0) {
              livePrice = Number(stockRow.previous_close);
              priceSource = 'stocks.previous_close';
            }
          }

          // Fallback 3: last historical close from stocks.db.stock_price_history
          if (livePrice <= 0) {
            try {
              const histRow = db.prepare(
                "SELECT close_price FROM stock_price_history WHERE stock_id = (SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1) ORDER BY price_date DESC LIMIT 1"
              ).get(String(asset.stock_ticker)) as { close_price?: number | string } | undefined;
              if (histRow && Number(histRow.close_price) > 0) {
                livePrice = Number(histRow.close_price);
                priceSource = 'stock_price_history';
              }
            } catch { /* table may not exist — safe skip */ }
          }

          // ── P31 TASK 1: Fallback 3.5 — price_history.db (yahoo_clean → egksco → any) ──
          // THE MISSING LINK: stocks.db is frequently empty/stale (TradingView feed gaps).
          // WAVE-1: stocks.db.stock_daily_prices is the LIVE source (price_history.db was stale Sept 2026).
          // Without this step, livePrice stays 0 and P&L shows 0% (or -100% if avg_buy used).
          if (livePrice <= 0) {
            try {
              const cleanClose = await getLastCleanClose(String(asset.stock_ticker));
              if (cleanClose.price > 0) {
                livePrice = cleanClose.price;
                priceSource = `price_history.db (${cleanClose.source})`;
              }
            } catch (e) {
              console.error('[calculate-values] price_history.db lookup error:', e);
            }
          }

          // Fallback 4: purchase price (so P&L shows 0% instead of -100%)
          if (livePrice <= 0 && avgBuy > 0) {
            livePrice = avgBuy;
            priceSource = 'avg_buy_price (fallback)';
            console.error(`[calculate-values] ⚠️ No live price for ${asset.stock_ticker} — using purchase price ${avgBuy} as fallback`);
          }

          if (livePrice <= 0) {
            console.error(`[calculate-values] ⚠️ No price available for stock ${asset.stock_ticker} — P&L will be 0`);
          }

          if (livePrice > 0 && qty > 0) {
            current = livePrice * qty;
            asset.current_stock_price = livePrice;
            asset.price_source = priceSource;
          } else if (current <= 0 && invested > 0) {
            current = invested;
          }
        } catch (e) {
          console.error('[calculate-values] Stock price lookup error:', e);
        }
      } else if (type === 'crypto') {
        // ── P34 TASK 2: FX CONVERSION FIX ──
        // Crypto is priced in USD. The old code added USD value as if it were EGP,
        // inflating the portfolio with unconverted dollars. Now we multiply the
        // live USD price by the live USD/EGP exchange rate before adding to totals.
        // Formula: crypto_value_egp = quantity × live_price_usd × exchange_rate_usd_egp
        const symbol = String(asset.stock_ticker || asset.name || '').toUpperCase().trim();
        const qty = Number(asset.quantity || 0);
        const avgBuyUsd = Number(asset.avg_buy_price || 0); // USD per coin at purchase
        const usdRate = exchangeRates['USD'] || 48.5;
        if (invested <= 0 && qty > 0 && avgBuyUsd > 0) {
          invested = qty * avgBuyUsd * usdRate; // USD → EGP
          asset.total_invested = invested;
        }
        try {
          const livePriceUsd = await getCryptoLivePrice(symbol);
          if (livePriceUsd > 0) {
            asset.current_stock_price = livePriceUsd; // raw USD (for display)
            asset.current_stock_price_egp = Math.round(livePriceUsd * usdRate * 100) / 100;
            if (qty > 0) {
              current = livePriceUsd * qty * usdRate; // EGP
            }
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

        if (invested <= 0 && weightGrams > 0 && purchasePricePerGram > 0) {
          invested = weightGrams * purchasePricePerGram;
          asset.total_invested = invested;
        }

        const pricePerGram = karat === 24 ? goldPrices['24k'] :
                             karat === 21 ? goldPrices['21k'] :
                             karat === 18 ? goldPrices['18k'] : goldPrices['24k'];

        asset.current_price_per_gram = pricePerGram;
        if (weightGrams > 0 && pricePerGram > 0) {
          current = pricePerGram * weightGrams;
        } else if (current <= 0 && invested > 0) {
          current = invested;
        }
      } else if (['bank', 'certificate', 'fund', 'deposit'].includes(type)) {
        const rate = Number(asset.interest_rate || asset.certificate_return_rate || asset.annual_return_rate || asset.return_rate || 0);
        const returnType = (asset.return_type || 'annual') as 'daily' | 'monthly' | 'annual';

        if (rate > 0 && invested > 0) {
          let yearlyInterest: number;
          let monthlyInterest: number;
          let dailyInterest: number;

          if (returnType === 'daily') {
            // The rate is already a DAILY percent
            dailyInterest = invested * (rate / 100);
            monthlyInterest = dailyInterest * 30;
            yearlyInterest = dailyInterest * 365;
          } else if (returnType === 'monthly') {
            // The rate is already a MONTHLY percent
            monthlyInterest = invested * (rate / 100);
            yearlyInterest = monthlyInterest * 12;
            dailyInterest = yearlyInterest / 365;
          } else {
            // annual (existing behavior — default)
            yearlyInterest = invested * (rate / 100);
            monthlyInterest = yearlyInterest / 12;
            dailyInterest = yearlyInterest / 365;
          }

          // Prefer explicit purchase_date; fall back to added_at
          const dateStr = asset.purchase_date || asset.added_at;
          let startDate = dateStr ? new Date(String(dateStr)).getTime() : now.getTime();
          if (isNaN(startDate)) startDate = now.getTime();
          const daysHeld = Math.max(0, Math.floor((now.getTime() - startDate) / (1000 * 60 * 60 * 24)));
          const accruedInterest = dailyInterest * daysHeld;

          asset.yearly_interest = Math.round(yearlyInterest * 100) / 100;
          asset.monthly_interest = Math.round(monthlyInterest * 100) / 100;
          asset.daily_interest = Math.round(dailyInterest * 100) / 100;
          asset.accrued_interest = Math.round(accruedInterest * 100) / 100;
          asset.days_elapsed = daysHeld;

          // Current value is principal + accrued interest
          // = purchase_price + (daily_return * days_held)
          if (current <= 0 || Math.abs(current - invested) < 0.01) {
            current = invested + accruedInterest;
          }
        } else if (current <= 0 && invested > 0) {
          current = invested;
        }
      } else if (type === 'currency' || type === 'forex') {
        const code = String(asset.currency_code || asset.stock_ticker || asset.name || 'USD').toUpperCase();
        const amount = Number(asset.quantity || asset.amount || 0);
        const purchaseRate = Number(asset.avg_buy_price || asset.purchase_rate || 0);

        if (invested <= 0 && amount > 0 && purchaseRate > 0) {
          invested = amount * purchaseRate;
          asset.total_invested = invested;
        }

        const currentRate = exchangeRates[code] || exchangeRates['USD'] || 48.5;
        asset.current_rate = currentRate;

        if (amount > 0 && currentRate > 0) {
          current = amount * currentRate;
        } else if (current <= 0 && invested > 0) {
          current = invested;
        }
      } else if (type === 'real_estate') {
        const estimatedValue = Number(asset.estimated_value || asset.current_value || 0);
        if (estimatedValue > 0) {
          current = estimatedValue;
        } else if (current <= 0 && invested > 0) {
          current = invested;
        }
      } else {
        if (current <= 0 && invested > 0) {
          current = invested;
        }
      }

      // Update the asset object with calculated current value
      asset.current_value = Math.round(current * 100) / 100;
      asset._invested = invested; // P31-SMART-MATH: expose recomputed principal for yield calc
      const profitLoss = current - invested;
      asset.profit_loss = Math.round(profitLoss * 100) / 100;
      asset.profit_loss_percent = invested > 0
        ? Math.round((profitLoss / invested) * 10000) / 100
        : 0;

      totalInvested += invested;
      totalCurrentValue += current;

      if (!byType[type as string]) {
        byType[type as string] = { count: 0, invested: 0, current: 0, profit_loss: 0 };
      }
      byType[type as string].count++;
      byType[type as string].invested += invested;
      byType[type as string].current += current;
      byType[type as string].profit_loss += profitLoss;
    }

    // ── P34 TASK 3: DEBT DEDUCTION (Net Worth = Assets − Liabilities) ──
    // Read active obligations (loans, installments) from `financial_obligations`
    // and subtract the total remaining amount from the portfolio value.
    // Formula: net_worth_egp = total_current_value − total_remaining_obligations
    const totalObligationsEgp = await getTotalObligations(db, userId);
    const netWorthEgp = totalCurrentValue - totalObligationsEgp;

    const totalProfitLoss = totalCurrentValue - totalInvested;
    const profitLossPercent = totalInvested > 0
      ? (totalProfitLoss / totalInvested) * 100
      : 0;

    for (const type of Object.keys(byType)) {
      byType[type].invested = Math.round(byType[type].invested * 100) / 100;
      byType[type].current = Math.round(byType[type].current * 100) / 100;
      byType[type].profit_loss = Math.round(byType[type].profit_loss * 100) / 100;
    }

    // ── P31-PORTFOLIO-SMART-MATH (Task 1): Wealth vs Yield separation ──
    // معادلات ربة المنزل:
    //   - أصول تحفظ الثروة (gold/real_estate/car/stock/crypto): Yield = 0، القيمة من السوق بس
    //   - أصول تولد العائد (bank/certificate/fund): بتجيب عائد سنوي
    //   - Monthly Yield = (principal of yield assets * annual_rate / 12)
    //   - Net monthly change = monthly_yield - monthly_expenses
    let wealthAssetsValue = 0;
    let yieldAssetsValue = 0;
    let annualYieldEgp = 0;
    for (const a of assets) {
      const t = String(a.type || 'other').toLowerCase();
      const cv = Number(a.current_value || 0);
      const inv = Number(a._invested || a.total_invested || 0);
      if (YIELD_ASSET_TYPES.has(t)) {
        yieldAssetsValue += cv;
        let rate = Number(a.interest_rate || a.certificate_return_rate || a.annual_return_rate || a.return_rate || a.annual_yield || 0);
        if (rate <= 0) rate = DEFAULT_BANK_YIELD_PCT; // default 20% for bank/cert without explicit rate
        annualYieldEgp += inv * (rate / 100);
      } else {
        wealthAssetsValue += cv;
      }
    }
    const monthlyYieldEgp = annualYieldEgp / 12;
    const monthlyExpensesEgp = await getMonthlyExpenses(db, userId);
    const netMonthlyChangeEgp = monthlyYieldEgp - monthlyExpensesEgp;

    // ── P33 TASK 4: Smart Rebalancing Alerts ──
    // 1) Gold drop alert: if a gold asset's current price dropped >= 5% from purchase
    //    → suggest buying gold bars (not jewelry) to rebalance.
    // 2) Stocks concentration alert: if stocks > 70% of total portfolio value
    //    → suggest moving part to bank to reduce risk.
    const rebalanceAlerts: Array<{
      type: 'gold_drop' | 'stock_concentration' | 'crypto_concentration';
      severity: 'info' | 'warning' | 'danger';
      title_ar: string;
      message_ar: string;
      suggested_action_ar: string;
      amount_egp?: number;
      pct?: number;
    }> = [];

    for (const a of assets) {
      const t = String(a.type || 'other').toLowerCase();
      if (t === 'gold' || t === 'silver') {
        const inv = Number(a._invested || a.total_invested || 0);
        const cv = Number(a.current_value || 0);
        const plPct = Number(a.profit_loss_percent || 0);
        if (inv > 0 && plPct <= -5) {
          // Price dropped 5%+ from purchase → buy-the-dip opportunity
          const dipAmount = Math.min(10000, Math.max(1000, Math.round(inv * 0.1 / 100) * 100));
          rebalanceAlerts.push({
            type: 'gold_drop',
            severity: 'info',
            title_ar: '📉 فرصة إعادة توازن المحفظة: سعر الذهب نزل',
            message_ar: `الذهب اللي اشتريته نزل ${Math.abs(plPct).toFixed(1)}% من سعر الشراء. ده فرصة لإعادة توازن المحفظة.`,
            suggested_action_ar: `ننصحك تشتري سبائك ذهب (مش مصوغات عشان مفيش تصنيع) بـ ${dipAmount.toLocaleString('ar-EG')} جنيه لتحقيق التوازن.`,
            amount_egp: dipAmount,
            pct: Math.abs(Math.round(plPct * 100) / 100),
          });
        }
      }
    }

    // Stocks concentration check
    const stocksValue = byType.stock?.current || 0;
    const cryptoValue = byType.crypto?.current || 0;
    const stocksPct = totalCurrentValue > 0 ? (stocksValue / totalCurrentValue) * 100 : 0;
    const cryptoPct = totalCurrentValue > 0 ? (cryptoValue / totalCurrentValue) * 100 : 0;

    if (stocksPct > 70) {
      const moveAmount = Math.round((stocksValue * (stocksPct - 60) / 100) / 100) * 100;
      rebalanceAlerts.push({
        type: 'stock_concentration',
        severity: 'warning',
        title_ar: '⚠️ مخاطرة عالية: تركيز الأسهم',
        message_ar: `${stocksPct.toFixed(1)}% من محفظتك في الأسهم. ده مستوى مخاطرة عالي.`,
        suggested_action_ar: `ننصحك تحوّل ${moveAmount.toLocaleString('ar-EG')} جنيه من الأسهم للبنك (شهادة إيداع) لتقليل المخاطرة وتحقيق توازن.`,
        amount_egp: moveAmount,
        pct: Math.round(stocksPct * 100) / 100,
      });
    }

    if (cryptoPct > 30) {
      const moveAmount = Math.round((cryptoValue * (cryptoPct - 20) / 100) / 100) * 100;
      rebalanceAlerts.push({
        type: 'crypto_concentration',
        severity: 'danger',
        title_ar: '🚨 مخاطرة شديدة: تركيز الكريبتو',
        message_ar: `${cryptoPct.toFixed(1)}% من محفظتك في العملات الرقمية. الكريبتو متقلب جداً.`,
        suggested_action_ar: `ننصحك تحوّل ${moveAmount.toLocaleString('ar-EG')} جنيه من الكريبتو لذهب أو بنك لتقليل المخاطرة.`,
        amount_egp: moveAmount,
        pct: Math.round(cryptoPct * 100) / 100,
      });
    }

    const smartMath = {
      wealth_assets_value: Math.round(wealthAssetsValue * 100) / 100,
      yield_assets_value: Math.round(yieldAssetsValue * 100) / 100,
      annual_yield_egp: Math.round(annualYieldEgp * 100) / 100,
      monthly_yield_egp: Math.round(monthlyYieldEgp * 100) / 100,
      monthly_expenses_egp: Math.round(monthlyExpensesEgp * 100) / 100,
      net_monthly_change_egp: Math.round(netMonthlyChangeEgp * 100) / 100,
      // P34: net_worth_egp now deducts active debts (loans/installments)
      net_worth_egp: Math.round(netWorthEgp * 100) / 100,
      total_obligations_egp: Math.round(totalObligationsEgp * 100) / 100,
      gross_assets_egp: Math.round(totalCurrentValue * 100) / 100,
      stocks_pct: Math.round(stocksPct * 100) / 100,
      crypto_pct: Math.round(cryptoPct * 100) / 100,
      rebalance_alerts: rebalanceAlerts,
    };

    return NextResponse.json({
      success: true,
      items: assets,
      gold_prices: goldPrices,
      exchange_rates: exchangeRates,
      total_invested: Math.round(totalInvested * 100) / 100,
      total_current_value: Math.round(totalCurrentValue * 100) / 100,
      total_profit_loss: Math.round(totalProfitLoss * 100) / 100,
      profit_loss_percent: Math.round(profitLossPercent * 100) / 100,
      assets_count: assets.length,
      by_type: byType,
      // P34: expose net worth + obligations at the top level for the UI
      total_obligations_egp: Math.round(totalObligationsEgp * 100) / 100,
      net_worth_egp: Math.round(netWorthEgp * 100) / 100,
      smart_math: smartMath,
    });
  } catch (error) {
    console.error('[/api/finance/calculate-values] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'فشل في حساب قيم المحفظة',
      items: [],
      gold_prices: null,
      total_invested: 0,
      total_current_value: 0,
      total_profit_loss: 0,
      profit_loss_percent: 0,
      assets_count: 0,
      by_type: {},
    }, { status: 500 });
  }
}

// v3.65.1: getGoldPrices now reads from data_engine.db.gold_prices (canonical, live).
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

// ── P31-PORTFOLIO-SMART-MATH: Monthly expenses reader ──────────────────
// Reads the user's monthly expenses from `user_financial_settings` (created
// idempotently). Default 0 — the frontend can later add an input to set this.
// This powers the "net monthly change = monthly_yield - monthly_expenses" math.
async function getMonthlyExpenses(db: Database.Database, userId: string): Promise<number> {
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS user_financial_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE,
        monthly_expenses REAL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    const row = db.prepare(
      "SELECT monthly_expenses FROM user_financial_settings WHERE user_id = ? LIMIT 1"
    ).get(userId) as SqlRow | undefined;
    return Number(row?.monthly_expenses || 0);
  } catch {
    return 0;
  }
}

// ── P34 TASK 3: ACTIVE OBLIGATIONS READER (Debt Deduction) ──────────────
// Reads the sum of `remaining_amount` for all active obligations (loans,
// installments, credit) from `financial_obligations`. These are subtracted
// from gross assets to compute the true net worth.
// Formula: net_worth = gross_assets − total_remaining_obligations
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

// ── LIVE CRYPTO PRICE (Task 1+2: Live Portfolio Overhaul) ──────────────
// Fetches the live USD price for a single crypto symbol from Binance.
// Uses a 60-second in-memory cache to avoid hitting the API on every request.
// Returns 0 on failure (caller falls back to invested value).
let _cryptoPriceCache: { ts: number; prices: Record<string, number> } = { ts: 0, prices: {} };
const CRYPTO_CACHE_TTL_MS = 60_000;

async function getCryptoLivePrice(symbol: string): Promise<number> {
  if (!symbol) return 0;
  const now = Date.now();
  // Refresh cache if stale
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
          // Only USDT pairs: "BTCUSDT" → "BTC"
          if (t.symbol.endsWith('USDT') && t.lastPrice) {
            const sym = t.symbol.slice(0, -4);
            const price = Number(t.lastPrice);
            if (price > 0) prices[sym] = price;
          }
        }
        _cryptoPriceCache = { ts: now, prices };
      }
    } catch {
      // Keep stale cache if available, else empty
    }
  }
  // Look up the symbol (try with and without common suffixes)
  return _cryptoPriceCache.prices[symbol]
    || _cryptoPriceCache.prices[symbol + 'USDT']
    || 0;
}


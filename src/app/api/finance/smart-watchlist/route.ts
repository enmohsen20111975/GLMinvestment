/**
 * GET /api/finance/smart-watchlist
 * ================================
 * FIX: was proxying to /api/flow/top (Python) which returns a different
 * schema. The frontend ProfessionalWatchlistView.tsx expects:
 *   { summary: { alerts_by_severity: { danger, warning, info, success } },
 *     items: [{ ticker, current_price, current_value, profit_loss, alerts[], action{...} }] }
 *
 * Now reads portfolio_assets from stocks.db, enriches with live prices,
 * generates alerts, and returns the expected schema.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { getLiveEgyptGoldPrices } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({
        success: true,
        summary: {
          total_items: 0,
          total_invested: 0,
          total_value: 0,
          total_profit_loss: 0,
          alerts_count: 0,
          alerts_by_severity: { danger: 0, warning: 0, info: 0, success: 0 },
        },
        items: [],
      });
    }

    const db = await getFinanceDb();

    // Check if portfolio_assets table exists
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_assets'").get() as any;
      if (!tableCheck) {
        return NextResponse.json({
          success: true,
          summary: {
            total_items: 0,
            total_invested: 0,
            total_value: 0,
            total_profit_loss: 0,
            alerts_count: 0,
            alerts_by_severity: { danger: 0, warning: 0, info: 0, success: 0 },
          },
          items: [],
          message: 'Portfolio table not initialized',
        });
      }
    } catch {
      return NextResponse.json({
        success: true,
        summary: {
          total_items: 0,
          total_invested: 0,
          total_value: 0,
          total_profit_loss: 0,
          alerts_count: 0,
          alerts_by_severity: { danger: 0, warning: 0, info: 0, success: 0 },
        },
        items: [],
      });
    }

    // Fetch all portfolio assets
    const assets = db.prepare(
      "SELECT * FROM portfolio_assets WHERE user_id = ? ORDER BY total_invested DESC"
    ).all(userId) as any[];

    if (assets.length === 0) {
      return NextResponse.json({
        success: true,
        summary: {
          total_items: 0,
          total_invested: 0,
          total_value: 0,
          total_profit_loss: 0,
          alerts_count: 0,
          alerts_by_severity: { danger: 0, warning: 0, info: 0, success: 0 },
        },
        items: [],
      });
    }

    // Fetch gold prices for gold assets (v3.65.1: canonical source = data_engine.db)
    // OLD: SELECT * FROM stocks.db.gold_prices — was reading 3 stale rows from 2026-06-03.
    // NEW: getLiveEgyptGoldPrices() reads data_engine.db.gold_prices (live, 77K+ rows, 5-min cycle).
    let goldPrices: { '24k': number; '21k': number; '18k': number } | null = null;
    try {
      goldPrices = getLiveEgyptGoldPrices();
    } catch (err) {
      console.warn('[smart-watchlist] getLiveEgyptGoldPrices failed:', err);
    }

    // Build enriched items with alerts
    const items: any[] = [];
    let totalInvested = 0;
    let totalValue = 0;
    let alertsCount = 0;
    const alertsBySeverity = { danger: 0, warning: 0, info: 0, success: 0 };

    for (const asset of assets) {
      const invested = Number(asset.total_invested || 0);
      let currentPrice = 0;
      let currentValue = Number(asset.current_value || 0);
      const ticker = asset.stock_ticker || asset.name || '';
      const name = asset.name || asset.stock_ticker || asset.fund_name || 'أصل';

      // Get current price based on type
      if (asset.type === 'stock' && asset.stock_ticker) {
        try {
          const stockRow = db.prepare(
            "SELECT current_price, change_percent, previous_close FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1"
          ).get(asset.stock_ticker) as any;
          if (stockRow && stockRow.current_price > 0) {
            currentPrice = Number(stockRow.current_price);
            const qty = Number(asset.quantity || 0);
            currentValue = currentPrice * qty;
          }
        } catch {}
      } else if (asset.type === 'gold' && asset.weight_grams && goldPrices) {
        const karat = asset.karat || 24;
        const pricePerGram = karat === 24 ? goldPrices['24k'] :
                             karat === 21 ? goldPrices['21k'] :
                             karat === 18 ? goldPrices['18k'] : goldPrices['24k'];
        currentPrice = pricePerGram;
        currentValue = pricePerGram * Number(asset.weight_grams);
      }

      const profitLoss = currentValue - invested;
      const profitLossPct = invested > 0 ? (profitLoss / invested) * 100 : 0;

      totalInvested += invested;
      totalValue += currentValue;

      // Generate alerts for this asset
      const alerts: any[] = [];

      if (profitLossPct < -15) {
        alerts.push({
          id: `alert_${asset.id}_loss`,
          type: 'loss',
          severity: 'danger',
          title: 'خسارة كبيرة',
          message: `${name} خسر ${Math.abs(profitLossPct).toFixed(1)}% — فكّر في إعادة التقييم`,
        });
        alertsBySeverity.danger++;
        alertsCount++;
      } else if (profitLossPct < -5) {
        alerts.push({
          id: `alert_${asset.id}_warn`,
          type: 'loss',
          severity: 'warning',
          title: 'خسارة',
          message: `${name} خسر ${Math.abs(profitLossPct).toFixed(1)}%`,
        });
        alertsBySeverity.warning++;
        alertsCount++;
      } else if (profitLossPct > 20) {
        alerts.push({
          id: `alert_${asset.id}_gain`,
          type: 'gain',
          severity: 'success',
          title: 'ربح جيد',
          message: `${name} ربح ${profitLossPct.toFixed(1)}% — فكّر في جني الأرباح`,
        });
        alertsBySeverity.success++;
        alertsCount++;
      } else if (profitLossPct > 5) {
        alerts.push({
          id: `alert_${asset.id}_info`,
          type: 'gain',
          severity: 'info',
          title: 'أداء إيجابي',
          message: `${name} ربح ${profitLossPct.toFixed(1)}%`,
        });
        alertsBySeverity.info++;
        alertsCount++;
      }

      // Determine action recommendation
      let action: any = {
        type: 'HOLD',
        confidence: 50,
        reason: 'أداء مستقر',
      };

      if (profitLossPct < -15) {
        action = {
          type: 'SELL',
          confidence: 70,
          reason: 'خسارة كبيرة — فكّر في الخروج',
          stop_loss: invested * 0.85,
        };
      } else if (profitLossPct > 25) {
        action = {
          type: 'SELL',
          confidence: 65,
          reason: 'ربح جيد — جني أرباح',
          target_price: currentValue,
        };
      } else if (profitLossPct > -5 && profitLossPct < 10) {
        action = {
          type: 'HOLD',
          confidence: 60,
          reason: 'أداء مستقر — استمر',
        };
      }

      items.push({
        id: asset.id,
        type: asset.type || 'other',
        ticker,
        name,
        quantity: Number(asset.quantity || asset.weight_grams || 0),
        avg_buy_price: Number(asset.avg_buy_price || asset.purchase_price_per_gram || 0),
        total_invested: invested,
        current_price: currentPrice,
        current_value: Math.round(currentValue * 100) / 100,
        profit_loss: Math.round(profitLoss * 100) / 100,
        profit_loss_percent: Math.round(profitLossPct * 100) / 100,
        tradingview: {
          performance: { week: null, month: null, year: null },
          valuation: { pe: null, pb: null },
          dividend_yield: null,
        },
        alerts,
        action,
      });
    }

    return NextResponse.json({
      success: true,
      summary: {
        total_items: items.length,
        total_invested: Math.round(totalInvested * 100) / 100,
        total_value: Math.round(totalValue * 100) / 100,
        total_profit_loss: Math.round((totalValue - totalInvested) * 100) / 100,
        alerts_count: alertsCount,
        alerts_by_severity: alertsBySeverity,
      },
      items,
    });
  } catch (error) {
    console.error('[/api/finance/smart-watchlist] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'فشل في جلب قائمة المراقبة الذكية',
      summary: {
        total_items: 0,
        total_invested: 0,
        total_value: 0,
        total_profit_loss: 0,
        alerts_count: 0,
        alerts_by_severity: { danger: 0, warning: 0, info: 0, success: 0 },
      },
      items: [],
    }, { status: 500 });
  }
}

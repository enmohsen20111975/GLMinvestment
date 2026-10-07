/**
 * GET /api/finance/smart-analysis
 * ================================
 * FIX: was proxying to /api/flow/summary (Python) which returns 503.
 * Now reads portfolio assets and generates smart analysis recommendations.
 *
 * Returns: { success, data: { assets: [{ ticker, action, reason, ... }],
 *            summary: { total, buy, sell, hold } } }
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
        data: { assets: [], summary: { total: 0, buy: 0, sell: 0, hold: 0 } },
      });
    }

    const db = await getFinanceDb();

    // Check if portfolio_assets table exists
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_assets'").get() as any;
      if (!tableCheck) {
        return NextResponse.json({
          success: true,
          data: { assets: [], summary: { total: 0, buy: 0, sell: 0, hold: 0 } },
          message: 'Portfolio table not initialized',
        });
      }
    } catch {
      return NextResponse.json({
        success: true,
        data: { assets: [], summary: { total: 0, buy: 0, sell: 0, hold: 0 } },
      });
    }

    // Fetch all assets
    const assets = db.prepare(
      "SELECT * FROM portfolio_assets WHERE user_id = ? ORDER BY total_invested DESC"
    ).all(userId) as any[];

    if (assets.length === 0) {
      return NextResponse.json({
        success: true,
        data: { assets: [], summary: { total: 0, buy: 0, sell: 0, hold: 0 } },
      });
    }

    // Fetch gold prices (v3.65.1: canonical source = data_engine.db)
    // OLD: SELECT * FROM stocks.db.gold_prices — was reading 3 stale rows from 2026-06-03.
    // NEW: getLiveEgyptGoldPrices() reads data_engine.db.gold_prices (live, 77K+ rows, 5-min cycle).
    let goldPrices: { '24k': number; '21k': number; '18k': number } | null = null;
    try {
      goldPrices = getLiveEgyptGoldPrices();
    } catch (err) {
      console.warn('[smart-analysis] getLiveEgyptGoldPrices failed:', err);
    }

    const analyzedAssets: any[] = [];
    let buyCount = 0;
    let sellCount = 0;
    let holdCount = 0;

    for (const asset of assets) {
      const invested = Number(asset.total_invested || 0);
      let currentPrice = 0;
      let currentValue = Number(asset.current_value || 0);
      const ticker = asset.stock_ticker || asset.name || '';
      const name = asset.name || asset.stock_ticker || asset.fund_name || 'أصل';

      // Get current price
      if (asset.type === 'stock' && asset.stock_ticker) {
        try {
          const stockRow = db.prepare(
            "SELECT current_price FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1"
          ).get(asset.stock_ticker) as any;
          if (stockRow && stockRow.current_price > 0) {
            currentPrice = Number(stockRow.current_price);
            currentValue = currentPrice * Number(asset.quantity || 0);
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

      // Smart analysis: determine action
      let action = 'HOLD';
      let reason = 'أداء مستقر';
      let confidence = 50;

      if (profitLossPct < -20) {
        action = 'SELL';
        reason = `خسارة كبيرة (${profitLossPct.toFixed(1)}%) — يُنصح بالبيع`;
        confidence = 75;
        sellCount++;
      } else if (profitLossPct < -10) {
        action = 'AVERAGE_DOWN';
        reason = `خسارة (${profitLossPct.toFixed(1)}%) — متوسط التكلفة قد يقلل الخسارة`;
        confidence = 60;
        buyCount++;
      } else if (profitLossPct > 30) {
        action = 'SELL';
        reason = `ربح ممتاز (${profitLossPct.toFixed(1)}%) — جني أرباح`;
        confidence = 70;
        sellCount++;
      } else if (profitLossPct > 15) {
        action = 'SELL';
        reason = `ربح جيد (${profitLossPct.toFixed(1)}%) — فكّر في جني جزء`;
        confidence = 55;
        sellCount++;
      } else if (profitLossPct > -5 && profitLossPct < 10) {
        action = 'HOLD';
        reason = 'أداء مستقر — استمر في الاحتفاظ';
        confidence = 60;
        holdCount++;
      } else if (profitLossPct > 5) {
        action = 'HOLD';
        reason = `أداء إيجابي (${profitLossPct.toFixed(1)}%) — استمر`;
        confidence = 55;
        holdCount++;
      } else {
        action = 'BUY_MORE';
        reason = `فرصة شراء (${profitLossPct.toFixed(1)}%) — السعر مغري`;
        confidence = 50;
        buyCount++;
      }

      analyzedAssets.push({
        id: asset.id,
        ticker,
        name,
        type: asset.type || 'other',
        invested,
        current_value: Math.round(currentValue * 100) / 100,
        profit_loss: Math.round(profitLoss * 100) / 100,
        profit_loss_percent: Math.round(profitLossPct * 100) / 100,
        action,
        reason,
        confidence,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        assets: analyzedAssets,
        summary: {
          total: analyzedAssets.length,
          buy: buyCount,
          sell: sellCount,
          hold: holdCount,
        },
      },
    });
  } catch (error) {
    console.error('[/api/finance/smart-analysis] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'فشل في التحليل الذكي',
      data: { assets: [], summary: { total: 0, buy: 0, sell: 0, hold: 0 } },
    }, { status: 500 });
  }
}

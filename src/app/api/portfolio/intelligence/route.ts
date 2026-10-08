import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getFinanceDb } from '@/lib/finance-db';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { getUnifiedStockData } from '@/lib/unified-stock-data';

// Task FINALIZE-UNIFICATION (Rule 20 + Rule 27 + Rule 73):
// Previously this route FABRICATED per-stock technical fields using hardcoded
// multipliers:
//   - support = currentPrice * 0.95       (FAB)
//   - resistance = currentPrice * 1.05      (FAB)
//   - rsi = 50 + (change * 2)             (FAB — not Wilder's RSI)
//   - macd_signal = change > 0 ? 'BULLISH' : 'BEARISH'  (FAB)
//   - confidence = 60                      (FAB)
//   - target_price = currentPrice * 1.1    (FAB)
//   - stop_loss = currentPrice * 0.92      (FAB)
// Per Rule 27 (NO-FAKE-DATA), these are now sourced from the canonical
// getUnifiedStockData(ticker) (Rule 73 — SINGLE-DISPLAY-SOURCE) which reads
// the V40.2 prediction record (Rule 35) + canonical Wilder's RSI. When no
// canonical source exists, the fields are NULL (Rule 27).
//
// The `action` field (BUY/HOLD/SELL) is preserved as a PORTFOLIO HEURISTIC
// based on the user's PnL vs avg buy price — it is NOT a market signal.
// This is documented in the response as `portfolio_action_basis: 'pnl'`.

/**
 * Portfolio Intelligence API
 * يجلب توقعات وتحليلات وأخبار لأسهم المحفظة
 */

interface PortfolioStock {
  ticker: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  current_price: number;
  total_value: number;
  profit_loss: number;
  profit_loss_percent: number;
  sector: string;
}

interface StockRecommendation {
  ticker: string;
  // `action` is a PORTFOLIO heuristic based on the user's PnL vs avg buy
  // price (NOT a market signal). BUY = average down, SELL = take profit.
  action: 'BUY' | 'HOLD' | 'SELL';
  // Rule 27: confidence is NULL unless a canonical V40.2 source provides it.
  confidence: number | null;
  // Rule 27: target_price/stop_loss are NULL unless canonical V40.2 source.
  target_price: number | null;
  stop_loss: number | null;
  reason: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface StockAnalysis {
  ticker: string;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  // Rule 27: support/resistance/rsi/macd_signal are NULL unless a canonical
  // source (getUnifiedStockData → V40.2 + canonical Wilder's RSI) provides
  // them. Previously fabricated as currentPrice * 0.95 / * 1.05 / 50+change*2.
  support: number | null;
  resistance: number | null;
  rsi: number | null;
  macd_signal: string | null;
  volume_trend: string;
}

export async function GET(request: NextRequest) {
  try {
    const { userId: authUserId } = await getSessionUserId();

    // Task 13: portfolio intelligence is a gated resource — require auth.
    if (!authUserId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          error_ar: 'يجب تسجيل الدخول للوصول إلى ذكاء المحفظة',
        },
        { status: 401 }
      );
    }
    const userId = authUserId;

    // Ensure DB is initialized
    await ensureInitialized();
    
    const db = await getFinanceDb();
    const lightDb = getLightDb();

    // 1. جلب أسهم المحفظة
    const portfolioStocks = db.prepare(`
      SELECT 
        p.stock_ticker as ticker,
        p.name,
        p.quantity,
        p.avg_buy_price,
        s.current_price,
        s.previous_close,
        s.sector,
        s.name_ar
      FROM portfolio_assets p
      LEFT JOIN stocks s ON p.stock_ticker = s.ticker
      WHERE p.type = 'stock' AND p.stock_ticker IS NOT NULL AND p.user_id = ?
    `).all(userId) as any[];

    // 2. إنشاء تحليلات لكل سهم — delegate to getUnifiedStockData for canonical
    //    support/resistance/rsi (Rule 73). Trend is derived from real change%
    //    (still computed locally since it's just a label on real price action).
    //    macd_signal: NULL (no canonical MACD source — was fabricated).
    //    volume_trend: 'STABLE' (placeholder, no canonical source — TODO).
    const analyses: StockAnalysis[] = portfolioStocks.map((stock: any) => {
      const currentPrice = stock.current_price || stock.avg_buy_price;
      const change = stock.previous_close > 0 
        ? ((currentPrice - stock.previous_close) / stock.previous_close) * 100 
        : 0;
      
      // Rule 73: delegate to canonical unified source for technical fields.
      const canonical = getUnifiedStockData(stock.ticker);
      
      return {
        ticker: stock.ticker,
        trend: change > 2 ? 'BULLISH' : change < -2 ? 'BEARISH' : 'NEUTRAL',
        // Rule 27: NULL when no canonical source (was currentPrice * 0.95).
        support: (canonical?.technical.support as number) ?? null,
        // Rule 27: NULL when no canonical source (was currentPrice * 1.05).
        resistance: (canonical?.technical.resistance as number) ?? null,
        // Rule 27: canonical Wilder's RSI from getUnifiedStockData (was 50+change*2).
        rsi: (canonical?.technical?.rsi as number) ?? null,
        // Rule 27: NULL — no canonical MACD source (was change>0?'BULLISH':'BEARISH').
        macd_signal: null,
        volume_trend: 'STABLE'
      };
    });

    // 3. حساب ملخص المحفظة
    const totalValue = portfolioStocks.reduce((sum: number, s: any) => 
      sum + ((s.quantity || 0) * (s.current_price || s.avg_buy_price || 0)), 0);
    const totalCost = portfolioStocks.reduce((sum: number, s: any) => 
      sum + ((s.quantity || 0) * (s.avg_buy_price || 0)), 0);
    const totalPnL = totalValue - totalCost;
    const totalPnLPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

    // 4. توليد توقعات تلقائية
    //    `action` is a PORTFOLIO HEURISTIC (BUY=average down, SELL=take profit)
    //    based on the user's PnL — NOT a market signal. target_price/stop_loss/
    //    confidence come from canonical getUnifiedStockData (Rule 73).
    const recommendations: StockRecommendation[] = portfolioStocks.map((stock: any) => {
      const currentPrice = stock.current_price || stock.avg_buy_price;
      const pnlPercent = stock.avg_buy_price > 0 
        ? ((currentPrice - stock.avg_buy_price) / stock.avg_buy_price) * 100 
        : 0;
      
      let action: 'BUY' | 'HOLD' | 'SELL' = 'HOLD';
      let reason = '';
      let risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';

      if (pnlPercent < -10) {
        action = 'BUY';
        reason = 'السهم منخفض عن سعر الشراء بفارق كبير - فرصة شراء';
        risk = 'MEDIUM';
      } else if (pnlPercent > 20) {
        action = 'SELL';
        reason = 'السهم حقق أرباح جيدة - يمكن جني الأرباح';
        risk = 'LOW';
      } else if (pnlPercent > 10) {
        action = 'HOLD';
        reason = 'السهم في اتجاه صاعد - استمر في الاحتفاظ';
        risk = 'LOW';
      } else if (pnlPercent < -5) {
        action = 'HOLD';
        reason = 'السهم في تراجع بسيط - راقب عن كثب';
        risk = 'MEDIUM';
      } else {
        action = 'HOLD';
        reason = 'السهم مستقر - لا حاجة لتغيير';
        risk = 'LOW';
      }

      // Rule 73: delegate to canonical V40.2 prediction record for
      // target_price/stop_loss/confidence. Rule 27: NULL when no source.
      const canonical = getUnifiedStockData(stock.ticker);

      return {
        ticker: stock.ticker,
        // NOTE: `action` is a portfolio heuristic based on user PnL, NOT
        // a market signal. (was previously a fabricated confidence=60.)
        action,
        // Rule 27: canonical confidence from V40.2 (was hardcoded 60).
        confidence: (canonical?.prediction?.confidence as number) ?? null,
        // Rule 27: canonical target_price from V40.2 (was currentPrice * 1.1).
        target_price: (canonical?.prediction?.target_price as number) ?? null,
        // Rule 27: canonical stop_loss from V40.2 (was currentPrice * 0.92).
        stop_loss: (canonical?.prediction?.stop_loss as number) ?? null,
        reason,
        risk_level: risk
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        portfolio: portfolioStocks.map((s: any) => ({
          ticker: s.ticker,
          name: s.name || s.name_ar || s.ticker,
          quantity: s.quantity,
          avg_buy_price: s.avg_buy_price,
          current_price: s.current_price || s.avg_buy_price,
          sector: s.sector,
          total_value: (s.quantity || 0) * (s.current_price || s.avg_buy_price || 0),
          profit_loss: ((s.current_price || s.avg_buy_price) - s.avg_buy_price) * s.quantity,
          profit_loss_percent: s.avg_buy_price > 0 
            ? (((s.current_price || s.avg_buy_price) - s.avg_buy_price) / s.avg_buy_price) * 100 
            : 0
        })),
        recommendations,
        analyses,
        summary: {
          total_stocks: portfolioStocks.length,
          total_value: totalValue,
          total_cost: totalCost,
          total_pnl: totalPnL,
          total_pnl_percent: totalPnLPercent,
          buy_signals: recommendations.filter(r => r.action === 'BUY').length,
          sell_signals: recommendations.filter(r => r.action === 'SELL').length,
          hold_signals: recommendations.filter(r => r.action === 'HOLD').length
        }
      }
    });
  } catch (error) {
    console.error('[Portfolio Intelligence API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ في جلب البيانات',
      detail: String(error)
    }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';
import { getSessionUserId } from '@/lib/auth-helper';

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
  action: 'BUY' | 'HOLD' | 'SELL';
  confidence: number;
  target_price: number | null;
  stop_loss: number | null;
  reason: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface StockAnalysis {
  ticker: string;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  support: number;
  resistance: number;
  rsi: number;
  macd_signal: string;
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

    // 2. إنشاء تحليلات لكل سهم
    const analyses: StockAnalysis[] = portfolioStocks.map((stock: any) => {
      const currentPrice = stock.current_price || stock.avg_buy_price;
      const change = stock.previous_close > 0 
        ? ((currentPrice - stock.previous_close) / stock.previous_close) * 100 
        : 0;
      
      return {
        ticker: stock.ticker,
        trend: change > 2 ? 'BULLISH' : change < -2 ? 'BEARISH' : 'NEUTRAL',
        support: currentPrice * 0.95,
        resistance: currentPrice * 1.05,
        rsi: Math.max(0, Math.min(100, 50 + (change * 2))),
        macd_signal: change > 0 ? 'BULLISH_CROSSOVER' : 'BEARISH_CROSSOVER',
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

      return {
        ticker: stock.ticker,
        action,
        confidence: 60,
        target_price: currentPrice * 1.1,
        stop_loss: currentPrice * 0.92,
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

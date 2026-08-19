import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

interface PortfolioStock {
  ticker: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  total_invested: number;
}

interface StockPrice {
  ticker: string;
  current_price: number;
  previous_close: number;
  change_percent: number;
  support: number;
  resistance: number;
  high_52w: number;
  low_52w: number;
  dividend_yield: number;
  last_update: string;
}

interface SmartAlert {
  id: string;
  type: 'profit_target' | 'stop_loss' | 'support_near' | 'resistance_near' | 'dividend_soon' | 'price_drop' | 'price_surge' | 'breakout' | 'breakdown';
  severity: 'info' | 'warning' | 'danger' | 'success';
  ticker: string;
  name: string;
  message: string;
  details: {
    currentPrice: number;
    targetPrice?: number;
    buyPrice: number;
    profitLossPercent: number;
    distancePercent?: number;
  };
  action?: string;
  created_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const { userId: authUserId } = await getSessionUserId();
    const userId = authUserId || '105051756603508628603';
    
    const db = await getFinanceDb();
    
    // Get portfolio stocks
    const portfolioStocks = db.prepare(`
      SELECT 
        stock_ticker as ticker,
        name,
        quantity,
        avg_buy_price,
        total_invested
      FROM portfolio_assets 
      WHERE user_id = ? AND type = 'stock' AND stock_ticker IS NOT NULL
    `).all(userId) as PortfolioStock[];
    
    if (portfolioStocks.length === 0) {
      return NextResponse.json({
        success: true,
        alerts: [],
        summary: {
          total: 0,
          by_severity: { info: 0, warning: 0, danger: 0, success: 0 }
        }
      });
    }
    
    // Get current prices for all portfolio stocks
    const tickers = portfolioStocks.map(s => s.ticker);
    const placeholders = tickers.map(() => '?').join(',');
    
    const stockPrices = db.prepare(`
      SELECT 
        ticker,
        current_price,
        previous_close,
        change_percent,
        support,
        resistance,
        high_52w,
        low_52w,
        dividend_yield,
        last_update
      FROM stocks 
      WHERE ticker IN (${placeholders})
    `).all(...tickers) as StockPrice[];
    
    const priceMap = new Map(stockPrices.map(s => [s.ticker, s]));
    
    // Generate smart alerts
    const alerts: SmartAlert[] = [];
    
    for (const stock of portfolioStocks) {
      const price = priceMap.get(stock.ticker);
      if (!price) continue;
      
      const currentPrice = price.current_price || 0;
      const buyPrice = stock.avg_buy_price || 0;
      const profitLossPercent = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;
      
      // 1. Profit Target Alert (10%, 20%, 50%)
      if (profitLossPercent >= 50) {
        alerts.push({
          id: `profit-50-${stock.ticker}`,
          type: 'profit_target',
          severity: 'success',
          ticker: stock.ticker,
          name: stock.name,
          message: `🎯 ربح ممتاز! ${stock.ticker} حقق +${profitLossPercent.toFixed(1)}% - فكر في جني الأرباح`,
          details: {
            currentPrice,
            buyPrice,
            profitLossPercent
          },
          action: 'جني الأرباح أو رفع وقف الخسارة',
          created_at: new Date().toISOString()
        });
      } else if (profitLossPercent >= 20) {
        alerts.push({
          id: `profit-20-${stock.ticker}`,
          type: 'profit_target',
          severity: 'success',
          ticker: stock.ticker,
          name: stock.name,
          message: `🎯 ربح جيد! ${stock.ticker} حقق +${profitLossPercent.toFixed(1)}% - فكر في جني جزء من الأرباح`,
          details: {
            currentPrice,
            buyPrice,
            profitLossPercent
          },
          action: 'جني 30-50% من الكمية',
          created_at: new Date().toISOString()
        });
      } else if (profitLossPercent >= 10) {
        alerts.push({
          id: `profit-10-${stock.ticker}`,
          type: 'profit_target',
          severity: 'info',
          ticker: stock.ticker,
          name: stock.name,
          message: `📈 ${stock.ticker} ربح +${profitLossPercent.toFixed(1)}% - قرب من هدف البيع`,
          details: {
            currentPrice,
            buyPrice,
            profitLossPercent
          },
          action: 'راجع السهم وقرر تصريف أو استمرار',
          created_at: new Date().toISOString()
        });
      }
      
      // 2. Stop Loss Alert (10%, 20% loss)
      if (profitLossPercent <= -20) {
        alerts.push({
          id: `stop-loss-20-${stock.ticker}`,
          type: 'stop_loss',
          severity: 'danger',
          ticker: stock.ticker,
          name: stock.name,
          message: `🚨 خسارة كبيرة! ${stock.ticker} خسر ${Math.abs(profitLossPercent).toFixed(1)}% - قرر وقف الخسارة أو المتوسط`,
          details: {
            currentPrice,
            buyPrice,
            profitLossPercent
          },
          action: 'وقف خسارة فوري أو متوسط بقوة',
          created_at: new Date().toISOString()
        });
      } else if (profitLossPercent <= -10) {
        alerts.push({
          id: `stop-loss-10-${stock.ticker}`,
          type: 'stop_loss',
          severity: 'warning',
          ticker: stock.ticker,
          name: stock.name,
          message: `⚠️ ${stock.ticker} خسر ${Math.abs(profitLossPercent).toFixed(1)}% - فكر في التصرف`,
          details: {
            currentPrice,
            buyPrice,
            profitLossPercent
          },
          action: 'راجع التحليل وقرر متوسط أو وقف خسارة',
          created_at: new Date().toISOString()
        });
      }
      
      // 3. Support Near Alert
      if (price.support && currentPrice <= price.support * 1.05) {
        const distancePercent = ((currentPrice - price.support) / price.support) * 100;
        alerts.push({
          id: `support-${stock.ticker}`,
          type: 'support_near',
          severity: 'info',
          ticker: stock.ticker,
          name: stock.name,
          message: `📥 ${stock.ticker} قريب من دعم ${price.support.toFixed(2)} - مسافة ${distancePercent.toFixed(1)}%`,
          details: {
            currentPrice,
            targetPrice: price.support,
            buyPrice,
            profitLossPercent,
            distancePercent
          },
          action: profitLossPercent < 0 ? 'فرصة متوسط سعر' : 'فرصة شراء إضافي',
          created_at: new Date().toISOString()
        });
      }
      
      // 4. Resistance Near Alert
      if (price.resistance && currentPrice >= price.resistance * 0.95) {
        const distancePercent = ((price.resistance - currentPrice) / currentPrice) * 100;
        alerts.push({
          id: `resistance-${stock.ticker}`,
          type: 'resistance_near',
          severity: 'warning',
          ticker: stock.ticker,
          name: stock.name,
          message: `📤 ${stock.ticker} قريب من مقاومة ${price.resistance.toFixed(2)} - مسافة ${distancePercent.toFixed(1)}%`,
          details: {
            currentPrice,
            targetPrice: price.resistance,
            buyPrice,
            profitLossPercent,
            distancePercent
          },
          action: profitLossPercent > 0 ? 'فكر في جني الأرباح' : 'استنى الكسر للتأكيد',
          created_at: new Date().toISOString()
        });
      }
      
      // 5. Dividend Alert
      if (price.dividend_yield && price.dividend_yield > 5) {
        alerts.push({
          id: `dividend-${stock.ticker}`,
          type: 'dividend_soon',
          severity: 'info',
          ticker: stock.ticker,
          name: stock.name,
          message: `💰 ${stock.ticker} يوزع ${price.dividend_yield.toFixed(1)}% أرباح - راقب موعد القفل`,
          details: {
            currentPrice,
            buyPrice,
            profitLossPercent
          },
          action: 'تأكد من موعد توزيع الأرباح',
          created_at: new Date().toISOString()
        });
      }
      
      // 6. Breakout Alert (above resistance)
      if (price.resistance && currentPrice > price.resistance) {
        const breakoutPercent = ((currentPrice - price.resistance) / price.resistance) * 100;
        alerts.push({
          id: `breakout-${stock.ticker}`,
          type: 'breakout',
          severity: 'success',
          ticker: stock.ticker,
          name: stock.name,
          message: `🚀 ${stock.ticker} كسر المقاومة ${price.resistance.toFixed(2)} بصعود ${breakoutPercent.toFixed(1)}%`,
          details: {
            currentPrice,
            targetPrice: price.resistance,
            buyPrice,
            profitLossPercent,
            distancePercent: breakoutPercent
          },
          action: 'ممكن يكمل صعود - راقب الحركة',
          created_at: new Date().toISOString()
        });
      }
      
      // 7. Breakdown Alert (below support)
      if (price.support && currentPrice < price.support * 0.98) {
        const breakdownPercent = ((price.support - currentPrice) / price.support) * 100;
        alerts.push({
          id: `breakdown-${stock.ticker}`,
          type: 'breakdown',
          severity: 'danger',
          ticker: stock.ticker,
          name: stock.name,
          message: `📉 ${stock.ticker} كسر الدعم ${price.support.toFixed(2)} بهبوط ${breakdownPercent.toFixed(1)}%`,
          details: {
            currentPrice,
            targetPrice: price.support,
            buyPrice,
            profitLossPercent,
            distancePercent: -breakdownPercent
          },
          action: 'خطر - ممكن يكمل هبوط',
          created_at: new Date().toISOString()
        });
      }
      
      // 8. Price Surge Alert (5%+ in a day)
      if (price.change_percent && price.change_percent >= 5) {
        alerts.push({
          id: `surge-${stock.ticker}`,
          type: 'price_surge',
          severity: 'success',
          ticker: stock.ticker,
          name: stock.name,
          message: `⚡ ${stock.ticker} قفز +${price.change_percent.toFixed(1)}% اليوم`,
          details: {
            currentPrice,
            buyPrice,
            profitLossPercent
          },
          action: profitLossPercent > 0 ? 'فرصة بيع' : 'راجع سبب الصعود',
          created_at: new Date().toISOString()
        });
      }
      
      // 9. Price Drop Alert (5%+ drop in a day)
      if (price.change_percent && price.change_percent <= -5) {
        alerts.push({
          id: `drop-${stock.ticker}`,
          type: 'price_drop',
          severity: 'danger',
          ticker: stock.ticker,
          name: stock.name,
          message: `🔻 ${stock.ticker} هبط ${Math.abs(price.change_percent).toFixed(1)}% اليوم`,
          details: {
            currentPrice,
            buyPrice,
            profitLossPercent
          },
          action: 'راجع الأخبار وسبب الهبوط',
          created_at: new Date().toISOString()
        });
      }
    }
    
    // Sort by severity
    const severityOrder = { danger: 0, warning: 1, success: 2, info: 3 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    
    // Summary
    const summary = {
      total: alerts.length,
      by_severity: {
        danger: alerts.filter(a => a.severity === 'danger').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        success: alerts.filter(a => a.severity === 'success').length,
        info: alerts.filter(a => a.severity === 'info').length
      },
      by_type: {
        profit_target: alerts.filter(a => a.type === 'profit_target').length,
        stop_loss: alerts.filter(a => a.type === 'stop_loss').length,
        support_near: alerts.filter(a => a.type === 'support_near').length,
        resistance_near: alerts.filter(a => a.type === 'resistance_near').length,
        dividend_soon: alerts.filter(a => a.type === 'dividend_soon').length,
        breakout: alerts.filter(a => a.type === 'breakout').length,
        breakdown: alerts.filter(a => a.type === 'breakdown').length,
        price_surge: alerts.filter(a => a.type === 'price_surge').length,
        price_drop: alerts.filter(a => a.type === 'price_drop').length
      }
    };
    
    return NextResponse.json({
      success: true,
      alerts,
      summary,
      last_update: new Date().toISOString()
    });
  } catch (error) {
    console.error('Smart alerts error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في تحميل التنبيهات' },
      { status: 500 }
    );
  }
}

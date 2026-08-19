import { NextRequest, NextResponse } from 'next/server';
import { getVpsStocks, shouldTryVps } from '@/lib/vps-client';

/**
 * Mobile API: Get market-wide recommendations for EGX
 * GET /api/mobile/stocks/EGX/recommendation
 */
export async function GET(request: NextRequest) {
  try {
    // Check if VPS is available
    if (!shouldTryVps()) {
      return NextResponse.json({
        success: true,
        market: 'EGX',
        total_stocks: 0,
        top_buy_signals: [],
        top_sell_signals: [],
        market_summary: {
          gainers: 0,
          losers: 0,
          unchanged: 0,
        },
        message: 'بيانات السوق غير متاحة حالياً - يرجى المحاولة لاحقاً',
        timestamp: new Date().toISOString(),
      });
    }

    // Fetch all stocks from VPS
    const vpsResponse = await getVpsStocks();
    
    if (!vpsResponse || !vpsResponse.success || !vpsResponse.data) {
      return NextResponse.json({
        success: true,
        market: 'EGX',
        total_stocks: 0,
        top_buy_signals: [],
        top_sell_signals: [],
        market_summary: {
          gainers: 0,
          losers: 0,
          unchanged: 0,
        },
        message: 'لم يتم العثور على بيانات',
        timestamp: new Date().toISOString(),
      });
    }

    const stocks = vpsResponse.data;

    // Generate recommendations for all stocks
    const recommendations = stocks.map((stock: { 
      symbol?: string; 
      ticker?: string;
      current_price?: number;
      price?: number;
      change?: number;
      change_percent?: number;
      volume?: number;
    }) => {
      const currentPrice = stock.current_price || stock.price || 0;
      const changePercent = stock.change_percent || stock.change || 0;
      
      let action = 'HOLD';
      let confidence = 50;
      
      if (changePercent < -5) {
        action = 'BUY';
        confidence = 75;
      } else if (changePercent < -2) {
        action = 'BUY';
        confidence = 65;
      } else if (changePercent > 10) {
        action = 'SELL';
        confidence = 70;
      } else if (changePercent > 5) {
        action = 'SELL';
        confidence = 60;
      }

      return {
        ticker: stock.symbol || stock.ticker,
        current_price: currentPrice,
        change_percent: changePercent,
        recommendation: {
          action,
          confidence,
          target_price: Math.round(currentPrice * 1.10 * 100) / 100,
          stop_loss: Math.round(currentPrice * 0.95 * 100) / 100,
        },
        volume: stock.volume,
      };
    });

    // Sort by confidence (highest first) and filter for actionable recommendations
    const buySignals = recommendations
      .filter((r: { recommendation: { action: string } }) => r.recommendation.action === 'BUY')
      .sort((a: { recommendation: { confidence: number } }, b: { recommendation: { confidence: number } }) => b.recommendation.confidence - a.recommendation.confidence)
      .slice(0, 10);

    const sellSignals = recommendations
      .filter((r: { recommendation: { action: string } }) => r.recommendation.action === 'SELL')
      .sort((a: { recommendation: { confidence: number } }, b: { recommendation: { confidence: number } }) => b.recommendation.confidence - a.recommendation.confidence)
      .slice(0, 10);

    return NextResponse.json({
      success: true,
      market: 'EGX',
      total_stocks: stocks.length,
      top_buy_signals: buySignals,
      top_sell_signals: sellSignals,
      market_summary: {
        gainers: recommendations.filter((r: { change_percent: number }) => r.change_percent > 0).length,
        losers: recommendations.filter((r: { change_percent: number }) => r.change_percent < 0).length,
        unchanged: recommendations.filter((r: { change_percent: number }) => r.change_percent === 0).length,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('EGX recommendation error:', error);
    // Return a valid response instead of 500 error
    return NextResponse.json({
      success: true,
      market: 'EGX',
      total_stocks: 0,
      top_buy_signals: [],
      top_sell_signals: [],
      market_summary: {
        gainers: 0,
        losers: 0,
        unchanged: 0,
      },
      error: 'فشل في جلب البيانات',
      timestamp: new Date().toISOString(),
    });
  }
}

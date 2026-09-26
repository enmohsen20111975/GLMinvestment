/**
 * Mobile Crypto Recommendations API
 * تحليلات العملات الرقمية
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const signal = searchParams.get('signal'); // buy | sell | hold

    // Try Python backend
    try {
      const response = await fetch(`${PYTHON_BACKEND_URL}/api/crypto/bulk-analysis?limit=${limit}`, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });

      if (response.ok) {
        const data = await response.json();

        if (data.success && data.data) {
          let recommendations = data.data.map((coin: any) => ({
            id: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            price: coin.price,
            change_24h: coin.change_24h,
            market_cap: coin.market_cap,
            signal: coin.signal,
            signal_ar: coin.signal_ar,
            score: coin.score,
            confidence: coin.confidence,
            reasons: coin.reasons || [],
            warnings: coin.warnings || [],
            entry_price: coin.price,
            stop_loss: coin.price * 0.95,
            take_profit: coin.price * 1.1,
          }));

          // Filter by signal
          if (signal) {
            const signalLower = signal.toLowerCase();
            recommendations = recommendations.filter((r: any) =>
              r.signal?.toLowerCase().includes(signalLower)
            );
          }

          // Sort by score
          recommendations.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

          return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            recommendations: recommendations.slice(0, limit),
            summary: {
              total: recommendations.length,
              buy: recommendations.filter((r: any) => r.signal?.includes('BUY')).length,
              sell: recommendations.filter((r: any) => r.signal?.includes('SELL')).length,
              hold: recommendations.filter((r: any) => r.signal?.includes('HOLD')).length,
            },
            market_regime: data.market_regime,
            source: 'python_backend',
          });
        }
      }
    } catch (e) {
      console.warn('[Mobile Crypto Recommendations] Python backend error:', e);
    }

    // Fallback: CoinGecko with basic analysis
    const coingeckoResponse = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`,
      { signal: AbortSignal.timeout(15000) }
    );

    if (!coingeckoResponse.ok) {
      return NextResponse.json({
        success: false,
        error: 'فشل في جلب بيانات الكريبتو',
      }, { status: 503 });
    }

    const coins = await coingeckoResponse.json();

    const recommendations = coins.map((coin: any) => {
      const change = coin.price_change_percentage_24h || 0;
      const athChange = coin.ath_change_percentage || 0;

      let score = 50;
      let signalText = 'HOLD';
      let signalAr = 'احتفاظ';

      if (athChange < -50) { score += 20; signalText = 'BUY'; signalAr = 'شراء'; }
      else if (athChange < -30) { score += 10; signalText = 'ACCUMULATE'; signalAr = 'تجميع'; }
      else if (athChange > 0) { score -= 10; signalText = 'REDUCE'; signalAr = 'تخفيض'; }

      if (change < -10) { score += 15; signalText = 'BUY'; signalAr = 'شراء'; }
      else if (change > 20) { score -= 15; signalText = 'SELL'; signalAr = 'بيع'; }

      return {
        id: coin.id,
        symbol: coin.symbol?.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        change_24h: change,
        market_cap: coin.market_cap,
        market_cap_rank: coin.market_cap_rank,
        signal: signalText,
        signal_ar: signalAr,
        score: Math.max(0, Math.min(100, score)),
        confidence: 40,
        image: coin.image,
      };
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      recommendations,
      summary: {
        total: recommendations.length,
        buy: recommendations.filter((r: any) => r.signal?.includes('BUY')).length,
        sell: recommendations.filter((r: any) => r.signal?.includes('SELL')).length,
        hold: recommendations.filter((r: any) => r.signal?.includes('HOLD')).length,
      },
      source: 'coingecko_fallback',
    });
  } catch (error: any) {
    console.error('[Mobile Crypto Recommendations API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'خطأ في جلب التحليلات',
    }, { status: 500 });
  }
}

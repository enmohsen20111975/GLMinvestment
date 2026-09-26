/**
 * Mobile Crypto Recommendations API
 * Primary: Python /api/crypto/bulk-analysis.
 * Fallback 1 (existing): CoinGecko /coins/markets.
 * Fallback 2 (FLUTTER-FULL-AUDIT): data_engine.db crypto_prices — sort by
 *   ABS(change_24h) and assign basic signals. Previously returned 503 when
 *   both Python and CoinGecko failed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCryptoListFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '20');
  const signal = searchParams.get('signal'); // buy | sell | hold

  // 1. Try Python backend
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/crypto/bulk-analysis?limit=${limit}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data) {
        let recommendations = data.data.map((coin: Record<string, unknown>) => ({
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
          stop_loss: Number(coin.price) * 0.95,
          take_profit: Number(coin.price) * 1.1,
        }));

        if (signal) {
          const signalLower = signal.toLowerCase();
          recommendations = recommendations.filter((r: Record<string, unknown>) =>
            String(r.signal).toLowerCase().includes(signalLower)
          );
        }

        recommendations.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          Number(b.score || 0) - Number(a.score || 0)
        );

        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          recommendations: recommendations.slice(0, limit),
          summary: {
            total: recommendations.length,
            buy: recommendations.filter((r: Record<string, unknown>) => String(r.signal).includes('BUY')).length,
            sell: recommendations.filter((r: Record<string, unknown>) => String(r.signal).includes('SELL')).length,
            hold: recommendations.filter((r: Record<string, unknown>) => String(r.signal).includes('HOLD')).length,
          },
          market_regime: data.market_regime,
          source: 'python_backend',
        });
      }
    }
  } catch (e) {
    console.warn('[Mobile Crypto Recommendations] Python backend error:', e);
  }

  // 2. CoinGecko fallback
  try {
    const coingeckoResponse = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (coingeckoResponse.ok) {
      const coins = await coingeckoResponse.json();
      const recommendations = coins.map((coin: Record<string, unknown>) => {
        const change = Number(coin.price_change_percentage_24h) || 0;
        const athChange = Number(coin.ath_change_percentage) || 0;

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
          symbol: String(coin.symbol || '').toUpperCase(),
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
          buy: recommendations.filter((r: Record<string, unknown>) => String(r.signal).includes('BUY')).length,
          sell: recommendations.filter((r: Record<string, unknown>) => String(r.signal).includes('SELL')).length,
          hold: recommendations.filter((r: Record<string, unknown>) => String(r.signal).includes('HOLD')).length,
        },
        source: 'coingecko_fallback',
      });
    }
  } catch (e) {
    console.warn('[Mobile Crypto Recommendations] CoinGecko error:', e);
  }

  // 3. SQLite fallback — data_engine.db crypto_prices
  const rows = getCryptoListFallback(limit);
  const recommendations = rows.map((c) => {
    const change = Number(c.price_change_24h || 0);
    let signalText = 'HOLD';
    let signalAr = 'احتفاظ';
    if (change <= -10) { signalText = 'BUY'; signalAr = 'شراء'; }
    else if (change >= 20) { signalText = 'SELL'; signalAr = 'بيع'; }
    else if (change <= -5) { signalText = 'ACCUMULATE'; signalAr = 'تجميع'; }
    return {
      symbol: c.symbol,
      name: c.name,
      price: Number(c.price_usd || 0),
      change_24h: change,
      market_cap: c.market_cap,
      volume_24h: c.total_volume,
      signal: signalText,
      signal_ar: signalAr,
      score: 50,
      confidence: 30,
    };
  });

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    timestamp: new Date().toISOString(),
    recommendations,
    summary: {
      total: recommendations.length,
      buy: recommendations.filter((r) => r.signal.includes('BUY')).length,
      sell: recommendations.filter((r) => r.signal.includes('SELL')).length,
      hold: recommendations.filter((r) => r.signal.includes('HOLD')).length,
    },
    warning: 'Python + CoinGecko unreachable — basic signals from SQLite snapshot',
  });
}

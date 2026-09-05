/**
 * Mobile Crypto Watchlist API
 * قائمة مراقبة العملات الرقمية
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const coins = searchParams.get('coins'); // comma-separated coin IDs
    const limit = parseInt(searchParams.get('limit') || '25');

    // If specific coins requested
    if (coins) {
      const coinIds = coins.split(',').filter(Boolean);

      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinIds.join(',')}&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d`,
        { signal: AbortSignal.timeout(15000) }
      );

      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error: 'فشل في جلب البيانات',
        }, { status: 503 });
      }

      const data = await response.json();

      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        watchlist: data.map((coin: any) => ({
          id: coin.id,
          symbol: coin.symbol?.toUpperCase(),
          name: coin.name,
          price: coin.current_price,
          change_24h: coin.price_change_percentage_24h,
          change_7d: coin.price_change_percentage_7d_in_currency,
          market_cap: coin.market_cap,
          market_cap_rank: coin.market_cap_rank,
          image: coin.image,
          ath: coin.ath,
          ath_change: coin.ath_change_percentage,
        })),
      });
    }

    // Default: Top cryptocurrencies
    try {
      const response = await fetch(`${PYTHON_BACKEND_URL}/api/crypto/bulk-analysis?limit=${limit}`, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });

      if (response.ok) {
        const data = await response.json();

        if (data.success && data.data) {
          return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            watchlist: data.data.map((coin: any) => ({
              id: coin.id,
              symbol: coin.symbol,
              name: coin.name,
              price: coin.price,
              change_24h: coin.change_24h,
              market_cap: coin.market_cap,
              market_cap_rank: coin.market_cap_rank,
              signal: coin.signal,
              signal_ar: coin.signal_ar,
              score: coin.score,
            })),
            source: 'python_backend',
          });
        }
      }
    } catch (e) {
      console.warn('[Mobile Crypto Watchlist] Python backend error:', e);
    }

    // Fallback: CoinGecko top coins
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`,
      { signal: AbortSignal.timeout(15000) }
    );

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: 'فشل في جلب البيانات',
      }, { status: 503 });
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      watchlist: data.map((coin: any) => ({
        id: coin.id,
        symbol: coin.symbol?.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        change_24h: coin.price_change_percentage_24h,
        market_cap: coin.market_cap,
        market_cap_rank: coin.market_cap_rank,
        image: coin.image,
      })),
      source: 'coingecko',
    });
  } catch (error: any) {
    console.error('[Mobile Crypto Watchlist API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'خطأ في جلب القائمة',
    }, { status: 500 });
  }
}

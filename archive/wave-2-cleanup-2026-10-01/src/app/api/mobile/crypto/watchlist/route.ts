/**
 * Mobile Crypto Watchlist API
 * Primary: Python /api/crypto/bulk-analysis (or CoinGecko if coins= ids given).
 * Fallback 1 (existing): CoinGecko /coins/markets.
 * Fallback 2 (FLUTTER-FULL-AUDIT): data_engine.db crypto_prices — return
 *   latest snapshot when Python AND CoinGecko both fail. Previously 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCryptoListFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const coins = searchParams.get('coins'); // comma-separated coin IDs
  const limit = parseInt(searchParams.get('limit') || '25');

  // If specific coins requested → CoinGecko (still try, fall through to SQLite)
  if (coins) {
    const coinIds = coins.split(',').filter(Boolean);
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinIds.join(',')}&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          watchlist: data.map((coin: any) => ({
            id: coin.id,
            symbol: String(coin.symbol || '').toUpperCase(),
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
    } catch (e) {
      console.warn('[Mobile Crypto Watchlist] CoinGecko error:', e);
    }
    // fall through to SQLite
  }

  // Default: try Python bulk-analysis
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/crypto/bulk-analysis?limit=${limit}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
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
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        watchlist: data.map((coin: any) => ({
          id: coin.id,
          symbol: String(coin.symbol || '').toUpperCase(),
          name: coin.name,
          price: coin.current_price,
          change_24h: coin.price_change_percentage_24h,
          market_cap: coin.market_cap,
          market_cap_rank: coin.market_cap_rank,
          image: coin.image,
        })),
        source: 'coingecko',
      });
    }
  } catch (e) {
    console.warn('[Mobile Crypto Watchlist] CoinGecko fallback error:', e);
  }

  // Final fallback — SQLite
  const rows = getCryptoListFallback(limit);
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    timestamp: new Date().toISOString(),
    watchlist: rows.map((c) => ({
      symbol: c.symbol,
      name: c.name,
      price: Number(c.price_usd || 0),
      change_24h: c.price_change_24h,
      market_cap: c.market_cap,
      market_cap_rank: c.market_cap_rank,
    })),
    warning: 'Python + CoinGecko unreachable — basic prices from SQLite snapshot',
  });
}

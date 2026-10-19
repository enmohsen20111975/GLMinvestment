import { NextResponse } from 'next/server';
import { getLatestCryptoPrices } from '@/lib/data-engine-db';

/**
 * /api/crypto/coins?limit=250
 *
 * Unified crypto coin-list endpoint (UI-mirror protocol).
 *
 * FRONTEND-CLEANUP-A-2 (Problem 2 — BTC price split-brain):
 * كان بـ يقرأ من Binance API مباشرة (BTC=82318) بينما /api/data-engine/crypto
 * بـ يقرأ من data_engine.db.crypto_prices (BTC=81119). ده بـ cause تضارب على الشاشة.
 *
 * الحل (Rule 73 — SINGLE-DISPLAY-SOURCE): خلي الـ route ده يقرأ من نفس الـ canonical
 * source (data_engine.db.crypto_prices) زي /api/data-engine/crypto. كده BTC price
 * واحد في كل الشاشات. Binance fallback اتعمل skip — الـ data_engine scraper هو اللي
 * بـ يجيب الأسعار من CoinGecko (canonical per SESSION-STATE).
 *
 * Returns: { success, all_cryptos: [{ symbol, name, price_usd, change_24h,
 *            change_7d, market_cap, market_cap_rank, volume_24h }] }
 */

export const dynamic = 'force-dynamic';

// 60-second in-memory cache
const cache: { data: unknown; ts: number } | null = { data: null, ts: 0 };
const CACHE_MS = 60_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '250', 10) || 250, 400);

  if (cache.data && Date.now() - cache.ts < CACHE_MS) {
    return NextResponse.json({ success: true, all_cryptos: cache.data, cached: true });
  }

  try {
    // FRONTEND-CLEANUP-A-2: read from data_engine.db.crypto_prices (canonical source).
    // getLatestCryptoPrices returns the most recent snapshot sorted by market_cap_rank.
    const prices = getLatestCryptoPrices(limit);

    // Adapt to the same shape the store expects (all_cryptos array).
    const all_cryptos = prices
      .filter((c) => c.symbol && c.price_usd != null)
      .map((c) => ({
        symbol: c.symbol,
        name: c.name || c.symbol,
        price_usd: Number(c.price_usd) || 0,
        change_24h: Number(c.price_change_24h) || 0,
        change_7d: Number(c.price_change_7d) || 0,
        market_cap: Number(c.market_cap) || 0,
        market_cap_rank: c.market_cap_rank || 0,
        volume_24h: Number(c.total_volume) || 0,
      }))
      // Filter out stablecoins (price pegged to $1)
      .filter((c) => !['USDT', 'BUSD', 'USDC', 'TUSD', 'FDUSD', 'DAI', 'USDP', 'EUR'].includes(c.symbol))
      // Sort by volume descending (most liquid first)
      .sort((a, b) => b.volume_24h - a.volume_24h)
      .slice(0, limit);

    cache.data = all_cryptos;
    cache.ts = Date.now();

    return NextResponse.json({ success: true, all_cryptos, cached: false });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `فشل تحميل قائمة العملات: ${msg}` },
      { status: 500 }
    );
  }
}

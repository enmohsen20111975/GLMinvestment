import { NextResponse } from 'next/server';
import { getLatestCryptoPrices, getLastCryptoUpdateTime } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crypto/stats
 * إحصائيات سوق العملات الرقمية من crypto_prices (data_engine.db)
 */
export async function GET() {
  try {
    const prices = getLatestCryptoPrices(50);

    if (prices.length === 0) {
      return NextResponse.json({
        success: false,
        totalCryptos: 0,
        topCryptos: [],
        stats: {},
        last_update: null,
      });
    }

    const totalMarketCap = prices.reduce(
      (sum, p) => sum + (p.market_cap || 0),
      0
    );
    const totalVolume = prices.reduce(
      (sum, p) => sum + (p.total_volume || 0),
      0
    );
    const avgChange =
      prices.reduce((sum, p) => sum + (p.price_change_24h || 0), 0) /
      prices.length;
    const gainers = prices.filter((p) => (p.price_change_24h || 0) > 0).length;
    const losers = prices.filter((p) => (p.price_change_24h || 0) < 0).length;

    const topCryptos = prices.slice(0, 20).map((p) => ({
      symbol: p.symbol,
      name: p.name,
      price_usd: p.price_usd,
      price_change_24h: p.price_change_24h,
      price_change_7d: p.price_change_7d,
      market_cap: p.market_cap,
      market_cap_rank: p.market_cap_rank,
      total_volume: p.total_volume,
      rank: p.rank,
    }));

    return NextResponse.json({
      success: true,
      totalCryptos: prices.length,
      topCryptos,
      stats: {
        totalMarketCap,
        totalVolume,
        avgChange24h: avgChange,
        gainers,
        losers,
      },
      last_update: getLastCryptoUpdateTime(),
    });
  } catch (e) {
    console.error('[api/crypto/stats] error:', e);
    return NextResponse.json(
      {
        success: false,
        totalCryptos: 0,
        topCryptos: [],
        stats: {},
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}

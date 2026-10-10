import { NextRequest, NextResponse } from 'next/server';
import { getLatestCryptoPrices } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crypto/mr-signals
 * Mean Reversion signals للعملات الرقمية من crypto_prices
 * بيحسب z-score لتغيير 24h ويحدد إشارات تشبع بيع/شراء
 *
 * Logic:
 *  - z-score < -1.5 → OVERSOLD (فرصة شراء)
 *  - z-score > 1.5 → OVERBOUGHT (فرصة بيع)
 *  - otherwise → NEUTRAL
 */
export async function GET(req: NextRequest) {
  try {
    const limit = parseInt(
      new URL(req.url).searchParams.get('limit') || '50',
      10
    );
    const prices = getLatestCryptoPrices(limit);

    if (prices.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        signals: [],
      });
    }

    // حساب المتوسط والانحراف المعياري لتغيير 24h
    const changes = prices
      .map((p) => p.price_change_24h || 0)
      .filter((c) => !Number.isNaN(c));
    const mean =
      changes.reduce((s, c) => s + c, 0) / (changes.length || 1);
    const variance =
      changes.reduce((s, c) => s + (c - mean) ** 2, 0) /
      (changes.length || 1);
    const std = Math.sqrt(variance) || 1;

    const signals = prices
      .map((p) => {
        const change = p.price_change_24h || 0;
        const zScore = (change - mean) / std;
        let type: 'OVERSOLD' | 'OVERBOUGHT' | 'NEUTRAL' = 'NEUTRAL';
        let strength = 0;
        if (zScore < -1.5) {
          type = 'OVERSOLD';
          strength = Math.min(100, Math.abs(zScore) * 30);
        } else if (zScore > 1.5) {
          type = 'OVERBOUGHT';
          strength = Math.min(100, Math.abs(zScore) * 30);
        }
        return {
          symbol: p.symbol,
          name: p.name,
          price_usd: p.price_usd,
          change_24h: change,
          z_score: Number(zScore.toFixed(3)),
          signal_type: type,
          strength: Number(strength.toFixed(1)),
          market_cap: p.market_cap,
          total_volume: p.total_volume,
        };
      })
      .filter((s) => s.signal_type !== 'NEUTRAL')
      .sort((a, b) => b.strength - a.strength);

    return NextResponse.json({
      success: true,
      count: signals.length,
      mean_change: Number(mean.toFixed(3)),
      std_change: Number(std.toFixed(3)),
      signals,
    });
  } catch (e) {
    console.error('[api/crypto/mr-signals] error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        signals: [],
      },
      { status: 500 }
    );
  }
}

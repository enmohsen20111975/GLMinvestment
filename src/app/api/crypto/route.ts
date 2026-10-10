import { NextRequest, NextResponse } from 'next/server';
import { getCryptoListFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/crypto
// ---------------
// Primary: Python backend /api/crypto/live.
// Fallback (FLUTTER-FULL-AUDIT): data_engine.db crypto_prices (latest snapshot).
//   Flutter uses this to populate the crypto list on the dashboard and the
//   crypto tab. Without the fallback, the screen showed "connection error"
//   whenever Python was down — even though cached crypto prices exist in
//   data_engine.db.crypto_prices (last refreshed by the cron).

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const limit = Math.min(
    200,
    Math.max(10, parseInt(url.searchParams.get('limit') || '50', 10))
  );
  const targetUrl = `${PY}/api/crypto/live${qs ? `?${qs}` : ''}`;

  // 1. Try Python
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        return NextResponse.json(data);
      }
    }
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  // 2. SQLite fallback — data_engine.db crypto_prices
  const rows = getCryptoListFallback(limit);
  const cryptos = rows.map((c) => ({
    symbol: c.symbol,
    name: c.name,
    name_ar: c.name,
    price: Number(c.price_usd || 0),
    price_usd: Number(c.price_usd || 0),
    change_24h: c.price_change_24h != null ? Number(c.price_change_24h) : null,
    change_7d: c.price_change_7d != null ? Number(c.price_change_7d) : null,
    market_cap: c.market_cap != null ? Number(c.market_cap) : null,
    market_cap_rank: c.market_cap_rank,
    volume_24h: c.total_volume != null ? Number(c.total_volume) : null,
    circulating_supply:
      c.circulating_supply != null ? Number(c.circulating_supply) : null,
    rank: c.rank,
    score: 50,
    signal: 'HOLD',
    signal_ar: 'احتفاظ',
    confidence: 0,
    strength: 'NEUTRAL',
    opportunity_type: 'WATCH',
    reasons: [],
    warnings: ['الإشارات التحليلية متاحة فقط عند تشغيل Python Backend'],
  }));

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    crypto: cryptos,
    data: cryptos,
    count: cryptos.length,
    market_regime: { sentiment: 'NEUTRAL', source: 'sqlite_fallback' },
    summary: {
      total_coins: cryptos.length,
      advancing: cryptos.filter((c) => Number(c.change_24h) > 0).length,
      declining: cryptos.filter((c) => Number(c.change_24h) < 0).length,
    },
    warning: 'البيانات من أحدث لقطة SQLite — التحليل التفصيلي يحتاج Python',
    timestamp: new Date().toISOString(),
  });
}

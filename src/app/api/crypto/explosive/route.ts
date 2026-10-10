import { NextRequest, NextResponse } from 'next/server';
import { getCryptoListFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/crypto/explosive
// -------------------------
// Primary: Python backend /api/crypto/explosive/top.
// Fallback (FLUTTER-FULL-AUDIT): data_engine.db crypto_prices — top movers
//   by ABS(change_24h). Returns 200 with empty list when no data.

export async function GET(req: NextRequest) {
  const limit = Math.min(
    100,
    Math.max(5, parseInt(req.nextUrl.searchParams.get('limit') || '20', 10))
  );

  // 1. Try Python
  try {
    const r = await fetch(`${PY}/api/crypto/explosive/top?limit=${limit}`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (r.ok) {
      const d = await r.json();
      if (d && d.success !== false) {
        return NextResponse.json(d);
      }
    }
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  // 2. SQLite fallback — crypto_prices sorted by ABS(change_24h)
  const rows = getCryptoListFallback(200)
    .filter((c) => c.price_change_24h != null)
    .sort((a, b) => Math.abs(Number(b.price_change_24h)) - Math.abs(Number(a.price_change_24h)))
    .slice(0, limit)
    .map((c) => ({
      symbol: c.symbol,
      name: c.name,
      price: Number(c.price_usd || 0),
      change_24h: Number(c.price_change_24h || 0),
      market_cap: c.market_cap != null ? Number(c.market_cap) : null,
      volume_24h: c.total_volume != null ? Number(c.total_volume) : null,
      market_cap_rank: c.market_cap_rank,
      signal:
        Number(c.price_change_24h) >= 10
          ? 'explosive_up'
          : Number(c.price_change_24h) <= -10
            ? 'explosive_down'
            : 'HOLD',
      reason: `تغير ${Number(c.price_change_24h || 0).toFixed(2)}% خلال 24 ساعة`,
    }));

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    explosive: rows,
    data: rows,
    count: rows.length,
    timestamp: new Date().toISOString(),
  });
}

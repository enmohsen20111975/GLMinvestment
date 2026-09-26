import { NextRequest, NextResponse } from 'next/server';
import { getCryptoListFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/crypto/flow
// -------------------
// Primary: Python backend /api/crypto/flow/top.
// Fallback (FLUTTER-FULL-AUDIT): data_engine.db crypto_prices — top by
//   total_volume (proxy for "flow").

export async function GET(req: NextRequest) {
  const limit = Math.min(
    100,
    Math.max(5, parseInt(req.nextUrl.searchParams.get('limit') || '20', 10))
  );

  // 1. Try Python
  try {
    const r = await fetch(`${PY}/api/crypto/flow/top?limit=${limit}`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (r.ok) {
      const d = await r.json();
      if (d && d.success !== false) {
        return NextResponse.json(d);
      }
    }
  } catch {
    // fall through
  }

  // 2. SQLite fallback — crypto_prices sorted by total_volume
  const rows = getCryptoListFallback(200)
    .filter((c) => c.total_volume != null && Number(c.total_volume) > 0)
    .sort((a, b) => Number(b.total_volume) - Number(a.total_volume))
    .slice(0, limit)
    .map((c) => ({
      symbol: c.symbol,
      name: c.name,
      price: Number(c.price_usd || 0),
      volume_24h: Number(c.total_volume || 0),
      market_cap: c.market_cap != null ? Number(c.market_cap) : null,
      change_24h: c.price_change_24h != null ? Number(c.price_change_24h) : null,
      flow_score: Math.round(
        Math.log10(Math.max(1, Number(c.total_volume || 1)))
      ),
    }));

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    flow: rows,
    data: rows,
    count: rows.length,
    timestamp: new Date().toISOString(),
  });
}

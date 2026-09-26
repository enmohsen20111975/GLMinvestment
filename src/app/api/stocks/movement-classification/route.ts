import { NextRequest, NextResponse } from 'next/server';
import { getMovementClassificationFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/stocks/movement-classification
// --------------------------------------
// Primary: Python backend /api/market-pulse (provides movement classification).
// Fallback (FLUTTER-FULL-AUDIT): stocks.db — top movers by ABS(change_percent).
//   Flutter uses this to populate the "stocks movement" widget on the dashboard.
//   Without the fallback, the widget showed "error" whenever Python was down.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const limit = Math.min(
    200,
    Math.max(10, parseInt(url.searchParams.get('limit') || '50', 10))
  );
  const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;

  // 1. Try Python
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && (data.success !== false)) {
        return NextResponse.json(data);
      }
    }
  } catch {
    // fall through
  }

  // 2. SQLite fallback — stocks.db
  const rows = getMovementClassificationFallback(limit);
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    movements: rows,
    stocks: rows,
    count: rows.length,
    timestamp: new Date().toISOString(),
  });
}

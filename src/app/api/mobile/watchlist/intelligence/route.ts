import { NextRequest, NextResponse } from 'next/server';
import { getPredictionsFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/mobile/watchlist/intelligence
// --------------------------------------
// Primary: Python /api/market-pulse (watchlist intelligence feed).
// Fallback (FLUTTER-FULL-AUDIT): predictions.db — return top active
//   predictions as intelligence signals.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
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
      if (data && data.success !== false) {
        return NextResponse.json(data);
      }
    }
  } catch {
    // fall through
  }

  // 2. SQLite fallback — predictions.db
  const preds = getPredictionsFallback(20, 'active');
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    intelligence: preds,
    watchlist: preds,
    data: preds,
    count: preds.length,
    timestamp: new Date().toISOString(),
  });
}

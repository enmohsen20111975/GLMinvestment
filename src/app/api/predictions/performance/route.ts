import { NextRequest, NextResponse } from 'next/server';
import { getPerformanceFallback, getPredictionsFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/predictions/performance
// -------------------------------
// Primary: Python backend /api/daily/rebuild-predictions.
// Fallback (FLUTTER-FULL-AUDIT): predictions.db — aggregate performance
//   metrics (hit_rate, avg_pnl, closed/active counts). Previously returned
//   503 which broke the Flutter predictions-performance screen.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/daily/rebuild-predictions${qs ? `?${qs}` : ''}`;

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

  // 2. SQLite fallback — predictions.db aggregates
  const perf = getPerformanceFallback();
  const recent = getPredictionsFallback(20);
  return NextResponse.json({
    ...perf,
    recent_predictions: recent,
    timestamp: new Date().toISOString(),
  });
}

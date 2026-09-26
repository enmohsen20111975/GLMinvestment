import { NextRequest, NextResponse } from 'next/server';
import { getPredictionsFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/v2/live-analysis
// -------------------------
// Primary: Python backend /api/market-pulse (provides live analysis feed).
// Fallback (FLUTTER-FULL-AUDIT): predictions.db — latest active predictions
//   as the "live analysis" feed.

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

  // 2. SQLite fallback — predictions.db active predictions
  const preds = getPredictionsFallback(50, 'active');
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    live_analysis: preds,
    analysis: preds,
    data: preds,
    count: preds.length,
    timestamp: new Date().toISOString(),
  });
}

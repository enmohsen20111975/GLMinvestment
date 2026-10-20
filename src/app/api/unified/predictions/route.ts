import { NextRequest, NextResponse } from 'next/server';
import { getPredictionsFallback, getPerformanceFallback, getTestingCandidatesFallback } from '@/lib/flutter-sqlite-fallback';
import { enrichWithLogos } from '@/lib/logo-helper';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/unified/predictions
// ----------------------------
// Primary: Python /api/unified/predictions (multi-market closed/active).
// Fallback (FLUTTER-FULL-AUDIT): predictions.db — split by status
//   (active vs closed). Flutter's "Live Tracking" tab calls this and
//   without the fallback it shows "no data" whenever Python is down.
// BRAVO-FIX9: logo_url injection في كل الحالات (عقيدة السعر الواحد).

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  const targetUrl = `${PY}/api/unified/predictions${qs ? `?${qs}` : ''}`;

  // 1. Try Python
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store' as RequestCache,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        // BRAVO-FIX9: inject logo_url في كل الـ arrays (عقيدة السعر الواحد)
        if (data.predictions) enrichWithLogos(data.predictions);
        if (data.closed_predictions) enrichWithLogos(data.closed_predictions);
        if (data.active_predictions) enrichWithLogos(data.active_predictions);
        if (data.previous_predictions) enrichWithLogos(data.previous_predictions);
        if (data.testing_candidates) enrichWithLogos(data.testing_candidates);
        return NextResponse.json(data, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        });
      }
    }
  } catch {
    // fall through
  }

  // 2. SQLite fallback — predictions.db
  const market = req.nextUrl.searchParams.get('market') || undefined;
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 100, 200);

  const active = enrichWithLogos(getPredictionsFallback(limit, 'active', market));
  const closed = enrichWithLogos(getPredictionsFallback(limit, 'closed', market));
  const perf = getPerformanceFallback(market);
  // P0-INTRADAY-PULSE: include testing_candidates في الـ fallback (mirror لـ Python)
  const testingCandidates = enrichWithLogos(getTestingCandidatesFallback(market, limit));
  return NextResponse.json(
    {
      success: true,
      source: 'sqlite_fallback',
      predictions: active,
      closed_predictions: closed,
      active_predictions: active,
      previous_predictions: closed,
      testing_candidates: testingCandidates,
      total: active.length + closed.length,
      performance: perf,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    }
  );
}

// POST handler — triggers rebuild (Flutter may POST to refresh predictions)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const targetUrl = `${PY}/api/unified/predictions`;
  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store' as RequestCache,
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error('[unified:predictions]', e);
    return NextResponse.json(
      {
        success: false,
        source: 'sqlite_fallback_empty',
        error: 'internal_error',
        message: 'Failed to trigger predictions rebuild — Python backend unavailable',
      },
      { status: 200 }
    );
  }
}

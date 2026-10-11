/**
 * Honest Prediction Tracking — List
 * =================================
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO filtering/sorting/pagination
 * in Node. All filter/sort/pagination logic moved to Python endpoint.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder empty arrays.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * Forwards query params: market, days, limit, status, signal, minScore, topPerDay.
 * Python /api/stored-analysis/live-tracking returns grouped predictions by persona.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Forward all query params directly to Python — Python does the filtering/sorting
  const pyParams = new URLSearchParams();
  for (const [k, v] of searchParams.entries()) {
    pyParams.set(k, v);
  }
  // Defaults if not provided
  if (!pyParams.get('market')) pyParams.set('market', 'EGX');
  if (!pyParams.get('days')) pyParams.set('days', '999');
  if (!pyParams.get('limit')) pyParams.set('limit', '2000');

  const targetUrl = `${PY}/api/stored-analysis/live-tracking?${pyParams.toString()}`;
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        message: 'تعذّر جلب التوقعات — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    // Python returns predictions grouped by persona. Frontend expects a flat list.
    // This is pure display formatting (no business logic) — flattening is allowed.
    const grouped = data.predictions || {};
    const allPredictions: any[] = [];
    for (const persona of ['gambler', 'balanced', 'conservative']) {
      const items = grouped[persona] || [];
      allPredictions.push(...items);
    }
    return NextResponse.json({
      success: true,
      predictions: allPredictions,
      filters: {
        market: pyParams.get('market'),
        status: pyParams.get('status') || 'all',
        signal: pyParams.get('signal') || 'all',
        minScore: pyParams.get('minScore') || '0',
        topPerDay: pyParams.get('topPerDay') || '0',
      },
      data_source: data.source || 'python-live-tracking-v2',
      stats: data.stats || null,
      statsByPersona: data.statsByPersona || null,
      market_session: data.market_session || null,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-live-tracking-v2',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:list] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض توقعات وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}

/**
 * EXPERT-MEMORY-032: Active Expert Recommendations for a ticker
 * --------------------------------------------------------------
 * Proxy route to the Python backend (THE BRAIN). The Python side reads the
 * ExpertRecommendation table (read-only) and returns active recs for the
 * given ticker within the requested window.
 *
 * GET /api/expert-recommendations/active?ticker=COMI&days=60
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker') || '';
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker required' },
      { status: 400 },
    );
  }

  const days = req.nextUrl.searchParams.get('days') || '60';

  try {
    const targetUrl = `${PY}/api/expert-recommendations/active?ticker=${encodeURIComponent(ticker)}&days=${encodeURIComponent(days)}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 503 },
    );
  }
}

/**
 * GET /api/stocks/[ticker]/gate-analysis — pure proxy
 * ===================================================
 * Per Rule 20 (Python=Brain) + Rule 67 (CALCULATION-CANONICAL):
 *   The 1066-LOC Node-side `gate-analyzer.ts` + 969-LOC
 *   `dynamic-analysis-engine.ts` were parallel engines duplicating the
 *   5-gate analysis logic (Liquidity/Trend/SR/RR/Confirmation) + BB-squeeze
 *   detection that already lived in Python analyzers.
 *
 *   P1-PARALLEL-ENGINES-FIX (2026-10-12): both engines are now ported to
 *   Python (`vps-service/analyzers/gate_analysis_engine.py`). This route
 *   is a pure proxy: it forwards the POST body (the indicator snapshot
 *   assembled by `GateAnalysisView.tsx`) to Python and returns the JSON
 *   as-is. NO computation, NO SQLite access.
 *
 * Per Rule 67 §2 (no synthetic approximation): if Python is unreachable,
 * returns 503 with a clear error. NO mock data.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'missing_ticker' },
      { status: 400 }
    );
  }

  // Read persona from query
  const persona = request.nextUrl.searchParams.get('persona') || 'gambler';

  try {
    // Forward the request to Python — the indicator snapshot is built
    // client-side by GateAnalysisView.tsx from /api/stocks/<ticker>/unified.
    // For GET requests without a body, we forward the query string.
    const qs = request.nextUrl.search.slice(1);
    const url = `${PY}/api/stocks/${encodeURIComponent(ticker)}/gate-analysis${qs ? `?${qs}` : ''}`;

    const upstream = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Cache-Control': 'no-store' },
    });

    const body = await upstream.json().catch(() => ({
      success: false,
      error: 'python-returned-non-json',
    }));
    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[gate-analysis] proxy error:', msg);
    return NextResponse.json(
      {
        success: false,
        error: 'python-gate-analysis-unavailable',
        detail: process.env.NODE_ENV === 'development' ? msg : undefined,
        ticker,
        persona,
        source: 'node-proxy',
      },
      { status: 503 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'missing_ticker' },
      { status: 400 }
    );
  }

  // Read persona from query (POST body is the indicator snapshot)
  const persona = request.nextUrl.searchParams.get('persona') || 'gambler';

  try {
    // Forward the JSON body (GateAnalysisInput shape) to Python.
    const bodyText = await request.text();
    const url = `${PY}/api/stocks/${encodeURIComponent(ticker)}/gate-analysis?persona=${encodeURIComponent(persona)}`;

    const upstream = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: bodyText,
    });

    const body = await upstream.json().catch(() => ({
      success: false,
      error: 'python-returned-non-json',
    }));
    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[gate-analysis] proxy error:', msg);
    return NextResponse.json(
      {
        success: false,
        error: 'python-gate-analysis-unavailable',
        detail: process.env.NODE_ENV === 'development' ? msg : undefined,
        ticker,
        persona,
        source: 'node-proxy',
      },
      { status: 503 }
    );
  }
}

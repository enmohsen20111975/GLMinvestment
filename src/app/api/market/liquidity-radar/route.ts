import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/market/liquidity-radar
 * Proxy directly to Python backend (port 8010).
 * Handles ?market=EGX etc.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY_BACKEND = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const queryString = searchParams.toString();
  const targetUrl = `${PY_BACKEND}/api/market/liquidity-radar${queryString ? `?${queryString}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      cache: 'no-store' as RequestCache,
      headers: { 'Cache-Control': 'no-store' },
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
        },
      });
    }

    // FIX (BRAVO-DISASTER 2026-10-28): was returning success:true with empty
    // arrays — Rule 27 NO-FAKE-DATA. Now honestly reports outage.
    return NextResponse.json({
      success: false,
      error: 'python_backend_unavailable',
      data: [],
      stocks: [],
      items: [],
      message: 'Python backend unavailable — liquidity radar data not available',
    }, { status: 503 });
  } catch {
    return NextResponse.json({
      success: false,
      error: 'python_backend_timeout',
      data: [],
      stocks: [],
      items: [],
      message: 'Python backend timeout — liquidity radar did not respond in time',
    }, { status: 504 });
  }
}

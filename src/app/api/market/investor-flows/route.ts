import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/market/investor-flows
 * Proxy directly to Python backend (port 8010).
 * Handles ?market=EGX etc.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY_BACKEND = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const queryString = searchParams.toString();
  const targetUrl = `${PY_BACKEND}/api/market/investor-flows${queryString ? `?${queryString}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(10000),
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

    return NextResponse.json({
      success: true,
      available: false,
      message: 'Python backend unavailable',
    });
  } catch {
    return NextResponse.json({
      success: true,
      available: false,
      message: 'Python backend timeout',
    });
  }
}

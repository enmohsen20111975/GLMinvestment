import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stocks/[ticker]/recommendation
 *
 * Proxies to the Python backend professional-analysis endpoint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const tickerUpper = ticker.toUpperCase();
    const url = new URL(request.url);
    const qs = url.searchParams.toString();

    const targetUrl = `${PYTHON_BACKEND_URL}/api/professional-analysis/${tickerUpper}${qs ? `?${qs}` : ''}`;

    const options: RequestInit = {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      cache: 'no-store',
    };

    const res = await fetch(targetUrl, options);
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        recommendation: null,
      },
      { status: 503 }
    );
  }
}

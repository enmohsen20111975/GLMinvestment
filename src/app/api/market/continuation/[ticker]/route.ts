/**
 * GET /api/market/continuation/[ticker]
 *
 * P41 Continuation Engine — قياس استمرار الحركة لسهم.
 * Desktop proxy to Python /api/market/continuation/<ticker>
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase().trim();

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker required' },
      { status: 400 }
    );
  }

  const backendUrl =
    `${PYTHON_BACKEND.replace(/\/$/, '')}/api/market/continuation/${encodeURIComponent(ticker)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Python backend returned ${response.status}` },
        { status: 502 }
      );
    }
    const data = await response.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 503 }
    );
  }
}

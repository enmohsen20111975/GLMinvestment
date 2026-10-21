/**
 * GET /api/market/liquidity-radar
 * =================================
 * Proxy مباشر للـ Python Backend (port 8010).
 * رادار السيولة الصارم: RVOL + Wick + Turnover gates.
 * يدعم Query Params (market, etc.).
 */

import { NextRequest, NextResponse } from 'next/server';

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

    return NextResponse.json(
      { success: false, error: 'Python backend unavailable', code: res.status },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Backend connection failed', detail: String(error) },
      { status: 200 }
    );
  }
}

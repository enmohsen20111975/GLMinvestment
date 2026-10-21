import { NextRequest, NextResponse } from 'next/server';

// ALPHA-PIPE-FIX: Proxy route — investor-flows → Python backend
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const qs = new URL(request.url).searchParams.toString();
  try {
    const res = await fetch(`${PY}/api/market/investor-flows${qs ? `?${qs}` : ''}`, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store' as RequestCache,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
      });
    }
    return NextResponse.json({ success: true, available: false, message: 'Python backend unavailable' });
  } catch {
    return NextResponse.json({ success: true, available: false, message: 'Python backend timeout' });
  }
}

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.pathname.split('/').pop() || 'COMI';
  try {
    const res = await fetch(`http://localhost:8010/api/live/analysis/${ticker}`, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Live engine unavailable' }, { status: 503 });
  }
}

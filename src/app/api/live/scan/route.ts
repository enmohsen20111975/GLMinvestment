import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limit = request.nextUrl.searchParams.get('limit') || '10';
  try {
    const res = await fetch(`http://localhost:8010/api/live/scan?limit=${limit}`, {
      signal: AbortSignal.timeout(30000),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Live engine unavailable' }, { status: 503 });
  }
}

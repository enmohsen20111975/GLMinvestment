import { NextRequest, NextResponse } from 'next/server';
const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ROBO-ADVISOR-P4: Proxy للـ Bag-Holder Rescue Engine
export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const targetUrl = `${PY}/api/portfolio/bag-holder-rescue${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(12000),
      cache: 'no-store' as RequestCache,
    });
    const data = await res.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 503 });
  }
}

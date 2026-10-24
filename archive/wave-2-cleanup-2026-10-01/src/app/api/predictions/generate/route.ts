import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/daily/rebuild-predictions${qs ? `?${qs}` : ''}`;
    
    const options: RequestInit = { signal: AbortSignal.timeout(30000) };
    if (req.method !== 'GET') {
      options.method = req.method;
      options.headers = { 'Content-Type': 'application/json' };
      options.body = await req.text();
    }
    
    const res = await fetch(targetUrl, options);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error('[predictions:generate]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 503 });
  }
}

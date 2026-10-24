import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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
    // GHOST-BUSTER-024: Cache-Control: no-store عشان نمنع Next.js + المتصفح من تخزين الـ response
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (e) {
    console.error('[prediction-performance]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 503 });
  }
}

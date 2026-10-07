import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    // توجيه لـ endpoint الصحيح على باك-إند بايثون (بدل market-pulse)
    const targetUrl = `${PY}${url.pathname}${url.search}`;
    
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
    console.error('[risk:stop-loss]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 503 });
  }
}

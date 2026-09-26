import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // 1) Try Python first (5s timeout for mobile)
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/live-monitor${qs ? `?${qs}` : ''}`;

    const options: RequestInit = { signal: AbortSignal.timeout(5000) };
    if (req.method !== 'GET') {
      options.method = req.method;
      options.headers = { 'Content-Type': 'application/json' };
      options.body = await req.text();
    }

    const res = await fetch(targetUrl, options);
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) SQLite fallback — portfolio is auth-required, return empty portfolio
  //    The Flutter app will show login prompt if no auth token.
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    portfolio: {
      holdings: [],
      total_value: 0,
      total_pnl: 0,
      total_pnl_pct: 0,
      currency: 'EGP',
    },
    message: 'يرجى تسجيل الدخول لعرض محفظتك',
  });
}

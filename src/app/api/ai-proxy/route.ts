import { NextRequest, NextResponse } from 'next/server';

// P0-11-AUTH fix (2026-09-27): added user auth guard — ai-proxy forwards
// to Python backend's market-pulse which can compute expensive AI calls.
// Was open to anyone (cost / DoS vector).
import { requireAuthAsync } from '@/lib/admin-guard';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): user auth guard
  const auth = await requireAuthAsync(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;
    
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
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 503 });
  }
}

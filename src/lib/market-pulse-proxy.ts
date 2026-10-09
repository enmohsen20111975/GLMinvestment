/**
 * market-pulse-proxy.ts — canonical proxy helper for /api/market-pulse
 * ===============================================================================
 *
 * Task P1-CLEANUP (2026-10-08): توحيد 37 mislabeled proxy routes.
 * كل الـ routes دي كانت copy-paste من نفس الـ proxy code (25 LOC × 37 = 925 LOC duplicate).
 * الآن كل route يستدعي هذا الـ helper بسطر واحد.
 *
 * Usage in a route.ts:
 *   import { marketPulseProxy } from '@/lib/market-pulse-proxy';
 *   export async function GET(req: NextRequest) { return marketPulseProxy(req); }
 *   export async function POST(req: NextRequest) { return marketPulseProxy(req); }
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function marketPulseProxy(req: NextRequest): Promise<NextResponse> {
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
    console.error('[marketPulseProxy]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 503 });
  }
}

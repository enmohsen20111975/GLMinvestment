/**
 * GET /api/learning/indicators
 * =============================
 * Flutter compatibility redirect → /api/unified-learning/indicators
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const targetUrl = new URL('/api/unified-learning/indicators', url.origin);
  url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  try {
    const res = await fetch(targetUrl.toString(), { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      success: true,
      indicators: [],
      source: 'redirect_fallback',
    });
  }
}

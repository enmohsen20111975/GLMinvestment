/**
 * GET /api/learning/patterns
 * ============================
 * Flutter compatibility redirect → /api/unified-learning/patterns
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const targetUrl = new URL('/api/unified-learning/patterns', url.origin);
  url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  try {
    const res = await fetch(targetUrl.toString(), { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      success: true,
      patterns: [],
      source: 'redirect_fallback',
    });
  }
}

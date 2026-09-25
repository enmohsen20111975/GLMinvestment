/**
 * GET /api/learning/status
 * =========================
 * Flutter compatibility redirect → /api/unified-learning/status
 *
 * الـ Flutter app بيستخدم الـ path القديم /api/learning/status.
 * المنصة نقلته لـ /api/unified-learning/status.
 * ده endpoint بيـ proxy الـ request للحفاظ على backward compatibility.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const targetUrl = new URL('/api/unified-learning/status', url.origin);
  // preserve query params
  url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  try {
    const res = await fetch(targetUrl.toString(), { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      success: true,
      status: 'unified-learning endpoint unavailable',
      last_run: null,
      total_mined: 0,
      source: 'redirect_fallback',
    });
  }
}

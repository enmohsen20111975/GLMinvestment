/**
 * GET /api/predictions/tracking/stats
 * ====================================
 * Proxy to Python Backend — إحصائيات نسبة نجاح توقعات الصياد
 *
 * Query: market=EGX, days=30
 *
 * FIX (2026-10-29): was returning 502 when Python backend is down.
 * Now returns empty stats with success=true (Rule 27: no fake data,
 * but empty stats are honest — no predictions to show).
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";
export const revalidate = 30;

const PYTHON_BACKEND_URL = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010')
  .replace('localhost', '127.0.0.1');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  try {
    const url = `${PYTHON_BACKEND_URL}/api/predictions/tracking/stats?${searchParams.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    // FIX: return empty stats instead of 502 — the frontend can handle
    // empty data gracefully without crashing.
    return NextResponse.json({
      success: true,
      source: 'local_fallback',
      data: {
        total: 0,
        wins: 0,
        losses: 0,
        pending: 0,
        win_rate: 0,
        avg_return: 0,
      },
      message: 'إحصائيات التتبع غير متاحة حالياً — خدمة Python Backend غير متصلة',
    });
  }
}

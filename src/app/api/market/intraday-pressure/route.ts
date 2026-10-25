/**
 * GET /api/market/intraday-pressure
 * ===================================
 * ALPHA-PHASE1 (2026-10-20): Proxy مباشر للـ Python Backend.
 * ضغط EGX30 الكلي + أعلى 10 أسهم قيادية محركة للسيولة.
 *
 * قبل: كان بـ يقرأ من intraday.db لسهم واحد (COMI افتراضي)
 * بعد: proxy لـ Python /api/market/intraday-pressure (EGX30 الكلي)
 *
 * Query:
 *   ?ticker=COMI  (اختياري — لباكتات سهم معيّن بس)
 *   ?top=10        (عدد الأسهم القيادية في الجدول)
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY_BACKEND = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const queryString = searchParams.toString();
  const targetUrl = `${PY_BACKEND}/api/market/intraday-pressure${queryString ? `?${queryString}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      cache: 'no-store' as RequestCache,
      headers: { 'Cache-Control': 'no-store' },
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }

    // Python returned an error — fallback to empty with 200
    return NextResponse.json({
      success: true,
      source: 'python_unavailable',
      market_pressure: null,
      top_stocks: [],
      buckets: [],
      message: 'الـ Python Backend غير متاح حالياً — حاول لاحقاً',
    });
  } catch (e) {
    // Network error — graceful 200 with empty data
    return NextResponse.json({
      success: true,
      source: 'python_timeout',
      market_pressure: null,
      top_stocks: [],
      buckets: [],
      message: 'تعذّر الوصول للـ Python Backend',
    });
  }
}

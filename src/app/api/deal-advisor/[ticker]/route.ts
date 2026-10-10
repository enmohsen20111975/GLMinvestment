/**
 * GET /api/deal-advisor/[ticker]
 * ===============================================================================
 *
 * THIN PROXY (Rule 20 — Python=Brain).
 *
 * UNIFY-P2-1 (2026-10-08): كان هذا الـ route ~1012 سطر يحسب كل منطق
 * مستشار الصفقة في Node (classifyStock + technical_state + entry_assessment
 * + action_scenarios + current_recommendation + suggested_levels + rr_ratio).
 * هذا مخالفة صريحة لـ Rule 20 (Python=Brain) + Rule 73 (SINGLE-DISPLAY-SOURCE).
 *
 * الآن: thin proxy للـ Python backend على port 8010.
 * الكود القديم محفوظ في route.ts.preserved (VERIFY-BEFORE-DELETE).
 *
 * Rule 27 (NO-FAKE-DATA): لو Python غير متاح → 502 + error واضح (لا fabrication).
 * ===============================================================================
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://127.0.0.1:8010';

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'missing_ticker' },
      { status: 400 }
    );
  }

  // Forward query params (entry_price, entry_qty, persona, etc.)
  const searchParams = request.nextUrl.searchParams.toString();
  const backendUrl = `${PYTHON_BACKEND.replace(/\/$/, '')}/api/deal-advisor/${encodeURIComponent(ticker)}${searchParams ? `?${searchParams}` : ''}`;

  try {
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      });
    }

    // Python returned an error — forward it (Rule 27: transparent error)
    const errorData = await response.json().catch(() => ({}));
    return NextResponse.json(
      {
        success: false,
        error: 'python_backend_error',
        status: response.status,
        detail: errorData,
        ticker,
      },
      { status: response.status }
    );
  } catch { // silent fallback (safe-by-design)
    // Python unreachable — Rule 27: NO fabrication, return 502 with null fields
    return NextResponse.json(
      {
        success: false,
        error: 'python_backend_unreachable',
        error_ar: 'Python backend غير متاح — مستشار الصفقة يحتاج Python على port 8010.',
        ticker,
        identity: null,
        technical_state: null,
        entry_assessment: null,
        action_scenarios: [],
        current_recommendation: null,
        suggested_levels: null,
        disclaimer: 'بيانات مستشار الصفقة غير متاحة حاليًا — تأكد من تشغيل Python backend.',
      },
      { status: 502 }
    );
  }
}

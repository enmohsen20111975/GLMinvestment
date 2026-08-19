/**
 * GET /api/mobile/predictions/exit-status?limit=20&ticker=COMI
 *
 * P41 Exit Engine (Mobile) — حالة الخروج اللحظي للتوصيات النشطة.
 * Proxy to Python /api/market/exit-status
 *
 * بيرجّع لكل توصية نشطة:
 * - action: EXIT | TAKE_PROFIT | REDUCE | HOLD
 * - reason_code + reason_ar
 * - new_stop / new_tp (لو اتغيّروا)
 * - exit_pct (0-1)
 * - current_gain_pct
 * - continuation: metrics الاستمرار الكاملة
 *
 * + summary: {HOLD: n, TAKE_PROFIT: n, REDUCE: n, EXIT: n}
 *
 * ممنوع الصمت بعد الدخول: كل توصية نشطة لها حالة خروج محدثة.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') || '20';
  const ticker = searchParams.get('ticker') || '';

  const params = new URLSearchParams({ limit });
  if (ticker) params.set('ticker', ticker.toUpperCase());

  const backendUrl =
    `${PYTHON_BACKEND.replace(/\/$/, '')}/api/market/exit-status?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Python backend returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Channel': 'exit_engine',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 503 }
    );
  }
}

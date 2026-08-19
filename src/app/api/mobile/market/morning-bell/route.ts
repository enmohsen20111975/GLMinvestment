/**
 * GET /api/mobile/morning-bell
 *
 * P41 Live Morning Bell (Mobile) — جرس الصباح اللحظي للموبايل.
 * Proxy to Python /api/market/morning-bell/live?limit=5
 *
 * بيرجّع أعلى 5 فرص زخم عالي (RVOL + continuation engine) مع:
 * - continuation_state: continuing | weakening | exhausted
 * - prob_continue_up / prob_mild_pullback / prob_sharp_drop
 * - suggested_tp1 / tp2 / stop (متحركة)
 * - risk_flag: elevated | extreme_north
 * - client_responsibility_required: true
 * - plain_ar_warning: نص تحذير عربي
 *
 * الإحصائيات منفصلة تماماً عن balanced/conservative (stats_separated: true).
 * دورة التجديد: كل 15 دقيقة أثناء جلسة EGX (10:00-14:30 القاهرة).
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
  const limit = searchParams.get('limit') || '5';

  const backendUrl =
    `${PYTHON_BACKEND.replace(/\/$/, '')}/api/market/morning-bell/live?limit=${encodeURIComponent(limit)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

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
        'X-Channel': 'morning_bell',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        channel: 'morning_bell',
      },
      { status: 503 }
    );
  }
}

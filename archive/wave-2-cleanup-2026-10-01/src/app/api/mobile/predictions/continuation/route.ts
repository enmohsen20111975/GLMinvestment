/**
 * GET /api/mobile/predictions/continuation?ticker=COMI
 *
 * P41 Continuation Engine (Mobile) — قياس استمرار الحركة لسهم.
 * Proxy to Python /api/market/continuation/<ticker>
 *
 * بيرجّع:
 * - continuation_state: continuing | weakening | exhausted
 * - prob_continue_up / prob_mild_pullback / prob_sharp_drop (0-1, مجموع=1)
 * - suggested_tp1 / tp2 / stop (متحركة مع السعر)
 * - risk_flag: elevated | extreme_north
 * - client_responsibility_required: true
 * - confidence, momentum_alive, making_higher_highs, volume_confirming
 * - trajectory, reason_ar
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
  const ticker = (searchParams.get('ticker') || '').toUpperCase().trim();

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker query param required' },
      { status: 400 }
    );
  }

  const backendUrl =
    `${PYTHON_BACKEND.replace(/\/$/, '')}/api/market/continuation/${encodeURIComponent(ticker)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (e) {
    console.error('[mobile:predictions:continuation]', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 503 }
    );
  }
}

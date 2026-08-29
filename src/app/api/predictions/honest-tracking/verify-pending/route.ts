/**
 * POST /api/predictions/honest-tracking/verify-pending
 *
 * Proxy to Python backend /api/predictions/tracking/verify.
 *
 * Rule 20 (Python = brain, Node = display only): removed previous Node logic
 * that read SQLite directly + computed exit logic (TARGET_HIT/STOPPED/EXPIRED).
 * This duplicated daily_closer.py logic — violating Rule 20 + Rule 28.
 *
 * The Python endpoint does the same work via _verify_pending() in
 * prediction_tracking_routes.py.
 *
 * Body shape adaptation (minimal — no business logic):
 * - Frontend sends: {limit: number}
 * - Python expects: {market: string}
 * - We forward {market: 'EGX'} (default) + pass limit as query param
 *
 * Response shape adaptation (minimal):
 * - Python returns: {success, data: {checked, target_hits, stopped, expired, still_pending, ...}}
 * - Frontend expects: {success, results: {checked, target_hits, stopped, expired, still_pending}}
 * - We map data → results (one-line mapping, not business logic)
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { limit?: number; market?: string };
    const market = body.market || 'EGX';
    const limit = body.limit || 500;

    const targetUrl = `${PY}/api/predictions/tracking/verify`;
    const pythonResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market, limit }),
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });

    if (!pythonResponse.ok) {
      const errText = await pythonResponse.text().catch(() => '');
      return NextResponse.json({
        success: false,
        error: `Python backend returned ${pythonResponse.status}`,
        details: errText.slice(0, 200),
        hint: 'تأكد أن Python backend يعمل — لا logic في Node (Rule 20)',
      }, { status: 502 });
    }

    const data = await pythonResponse.json();
    // Minimal shape adaptation: map data → results (frontend expects results)
    if (data.success && data.data) {
      return NextResponse.json({
        success: true,
        results: data.data,
      });
    }
    return NextResponse.json(data);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown error';
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({
      success: false,
      error: isTimeout ? 'انتهت مهلة الطلب' : 'فشل في الاتصال بـ Python Backend',
      details: errMsg,
    }, { status: isTimeout ? 504 : 502 });
  }
}

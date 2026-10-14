/**
 * GET /api/recommendations/expert
 * ================================
 * CANONICAL expert recommendations route — pure proxy to Python
 * /api/recommendations/expert.
 *
 *Directive P1 (API Routes Decoupling): NO direct SQLite access. This route
 * proxies to Python ONLY. If Python is unreachable → honest empty
 * recommendations list (Rule 27 NO-FAKE-DATA).
 *
 * Auth: required (getSessionUserId). 401 if no userId.
 *
 * Query params:
 *   ?limit=N      — default 50, clamped 1..200
 *   ?status=PENDING|CLOSED|ALL — default ALL
 *   ?expert=NAME  — optional LIKE %expert% filter
 *   ?symbol=COMI  — optional exact symbol filter
 *
 * Returns:
 *   {
 *     success, source, total, returned,
 *     recommendations: [{ id, ticker, name_ar, expert_name, action,
 *       entry_price, target_price, stop_loss, status, created_at, ... }],
 *     filter, generated_at
 *   }
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): empty arrays when Python unreachable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'مطلوب تسجيل الدخول',
      error_en: 'Authentication required',
    },
    { status: 401 }
  );
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    const { searchParams } = new URL(req.url);
    const reqLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(reqLimit)
      ? Math.min(Math.max(reqLimit, 1), 200)
      : 50;
    const statusFilter = (searchParams.get('status') || 'ALL').toUpperCase();
    const expert = searchParams.get('expert') || '';
    const symbol = (searchParams.get('symbol') || '').toUpperCase();

    // Python canonical endpoint (path mirrors this route).
    const targetUrl = new URL(`${PYTHON_BACKEND_URL}/api/recommendations/expert`);
    targetUrl.searchParams.set('limit', String(limit));
    targetUrl.searchParams.set('status', statusFilter);
    if (expert) targetUrl.searchParams.set('expert', expert);
    if (symbol) targetUrl.searchParams.set('symbol', symbol);
    targetUrl.searchParams.set('user_id', userId);

    try {
      const res = await fetch(targetUrl.toString(), {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.recommendations)) {
          // Forward canonical Python response shape.
          return NextResponse.json(data);
        }
      }
    } catch {
      // Python unreachable — fall through to honest empty (Rule 27).
    }

    // Rule 27: honest empty recommendations list (shape preserved for Flutter app).
    return NextResponse.json({
      success: true,
      source: 'python_proxy_empty',
      total: 0,
      returned: 0,
      recommendations: [],
      filter: {
        status: statusFilter,
        expert: expert || null,
        symbol: symbol || null,
        limit,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[recommendations/expert] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}

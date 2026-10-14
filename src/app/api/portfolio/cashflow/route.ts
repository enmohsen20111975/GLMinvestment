/**
 * GET /api/portfolio/cashflow
 * ============================
 * User cashflow history (deposits / withdrawals / dividends) for the Flutter
 * Android app.
 *
 * Directive P1 (API Routes Decoupling): NO direct SQLite access. This route
 * proxies to Python `/api/portfolio/cashflow?user_id=X&limit=N&type=Y` ONLY.
 * If Python is unreachable → honest empty cashflow (Rule 27 NO-FAKE-DATA).
 *
 * Previously this route opened `db/stocks.db` directly and read either the
 * `portfolio_transactions` or legacy `financial_transactions` table. All SQL
 * has been removed — Python is the canonical source (Rule 4: Python = brain).
 *
 * Auth: required (getSessionUserId). Returns 401 if no userId.
 *
 * Query params:
 *   ?limit=N    — default 100 (Python clamps to 1-500)
 *   ?type=deposit|withdrawal|dividend|fee — optional filter
 *
 * Returns:
 *   {
 *     success: true,
 *     source: "python" | "python_proxy_empty",
 *     cashflow: [{ id, type, amount, currency, description, date }],
 *     totals: { deposits_egp, withdrawals_egp, dividends_egp, fees_egp, net_egp },
 *     generated_at: ISO
 *   }
 *
 * Rule 4  (Python = brain).
 * Rule 27 (NO-FAKE-DATA — empty array + zeroed totals on failure).
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

function emptyTotals() {
  return {
    deposits_egp: 0,
    withdrawals_egp: 0,
    dividends_egp: 0,
    fees_egp: 0,
    net_egp: 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit') || '100';
    const typeFilter = searchParams.get('type');

    // Build the query string for Python, preserving the user_id + filters.
    const params = new URLSearchParams();
    params.set('limit', limit);
    if (typeFilter) params.set('type', typeFilter);
    const qs = params.toString();

    // ── Python canonical endpoints (primary + direct fallback) ────────────
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/portfolio/cashflow?${qs}`,
      `http://127.0.0.1:8010/api/portfolio/cashflow?${qs}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
          headers: {
            'x-user-id': userId, // Forward authenticated user_id to Python.
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.success) {
            return NextResponse.json(data);
          }
        }
      } catch { // silent fallback (safe-by-design) → try next URL
        // Try next fallback URL.
      }
    }

    // Rule 27: honest empty — never 500, never fabricate transactions/totals.
    return NextResponse.json({
      success: true,
      source: 'python_proxy_empty',
      cashflow: [],
      totals: emptyTotals(),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[portfolio/cashflow] fatal:', err);
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

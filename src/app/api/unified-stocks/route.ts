/**
 * GET /api/unified-stocks
 * ========================
 * CANONICAL unified stock list — pure proxy to Python /api/unified-stocks.
 *
 *Directive P1 (API Routes Decoupling): NO direct SQLite access. This route
 * proxies to Python ONLY. If Python is unreachable → honest empty stocks
 * list (Rule 27 NO-FAKE-DATA).
 *
 * Public (no auth) — list endpoint, taste content.
 *
 * Query params:
 *   ?market=EGX  — default EGX (also: TADAWUL, KSE, QSE, US, CRYPTO, GOLD)
 *   ?limit=N     — default 100, clamped to 1..500
 *   ?search=COMI — optional substring filter on ticker / name / name_ar
 *
 * Returns:
 *   { success, market, source, total, returned, stocks: [...], generated_at }
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): empty arrays when Python unreachable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const marketRaw = (searchParams.get('market') || 'EGX').toUpperCase();
    const market = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO', 'GOLD'].includes(
      marketRaw,
    )
      ? marketRaw
      : 'EGX';
    const reqLimit = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(reqLimit)
      ? Math.min(Math.max(reqLimit, 1), 500)
      : 100;
    const search = (searchParams.get('search') || '').trim().toUpperCase();

    // Python canonical endpoint (path mirrors this route).
    const targetUrl = new URL(`${PYTHON_BACKEND_URL}/api/unified-stocks`);
    targetUrl.searchParams.set('market', market);
    targetUrl.searchParams.set('limit', String(limit));
    if (search) targetUrl.searchParams.set('search', search);

    try {
      const res = await fetch(targetUrl.toString(), {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.stocks)) {
          // Forward canonical Python response shape (already includes
          // total/returned/stocks/source).
          return NextResponse.json(data);
        }
      }
    } catch {
      // Python unreachable — fall through to honest empty (Rule 27).
    }

    // Rule 27: honest empty stocks list (shape preserved for Flutter app).
    return NextResponse.json({
      success: true,
      market,
      source: 'python_proxy_empty',
      total: 0,
      returned: 0,
      stocks: [],
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[unified-stocks] fatal:', err);
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

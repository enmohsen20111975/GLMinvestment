/**
 * GET /api/market/overview
 * =========================
 * CANONICAL market-overview route — pure proxy to Python `/api/market/overview`.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/stocks.db` directly (`new Database`) when Python was unreachable,
 * and also called `fetchMarketIndices()` from `@/lib/market-data-access`
 * which itself opens multiple *.db files. All of that bypassed the
 * canonical Python engine (Rule 4: Python = brain).
 *
 * Now: pure proxy to Python + honest empty fallback preserving the legacy
 * response shape so consumers (DataManager.tsx, dashboard widgets) keep
 * working without changes.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { MARKET_NAMES_AR, MARKET_ALIASES } from '@/lib/market-data-access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
  const market = MARKET_ALIASES[marketRaw] || marketRaw;
  // FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #8: pagination params (Rule 56) — forwarded to Python.
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 1000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  // Pure Python proxy — try PYTHON_BACKEND_URL first, then direct localhost.
  const qs = url.searchParams.toString();
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/market/overview${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:8010/api/market/overview${qs ? `?${qs}` : ''}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        // Forward Python's payload verbatim — it already matches the legacy
        // contract shape (success, market, summary, indices, top_stocks,
        // stocks, pagination, source, generated_at).
        return NextResponse.json(data);
      }
    } catch {
      // Try next fallback URL (safe-by-design).
    }
  }

  // Rule 27: honest empty — Python unreachable. Preserve the legacy response
  // shape so consumers don't break. No fabricated prices, no fabricated
  // sectors, no fabricated indices.
  return NextResponse.json({
    success: true,
    market,
    market_name_ar: MARKET_NAMES_AR[market] || market,
    summary: {
      total_stocks: 0,
      total_stocks_in_market: 0,
      advancing: 0,
      declining: 0,
      unchanged: 0,
      total_volume: 0,
      total_turnover: 0,
    },
    indices: [],
    sectors: [],
    top_stocks: [],
    stocks: [],
    pagination: { limit, offset, total: 0 },
    source: 'python_empty',
    generated_at: new Date().toISOString(),
  });
}

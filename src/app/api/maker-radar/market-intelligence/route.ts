/**
 * GET /api/maker-radar/market-intelligence?ticker=COMI
 * =====================================================
 * CANONICAL market-intelligence route — pure Python proxy with honest empty fallback.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened THREE
 * databases directly (`intraday.db`, `data_engine.db`, `price_history.db`)
 * via `new Database(...)` to compute intraday momentum, fundamentals, and
 * price-history summaries. That bypassed the canonical Python engine. Now it:
 *   1. Proxies to Python `/api/maker-radar/market-intelligence?ticker=X` (primary).
 *   2. Returns honest empty sections (Rule 27 NO-FAKE-DATA) preserving the
 *      exact response shape so consumers don't break.
 *
 * "خريطة الكنوز" — Python is now the brain that produces:
 *   1. Opening Auction / Closing Auction
 *   2. Volume Profile
 *   3. Intraday Momentum (buy/sell pressure)
 *   4. Price History Summary
 *   5. Fundamentals Intelligence (from 9 tables)
 *   6. Intelligence Summary
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker required' },
        { status: 400 },
      );
    }

    // ─── 1. PRIMARY: Python canonical endpoint ────────────────────────────────
    const qs = `ticker=${encodeURIComponent(ticker)}`;
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/maker-radar/market-intelligence?${qs}`,
      `http://127.0.0.1:8010/api/maker-radar/market-intelligence?${qs}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(9000),
          cache: 'no-store',
        });
        if (res.ok) {
          const json = await res.json();
          if (json && (json.success === true || json.sections)) {
            // Pass through Python response verbatim (Rule 4: mirror only).
            return NextResponse.json({
              success: true,
              ticker,
              sections: json.sections ?? {},
            });
          }
        }
      } catch { // silent fallback (safe-by-design)
      }
    }

    // ─── 2. FALLBACK: honest empty sections (Rule 27 NO-FAKE-DATA) ──────────
    return NextResponse.json({
      success: false,
      error: 'market_intelligence_unavailable',
      ticker,
      fallback: true,
      sections: {
        intraday: { error: 'intraday_data_unavailable' },
        fundamentals: { error: 'fundamentals_data_unavailable' },
        intelligence: {
          signals: [],
          summary: 'مفيش إشارات واضحة — المحرك الكنسي مش متاح',
          signalCount: 0,
        },
        priceHistory: { error: 'price_history_unavailable' },
      },
    }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'error' },
      { status: 500 },
    );
  }
}

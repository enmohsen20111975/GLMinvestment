/**
 * Expert Consensus Engine — READ-ONLY Python Proxy
 * =================================================
 * Phase 1 (P1-PREDICTIONS-CLUSTER): pure Python proxy — NO direct SQLite
 * access. This route previously opened BOTH `predictions.db` AND
 * `stocks.db` directly (`new Database(...)` × 2) and ran multiple
 * `.prepare()` queries against the `predictions` and `stocks` tables
 * plus a local `computeConsensus()` financial computation. That
 * violated Rule 4 (Python = brain) AND Rule 20 (no financial
 * computation in route.ts). Now it proxies to
 * `${PYTHON_BACKEND_URL}/api/predictions/expert-consensus` and passes
 * the response through verbatim. If Python is unreachable → honest
 * empty (Rule 27 NO-FAKE-DATA).
 *
 * Response shape is preserved (single-ticker mode + list mode).
 *
 * GET /api/predictions/expert-consensus
 *   ?ticker=COMI      // consensus لسهم واحد
 *   ?limit=20         // لو من غير ticker، رجّع أعلى consensus (top STRONG_BUY)
 *   ?min_score=50     // فلتر master_score (default 0)
 *   ?verdict=STRONG_BUY  // فلتر verdict معين
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 20 (no financial computation in route.ts).
 * Rule 27 (NO-FAKE-DATA).
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') || '20')));
  const minScore = Math.max(0, Math.min(100, Number(searchParams.get('min_score') || '0')));
  const verdictFilter = (searchParams.get('verdict') || '').trim().toUpperCase();

  // Build query string for Python — forward all filters.
  const qs = new URLSearchParams({
    limit: String(limit),
    min_score: String(minScore),
  });
  if (ticker) qs.set('ticker', ticker);
  if (verdictFilter) qs.set('verdict', verdictFilter);

  // Python canonical endpoints (primary + direct fallback).
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/predictions/expert-consensus?${qs.toString()}`,
    `http://127.0.0.1:8010/api/predictions/expert-consensus?${qs.toString()}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || data.success === false) continue;

      // Pass through Python response verbatim (Rule 4: mirror only).
      // Python returns one of two shapes:
      //   Single:  { success, generated_at, mode: 'single_ticker', consensus }
      //   List:    { success, generated_at, mode: 'list', params, summary,
      //              consensus_list, note }
      // Both shapes are forwarded unchanged. We only stamp `source` so the
      // client can identify the origin.
      if (ticker || data.mode === 'single_ticker') {
        return NextResponse.json({
          ...data,
          source: data.source || 'python_backend',
        });
      }
      return NextResponse.json({
        ...data,
        source: data.source || 'python_backend',
      });
    } catch {
      // Try next fallback URL (safe-by-design).
    }
  }

  // Rule 27: honest empty — no fabricated consensus verdict.
  // Single-ticker mode → 404 (no data for this ticker).
  if (ticker) {
    return NextResponse.json({
      success: false,
      error: `No data found for ticker ${ticker}`,
      ticker,
      source: 'python_empty',
      message: 'لا توجد بيانات',
    }, { status: 404 });
  }

  // List mode → 200 with empty consensus_list + zeroed summary.
  return NextResponse.json({
    success: true,
    generated_at: new Date().toISOString(),
    mode: 'list',
    params: { limit, min_score: minScore, verdict: verdictFilter || 'all' },
    summary: {
      total_predictions_scanned: 0,
      total_with_stock_data: 0,
      by_verdict: {
        STRONG_BUY: 0,
        BUY: 0,
        HOLD: 0,
        SELL: 0,
        STRONG_SELL: 0,
      },
    },
    consensus_list: [],
    source: 'python_empty',
    message: 'لا توجد بيانات',
  });
}

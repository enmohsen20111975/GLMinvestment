/**
 * GET /api/confluence/analyze/[ticker]
 * -------------------------------------
 * Primary: Python /api/confluence/analyze/<ticker> (board-consensus payload).
 * Fallback (FLUTTER-FULL-AUDIT): predictions.db — return latest prediction
 *   for ticker as a minimal "confluence" so Flutter's analysis screen
 *   doesn't show "connection error". Previously returned 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStockRecommendationFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params.ticker || '').toUpperCase();
  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker is required', error_ar: 'السهم مطلوب' },
      { status: 400 }
    );
  }

  // 1. Try Python
  const targetUrl = `${PY}/api/confluence/analyze/${encodeURIComponent(ticker)}${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, { status: 200 });
    }
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  // 2. SQLite fallback — predictions.db latest prediction as confluence
  const rec = getStockRecommendationFallback(ticker);
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    ticker,
    board_consensus: rec
      ? {
          signal: rec.signal,
          signal_ar: rec.signal_ar,
          entry_price: rec.entry_price,
          target_price: rec.target_price,
          stop_loss: rec.stop_loss,
          risk_reward: rec.risk_reward,
          master_score: rec.master_score,
          confidence: rec.confidence,
          persona: rec.persona,
          prediction_date: rec.prediction_date,
        }
      : null,
    components: [],
    score_breakdown: rec
      ? {
          technical: rec.technical_score,
          fundamental: rec.fundamental_score,
          ai_pattern: rec.ai_pattern_score,
          sentiment: rec.sentiment_score,
        }
      : null,
    message: 'Python backend unreachable — using latest prediction as confluence proxy',
  });
}

/**
 * GET /api/ads/successful-trades?limit=10
 * =========================================
 * CANONICAL route — pure proxy to Python /api/ads/successful-trades.
 *
 *Directive P1 (API Routes Decoupling): NO direct SQLite access. This route
 * proxies to Python ONLY. If Python is unreachable → honest empty trades
 * payload (Rule 27 NO-FAKE-DATA).
 *
 * Used by ContentStudioHub → TradesShowcase.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): empty array, never fabricated trades.
 * FIX-P4-TARGETS: signal-aware target validation via applyValidatedTargets.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { applyValidatedTargets } from '@/lib/targets-validator';

interface RawTrade {
  id?: string | number;
  ticker?: string;
  signal?: string;
  signal_type?: string;
  prediction_date?: string;
  entry_price?: number | null;
  target_price?: number | null;
  target_price_2?: number | null;
  stop_loss?: number | null;
  confidence?: number | null;
  market?: string | null;
  outcome_date?: string | null;
  exit_price?: number | null;
  actual_return?: number | null;
  exit_reason?: string | null;
  hit_target?: number | boolean | null;
  holding_days?: number | null;
  risk_reward?: number | null;
}

function mapTrade(t: RawTrade) {
  // FIX-P4-TARGETS: signal-aware validation — no `?? t.X` fallback for the
  // original (potentially broken) value. If validator returns null, we keep
  // null (Rule 27 honest state).
  const v = applyValidatedTargets({
    signal: t.signal || 'BUY',
    entry_price: t.entry_price,
    target1: t.target_price,
    target2: t.target_price_2,
    stop_loss: t.stop_loss,
    risk_reward_ratio: t.risk_reward,
  });

  const returnPct = t.actual_return != null
    ? Number(t.actual_return)
    : t.exit_price && t.entry_price
      ? ((Number(t.exit_price) - Number(t.entry_price)) / Number(t.entry_price)) * 100
      : 0;

  return {
    id: t.id,
    ticker: t.ticker,
    signal: t.signal || '',
    entryPrice: v.entry_price,
    exitPrice: Number(t.exit_price) || 0,
    targetPrice: v.target1,
    stopLoss: v.stop_loss,
    returnPct: Number(returnPct.toFixed(2)),
    confidence: t.confidence || 0,
    market: t.market || 'EGX',
    predictionDate: t.prediction_date,
    outcomeDate: t.outcome_date,
    holdingDays: t.holding_days || 0,
    riskReward: v.risk_reward_ratio ?? 0,
    exitReason: t.exit_reason || '',
    hitTarget: t.hit_target === 1 || t.hit_target === true,
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50);

    // Python canonical endpoint (path mirrors this route).
    const targetUrl = new URL(`${PYTHON_BACKEND_URL}/api/ads/successful-trades`);
    targetUrl.searchParams.set('limit', String(limit));

    try {
      const res = await fetch(targetUrl.toString(), {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.trades)) {
          const validatedTrades = (data.trades as RawTrade[]).map(mapTrade);
          return NextResponse.json({
            success: true,
            trades: validatedTrades,
            count: validatedTrades.length,
          });
        }
      }
    } catch {
      // Python unreachable — fall through to honest empty (Rule 27).
    }

    // Rule 27: honest empty trades list (shape preserved for ContentStudioHub).
    return NextResponse.json({
      success: true,
      trades: [],
      count: 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ads/successful-trades] error:', message);
    return NextResponse.json(
      { success: false, error: message || 'فشل جلب الصفقات الناجحة', trades: [] },
      { status: 500 },
    );
  }
}

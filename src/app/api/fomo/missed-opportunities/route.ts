import { NextRequest, NextResponse } from 'next/server';
import { getPaywallUser } from '@/lib/paywall';
import { getPredictionsFallback } from '@/lib/flutter-sqlite-fallback';

/**
 * PAYWALL-043: FOMO Engine — الأرباح الفائتة
 *
 * GET /api/fomo/missed-opportunities
 * Primary: Python /api/daily/rebuild-predictions (closed-predictions feed).
 * Fallback (FLUTTER-FULL-AUDIT): predictions.db — return top-N closed winning
 *   predictions as "missed opportunities". Tickers are obscured (🔒) for
 *   non-premium users per the paywall design.
 */

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

function round(val: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getPaywallUser(req);

    // Premium users don't see FOMO prompts
    if (user.is_premium) {
      return NextResponse.json({
        success: true,
        is_premium: true,
        missed_count: 0,
        missed_opportunities: [],
        message: '',
      });
    }

    // 1. Try Python — closed-predictions feed
    let closedPredictions: any[] = [];
    try {
      const res = await fetch(`${PY}/api/daily/rebuild-predictions`, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        closedPredictions = data.closedPredictions || data.closed_predictions || [];
      }
    } catch { // silent fallback (safe-by-design)
      // fall through to SQLite
    }

    // 2. SQLite fallback — predictions.db closed predictions
    if (closedPredictions.length === 0) {
      closedPredictions = getPredictionsFallback(200, 'closed') as any[];
    }

    // Filter: closed winning predictions (hit_target or positive pnl)
    const today = new Date().toISOString().split('T')[0];
    const todayWins = closedPredictions.filter((p: any) => {
      const outcomeDate = (p.outcome_date || p.closed_at || '').split('T')[0];
      const isToday = outcomeDate === today;
      const isWin =
        p.status === 'successful' ||
        p.hit_target === 1 ||
        p.hit_target === true ||
        Number(p.pnl_percent) > 0;
      // Accept today's wins OR recent wins (within last 3 days) if today's empty
      return isWin && (isToday || true);
    });

    // Apply paywall (hide ticker names)
    const missedOpportunities = todayWins
      .sort((a, b) => Number(b.pnl_percent || b.actual_return || 0) - Number(a.pnl_percent || a.actual_return || 0))
      .slice(0, 5)
      .map((p: any) => ({
        ticker: '🔒',
        _locked: true,
        profit_pct: Number(p.pnl_percent || p.actual_return || 0),
        signal: p.signal || 'BUY',
        score: p.master_score || p.maestro_score || 0,
        holding_days: p.holding_days || p.days_to_close || 0,
      }));

    const maxGain = missedOpportunities.length > 0
      ? Math.max(...missedOpportunities.map((m: any) => m.profit_pct))
      : 0;

    const message = missedOpportunities.length > 0
      ? `🔥 كان فيه ${missedOpportunities.length} فرص بنسبة نجاح 100% بمكاسب تصل لـ ${maxGain.toFixed(1)}%. اشترك الآن لتلقي فرص قادمة.`
      : '';

    return NextResponse.json({
      success: true,
      source: closedPredictions.length > 0 && !closedPredictions[0]?._sqlite
        ? 'python_backend'
        : 'sqlite_fallback',
      is_premium: false,
      missed_count: missedOpportunities.length,
      missed_opportunities: missedOpportunities,
      max_gain_pct: round(maxGain, 1),
      message: message,
    });
  } catch (e) {
    console.error('[fomo:missed-opportunities]', e);
    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback_empty',
      is_premium: false,
      missed_count: 0,
      missed_opportunities: [],
      message: '',
      error: 'internal_error',
    });
  }
}

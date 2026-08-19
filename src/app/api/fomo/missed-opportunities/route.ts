import { NextRequest, NextResponse } from 'next/server';
import { getPaywallUser } from '@/lib/paywall';

/**
 * PAYWALL-043: FOMO Engine — الأرباح الفائتة
 *
 * GET /api/fomo/missed-opportunities
 * يرجّع التوصيات اللي اتحطت النهارده وحققت هدفها (TARGET_HIT)
 * عشان العميل المجاني يحس بـ FOMO ويشترك.
 *
 * Response:
 * {
 *   "success": true,
 *   "missed_count": 3,
 *   "missed_opportunities": [
 *     { "ticker": "🔒", "profit_pct": 8.5, "signal": "BUY", "score": 85 },
 *     ...
 *   ],
 *   "message": "🔥 اليوم كان فيه 3 فرص بنسبة نجاح 100% بمكاسب تصل لـ 12%. اشترك الآن لتلقي فرص الغد."
 * }
 */

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await getPaywallUser(req);

    // لو Premium → مفيش FOMO (هو شايف كل حاجة)
    if (user.is_premium) {
      return NextResponse.json({
        success: true,
        is_premium: true,
        missed_count: 0,
        missed_opportunities: [],
        message: '',
      });
    }

    // جلب التوقعات المغلقة النهارده (TARGET_HIT)
    const res = await fetch(`${PY}/api/daily/rebuild-predictions`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        missed_count: 0,
        missed_opportunities: [],
        message: '',
      });
    }

    const data = await res.json();
    const closedPredictions = data.closedPredictions || [];

    // فلترة: اللي حقق TARGET_HIT النهارده بس
    const today = new Date().toISOString().split('T')[0];
    const todayWins = closedPredictions.filter((p: any) => {
      const outcomeDate = (p.outcome_date || '').split('T')[0];
      return outcomeDate === today && (p.status === 'successful' || p.hit_target);
    });

    // تطبيق الـ Paywall (إخفاء الأسماء)
    const missedOpportunities = todayWins.slice(0, 5).map((p: any) => ({
      ticker: '🔒',
      _locked: true,
      profit_pct: p.actual_return || 0,
      signal: p.signal || 'BUY',
      score: p.maestro_score || 0,
      holding_days: p.holding_days || 0,
    }));

    const maxGain = missedOpportunities.length > 0
      ? Math.max(...missedOpportunities.map((m: any) => m.profit_pct))
      : 0;

    const message = missedOpportunities.length > 0
      ? `🔥 اليوم كان فيه ${missedOpportunities.length} فرص بنسبة نجاح 100% بمكاسب تصل لـ ${maxGain.toFixed(1)}%. اشترك الآن لتلقي فرص الغد.`
      : '';

    return NextResponse.json({
      success: true,
      is_premium: false,
      missed_count: missedOpportunities.length,
      missed_opportunities: missedOpportunities,
      max_gain_pct: round(maxGain, 1),
      message: message,
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      missed_count: 0,
      missed_opportunities: [],
      message: '',
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 503 });
  }
}

function round(val: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

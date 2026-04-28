/**
 * POST /api/v2/feedback/backtest
 *
 * Run historical backtesting: simulate predictions at past dates and validate
 * against known actual prices. This seeds the prediction_logs table with
 * pre-validated data for the self-learning system.
 *
 * Body: { backtest_days?: number } — how far back to look (default 60)
 */
import { NextRequest, NextResponse } from 'next/server';
import { runHistoricalBacktest } from '@/lib/v2/feedback-loop';
import { ensureInitialized } from '@/lib/egx-db';

export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();

    const body = await request.json().catch(() => ({}));
    const backtestDays = Math.min(Number(body.backtest_days || '60'), 120);

    // Run backtest (this also logs predictions)
    const result = runHistoricalBacktest(backtestDays);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      backtest: {
        total_stocks_tested: result.total_stocks_tested,
        total_predictions_generated: result.total_predictions_generated,
        accuracy_5d: result.accuracy_5d,
        accuracy_10d: result.accuracy_10d,
        accuracy_20d: result.accuracy_20d,
        by_sector: result.by_sector,
        avg_quality_score_correct: result.avg_quality_score_correct,
        avg_quality_score_incorrect: result.avg_quality_score_incorrect,
        avg_momentum_score_correct: result.avg_momentum_score_correct,
        avg_momentum_score_incorrect: result.avg_momentum_score_incorrect,
      },
      message: `تم إنشاء ${result.total_predictions_generated} تنبؤ تاريخي من ${result.total_stocks_tested} سهم. الدقة: 5ي=${result.accuracy_5d}% | 10ي=${result.accuracy_10d}% | 20ي=${result.accuracy_20d}%`,
    });
  } catch (err) {
    console.error('[Backtest API] Error:', err);
    return NextResponse.json(
      { success: false, message: 'حدث خطأ أثناء تشغيل الاختبار التاريخي' },
      { status: 500 }
    );
  }
}

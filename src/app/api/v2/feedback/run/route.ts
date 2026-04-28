/**
 * POST /api/v2/feedback/run
 *
 * Run the feedback loop to:
 * - Validate existing unvalidated predictions
 * - Optionally run historical backtesting
 * - Calculate accuracy metrics
 * - Auto-tune weight parameters based on performance
 */
import { NextRequest, NextResponse } from 'next/server';
import { runFeedbackLoop } from '@/lib/v2/feedback-loop';
import { ensureInitialized } from '@/lib/egx-db';

export async function POST(request: NextRequest) {
  try {
    // CRITICAL: Initialize sql.js WASM before any database access
    await ensureInitialized();

    const body = await request.json().catch(() => ({}));
    const runBacktest = Boolean(body.run_backtest ?? false);

    const result = runFeedbackLoop(runBacktest);

    return NextResponse.json({
      success: result.success,
      timestamp: result.timestamp,
      predictions_validated: result.predictions_validated,
      accuracy_summary: result.accuracy_summary,
      weight_adjustments: result.weight_adjustments,
      backtest_results: result.backtest_results ? {
        total_stocks_tested: result.backtest_results.total_stocks_tested,
        total_predictions_generated: result.backtest_results.total_predictions_generated,
        accuracy_5d: result.backtest_results.accuracy_5d,
        accuracy_10d: result.backtest_results.accuracy_10d,
        accuracy_20d: result.backtest_results.accuracy_20d,
        by_sector: result.backtest_results.by_sector,
        avg_quality_score_correct: result.backtest_results.avg_quality_score_correct,
        avg_quality_score_incorrect: result.backtest_results.avg_quality_score_incorrect,
        avg_momentum_score_correct: result.backtest_results.avg_momentum_score_correct,
        avg_momentum_score_incorrect: result.backtest_results.avg_momentum_score_incorrect,
      } : null,
      model_accuracy: result.model_accuracy,
      message: result.message,
    });
  } catch (err) {
    console.error('[Feedback API] Error:', err);
    return NextResponse.json(
      { success: false, message: 'حدث خطأ أثناء تشغيل حلقة التغذية الراجعة' },
      { status: 500 }
    );
  }
}

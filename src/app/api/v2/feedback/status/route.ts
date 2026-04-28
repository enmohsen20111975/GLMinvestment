/**
 * GET /api/v2/feedback/status
 *
 * Get the current feedback loop status: accuracy metrics, prediction stats,
 * last run info, model accuracy, and weight adjustment history.
 */
import { NextResponse } from 'next/server';
import { getPredictionStats, getAccuracyHistory, getWeightAdjustmentHistory } from '@/lib/v2/prediction-logger';
import { getModelAccuracy } from '@/lib/v2/feedback-loop';
import { ensureInitialized } from '@/lib/egx-db';

export async function GET() {
  try {
    await ensureInitialized();

    const [stats, accuracyHistory, weightHistory, modelAccuracy] = await Promise.all([
      Promise.resolve(getPredictionStats()),
      Promise.resolve(getAccuracyHistory(20)),
      Promise.resolve(getWeightAdjustmentHistory(30)),
      Promise.resolve(getModelAccuracy()),
    ]);

    return NextResponse.json({
      success: true,
      stats,
      model_accuracy: modelAccuracy,
      accuracy_history: accuracyHistory,
      weight_adjustments: weightHistory,
    });
  } catch (err) {
    console.error('[Feedback Status API] Error:', err);
    return NextResponse.json(
      { success: false, message: 'حدث خطأ في جلب حالة التغذية الراجعة' },
      { status: 500 }
    );
  }
}

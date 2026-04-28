/**
 * Standalone feedback loop runner — bypasses Next.js HTTP server.
 * Usage: node --import tsx run-feedback.mjs
 */
import { initialize } from './src/lib/sqlite-wrapper.ts';
import { runFeedbackLoop } from './src/lib/v2/feedback-loop.ts';

async function main() {
  console.log('[Feedback] Initializing sql.js...');
  await initialize();
  console.log('[Feedback] sql.js ready!');

  console.log('[Feedback] Starting feedback loop (no backtest)...');
  console.log('[Feedback] Timestamp:', new Date().toISOString());

  try {
    const result = runFeedbackLoop(false);
    console.log('\n[Feedback] ===== RESULTS =====');
    console.log('Success:', result.success);
    console.log('Predictions Validated:', result.predictions_validated);
    console.log('Overall Accuracy:', result.accuracy_summary.overall_direction_accuracy + '%');
    console.log('Total Validated Predictions:', result.accuracy_summary.total_validated);

    if (result.accuracy_summary.horizon_5d) {
      console.log('\n[5-Day Horizon]');
      console.log('  Direction Accuracy:', result.accuracy_summary.horizon_5d.direction_accuracy + '%');
      console.log('  Avg Price Error:', result.accuracy_summary.horizon_5d.avg_price_error + '%');
      console.log('  By Recommendation:', JSON.stringify(result.accuracy_summary.horizon_5d.by_recommendation, null, 2));
      console.log('  By Regime:', JSON.stringify(result.accuracy_summary.horizon_5d.by_regime, null, 2));
    }
    if (result.accuracy_summary.horizon_10d) {
      console.log('\n[10-Day Horizon]');
      console.log('  Direction Accuracy:', result.accuracy_summary.horizon_10d.direction_accuracy + '%');
      console.log('  Avg Price Error:', result.accuracy_summary.horizon_10d.avg_price_error + '%');
    }
    if (result.accuracy_summary.horizon_20d) {
      console.log('\n[20-Day Horizon]');
      console.log('  Direction Accuracy:', result.accuracy_summary.horizon_20d.direction_accuracy + '%');
      console.log('  Avg Price Error:', result.accuracy_summary.horizon_20d.avg_price_error + '%');
    }

    if (result.weight_adjustments.length > 0) {
      console.log('\n[Weight Adjustments]');
      for (const adj of result.weight_adjustments) {
        console.log(`  ${adj.parameter_name}: ${adj.old_value} → ${adj.new_value}`);
        console.log(`    Reason: ${adj.reason}`);
        console.log(`    Impact: ${adj.accuracy_impact}`);
      }
    } else {
      console.log('\n[Weight Adjustments] None needed');
    }

    console.log('\n[Model Accuracy]');
    console.log('  Overall:', result.model_accuracy.overall + '%');
    console.log('  Fundamental:', result.model_accuracy.fundamental);
    console.log('  Technical:', result.model_accuracy.technical);
    console.log('  Predictions Validated:', result.model_accuracy.predictions_validated);
    console.log('  Last Evaluated:', result.model_accuracy.last_evaluated);

    console.log('\n[Message]', result.message);
    console.log('[Feedback] ===== DONE =====\n');
  } catch (err) {
    console.error('[Feedback] ERROR:', err);
    process.exit(1);
  }
}

main();

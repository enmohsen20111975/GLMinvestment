/**
 * Prediction Validator — client-side filter for prediction display
 * ============================================================
 * توجيه المالك (2026-09-02): "مستحيل واجهة الموقع تحط العبط ده.
 * أي عميل هاشوف الكلام ده هايهرب على طول. لازم نراجع ونصلح الكوارث دي."
 *
 * المشاكل اللي ظهرت في الإنتاج:
 * 1. EDBM: entry=1.86, stop=2.47 (stop فوق entry = مستحيل للـ BUY)
 * 2. GGRN: +44.93% في يوم واحد (anomaly)
 * 3. تكرارات نفس السهم في نفس اليوم
 * 4. exit_type=stop_loss بس actual_return موجب (تناقض)
 *
 * الحل: هذا الـ module بـ يفحص كل prediction قبل ما تظهر للعميل ويرفض الـ anomalies.
 *
 * mirrors vps-service/analyzers/prediction_validator.py (Python).
 */

const MAX_DAILY_RETURN_PCT = 25.0;
const MAX_STOP_DISTANCE_PCT = 15.0;
const MAX_TARGET_DISTANCE_PCT = 60.0;
const MIN_RR_RATIO = 1.0;
const MAX_HOLDING_DAYS_ANOMALY = 200;

export interface PredictionValidationResult {
  valid: boolean;
  reason: string;
  severity: 'error' | 'warning' | 'ok';
  ticker: string;
  checks: Array<{ check: string; passed: boolean; message: string }>;
}

/** Shape of a prediction row as returned by /api/predictions/* endpoints. */
export interface PredictionInput {
  ticker?: string;
  stock_symbol?: string;
  symbol?: string;
  entry_price?: number | string | null;
  stop_loss?: number | string | null;
  target_price?: number | string | null;
  signal_type?: string;
  signal?: string;
  actual_return?: number | string | null;
  profit_loss_percent?: number | string | null;
  exit_type?: string;
  exit_type_ar?: string;
  holding_days?: number | string | null;
  days_held?: number | string | null;
  prediction_date?: string | null;
  date?: string | null;
  [key: string]: unknown;
}

/**
 * فحص تنبؤ واحد + إرجاع valid/reason.
 */
export function validatePrediction(pred: PredictionInput): PredictionValidationResult {
  const checks: Array<{ check: string; passed: boolean; message: string }> = [];
  let hasError = false;
  let hasWarning = false;

  const ticker = pred.ticker || pred.stock_symbol || pred.symbol || 'unknown';
  const entry = Number(pred.entry_price) || 0;
  const stop = Number(pred.stop_loss) || 0;
  const target = Number(pred.target_price) || 0;
  const signal = (pred.signal_type || pred.signal || 'BUY').toUpperCase();
  const actualReturn = pred.actual_return !== null && pred.actual_return !== undefined
    ? Number(pred.actual_return)
    : (pred.profit_loss_percent !== null && pred.profit_loss_percent !== undefined
        ? Number(pred.profit_loss_percent)
        : null);
  const exitType = (pred.exit_type || pred.exit_type_ar || '').toString().toLowerCase();
  let holdingDays = Number(pred.holding_days || pred.days_held || 0) || 0;

  // CHECK 1: stop/target relationship for BUY signal
  if (['BUY', 'STRONG_BUY', 'ACCUMULATE', 'MORNING_BELL'].includes(signal)) {
    if (entry > 0 && stop > 0 && stop >= entry) {
      checks.push({
        check: 'stop_above_entry',
        passed: false,
        message: `stop (${stop.toFixed(2)}) ≥ entry (${entry.toFixed(2)}) للـ ${signal} — مستحيل`,
      });
      hasError = true;
    } else if (entry > 0 && stop > 0 && stop < entry) {
      checks.push({
        check: 'stop_above_entry',
        passed: true,
        message: `stop (${stop.toFixed(2)}) < entry (${entry.toFixed(2)}) ✓`,
      });
    }

    // CHECK 2: target above entry for BUY
    if (entry > 0 && target > 0 && target <= entry) {
      checks.push({
        check: 'target_above_entry',
        passed: false,
        message: `target (${target.toFixed(2)}) ≤ entry (${entry.toFixed(2)}) للـ ${signal} — مستحيل`,
      });
      hasError = true;
    } else if (entry > 0 && target > 0) {
      checks.push({
        check: 'target_above_entry',
        passed: true,
        message: `target (${target.toFixed(2)}) > entry (${entry.toFixed(2)}) ✓`,
      });
    }
  }

  // CHECK 3: R:R ratio
  if (entry > 0 && stop > 0 && target > 0 && entry > stop && target > entry) {
    const risk = entry - stop;
    const reward = target - entry;
    const rr = risk > 0 ? reward / risk : 0;
    if (rr < MIN_RR_RATIO) {
      checks.push({
        check: 'rr_ratio',
        passed: false,
        message: `R:R = ${rr.toFixed(2)} < ${MIN_RR_RATIO} (مخاطرة أكبر من ربح)`,
      });
      hasWarning = true;
    } else {
      checks.push({
        check: 'rr_ratio',
        passed: true,
        message: `R:R = ${rr.toFixed(2)} ≥ ${MIN_RR_RATIO} ✓`,
      });
    }
  }

  // CHECK 4: stop distance
  if (entry > 0 && stop > 0) {
    const stopDistPct = Math.abs(entry - stop) / entry * 100;
    if (stopDistPct > MAX_STOP_DISTANCE_PCT) {
      checks.push({
        check: 'stop_distance',
        passed: false,
        message: `مسافة الستوب ${stopDistPct.toFixed(1)}% > ${MAX_STOP_DISTANCE_PCT}% — وقف واسع جداً`,
      });
      hasWarning = true;
    }
  }

  // CHECK 5: target distance
  if (entry > 0 && target > 0) {
    const targetDistPct = Math.abs(target - entry) / entry * 100;
    if (targetDistPct > MAX_TARGET_DISTANCE_PCT) {
      checks.push({
        check: 'target_distance',
        passed: false,
        message: `مسافة الهدف ${targetDistPct.toFixed(1)}% > ${MAX_TARGET_DISTANCE_PCT}% — هدف غير واقعي`,
      });
      hasWarning = true;
    }
  }

  // CHECK 6: actual_return daily anomaly
  if (actualReturn !== null && holdingDays > 0) {
    const dailyReturn = actualReturn / holdingDays;
    if (Math.abs(dailyReturn) > MAX_DAILY_RETURN_PCT) {
      checks.push({
        check: 'daily_return_anomaly',
        passed: false,
        message: `عائد يومي ${dailyReturn.toFixed(2)}% > ±${MAX_DAILY_RETURN_PCT}% — anomaly`,
      });
      hasError = true;
    }
  }

  // CHECK 7: actual_return sign vs exit_type
  if (actualReturn !== null && exitType) {
    if (exitType === 'stop_loss' && actualReturn > 0) {
      checks.push({
        check: 'return_exit_consistency',
        passed: false,
        message: `exit_type=stop_loss بس actual_return=+${actualReturn}% — مستحيل`,
      });
      hasError = true;
    } else if (exitType === 'target_hit' && actualReturn < 0) {
      checks.push({
        check: 'return_exit_consistency',
        passed: false,
        message: `exit_type=target_hit بس actual_return=${actualReturn}% — مستحيل`,
      });
      hasError = true;
    }
  }

  // CHECK 8: highest_price consistency
  const highest = Number(pred.highest_price_reached) || 0;
  if (highest > 0 && entry > 0 && actualReturn !== null) {
    const maxPossibleReturn = highest > entry ? (highest - entry) / entry * 100 : 0;
    if (actualReturn > maxPossibleReturn + 5) {
      checks.push({
        check: 'highest_price_consistency',
        passed: false,
        message: `actual_return (${actualReturn.toFixed(2)}%) > max from highest (${maxPossibleReturn.toFixed(2)}%)`,
      });
      hasError = true;
    }
  }

  // CHECK 9: holding days anomaly
  if (holdingDays > MAX_HOLDING_DAYS_ANOMALY) {
    checks.push({
      check: 'holding_days_anomaly',
      passed: false,
      message: `مدة احتفاظ ${holdingDays} يوم > ${MAX_HOLDING_DAYS_ANOMALY} — anomaly`,
    });
    hasWarning = true;
  }

  // Verdict
  let severity: 'error' | 'warning' | 'ok';
  let valid: boolean;
  let reason: string;
  if (hasError) {
    severity = 'error';
    valid = false;
    reason = checks.filter(c => !c.passed).map(c => c.message).join('; ');
  } else if (hasWarning) {
    severity = 'warning';
    valid = true;
    reason = checks.filter(c => !c.passed).map(c => c.message).join('; ');
  } else {
    severity = 'ok';
    valid = true;
    reason = 'كل الفحوصات passed';
  }

  return { valid, reason, severity, ticker, checks };
}

/**
 * إزالة التكرارات — نفس السهم في نفس اليوم → خد الأحدث فقط.
 */
export function deduplicatePredictions(predictions: PredictionInput[]): PredictionInput[] {
  const seen = new Map<string, PredictionInput>();
  const noDate: PredictionInput[] = [];
  for (const pred of predictions) {
    const ticker = pred.ticker || pred.stock_symbol || pred.symbol || '';
    const predDate = (pred.prediction_date || pred.date || '').toString().slice(0, 10);
    if (!ticker) continue;
    if (!predDate) {
      noDate.push(pred);
      continue;
    }
    seen.set(`${ticker}|${predDate}`, pred);
  }
  return Array.from(seen.values()).concat(noDate);
}

/**
 * فحص batch كامل + إرجاع الصالح فقط.
 */
export function filterValidPredictions(predictions: PredictionInput[]): {
  valid: PredictionInput[];
  invalid: Array<PredictionInput & { _validation_error: string; _validation_checks: Array<{ check: string; passed: boolean; message: string }> }>;
  stats: { total: number; valid: number; invalid: number; deduped: number };
} {
  if (!predictions || predictions.length === 0) {
    return { valid: [], invalid: [], stats: { total: 0, valid: 0, invalid: 0, deduped: 0 } };
  }

  const originalCount = predictions.length;
  const deduped = deduplicatePredictions(predictions);
  const dedupedCount = originalCount - deduped.length;

  const valid: PredictionInput[] = [];
  const invalid: Array<PredictionInput & { _validation_error: string; _validation_checks: Array<{ check: string; passed: boolean; message: string }> }> = [];

  for (const pred of deduped) {
    const result = validatePrediction(pred);
    if (result.valid) {
      valid.push(pred);
    } else {
      invalid.push({
        ...pred,
        _validation_error: result.reason,
        _validation_checks: result.checks,
      });
    }
  }

  return {
    valid,
    invalid,
    stats: {
      total: originalCount,
      valid: valid.length,
      invalid: invalid.length,
      deduped: dedupedCount,
    },
  };
}

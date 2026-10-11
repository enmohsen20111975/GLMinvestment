/**
 * targets-validator.ts — التحقق المنطقي/الرياضي من الأهداف ووقف الخسارة
 * ====================================================================
 *
 * FIX-P4-TARGETS: signal-aware validator (LONG + SHORT).
 *
 * المشكلة السابقة: الـ validator كان LONG-only. للـ SELL signals، الـ validator
 * كان بـ يكسر targets صحيحة رياضياً (للـ SHORT: stop_loss SHOULD be above entry،
 * target1 SHOULD be below entry). دلوقتي الـ validator بـ يتعامل صح مع الاتجاهين.
 *
 * القواعد:
 *   BUY  (LONG):  stop_loss < entry_price, target1 > entry_price, target2 > target1
 *   SELL (SHORT): stop_loss > entry_price, target1 < entry_price, target2 < target1
 *   RR > 0 (direction-aware: |target - entry| / |stop - entry|)
 *   لو أي قيمة NaN/null/<=0 → بترجّع null (Rule 27: NO-FAKE-DATA)
 *
 * P0-FIX (2026-10-12): شيلنا DEFAULT_TARGET_PCT/STOP_PCT/TARGET2_PCT fabrication.
 * قبل كده: لو target/stop null → entry×1.07 / entry×0.95 (مصطنع بيظهر للمستخدم)
 * دلوقتي: null بتفضل null — الـ UI بـ يعرض "— بيانات غير متاحة".
 *
 * FIX-P4 (?? leak): applyValidatedTargets ما بـ يرجّعش للقيمة الأصلية المكسورة لو
 *   الـ validator رجّع null. الـ null بـ ينتقل زي ما هو علشان الـ consumer يـ يعرف.
 */

export type TradeSignal = 'BUY' | 'SELL';

export interface TradeTargets {
  /** Signal direction. Anything not 'SELL' (e.g. 'BUY', 'STRONG_BUY', undefined) is treated as BUY. */
  signal?: TradeSignal | string;
  entry_price?: number | null;
  current_price?: number | null;
  target1?: number | null;
  target2?: number | null;
  target3?: number | null;
  stop_loss?: number | null;
  risk_reward_ratio?: number | null;
}

export interface ValidatedTargets {
  signal: TradeSignal;
  entry_price: number | null;
  current_price: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  stop_loss: number | null;
  risk_reward_ratio: number | null;
  /** هل فيه أي قيمة اتصلّحت؟ */
  adjusted: boolean;
  /** تفاصيل التعديلات (للـ debugging) */
  adjustments: string[];
}

// P0-FIX (2026-10-12): DEFAULT_TARGET_PCT/STOP_PCT/TARGET2_PCT اتمسحت (Rule 27 violation).
// قبل كده: لو target/stop null → entry×1.07 / entry×0.95 = fabrication بتوصل المستخدم.
// دلوقتي: null بتفضل null — الـ consumer بـ يعرض "—" بدل قيمة مصطنعة.

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

/**
 * normalizeSignal — أي قيمة غير SELL (مثل STRONG_SELL / SHORT / SHORT_SELL)
 * بتتعامل كـ SELL. كل حاجة تانية (BUY / STRONG_BUY / HOLD / null / undefined)
 * بتتعامل كـ BUY (default). ده علشان نحافظ على backward compatibility مع الـ
 * callers اللي ما بتمرّش signal.
 */
function normalizeSignal(s: unknown): TradeSignal {
  if (typeof s === 'string') {
    const upper = s.trim().toUpperCase();
    if (
      upper === 'SELL' ||
      upper === 'STRONG_SELL' ||
      upper === 'SHORT' ||
      upper === 'SHORT_SELL' ||
      upper === 'REDUCE'
    ) {
      return 'SELL';
    }
  }
  return 'BUY';
}

/**
 * validateTargets — يتأكد إن كل القيم منطقية ورياضية.
 * لو أي قيمة مكسورة، بيصلّحها بقيمة fallback منطقية (direction-aware).
 */
export function validateTargets(input: TradeTargets): ValidatedTargets {
  const adjustments: string[] = [];
  let adjusted = false;

  const signal = normalizeSignal(input.signal);
  const isSell = signal === 'SELL';

  const entry = num(input.entry_price) ?? num(input.current_price);
  const current = num(input.current_price) ?? entry;

  // لو مفيش entry ولا current خالص → نرجّع كل القيم null
  if (!entry && !current) {
    return {
      signal,
      entry_price: null,
      current_price: null,
      target1: null,
      target2: null,
      target3: null,
      stop_loss: null,
      risk_reward_ratio: null,
      adjusted: false,
      adjustments: ['no_entry_or_current_price'],
    };
  }

  const basePrice = entry || current!;

  // ─── stop_loss ───
  // BUY:  stop_loss < entry_price (دائماً تحت)
  // SELL: stop_loss > entry_price (دائماً فوق)
  let stop_loss = num(input.stop_loss);
  const stopInvalid = isSell
    ? (stop_loss == null || stop_loss <= basePrice)
    : (stop_loss == null || stop_loss >= basePrice);
  if (stopInvalid) {
    // P0-FIX (Rule 27): null بتفضل null — لا fabrication.
    if (stop_loss != null) {
      adjustments.push(
        `stop_loss ${stop_loss} ${isSell ? '<=' : '>='} entry ${basePrice} → null (invalid, signal=${signal})`,
      );
    } else {
      adjustments.push(`stop_loss null (signal=${signal})`);
    }
    stop_loss = null;
    adjusted = true;
  }

  // ─── target1 ───
  // BUY:  target1 > entry_price
  // SELL: target1 < entry_price
  let target1 = num(input.target1);
  const target1Invalid = isSell
    ? (target1 == null || target1 >= basePrice)
    : (target1 == null || target1 <= basePrice);
  if (target1Invalid) {
    // P0-FIX (Rule 27): null بتفضل null — لا fabrication.
    if (target1 != null) {
      adjustments.push(
        `target1 ${target1} ${isSell ? '>=' : '<='} entry ${basePrice} → null (invalid, signal=${signal})`,
      );
    } else {
      adjustments.push(`target1 null (signal=${signal})`);
    }
    target1 = null;
    adjusted = true;
  }

  // ─── target2 ───
  // BUY:  target2 > target1 (أبعد من الهدف الأول — أعلى سعر)
  // SELL: target2 < target1 (أبعد من الهدف الأول — أقل سعر)
  // Note: target1 guaranteed non-null here — either the original validated
  // value or the fallback assigned above.
  let target2 = num(input.target2);
  const target2Invalid = isSell
    ? (target2 == null || target2 >= target1!)
    : (target2 == null || target2 <= target1!);
  if (target2Invalid) {
    // P0-FIX (Rule 27): null بتفضل null — لا fabrication.
    if (target2 != null) {
      adjustments.push(
        `target2 ${target2} ${isSell ? '>=' : '<='} target1 ${target1} → null (invalid, signal=${signal})`,
      );
    } else {
      adjustments.push(`target2 null (signal=${signal})`);
    }
    target2 = null;
    adjusted = true;
  }

  // ─── target3 (optional) ───
  // BUY:  target3 > target2
  // SELL: target3 < target2
  // Note: target2 guaranteed non-null here (same reason as target1).
  let target3 = num(input.target3);
  if (target3 != null) {
    const target3Invalid = isSell ? (target3 >= target2!) : (target3 <= target2!);
    if (target3Invalid) {
      // P0-FIX (Rule 27): null بتفضل null — لا fabrication.
      adjustments.push(
        `target3 ${target3} ${isSell ? '>=' : '<='} target2 ${target2} → null (invalid, signal=${signal})`,
      );
      target3 = null;
      adjusted = true;
    }
  }

  // ─── risk_reward_ratio ───
  // Direction-aware: RR = |target1 - entry| / |entry - stop_loss|
  // ده بـ يـ yield RR > 0 for both BUY and SELL (مش signed).
  // الـ formulas:
  //   BUY:  (target1 - entry) / (entry - stop_loss)
  //   SELL: (entry - target1) / (stop_loss - entry)
  // والاتنين بـ يساوي |target1 - entry| / |entry - stop_loss|.
  // Note: stop_loss and target1 guaranteed non-null here (fallbacks applied above).
  let rr = num(input.risk_reward_ratio);
  const riskDist = Math.abs(basePrice - stop_loss!);
  const rewardDist = Math.abs(target1! - basePrice);
  const calculatedRR = riskDist > 0 ? rewardDist / riskDist : NaN;
  if (!isFinite(calculatedRR) || calculatedRR <= 0 || rr == null || rr <= 0) {
    // P0-FIX (Rule 27): null بتفضل null — لا fabrication بـ 1.5.
    // لو target1 أو stop_loss null (من الـ fix فوق) → calculatedRR NaN → rr = null.
    const fallback = isFinite(calculatedRR) && calculatedRR > 0
      ? Number(calculatedRR.toFixed(2))
      : null;
    if (rr != null) {
      adjustments.push(`RR ${rr} invalid → ${fallback ?? 'null'} (signal=${signal})`);
    } else {
      adjustments.push(`RR null → ${fallback ?? 'null'} (signal=${signal})`);
    }
    rr = fallback;
    adjusted = true;
  }

  return {
    signal,
    entry_price: entry,
    current_price: current,
    target1,
    target2,
    target3,
    stop_loss,
    risk_reward_ratio: rr,
    adjusted,
    adjustments,
  };
}

/**
 * validateTargetsArray — يتأكد من targets array كامل (لكل سهم في قائمة).
 */
export function validateTargetsArray<T extends TradeTargets>(items: T[]): (T & { _targets_validated?: ValidatedTargets })[] {
  return items.map((item) => {
    const validated = validateTargets(item);
    return { ...item, _targets_validated: validated };
  });
}

/**
 * applyValidatedTargets — بياخد object ويرجّعه مع الـ targets المصحّحة.
 * بيستخدم في الـ APIs قبل ما ترجّع الـ response.
 *
 * Returns T & ValidatedTargets (intersection) so callers can access both the
 * original extra fields AND the validated fields (signal, entry_price, ...,
 * adjusted, adjustments) without type errors.
 *
 * FIX-P4 (?? leak): ما بـ نعملش `v.X ?? item.X` fallback للقيمة الأصلية المكسورة.
 *   الـ validator بـ يرجّع null فقط لو مفيش entry ولا current خالص — وفي الحالة دي
 *   القيمة الأصلية في `item` أكيد مكسورة برضو (0 / null / NaN). فـ الأفضل نـ propagate
 *   null علشان الـ consumer يـ يعرف إن مفيش بيانات صالحة.
 */
export function applyValidatedTargets<T extends TradeTargets>(
  item: T,
): T & ValidatedTargets {
  const v = validateTargets(item);
  return {
    ...item,
    signal: v.signal,
    entry_price: v.entry_price,
    current_price: v.current_price,
    target1: v.target1,
    target2: v.target2,
    target3: v.target3,
    stop_loss: v.stop_loss,
    risk_reward_ratio: v.risk_reward_ratio,
    adjusted: v.adjusted,
    adjustments: v.adjustments,
  };
}

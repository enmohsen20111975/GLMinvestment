/**
 * FRONTEND-026: أدوات كشف اتجاه الإشارة — مشتركة بين كل المكونات.
 *
 * العقل (الباك إند) بيبعت إشارات متنوعة:
 *   بيع:  SELL, STRONG_SELL, REDUCE, WEAK_SELL, BEARISH, SHORT, UNDERWEIGHT
 *   شراء: BUY, STRONG_BUY, ACCUMULATE, WEAK_BUY, BULLISH, LONG, OVERWEIGHT
 *   محايد: HOLD, NEUTRAL
 *
 * المشكلة القديمة: كان الكود بيكشف SELL بس لو التسمية بالظبط 'SELL' أو 'STRONG_SELL'.
 * فالإشارة REDUCE (اللي هي بيع فعلي) كانت بتقع في فرع الشراء، والـ BUY fallback
 * كان بيلغي قيم العقل الصحيحة (target تحت + stop فوق) ويحط قيم شراء معكوسة!
 *
 * الحل: نكشف بالتسمية الأول، ولو محايدة/ناقصة نكشف بالقيم:
 *   target < entry && stop > entry  → بيع
 *   target > entry && stop < entry  → شراء
 * افتراضي: شراء (نفس السلوك القديم).
 */

export type SignalLike = string | number | undefined | null;

/**
 * يكتشف هل الإشارة "بيع" (SHORT/SELL-side) بناءً على التسمية أو القيم.
 *
 * @param signal      قيمة الإشارة من الباك إند (مثل 'SELL', 'REDUCE', 'HOLD'...)
 * @param targetPrice سعر الهدف (لو > 0 بيستخدم للكشف بالقيم)
 * @param stopLoss    سعر وقف الخسارة (لو > 0 بيستخدم للكشف بالقيم)
 * @param entryPrice  سعر الدخول (لو > 0 بيستخدم للكشف بالقيم)
 * @returns true لو الإشارة بيع، false لو شراء (افتراضي)
 */
export function detectIsSellSignal(
  signal: SignalLike,
  targetPrice: number,
  stopLoss: number,
  entryPrice: number
): boolean {
  const sig = String(signal ?? '').toUpperCase().trim();

  // 1) كشف بالتسمية — بيع
  if (
    sig === 'SELL' ||
    sig === 'STRONG_SELL' ||
    sig === 'REDUCE' ||
    sig === 'WEAK_SELL' ||
    sig === 'BEARISH' ||
    sig === 'SHORT' ||
    sig === 'UNDERWEIGHT'
  ) {
    return true;
  }

  // 1ب) كشف بالتسمية — شراء
  if (
    sig === 'BUY' ||
    sig === 'STRONG_BUY' ||
    sig === 'ACCUMULATE' ||
    sig === 'WEAK_BUY' ||
    sig === 'BULLISH' ||
    sig === 'LONG' ||
    sig === 'OVERWEIGHT'
  ) {
    return false;
  }

  // 2) كشف بالقيم (لما التسمية محايدة/ناقصة/HOLD)
  if (entryPrice > 0 && targetPrice > 0 && stopLoss > 0) {
    if (targetPrice < entryPrice && stopLoss > entryPrice) return true;  // إعدادات بيع
    if (targetPrice > entryPrice && stopLoss < entryPrice) return false; // إعدادات شراء
  }

  // 3) افتراضي: شراء
  return false;
}

/**
 * قائمة كاملة بإشارات البيع (للاستخدام في UI/filters).
 */
export const SELL_SIGNALS: readonly string[] = [
  'SELL',
  'STRONG_SELL',
  'REDUCE',
  'WEAK_SELL',
  'BEARISH',
  'SHORT',
  'UNDERWEIGHT',
] as const;

/**
 * قائمة كاملة بإشارات الشراء (للاستخدام في UI/filters).
 */
export const BUY_SIGNALS: readonly string[] = [
  'BUY',
  'STRONG_BUY',
  'ACCUMULATE',
  'WEAK_BUY',
  'BULLISH',
  'LONG',
  'OVERWEIGHT',
] as const;

/**
 * يتحقق هل الإشارة من نوع بيع (مطابقة مباشرة بالتسمية، بدون كشف بالقيم).
 * أسرع للاستخدام في الـ filters والـ icons.
 */
export function isSellSignalLabel(signal: SignalLike): boolean {
  const sig = String(signal ?? '').toUpperCase().trim();
  return SELL_SIGNALS.includes(sig);
}

/**
 * يتحقق هل الإشارة من نوع شراء (مطابقة مباشرة بالتسمية، بدون كشف بالقيم).
 * أسرع للاستخدام في الـ filters والـ icons.
 */
export function isBuySignalLabel(signal: SignalLike): boolean {
  const sig = String(signal ?? '').toUpperCase().trim();
  return BUY_SIGNALS.includes(sig);
}

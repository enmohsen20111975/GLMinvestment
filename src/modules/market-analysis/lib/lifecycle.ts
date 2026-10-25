/**
 * modules/market-analysis/lib/lifecycle.ts
 * ============================================================================
 * P0-COMPONENT-UNIFICATION (Phase 0.4): Canonical getLifecycle() helper.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه implementation واحد في eid-predictions-widget.tsx:92
 * و واحد في helpers.ts (الـ getPrevLifecycle). الاتنين بـ يعملوا نفس الشيء
 * بس بـ types مختلفة. كده هنا = single source of truth.
 *
 * lifecycle_status معـمول بـ يكون مستقل عن status الرسمية (دستور §606-641):
 *   - 'testing'  → التوقع جديد + بـ يتـ validate قبل الترقية لـ proven.
 *   - 'proven'   → التوقع اتعمل له validate + اتـثبت + بقى active.
 *   - 'closed'   → التوقع خلص (TARGET_HIT / STOPPED / EXPIRED / TRAILING_PROFIT).
 *
 * Migration (Phase 2): كل الأماكن اللي بـ تستخدم getLifecycle / getPrevLifecycle
 * هـ تـستورد من هنا. الـ exports بتوعهم دلوقتي aliases للـ backward compat.
 * ============================================================================
 */

export type LifecyclePhase = 'proven' | 'testing' | 'closed';

/**
 * أي كائن فيه lifecycle_status + status — بـ نـستخدم structural typing عشان
 * الكود بـ يـقبل أي shape (Prediction, PreviousPrediction, أو أي نوع).
 */
export interface HasLifecycle {
  lifecycle_status?: string | null;
  status?: string | null;
}

/**
 * بيرجّع lifecycle_status مع backward-compat inference من status الرسمية.
 *
 * القاعدة:
 * 1. لو lifecycle_status موجود + قيمته testing/proven/closed → بـ يـرجّعه.
 * 2. لو null/undefined → بـ يـ infer من status الرسمية:
 *    - TARGET_HIT / STOPPED / EXPIRED / TRAILING_PROFIT → 'closed'
 *    - ACTIVE / PENDING / WAITING → 'proven'
 * 3. لو status برضو مش موجود → 'proven' (default — آمن للـ new predictions).
 *
 * @example
 * getLifecycle({ lifecycle_status: 'testing' })           // → 'testing'
 * getLifecycle({ lifecycle_status: null, status: 'TARGET_HIT' }) // → 'closed'
 * getLifecycle({})                                       // → 'proven'
 */
export function getLifecycle<T extends HasLifecycle>(pred: T): LifecyclePhase {
  // (1) lifecycle_status موجود + صحيح
  if (pred.lifecycle_status) {
    const ls = String(pred.lifecycle_status).toLowerCase();
    if (ls === 'testing' || ls === 'proven' || ls === 'closed') {
      return ls as LifecyclePhase;
    }
  }
  // (2) infer من status الرسمية
  if (pred.status) {
    const s = String(pred.status).toUpperCase();
    if (['TARGET_HIT', 'STOPPED', 'EXPIRED', 'TRAILING_PROFIT'].includes(s)) return 'closed';
    if (['ACTIVE', 'PENDING', 'WAITING'].includes(s)) return 'proven';
  }
  // (3) default آمن للـ new predictions (اللي مفيهاش status لسه)
  return 'proven';
}

/**
 * Alias للـ backward compat مع الـ helper اللي كان في helpers.ts.
 * نـ preferred getLifecycle بس — ده alias بـ يحافظ على الـ API القديم.
 *
 * @deprecated استخدم `getLifecycle` بدل ده.
 */
export const getPrevLifecycle = getLifecycle;

/**
 * Arabic labels لكل lifecycle phase (للـ LifecycleBadge component).
 */
export const LIFECYCLE_LABELS_AR: Record<LifecyclePhase, string> = {
  proven: 'توقع أساسي',
  testing: 'تحت الاختبار',
  closed: 'منتهي',
};

/**
 * Arabic descriptions لكل lifecycle phase (للـ tooltips + empty states).
 */
export const LIFECYCLE_DESCRIPTIONS_AR: Record<LifecyclePhase, string> = {
  proven: 'توقع متـثبت وفعّال — تم التحقق من الإشارة والنتيجة.',
  testing: 'فرصة جديدة بتتـvalidate — لو ثبتت تنتقل للتوقعات الأساسية.',
  closed: 'التوقع خلص — إما ضرب الهدف أو وقف الخسارة أو انتهى الوقت.',
};

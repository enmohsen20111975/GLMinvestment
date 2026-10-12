import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

// ============================================================================
// Task ID: TITAN-2-BACKTEST-API
// Agent: مهندس واجهات Next.js (فريق GLM 5.2-Bravo)
//
// مسار API لعرض نتائج الباك-تيست المؤسسي (Institutional Backtest).
//
// 🔒 Rule 20 (PYTHON = BRAIN): هذا المسار يقرأ فقط JSON المُنتَج بواسطة
//    `scripts/institutional_multi_market_backtest.py`. لا تتم هنا أي حسابات مالية
//    إطلاقًا. الـ Python هو العقل الحاسوب، والـ API هو طبقة العرض فقط.
//
// 🔒 Rule 27 (NO-FAKE-DATA): لا يتم اختلاق أي بيانات. إذا كان الـ JSON ناقصًا
//    أو غير موجود، يتم إرجاع `null` أو خطأ واضح — وليس قيمًا مزيّفة.
// ============================================================================

// الكاش يُلغى كل 5 دقائق (300 ثانية). عند إعادة توليد الـ JSON من Python،
// سيقوم Next.js بإعادة الجلب في الطلب التالي بعد انتهاء نافذة الكاش.
export const revalidate = 300;

// `force-dynamic` لأن محتوى الـ JSON يتغير عند إعادة تشغيل الـ backtest
// (لو اعتمدنا على static generation ستُخزّن نسخة قديمة من الـ report).
export const dynamic = 'force-dynamic';

// المسار الثابت لملف تقرير الباك-تيست المُنتَج من الوكيل 1 (Python brain).
const REPORT_PATH = path.join(
  process.cwd(),
  'db',
  'reports',
  'institutional_backtest_summary.json',
);

/**
 * GET /api/maker-radar/institutional-backtest
 *
 * يعيد تقرير الباك-تيست المؤسسي كاملًا كما أنتجه الـ Python script.
 * الـ response shape:
 *   {
 *     success: true,
 *     data: { ... report fields ... },
 *     cached_at: string (ISO),
 *     disclaimer: string
 *   }
 *
 * حالات الخطأ (Defensive):
 *   - 404: الـ JSON غير موجود → backtest_not_run (+ hint بتشغيل الـ Python script)
 *   - 500: الـ JSON تالف (parse error) → backtest_report_corrupted
 *   - 500: أي خطأ داخلي آخر → internal_error
 */
export async function GET() {
  try {
    // ── 1) قراءة الملف من القرص (async — لا sync I/O) ──────────────────────
    let raw: string;
    try {
      raw = await readFile(REPORT_PATH, 'utf-8');
    } catch {
      // الملف غير موجود بعد — هذا متوقع لأن الوكيل 1 يعمل بالتوازي.
      // نُرجع 404 مع hint واضح للمدير/المستخدم.
      return NextResponse.json(
        {
          success: false,
          error: 'backtest_not_run',
          hint: 'Run python3 scripts/institutional_multi_market_backtest.py first',
        },
        { status: 404 },
      );
    }

    // ── 2) Parse الـ JSON (الـ parsed dynamic — استخدام `any` مقبول هنا) ────
    let report: any;
    try {
      report = JSON.parse(raw);
    } catch {
      // الـ JSON تالف (مثلًا انقطع الكتابة أثناء تشغيل الـ backtest).
      // نُرجع 500 مع hint بإعادة التشغيل.
      return NextResponse.json(
        {
          success: false,
          error: 'backtest_report_corrupted',
          hint: 'Re-run python3 scripts/institutional_multi_market_backtest.py',
        },
        { status: 500 },
      );
    }

    // ── 3) إرجاع الـ report كما هو + metadata للكاش ─────────────────────────
    // ملاحظة: لا نُعيد ترتيب أو تنقية الحقول هنا — الـ Python يملك الحقيقة
    // الكاملة (Rule 20). الـ API شفاف تمامًا. لو نقص حقل في الـ JSON،
    // يصل للمستخدم كما هو (null/undefined) — Rule 27.
    return NextResponse.json({
      success: true,
      data: report,
      cached_at: new Date().toISOString(),
      // الـ disclaimer يُؤخَذ من الـ JSON إن وُجد، وإلا fallback إلى نص Rule 27.
      disclaimer:
        report.disclaimer ||
        'Rule 27 (NO-FAKE-DATA): metrics from real price data only.',
    });
  } catch (error: any) {
    // خطأ غير متوقع (مثلًا مشكلة في filesystem). نسجّل للـ logs ونُرجع 500 عام.
    console.error('[institutional-backtest] error:', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

/**
 * DISABLED (2026-09-02) — Owner directive:
 * "زرار توليد توقعات ده معناه إننا بنعمل توقعات عشوائية الغيه خالص"
 *
 * التوقعات بـ تتولّد تلقائياً من V40.2 (cron job) — مش محتاجين تدخل يدوي.
 * الـ endpoint ده كان بـ يشغل scripts بـ BYPASS_PRED_CAP=1 بدون context كافي،
 * فكانت بتـ produce توقعات عشوائية مش مبنية على التحليل الكامل.
 *
 * الإنتاج الحقيقي للتوقعات بـ يحصل عن طريق:
 * - cron job بيـشغل daily_predictor.py يومياً
 * - MarketScheduler.tick (كل 60s) في Python backend
 * - daily_closer.py (كل 15 دقيقة) لقفل الصفقات
 *
 * أي تشغيل يدوي للـ V40.2 لازم يكون عن طريق SSH مباشرة على الـ VPS.
 */
export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  return NextResponse.json(
    {
      success: false,
      error: 'endpoint_disabled',
      error_ar: 'تم إيقاف هذا الـ endpoint — التوقعات بتتولّد تلقائياً (cron job). أي تشغيل يدوي لازم يكون عن طريق SSH على الـ VPS.',
      disabled_at: '2026-09-02',
      reason: 'توليد توقعات عشوائية بدون context كافي',
    },
    { status: 410 } // 410 Gone
  );
}

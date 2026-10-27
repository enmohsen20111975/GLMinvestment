/**
 * Honest Prediction Tracking — Root
 * ===================================
 * نقطة دخول موحّدة لتتبّع التوقعات الحقيقية.
 * يرجع قائمة بالـ endpoints المتاحة + ملخّص سريع.
 *
 * (ALPHA-DAL-WAVE2 — owner directive 2026-10-27):
 * «إزالة استدعاء new Database(...) نهائياً. البديل: استخدام دوال DbManager المناسبة (openDb).»
 * المسار ده دلوقتي thin wrapper — كل الـ DB access بيحصل جوه DbManager.openDb.
 */

import { NextResponse } from 'next/server';
import { openDb } from '@/lib/db-manager';

export const dynamic = 'force-dynamic';

export async function GET() {
  // (ALPHA-DAL-WAVE2): استخدم openDb من الـ DAL — ممنوع new Database().
  const db = openDb('predictions.db');
  if (!db) {
    return NextResponse.json({
      success: false,
      error: 'predictions_db_unavailable',
      message: 'قاعدة بيانات التوقعات غير متاحة حاليًا',
    }, { status: 200 }); // graceful 200 (not 500) per fallback policy
  }

  try {
    // LIFECYCLE-MIGRATION: wins/losses now derived from outcome detail
    // columns (`hit_target` / `hit_stop`) instead of the legacy `status`
    // string. Pending (open) uses `lifecycle_status = 'proven'` (the new
    // canonical "active" lifecycle value).
    const summary = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN hit_stop = 1 THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN lifecycle_status = 'proven' THEN 1 ELSE 0 END) as pending
      FROM predictions
    `).get() as any;

    let lessonsCount = { count: 0 };
    try {
      lessonsCount = db.prepare('SELECT COUNT(*) as count FROM prediction_lessons').get() as any;
    } catch {
      // table may not exist — default to 0
    }

    const closed = (summary.wins || 0) + (summary.losses || 0);
    const winRate = closed > 0 ? Math.round((summary.wins / closed) * 1000) / 10 : 0;

    db.close();

    return NextResponse.json({
      success: true,
      summary: {
        total_predictions: summary.total || 0,
        wins: summary.wins || 0,
        losses: summary.losses || 0,
        pending: summary.pending || 0,
        real_win_rate: winRate,
        lessons_learned: lessonsCount.count || 0,
      },
      endpoints: {
        stats: '/api/predictions/honest-tracking/stats — إحصائيات مفصّلة حسب السوق والإشارة والأنماط',
        list: '/api/predictions/honest-tracking/list — قائمة التوقعات مع كل التفاصيل (فلترة + ترتيب)',
        verify_pending: 'POST /api/predictions/honest-tracking/verify-pending — تحقق من التوقعات المعلقة',
        learn_from_errors: 'POST /api/predictions/honest-tracking/learn-from-errors — استخراج الدروس من الأخطاء',
        missed_opportunities: 'GET /api/predictions/honest-tracking/missed-opportunities — 🔴 الفرص الضائعة + التوقعات الغلط (نظرة المحلل الخبير)',
      },
      note: '✅ نظام تتبّع حقيقي — كل البيانات من predictions table مع التحقق من الأسعار الفعلية',
    });
  } catch (error) {
    console.error('[predictions:honest-tracking]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  } finally {
    try { db.close(); } catch { /* noop */ }
  }
}

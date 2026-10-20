/**
 * Honest Prediction Tracking — Root
 * ===================================
 * نقطة دخول موحّدة لتتبّع التوقعات الحقيقية.
 * يرجع قائمة بالـ endpoints المتاحة + ملخّص سريع.
 */

import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, timeout: 3000 });
  } catch {
    db = new Database(`file:${dbPath}?immutable=1`, { timeout: 3000 });
  }

  try {
    const summary = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending
      FROM predictions
    `).get() as any;

    const lessonsCount = db.prepare('SELECT COUNT(*) as count FROM prediction_lessons').get() as any;

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
    db.close();
    console.error('[predictions:honest-tracking]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

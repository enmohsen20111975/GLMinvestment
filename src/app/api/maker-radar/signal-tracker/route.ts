import { NextRequest, NextResponse } from 'next/server';
import { openTrackerDb, translateSignalType } from '@/modules/radar/lib/radar-signal-tracker';

export const dynamic = 'force-dynamic';

/**
 * الحالات المعتبَرة "مُتحقَّق منها" (verified) فعلاً.
 * Rule 27 (NO-FAKE-DATA): نستثني `pending` و`stale_data` صراحةً من المقام.
 */
const VERIFIED_STATUSES_SQL = "('verified_win', 'verified_loss', 'verified_neutral')";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  const signalTypeFilter = url.searchParams.get('signal_type');

  const db = openTrackerDb();
  if (!db) return NextResponse.json({ success: false, error: 'Cannot open tracker DB' }, { status: 503 });

  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM radar_signal_tracking').get() as any;
    const pending = db.prepare("SELECT COUNT(*) as c FROM radar_signal_tracking WHERE status = 'pending'").get() as any;

    // FIX: استعلام `verified` الصحيح — يستثني `pending` و `stale_data` و أي حالة غير نهائية.
    const verified = db.prepare(
      `SELECT COUNT(*) as c FROM radar_signal_tracking WHERE status IN ${VERIFIED_STATUSES_SQL}`,
    ).get() as any;
    const wins = db.prepare("SELECT COUNT(*) as c FROM radar_signal_tracking WHERE status = 'verified_win'").get() as any;

    // متوسطات العوائد الحقيقية (Rule 27): نحسب AVG فقط على الصفوف اللي عندها outcome فعلية.
    // لو مفيش بيانات → null (مش hardcoded).
    const avgReturns = db.prepare(`
      SELECT
        AVG(outcome_7d)  as avg_7d,
        AVG(outcome_14d) as avg_14d,
        AVG(outcome_30d) as avg_30d
      FROM radar_signal_tracking
      WHERE outcome_7d IS NOT NULL OR outcome_14d IS NOT NULL OR outcome_30d IS NOT NULL
    `).get() as any;

    // تجميع حسب نوع الإشارة مع متوسطات العوائد الحقيقية وعدّاد verified دقيق.
    const byType = db.prepare(`
      SELECT signal_type,
        COUNT(*) as total,
        SUM(CASE WHEN status IN ${VERIFIED_STATUSES_SQL} THEN 1 ELSE 0 END) as verified_count,
        SUM(CASE WHEN status = 'verified_win' THEN 1 ELSE 0 END) as wins,
        AVG(outcome_7d)  as avg_7d,
        AVG(outcome_14d) as avg_14d,
        AVG(outcome_30d) as avg_30d
      FROM radar_signal_tracking
      GROUP BY signal_type
      ORDER BY total DESC
    `).all() as any[];

    const recent = db.prepare(
      "SELECT ticker, signal_date, signal_type, entry_price, outcome_30d, status FROM radar_signal_tracking ORDER BY id DESC LIMIT 5",
    ).all() as any[];

    db.close();

    const verifiedCount = verified?.c || 0;
    const winsCount = wins?.c || 0;
    // لو مفيش verified signals → win_rate_pct = 0 (مش NaN و مش 0.0% مضلل).
    const winRateOverall = verifiedCount > 0 ? (winsCount / verifiedCount * 100) : 0;

    return NextResponse.json({
      success: true, window_days: days,
      total_signals: total?.c || 0,
      pending: pending?.c || 0,
      verified: verifiedCount,
      win_rate_pct: winRateOverall,
      // Rule 27: متوسطات حقيقية من قاعدة البيانات (null لو مفيش بيانات).
      avg_outcome_7d:  avgReturns?.avg_7d  ?? null,
      avg_outcome_14d: avgReturns?.avg_14d ?? null,
      avg_outcome_30d: avgReturns?.avg_30d ?? null,
      by_signal_type: byType.map(t => {
        const vCount = Number(t.verified_count) || 0;
        return {
          signal_type: t.signal_type,
          // تعريب مسميات الإشارات (مش أكواد خام A_pre_surge ...).
          label: translateSignalType(t.signal_type),
          total: t.total,
          verified: vCount,
          wins: t.wins,
          win_rate_pct: vCount > 0 ? (t.wins / vCount * 100) : 0,
          avg_outcome_7d:  t.avg_7d  ?? null,
          avg_outcome_14d: t.avg_14d ?? null,
          avg_outcome_30d: t.avg_30d ?? null,
        };
      }),
      recent_signals: recent,
      computed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[maker-radar:signal-tracker]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

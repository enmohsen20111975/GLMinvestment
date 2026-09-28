import { NextRequest, NextResponse } from 'next/server';
import { openTrackerDb } from '@/modules/radar/lib/radar-signal-tracker';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  const signalTypeFilter = url.searchParams.get('signal_type');

  const db = openTrackerDb();
  if (!db) return NextResponse.json({ success: false, error: 'Cannot open tracker DB' }, { status: 503 });

  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM radar_signal_tracking').get() as any;
    const pending = db.prepare("SELECT COUNT(*) as c FROM radar_signal_tracking WHERE status = 'pending'").get() as any;
    const verified = db.prepare("SELECT COUNT(*) as c FROM radar_signal_tracking WHERE status != 'pending'").get() as any;
    const wins = db.prepare("SELECT COUNT(*) as c FROM radar_signal_tracking WHERE status = 'verified_win'").get() as any;

    const byType = db.prepare("SELECT signal_type, COUNT(*) as total, SUM(CASE WHEN status='verified_win' THEN 1 ELSE 0 END) as wins FROM radar_signal_tracking GROUP BY signal_type").all() as any[];
    const recent = db.prepare("SELECT ticker, signal_date, signal_type, entry_price, outcome_30d, status FROM radar_signal_tracking ORDER BY id DESC LIMIT 5").all() as any[];

    db.close();

    return NextResponse.json({
      success: true, window_days: days,
      total_signals: total?.c || 0, pending: pending?.c || 0, verified: verified?.c || 0,
      win_rate_pct: verified?.c > 0 ? ((wins?.c || 0) / verified.c * 100) : 0,
      avg_outcome_7d: null, avg_outcome_14d: null, avg_outcome_30d: null,
      by_signal_type: byType.map(t => ({
        signal_type: t.signal_type, label: t.signal_type, total: t.total, verified: t.total,
        wins: t.wins, win_rate_pct: t.total > 0 ? (t.wins / t.total * 100) : 0,
        avg_outcome_7d: null, avg_outcome_14d: null, avg_outcome_30d: null,
      })),
      recent_signals: recent,
      computed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

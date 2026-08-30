import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'db', 'predictions.db');

interface TomorrowPrediction {
  id: number;
  ticker: string;
  name: string;
  market: string;
  signal: string;
  signal_type: string;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  master_score: number | null;
  technical_score: number | null;
  confidence: number | null;
  r_multiple: number | null;
  risk_reward_ratio: number | null;
  prediction_date: string;
  target_date: string | null;
  session_date: string;
  status: string;
  reason: string | null;
  indicators_json: string | null;
  created_at: string;
}

interface WatchlistItem {
  id: number;
  ticker: string;
  name: string;
  market: string;
  watch_type: string;
  watch_reason: string;
  current_price: number;
  change_percent: number;
  volume: number;
  volume_surge: number;
  rsi: number | null;
  ma_50: number | null;
  distance_from_ma50: number | null;
  near_52w_high: number | null;
  near_52w_low: number | null;
  session_date: string;
  priority: string;
  created_at: string;
}

interface ActiveStatus {
  id: number;
  ticker: string;
  name: string;
  market: string;
  original_signal: string;
  original_entry_price: number;
  original_target_price: number | null;
  original_stop_loss: number | null;
  original_prediction_date: string;
  current_price: number;
  current_change_percent: number;
  highest_price_reached: number | null;
  lowest_price_reached: number | null;
  progress_percent: number;
  distance_to_target: number;
  distance_to_stop: number;
  status: string;
  expected_action: string;
  session_date: string;
  created_at: string;
}

/**
 * GET /api/tomorrow-predictions
 *
 * بيرجع 3 أجزاء:
 * 1. predictions: توقعات الغد (شراء/بيع)
 * 2. active_status: حالة الأسهم النشطة (وصلت لفين)
 * 3. watchlist: أسهم تحت المراقبة (التغيرات)
 *
 * Query params:
 *  - session_date: تاريخ الجلسة (default: أحدث)
 *  - market: EGX | CRYPTO | all (default: all)
 *  - part: predictions | active_status | watchlist | all (default: all)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const marketFilter = searchParams.get('market') || 'all';
    const part = searchParams.get('part') || 'all';
    const sessionDate = searchParams.get('session_date');

    const db = new Database(DB_PATH, { readonly: true });

    // لو مفيش session_date محدد، نجيب أحدث واحد
    let targetSessionDate = sessionDate;
    if (!targetSessionDate) {
      const latest = db
        .prepare(
          'SELECT MAX(session_date) as latest FROM tomorrow_predictions'
        )
        .get() as { latest: string | null };
      targetSessionDate = latest?.latest || new Date().toISOString().slice(0, 10);
    }

    // ── الجزء 1: التوقعات ─────────────────────────────────────────────
    let predictions: TomorrowPrediction[] = [];
    if (part === 'all' || part === 'predictions') {
      let query = 'SELECT * FROM tomorrow_predictions WHERE session_date = ?';
      const params: (string | number)[] = [targetSessionDate];
      if (marketFilter !== 'all') {
        query += ' AND market = ?';
        params.push(marketFilter);
      }
      query += ' ORDER BY confidence DESC, master_score DESC';
      try {
        predictions = db.prepare(query).all(...params) as TomorrowPrediction[];
      } catch (e) {
        // table مش موجودة
        predictions = [];
      }
    }

    // ── الجزء 2: حالة الأسهم النشطة ───────────────────────────────────
    let activeStatus: ActiveStatus[] = [];
    if (part === 'all' || part === 'active_status') {
      let query = 'SELECT * FROM tomorrow_active_status WHERE session_date = ?';
      const params: (string | number)[] = [targetSessionDate];
      if (marketFilter !== 'all') {
        query += ' AND market = ?';
        params.push(marketFilter);
      }
      query += ' ORDER BY progress_percent DESC';
      try {
        activeStatus = db.prepare(query).all(...params) as ActiveStatus[];
      } catch (e) {
        activeStatus = [];
      }
    }

    // ── الجزء 3: أسهم تحت المراقبة ────────────────────────────────────
    let watchlist: WatchlistItem[] = [];
    if (part === 'all' || part === 'watchlist') {
      let query = 'SELECT * FROM tomorrow_watchlist WHERE session_date = ?';
      const params: (string | number)[] = [targetSessionDate];
      if (marketFilter !== 'all') {
        query += ' AND market = ?';
        params.push(marketFilter);
      }
      const priorityOrder: Record<string, number> = {
        HIGH: 0,
        MEDIUM: 1,
        LOW: 2,
      };
      try {
        const raw = db
          .prepare(query)
          .all(...params) as WatchlistItem[];
        watchlist = raw.sort((a, b) => {
          const pa = priorityOrder[a.priority] ?? 3;
          const pb = priorityOrder[b.priority] ?? 3;
          return pa - pb;
        });
      } catch (e) {
        watchlist = [];
      }
    }

    db.close();

    // إحصائيات
    const stats = {
      predictions_count: predictions.length,
      buy_signals: predictions.filter((p) =>
        ['BUY', 'STRONG_BUY'].includes(p.signal)
      ).length,
      sell_signals: predictions.filter((p) =>
        ['SELL', 'STRONG_SELL'].includes(p.signal)
      ).length,
      active_status_count: activeStatus.length,
      target_hit: activeStatus.filter((s) => s.status === 'TARGET_HIT').length,
      near_target: activeStatus.filter((s) => s.status === 'NEAR_TARGET').length,
      danger: activeStatus.filter((s) => s.status === 'DANGER').length,
      watchlist_count: watchlist.length,
      high_priority: watchlist.filter((w) => w.priority === 'HIGH').length,
      session_date: targetSessionDate,
    };

    return NextResponse.json({
      success: true,
      session_date: targetSessionDate,
      stats,
      predictions,
      active_status: activeStatus,
      watchlist,
    });
  } catch (e) {
    console.error('[api/tomorrow-predictions] error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        predictions: [],
        active_status: [],
        watchlist: [],
      },
      { status: 500 }
    );
  }
}

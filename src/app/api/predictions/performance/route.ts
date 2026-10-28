/**
 * GET /api/predictions/performance
 * =================================
 * Aggregated performance metrics for AI predictions (Flutter Android app).
 *
 * Reads from `db/predictions.db` → table `predictions` (see
 * prisma/predictions-schema.prisma for the full column list). Returns:
 *   - total count
 *   - hit rate % (target_hit + stop_hit resolved)
 *   - avg return % (actual_return column)
 *   - by-ticker breakdown (top N by count)
 *   - by-signal distribution
 *
 * Auth: required. Uses getSessionUserId() from @/lib/auth-helper. Returns 401
 * if no userId (without auth the Android client gets the proper "login
 * required" status instead of a 404).
 *
 * Query params:
 *   ?market=EGX   — optional market filter (column: market)
 *   ?limit=N      — by-ticker limit (default 20)
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { openDb } from '@/lib/db-manager';
import { getSessionUserId } from '@/lib/auth-helper';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'مطلوب تسجيل الدخول',
      error_en: 'Authentication required',
    },
    { status: 401 }
  );
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    const { searchParams } = new URL(req.url);
    const market = searchParams.get('market');
    const reqTickerLimit = parseInt(searchParams.get('limit') || '20', 10);
    const tickerLimit =
      Number.isFinite(reqTickerLimit)
        ? Math.min(Math.max(reqTickerLimit, 1), 100)
        : 20;

    const db = openDb('predictions.db');
    if (!db) {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback_empty',
        total: 0,
        message: 'predictions.db غير متاح',
      });
    }

    try {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (market) {
        conditions.push('market = ?');
        params.push(market);
      }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      const overall = db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) AS hit_target_count,
             SUM(CASE WHEN hit_stop = 1 THEN 1 ELSE 0 END) AS hit_stop_count,
             SUM(CASE WHEN hit_target = 0 AND hit_stop = 0 THEN 1 ELSE 0 END) AS pending_count,
             AVG(actual_return) AS avg_return
           FROM predictions ${where}`
        )
        .get(...params) as {
        total: number;
        hit_target_count: number;
        hit_stop_count: number;
        pending_count: number;
        avg_return: number | null;
      };

      const resolved =
        (overall.hit_target_count || 0) + (overall.hit_stop_count || 0);
      const hitRate =
        resolved > 0
          ? ((overall.hit_target_count || 0) / resolved) * 100
          : 0;

      const tickerRows = db
        .prepare(
          `SELECT
             ticker,
             COUNT(*) AS count,
             SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN hit_stop = 1 THEN 1 ELSE 0 END) AS losses,
             AVG(actual_return) AS avg_return
           FROM predictions ${where}
           GROUP BY ticker
           ORDER BY count DESC
           LIMIT ?`
        )
        .all(...params, tickerLimit) as Array<{
        ticker: string;
        count: number;
        wins: number;
        losses: number;
        avg_return: number | null;
      }>;

      const signalRows = db
        .prepare(
          `SELECT
             signal,
             COUNT(*) AS count,
             SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) AS wins,
             AVG(actual_return) AS avg_return
           FROM predictions ${where}
           GROUP BY signal
           ORDER BY count DESC`
        )
        .all(...params) as Array<{
        signal: string;
        count: number;
        wins: number;
        avg_return: number | null;
      }>;

      db.close();

      const by_ticker = tickerRows.map((r) => ({
        ticker: r.ticker,
        total: r.count,
        wins: r.wins,
        losses: r.losses,
        pending: Math.max(0, r.count - r.wins - r.losses),
        hit_rate:
          r.wins + r.losses > 0
            ? Number(((r.wins / (r.wins + r.losses)) * 100).toFixed(2))
            : 0,
        avg_return:
          r.avg_return != null ? Number(r.avg_return.toFixed(2)) : null,
      }));

      const by_signal = signalRows.map((r) => ({
        signal: r.signal,
        total: r.count,
        wins: r.wins,
        hit_rate:
          r.count > 0 ? Number(((r.wins / r.count) * 100).toFixed(2)) : 0,
        avg_return:
          r.avg_return != null ? Number(r.avg_return.toFixed(2)) : null,
      }));

      return NextResponse.json({
        success: true,
        source: 'predictions.db',
        generated_at: new Date().toISOString(),
        filter: { market: market || null },
        summary: {
          total: overall.total || 0,
          resolved,
          hit_target_count: overall.hit_target_count || 0,
          hit_stop_count: overall.hit_stop_count || 0,
          pending_count: overall.pending_count || 0,
          hit_rate_pct: Number(hitRate.toFixed(2)),
          avg_return:
            overall.avg_return != null
              ? Number(overall.avg_return.toFixed(2))
              : null,
        },
        by_ticker,
        by_signal,
      });
    } catch (queryErr) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      console.error('[predictions/performance] query error:', queryErr);
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback_empty',
        total: 0,
        message: 'تعذّر قراءة جدول التوقعات',
      });
    }
  } catch (err) {
    console.error('[predictions/performance] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}

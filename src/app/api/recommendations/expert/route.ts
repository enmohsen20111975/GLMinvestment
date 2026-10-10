/**
 * GET /api/recommendations/expert
 * ================================
 * Expert recommendations for the Flutter Android app.
 *
 * Reads from `db/stocks.db` → table `ExpertRecommendation` (104 rows in
 * production — same table consumed by /api/expert-recommendations). Returns
 * the latest N rows ordered by created_at DESC, mapped to a slim mobile shape.
 *
 * Auth: required (getSessionUserId). 401 if no userId.
 *
 * Query params:
 *   ?limit=N      — default 50, clamped 1..200
 *   ?status=PENDING|CLOSED|ALL — default ALL
 *   ?expert=NAME  — optional LIKE %expert% filter
 *   ?symbol=COMI  — optional exact symbol filter
 *
 * Returns:
 *   {
 *     success, source, total, returned,
 *     recommendations: [{ id, ticker, name_ar, expert_name, action,
 *       entry_price, target_price, stop_loss, status, created_at, ... }]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
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
    const reqLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(reqLimit)
      ? Math.min(Math.max(reqLimit, 1), 200)
      : 50;
    const statusFilter = (searchParams.get('status') || 'ALL').toUpperCase();
    const expert = searchParams.get('expert') || '';
    const symbol = (searchParams.get('symbol') || '').toUpperCase();

    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback_empty',
        total: 0,
        returned: 0,
        recommendations: [],
        message: 'stocks.db غير متاح',
      });
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch { // silent fallback (safe-by-design)
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback_empty',
        total: 0,
        returned: 0,
        recommendations: [],
        message: 'تعذّر فتح stocks.db',
      });
    }

    try {
      const tableRow = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ExpertRecommendation'"
        )
        .get() as { name: string } | undefined;

      if (!tableRow) {
        db.close();
        return NextResponse.json({
          success: true,
          source: 'sqlite_fallback_empty',
          total: 0,
          returned: 0,
          recommendations: [],
          message: 'جدول ExpertRecommendation غير موجود',
        });
      }

      const conditions: string[] = [];
      const params: unknown[] = [];
      if (statusFilter !== 'ALL') {
        conditions.push('UPPER(status) = ?');
        params.push(statusFilter);
      }
      if (expert) {
        conditions.push('expert_name LIKE ?');
        params.push(`%${expert}%`);
      }
      if (symbol) {
        conditions.push('stock_symbol = ?');
        params.push(symbol);
      }
      const where = conditions.length
        ? 'WHERE ' + conditions.join(' AND ')
        : '';

      const rows = db
        .prepare(
          `SELECT id, stock_symbol, stock_name_ar, expert_name, expert_source,
                  action, recommendation_type, entry_price, entry_price_from,
                  entry_price_to, target_price, target_price_2, stop_loss,
                  support_level, resistance_level, expected_profit_min,
                  expected_profit_max, session_date, expected_duration,
                  expected_duration_days, status, final_price,
                  profit_loss_percent, hit_target, hit_stop_loss,
                  notes, recommendation_date, created_at, closed_at
           FROM ExpertRecommendation ${where}
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(...params, limit) as Array<Record<string, unknown>>;

      const totalRow = db
        .prepare(`SELECT COUNT(*) AS c FROM ExpertRecommendation ${where}`)
        .get(...params) as { c: number };

      db.close();

      const recommendations = rows.map((r) => ({
        id: r.id,
        ticker: (r.stock_symbol as string) || '',
        name_ar: r.stock_name_ar || null,
        expert_name: r.expert_name || '',
        expert_source: r.expert_source || null,
        action: r.action || 'BUY',
        recommendation_type: r.recommendation_type || 'detailed',
        entry_price: r.entry_price != null ? Number(r.entry_price) : null,
        entry_price_from:
          r.entry_price_from != null ? Number(r.entry_price_from) : null,
        entry_price_to:
          r.entry_price_to != null ? Number(r.entry_price_to) : null,
        target_price:
          r.target_price != null ? Number(r.target_price) : null,
        target_price_2:
          r.target_price_2 != null ? Number(r.target_price_2) : null,
        stop_loss: r.stop_loss != null ? Number(r.stop_loss) : null,
        support_level:
          r.support_level != null ? Number(r.support_level) : null,
        resistance_level:
          r.resistance_level != null ? Number(r.resistance_level) : null,
        expected_profit_min:
          r.expected_profit_min != null
            ? Number(r.expected_profit_min)
            : null,
        expected_profit_max:
          r.expected_profit_max != null
            ? Number(r.expected_profit_max)
            : null,
        session_date: r.session_date || null,
        expected_duration: r.expected_duration || null,
        expected_duration_days: r.expected_duration_days ?? null,
        status: r.status || 'PENDING',
        final_price: r.final_price != null ? Number(r.final_price) : null,
        profit_loss_percent:
          r.profit_loss_percent != null
            ? Number(r.profit_loss_percent)
            : null,
        hit_target: r.hit_target === 1 || r.hit_target === true,
        hit_stop_loss: r.hit_stop_loss === 1 || r.hit_stop_loss === true,
        notes: r.notes || null,
        recommendation_date: r.recommendation_date || null,
        created_at: r.created_at || null,
        closed_at: r.closed_at || null,
      }));

      return NextResponse.json({
        success: true,
        source: 'stocks.db',
        total: totalRow.c,
        returned: recommendations.length,
        recommendations,
        filter: {
          status: statusFilter,
          expert: expert || null,
          symbol: symbol || null,
          limit,
        },
        generated_at: new Date().toISOString(),
      });
    } catch (queryErr) {
      try {
        db.close();
      } catch { // silent fallback (safe-by-design)
        /* ignore */
      }
      console.error('[recommendations/expert] query error:', queryErr);
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback_empty',
        total: 0,
        returned: 0,
        recommendations: [],
        message: 'تعذّر قراءة جدول توقعات الخبراء',
      });
    }
  } catch (err) {
    console.error('[recommendations/expert] fatal:', err);
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

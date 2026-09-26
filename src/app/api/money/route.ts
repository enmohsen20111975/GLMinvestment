/**
 * Unified Money Management API
 * =============================
 * GET /api/money?section=overview — ملخص شامل
 * GET /api/money?section=portfolio — المحفظة
 * GET /api/money?section=watchlist — قائمة المراقبة
 * GET /api/money?section=alerts — التنبيهات
 * GET /api/money?section=journal — ذاكرة التداول
 *
 * Rule 50 (MONEY-AS-CUSTOMER-LIFE): فلوس العميل = أهم حاجة في حياته.
 * لا يجوز كشف بيانات محفظته لأي طرف غير موثّق. القاعدة السابقة كانت
 * تختار `LIMIT 1 user_id` من portfolio_assets وتعرضه لأي طلب — تسريب بيانات.
 * تم الإصلاح: استخدم getSessionUserId() من @/lib/auth-helper وفشل مغلق عند غياب الـ session.
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';
import { getSessionUserId } from '@/lib/auth-helper';

export const revalidate = 10;

/** Generic SQL row returned by better-sqlite3. */
type SqlRow = Record<string, unknown>;

const EMPTY_DATA = {
  portfolio: { total_assets: 0, total_invested: 0, total_current_value: 0, total_pnl: 0, total_pnl_pct: 0, assets: [] as SqlRow[] },
  watchlist: { count: 0, items: [] as SqlRow[] },
  alerts: { active: 0 },
  journal: { total: 0, open: 0, wins: 0, losses: 0, win_rate: 0 },
  obligations: { count: 0, total_remaining: 0 },
};

export async function GET(request: NextRequest) {
  try {
    // ── Rule 50: AUTHENTICATE FIRST — fail closed if no session ─────────────
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'يجب تسجيل الدخول للوصول إلى بياناتك المالية',
          error_en: 'Authentication required to access your money data',
          data: EMPTY_DATA,
        },
        { status: 401 }
      );
    }

    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const db = new Database(dbPath, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');

    // AUTHENTICATED userId from session — never read another user's data.
    // (Previously this picked `LIMIT 1` user_id from portfolio_assets — a
    //  severe data leak. See Rule 50.)

    const { searchParams } = new URL(request.url);
    const section = searchParams.get('section') || 'overview';

    if (section === 'overview') {
      const portfolio = db.prepare('SELECT * FROM portfolio_assets WHERE user_id = ?').all(userId) as Array<SqlRow>;
      const watchlist = db.prepare(`
        SELECT w.*, s.ticker, s.name, s.current_price, s.change_percent
        FROM user_stock_watchlists w
        LEFT JOIN stocks s ON w.stock_id = s.id
        WHERE w.user_id = ?
      `).all(userId) as Array<SqlRow>;

      let alertsCount = 0;
      try {
        const a = db.prepare('SELECT COUNT(*) as c FROM price_alerts WHERE user_id = ? AND is_active = 1').get(userId) as { c?: number } | undefined;
        alertsCount = a?.c || 0;
      } catch {}

      let journal: { total: number; open: number; wins: number; losses: number } = { total: 0, open: 0, wins: 0, losses: 0 };
      try {
        journal = db.prepare(`
          SELECT COUNT(*) as total,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
            SUM(CASE WHEN status = 'closed' AND result > 0 THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN status = 'closed' AND result <= 0 THEN 1 ELSE 0 END) as losses
          FROM trading_journal WHERE user_id = ?
        `).get(userId) || journal;
      } catch {}

      let totalInvested = 0, totalCurrent = 0;
      for (const a of portfolio) {
        totalInvested += a.total_invested || 0;
        totalCurrent += a.current_value || 0;
      }

      db.close();

      return NextResponse.json({
        success: true,
        data: {
          portfolio: {
            total_assets: portfolio.length,
            total_invested: Math.round(totalInvested * 100) / 100,
            total_current_value: Math.round(totalCurrent * 100) / 100,
            total_pnl: Math.round((totalCurrent - totalInvested) * 100) / 100,
            total_pnl_pct: totalInvested > 0 ? Math.round((totalCurrent - totalInvested) / totalInvested * 10000) / 100 : 0,
            assets: portfolio,
          },
          watchlist: { count: watchlist.length, items: watchlist },
          alerts: { active: alertsCount },
          journal: {
            total: journal.total || 0,
            open: journal.open || 0,
            wins: journal.wins || 0,
            losses: journal.losses || 0,
            win_rate: journal.total > 0 ? Math.round((journal.wins / journal.total) * 100) : 0,
          },
          obligations: { count: 0, total_remaining: 0 },
        },
      });
    }

    if (section === 'portfolio') {
      const assets = db.prepare(`
        SELECT p.*, s.ticker, s.name as stock_name, s.current_price as live_price,
               s.change_percent as live_change
        FROM portfolio_assets p
        LEFT JOIN stocks s ON p.stock_ticker = s.ticker
        WHERE p.user_id = ?
        ORDER BY p.total_invested DESC
      `).all(userId) as Array<SqlRow>;

      const enriched = assets.map(a => {
        const livePrice = Number(a.live_price ?? 0);
        const qty = Number(a.quantity ?? 0);
        const invested = Number(a.total_invested ?? 0);
        const current = Number(a.current_value ?? 0);
        const liveValue = livePrice ? livePrice * qty : current;
        const pnl = liveValue - invested;
        return {
          ...a,
          live_value: Math.round(liveValue * 100) / 100,
          pnl: Math.round(pnl * 100) / 100,
          pnl_pct: invested > 0 ? Math.round(pnl / invested * 10000) / 100 : 0,
        };
      });

      db.close();
      return NextResponse.json({ success: true, data: enriched });
    }

    if (section === 'watchlist') {
      const items = db.prepare(`
        SELECT w.*, s.ticker, s.name, s.current_price, s.change_percent,
               s.sector, s.pe_ratio, s.rsi, s.signal, s.trend
        FROM user_stock_watchlists w
        LEFT JOIN stocks s ON w.stock_id = s.id
        WHERE w.user_id = ?
        ORDER BY w.added_at DESC
      `).all(userId) as Array<SqlRow>;

      db.close();
      return NextResponse.json({ success: true, data: items });
    }

    if (section === 'journal') {
      // `trading_journal` table may not exist in stocks.db (verified during
      // MONEY-PORTFOLIO-AUDIT). Wrap in try/catch and return honest empty
      // state instead of 500. Rule 27 (NO-FAKE-DATA).
      let trades: SqlRow[] = [];
      try {
        trades = db.prepare(`
          SELECT j.*, s.name as stock_name
          FROM trading_journal j
          LEFT JOIN stocks s ON j.ticker = s.ticker
          WHERE j.user_id = ?
          ORDER BY j.entry_date DESC
        `).all(userId) as Array<SqlRow>;
      } catch (journalErr) {
        console.error('[Money API] trading_journal query failed (table likely missing):', journalErr instanceof Error ? journalErr.message : journalErr);
      }

      let stats: { total: number; open: number; winning: number; losing: number; total_pnl: number; avg_return: number } = { total: 0, open: 0, winning: 0, losing: 0, total_pnl: 0, avg_return: 0 };
      try {
        stats = db.prepare(`
          SELECT COUNT(*) as total,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
            SUM(CASE WHEN status = 'closed' AND result > 0 THEN 1 ELSE 0 END) as winning,
            SUM(CASE WHEN status = 'closed' AND result <= 0 THEN 1 ELSE 0 END) as losing,
            COALESCE(SUM(CASE WHEN status = 'closed' THEN result ELSE 0 END), 0) as total_pnl,
            COALESCE(AVG(CASE WHEN status = 'closed' THEN result_pct ELSE NULL END), 0) as avg_return
          FROM trading_journal WHERE user_id = ?
        `).get(userId) || stats;
      } catch {}

      db.close();
      return NextResponse.json({
        success: true,
        data: trades,
        stats: {
          total: stats.total || 0,
          open: stats.open || 0,
          winning: stats.winning || 0,
          losing: stats.losing || 0,
          win_rate: stats.total > 0 ? Math.round(((stats.winning || 0) / stats.total) * 100) : 0,
          total_pnl: Math.round((stats.total_pnl || 0) * 100) / 100,
          avg_return: Math.round((stats.avg_return || 0) * 100) / 100,
        },
      });
    }

    db.close();
    return NextResponse.json({ success: false, error: 'Unknown section' }, { status: 400 });
  } catch (error) {
    console.error('[Money API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في جلب البيانات', details: String(error) },
      { status: 500 }
    );
  }
}

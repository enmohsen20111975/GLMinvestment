import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';
import { logger } from '@/lib/logger'; // Wave 1 P0 Fix 3 — Rule 58 (observability)

/**
 * GET /api/mobile/notifications
 * إشعارات الجوال - جلب الإشعارات للمستخدم
 *
 * Headers:
 * Authorization: Bearer <token>
 *
 * ALERTS-API-FIX (2026-10-01): unified with the web `/api/notifications`
 * data source so alerts set on the website appear in the app and vice
 * versa. Previously the mobile endpoint ONLY scanned the Prisma
 * `watchlist` table (auth.db) and synthesized a fake "system_welcome"
 * notification — it never read `user_notifications` (stocks.db) which
 * is where the alert-engine actually writes price/PnL/system alerts.
 *
 * Now we:
 *   1. Use `getSessionUserId()` (Bearer-token aware, robust date parsing).
 *   2. Read `user_notifications` from stocks.db (same source as the web).
 *   3. ALSO scan `user_stock_watchlists.alert_price_above/below` and
 *      the Prisma `watchlist` table for backward compat.
 *   4. Drop the fake "system_welcome" — users reported it as spam.
 */
function ensureNotifTable(db: SqliteDatabase): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'system',
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      severity TEXT DEFAULT 'info',
      payload TEXT,
      ticker TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  // Idempotent column adds (older DBs may lack `title`/`severity`/`payload`).
  const cols = db.prepare("PRAGMA table_info(user_notifications)").all() as { name: string }[];
  const have = new Set(cols.map((c) => c.name));
  const ensureCol = (name: string, def: string): void => {
    if (!have.has(name)) {
      try { db.prepare(`ALTER TABLE user_notifications ADD COLUMN ${name} ${def}`).run(); } catch { /* exists */ }
    }
  };
  ensureCol('title', "TEXT DEFAULT ''");
  ensureCol('severity', "TEXT DEFAULT 'info'");
  ensureCol('payload', 'TEXT');
  ensureCol('read', 'INTEGER DEFAULT 0');
  ensureCol('ticker', 'TEXT');
  ensureCol('created_at', "TEXT DEFAULT (datetime('now'))");
  try {
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_user_notif_dedup ON user_notifications(user_id, type, ticker)`
    ).run();
  } catch { /* ignore */ }
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  ticker?: string | null;
  severity?: string;
  created_at: string;
  read: boolean;
}

export async function GET(request: NextRequest) {
  try {
    // Auth: prefer getSessionUserId (Bearer + session cookie).
    // Fallback to the old inline token check for backward compat with
    // older Flutter builds that sent a token but no `Bearer ` prefix.
    let userId: string | null = null;
    try {
      const session = await getSessionUserId();
      userId = session.userId;
    } catch (authErr) {
      logger.warn('mobile-notif getSessionUserId error', { err: String(authErr) });
    }

    if (!userId) {
      // Last-resort: legacy inline apiToken lookup so we don't 401
      // a token that getSessionUserId rejected due to a transient Prisma error.
      const authHeader = request.headers.get('authorization');
      const token = authHeader?.replace('Bearer ', '');
      if (token) {
        try {
          const nowIso = new Date().toISOString();
          const apiToken = await db.apiToken.findFirst({
            where: { token, expires_at: { gt: nowIso } },
            select: { user_id: true },
          });
          if (apiToken?.user_id) userId = apiToken.user_id;
        } catch (legacyErr) {
          logger.warn('mobile-notif legacy apiToken lookup failed', { err: String(legacyErr) });
        }
      }
    }

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          error_ar: 'يجب تسجيل الدخول للوصول إلى الإشعارات',
        },
        { status: 401 }
      );
    }

    const notifications: NotificationItem[] = [];

    // ── 1) user_notifications (stocks.db) — same source as the website ──
    try {
      const financeDb = await getFinanceDb();
      ensureNotifTable(financeDb);
      const rows = financeDb.prepare(`
        SELECT id, user_id, type, title, message, severity, payload, ticker, read, created_at
        FROM user_notifications
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 200
      `).all(userId) as Array<{
        id: number;
        user_id: string;
        type: string;
        title: string | null;
        message: string | null;
        severity: string | null;
        payload: string | null;
        ticker: string | null;
        read: number;
        created_at: string;
      }>;
      for (const r of rows) {
        notifications.push({
          id: `n_${r.id}`,
          type: r.type || 'system',
          title: r.title || '',
          message: r.message || '',
          ticker: r.ticker || null,
          severity: r.severity || 'info',
          created_at: r.created_at,
          read: r.read === 1,
        });
      }
    } catch (e) {
      logger.warn('mobile-notif user_notifications read failed', { err: String(e) });
    }

    // ── 2) watchlist price-cross alerts (Prisma watchlist in auth.db) ──
    try {
      const watchlistItems = await db.watchlist.findMany({
        where: { user_id: userId },
        take: 200,
      });
      for (const item of watchlistItems) {
        const currentPrice = item.current_price;
        if (currentPrice == null) continue;
        if (item.alert_price_above != null && currentPrice >= item.alert_price_above) {
          notifications.push({
            id: `alert_above_${item.id}`,
            type: 'price_alert',
            title: 'تنبيه سعر',
            message: `وصل للسعر المستهدف ${item.alert_price_above}`,
            ticker: item.ticker,
            severity: 'high',
            created_at: new Date().toISOString(),
            read: false,
          });
        }
        if (item.alert_price_below != null && currentPrice <= item.alert_price_below) {
          notifications.push({
            id: `alert_below_${item.id}`,
            type: 'price_alert',
            title: 'تنبيه سعر',
            message: `انخفض للسعر ${item.alert_price_below}`,
            ticker: item.ticker,
            severity: 'high',
            created_at: new Date().toISOString(),
            read: false,
          });
        }
      }
    } catch (wlError) {
      logger.warn('mobile-notif Watchlist lookup failed', { err: String(wlError) });
    }

    return NextResponse.json({
      success: true,
      notifications,
      unread_count: notifications.filter((n) => !n.read).length,
    });
  } catch (error) {
    // Rule 30: no error details to the client. Log the full error server-side.
    logger.error('mobile-notif GET failed', { err: String(error) });
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_ar: 'حدث خطأ أثناء تحميل الإشعارات',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/notifications
 * تحديث حالة الإشعارات (قراءة)
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', error_ar: 'يجب تسجيل الدخول' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { notification_id, mark_all_read } = body as {
      notification_id?: string | number;
      mark_all_read?: boolean;
    };

    const financeDb = await getFinanceDb();
    ensureNotifTable(financeDb);

    if (mark_all_read) {
      const result = financeDb.prepare(
        `UPDATE user_notifications SET read = 1 WHERE user_id = ? AND read = 0`
      ).run(userId);
      return NextResponse.json({
        success: true,
        message: 'All notifications marked as read',
        updated_count: result.changes,
      });
    }

    // notification_id may be `n_42` (our prefix) or a raw integer.
    const rawId = String(notification_id || '').replace(/^n_/, '');
    const notifId = Number(rawId);
    if (!Number.isFinite(notifId) || notifId <= 0) {
      return NextResponse.json(
        { success: false, error: 'notification_id required (or set mark_all_read=true)' },
        { status: 400 }
      );
    }

    const existing = financeDb.prepare(
      `SELECT id FROM user_notifications WHERE id = ? AND user_id = ? LIMIT 1`
    ).get(notifId, userId) as { id: number } | undefined;
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Notification not found or not owned by user' },
        { status: 404 }
      );
    }
    financeDb.prepare(
      `UPDATE user_notifications SET read = 1 WHERE id = ?`
    ).run(notifId);

    return NextResponse.json({
      success: true,
      message: `Notification ${notifId} marked as read`,
      notification_id: notifId,
      read: true,
    });
  } catch (error) {
    logger.error('mobile-notif POST failed', { err: String(error) });
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_ar: 'تعذّر تحديث حالة الإشعارات',
      },
      { status: 500 }
    );
  }
}

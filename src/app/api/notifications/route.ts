/**
 * /api/notifications — مركز إشعارات المستخدم
 * =============================================
 * MONEY-TIER2-REBUILD: CRUD لجدول user_notifications.
 *
 * - GET  : يرجع آخر N إشعار للمستخدم الحالي.
 * - POST : يحدّث حالة القراءة (mark_all_read أو notification_id).
 *
 * الجدول:
 *   user_notifications (
 *     id, user_id, type, title, message,
 *     severity, payload, ticker, read, created_at
 *   )
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Schema helper — idempotent ALTER TABLE
// ---------------------------------------------------------------------------

/**
 * يضمن وجود user_notifications + الأعمدة:
 *   severity, payload, read, ticker, created_at
 */
export function ensureNotifColumns(db: SqliteDatabase): void {
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

  const cols = db.prepare("PRAGMA table_info(user_notifications)").all() as { name: string }[];
  const have = new Set(cols.map((c) => c.name));

  const ensureCol = (name: string, def: string): void => {
    if (!have.has(name)) {
      try {
        db.prepare(`ALTER TABLE user_notifications ADD COLUMN ${name} ${def}`).run();
      } catch {
        /* العمود موجود — تجاهل */
      }
    }
  };

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

// ---------------------------------------------------------------------------
// GET — قائمة الإشعارات
// ---------------------------------------------------------------------------

interface NotificationDbRow {
  id: number;
  user_id: string;
  type: string;
  title: string;
  message: string;
  severity: string | null;
  payload: string | null;
  ticker: string | null;
  read: number;
  created_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    let userId = url.searchParams.get('user_id');
    if (!userId) {
      try {
        const session = await getSessionUserId();
        userId = session.userId || undefined;
      } catch (authErr) {
        console.warn('[GET /api/notifications] Session resolution error:', authErr);
      }
    }

    // إذا لم يكن المستخدم مسجلاً، نرجع مصفوفة فارغة بنجاح بدون 401 أو 500 لمنع إزعاج المتصفح
    if (!userId) {
      return NextResponse.json({
        success: true,
        notifications: [],
        unread_count: 0,
        total_returned: 0,
      });
    }

    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit') || 50)));
    const onlyUnread = url.searchParams.get('unread') === '1';
    const typeFilter = url.searchParams.get('type');

    let db: SqliteDatabase;
    try {
      db = await getFinanceDb();
      ensureNotifColumns(db);
    } catch (dbErr) {
      console.warn('[GET /api/notifications] DB temporarily unavailable, returning empty list:', dbErr);
      return NextResponse.json({
        success: true,
        notifications: [],
        unread_count: 0,
        total_returned: 0,
      });
    }

    let sql = `SELECT id, user_id, type, title, message, severity, payload, ticker, read, created_at
               FROM user_notifications WHERE user_id = ?`;
    const params: (string | number)[] = [userId];

    if (onlyUnread) {
      sql += ` AND read = 0`;
    }
    if (typeFilter) {
      sql += ` AND type = ?`;
      params.push(typeFilter);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as NotificationDbRow[];

    const notifications = rows.map((r) => {
      let parsedPayload: unknown = null;
      if (r.payload) {
        try { parsedPayload = JSON.parse(r.payload); } catch { parsedPayload = r.payload; }
      }
      return {
        id: r.id,
        type: r.type,
        title: r.title,
        message: r.message,
        severity: r.severity || 'info',
        payload: parsedPayload,
        ticker: r.ticker,
        read: r.read === 1,
        created_at: r.created_at,
      };
    });

    // unread count (مستقل عن limit)
    const unreadRow = db.prepare(
      `SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND read = 0`
    ).get(userId) as { n: number } | undefined;

    return NextResponse.json({
      success: true,
      notifications,
      unread_count: unreadRow?.n || 0,
      total_returned: notifications.length,
    });
  } catch (e) {
    console.warn('[GET /api/notifications] Handled error, returning empty list:', e);
    return NextResponse.json({
      success: true,
      notifications: [],
      unread_count: 0,
      total_returned: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// POST — تحديث حالة القراءة
// ---------------------------------------------------------------------------

interface UpdateBody {
  mark_all_read?: boolean;
  notification_id?: number;
  read?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: UpdateBody = await req.json().catch(() => ({}));
    const db = await getFinanceDb();
    ensureNotifColumns(db);

    // Mode 1: mark_all_read
    if (body.mark_all_read) {
      const result = db.prepare(
        `UPDATE user_notifications SET read = 1 WHERE user_id = ? AND read = 0`
      ).run(userId);
      return NextResponse.json({
        success: true,
        message: 'تم تعليم كل الإشعارات كمقروءة',
        updated_count: result.changes,
      });
    }

    // Mode 2: update single notification
    const notifId = Number(body.notification_id || 0);
    if (!notifId || notifId <= 0) {
      return NextResponse.json(
        { success: false, error: 'notification_id required (or set mark_all_read=true)' },
        { status: 400 }
      );
    }

    const newRead = body.read === false ? 0 : 1;

    // تحقق إن الإشعار ملك المستخدم
    const existing = db.prepare(
      `SELECT id FROM user_notifications WHERE id = ? AND user_id = ? LIMIT 1`
    ).get(notifId, userId) as { id: number } | undefined;
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Notification not found or not owned by user' },
        { status: 404 }
      );
    }

    db.prepare(
      `UPDATE user_notifications SET read = ? WHERE id = ?`
    ).run(newRead, notifId);

    return NextResponse.json({
      success: true,
      message: newRead === 1 ? 'تم التعليم كمقروء' : 'تم التعليم كغير مقروء',
      notification_id: notifId,
      read: newRead === 1,
    });
  } catch (e) {
    console.error('[POST /api/notifications] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

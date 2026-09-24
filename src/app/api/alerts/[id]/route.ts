/**
 * DELETE /api/alerts/[id]
 * =======================
 * Flutter compat endpoint — حذف تنبيه.
 *
 * يستخدم الـ id لتحديد نوع التنبيه:
 *   - لو موجود في user_notifications → امسحه (hard delete)
 *   - لو موجود في user_stock_watchlists → امسح الـ threshold columns (soft delete)
 *
 * الـ Flutter app بيبعت الـ id زي ما هو راجع من GET /api/alerts.
 *
 * Returns: { success: true, deleted: id, deleted_from: 'notifications' | 'watchlist' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
}

function ensureWatchlistTable(db: SqliteDatabase): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_stock_watchlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT DEFAULT '',
      stock_id INTEGER,
      alert_price_above REAL,
      alert_price_below REAL,
      alert_change_percent REAL,
      notes TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      last_viewed TEXT,
      view_count INTEGER DEFAULT 0
    )
  `).run();
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id: idStr } = await params;
    const alertId = parseInt(idStr, 10);
    if (!Number.isFinite(alertId) || alertId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid id — must be a positive integer' },
        { status: 400 }
      );
    }

    const db = await getFinanceDb();
    ensureNotifTable(db);
    ensureWatchlistTable(db);

    // 1) جرّب user_notifications (hard delete لو ملك المستخدم)
    let notifDeleted = false;
    try {
      const result = db.prepare(
        'DELETE FROM user_notifications WHERE id = ? AND user_id = ?'
      ).run(alertId, userId);
      notifDeleted = result.changes > 0;
    } catch (e) {
      console.warn('[alerts/[id]] user_notifications delete failed:', e);
    }

    if (notifDeleted) {
      return NextResponse.json({
        success: true,
        deleted: alertId,
        deleted_from: 'notifications',
        message: 'تم حذف الإشعار',
      });
    }

    // 2) جرّب user_stock_watchlists (clear thresholds فقط)
    let watchUpdated = false;
    try {
      // تحقق إنه ملك المستخدم
      const existing = db.prepare(
        'SELECT id FROM user_stock_watchlists WHERE id = ? AND user_id = ? LIMIT 1'
      ).get(alertId, userId) as { id: number } | undefined;
      if (existing?.id) {
        db.prepare(`
          UPDATE user_stock_watchlists
          SET alert_price_above = NULL,
              alert_price_below = NULL,
              alert_change_percent = NULL
          WHERE id = ? AND user_id = ?
        `).run(alertId, userId);
        watchUpdated = true;
      }
    } catch (e) {
      console.warn('[alerts/[id]] user_stock_watchlists update failed:', e);
    }

    if (watchUpdated) {
      return NextResponse.json({
        success: true,
        deleted: alertId,
        deleted_from: 'watchlist',
        message: 'تم حذف تنبيه قائمة المراقبة',
      });
    }

    // مفيش alert بالـ id ده
    return NextResponse.json(
      {
        success: false,
        error: 'Alert not found or not owned by user',
        deleted: alertId,
      },
      { status: 404 }
    );
  } catch (e) {
    console.error('[DELETE /api/alerts/[id]] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

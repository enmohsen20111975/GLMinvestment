/**
 * GET /api/alerts — كل تنبيهات المستخدم
 * =====================================
 * Flutter compat endpoint — مركز التنبيهات الموحّد.
 *
 * - notifications: من stocks.db.user_notifications (الجدول اللي alert-engine بيملاه)
 * - watchlist_alerts: من stocks.db.user_stock_watchlists.alert_price_above/below
 * - summary: { total, unread, by_severity }
 *
 * Query: ?limit=50&include_read=true
 *
 * لا يستخدم Python. كل البيانات من SQLite.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface NotificationRow {
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

interface WatchlistAlertRow {
  id: number;
  user_id: string;
  stock_id: number | null;
  alert_price_above: number | null;
  alert_price_below: number | null;
  alert_change_percent: number | null;
  notes: string | null;
  added_at: string;
  ticker?: string | null;
  current_price?: number | null;
}

interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  severity: string;
  payload: Record<string, unknown> | null;
  ticker: string | null;
  read: boolean;
  created_at: string;
}

interface WatchlistAlertItem {
  id: number;
  stock_id: number | null;
  ticker: string | null;
  alert_type: 'price_above' | 'price_below' | 'change_pct';
  threshold: number;
  current_price: number | null;
  distance_pct: number | null;
  notes: string | null;
  added_at: string;
}

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
  try {
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_user_notif_dedup ON user_notifications(user_id, type, ticker)`
    ).run();
  } catch { /* ignore */ }
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
  const cols = db.prepare("PRAGMA table_info(user_stock_watchlists)").all() as { name: string }[];
  const have = new Set(cols.map(c => c.name));
  if (!have.has('purchase_price')) {
    try { db.prepare('ALTER TABLE user_stock_watchlists ADD COLUMN purchase_price REAL').run(); } catch { /* exists */ }
  }
  if (!have.has('quantity')) {
    try { db.prepare('ALTER TABLE user_stock_watchlists ADD COLUMN quantity INTEGER').run(); } catch { /* exists */ }
  }
}

function ensureStocksTable(db: SqliteDatabase): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      name TEXT,
      name_ar TEXT,
      current_price REAL,
      previous_close REAL
    )
  `).run();
}

function safeParseJson(v: string | null): Record<string, unknown> | null {
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return null;
  }
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication required',
          notifications: [],
          watchlist_alerts: [],
          summary: { total: 0, unread: 0, by_severity: {} },
        },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const includeRead = url.searchParams.get('include_read') !== 'false';

    const db = await getFinanceDb();
    ensureNotifTable(db);
    ensureWatchlistTable(db);
    ensureStocksTable(db);

    // 1) notifications
    let notifRows: NotificationRow[] = [];
    try {
      if (includeRead) {
        notifRows = db.prepare(`
          SELECT id, user_id, type, title, message, severity, payload, ticker, read, created_at
          FROM user_notifications
          WHERE user_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(userId, limit) as unknown as NotificationRow[];
      } else {
        notifRows = db.prepare(`
          SELECT id, user_id, type, title, message, severity, payload, ticker, read, created_at
          FROM user_notifications
          WHERE user_id = ? AND read = 0
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(userId, limit) as unknown as NotificationRow[];
      }
    } catch (e) {
      console.warn('[alerts] user_notifications query failed:', e);
    }

    const notifications: NotificationItem[] = notifRows.map(r => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      severity: r.severity || 'info',
      payload: safeParseJson(r.payload),
      ticker: r.ticker,
      read: r.read === 1,
      created_at: r.created_at,
    }));

    // 2) watchlist alerts (rows with alert_price_above/below set)
    let watchRows: WatchlistAlertRow[] = [];
    try {
      watchRows = db.prepare(`
        SELECT w.id, w.user_id, w.stock_id, w.alert_price_above, w.alert_price_below,
               w.alert_change_percent, w.notes, w.added_at,
               s.ticker, s.current_price
        FROM user_stock_watchlists w
        LEFT JOIN stocks s ON s.id = w.stock_id
        WHERE w.user_id = ?
          AND (w.alert_price_above IS NOT NULL
               OR w.alert_price_below IS NOT NULL
               OR w.alert_change_percent IS NOT NULL)
        ORDER BY w.added_at DESC
      `).all(userId) as unknown as WatchlistAlertRow[];
    } catch (e) {
      console.warn('[alerts] user_stock_watchlists query failed:', e);
    }

    const watchlistAlerts: WatchlistAlertItem[] = watchRows.map(w => {
      let alertType: 'price_above' | 'price_below' | 'change_pct' = 'change_pct';
      let threshold = 0;
      if (w.alert_price_above != null) {
        alertType = 'price_above';
        threshold = safeNum(w.alert_price_above);
      } else if (w.alert_price_below != null) {
        alertType = 'price_below';
        threshold = safeNum(w.alert_price_below);
      } else if (w.alert_change_percent != null) {
        alertType = 'change_pct';
        threshold = safeNum(w.alert_change_percent);
      }
      const currentPrice = w.current_price != null ? safeNum(w.current_price) : null;
      const distancePct = currentPrice != null && threshold > 0
        ? Math.round(((currentPrice - threshold) / threshold) * 10000) / 100
        : null;
      return {
        id: w.id,
        stock_id: w.stock_id,
        ticker: w.ticker ?? null,
        alert_type: alertType,
        threshold,
        current_price: currentPrice,
        distance_pct: distancePct,
        notes: w.notes,
        added_at: w.added_at,
      };
    });

    // 3) summary
    const total = notifications.length + watchlistAlerts.length;
    const unread = notifications.filter(n => !n.read).length;
    const bySeverity: Record<string, number> = {};
    for (const n of notifications) {
      const sev = n.severity || 'info';
      bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      notifications,
      watchlist_alerts: watchlistAlerts,
      summary: {
        total,
        unread,
        by_severity: bySeverity,
        notifications_count: notifications.length,
        watchlist_alerts_count: watchlistAlerts.length,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/alerts] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        notifications: [],
        watchlist_alerts: [],
        summary: { total: 0, unread: 0, by_severity: {} },
      },
      { status: 500 }
    );
  }
}

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
import { normalizeMarket, sqlMarketVariants, type CanonicalMarket } from '@/lib/market-utils';

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
  // Rule 67 (Phase 0 — notification filtering): column يخزّن سوق الإشعار
  // (EGX / TADAWUL / ...) عشان نقدر نفلتر cross-market — المصري ميشوفش سعودي.
  ensureCol('market', 'TEXT');

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
  market: string | null;
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
        userId = session.userId ?? null;
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
    // Rule 67 (Phase 0 — notification filtering):
    //   portfolio_only=1 → only notifications whose ticker IS NULL (system-wide)
    //     OR ticker IN (user's portfolio + watchlist tickers).
    //   market=EGX|TADAWUL|... → only notifications whose market matches
    //     (or whose ticker belongs to that market in `stocks`, or system-wide
    //     with no market set). Cross-market notifications MUST NOT leak.
    const portfolioOnly = url.searchParams.get('portfolio_only') === '1';
    // FIX (FIX-API-MARKET #16): normalise the `market` param via the shared
    // helper so 'KSA' → 'TADAWUL', 'NYSE' → 'US', etc. The previous code only
    // uppercased the input — `market=KSA` would never match rows stored as
    // 'TADAWUL' or 'السعودية'. We now use `sqlMarketVariants()` to bind ALL
    // stored aliases (canonical + Arabic + legacy) into the SQL filter.
    const marketParam = url.searchParams.get('market');
    const canonicalMarket: CanonicalMarket | null = marketParam
      ? normalizeMarket(marketParam)
      : null;
    const marketVariants = canonicalMarket ? sqlMarketVariants(canonicalMarket) : [];
    const marketPlaceholders = marketVariants.map(() => '?').join(',');

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

    // ------------------------------------------------------------------
    // Build the set of tickers the user is allowed to see:
    //   1. portfolio_assets.stock_ticker (user's holdings)
    //   2. user_stock_watchlists JOIN stocks (user's watchlist tickers)
    // Both live in the SAME stocks.db connection (finance.db = stocks.db).
    // ------------------------------------------------------------------
    const allowedTickers = new Set<string>();
    if (portfolioOnly) {
      try {
        const portfolioRows = db.prepare(
          `SELECT DISTINCT UPPER(stock_ticker) AS t
           FROM portfolio_assets
           WHERE user_id = ?
             AND stock_ticker IS NOT NULL
             AND TRIM(stock_ticker) != ''`
        ).all(userId) as { t: string | null }[];
        for (const r of portfolioRows) {
          if (r.t) allowedTickers.add(r.t);
        }
      } catch { /* portfolio_assets may not exist yet — ignore */ }

      try {
        const watchlistRows = db.prepare(
          `SELECT DISTINCT UPPER(s.ticker) AS t
           FROM user_stock_watchlists w
           LEFT JOIN stocks s ON s.id = w.stock_id
           WHERE w.user_id = ?
             AND s.ticker IS NOT NULL
             AND TRIM(s.ticker) != ''`
        ).all(userId) as { t: string | null }[];
        for (const r of watchlistRows) {
          if (r.t) allowedTickers.add(r.t);
        }
      } catch { /* user_stock_watchlists may not exist yet — ignore */ }
    }

    // ------------------------------------------------------------------
    // Build the set of tickers that belong to the requested market
    // (used to filter cross-market notifications whose `market` column
    // is NULL but `ticker` is set — we look it up in `stocks`).
    // ------------------------------------------------------------------
    let marketTickers: Set<string> | null = null;
    if (canonicalMarket && marketVariants.length > 0) {
      marketTickers = new Set<string>();
      try {
        // FIX (FIX-API-MARKET #16): use `market IN (?, ?, ?)` with the canonical
        // market's variants so the lookup also matches rows stored under
        // Arabic aliases (e.g. 'السعودية') — previously `UPPER(market) = ?`
        // silently dropped those rows.
        const rows = db.prepare(
          `SELECT DISTINCT UPPER(ticker) AS t
           FROM stocks
           WHERE ticker IS NOT NULL
             AND TRIM(ticker) != ''
             AND market IN (${marketPlaceholders})`
        ).all(...marketVariants) as { t: string | null }[];
        for (const r of rows) {
          if (r.t) marketTickers.add(r.t);
        }
      } catch { /* stocks table issue — skip market ticker filter */ }
    }

    let sql = `SELECT id, user_id, type, title, message, severity, payload, ticker, market, read, created_at
               FROM user_notifications WHERE user_id = ?`;
    const params: (string | number)[] = [userId];

    if (onlyUnread) {
      sql += ` AND read = 0`;
    }
    if (typeFilter) {
      sql += ` AND type = ?`;
      params.push(typeFilter);
    }

    // portfolio_only=1 → keep notifications whose ticker is NULL (system-wide)
    // OR ticker ∈ allowedTickers (user's portfolio + watchlist).
    if (portfolioOnly) {
      if (allowedTickers.size === 0) {
        // No portfolio/watchlist tickers at all → only system-wide alerts pass.
        sql += ` AND ticker IS NULL`;
      } else {
        const placeholders = Array.from(allowedTickers)
          .map(() => '?')
          .join(', ');
        sql += ` AND (ticker IS NULL OR UPPER(ticker) IN (${placeholders}))`;
        for (const t of allowedTickers) params.push(t);
      }
    }

    // market=X → keep notifications where:
    //   • market column is NULL (truly system-wide announcement) AND ticker is
    //     NULL OR ticker belongs to a stock in the requested market — pass
    //   • OR market column matches the requested market (any alias) — pass
    //   • Otherwise (cross-market ticker or explicit cross-market column) — DROP.
    if (canonicalMarket && marketVariants.length > 0) {
      const marketTickerPlaceholders =
        marketTickers && marketTickers.size > 0
          ? Array.from(marketTickers).map(() => '?').join(', ')
          : "''";
      sql += ` AND (
        (market IS NULL AND (ticker IS NULL OR UPPER(ticker) IN (${marketTickerPlaceholders})))
        OR market IN (${marketPlaceholders})
      )`;
      if (marketTickers && marketTickers.size > 0) {
        for (const t of marketTickers) params.push(t);
      }
      params.push(...marketVariants);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as unknown as NotificationDbRow[];

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
        market: r.market || null,
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
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}

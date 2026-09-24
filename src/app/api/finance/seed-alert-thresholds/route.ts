/**
 * /api/finance/seed-alert-thresholds
 * ===================================
 * MONEY-TIER2-REBUILD: زرع عتبات التنبيهات لصفوف user_stock_watchlists
 * اللي مفيهاش threshold.
 *
 * - GET  : إحصائية (كم سهم عنده threshold + كم NULL).
 * - POST : يزرع ±5% thresholds لكل الـ NULL rows:
 *            alert_price_above = current_price × 1.05
 *            alert_price_below = current_price × 0.95
 *            alert_change_percent = 5
 *
 * السعر الحالي بيتجاب من stocks.current_price.
 *
 * Auth: session-based. الـ admin يقدر يزرع لكل المستخدمين.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Schema helper
// ---------------------------------------------------------------------------

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
  const have = new Set(cols.map((c) => c.name));
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

// ---------------------------------------------------------------------------
// GET — إحصائية العتبات
// ---------------------------------------------------------------------------

interface StatRow {
  total: number;
  with_threshold: number;
  null_threshold: number;
  with_above: number;
  with_below: number;
  with_change_pct: number;
  null_above: number;
  null_below: number;
  null_change_pct: number;
}

function computeStats(db: SqliteDatabase, userId?: string): StatRow {
  const filterClause = userId ? 'WHERE w.user_id = ?' : '';
  const params = userId ? [userId] : [];

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN w.alert_price_above IS NOT NULL OR w.alert_price_below IS NOT NULL OR w.alert_change_percent IS NOT NULL THEN 1 ELSE 0 END) AS with_threshold,
      SUM(CASE WHEN w.alert_price_above IS NULL AND w.alert_price_below IS NULL AND w.alert_change_percent IS NULL THEN 1 ELSE 0 END) AS null_threshold,
      SUM(CASE WHEN w.alert_price_above IS NOT NULL THEN 1 ELSE 0 END) AS with_above,
      SUM(CASE WHEN w.alert_price_below IS NOT NULL THEN 1 ELSE 0 END) AS with_below,
      SUM(CASE WHEN w.alert_change_percent IS NOT NULL THEN 1 ELSE 0 END) AS with_change_pct,
      SUM(CASE WHEN w.alert_price_above IS NULL THEN 1 ELSE 0 END) AS null_above,
      SUM(CASE WHEN w.alert_price_below IS NULL THEN 1 ELSE 0 END) AS null_below,
      SUM(CASE WHEN w.alert_change_percent IS NULL THEN 1 ELSE 0 END) AS null_change_pct
    FROM user_stock_watchlists w
    ${filterClause}
  `).get(...params) as StatRow | undefined;

  return row || {
    total: 0, with_threshold: 0, null_threshold: 0,
    with_above: 0, with_below: 0, with_change_pct: 0,
    null_above: 0, null_below: 0, null_change_pct: 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    let userId = url.searchParams.get('user_id');
    if (!userId) {
      try {
        const session = await getSessionUserId();
        userId = session.userId || undefined;
      } catch { /* ignore */ }
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const db = await getFinanceDb();
    ensureWatchlistTable(db);
    ensureStocksTable(db);

    const stats = computeStats(db, userId);

    return NextResponse.json({
      success: true,
      stats,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/finance/seed-alert-thresholds] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — زرع العتبات للصفوف الـ NULL
// ---------------------------------------------------------------------------

interface NullRow {
  id: number;
  user_id: string;
  stock_id: number;
}

interface StockPriceRow {
  id: number;
  current_price: number | null;
  previous_close: number | null;
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    let userId = url.searchParams.get('user_id');
    if (!userId) {
      try {
        const session = await getSessionUserId();
        userId = session.userId || undefined;
      } catch { /* ignore */ }
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const db = await getFinanceDb();
    ensureWatchlistTable(db);
    ensureStocksTable(db);

    // جلب كل الصفوف اللي مفيهاش أي threshold
    const filterClause = userId ? 'WHERE w.user_id = ?' : '';
    const params = userId ? [userId] : [];

    const nullRows = db.prepare(`
      SELECT w.id, w.user_id, w.stock_id
      FROM user_stock_watchlists w
      ${filterClause}
        AND w.alert_price_above IS NULL
        AND w.alert_price_below IS NULL
        AND w.alert_change_percent IS NULL
        AND w.stock_id IS NOT NULL
    `).all(...params) as NullRow[];

    if (nullRows.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'كل صفوف الـ watchlist عندها thresholds بالفعل',
        seeded: 0,
        skipped_no_price: 0,
      });
    }

    // نبني map stock_id → current_price عشان نقلل الـ queries
    const stockIds = Array.from(new Set(nullRows.map((r) => r.stock_id)));
    const stockPriceMap = new Map<number, number>();
    if (stockIds.length > 0) {
      const placeholders = stockIds.map(() => '?').join(',');
      const stockRows = db.prepare(
        `SELECT id, current_price, previous_close FROM stocks WHERE id IN (${placeholders})`
      ).all(...stockIds) as StockPriceRow[];
      for (const s of stockRows) {
        const price = Number(s.current_price || s.previous_close || 0);
        if (price > 0) stockPriceMap.set(s.id, price);
      }
    }

    let seeded = 0;
    let skippedNoPrice = 0;
    const updateStmt = db.prepare(
      `UPDATE user_stock_watchlists
       SET alert_price_above = ?,
           alert_price_below = ?,
           alert_change_percent = 5
       WHERE id = ?`
    );

    for (const row of nullRows) {
      const price = stockPriceMap.get(row.stock_id) || 0;
      if (price <= 0) {
        skippedNoPrice++;
        continue;
      }
      const above = Math.round(price * 1.05 * 100) / 100;
      const below = Math.round(price * 0.95 * 100) / 100;
      updateStmt.run(above, below, row.id);
      seeded++;
    }

    const stats = computeStats(db, userId);

    return NextResponse.json({
      success: true,
      message: `تم زرع ${seeded} عتبة (±5%) لصفوف الـ watchlist`,
      seeded,
      skipped_no_price: skippedNoPrice,
      stats,
    });
  } catch (e) {
    console.error('[POST /api/finance/seed-alert-thresholds] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/alerts/create
 * =======================
 * Flutter compat endpoint — إنشاء تنبيه جديد.
 *
 * Body:
 *   {
 *     ticker?: string,                     (لو alert_type = price_above/below/change_pct)
 *     alert_type: 'price_above' | 'price_below' | 'change_pct',
 *     threshold: number,
 *     market?: string,                      (default: EGX)
 *     notes?: string
 *   }
 *
 * السلوك:
 *   1. لو السهم موجود في user_stock_watchlists → يحدّث alert_price_above/below/change_percent
 *   2. غير كده → ينشئ entry جديد في user_stock_watchlists مرتبط بـ stock_id (لو موجود)
 *
 * Returns: { success: true, id: <watchlist_id>, mode: 'created' | 'updated' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { enforceAlertLimit, EnforcementError } from '@/lib/subscription-enforcement';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_ALERT_TYPES = new Set(['price_above', 'price_below', 'change_pct']);

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

interface CreateAlertBody {
  ticker?: string;
  alert_type?: string;
  threshold?: number;
  market?: string;
  notes?: string;
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

    const body: CreateAlertBody = await req.json().catch(() => ({}));
    const ticker = String(body.ticker || '').trim().toUpperCase();
    const alertType = String(body.alert_type || '').toLowerCase();
    const threshold = Number(body.threshold);
    const notes = body.notes ? String(body.notes) : null;

    if (!VALID_ALERT_TYPES.has(alertType)) {
      return NextResponse.json(
        { success: false, error: `alert_type must be one of: price_above, price_below, change_pct` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return NextResponse.json(
        { success: false, error: 'threshold must be a positive number' },
        { status: 400 }
      );
    }
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker is required' },
        { status: 400 }
      );
    }

    // FIX-P3-P5-P6 (Group P3 — Fix 2): enforce Free-tier alert limit
    // server-side (Free: 3 alerts). Paid tiers bypass inside the helper.
    try {
      await enforceAlertLimit(userId);
    } catch (err) {
      if (err instanceof EnforcementError) {
        return NextResponse.json(err.toJSON(), { status: 403 });
      }
      throw err;
    }

    const db = await getFinanceDb();
    ensureWatchlistTable(db);
    ensureStocksTable(db);

    // ابحث عن stock_id
    let stockId: number | null = null;
    try {
      const row = db.prepare(
        'SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1'
      ).get(ticker) as { id: number } | undefined;
      if (row?.id) stockId = row.id;
    } catch { /* ignore */ }

    // ابحث لو السهم موجود في watchlist للمستخدم
    let existingWatchId: number | null = null;
    try {
      if (stockId) {
        const row = db.prepare(
          'SELECT id FROM user_stock_watchlists WHERE user_id = ? AND stock_id = ? LIMIT 1'
        ).get(userId, stockId) as { id: number } | undefined;
        if (row?.id) existingWatchId = row.id;
      }
    } catch { /* ignore */ }

    let resultId: number;
    let mode: 'created' | 'updated';

    if (existingWatchId) {
      // update: امسح الـ thresholds التانية وحدّث المعنية
      const updateParts: string[] = [];
      const params: (string | number | null)[] = [];

      updateParts.push('alert_price_above = NULL');
      updateParts.push('alert_price_below = NULL');
      updateParts.push('alert_change_percent = NULL');

      if (alertType === 'price_above') {
        updateParts.push('alert_price_above = ?');
        params.push(threshold);
      } else if (alertType === 'price_below') {
        updateParts.push('alert_price_below = ?');
        params.push(threshold);
      } else {
        updateParts.push('alert_change_percent = ?');
        params.push(threshold);
      }
      if (notes !== null) {
        updateParts.push('notes = ?');
        params.push(notes);
      }
      params.push(existingWatchId);
      db.prepare(
        `UPDATE user_stock_watchlists SET ${updateParts.join(', ')} WHERE id = ?`
      ).run(...params);
      resultId = existingWatchId;
      mode = 'updated';
    } else {
      // create new watchlist entry مع الـ alert
      const col = alertType === 'price_above'
        ? 'alert_price_above'
        : alertType === 'price_below'
        ? 'alert_price_below'
        : 'alert_change_percent';

      const result = db.prepare(
        `INSERT INTO user_stock_watchlists (user_id, stock_id, ${col}, notes)
         VALUES (?, ?, ?, ?)`
      ).run(userId, stockId ?? null, threshold, notes);
      resultId = Number(result.lastInsertRowid);
      mode = 'created';
    }

    return NextResponse.json({
      success: true,
      id: resultId,
      mode,
      alert: {
        id: resultId,
        ticker,
        stock_id: stockId,
        alert_type: alertType,
        threshold,
        notes,
      },
      message: mode === 'created'
        ? `تم إنشاء تنبيه ${alertType} على ${ticker} عند ${threshold}`
        : `تم تحديث تنبيه ${alertType} على ${ticker} عند ${threshold}`,
    });
  } catch (e) {
    console.error('[POST /api/alerts/create] Error:', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}

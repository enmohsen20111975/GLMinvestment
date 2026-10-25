/**
 * Quick-Add Price Alert API (P41-DELAYED-DATA-MODE)
 * ================================================
 *
 * POST /api/alerts/quick-add
 *
 * يحفظ تنبيه سعر سريع في جدول `price_alerts` بـ stocks.db.
 * الزرار اللي بيدوس المستخدم في `SingleStockAnalysisView.tsx` (أيقونة النجمة)
 * بيبعت الـ ticker + السعر الحالي + نسبة الانخفاض المطلوبة (افتراضي -3%).
 *
 * الـ alert بيتسجل كـ "price_below" بنفس لغة الـ alerts-store الموجود، فبيبقى
 * متوافق مع الـ use-alerts.ts hook اللي بيرصد التحديثات اللحظية.
 *
 * Body:
 *   {
 *     ticker: string,
 *     current_price: number,
 *     drop_pct?: number (default -3, negative = below threshold),
 *     user_id?: string,
 *     label?: string
 *   }
 *
 * Response:
 *   { success: true, alert: {...}, table_created: boolean }
 *
 * P41-DELAYED-DATA-MODE: لما الـ data تكون متأخرة 5 دقايق، الـ user محتاج
 * طريقة "ضبط تنبيه وانسَ" عشان ما يضطرش يراقب الشارت كل ثانية. الزرار ده
 * بيسجّل alert بسيط: "نبّهني لو السهم نزل 3% تحت السعر ده".
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = "force-dynamic";

import { getWritableStocksDb } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// Schema: price_alerts table (idempotent CREATE IF NOT EXISTS)
// ---------------------------------------------------------------------------

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    alert_type TEXT NOT NULL DEFAULT 'price_below',
    reference_price REAL NOT NULL,
    threshold_price REAL NOT NULL,
    drop_pct REAL NOT NULL DEFAULT -3.0,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_triggered INTEGER NOT NULL DEFAULT 0,
    triggered_at TEXT,
    user_id TEXT,
    label TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_price_alerts_ticker ON price_alerts(ticker)`,
  `CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active, is_triggered)`,
];

/** Idempotently create the price_alerts table + indexes. */
function ensureSchema(db: ReturnType<typeof getWritableStocksDb>): boolean {
  let created = false;
  for (const sql of SCHEMA_STATEMENTS) {
    try {
      db.run(sql);
      created = true;
    } catch (e) {
      console.error('[quick-add] schema statement failed:', sql.slice(0, 60), '→', e instanceof Error ? e.message : e);
    }
  }
  // Verify the table actually exists now
  try {
    const check = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='price_alerts'`).get();
    if (!check) {
      console.error('[quick-add] price_alerts table NOT found after ensureSchema — connection may be readonly snapshot');
    }
  } catch (e) {
    console.error('[quick-add] schema verify failed:', e);
  }
  return created;
}

interface QuickAddBody {
  ticker?: string;
  current_price?: number;
  drop_pct?: number;
  user_id?: string;
  label?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    // F1.2 — auth guard (IDOR fix): require session. No more accepting body.user_id directly.
    const { userId: sessionUserId } = await getSessionUserId();
    if (!sessionUserId) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }

    const body: QuickAddBody = await request.json().catch(() => ({}));
    const ticker = (body.ticker || '').toString().trim().toUpperCase();
    const currentPrice = Number(body.current_price);
    const dropPct = Number(body.drop_pct ?? -3); // default: -3%
    // F1.2: ignore body.user_id — use session userId only (IDOR fix)
    const userId = sessionUserId;
    const label = body.label ? String(body.label) : null;
    const notes = body.notes ? String(body.notes) : null;

    // ── Validation ──
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker is required' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return NextResponse.json(
        { success: false, error: 'current_price must be a positive number' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(dropPct) || dropPct >= 0) {
      return NextResponse.json(
        { success: false, error: 'drop_pct must be a negative number (e.g. -3 for -3%)' },
        { status: 400 }
      );
    }

    // ── Compute threshold price ──
    // drop_pct = -3  →  multiplier = 1 + (-3/100) = 0.97
    const multiplier = 1 + dropPct / 100;
    const thresholdPrice = Number((currentPrice * multiplier).toFixed(4));

    // ── Open writable stocks.db + ensure schema ──
    const db = getWritableStocksDb();
    const tableCreated = ensureSchema(db);

    // ── Insert alert ──
    const insertStmt = db.prepare(`
      INSERT INTO price_alerts
        (ticker, alert_type, reference_price, threshold_price, drop_pct,
         is_active, is_triggered, user_id, label, notes)
      VALUES
        (@ticker, 'price_below', @reference_price, @threshold_price, @drop_pct,
         1, 0, @user_id, @label, @notes)
    `);
    const result = insertStmt.run({
      ticker,
      reference_price: currentPrice,
      threshold_price: thresholdPrice,
      drop_pct: dropPct,
      user_id: userId,
      label: label || `تنبيه سريع: ${ticker} نزل ${dropPct}% تحت ${currentPrice.toFixed(2)}`,
      notes: notes,
    });

    const alertId = Number(result.lastInsertRowid);

    return NextResponse.json({
      success: true,
      alert: {
        id: alertId,
        ticker,
        alert_type: 'price_below',
        reference_price: currentPrice,
        threshold_price: thresholdPrice,
        drop_pct: dropPct,
        is_active: true,
        is_triggered: false,
        user_id: userId,
        label: label || `تنبيه سريع: ${ticker} نزل ${dropPct}% تحت ${currentPrice.toFixed(2)}`,
        created_at: new Date().toISOString(),
      },
      table_created: tableCreated,
      message: `تم تسجيل تنبيه: ${ticker} نزل ${dropPct}% تحت ${currentPrice.toFixed(2)} (عتبة: ${thresholdPrice.toFixed(2)})`,
    });
  } catch (error) {
    console.error('[POST /api/alerts/quick-add] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save quick-add alert',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/alerts/quick-add?ticker=COMI&active_only=true
 *
 * يرجّع التنبيهات المسجّلة (اختياري فلترة بـ ticker).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = (searchParams.get('ticker') || '').toString().trim().toUpperCase();
    const activeOnly = searchParams.get('active_only') === 'true';

    const db = getWritableStocksDb();
    ensureSchema(db);

    let sql = `SELECT * FROM price_alerts WHERE 1=1`;
    const params: Record<string, unknown> = {};
    if (ticker) {
      sql += ` AND ticker = @ticker`;
      params.ticker = ticker;
    }
    if (activeOnly) {
      sql += ` AND is_active = 1 AND is_triggered = 0`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 100`;

    const rows = db.prepare(sql).all(params);
    return NextResponse.json({
      success: true,
      alerts: rows,
      count: rows.length,
    });
  } catch (error) {
    console.error('[GET /api/alerts/quick-add] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch alerts',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

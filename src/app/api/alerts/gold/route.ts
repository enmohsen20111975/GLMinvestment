/**
 * /api/alerts/gold — تنبيهات الذهب
 * =================================
 * MONEY-TIER2-REBUILD: CRUD لتنبيهات أسعار الذهب المصري.
 *
 * Methods:
 *   GET    — يرجع كل تنبيهات الذهب (مع السعر الحالي لكل عيار).
 *   POST   — ينشئ/يحدّث تنبيه ذهب.
 *   DELETE — يحذف تنبيه (soft delete: is_active=0).
 *
 * Body (POST):
 *   {
 *     karat: 24 | 21 | 18,
 *     condition: 'above' | 'below',
 *     threshold_price: number,
 *     alert_id?: number  // لو موجود → تحديث بدل إنشاء
 *   }
 *
 * Body (DELETE):
 *   { alert_id: number }
 *
 * Auth: session-based. كل تنبيه مرتبط بـ user_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { getLiveEgyptGoldPrices } from '@/lib/data-engine-db';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GOLD_KARATS = new Set([24, 21, 18]);
const GOLD_CONDITIONS = new Set(['above', 'below']);

interface GoldAlertDbRow {
  id: number;
  user_id: string;
  karat: number;
  condition: string;
  threshold_price: number | null;
  is_active: number;
  last_triggered: string | null;
  created_at: string;
}

function ensureGoldAlertsTable(db: SqliteDatabase): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS gold_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '',
      karat INTEGER NOT NULL DEFAULT 24,
      condition TEXT NOT NULL DEFAULT 'above',
      threshold_price REAL,
      is_active INTEGER DEFAULT 1,
      last_triggered TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
}

function fetchCurrentPrices(): { '24k': number; '21k': number; '18k': number; source: string } {
  const fallback = { '24k': 4200, '21k': 3675, '18k': 3150, source: 'fallback' };
  try {
    const live = getLiveEgyptGoldPrices();
    if (live) {
      return {
        '24k': Number(live['24k']) || fallback['24k'],
        '21k': Number(live['21k']) || fallback['21k'],
        '18k': Number(live['18k']) || fallback['18k'],
        source: live.source || 'gold_prices',
      };
    }
  } catch { /* ignore */ }
  return fallback;
}

// ---------------------------------------------------------------------------
// GET — قائمة تنبيهات الذهب للمستخدم الحالي
// ---------------------------------------------------------------------------

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
        { success: false, error: 'Authentication required', alerts: [] },
        { status: 401 }
      );
    }

    const db = await getFinanceDb();
    ensureGoldAlertsTable(db);

    const rows = db.prepare(
      `SELECT id, user_id, karat, condition, threshold_price, is_active, last_triggered, created_at
       FROM gold_alerts
       WHERE user_id = ?
       ORDER BY created_at DESC`
    ).all(userId) as GoldAlertDbRow[];

    const prices = fetchCurrentPrices();

    const alerts = rows.map((r) => {
      const currentPrice = r.karat === 24 ? prices['24k'] : r.karat === 21 ? prices['21k'] : r.karat === 18 ? prices['18k'] : 0;
      const isTriggered =
        r.threshold_price !== null &&
        r.threshold_price > 0 &&
        ((r.condition === 'above' && currentPrice >= r.threshold_price) ||
         (r.condition === 'below' && currentPrice <= r.threshold_price));
      return {
        id: r.id,
        karat: r.karat,
        condition: r.condition,
        threshold_price: r.threshold_price !== null ? Number(r.threshold_price) : null,
        is_active: r.is_active === 1,
        last_triggered: r.last_triggered,
        created_at: r.created_at,
        current_price: currentPrice,
        is_triggered: isTriggered,
        distance_pct:
          r.threshold_price && r.threshold_price > 0 && currentPrice > 0
            ? Math.round(((currentPrice - r.threshold_price) / r.threshold_price) * 10000) / 100
            : null,
      };
    });

    return NextResponse.json({
      success: true,
      alerts,
      count: alerts.length,
      current_prices: prices,
    });
  } catch (e) {
    console.error('[GET /api/alerts/gold] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error', alerts: [] },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — إنشاء أو تحديث تنبيه ذهب
// ---------------------------------------------------------------------------

interface GoldAlertBody {
  karat?: number;
  condition?: string;
  threshold_price?: number;
  alert_id?: number;
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

    const body: GoldAlertBody = await req.json().catch(() => ({}));
    const karat = Number(body.karat);
    const condition = String(body.condition || '').toLowerCase();
    const thresholdPrice = Number(body.threshold_price);
    const alertId = body.alert_id ? Number(body.alert_id) : null;

    // Validation
    if (!GOLD_KARATS.has(karat)) {
      return NextResponse.json(
        { success: false, error: 'karat must be 24, 21, or 18' },
        { status: 400 }
      );
    }
    if (!GOLD_CONDITIONS.has(condition)) {
      return NextResponse.json(
        { success: false, error: "condition must be 'above' or 'below'" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(thresholdPrice) || thresholdPrice <= 0) {
      return NextResponse.json(
        { success: false, error: 'threshold_price must be a positive number' },
        { status: 400 }
      );
    }

    const db = await getFinanceDb();
    ensureGoldAlertsTable(db);

    let resultAlertId: number;
    let mode: 'created' | 'updated';

    if (alertId) {
      // Update existing — تحقق إنه ملك المستخدم
      const existing = db.prepare(
        `SELECT id FROM gold_alerts WHERE id = ? AND user_id = ? LIMIT 1`
      ).get(alertId, userId) as { id: number } | undefined;
      if (!existing) {
        return NextResponse.json(
          { success: false, error: 'Alert not found or not owned by user' },
          { status: 404 }
        );
      }
      db.prepare(
        `UPDATE gold_alerts
         SET karat = ?, condition = ?, threshold_price = ?, is_active = 1
         WHERE id = ?`
      ).run(karat, condition, thresholdPrice, alertId);
      resultAlertId = alertId;
      mode = 'updated';
    } else {
      // Create new
      const result = db.prepare(
        `INSERT INTO gold_alerts (user_id, karat, condition, threshold_price, is_active)
         VALUES (?, ?, ?, ?, 1)`
      ).run(userId, karat, condition, thresholdPrice);
      resultAlertId = Number(result.lastInsertRowid);
      mode = 'created';
    }

    const prices = fetchCurrentPrices();
    const currentPrice = karat === 24 ? prices['24k'] : karat === 21 ? prices['21k'] : prices['18k'];

    return NextResponse.json({
      success: true,
      mode,
      alert: {
        id: resultAlertId,
        user_id: userId,
        karat,
        condition,
        threshold_price: thresholdPrice,
        is_active: true,
        current_price: currentPrice,
      },
      message: mode === 'created'
        ? `تم إنشاء تنبيه ذهب عيار ${karat}: ${condition === 'above' ? 'فوق' : 'تحت'} ${thresholdPrice.toFixed(2)} ج.م`
        : `تم تحديث تنبيه ذهب عيار ${karat}`,
    });
  } catch (e) {
    console.error('[POST /api/alerts/gold] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — soft delete (is_active=0)
// ---------------------------------------------------------------------------

interface DeleteBody {
  alert_id?: number;
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    let alertId = Number(url.searchParams.get('alert_id') || 0);

    // لو مفيش query param، اقرأ من body
    if (!alertId) {
      const body: DeleteBody = await req.json().catch(() => ({}));
      alertId = Number(body.alert_id || 0);
    }

    if (!alertId || alertId <= 0) {
      return NextResponse.json(
        { success: false, error: 'alert_id is required' },
        { status: 400 }
      );
    }

    const db = await getFinanceDb();
    ensureGoldAlertsTable(db);

    // تحقق إن التنبيه ملك المستخدم قبل الحذف
    const existing = db.prepare(
      `SELECT id FROM gold_alerts WHERE id = ? AND user_id = ? LIMIT 1`
    ).get(alertId, userId) as { id: number } | undefined;
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Alert not found or not owned by user' },
        { status: 404 }
      );
    }

    db.prepare(
      `UPDATE gold_alerts SET is_active = 0 WHERE id = ?`
    ).run(alertId);

    return NextResponse.json({
      success: true,
      message: 'تم حذف تنبيه الذهب',
      alert_id: alertId,
    });
  } catch (e) {
    console.error('[DELETE /api/alerts/gold] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

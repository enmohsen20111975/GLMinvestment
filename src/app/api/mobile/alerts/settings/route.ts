/**
 * Mobile Alert Settings API
 * =========================
 * نظام إعدادات التنبيهات
 *
 * GET /api/mobile/alerts/settings - جلب إعدادات التنبيهات
 * POST /api/mobile/alerts/settings - إنشاء تنبيه جديد
 * DELETE /api/mobile/alerts/settings - حذف تنبيه
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { getFinanceDb } from '@/lib/finance-db';

/**
 * الحصول على user_id من Bearer token
 */
async function getUserIdFromToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!token) return null;

  try {
    const apiToken = await db.apiToken.findUnique({
      where: { token },
      select: { user_id: true, expires_at: true },
    });

    if (!apiToken || apiToken.expires_at < new Date()) {
      return null;
    }

    return apiToken.user_id;
  } catch {
    return null;
  }
}

/**
 * GET /api/mobile/alerts/settings
 * جلب كل إعدادات التنبيهات للمستخدم
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserIdFromToken(request);

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', error_ar: 'يجب تسجيل الدخول' },
        { status: 401 }
      );
    }

    const financeDb = await getFinanceDb();

    // إنشاء جدول التنبيهات لو مش موجود
    try {
      financeDb.run(`
        CREATE TABLE IF NOT EXISTS alert_settings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          ticker TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          target_value REAL,
          is_active INTEGER DEFAULT 1,
          notify_push INTEGER DEFAULT 1,
          notify_email INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          triggered_at TEXT
        )
      `);
    } catch (e) { /* table exists */ }

    // إنشاء جدول سجل التنبيهات
    try {
      financeDb.run(`
        CREATE TABLE IF NOT EXISTS alert_history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          ticker TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          message TEXT,
          message_ar TEXT,
          current_value REAL,
          target_value REAL,
          sent_at TEXT DEFAULT (datetime('now')),
          is_read INTEGER DEFAULT 0
        )
      `);
    } catch (e) { /* table exists */ }

    // جلب الإعدادات
    const settings = financeDb
      .prepare('SELECT * FROM alert_settings WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC')
      .all(userId) as Record<string, unknown>[];

    // جلب آخر التنبيهات
    const recentAlerts = financeDb
      .prepare('SELECT * FROM alert_history WHERE user_id = ? ORDER BY sent_at DESC LIMIT 20')
      .all(userId) as Record<string, unknown>[];

    return NextResponse.json({
      success: true,
      settings: settings.map(s => ({
        id: s.id,
        ticker: s.ticker,
        alert_type: s.alert_type,
        target_value: s.target_value,
        is_active: s.is_active === 1,
        notify_push: s.notify_push === 1,
        notify_email: s.notify_email === 1,
        created_at: s.created_at,
        triggered_at: s.triggered_at
      })),
      recent_alerts: recentAlerts.map(a => ({
        id: a.id,
        ticker: a.ticker,
        alert_type: a.alert_type,
        message: a.message,
        message_ar: a.message_ar,
        current_value: a.current_value,
        target_value: a.target_value,
        sent_at: a.sent_at,
        is_read: a.is_read === 1
      })),
      alert_types: [
        { type: 'price_above', name: 'السعر أعلى من', name_en: 'Price Above', needs_value: true, value_type: 'price' },
        { type: 'price_below', name: 'السعر أقل من', name_en: 'Price Below', needs_value: true, value_type: 'price' },
        { type: 'change_percent_up', name: 'صعود بنسبة %', name_en: 'Change % Up', needs_value: true, value_type: 'percent' },
        { type: 'change_percent_down', name: 'هبوط بنسبة %', name_en: 'Change % Down', needs_value: true, value_type: 'percent' },
        { type: 'rsi_overbought', name: 'RSI تشبع شرائي', name_en: 'RSI Overbought', needs_value: false, value_type: null },
        { type: 'rsi_oversold', name: 'RSI تشبع بيعي', name_en: 'RSI Oversold', needs_value: false, value_type: null },
        { type: 'signal_buy', name: 'إشارة شراء', name_en: 'Buy Signal', needs_value: false, value_type: null },
        { type: 'signal_sell', name: 'إشارة بيع', name_en: 'Sell Signal', needs_value: false, value_type: null },
        { type: 'support_break', name: 'كسر الدعم', name_en: 'Support Break', needs_value: false, value_type: null },
        { type: 'resistance_break', name: 'كسر المقاومة', name_en: 'Resistance Break', needs_value: false, value_type: null }
      ]
    });

  } catch (error) {
    console.error('[GET /api/mobile/alerts/settings] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get alert settings', detail: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/alerts/settings
 * إنشاء تنبيه جديد
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserIdFromToken(request);

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', error_ar: 'يجب تسجيل الدخول' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { ticker, alert_type, target_value, notify_push, notify_email } = body;

    if (!ticker || !alert_type) {
      return NextResponse.json(
        { success: false, error: 'ticker and alert_type are required' },
        { status: 400 }
      );
    }

    const financeDb = await getFinanceDb();

    // إنشاء الجدول لو مش موجود
    try {
      financeDb.run(`
        CREATE TABLE IF NOT EXISTS alert_settings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          ticker TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          target_value REAL,
          is_active INTEGER DEFAULT 1,
          notify_push INTEGER DEFAULT 1,
          notify_email INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          triggered_at TEXT
        )
      `);
    } catch (e) { /* table exists */ }

    // توليد ID
    const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // إضافة التنبيه
    financeDb.prepare(`
      INSERT INTO alert_settings (id, user_id, ticker, alert_type, target_value, notify_push, notify_email)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      ticker.toUpperCase(),
      alert_type,
      target_value || null,
      notify_push !== false ? 1 : 0,
      notify_email ? 1 : 0
    );

    return NextResponse.json({
      success: true,
      alert: {
        id,
        ticker: ticker.toUpperCase(),
        alert_type,
        target_value: target_value || null,
        notify_push: notify_push !== false,
        notify_email: notify_email === true
      },
      message: 'تم إنشاء التنبيه بنجاح'
    });

  } catch (error) {
    console.error('[POST /api/mobile/alerts/settings] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create alert', detail: String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mobile/alerts/settings?id=<alert_id>
 * حذف تنبيه
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserIdFromToken(request);

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', error_ar: 'يجب تسجيل الدخول' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const alertId = searchParams.get('id');

    if (!alertId) {
      return NextResponse.json(
        { success: false, error: 'Alert ID required' },
        { status: 400 }
      );
    }

    const financeDb = await getFinanceDb();

    // حذف (إلغاء تفعيل) التنبيه
    financeDb.prepare(`
      UPDATE alert_settings
      SET is_active = 0
      WHERE id = ? AND user_id = ?
    `).run(alertId, userId);

    return NextResponse.json({
      success: true,
      message: 'تم حذف التنبيه'
    });

  } catch (error) {
    console.error('[DELETE /api/mobile/alerts/settings] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete alert', detail: String(error) },
      { status: 500 }
    );
  }
}

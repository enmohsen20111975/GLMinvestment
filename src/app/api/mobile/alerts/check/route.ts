/**
 * Mobile Alerts Check API
 * =======================
 * فحص التنبيهات (للـ Cron Job)
 *
 * GET /api/mobile/alerts/check
 *
 * فحص كل التنبيهات النشطة وإرجاع اللي تحققت
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { pythonFetch } from '@/lib/python-backend';

// Token داخلي للـ Cron Job
const INTERNAL_TOKEN = process.env.CRON_SECRET || '';

/**
 * التحقق من Token الداخلي
 */
function isInternalRequest(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  return token === INTERNAL_TOKEN;
}

/**
 * GET /api/mobile/alerts/check
 * فحص كل التنبيهات
 */
export async function GET(request: NextRequest) {
  try {
    // التحقق من الصلاحية
    if (!isInternalRequest(request)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const financeDb = await getFinanceDb();

    // إنشاء الجداول لو مش موجودة
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

    // جلب كل التنبيهات النشطة
    const alerts = financeDb
      .prepare('SELECT * FROM alert_settings WHERE is_active = 1')
      .all() as Record<string, unknown>[];

    if (alerts.length === 0) {
      return NextResponse.json({
        success: true,
        triggered_alerts: [],
        checked_count: 0
      });
    }

    // جلب الأسعار الحالية من data_engine.db + RSI من stocks.db
    const { getDataEngineDb, getStocksDb } = await import('@/lib/data-engine-db');
    const dataDb = getDataEngineDb();
    const stocksDb = getStocksDb();

    // تجميع الأسهم المطلوبة
    const tickers = [...new Set(alerts.map(a => String(a.ticker)))];
    const prices: Record<string, { current: number; previous: number; rsi: number | null }> = {};

    for (const ticker of tickers) {
      try {
        // السعر الحالي من data_engine.db
        const row = dataDb.prepare(`
          SELECT price as current_price, change_percent
          FROM stocks
          WHERE symbol = ? COLLATE NOCASE
        `).get(ticker) as { current_price: number; change_percent: number } | undefined;

        // RSI من stocks.db
        const techRow = stocksDb.prepare(`
          SELECT rsi FROM stocks WHERE ticker = ? COLLATE NOCASE
        `).get(ticker) as { rsi: number | null } | undefined;

        if (row) {
          const current = row.current_price || 0;
          const changePercent = row.change_percent || 0;
          // احسب previous من change_percent
          const previous = changePercent !== 0
            ? current / (1 + changePercent / 100)
            : current;

          prices[ticker] = {
            current,
            previous,
            rsi: techRow?.rsi ?? null,
          };
        }
      } catch {
        // Skip if not found
      }
    }

    // جلب التحليل من Python للإشارات
    const signals: Record<string, { signal: string; support: number | null; resistance: number | null }> = {};

    for (const ticker of tickers) {
      try {
        const result = await pythonFetch<any>(`/api/analysis/${ticker}`);
        if (result.success && result.data) {
          signals[ticker] = {
            signal: result.data.signal || 'NEUTRAL',
            support: result.data.technical?.support || null,
            resistance: result.data.technical?.resistance || null
          };
        }
      } catch {
        // Skip
      }
    }

    // فحص كل تنبيه
    const triggeredAlerts: Array<{
      id: string;
      user_id: string;
      ticker: string;
      alert_type: string;
      message: string;
      message_ar: string;
      current_value: number;
      target_value: number | null;
      priority: string;
    }> = [];

    for (const alert of alerts) {
      const ticker = String(alert.ticker);
      const priceData = prices[ticker];
      const signalData = signals[ticker];

      if (!priceData) continue;

      const currentPrice = priceData.current;
      const previousPrice = priceData.previous;
      const rsi = priceData.rsi;
      const targetType = String(alert.alert_type);
      const targetValue = alert.target_value ? Number(alert.target_value) : null;

      let triggered = false;
      let message = '';
      let messageAr = '';
      let priority = 'medium';

      switch (targetType) {
        case 'price_above':
          if (targetValue && currentPrice >= targetValue) {
            triggered = true;
            message = `${ticker} reached ${currentPrice.toFixed(2)} (target: ${targetValue})`;
            messageAr = `${ticker} وصل لـ ${currentPrice.toFixed(2)} (الهدف: ${targetValue})`;
            priority = 'high';
          }
          break;

        case 'price_below':
          if (targetValue && currentPrice <= targetValue) {
            triggered = true;
            message = `${ticker} dropped to ${currentPrice.toFixed(2)} (target: ${targetValue})`;
            messageAr = `${ticker} هبط لـ ${currentPrice.toFixed(2)} (الهدف: ${targetValue})`;
            priority = 'high';
          }
          break;

        case 'change_percent_up':
          if (targetValue && previousPrice > 0) {
            const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;
            if (changePercent >= targetValue) {
              triggered = true;
              message = `${ticker} up ${changePercent.toFixed(1)}%`;
              messageAr = `${ticker} صعد ${changePercent.toFixed(1)}%`;
              priority = 'medium';
            }
          }
          break;

        case 'change_percent_down':
          if (targetValue && previousPrice > 0) {
            const changePercent = ((previousPrice - currentPrice) / previousPrice) * 100;
            if (changePercent >= targetValue) {
              triggered = true;
              message = `${ticker} down ${changePercent.toFixed(1)}%`;
              messageAr = `${ticker} هبط ${changePercent.toFixed(1)}%`;
              priority = 'high';
            }
          }
          break;

        case 'rsi_overbought':
          if (rsi !== null && rsi >= 70) {
            triggered = true;
            message = `${ticker} RSI overbought at ${rsi.toFixed(0)}`;
            messageAr = `${ticker} تشبع شرائي (RSI: ${rsi.toFixed(0)})`;
            priority = 'medium';
          }
          break;

        case 'rsi_oversold':
          if (rsi !== null && rsi <= 30) {
            triggered = true;
            message = `${ticker} RSI oversold at ${rsi.toFixed(0)}`;
            messageAr = `${ticker} تشبع بيعي (RSI: ${rsi.toFixed(0)}) - فرصة شراء؟`;
            priority = 'medium';
          }
          break;

        case 'signal_buy':
          if (signalData && (signalData.signal === 'BUY' || signalData.signal === 'BULLISH')) {
            triggered = true;
            message = `${ticker} buy signal detected`;
            messageAr = `${ticker} إشارة شراء`;
            priority = 'medium';
          }
          break;

        case 'signal_sell':
          if (signalData && (signalData.signal === 'SELL' || signalData.signal === 'BEARISH')) {
            triggered = true;
            message = `${ticker} sell signal detected`;
            messageAr = `${ticker} إشارة بيع`;
            priority = 'high';
          }
          break;

        case 'support_break':
          if (signalData?.support && currentPrice < signalData.support * 0.99) {
            triggered = true;
            message = `${ticker} broke support at ${signalData.support.toFixed(2)}`;
            messageAr = `${ticker} كسر الدعم عند ${signalData.support.toFixed(2)}`;
            priority = 'high';
          }
          break;

        case 'resistance_break':
          if (signalData?.resistance && currentPrice > signalData.resistance * 1.01) {
            triggered = true;
            message = `${ticker} broke resistance at ${signalData.resistance.toFixed(2)}`;
            messageAr = `${ticker} كسر المقاومة عند ${signalData.resistance.toFixed(2)}`;
            priority = 'medium';
          }
          break;
      }

      if (triggered) {
        // تسجيل التنبيه
        const historyId = `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        financeDb.prepare(`
          INSERT INTO alert_history (id, user_id, ticker, alert_type, message, message_ar, current_value, target_value)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          historyId,
          String(alert.user_id),
          ticker,
          targetType,
          message,
          messageAr,
          currentPrice,
          targetValue
        );

        // تحديث وقت التفعيل
        financeDb.prepare(`
          UPDATE alert_settings
          SET triggered_at = datetime('now')
          WHERE id = ?
        `).run(String(alert.id));

        triggeredAlerts.push({
          id: String(alert.id),
          user_id: String(alert.user_id),
          ticker,
          alert_type: targetType,
          message,
          message_ar: messageAr,
          current_value: currentPrice,
          target_value: targetValue,
          priority
        });
      }
    }

    return NextResponse.json({
      success: true,
      triggered_alerts: triggeredAlerts,
      checked_count: alerts.length,
      triggered_count: triggeredAlerts.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[GET /api/mobile/alerts/check] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check alerts', detail: String(error) },
      { status: 500 }
    );
  }
}

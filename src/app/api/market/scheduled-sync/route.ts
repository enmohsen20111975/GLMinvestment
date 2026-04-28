/**
 * POST /api/market/scheduled-sync
 *
 * نقطة نهاية للمزامنة الدورية للبيانات من مصادر متعددة
 * يتم استدعاؤها كل ساعة خلال أيام التداول (10:00 - 15:00 بتوقيت القاهرة)
 *
 * مصادر البيانات (بترتيب الأولوية):
 * 1. Twelve Data API (800 طلب/يوم)
 * 2. Alpha Vantage API (25 طلب/يوم)
 * 3. Mubasher scraping (احتياطي)
 * 4. Web Search (الملاذ الأخير)
 *
 * الوظائف:
 * 1. جلب بيانات الأسعار الحالية لأكثر 50 سهم نشاطاً
 * 2. التحقق من صحة البيانات قبل التحديث
 * 3. تحديث جدول stocks في قواعد البيانات الخفيفة والثقيلة
 * 4. إدراج سجلات تاريخ الأسعار (OHLCV)
 * 5. إرجاع ملخص ما تم تحديثه مع حالة مصادر البيانات
 */

import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStocks, getWritableDb, isWritableDbAvailable } from '@/lib/egx-db';
import {
  upsertPriceHistory,
  getTodayCairo,
  sleep,
} from '@/lib/data-sync';
import {
  fetchStockData,
  fetchHistoricalData,
  getDataSourceStatus,
  getDetailedSourceHealth,
  type UnifiedStockData,
} from '@/lib/data-adapter';
import { getFinanceDb } from '@/lib/finance-db';

export const maxDuration = 120; // 2 دقيقة كحد أقصى

// ---------------------------------------------------------------------------
// حالة المزامنة — منع التشغيل المتزامن
// ---------------------------------------------------------------------------

let isSyncRunning = false;
let lastSyncResult: ScheduledSyncResponse | null = null;
const LAST_SYNC_KEY = 'last_scheduled_sync';

// ---------------------------------------------------------------------------
// أنواع البيانات
// ---------------------------------------------------------------------------

interface StockSyncResult {
  ticker: string;
  stock_id: number;
  success: boolean;
  current_price: number;
  previous_price: number;
  price_changed: boolean;
  history_inserted: number;
  history_skipped: number;
  source: string;
  error?: string;
}

interface ScheduledSyncResponse {
  success: boolean;
  message: string;
  started_at: string;
  completed_at: string;
  is_running: boolean;
  configuration: {
    max_stocks: number;
    request_delay_ms: number;
    cairo_timezone: string;
    trading_hours: string;
    cron_schedule: string;
  };
  summary: {
    total_stocks_attempted: number;
    price_updated: number;
    price_unchanged: number;
    fetch_failed: number;
    total_history_inserted: number;
    total_history_skipped: number;
    elapsed_ms: number;
  };
  results: StockSyncResult[];
  next_sync_recommended_at: string;
}

// ---------------------------------------------------------------------------
// ثوابت الإعدادات
// ---------------------------------------------------------------------------

const MAX_STOCKS = 50;         // الحد الأقصى للأسهم
const REQUEST_DELAY_MS = 2500; // 2.5 ثانية بين كل طلب (لتجنب الحظر)
const CAIRO_OFFSET_HOURS = 2;  // فرق التوقيت عن UTC

// ---------------------------------------------------------------------------
// التحقق من أوقات التداول
// ---------------------------------------------------------------------------

function getCairoTime(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + CAIRO_OFFSET_HOURS * 3600000);
}

function isTradingHours(): boolean {
  const cairo = getCairoTime();
  const day = cairo.getUTCDay(); // 0=الأحد, 4=الخميس
  const hour = cairo.getUTCHours();

  // أيام التداول: الأحد - الخميس
  if (day < 0 || day > 4) return false;

  // ساعات التداول: 10:00 - 15:00
  return hour >= 10 && hour < 15;
}

function getNextTradingSyncTime(): string {
  const now = getCairoTime();

  // إذا كان اليوم يوم تداول وكان الوقت قبل 15:00
  if (now.getUTCDay() >= 0 && now.getUTCDay() <= 4 && now.getUTCHours() < 15) {
    const next = new Date(now.getTime() + 60 * 60 * 1000); // بعد ساعة
    return next.toISOString();
  }

  // إذا كان بعد ساعات التداول أو في عطلة نهاية الأسبوع — الانتقال ليوم الأحد القادم
  const daysUntilSunday = now.getUTCDay() === 5 ? 2 : now.getUTCDay() === 6 ? 1 : 0;
  const nextSunday = new Date(now.getTime() + (daysUntilSunday * 24 + (10 - now.getUTCHours())) * 3600000);
  return nextSunday.toISOString();
}

// ---------------------------------------------------------------------------
// معالجة سهم واحد
// ---------------------------------------------------------------------------

async function processStockForSync(
  ticker: string,
  stockId: number
): Promise<StockSyncResult> {
  const result: StockSyncResult = {
    ticker,
    stock_id: stockId,
    success: false,
    current_price: 0,
    previous_price: 0,
    price_changed: false,
    history_inserted: 0,
    history_skipped: 0,
    source: '',
  };

  let heavyDb: ReturnType<typeof getWritableDb> | null = null;
  let lightDb: Awaited<ReturnType<typeof getFinanceDb>> | null = null;

  try {
    // Use singleton for heavy DB (egx_investment.db, 55MB cached)
    if (isWritableDbAvailable()) {
      heavyDb = getWritableDb();
    }

    // Use singleton for light DB (custom.db, ~200KB cached)
    lightDb = await getFinanceDb();
    if (!lightDb) {
      result.error = 'Light DB not available';
      return result;
    }

    // الحصول على السعر القديم
    const oldRow = lightDb.prepare(
      'SELECT current_price FROM stocks WHERE ticker = ? COLLATE NOCASE'
    ).get(ticker) as { current_price: number } | undefined;

    const oldPrice = oldRow?.current_price || 0;
    result.previous_price = oldPrice;

    // جلب بيانات السهم من Data Adapter (Twelve Data → Alpha Vantage → Mubasher → Web Search)
    const stockData = await fetchStockData(ticker);

    if (!stockData) {
      result.error = 'فشل في جلب البيانات من جميع المصادر';
      return result;
    }

    result.source = stockData.source;
    result.current_price = stockData.current_price;

    // جلب البيانات التاريخية
    const historicalPrices = await fetchHistoricalData(ticker, 30);
    const today = getTodayCairo();

    // === تحديث قاعدة البيانات الثقيلة ===
    if (heavyDb) {
      try {
        const heavyTx = heavyDb.transaction(() => {
          // تحديث جدول stocks
          const updateStmt = heavyDb.prepare(`
            UPDATE stocks
            SET previous_close = ?,
                current_price = ?,
                open_price = ?,
                high_price = ?,
                low_price = ?,
                volume = ?,
                last_update = ?
            WHERE id = ?
          `);
          const updateResult = updateStmt.run(
            oldPrice > 0 ? oldPrice : (stockData.previous_close || stockData.current_price),
            stockData.current_price,
            stockData.open_price,
            stockData.high_price,
            stockData.low_price,
            stockData.volume,
            new Date().toISOString(),
            stockId
          );
          result.price_changed = updateResult.changes > 0;

          // إدراج البيانات التاريخية
          for (const price of historicalPrices) {
            const { inserted } = upsertPriceHistory(heavyDb, stockId, price.date, {
              open_price: price.open,
              high_price: price.high,
              low_price: price.low,
              close_price: price.close,
              volume: price.volume,
            });
            if (inserted) result.history_inserted++;
            else result.history_skipped++;
          }

          // إدراج بيانات اليوم إذا لم تكن موجودة
          if (historicalPrices.length === 0) {
            const { inserted } = upsertPriceHistory(heavyDb, stockId, today, {
              open_price: stockData.open_price,
              high_price: stockData.high_price,
              low_price: stockData.low_price,
              close_price: stockData.current_price,
              volume: stockData.volume,
            });
            if (inserted) result.history_inserted++;
            else result.history_skipped++;
          }
        });
        heavyTx();
      } catch (heavyErr) {
        console.error(`[ScheduledSync] Heavy DB update failed for ${ticker}:`, heavyErr);
        result.error = `فشل تحديث DB الثقيلة: ${String(heavyErr)}`;
      }
    }

    // === تحديث قاعدة البيانات الخفيفة ===
    try {
      const lightTx = lightDb.transaction(() => {
        const updateStmt = lightDb.prepare(`
          UPDATE stocks
          SET previous_close = ?,
              current_price = ?,
              open_price = ?,
              high_price = ?,
              low_price = ?,
              volume = ?,
              last_update = ?
          WHERE ticker = ? COLLATE NOCASE
        `);
        updateStmt.run(
          oldPrice > 0 ? oldPrice : (stockData.previous_close || stockData.current_price),
          stockData.current_price,
          stockData.open_price,
          stockData.high_price,
          stockData.low_price,
          stockData.volume,
          new Date().toISOString(),
          ticker
        );
      });
      lightTx();
      result.success = true;
    } catch (lightErr) {
      console.error(`[ScheduledSync] Light DB update failed for ${ticker}:`, lightErr);
      result.error = `فشل تحديث DB الخفيفة: ${String(lightErr)}`;
    }
  } catch (err) {
    result.error = String(err);
    console.error(`[ScheduledSync] Error processing ${ticker}:`, err);
  }
  // Don't close singleton DBs — they persist across requests

  return result;
}

// ---------------------------------------------------------------------------
// POST handler — تنفيذ المزامنة المجدولة
// ---------------------------------------------------------------------------

export async function POST(_request: NextRequest) {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // التحقق من عدم وجود مزامنة جارية
  if (isSyncRunning) {
    return NextResponse.json({
      success: false,
      message: 'توجد مزامنة جارية بالفعل. يرجى الانتظار حتى تكتمل.',
      is_running: true,
      progress: lastSyncResult ? {
        processed: lastSyncResult.summary.total_stocks_attempted,
        total: MAX_STOCKS,
      } : null,
    } as Partial<ScheduledSyncResponse>, { status: 429 });
  }

  isSyncRunning = true;

  try {
    // التأكد من تهيئة sql.js
    await ensureInitialized();

    // جلب أكثر 50 سهم نشاطاً من قاعدة البيانات الخفيفة
    const allStocksResult = getStocks({
      page_size: MAX_STOCKS,
      is_active: true,
    });

    const stocksToSync = allStocksResult.stocks
      .filter((s) => s.ticker && Number(s.volume) > 0)
      .slice(0, MAX_STOCKS)
      .map((s) => ({
        ticker: String(s.ticker),
        id: Number(s.id),
        current_price: Number(s.current_price) || 0,
      }));

    if (stocksToSync.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'لا توجد أسهم نشطة للمزامنة',
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        is_running: false,
        configuration: {
          max_stocks: MAX_STOCKS,
          request_delay_ms: REQUEST_DELAY_MS,
          cairo_timezone: 'UTC+2',
          trading_hours: '10:00 - 15:00',
          cron_schedule: '0 10-14 * * 0-4',
        },
        summary: {
          total_stocks_attempted: 0,
          price_updated: 0,
          price_unchanged: 0,
          fetch_failed: 0,
          total_history_inserted: 0,
          total_history_skipped: 0,
          elapsed_ms: Date.now() - startTime,
        },
        results: [],
        next_sync_recommended_at: getNextTradingSyncTime(),
      } satisfies ScheduledSyncResponse);
    }

    // === تنفيذ المزامنة ===
    const results: StockSyncResult[] = [];
    const tradingHours = isTradingHours();

    for (let i = 0; i < stocksToSync.length; i++) {
      const { ticker, id } = stocksToSync[i];

      try {
        const stockResult = await processStockForSync(ticker, id);
        results.push(stockResult);
      } catch (err) {
        results.push({
          ticker,
          stock_id: id,
          success: false,
          current_price: 0,
          previous_price: 0,
          price_changed: false,
          history_inserted: 0,
          history_skipped: 0,
          source: '',
          error: String(err),
        });
      }

      // تأخير بين الطلبات (باستثناء الأخير)
      if (i < stocksToSync.length - 1) {
        await sleep(REQUEST_DELAY_MS);
      }

      // تحديث التقدم كل 10 أسهم
      if ((i + 1) % 10 === 0) {
        console.log(`[ScheduledSync] Progress: ${i + 1}/${stocksToSync.length}`);
      }
    }

    // === بناء الاستجابة ===
    const priceUpdated = results.filter((r) => r.price_changed).length;
    const priceUnchanged = results.filter((r) => r.success && !r.price_changed).length;
    const fetchFailed = results.filter((r) => !r.success).length;
    const totalHistoryInserted = results.reduce((s, r) => s + r.history_inserted, 0);
    const totalHistorySkipped = results.reduce((s, r) => s + r.history_skipped, 0);
    const elapsedMs = Date.now() - startTime;

    const response: ScheduledSyncResponse = {
      success: priceUpdated > 0 || priceUnchanged > 0,
      message: `تمت مزامنة ${results.length} سهم: ${priceUpdated} محدث، ${priceUnchanged} بدون تغيير، ${fetchFailed} فشل. ${tradingHours ? '✓ أوقات التداول' : '⚠ خارج أوقات التداول'}`,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      is_running: false,
      configuration: {
        max_stocks: MAX_STOCKS,
        request_delay_ms: REQUEST_DELAY_MS,
        cairo_timezone: 'UTC+2',
        trading_hours: '10:00 - 15:00',
        cron_schedule: '0 10-14 * * 0-4',
      },
      summary: {
        total_stocks_attempted: results.length,
        price_updated: priceUpdated,
        price_unchanged: priceUnchanged,
        fetch_failed: fetchFailed,
        total_history_inserted: totalHistoryInserted,
        total_history_skipped: totalHistorySkipped,
        elapsed_ms: elapsedMs,
      },
      results,
      next_sync_recommended_at: getNextTradingSyncTime(),
    };

    lastSyncResult = response;

    return NextResponse.json(response);
  } catch (error) {
    console.error('[POST /api/market/scheduled-sync] Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: `فشل المزامنة المجدولة: ${String(error)}`,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        is_running: false,
        configuration: {
          max_stocks: MAX_STOCKS,
          request_delay_ms: REQUEST_DELAY_MS,
          cairo_timezone: 'UTC+2',
          trading_hours: '10:00 - 15:00',
          cron_schedule: '0 10-14 * * 0-4',
        },
        summary: {
          total_stocks_attempted: 0,
          price_updated: 0,
          price_unchanged: 0,
          fetch_failed: 0,
          total_history_inserted: 0,
          total_history_skipped: 0,
          elapsed_ms: Date.now() - startTime,
        },
        results: [],
        next_sync_recommended_at: getNextTradingSyncTime(),
      } satisfies ScheduledSyncResponse,
      { status: 500 }
    );
  } finally {
    isSyncRunning = false;
  }
}

// ---------------------------------------------------------------------------
// GET handler — حالة آخر مزامنة
// ---------------------------------------------------------------------------

export async function GET() {
  const now = getCairoTime();
  const tradingHours = isTradingHours();

  return NextResponse.json({
    last_sync: lastSyncResult ? {
      completed_at: lastSyncResult.completed_at,
      success: lastSyncResult.success,
      message: lastSyncResult.message,
      stocks_updated: lastSyncResult.summary.price_updated,
      stocks_failed: lastSyncResult.summary.fetch_failed,
      history_inserted: lastSyncResult.summary.total_history_inserted,
      elapsed_ms: lastSyncResult.summary.elapsed_ms,
    } : null,
    current_cairo_time: now.toISOString(),
    is_trading_hours: tradingHours,
    is_sync_running: isSyncRunning,
    recommended_cron: '0 10-14 * * 0-4',
    next_sync_recommended_at: getNextTradingSyncTime(),
    data_sources: getDataSourceStatus(),
    data_source_health: getDetailedSourceHealth(),
  });
}

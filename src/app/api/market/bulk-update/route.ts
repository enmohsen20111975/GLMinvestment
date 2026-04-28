import { NextRequest, NextResponse } from 'next/server';
import {
  fetchStockDataFromMubasher,
  parseStockPriceData,
  parseHistoricalFromHtml,
  getWritableDatabase,
  upsertPriceHistory,
  getTodayCairo,
  sleep,
  type StockCurrentData,
} from '@/lib/data-sync';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StockUpdateResult {
  ticker: string;
  stock_id: number;
  success: boolean;
  current_price: number;
  previous_price: number;
  price_changed: boolean;
  history_inserted: number;
  history_skipped: number;
  error?: string;
}

interface BulkUpdateResponse {
  success: boolean;
  message: string;
  started_at: string;
  completed_at: string;
  is_running: boolean;
  total_stocks: number;
  processed_stocks: number;
  batch_number: number;
  batch_size: number;
  total_batches: number;
  summary: {
    price_updated: number;
    price_unchanged: number;
    failed: number;
    total_history_inserted: number;
    total_history_skipped: number;
  };
  results: StockUpdateResult[];
  errors: string[];
}

interface CacheEntry {
  data: BulkUpdateResponse;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// State management — prevent concurrent execution
// ---------------------------------------------------------------------------

let isBulkUpdateRunning = false;
let bulkUpdateProgress: BulkUpdateResponse | null = null;

// Cache for 5 minutes
const bulkCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;
const REQUEST_DELAY_MS = 2000; // 2 seconds between stock fetches

// ---------------------------------------------------------------------------
// Process a single stock — fetch, parse, and update DB
// ---------------------------------------------------------------------------

async function processSingleStock(
  ticker: string,
  stockId: number
): Promise<StockUpdateResult> {
  const result: StockUpdateResult = {
    ticker,
    stock_id: stockId,
    success: false,
    current_price: 0,
    previous_price: 0,
    price_changed: false,
    history_inserted: 0,
    history_skipped: 0,
  };

  const db = getWritableDatabase();
  try {
    // Get old price
    const oldRow = db.prepare(
      'SELECT current_price, previous_close FROM stocks WHERE id = ?'
    ).get(stockId) as { current_price: number; previous_close: number } | undefined;

    const oldPrice = oldRow?.current_price || 0;
    result.previous_price = oldPrice;

    // Fetch stock page from Mubasher
    const pageData = await fetchStockDataFromMubasher(ticker);

    if (!pageData) {
      result.error = 'فشل في جلب بيانات السهم من الموقع';
      return result;
    }

    // Parse current price data
    const currentData = parseStockPriceData(pageData.html, ticker);

    if (!currentData) {
      result.error = 'فشل في تحليل بيانات السهم من الصفحة';
      return result;
    }

    result.current_price = currentData.current_price;

    // Parse historical data from the page
    const historicalPrices = parseHistoricalFromHtml(pageData.html, ticker);
    const today = getTodayCairo();

    // Run all DB updates in a transaction
    const updateTransaction = db.transaction(() => {
      // 1. Update stocks table
      if (oldPrice > 0 && Math.abs(oldPrice - currentData.current_price) < 0.001) {
        result.price_changed = false;
      } else {
        const updateStmt = db.prepare(`
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
          oldPrice > 0 ? oldPrice : (currentData.previous_close || currentData.current_price),
          currentData.current_price,
          currentData.open_price,
          currentData.high_price,
          currentData.low_price,
          currentData.volume,
          new Date().toISOString(),
          stockId
        );
        result.price_changed = updateResult.changes > 0;
      }

      // 2. Insert historical prices from the page
      for (const price of historicalPrices) {
        const { inserted } = upsertPriceHistory(db, stockId, price.date, {
          open_price: price.open_price,
          high_price: price.high_price,
          low_price: price.low_price,
          close_price: price.close_price,
          volume: price.volume,
        });
        if (inserted) {
          result.history_inserted++;
        } else {
          result.history_skipped++;
        }
      }

      // 3. Insert today's price history if we have current data and no historical for today
      if (historicalPrices.length === 0) {
        const { inserted } = upsertPriceHistory(db, stockId, today, {
          open_price: currentData.open_price,
          high_price: currentData.high_price,
          low_price: currentData.low_price,
          close_price: currentData.current_price,
          volume: currentData.volume,
        });
        if (inserted) {
          result.history_inserted++;
        } else {
          result.history_skipped++;
        }
      }
    });

    updateTransaction();
    result.success = true;
  } catch (err) {
    result.error = String(err);
    console.error(`[Bulk Update] Error processing ${ticker}:`, err);
  } finally {
    db.close();
  }

  return result;
}

// ---------------------------------------------------------------------------
// GET handler — Process a batch of stocks
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const batchNumber = parseInt(searchParams.get('batch') || '1', 10);
  const forceRefresh = searchParams.get('refresh') === 'true';

  // --- Check cache ---
  const cacheKey = `bulk-update-batch-${batchNumber}`;
  if (!forceRefresh) {
    const cached = bulkCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({
        ...cached.data,
        from_cache: true,
      });
    }
  }

  // --- Prevent concurrent execution ---
  if (isBulkUpdateRunning) {
    return NextResponse.json({
      success: false,
      message: 'يوجد تحديث جارٍ بالفعل. يرجى الانتظار حتى يكتمل التحديث الحالي.',
      is_running: true,
      progress: bulkUpdateProgress
        ? {
            processed_stocks: bulkUpdateProgress.processed_stocks,
            total_stocks: bulkUpdateProgress.total_stocks,
            batch_number: bulkUpdateProgress.batch_number,
          }
        : null,
    }, { status: 429 });
  }

  isBulkUpdateRunning = true;
  const startedAt = new Date().toISOString();

  try {
    // --- Get all active stocks ---
    const readDb = getWritableDatabase();
    let allStocks: Array<{ ticker: string; id: number; current_price: number }>;
    try {
      allStocks = readDb
        .prepare('SELECT ticker, id, current_price FROM stocks WHERE is_active = 1 ORDER BY ticker')
        .all() as Array<{ ticker: string; id: number; current_price: number }>;
    } finally {
      readDb.close();
    }

    const totalStocks = allStocks.length;
    const totalBatches = Math.ceil(totalStocks / BATCH_SIZE);

    // Determine batch range
    const startIdx = (batchNumber - 1) * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, totalStocks);
    const batchStocks = allStocks.slice(startIdx, endIdx);

    if (batchStocks.length === 0) {
      isBulkUpdateRunning = false;
      return NextResponse.json({
        success: false,
        message: `رقم الدفعة ${batchNumber} غير صالح. إجمالي الدفعات: ${totalBatches}`,
        is_running: false,
        total_stocks: totalStocks,
        total_batches: totalBatches,
      }, { status: 400 });
    }

    // --- Process batch ---
    const results: StockUpdateResult[] = [];
    const errors: string[] = [];

    for (let i = 0; i < batchStocks.length; i++) {
      const { ticker, id } = batchStocks[i];

      try {
        const stockResult = await processSingleStock(ticker, id);
        results.push(stockResult);

        if (!stockResult.success && stockResult.error) {
          errors.push(`${ticker}: ${stockResult.error}`);
        }

        // Update progress
        bulkUpdateProgress = {
          success: false,
          message: `جارٍ المعالجة...`,
          started_at: startedAt,
          completed_at: '',
          is_running: true,
          total_stocks: totalStocks,
          processed_stocks: startIdx + i + 1,
          batch_number: batchNumber,
          batch_size: batchStocks.length,
          total_batches: totalBatches,
          summary: {
            price_updated: results.filter((r) => r.price_changed).length,
            price_unchanged: results.filter((r) => r.success && !r.price_changed).length,
            failed: results.filter((r) => !r.success).length,
            total_history_inserted: results.reduce((s, r) => s + r.history_inserted, 0),
            total_history_skipped: results.reduce((s, r) => s + r.history_skipped, 0),
          },
          results,
          errors,
        };
      } catch (err) {
        errors.push(`${ticker}: ${String(err)}`);
        results.push({
          ticker,
          stock_id: id,
          success: false,
          current_price: 0,
          previous_price: 0,
          price_changed: false,
          history_inserted: 0,
          history_skipped: 0,
          error: String(err),
        });
      }

      // Rate limit
      if (i < batchStocks.length - 1) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    // --- Build final response ---
    const priceUpdated = results.filter((r) => r.price_changed).length;
    const priceUnchanged = results.filter((r) => r.success && !r.price_changed).length;
    const failed = results.filter((r) => !r.success).length;
    const totalHistoryInserted = results.reduce((s, r) => s + r.history_inserted, 0);
    const totalHistorySkipped = results.reduce((s, r) => s + r.history_skipped, 0);

    const response: BulkUpdateResponse = {
      success: results.some((r) => r.success),
      message: `تمت معالجة الدفعة ${batchNumber}/${totalBatches}: ${priceUpdated} محدث، ${priceUnchanged} بدون تغيير، ${failed} فشل`,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      is_running: false,
      total_stocks: totalStocks,
      processed_stocks: results.length,
      batch_number: batchNumber,
      batch_size: batchStocks.length,
      total_batches: totalBatches,
      summary: {
        price_updated: priceUpdated,
        price_unchanged: priceUnchanged,
        failed,
        total_history_inserted: totalHistoryInserted,
        total_history_skipped: totalHistorySkipped,
      },
      results,
      errors,
    };

    // Update progress and cache
    bulkUpdateProgress = response;
    bulkCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/market/bulk-update] Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: `فشل التحديث المجمع: ${String(error)}`,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        is_running: false,
        total_stocks: 0,
        processed_stocks: 0,
        batch_number: batchNumber,
        batch_size: 0,
        total_batches: 0,
        summary: {
          price_updated: 0,
          price_unchanged: 0,
          failed: 0,
          total_history_inserted: 0,
          total_history_skipped: 0,
        },
        results: [],
        errors: [`فشل عام: ${String(error)}`],
      },
      { status: 500 }
    );
  } finally {
    isBulkUpdateRunning = false;
    bulkUpdateProgress = null;
  }
}

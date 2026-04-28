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
  type ParsedStockPrice,
} from '@/lib/data-sync';
import {
  isVpsAvailable,
  fetchStockHistory,
  fetchStockQuote,
  type VpsHistoryPoint,
  type VpsStockQuote,
} from '@/lib/vps-adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncHistoricalRequest {
  tickers?: string[];
}

interface StockSyncResult {
  ticker: string;
  stock_id: number;
  success: boolean;
  current_data_updated: boolean;
  price_history_inserted: number;
  price_history_skipped: number;
  historical_from_vps: number;
  historical_from_page: number;
  source_used: string;
  error?: string;
}

interface SyncHistoricalResponse {
  success: boolean;
  message: string;
  fetched_at: string;
  requested_tickers: number;
  processed_tickers: number;
  total_price_history_inserted: number;
  total_price_history_skipped: number;
  total_stocks_updated: number;
  details: {
    results: StockSyncResult[];
    updated_tickers: string[];
    failed_tickers: string[];
    errors: string[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TICKERS_PER_REQUEST = 20;
const REQUEST_DELAY_MS = 2000; // 2 seconds between stock fetches
const HISTORY_DAYS = 90; // How many days of history to request from VPS

// ---------------------------------------------------------------------------
// Strategy 1: Fetch from VPS
// ---------------------------------------------------------------------------

/**
 * Attempt to fetch historical data and current price from the VPS service.
 * Returns both the history points and the current quote, or null on failure.
 */
async function fetchFromVps(
  ticker: string
): Promise<{
  history: VpsHistoryPoint[];
  quote: VpsStockQuote | null;
} | null> {
  try {
    // Fetch history and quote in parallel
    const [historyResult, quoteResult] = await Promise.all([
      fetchStockHistory(ticker, HISTORY_DAYS),
      fetchStockQuote(ticker),
    ]);

    const history = historyResult?.data || [];
    const quote = quoteResult?.data || null;

    if (history.length === 0 && !quote) {
      return null;
    }

    return { history, quote };
  } catch (err) {
    console.error(`[Sync Historical] VPS fetch error for ${ticker}:`, err);
    return null;
  }
}

/**
 * Convert VPS history points to the ParsedStockPrice format expected by DB writers.
 */
function vpsHistoryToParsedStockPrice(
  ticker: string,
  points: VpsHistoryPoint[]
): ParsedStockPrice[] {
  return points
    .filter((p) => p.date && p.close > 0)
    .map((p) => ({
      ticker: ticker.toUpperCase(),
      date: p.date, // Should already be YYYY-MM-DD
      open_price: p.open || p.close,
      high_price: p.high || p.close,
      low_price: p.low || p.close,
      close_price: p.close,
      volume: p.volume || 0,
      adjusted_close: p.adjusted_close || p.close,
    }));
}

/**
 * Convert VPS quote to StockCurrentData format.
 */
function vpsQuoteToStockCurrentData(quote: VpsStockQuote): StockCurrentData {
  return {
    ticker: quote.ticker.toUpperCase(),
    current_price: quote.current_price,
    open_price: quote.open || quote.current_price,
    high_price: quote.high || quote.current_price,
    low_price: quote.low || quote.current_price,
    volume: quote.volume || 0,
    change: quote.change,
    change_percent: quote.change_percent,
    previous_close: quote.previous_close,
  };
}

// ---------------------------------------------------------------------------
// Strategy 2: Fetch from Mubasher (existing logic)
// ---------------------------------------------------------------------------

async function fetchFromMubasher(
  ticker: string
): Promise<{
  currentData: StockCurrentData | null;
  historicalPrices: ParsedStockPrice[];
} | null> {
  try {
    const pageData = await fetchStockDataFromMubasher(ticker);

    if (!pageData) {
      return null;
    }

    const currentData = parseStockPriceData(pageData.html, ticker);
    const historicalPrices = parseHistoricalFromHtml(pageData.html, ticker);

    if (!currentData && historicalPrices.length === 0) {
      return null;
    }

    return { currentData, historicalPrices };
  } catch (err) {
    console.error(`[Sync Historical] Mubasher fetch error for ${ticker}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 3: Database fallback — return existing price history
// ---------------------------------------------------------------------------

function fetchFromDatabase(
  ticker: string,
  stockId: number
): {
  currentData: StockCurrentData | null;
  historicalPrices: ParsedStockPrice[];
} {
  try {
    const db = getWritableDatabase();
    try {
      // Get current data
      const stockRow = db
        .prepare(
          'SELECT current_price, open_price, high_price, low_price, volume, previous_close FROM stocks WHERE id = ?'
        )
        .get(stockId) as {
          current_price: number;
          open_price: number;
          high_price: number;
          low_price: number;
          volume: number;
          previous_close: number;
        } | undefined;

      let currentData: StockCurrentData | null = null;
      if (stockRow && stockRow.current_price > 0) {
        const prev = stockRow.previous_close || 0;
        currentData = {
          ticker,
          current_price: stockRow.current_price,
          open_price: stockRow.open_price || stockRow.current_price,
          high_price: stockRow.high_price || stockRow.current_price,
          low_price: stockRow.low_price || stockRow.current_price,
          volume: stockRow.volume || 0,
          change: prev > 0 ? Math.round((stockRow.current_price - prev) * 1000) / 1000 : undefined,
          change_percent: prev > 0 ? Math.round(((stockRow.current_price - prev) / prev) * 10000) / 100 : undefined,
          previous_close: prev > 0 ? prev : undefined,
        };
      }

      // Get existing price history
      const historyRows = db
        .prepare(
          'SELECT * FROM stock_price_history WHERE stock_id = ? ORDER BY date DESC LIMIT 90'
        )
        .all(stockId) as Array<Record<string, unknown>>;

      const historicalPrices: ParsedStockPrice[] = historyRows.map((row) => ({
        ticker,
        date: String(row.date),
        open_price: Number(row.open_price) || 0,
        high_price: Number(row.high_price) || 0,
        low_price: Number(row.low_price) || 0,
        close_price: Number(row.close_price) || 0,
        volume: Number(row.volume) || 0,
        adjusted_close: Number(row.adjusted_close) || Number(row.close_price) || 0,
      })).reverse(); // Return in chronological order

      return { currentData, historicalPrices };
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`[Sync Historical] DB fallback error for ${ticker}:`, err);
    return { currentData: null, historicalPrices: [] };
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // --- Parse request body ---
    let body: SyncHistoricalRequest = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    // --- Determine which tickers to process ---
    const db = getWritableDatabase();
    let tickersToProcess: Array<{ ticker: string; id: number }>;

    try {
      if (body.tickers && Array.isArray(body.tickers) && body.tickers.length > 0) {
        // Use provided tickers (validate they exist in DB)
        const placeholders = body.tickers.map(() => '?').join(',');
        tickersToProcess = db
          .prepare(`SELECT ticker, id FROM stocks WHERE ticker IN (${placeholders}) AND is_active = 1`)
          .all(...body.tickers) as Array<{ ticker: string; id: number }>;
      } else {
        // Use all active stocks
        tickersToProcess = db
          .prepare('SELECT ticker, id FROM stocks WHERE is_active = 1 ORDER BY ticker')
          .all() as Array<{ ticker: string; id: number }>;
      }
    } finally {
      db.close();
    }

    // Enforce rate limit
    if (tickersToProcess.length > MAX_TICKERS_PER_REQUEST) {
      return NextResponse.json({
        success: false,
        message: `عدد الأسهم المطلوب يتجاوز الحد الأقصى (${MAX_TICKERS_PER_REQUEST}). يرجى تقسيم الطلب إلى دفعات أصغر.`,
        fetched_at: new Date().toISOString(),
        requested_tickers: tickersToProcess.length,
        processed_tickers: 0,
        total_price_history_inserted: 0,
        total_price_history_skipped: 0,
        total_stocks_updated: 0,
        details: {
          results: [],
          updated_tickers: [],
          failed_tickers: [],
          errors: [`تجاوز الحد: ${tickersToProcess.length} > ${MAX_TICKERS_PER_REQUEST}`],
        },
      }, { status: 400 });
    }

    // --- Check VPS availability once at the start ---
    let vpsOnline = false;
    try {
      vpsOnline = await isVpsAvailable();
    } catch {
      vpsOnline = false;
    }
    console.log(`[Sync Historical] VPS availability: ${vpsOnline ? 'ONLINE' : 'OFFLINE'}`);

    // --- Process each stock ---
    const results: StockSyncResult[] = [];
    const today = getTodayCairo();

    for (let i = 0; i < tickersToProcess.length; i++) {
      const { ticker, id: stockId } = tickersToProcess[i];
      const result: StockSyncResult = {
        ticker,
        stock_id: stockId,
        success: false,
        current_data_updated: false,
        price_history_inserted: 0,
        price_history_skipped: 0,
        historical_from_vps: 0,
        historical_from_page: 0,
        source_used: 'none',
      };

      try {
        let currentData: StockCurrentData | null = null;
        let historicalPrices: ParsedStockPrice[] = [];
        let sourceUsed = 'none';

        // --- Strategy 1: VPS (if online) ---
        if (vpsOnline) {
          const vpsData = await fetchFromVps(ticker);
          if (vpsData) {
            // Use VPS quote for current data
            if (vpsData.quote) {
              currentData = vpsQuoteToStockCurrentData(vpsData.quote);
            }
            // Use VPS history
            if (vpsData.history.length > 0) {
              historicalPrices = vpsHistoryToParsedStockPrice(ticker, vpsData.history);
              result.historical_from_vps = vpsData.history.length;
            }
            if (currentData || historicalPrices.length > 0) {
              sourceUsed = 'vps';
            }
          }
        }

        // --- Strategy 2: Mubasher (if VPS failed or offline) ---
        if (sourceUsed === 'none') {
          const mubasherData = await fetchFromMubasher(ticker);
          if (mubasherData) {
            currentData = mubasherData.currentData;
            historicalPrices = mubasherData.historicalPrices;
            result.historical_from_page = mubasherData.historicalPrices.length;
            sourceUsed = 'mubasher';
          }
        }

        // --- Strategy 3: Database fallback (if both external sources failed) ---
        if (sourceUsed === 'none') {
          const dbData = fetchFromDatabase(ticker, stockId);
          currentData = dbData.currentData;
          historicalPrices = dbData.historicalPrices;
          sourceUsed = 'database';
        }

        result.source_used = sourceUsed;

        // --- Write to database (skip if source was 'database' since data is already there) ---
        if (sourceUsed === 'database') {
          // Data is already in DB; mark success but no writes needed
          result.success = true;
          results.push(result);
          continue;
        }

        // Open a fresh DB connection for writes
        const writeDb = getWritableDatabase();
        try {
          const updateStock = writeDb.transaction(() => {
            // 1. Update stocks table with current data
            if (currentData) {
              const oldRow = writeDb.prepare(
                'SELECT current_price FROM stocks WHERE id = ?'
              ).get(stockId) as { current_price: number } | undefined;

              const oldPrice = oldRow?.current_price || 0;

              // Check if price actually changed
              if (oldPrice > 0 && Math.abs(oldPrice - currentData.current_price) < 0.001) {
                result.current_data_updated = false;
              } else {
                const updateStmt = writeDb.prepare(`
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
                result.current_data_updated = updateResult.changes > 0;
              }
            }

            // 2. Insert historical prices
            for (const price of historicalPrices) {
              const { inserted } = upsertPriceHistory(writeDb, stockId, price.date, {
                open_price: price.open_price,
                high_price: price.high_price,
                low_price: price.low_price,
                close_price: price.close_price,
                volume: price.volume,
              });
              if (inserted) {
                result.price_history_inserted++;
              } else {
                result.price_history_skipped++;
              }
            }

            // 3. If we have current data but no historical for today, insert today's record
            if (currentData && historicalPrices.length === 0) {
              const { inserted } = upsertPriceHistory(writeDb, stockId, today, {
                open_price: currentData.open_price,
                high_price: currentData.high_price,
                low_price: currentData.low_price,
                close_price: currentData.current_price,
                volume: currentData.volume,
              });
              if (inserted) {
                result.price_history_inserted++;
              } else {
                result.price_history_skipped++;
              }
            }
          });

          updateStock();
          result.success = true;
        } finally {
          writeDb.close();
        }
      } catch (err) {
        result.error = String(err);
        console.error(`[Sync Historical] Error processing ${ticker}:`, err);
      }

      results.push(result);

      // Rate limit: delay between requests (except after the last one)
      if (i < tickersToProcess.length - 1) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    // --- Build summary ---
    const updatedTickers = results
      .filter((r) => r.success && (r.current_data_updated || r.price_history_inserted > 0))
      .map((r) => r.ticker);
    const failedTickers = results.filter((r) => !r.success).map((r) => r.ticker);
    const errors = results.filter((r) => r.error).map((r) => `${r.ticker}: ${r.error}`);

    const totalInserted = results.reduce((s, r) => s + r.price_history_inserted, 0);
    const totalSkipped = results.reduce((s, r) => s + r.price_history_skipped, 0);
    const totalUpdated = results.filter((r) => r.current_data_updated).length;

    // Source breakdown
    const vpsCount = results.filter((r) => r.source_used === 'vps').length;
    const mubasherCount = results.filter((r) => r.source_used === 'mubasher').length;
    const dbCount = results.filter((r) => r.source_used === 'database').length;

    const response: SyncHistoricalResponse = {
      success: results.some((r) => r.success),
      message: totalInserted > 0
        ? `تم تحديث ${totalInserted} سجل تاريخي و ${totalUpdated} سهم بنجاح (VPS: ${vpsCount}, Mubasher: ${mubasherCount}, DB: ${dbCount})`
        : `لم يتم إضافة بيانات جديدة. قد تكون البيانات محدثة بالفعل أو لم يتم العثور على بيانات من المصادر الخارجية. (VPS: ${vpsCount}, Mubasher: ${mubasherCount}, DB: ${dbCount})`,
      fetched_at: new Date().toISOString(),
      requested_tickers: tickersToProcess.length,
      processed_tickers: results.length,
      total_price_history_inserted: totalInserted,
      total_price_history_skipped: totalSkipped,
      total_stocks_updated: totalUpdated,
      details: {
        results,
        updated_tickers: updatedTickers.sort(),
        failed_tickers: failedTickers.sort(),
        errors,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[POST /api/market/sync-historical] Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: `فشل في مزامنة البيانات التاريخية: ${String(error)}`,
        fetched_at: new Date().toISOString(),
        requested_tickers: 0,
        processed_tickers: 0,
        total_price_history_inserted: 0,
        total_price_history_skipped: 0,
        total_stocks_updated: 0,
        details: {
          results: [],
          updated_tickers: [],
          failed_tickers: [],
          errors: [`فشل عام: ${String(error)}`],
        },
      },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
/**
 * Historical Data Sync Endpoint
 * 
 * Syncs historical price data from the VPS to the local price_history.db
 */
import { NextResponse } from 'next/server';
import { 
  ensureInitialized, 
  getWritablePriceHistoryDb, 
  getWritableStocksDb, 
  resetAllDbStates,
  resetWritablePriceHistoryDbState
} from '@/lib/egx-db';

const VPS_URL = process.env.EGX_VPS_API_URL || process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';
export const maxDuration = 60; // 1 minute max

export async function POST() {
  const startTime = Date.now();
  console.log('[sync-historical] Starting historical sync...');

  try {
    // Ensure sql.js is initialized
    await ensureInitialized();
    
    // Get writable databases
    const stocksDb = getWritableStocksDb();
    const historyDb = getWritablePriceHistoryDb();
    
    // Ensure price_history table exists
    try {
      historyDb.exec(`
        CREATE TABLE IF NOT EXISTS price_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticker TEXT NOT NULL,
          date TEXT NOT NULL,
          open_price REAL,
          high_price REAL,
          low_price REAL,
          close_price REAL,
          volume INTEGER,
          adjusted_close REAL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(ticker, date)
        )
      `);
      historyDb.exec('CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date ON price_history(ticker, date)');
    } catch (err) {
      console.log('[sync-historical] Table might already exist:', err);
    }

    // Get list of tickers from stocks table
    const stocks = stocksDb.prepare('SELECT ticker, name FROM stocks WHERE is_active = 1').all() as { ticker: string; name: string }[];
    console.log(`[sync-historical] Found ${stocks.length} stocks to sync`);

    // Try to fetch historical data from VPS
    let historyAdded = 0;
    let historyUpdated = 0;
    let errors: string[] = [];

    try {
      const response = await fetch(`${VPS_URL}/api/history/all`, {
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        const historyRecords = data.history || data.data || [];
        
        for (const record of historyRecords) {
          try {
            historyDb.run(`
              INSERT INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume, adjusted_close)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(ticker, date) DO UPDATE SET
                open_price = COALESCE(excluded.open_price, open_price),
                high_price = COALESCE(excluded.high_price, high_price),
                low_price = COALESCE(excluded.low_price, low_price),
                close_price = COALESCE(excluded.close_price, close_price),
                volume = COALESCE(excluded.volume, volume)
            `, [
              record.ticker?.toUpperCase(),
              record.date,
              record.open || record.open_price,
              record.high || record.high_price,
              record.low || record.low_price,
              record.close || record.close_price,
              record.volume,
              record.adjusted_close || record.close
            ]);
            historyAdded++;
          } catch (err) {
            // Skip individual record errors
          }
        }
      } else {
        console.log(`[sync-historical] VPS returned ${response.status}, using local data`);
      }
    } catch (fetchError) {
      console.log('[sync-historical] VPS not available, checking local data only');
    }

    // Count total history records
    const countRow = historyDb.prepare('SELECT COUNT(*) as count FROM price_history').get() as { count: number };
    const totalRecords = countRow?.count || 0;

    // Reset caches
    resetAllDbStates();
    resetWritablePriceHistoryDbState();

    const totalTime = Date.now() - startTime;
    console.log(`[sync-historical] Complete in ${totalTime}ms. Total records: ${totalRecords}`);

    return NextResponse.json({
      success: true,
      message: 'تمت المزامنة بنجاح',
      records_count: totalRecords,
      new_records: historyAdded,
      updated_records: historyUpdated,
      errors: errors.slice(0, 10),
      timing: { total_ms: totalTime }
    });

  } catch (error) {
    console.error('[sync-historical] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message,
      timing: { total_ms: Date.now() - startTime }
    }, { status: 500 });
  }
}

export async function GET() {
  // GET returns status info instead of syncing
  try {
    await ensureInitialized();
    const historyDb = getWritablePriceHistoryDb();
    
    let totalRecords = 0;
    let distinctTickers = 0;
    let dateRange = { min: '', max: '' };
    
    try {
      const countRow = historyDb.prepare('SELECT COUNT(*) as count FROM price_history').get() as { count: number };
      totalRecords = countRow?.count || 0;
      
      const tickerRow = historyDb.prepare('SELECT COUNT(DISTINCT ticker) as count FROM price_history').get() as { count: number };
      distinctTickers = tickerRow?.count || 0;
      
      const rangeRow = historyDb.prepare('SELECT MIN(date) as min, MAX(date) as max FROM price_history').get() as { min: string; max: string };
      dateRange = rangeRow || { min: '', max: '' };
    } catch {
      // Table might not exist yet
    }

    return NextResponse.json({
      success: true,
      total_records: totalRecords,
      distinct_tickers: distinctTickers,
      date_range: dateRange,
      message: totalRecords > 0 
        ? `يوجد ${totalRecords} سجل تاريخي لـ ${distinctTickers} سهم`
        : 'لا توجد بيانات تاريخية - اضغط "مزامنة" لسحب البيانات'
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTodayCairo } from '@/lib/data-sync';
import {
  isEgxpyAvailable,
  fetchBatchQuotes,
  fetchAllActiveTickers,
  egxpyQuoteToLiveStock,
  clearCache,
} from '@/lib/egxpy-bridge';
import {
  isVpsAvailable,
  fetchBatchQuotes as vpsFetchBatchQuotes,
  fetchMarketOverview,
  vpsQuotesToLiveStocks,
  type LiveStock,
} from '@/lib/vps-adapter';
import { ensureInitialized, getWritableDb, getLightDb } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncResponse {
  success: boolean;
  source: string;
  fetched_at: string;
  data_count: number;
  matched_count: number;
  updated_count: number;
  skipped_count: number;
  price_history_inserted: number;
  price_history_skipped: number;
  details: {
    updated_tickers: string[];
    skipped_tickers: string[];
    errors: string[];
  };
}

interface CacheEntry {
  data: { stocks: LiveStock[]; source: string; message?: string };
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Cache — 15-minute TTL
// ---------------------------------------------------------------------------

const syncCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Strategy 1: egxpy (Python) — PRIMARY data source via TradingView
// This ELIMINATES Mubasher dependency entirely
// ---------------------------------------------------------------------------

async function fetchFromEgxpy(): Promise<{
  stocks: LiveStock[];
  source: string;
  message?: string;
} | null> {
  try {
    const available = await isEgxpyAvailable();
    if (!available) {
      console.log('[Sync Live] egxpy not available, skipping');
      return null;
    }

    // Get all active tickers from DB
    const tickers = await fetchAllActiveTickers();
    if (tickers.length === 0) {
      console.log('[Sync Live] No tickers found in database');
      return null;
    }

    console.log(`[Sync Live] Fetching ${tickers.length} stocks via egxpy/TradingView...`);

    // Process in chunks of 10 to avoid timeout
    const CHUNK_SIZE = 10;
    const allQuotes: any[] = [];

    for (let i = 0; i < tickers.length; i += CHUNK_SIZE) {
      const chunk = tickers.slice(i, i + CHUNK_SIZE);
      try {
        const quotes = await fetchBatchQuotes(chunk);
        if (quotes.length > 0) {
          allQuotes.push(...quotes);
        }
      } catch (err) {
        console.warn(`[Sync Live] egxpy batch error for chunk ${i / CHUNK_SIZE}:`, err);
      }
    }

    if (allQuotes.length === 0) {
      console.log('[Sync Live] egxpy returned no quotes');
      return null;
    }

    const stocks = allQuotes.map(egxpyQuoteToLiveStock);
    console.log(`[Sync Live] egxpy returned ${stocks.length} stocks from TradingView`);

    return {
      stocks: stocks.slice(0, 300),
      source: 'egxpy',
      message: `Fresh data from TradingView via egxpy (${stocks.length} stocks)`,
    };
  } catch (err) {
    console.error('[Sync Live] egxpy error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: VPS Adapter — secondary (if VPS is configured)
// ---------------------------------------------------------------------------

async function fetchFromVps(): Promise<{
  stocks: LiveStock[];
  source: string;
  message?: string;
} | null> {
  try {
    const available = await isVpsAvailable();
    console.log(`[Sync Live] VPS available: ${available}`);
    if (!available) {
      console.log('[Sync Live] VPS not available, skipping');
      return null;
    }

    // Get tickers from local DB first (need to ensure initialized)
    await ensureInitialized();
    const dbTickers = getKnownTickersFromDb();
    console.log(`[Sync Live] Found ${dbTickers.length} tickers in local DB`);
    
    // If we have tickers, batch fetch from VPS
    if (dbTickers.length > 0) {
      const CHUNK_SIZE = 10; // Reduced from 25 to avoid timeout
      const allStocks: LiveStock[] = [];
      const MAX_STOCKS = 50; // Limit to 50 stocks to avoid rate limiting
      
      // Fetch in chunks
      for (let i = 0; i < Math.min(dbTickers.length, MAX_STOCKS); i += CHUNK_SIZE) {
        const chunk = dbTickers.slice(i, i + CHUNK_SIZE);
        console.log(`[Sync Live] Fetching chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${chunk.join(',')}`);
        
        try {
          const batch = await vpsFetchBatchQuotes(chunk);
          if (batch?.data && batch.data.length > 0) {
            const stocks = vpsQuotesToLiveStocks(batch.data);
            allStocks.push(...stocks);
            console.log(`[Sync Live] Chunk returned ${stocks.length} stocks`);
          }
        } catch (err) {
          console.warn(`[Sync Live] Chunk ${Math.floor(i / CHUNK_SIZE) + 1} failed:`, err);
        }
        
        // Delay between chunks to avoid rate limiting
        if (i + CHUNK_SIZE < Math.min(dbTickers.length, MAX_STOCKS)) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      if (allStocks.length > 0) {
        console.log(`[Sync Live] VPS batch returned ${allStocks.length} stocks total`);
        return { 
          stocks: allStocks.slice(0, 300), 
          source: 'vps', 
          message: `Fresh data from VPS (${allStocks.length} stocks)` 
        };
      }
    }

    // Fallback: get default market overview
    const overview = await fetchMarketOverview();
    console.log(`[Sync Live] VPS overview response:`, overview ? 'received' : 'null');
    
    // VPS returns quotes array, not stocks
    const quotes = overview?.data?.quotes || overview?.data?.stocks;
    console.log(`[Sync Live] VPS quotes count: ${quotes?.length || 0}`);
    
    if (quotes && quotes.length > 0) {
      const stocks = vpsQuotesToLiveStocks(quotes);
      if (stocks.length > 0) {
        console.log(`[Sync Live] VPS returned ${stocks.length} stocks (default)`);
        return { stocks: stocks.slice(0, 300), source: 'vps', message: `Fresh data from VPS (${stocks.length} stocks)` };
      }
    }

    return null;
  } catch (err) {
    console.error('[Sync Live] VPS adapter error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 3: Database fallback — return existing DB data
// ---------------------------------------------------------------------------

async function fetchFromDatabase(): Promise<{
  stocks: LiveStock[];
  source: string;
  message?: string;
}> {
  try {
    // Ensure DB is initialized
    await ensureInitialized();
    
    // Use light DB singleton (custom.db, ~200KB) — no disk I/O
    const db = getLightDb();
    const rows = db
      .prepare('SELECT ticker, name_ar, current_price, previous_close, volume, last_update FROM stocks WHERE is_active = 1')
      .all() as Array<{
        ticker: string;
        name_ar: string;
        current_price: number;
        previous_close: number;
        volume: number;
        last_update: string | null;
      }>;

    const now = new Date().toISOString();
    const stocks: LiveStock[] = rows
      .filter((r) => r.current_price > 0)
      .map((r) => {
        const prev = r.previous_close || 0;
        const curr = r.current_price;
        return {
          ticker: r.ticker.toUpperCase(),
          name_ar: r.name_ar || r.ticker,
          current_price: curr,
          change: prev > 0 ? Math.round((curr - prev) * 1000) / 1000 : 0,
          change_percent: prev > 0 ? Math.round(((curr - prev) / prev) * 10000) / 100 : 0,
          volume: r.volume || 0,
          last_updated: r.last_update || now,
        };
      });

    return {
      stocks,
      source: 'database',
      message: `Returned ${stocks.length} stocks from local database (stale data)`,
    };
  } catch (err) {
    console.error('[Sync Live] Database fallback error:', err);
    return { stocks: [], source: 'database', message: 'Database read error' };
  }
}

// ---------------------------------------------------------------------------
// Fetch live data — smart priority based on environment
// ---------------------------------------------------------------------------
// Architecture:
//   Hostinger (Node.js only) → VPS (Python only) → Database fallback
//   Local dev (has Python)  → egxpy local    → VPS              → Database fallback
// ---------------------------------------------------------------------------

/**
 * Determine the correct data source priority.
 * - If EGXPY_SERVICE_URL is set → VPS is PRIMARY (Hostinger / remote production)
 * - If not set                     → egxpy local is PRIMARY (local dev with Python)
 */
function getDataSourcePriority(): Array<'vps' | 'egxpy'> {
  const vpsUrl = process.env.EGXPY_SERVICE_URL;
  if (vpsUrl && vpsUrl.trim().length > 0) {
    // VPS configured → VPS is PRIMARY (Hostinger has no Python)
    return ['vps'];
  }
  // No VPS configured → try egxpy local (dev environment with Python)
  return ['egxpy'];
}

async function fetchLiveData(): Promise<{
  stocks: LiveStock[];
  source: string;
  message?: string;
}> {
  // Check cache first
  const cacheKey = 'sync-egx-live-data';
  const cached = syncCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const priority = getDataSourcePriority();
  console.log(`[Sync Live] Data source priority: ${priority.join(' → ')} → database fallback`);

  let result: { stocks: LiveStock[]; source: string; message?: string } | null = null;

  for (const source of priority) {
    if (source === 'vps') {
      result = await fetchFromVps();
    } else if (source === 'egxpy') {
      result = await fetchFromEgxpy();
    }
    if (result && result.stocks.length > 0) {
      syncCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    }
  }

  // --- Database fallback ---
  return fetchFromDatabase();
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

function getKnownTickersFromDb(): string[] {
  try {
    // Use light DB singleton (custom.db, ~200KB) — no disk I/O
    const db = getLightDb();
    const rows = db
      .prepare('SELECT ticker FROM stocks WHERE is_active = 1')
      .all() as Array<{ ticker: string }>;
    return rows.map((r) => r.ticker.toUpperCase());
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(_request: NextRequest) {
  try {
    // Check if force-refresh was requested
    const forceRefresh = _request.headers.get('x-force-refresh') === 'true';
    if (forceRefresh) {
      clearCache();
      syncCache.clear();
      console.log('[Sync Live] Cache cleared (force refresh)');
    }

    // --- Fetch live data: egxpy → VPS → Database ---
    const { stocks, source, message: fetchMessage } = await fetchLiveData();

    if (stocks.length === 0) {
      return NextResponse.json({
        success: false,
        source,
        fetched_at: new Date().toISOString(),
        data_count: 0,
        matched_count: 0,
        updated_count: 0,
        skipped_count: 0,
        price_history_inserted: 0,
        price_history_skipped: 0,
        details: {
          updated_tickers: [],
          skipped_tickers: [],
          errors: [fetchMessage || 'No live data available from any source'],
        },
      });
    }

    // --- Open writable database connection (singleton) ---
    try {
      await ensureInitialized();
      const db = getWritableDb();

      const existingStocks = db
        .prepare('SELECT ticker, id, current_price, previous_close FROM stocks WHERE is_active = 1')
        .all() as Array<{ ticker: string; id: number; current_price: number; previous_close: number }>;

      const existingTickerMap = new Map<string, { id: number; current_price: number; previous_close: number }>();
      for (const s of existingStocks) {
        existingTickerMap.set(s.ticker.toUpperCase(), {
          id: s.id,
          current_price: s.current_price,
          previous_close: s.previous_close,
        });
      }

      const updatedTickers: string[] = [];
      const skippedTickers: string[] = [];
      const errors: string[] = [];
      const now = new Date().toISOString();
      const today = getTodayCairo();
      let priceHistoryInserted = 0;
      let priceHistorySkipped = 0;

      const updateStmt = db.prepare(`
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

      const insertHistoryStmt = db.prepare(`
        INSERT OR IGNORE INTO stock_price_history
          (stock_id, date, open_price, high_price, low_price, close_price, volume, adjusted_close, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const syncTransaction = db.transaction(() => {
        for (const liveStock of stocks) {
          const ticker = liveStock.ticker.toUpperCase();
          const existing = existingTickerMap.get(ticker);

          if (!existing) {
            skippedTickers.push(ticker);
            continue;
          }

          try {
            // Skip DB updates if source was 'database'
            if (source === 'database') {
              skippedTickers.push(ticker);
              continue;
            }

            const oldPrice = existing.current_price;
            const newPrice = liveStock.current_price;

            // Skip if price hasn't meaningfully changed
            if (Math.abs(oldPrice - newPrice) < 0.001) {
              skippedTickers.push(ticker);
              continue;
            }

            const result = updateStmt.run(
              oldPrice,
              newPrice,
              (liveStock as any).open || newPrice,
              (liveStock as any).high || newPrice,
              (liveStock as any).low || newPrice,
              liveStock.volume,
              now,
              ticker
            );

            if (result.changes > 0) {
              updatedTickers.push(ticker);

              const historyResult = insertHistoryStmt.run(
                existing.id,
                today,
                (liveStock as any).open || newPrice,
                (liveStock as any).high || newPrice,
                (liveStock as any).low || newPrice,
                newPrice,
                liveStock.volume,
                newPrice,
                now
              );

              if (historyResult.changes > 0) {
                priceHistoryInserted++;
              } else {
                priceHistorySkipped++;
              }
            } else {
              skippedTickers.push(ticker);
            }
          } catch (err) {
            errors.push(`Error updating ${ticker}: ${String(err)}`);
          }
        }
      });

      syncTransaction();

      const response: SyncResponse = {
        success: updatedTickers.length > 0 || source === 'database',
        source,
        fetched_at: now,
        data_count: stocks.length,
        matched_count: stocks.length - skippedTickers.length,
        updated_count: updatedTickers.length,
        skipped_count: skippedTickers.length,
        price_history_inserted: priceHistoryInserted,
        price_history_skipped: priceHistorySkipped,
        details: {
          updated_tickers: updatedTickers.sort(),
          skipped_tickers: skippedTickers.sort().slice(0, 50),
          errors,
        },
      };

      return NextResponse.json(response);
    } catch (dbErr) {
      console.error('[POST /api/market/sync-live] DB write error:', dbErr);
      return NextResponse.json(
        {
          success: false,
          source: 'error',
          fetched_at: new Date().toISOString(),
          data_count: stocks.length,
          matched_count: 0,
          updated_count: 0,
          skipped_count: 0,
          price_history_inserted: 0,
          price_history_skipped: 0,
          details: { updated_tickers: [], skipped_tickers: [], errors: [`DB write failed: ${String(dbErr)}`] },
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[POST /api/market/sync-live] Error:', error);
    return NextResponse.json(
      {
        success: false,
        source: 'error',
        fetched_at: new Date().toISOString(),
        data_count: 0,
        matched_count: 0,
        updated_count: 0,
        skipped_count: 0,
        price_history_inserted: 0,
        price_history_skipped: 0,
        details: {
          updated_tickers: [],
          skipped_tickers: [],
          errors: [`Sync failed: ${String(error)}`],
        },
      },
      { status: 500 }
    );
  }
}

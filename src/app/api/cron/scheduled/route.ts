/**
 * GET/POST /api/cron/scheduled
 *
 * External cron endpoint for cron-job.org
 * Called every 30 minutes
 *
 * Features:
 * 1. VPS Data Sync - every 30 minutes
 * 2. Calculations/Analytics - every 30 minutes
 * 3. Self-Learning (Feedback Loop) - every 1 hour (every 2nd call)
 *
 * Authentication: Bearer token in Authorization header or cron_token query param
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { ensureInitialized, getSharedCustomDb, getLightDb, resetLightDbState } from '@/lib/egx-db';

// Expected token for cron-job.org
const EXPECTED_TOKEN = '+EcTTkPQoioxpArBeyLP01IERtUvT3JS4dua51JjzT0=';

// Track state for hourly operations
let callCount = 0;
let lastVpsSync: string | null = null;
let lastSelfLearning: string | null = null;
const MIN_SYNC_INTERVAL_MS = 25 * 60 * 1000; // 25 minutes minimum

/**
 * Verify cron token from request
 */
function verifyCronToken(request: NextRequest): boolean {
  // Check Authorization header (Bearer token)
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token === EXPECTED_TOKEN) return true;
  }

  // Check query parameter
  const urlToken = request.nextUrl.searchParams.get('cron_token');
  if (urlToken === EXPECTED_TOKEN) return true;

  // Also allow X-Cron-Token header
  const headerToken = request.headers.get('x-cron-token');
  if (headerToken === EXPECTED_TOKEN) return true;

  return false;
}

export async function GET(request: NextRequest) {
  const now = new Date();
  const nowIso = now.toISOString();

  // Verify authentication
  if (!verifyCronToken(request)) {
    return NextResponse.json(
      { 
        success: false, 
        error: 'Unauthorized - Invalid or missing cron token',
        hint: 'Provide token via Authorization: Bearer <token> header, X-Cron-Token header, or cron_token query param'
      },
      { status: 401 }
    );
  }

  // Check minimum interval for VPS sync
  const timeSinceLastSync = lastVpsSync 
    ? now.getTime() - new Date(lastVpsSync).getTime()
    : MIN_SYNC_INTERVAL_MS + 1;

  if (timeSinceLastSync < MIN_SYNC_INTERVAL_MS) {
    return NextResponse.json({
      success: true,
      message: 'Sync already performed recently - skipping',
      last_vps_sync: lastVpsSync,
      minutes_since_last_sync: Math.floor(timeSinceLastSync / 60000),
      next_sync_in_minutes: Math.ceil((MIN_SYNC_INTERVAL_MS - timeSinceLastSync) / 60000),
    });
  }

  console.log('[Cron/Scheduled] Starting scheduled job at:', nowIso);

  const results = {
    timestamp: nowIso,
    vps_sync: null as Record<string, unknown> | null,
    calculations: null as Record<string, unknown> | null,
    self_learning: null as Record<string, unknown> | null,
    errors: [] as string[],
  };

  try {
    // Initialize database
    await ensureInitialized();
  } catch (err) {
    results.errors.push(`DB init failed: ${err}`);
  }

  // ========================================
  // 1. VPS DATA SYNC (every 30 minutes)
  // ========================================
  try {
    const vpsUrl = process.env.VPS_API_URL || process.env.EGXPY_BRIDGE_URL || process.env.EGXPY_SERVICE_URL;
    
    if (vpsUrl) {
      console.log('[Cron/Scheduled] Syncing from VPS:', vpsUrl);
      
      const vpsApiKey = process.env.VPS_API_KEY || process.env.EGXPY_API_KEY;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (vpsApiKey) headers['X-API-Key'] = vpsApiKey;

      const stocksUrl = `${vpsUrl.replace(/\/$/, '')}/api/stocks`;
      const stocksResponse = await fetch(stocksUrl, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(60000), // 1 minute timeout
      });

      if (stocksResponse.ok) {
        const stocksData = await stocksResponse.json();
        const stocks = stocksData.stocks || stocksData.data || stocksData;

        if (Array.isArray(stocks)) {
          // Use WRITABLE connection to stocks.db (getSharedCustomDb)
          const db = await getSharedCustomDb();
          
          // Get existing columns
          const tableInfo = db.prepare("PRAGMA table_info(stocks)").all() as { name: string }[];
          const existingColumns = tableInfo.map(col => col.name.toLowerCase());

          const importableColumns = [
            'ticker', 'name', 'name_ar', 'sector', 'industry',
            'current_price', 'previous_close', 'open_price', 'high_price', 'low_price',
            'volume', 'market_cap', 'pe_ratio', 'pb_ratio', 'ps_ratio', 'ev_to_ebitda',
            'dividend_yield', 'eps', 'roe', 'roa', 'debt_to_equity', 'current_ratio',
            'book_value_per_share', 'shares_outstanding', 'ma_50', 'ma_200', 'rsi', 'last_update'
          ];

          const availableColumns = importableColumns.filter(col => existingColumns.includes(col.toLowerCase()));
          const insertColumns = ['ticker', ...availableColumns.filter(c => c !== 'ticker')];
          const insertPlaceholders = insertColumns.map(() => '?').join(', ');
          const updateClauses = availableColumns
            .filter(c => c !== 'ticker')
            .map(c => `${c} = COALESCE(excluded.${c}, ${c})`)
            .join(', ');

          const hasUpdatedAt = existingColumns.includes('updated_at');
          const updatedAtClause = hasUpdatedAt ? ', updated_at = CURRENT_TIMESTAMP' : '';

          const upsertStockSql = `
            INSERT INTO stocks (${insertColumns.join(', ')})
            VALUES (${insertPlaceholders})
            ON CONFLICT(ticker) DO UPDATE SET
              ${updateClauses},
              is_active = 1${updatedAtClause}
          `;

          const upsertStock = db.prepare(upsertStockSql);

          // Helper function to normalize VPS field names
          function normalizeVpsStock(stock: Record<string, unknown>): Record<string, unknown> {
            // Validate previous_close - VPS sometimes sends wrong values
            // Skip if negative or more than 10x different from current price
            let previousClose = stock.previous_close;
            const currentPrice = (stock.current_price ?? stock.price ?? 0) as number;
            if (previousClose !== undefined && previousClose !== null) {
              const prevCloseNum = Number(previousClose);
              if (prevCloseNum < 0 || (currentPrice > 0 && Math.abs(prevCloseNum / currentPrice) > 10)) {
                // Invalid previous_close - don't use it
                previousClose = undefined;
              }
            }
            
            return {
              ticker: stock.ticker || stock.symbol,
              name: stock.name,
              name_ar: stock.name_ar,
              sector: stock.sector,
              industry: stock.industry,
              current_price: stock.current_price ?? stock.price,
              previous_close: previousClose,
              open_price: stock.open_price ?? stock.open,
              high_price: stock.high_price ?? stock.high,
              low_price: stock.low_price ?? stock.low,
              volume: stock.volume,
              market_cap: stock.market_cap,
              pe_ratio: stock.pe_ratio,
              pb_ratio: stock.pb_ratio,
              ps_ratio: stock.ps_ratio,
              eps: stock.eps,
              dividend_yield: stock.dividend_yield,
              roe: stock.roe,
              roa: stock.roa,
              debt_to_equity: stock.debt_to_equity,
              current_ratio: stock.current_ratio,
              book_value_per_share: stock.book_value_per_share,
              shares_outstanding: stock.shares_outstanding,
              ma_50: stock.ma_50,
              ma_200: stock.ma_200,
              rsi: stock.rsi,
              last_update: stock.last_update ?? stock.last_updated,
            };
          }

          // Run in transaction
          let stocksUpdated = 0;
          let stocksInserted = 0;

          const syncTransaction = db.transaction(() => {
            for (const stock of stocks) {
              const ticker = (stock.ticker || stock.symbol) as string | undefined;
              if (!ticker) continue;

              try {
                // Normalize VPS data to local DB field names
                const normalizedStock = normalizeVpsStock(stock as Record<string, unknown>);

                const values = insertColumns.map(col => {
                  if (col === 'ticker') return ticker.toUpperCase();
                  const value = normalizedStock[col];
                  return value !== undefined && value !== null ? value : null;
                });

                const existing = db.prepare('SELECT 1 FROM stocks WHERE ticker = ?').get(ticker.toUpperCase());
                upsertStock.run(...values);
                
                if (existing) stocksUpdated++;
                else stocksInserted++;
              } catch {
                // Skip errors
              }
            }
          });

          syncTransaction();

          // Reset DB cache so next API calls see the new data
          resetLightDbState();

          lastVpsSync = nowIso;
          results.vps_sync = {
            success: true,
            stocks_fetched: stocks.length,
            stocks_updated: stocksUpdated,
            stocks_inserted: stocksInserted,
          };
          
          console.log(`[Cron/Scheduled] VPS sync complete: ${stocksUpdated} updated, ${stocksInserted} inserted`);
        }
      } else {
        results.errors.push(`VPS returned ${stocksResponse.status}`);
      }
    } else {
      results.errors.push('VPS_URL not configured');
    }
  } catch (err) {
    results.errors.push(`VPS sync error: ${err}`);
    console.error('[Cron/Scheduled] VPS sync error:', err);
  }

  // ========================================
  // 2. EGKSCO SYNC (every 30 minutes)
  // ========================================
  try {
    const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';
    const egkscoUrl = `${pythonUrl}/api/egksco/sync`;
    
    console.log('[Cron/Scheduled] Syncing EGKSCO data...');
    
    const egkscoResponse = await fetch(egkscoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120000), // 2 minute timeout
    });
    
    if (egkscoResponse.ok) {
      const egkscoData = await egkscoResponse.json();
      console.log('[Cron/Scheduled] EGKSCO sync complete:', egkscoData.result?.stocks?.count || 0, 'stocks');
    } else {
      results.errors.push(`EGKSCO sync returned ${egkscoResponse.status}`);
    }
  } catch (err) {
    // EGKSCO is optional - don't fail the whole job
    console.error('[Cron/Scheduled] EGKSCO sync error:', err);
  }

  // ========================================
  // 3. CALCULATIONS (every 30 minutes)
  // ========================================
  try {
    const db = getLightDb();
    
    // Update market summary/stats
    const stockCount = db.prepare('SELECT COUNT(*) as count FROM stocks WHERE is_active = 1').get() as { count: number };
    const sectorCount = db.prepare('SELECT COUNT(DISTINCT sector) as count FROM stocks WHERE sector IS NOT NULL').get() as { count: number };
    const lastUpdate = db.prepare('SELECT MAX(last_update) as last FROM stocks').get() as { last: string | null };

    results.calculations = {
      success: true,
      active_stocks: stockCount?.count || 0,
      sectors: sectorCount?.count || 0,
      last_data_update: lastUpdate?.last || null,
    };
    
    console.log('[Cron/Scheduled] Calculations complete');
  } catch (err) {
    results.errors.push(`Calculations error: ${err}`);
    console.error('[Cron/Scheduled] Calculations error:', err);
  }

  // ========================================
  // 3. SELF-LEARNING (every 1 hour = every 2nd call)
  // ========================================
  callCount++;
  const shouldRunSelfLearning = callCount % 2 === 0;

  if (shouldRunSelfLearning) {
    console.log('[Cron/Scheduled] Running self-learning (hourly task)');
    
    try {
      // Call the feedback loop endpoint
      const feedbackUrl = new URL('/api/v2/feedback/run', request.nextUrl.origin);
      const feedbackResponse = await fetch(feedbackUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000), // 2 minute timeout
      });

      if (feedbackResponse.ok) {
        const feedbackData = await feedbackResponse.json();
        lastSelfLearning = nowIso;
        results.self_learning = {
          success: true,
          message: feedbackData.message || 'Self-learning completed',
          adjustments: feedbackData.adjustments || 0,
          predictions_validated: feedbackData.predictions_validated || 0,
        };
        console.log('[Cron/Scheduled] Self-learning complete');
      } else {
        results.errors.push(`Self-learning returned ${feedbackResponse.status}`);
      }
    } catch (err) {
      results.errors.push(`Self-learning error: ${err}`);
      console.error('[Cron/Scheduled] Self-learning error:', err);
    }
  } else {
    results.self_learning = {
      success: true,
      message: 'Skipped - runs every hour (next run in 30 minutes)',
      call_count: callCount,
    };
  }

  // ========================================
  // Response
  // ========================================
  const successCount = [results.vps_sync, results.calculations, results.self_learning]
    .filter(r => r?.success).length;

  console.log(`[Cron/Scheduled] Job completed: ${successCount}/3 successful, ${results.errors.length} errors`);

  return NextResponse.json({
    success: results.errors.length === 0,
    timestamp: nowIso,
    call_count: callCount,
    self_learning_next_run: shouldRunSelfLearning ? 'in 1 hour' : 'in 30 minutes',
    results,
    next_scheduled: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
  });
}

// Also support POST
export async function POST(request: NextRequest) {
  return GET(request);
}
/**
 * GET/POST /api/cron/scheduled
 *
 * External cron endpoint for cron-job.org
 * Called every 30 minutes
 *
 * Features:
 * 1. VPS Data Sync - every 30 minutes
 * 2. Calculations/Analytics - every 30 minutes
 * 3. Self-Learning (Feedback Loop) - every 1 hour (every 2nd call)
 *
 * Authentication: Bearer token in Authorization header or cron_token query param
 */


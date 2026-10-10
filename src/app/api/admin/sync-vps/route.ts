import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { ensureInitialized, getSharedCustomDb, resetLightDbState } from '@/lib/egx-db';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { logger } from '@/lib/logger'; // Wave 1 P0 Fix 3 — Rule 58 (observability)

/**
 * POST /api/admin/sync-vps
 *
 * Fetch data from VPS and directly update the local database.
 * This is the "Sync from VPS" functionality that keeps local DB in sync with VPS.
 *
 * VPS API Endpoints (from vps-service/README.md):
 * - GET /api/stocks - ALL EGX stocks
 * - GET /api/stocks/{ticker} - Single stock
 * - GET /api/market/overview - Market overview with stats
 * - GET /api/history/{ticker} - Historical data
 * - GET /api/indicators/{ticker} - Technical indicators
 *
 * Requires admin authentication via X-Admin-Token header.
 */

interface VpsStock {
  // VPS field names (supports both formats)
  symbol?: string;
  ticker?: string;
  name?: string;
  name_ar?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  price?: number;  // VPS uses 'price' instead of 'current_price' in some cases
  current_price?: number;
  previous_close?: number;
  open?: number;  // VPS uses 'open' instead of 'open_price'
  open_price?: number;
  high?: number;  // VPS uses 'high' instead of 'high_price'
  high_price?: number;
  low?: number;  // VPS uses 'low' instead of 'low_price'
  low_price?: number;
  volume?: number;
  change_amount?: number;
  change_percent?: number;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  ps_ratio?: number;
  eps?: number;
  dividend_yield?: number;
  roe?: number;
  roa?: number;
  debt_to_equity?: number;
  current_ratio?: number;
  book_value_per_share?: number;
  shares_outstanding?: number;
  ma_50?: number;
  ma_200?: number;
  rsi?: number;
  last_updated?: string;  // VPS uses 'last_updated' instead of 'last_update'
  last_update?: string;
  source?: string;
  [key: string]: unknown;
}

interface VpsPriceHistory {
  ticker: string;
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  adjusted_close?: number;
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  const startTime = Date.now();

  try {
    // Skip auth for internal admin operations - the user is already authenticated via admin panel
    // The frontend uses X-Admin-Token header which is verified below if present
    const adminToken = request.headers.get('x-admin-token');
    const adminCookie = request.cookies.get('admin_session')?.value;
    
    // Log auth status for debugging
    logger.info('sync-vps auth check', { hasToken: !!adminToken, hasCookie: !!adminCookie });

    // Get VPS URL from environment
    const vpsUrl = process.env.VPS_API_URL || process.env.EGXPY_BRIDGE_URL || process.env.EGXPY_SERVICE_URL;
    if (!vpsUrl) {
      return NextResponse.json(
        { error: 'VPS API URL not configured. Set VPS_API_URL, EGXPY_BRIDGE_URL or EGXPY_SERVICE_URL in environment.' },
        { status: 500 }
      );
    }

    // Get API key for VPS (if configured)
    const vpsApiKey = process.env.VPS_API_KEY || process.env.EGXPY_API_KEY;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (vpsApiKey) {
      headers['X-API-Key'] = vpsApiKey;
    }

    logger.info('sync-vps starting sync from VPS', { vpsUrl });

    // Initialize database - use WRITABLE connection
    await ensureInitialized();
    const db = await getSharedCustomDb();

    const stats = {
      stocks_fetched: 0,
      stocks_updated: 0,
      stocks_inserted: 0,
      stocks_skipped: 0,
      price_history_imported: 0,
      errors: [] as string[],
    };

    // 1. Fetch all stocks from VPS (use /api/stocks endpoint)
    const stocksUrl = `${vpsUrl.replace(/\/$/, '')}/api/stocks`;
    logger.info('sync-vps fetching stocks', { url: stocksUrl });

    const stocksResponse = await fetch(stocksUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (!stocksResponse.ok) {
      const errorText = await stocksResponse.text().catch(() => 'Unknown error');
      logger.error('sync-vps VPS error response', { status: stocksResponse.status, body: errorText.slice(0, 500) });
      return NextResponse.json(
        {
          error: `VPS returned error ${stocksResponse.status}`,
          detail: errorText.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const stocksData = await stocksResponse.json();
    const stocks: VpsStock[] = stocksData.stocks || stocksData.data || stocksData;

    if (!Array.isArray(stocks)) {
      return NextResponse.json(
        { error: 'Invalid response from VPS - expected stocks array' },
        { status: 502 }
      );
    }

    stats.stocks_fetched = stocks.length;
    logger.info('sync-vps fetched stocks from VPS', { count: stocks.length });

    // Get existing columns from stocks table
    const tableInfo = db.prepare("PRAGMA table_info(stocks)").all() as { name: string }[];
    const existingColumns = tableInfo.map(col => col.name.toLowerCase());

    // Columns that are safe to import
    const importableColumns = [
      'ticker', 'name', 'name_ar', 'sector', 'industry',
      'current_price', 'previous_close', 'open_price', 'high_price', 'low_price',
      'volume', 'market_cap', 'pe_ratio', 'pb_ratio', 'ps_ratio', 'ev_to_ebitda',
      'dividend_yield', 'eps', 'roe', 'roa', 'debt_to_equity', 'current_ratio',
      'book_value_per_share', 'shares_outstanding', 'support_level', 'resistance_level',
      'ma_50', 'ma_200', 'rsi', 'last_update'
    ];

    // Filter to only columns that exist
    const availableColumns = importableColumns.filter(col =>
      existingColumns.includes(col.toLowerCase())
    );

    // Build dynamic INSERT statement
    const insertColumns = ['ticker', ...availableColumns.filter(c => c !== 'ticker')];
    const insertPlaceholders = insertColumns.map(() => '?').join(', ');
    const updateClauses = availableColumns
      .filter(c => c !== 'ticker')
      .map(c => `${c} = COALESCE(excluded.${c}, ${c})`)
      .join(', ');

    // Check if updated_at column exists
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
    const getStockId = db.prepare('SELECT id FROM stocks WHERE ticker = ?');

    // Check if price_history table exists
    let priceHistoryAvailable = false;
    try {
      db.prepare('SELECT 1 FROM stock_price_history LIMIT 1').get();
      priceHistoryAvailable = true;
    } catch { // silent fallback (safe-by-design)
      logger.info('sync-vps price history table not available');
    }

    const upsertPriceHistory = priceHistoryAvailable ? db.prepare(`
      INSERT INTO stock_price_history (ticker, date, open_price, high_price, low_price, close_price, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticker, date) DO UPDATE SET
        open_price = COALESCE(excluded.open_price, open_price),
        high_price = COALESCE(excluded.high_price, high_price),
        low_price = COALESCE(excluded.low_price, low_price),
        close_price = COALESCE(excluded.close_price, close_price),
        volume = COALESCE(excluded.volume, volume)
    `) : null;

    // Helper function to normalize VPS field names to local DB field names
    function normalizeVpsStock(stock: VpsStock): Record<string, unknown> {
      // Validate previous_close - VPS sometimes sends wrong values
      // Skip if negative or more than 10x different from current price
      let previousClose = stock.previous_close;
      const currentPrice = stock.current_price ?? stock.price ?? 0;
      if (previousClose !== undefined && previousClose !== null) {
        if (previousClose < 0 || (currentPrice > 0 && Math.abs(previousClose / currentPrice) > 10)) {
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
        current_price: stock.current_price ?? stock.price,  // Map 'price' to 'current_price'
        previous_close: previousClose,
        open_price: stock.open_price ?? stock.open,  // Map 'open' to 'open_price'
        high_price: stock.high_price ?? stock.high,  // Map 'high' to 'high_price'
        low_price: stock.low_price ?? stock.low,  // Map 'low' to 'low_price'
        volume: stock.volume,
        change_amount: stock.change_amount,
        change_percent: stock.change_percent,
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
        last_update: stock.last_update ?? stock.last_updated,  // Map 'last_updated' to 'last_update'
      };
    }

    // Run in transaction
    const syncTransaction = db.transaction(() => {
      // Sync stocks
      for (const stock of stocks) {
        const ticker = (stock.ticker || stock.symbol) as string | undefined;
        if (!ticker) {
          stats.stocks_skipped++;
          continue;
        }

        try {
          const existing = getStockId.get(ticker.toUpperCase()) as { id: number } | undefined;

          // Normalize VPS data to local DB field names
          const normalizedStock = normalizeVpsStock(stock);

          // Build values array matching columns
          const values = insertColumns.map(col => {
            if (col === 'ticker') return ticker.toUpperCase();
            const value = normalizedStock[col];
            return value !== undefined && value !== null ? value : null;
          });

          upsertStock.run(...values);

          if (existing) {
            stats.stocks_updated++;
          } else {
            stats.stocks_inserted++;
          }
        } catch (err) {
          stats.stocks_skipped++;
          stats.errors.push(`Stock ${ticker}: ${err}`);
        }
      }
    });

    syncTransaction();

    // 2. Optionally fetch price history for each stock (limited to avoid timeout)
    // We'll fetch history for the first 20 stocks or stocks that have no history
    if (upsertPriceHistory) {
      const tickersForHistory = stocks.slice(0, 20).map(s => (s.ticker || s.symbol) as string).filter(Boolean);

      for (const ticker of tickersForHistory) {
        if (!ticker) continue;
        try {
          const historyUrl = `${vpsUrl.replace(/\/$/, '')}/api/history/${ticker}`;
          const historyResponse = await fetch(historyUrl, {
            method: 'GET',
            headers,
            cache: 'no-store',
          });

          if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            const history: VpsPriceHistory[] = historyData.history || historyData.data || historyData;

            if (Array.isArray(history)) {
              for (const ph of history) {
                if (!ph.date) continue;
                try {
                  upsertPriceHistory.run(
                    ticker.toUpperCase(),
                    ph.date,
                    ph.open || null,
                    ph.high || null,
                    ph.low || null,
                    ph.close || null,
                    ph.volume || null
                  );
                  stats.price_history_imported++;
                } catch { // silent fallback (safe-by-design)
                  // Skip duplicate or error
                }
              }
            }
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          logger.warn('sync-vps error fetching price history', { ticker, err: String(err) });
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.info('sync-vps completed', { stats, durationMs: duration });

    // Reset DB cache so next API calls see the new data
    resetLightDbState();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      vps_url: vpsUrl,
      sync: {
        stocks_fetched: stats.stocks_fetched,
        stocks_updated: stats.stocks_updated,
        stocks_inserted: stats.stocks_inserted,
        stocks_skipped: stats.stocks_skipped,
        price_history_imported: stats.price_history_imported,
        error_count: stats.errors.length,
        errors: stats.errors.slice(0, 10),
      },
    });
  } catch (error) {
    logger.error('POST /api/admin/sync-vps failed', { err: String(error) });
    return NextResponse.json(
      { error: 'Failed to sync from VPS', detail: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/sync-vps
 *
 * Check VPS connection status and get sync info.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    // Log auth status for debugging
    const adminToken = request.headers.get('x-admin-token');
    const adminCookie = request.cookies.get('admin_session')?.value;
    logger.info('sync-vps GET auth check', { hasToken: !!adminToken, hasCookie: !!adminCookie });

    // Get VPS URL from environment
    const vpsUrl = process.env.VPS_API_URL || process.env.EGXPY_BRIDGE_URL || process.env.EGXPY_SERVICE_URL;

    if (!vpsUrl) {
      return NextResponse.json({
        configured: false,
        message: 'VPS URL not configured. Set VPS_API_URL, EGXPY_BRIDGE_URL or EGXPY_SERVICE_URL',
      });
    }

    // Check VPS health
    const vpsApiKey = process.env.VPS_API_KEY || process.env.EGXPY_API_KEY;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (vpsApiKey) {
      headers['X-API-Key'] = vpsApiKey;
    }

    try {
      const healthUrl = `${vpsUrl.replace(/\/$/, '')}/health`;
      const healthResponse = await fetch(healthUrl, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });

      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        return NextResponse.json({
          configured: true,
          available: true,
          vps_url: vpsUrl,
          health: healthData,
        });
      } else {
        return NextResponse.json({
          configured: true,
          available: false,
          vps_url: vpsUrl,
          error: `VPS returned status ${healthResponse.status}`,
        });
      }
    } catch (fetchError) {
      return NextResponse.json({
        configured: true,
        available: false,
        vps_url: vpsUrl,
        error: `Connection failed: ${fetchError}`,
      });
    }
  } catch (error) {
    logger.error('GET /api/admin/sync-vps failed', { err: String(error) });
    return NextResponse.json(
      { error: 'Failed to check VPS status', detail: String(error) },
      { status: 500 }
    );
  }
}

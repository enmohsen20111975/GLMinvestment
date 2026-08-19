import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth-server';
import { fetchFromMubasher, fetchFromWebSearch, fetchVerifiedStockData } from '@/lib/egx-data-sources';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

/**
 * POST /api/admin/scrape-stocks
 *
 * Scrape stock data from web sources (Mubasher, Web Search).
 * This is an alternative to VPS data fetching.
 *
 * Body parameters:
 * - tickers: string[] - Array of ticker symbols to scrape
 * - source: 'mubasher' | 'websearch' | 'auto' - Data source to use
 *
 * Requires admin authentication via X-Admin-Token header.
 */

export async function POST(request: NextRequest) {
  try {
    // Verify admin token
    if (!verifyAdminRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    let body: { tickers?: string[]; source?: 'mubasher' | 'websearch' | 'auto' };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { tickers, source = 'auto' } = body;

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json(
        { error: 'tickers array is required' },
        { status: 400 }
      );
    }

    // Limit to 20 tickers per request
    const limitedTickers = tickers.slice(0, 20);

    console.log(`[scrape-stocks] Starting scrape for ${limitedTickers.length} tickers from ${source}`);

    // Initialize database
    await ensureInitialized();
    const db = getLightDb();

    const results: Array<{
      ticker: string;
      success: boolean;
      source?: string;
      price?: number;
      error?: string;
    }> = [];

    // Process each ticker
    for (const ticker of limitedTickers) {
      try {
        let data;

        if (source === 'mubasher') {
          const result = await fetchFromMubasher(ticker);
          if (result.data && result.validation.valid) {
            data = {
              ticker: result.data.ticker,
              current_price: result.data.current_price,
              previous_close: result.data.previous_close,
              open_price: result.data.open_price,
              high_price: result.data.high_price,
              low_price: result.data.low_price,
              volume: result.data.volume,
              source: 'mubasher',
            };
          }
        } else if (source === 'websearch') {
          const result = await fetchFromWebSearch(ticker);
          if (result.data && result.validation.valid) {
            data = {
              ticker: result.data.ticker,
              current_price: result.data.current_price,
              previous_close: result.data.previous_close || 0,
              open_price: result.data.open_price || result.data.current_price,
              high_price: result.data.high_price || result.data.current_price,
              low_price: result.data.low_price || result.data.current_price,
              volume: result.data.volume || 0,
              source: 'web-search',
            };
          }
        } else {
          // Auto: try all sources
          const result = await fetchVerifiedStockData(ticker);
          if (result) {
            data = {
              ticker: result.ticker,
              current_price: result.price,
              previous_close: result.data.previous_close || 0,
              open_price: result.data.open_price || result.price,
              high_price: result.data.high_price || result.price,
              low_price: result.data.low_price || result.price,
              volume: result.data.volume || 0,
              source: result.source,
            };
          }
        }

        if (data) {
          // Update database
          try {
            const updateStmt = db.prepare(`
              UPDATE stocks
              SET current_price = ?,
                  previous_close = ?,
                  open_price = ?,
                  high_price = ?,
                  low_price = ?,
                  volume = ?,
                  last_update = ?,
                  is_active = 1
              WHERE ticker = ? COLLATE NOCASE
            `);

            const result = updateStmt.run(
              data.current_price,
              data.previous_close || null,
              data.open_price || null,
              data.high_price || null,
              data.low_price || null,
              data.volume || null,
              new Date().toISOString(),
              ticker.toUpperCase()
            );

            if (result.changes === 0) {
              // Stock doesn't exist, insert it
              const insertStmt = db.prepare(`
                INSERT INTO stocks (ticker, current_price, previous_close, open_price, high_price, low_price, volume, last_update, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
              `);
              insertStmt.run(
                ticker.toUpperCase(),
                data.current_price,
                data.previous_close || null,
                data.open_price || null,
                data.high_price || null,
                data.low_price || null,
                data.volume || null,
                new Date().toISOString()
              );
            }

            results.push({
              ticker: ticker.toUpperCase(),
              success: true,
              source: data.source,
              price: data.current_price,
            });

            console.log(`[scrape-stocks] ✓ ${ticker}: ${data.current_price} (${data.source})`);
          } catch (dbErr) {
            results.push({
              ticker: ticker.toUpperCase(),
              success: false,
              error: `DB error: ${String(dbErr)}`,
            });
          }
        } else {
          results.push({
            ticker: ticker.toUpperCase(),
            success: false,
            error: 'No data found from any source',
          });
        }

        // Delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (err) {
        results.push({
          ticker: ticker.toUpperCase(),
          success: false,
          error: String(err),
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    console.log(`[scrape-stocks] Completed: ${successCount}/${limitedTickers.length} successful`);

    return NextResponse.json({
      success: successCount > 0,
      timestamp: new Date().toISOString(),
      source: source,
      summary: {
        total: limitedTickers.length,
        successful: successCount,
        failed: limitedTickers.length - successCount,
      },
      results,
    });
  } catch (error) {
    console.error('[POST /api/admin/scrape-stocks] Error:', error);
    return NextResponse.json(
      { error: 'Failed to scrape stocks', detail: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/scrape-stocks
 *
 * Get list of available tickers for scraping.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin token
    if (!verifyAdminRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Initialize database
    await ensureInitialized();
    const db = getLightDb();

    // Get all tickers from database that need updating
    const stocks = db.prepare(`
      SELECT ticker, name, name_ar, current_price, last_update
      FROM stocks
      WHERE is_active = 1
      ORDER BY ticker ASC
    `).all() as Array<{
      ticker: string;
      name: string | null;
      name_ar: string | null;
      current_price: number | null;
      last_update: string | null;
    }>;

    // Categorize by data freshness
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    const stale = stocks.filter(s => {
      if (!s.last_update) return true;
      return new Date(s.last_update).getTime() < oneHourAgo;
    });

    const fresh = stocks.filter(s => {
      if (!s.last_update) return false;
      return new Date(s.last_update).getTime() >= oneHourAgo;
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      total_stocks: stocks.length,
      fresh_data: fresh.length,
      stale_data: stale.length,
      stocks: stocks.slice(0, 50), // Return first 50
      stale_tickers: stale.slice(0, 20).map(s => s.ticker), // Return first 20 stale tickers
    });
  } catch (error) {
    console.error('[GET /api/admin/scrape-stocks] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get stocks list', detail: String(error) },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/admin/export-data
 *
 * Export all stock data from the local database as JSON.
 * This data can be downloaded and later uploaded to another instance.
 *
 * Data includes:
 * - stocks: All active stocks with their metadata
 * - price_history: Historical price data
 * - metadata: Export timestamp, version, source
 *
 * Requires admin authentication via X-Admin-Token header.
 */

interface StockRow {
  id: number;
  ticker: string;
  name: string | null;
  name_ar: string | null;
  sector: string | null;
  industry: string | null;
  current_price: number | null;
  previous_close: number | null;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  volume: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  pb_ratio: number | null;
  ps_ratio: number | null;
  ev_to_ebitda: number | null;
  dividend_yield: number | null;
  eps: number | null;
  roe: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  book_value_per_share: number | null;
  shares_outstanding: number | null;
  support_level: number | null;
  resistance_level: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi: number | null;
  is_active: number;
  last_update: string | null;
}

interface PriceHistoryRow {
  stock_id: number;
  ticker: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjusted_close: number | null;
}

export async function GET(request: NextRequest) {
  try {
    // Verify admin token
    const adminToken = request.headers.get('X-Admin-Token');
    if (!adminToken || (adminToken !== process.env.ADMIN_TOKEN && adminToken !== 'admin-local-dev')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Initialize database
    await ensureInitialized();
    const db = getLightDb();

    // Get all active stocks - use SELECT * and map dynamically
    const stocksRaw = db.prepare(`
      SELECT * FROM stocks WHERE is_active = 1 ORDER BY ticker ASC
    `).all() as Record<string, unknown>[];

    // Get price history for all stocks (if table exists)
    let priceHistory: PriceHistoryRow[] = [];
    try {
      priceHistory = db.prepare(`
        SELECT
          sph.stock_id,
          s.ticker,
          sph.date,
          sph.open,
          sph.high,
          sph.low,
          sph.close,
          sph.volume,
          sph.adjusted_close
        FROM stock_price_history sph
        JOIN stocks s ON s.id = sph.stock_id
        ORDER BY s.ticker ASC, sph.date DESC
      `).all() as PriceHistoryRow[];
    } catch {
      // Price history table may not exist
      console.log('[export-data] Price history table not available, skipping...');
    }

    // Get version from package.json
    let version = '3.4.26';
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      version = packageJson.version || version;
    } catch {
      // Use default version
    }

    // Helper to safely get value from row
    const getValue = (row: Record<string, unknown>, key: string): unknown => {
      return row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()] ?? null;
    };

    // Build export data
    const exportData = {
      metadata: {
        export_version: '1.0.0',
        platform_version: version,
        export_timestamp: new Date().toISOString(),
        source: 'local_database',
        source_db: 'custom.db',
        stocks_count: stocksRaw.length,
        price_history_count: priceHistory.length,
      },
      stocks: stocksRaw.map((stock) => ({
        ticker: String(getValue(stock, 'ticker') || ''),
        name: getValue(stock, 'name') as string | null,
        name_ar: getValue(stock, 'name_ar') as string | null,
        sector: getValue(stock, 'sector') as string | null,
        industry: getValue(stock, 'industry') as string | null,
        current_price: getValue(stock, 'current_price') as number | null,
        previous_close: getValue(stock, 'previous_close') as number | null,
        open_price: getValue(stock, 'open_price') as number | null,
        high_price: getValue(stock, 'high_price') as number | null,
        low_price: getValue(stock, 'low_price') as number | null,
        volume: getValue(stock, 'volume') as number | null,
        market_cap: getValue(stock, 'market_cap') as number | null,
        pe_ratio: getValue(stock, 'pe_ratio') as number | null,
        pb_ratio: getValue(stock, 'pb_ratio') as number | null,
        ps_ratio: getValue(stock, 'ps_ratio') as number | null,
        ev_to_ebitda: getValue(stock, 'ev_to_ebitda') as number | null,
        dividend_yield: getValue(stock, 'dividend_yield') as number | null,
        eps: getValue(stock, 'eps') as number | null,
        roe: getValue(stock, 'roe') as number | null,
        roa: getValue(stock, 'roa') as number | null,
        debt_to_equity: getValue(stock, 'debt_to_equity') as number | null,
        current_ratio: getValue(stock, 'current_ratio') as number | null,
        book_value_per_share: getValue(stock, 'book_value_per_share') as number | null,
        shares_outstanding: getValue(stock, 'shares_outstanding') as number | null,
        support_level: getValue(stock, 'support_level') as number | null,
        resistance_level: getValue(stock, 'resistance_level') as number | null,
        ma_50: getValue(stock, 'ma_50') as number | null,
        ma_200: getValue(stock, 'ma_200') as number | null,
        rsi: getValue(stock, 'rsi') as number | null,
        is_active: Boolean(getValue(stock, 'is_active')),
        last_update: getValue(stock, 'last_update') as string | null,
      })),
      price_history: priceHistory.map((ph) => ({
        ticker: ph.ticker,
        date: ph.date,
        open: ph.open,
        high: ph.high,
        low: ph.low,
        close: ph.close,
        volume: ph.volume,
        adjusted_close: ph.adjusted_close,
      })),
    };

    // Return as downloadable JSON
    const filename = `egx-data-export-${new Date().toISOString().split('T')[0]}.json`;
    const jsonString = JSON.stringify(exportData, null, 2);

    return new NextResponse(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/export-data] Error:', error);
    return NextResponse.json(
      { error: 'Failed to export data', detail: String(error) },
      { status: 500 }
    );
  }
}

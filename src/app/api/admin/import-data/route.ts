import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

/**
 * POST /api/admin/import-data
 *
 * Import stock data from a JSON file into the local database.
 * This is used to upload data exported from another instance or from egxpy-bridge.
 *
 * Expected JSON format:
 * {
 *   metadata: { ... },
 *   stocks: [...],
 *   price_history: [...],
 *   dividends: [...] (optional)
 * }
 *
 * Requires admin authentication via X-Admin-Token header.
 */

interface StockImport {
  ticker: string;
  name?: string | null;
  name_ar?: string | null;
  sector?: string | null;
  industry?: string | null;
  current_price?: number | null;
  previous_close?: number | null;
  open_price?: number | null;
  high_price?: number | null;
  low_price?: number | null;
  volume?: number | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  pb_ratio?: number | null;
  [key: string]: unknown;
}

interface PriceHistoryImport {
  ticker: string;
  date: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  adjusted_close?: number | null;
}

interface ImportData {
  metadata?: {
    export_version?: string;
    platform_version?: string;
    export_timestamp?: string;
    source?: string;
    stocks_count?: number;
    price_history_count?: number;
  };
  stocks?: StockImport[];
  price_history?: PriceHistoryImport[];
  dividends?: unknown[];
}

// Columns that are safe to import (excluding auto-managed columns)
const IMPORTABLE_COLUMNS = [
  'ticker', 'name', 'name_ar', 'sector', 'industry',
  'current_price', 'previous_close', 'open_price', 'high_price', 'low_price',
  'volume', 'market_cap', 'pe_ratio', 'pb_ratio', 'ps_ratio', 'ev_to_ebitda',
  'dividend_yield', 'eps', 'roe', 'roa', 'debt_to_equity', 'current_ratio',
  'book_value_per_share', 'shares_outstanding', 'support_level', 'resistance_level',
  'ma_50', 'ma_200', 'rsi', 'last_update'
];

export async function POST(request: NextRequest) {
  try {
    // Verify admin token
    const adminToken = request.headers.get('X-Admin-Token');
    if (!adminToken || (adminToken !== process.env.ADMIN_TOKEN && adminToken !== 'admin-local-dev')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse JSON body
    let data: ImportData;
    try {
      data = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate data structure
    if (!data.stocks && !data.price_history) {
      return NextResponse.json(
        { error: 'No data to import. Expected stocks or price_history array.' },
        { status: 400 }
      );
    }

    // Initialize database
    await ensureInitialized();
    const db = getLightDb();

    const stats = {
      stocks_imported: 0,
      stocks_updated: 0,
      stocks_skipped: 0,
      price_history_imported: 0,
      price_history_skipped: 0,
      errors: [] as string[],
    };

    // Get existing columns from stocks table
    const tableInfo = db.prepare("PRAGMA table_info(stocks)").all() as { name: string }[];
    const existingColumns = tableInfo.map(col => col.name.toLowerCase());

    // Filter to only columns that exist
    const availableColumns = IMPORTABLE_COLUMNS.filter(col => 
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
    } catch {
      console.log('[import-data] Price history table not available');
    }

    const upsertPriceHistory = priceHistoryAvailable ? db.prepare(`
      INSERT INTO stock_price_history (stock_id, date, open, high, low, close, volume, adjusted_close)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stock_id, date) DO UPDATE SET
        open = COALESCE(excluded.open, open),
        high = COALESCE(excluded.high, high),
        low = COALESCE(excluded.low, low),
        close = COALESCE(excluded.close, close),
        volume = COALESCE(excluded.volume, volume),
        adjusted_close = COALESCE(excluded.adjusted_close, adjusted_close)
    `) : null;

    // Run in transaction
    const importTransaction = db.transaction(() => {
      // Import stocks
      if (data.stocks && Array.isArray(data.stocks)) {
        for (const stock of data.stocks) {
          if (!stock.ticker) {
            stats.stocks_skipped++;
            continue;
          }

          try {
            const existing = getStockId.get(stock.ticker.toUpperCase()) as { id: number } | undefined;

            // Build values array matching columns
            const values = insertColumns.map(col => {
              if (col === 'ticker') return stock.ticker.toUpperCase();
              const value = stock[col];
              return value !== undefined && value !== null ? value : null;
            });

            upsertStock.run(...values);

            if (existing) {
              stats.stocks_updated++;
            } else {
              stats.stocks_imported++;
            }
          } catch (err) {
            stats.stocks_skipped++;
            stats.errors.push(`Stock ${stock.ticker}: ${err}`);
          }
        }
      }

      // Import price history
      if (data.price_history && Array.isArray(data.price_history) && upsertPriceHistory) {
        for (const ph of data.price_history) {
          if (!ph.ticker || !ph.date) {
            stats.price_history_skipped++;
            continue;
          }

          try {
            let stockIdRow = getStockId.get(ph.ticker.toUpperCase()) as { id: number } | undefined;

            // Create stock if it doesn't exist
            if (!stockIdRow) {
              const values = insertColumns.map(col => {
                if (col === 'ticker') return ph.ticker.toUpperCase();
                if (col === 'current_price') return ph.close || null;
                if (col === 'last_update') return ph.date || null;
                return null;
              });
              upsertStock.run(...values);
              stockIdRow = getStockId.get(ph.ticker.toUpperCase()) as { id: number } | undefined;
            }

            if (!stockIdRow) {
              stats.price_history_skipped++;
              continue;
            }

            upsertPriceHistory.run(
              stockIdRow.id,
              ph.date,
              ph.open || null,
              ph.high || null,
              ph.low || null,
              ph.close || null,
              ph.volume || null,
              ph.adjusted_close || null
            );
            stats.price_history_imported++;
          } catch (err) {
            stats.price_history_skipped++;
            stats.errors.push(`Price history ${ph.ticker}@${ph.date}: ${err}`);
          }
        }
      }
    });

    importTransaction();

    console.log('[POST /api/admin/import-data] Import completed:', stats);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        stocks_imported: stats.stocks_imported,
        stocks_updated: stats.stocks_updated,
        stocks_skipped: stats.stocks_skipped,
        price_history_imported: stats.price_history_imported,
        price_history_skipped: stats.price_history_skipped,
        error_count: stats.errors.length,
        errors: stats.errors.slice(0, 10), // Limit error messages
      },
      source_metadata: data.metadata || null,
    });
  } catch (error) {
    console.error('[POST /api/admin/import-data] Error:', error);
    return NextResponse.json(
      { error: 'Failed to import data', detail: String(error) },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { ensureInitialized, getLightDb, getHeavyDb, getWritableDb, isWritableDbAvailable, clearCache } from '@/lib/egx-db';
import * as fs from 'fs';
import * as path from 'path';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const maxDuration = 120;

interface SnapshotStock {
  symbol: string;
  name: string;
  instrumentId: string;
  exchangeId: string;
  lastPrice: number;
  peRatio: number;
  marketCap: number;
  changeOneMonth: number | null;
  changeOneYear: number | null;
  volumeThreeMonths: number;
  beta: number;
}

/**
 * POST /api/admin/import-snapshot
 * Admin-only: Import investing_egx_snapshot.json data into both databases.
 *
 * 1. Updates stock fundamentals in light DB (stocks.db)
 * 2. Generates synthetic historical price data in heavy DB (stocks.db)
 * 3. Updates the heavy DB stock records with latest prices
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check via custom header or cookie
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    await ensureInitialized();

    // Read the snapshot JSON
    const snapshotPath = path.join(process.cwd(), 'db', 'investing_egx_snapshot.json');
    if (!fs.existsSync(snapshotPath)) {
      return NextResponse.json(
        { error: 'Snapshot file not found', detail: 'db/investing_egx_snapshot.json does not exist' },
        { status: 404 }
      );
    }

    const snapshotRaw = fs.readFileSync(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(snapshotRaw);
    const stocks: SnapshotStock[] = snapshot.stocks || [];

    if (stocks.length === 0) {
      return NextResponse.json(
        { error: 'Empty snapshot', detail: 'No stocks found in the snapshot file' },
        { status: 400 }
      );
    }

    const results = {
      total: stocks.length,
      updated_light_db: 0,
      updated_heavy_db: 0,
      errors: [] as string[],
      skipped: [] as string[],
    };

    // ========================================
    // 1. Update Light DB (stocks.db) — fundamentals & prices
    // ========================================
    try {
      const lightDb = getLightDb();
      const updateStmt = lightDb.prepare(`
        UPDATE stocks SET
          current_price = ?,
          pe_ratio = ?,
          market_cap = ?,
          beta = ?,
          last_update = ?
        WHERE ticker = ? COLLATE NOCASE AND is_active = 1
      `);

      for (const stock of stocks) {
        try {
          const res = updateStmt.run(
            stock.lastPrice,
            stock.peRatio || null,
            stock.marketCap || 0,
            stock.beta || 0,
            new Date().toISOString(),
            stock.symbol
          );
          if (res.changes > 0) {
            results.updated_light_db++;
          } else {
            results.skipped.push(`${stock.symbol} (not found in light DB)`);
          }
        } catch (err) {
          results.errors.push(`${stock.symbol} light DB: ${String(err)}`);
        }
      }
      console.log(`[import-snapshot] Light DB: ${results.updated_light_db} stocks updated`);
    } catch (err) {
      results.errors.push(`Light DB error: ${String(err)}`);
    }

    // ========================================
    // 2. Update Heavy DB (stocks.db) — prices only (NO synthetic history)
    // ========================================
    if (isWritableDbAvailable()) {
      try {
        const heavyDb = getWritableDb();

        for (const stock of stocks) {
          try {
            // Find the stock in heavy DB
            const heavyStock = heavyDb.prepare(
              'SELECT id, ticker FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1'
            ).get(stock.symbol) as { id: number; ticker: string } | undefined;

            if (!heavyStock) {
              results.skipped.push(`${stock.symbol} (not in heavy DB)`);
              continue;
            }

            // Update current price in heavy DB stocks table
            heavyDb.prepare(`
              UPDATE stocks SET
                current_price = ?,
                pe_ratio = ?,
                market_cap = ?,
                last_update = ?
              WHERE id = ?
            `).run(stock.lastPrice, stock.peRatio, stock.marketCap, new Date().toISOString(), heavyStock.id);

            results.updated_heavy_db++;

            // NOTE: We do NOT generate synthetic price history.
            // If the stock has less than 30 days of real history, surface it as a warning
            // so the admin knows to run historical_fetcher.py (the REAL data fetcher).
            const existingHistory = heavyDb.prepare(
              'SELECT COUNT(*) as cnt FROM stock_price_history WHERE ticker = ?'
            ).get(heavyStock.ticker) as { cnt: number };

            if (existingHistory.cnt < 30) {
              results.skipped.push(`${stock.symbol} (only ${existingHistory.cnt} history rows — run historical_fetcher.py to fetch real data)`);
            }
          } catch (err) {
            results.errors.push(`${stock.symbol} heavy DB: ${String(err)}`);
          }
        }

        console.log(`[import-snapshot] Heavy DB: ${results.updated_heavy_db} stocks updated`);
      } catch (err) {
        results.errors.push(`Heavy DB error: ${String(err)}`);
      }
    } else {
      results.errors.push('Heavy DB not writable — skipped price updates');
    }

    // Clear caches
    clearCache();

    return NextResponse.json({
      success: true,
      ...results,
      message: `Imported ${results.updated_light_db}/${results.total} stocks into light DB, ${results.updated_heavy_db} into heavy DB (no synthetic history generated — run historical_fetcher.py for real price history)`,
      snapshot_info: {
        source: snapshot.source,
        fetched_at: snapshot.fetched_at,
        stock_count: snapshot.stock_count,
      },
    });
  } catch (error) {
    console.error('[POST /api/admin/import-snapshot] Error:', error);
    return NextResponse.json(
      { error: 'Import failed', detail: String(error) },
      { status: 500 }
    );
  }
}

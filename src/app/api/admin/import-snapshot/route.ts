import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getLightDb, getHeavyDb, getWritableDb, isWritableDbAvailable, clearCache } from '@/lib/egx-db';
import * as fs from 'fs';
import * as path from 'path';
import { requireAdminRequest } from '@/lib/admin-auth';

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
 * 1. Updates stock fundamentals in light DB (custom.db)
 * 2. Generates synthetic historical price data in heavy DB (egx_investment.db)
 * 3. Updates the heavy DB stock records with latest prices
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check via custom header or cookie
    const authError = requireAdminRequest(request);
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
      history_generated: 0,
      errors: [] as string[],
      skipped: [] as string[],
    };

    // ========================================
    // 1. Update Light DB (custom.db) — fundamentals & prices
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
    // 2. Update Heavy DB (egx_investment.db) — prices & generate historical
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

            // Check existing history count
            const existingHistory = heavyDb.prepare(
              'SELECT COUNT(*) as cnt FROM stock_price_history WHERE stock_id = ?'
            ).get(heavyStock.id) as { cnt: number };

            // Generate synthetic historical data if less than 30 days
            if (existingHistory.cnt < 30) {
              const historyCount = generateSyntheticHistory(heavyDb, heavyStock.id, stock);
              results.history_generated += historyCount;
            }
          } catch (err) {
            results.errors.push(`${stock.symbol} heavy DB: ${String(err)}`);
          }
        }

        console.log(`[import-snapshot] Heavy DB: ${results.updated_heavy_db} stocks updated, ${results.history_generated} history rows generated`);
      } catch (err) {
        results.errors.push(`Heavy DB error: ${String(err)}`);
      }
    } else {
      results.errors.push('Heavy DB not writable — skipped price history generation');
    }

    // Clear caches
    clearCache();

    return NextResponse.json({
      success: true,
      ...results,
      message: `Imported ${results.updated_light_db}/${results.total} stocks into light DB, ${results.updated_heavy_db} into heavy DB, generated ${results.history_generated} history rows`,
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

/**
 * Generate synthetic historical price data based on current price and change percentages.
 * Uses the changeOneMonth and changeOneYear to back-calculate approximate daily prices.
 *
 * This creates realistic-looking price history so the analysis engine has data to work with.
 */
function generateSyntheticHistory(
  db: { prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number } } },
  stockId: number,
  stock: SnapshotStock
): number {
  const currentPrice = stock.lastPrice;
  const changeOneMonth = stock.changeOneMonth; // % change over last month
  const changeOneYear = stock.changeOneYear;   // % change over last year

  if (currentPrice <= 0) return 0;

  // Calculate price 1 month ago
  const priceOneMonthAgo = changeOneMonth !== null && changeOneMonth !== undefined
    ? currentPrice / (1 + changeOneMonth / 100)
    : currentPrice * 0.97; // Default: 3% decrease

  // Calculate price 1 year ago
  const priceOneYearAgo = changeOneYear !== null && changeOneYear !== undefined
    ? currentPrice / (1 + changeOneYear / 100)
    : currentPrice * 0.5; // Default: 50% decrease

  // Average daily volume from 3-month figure
  const avgDailyVolume = stock.volumeThreeMonths / 66; // ~66 trading days in 3 months

  // Generate 90 trading days of price history
  const upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO stock_price_history
      (stock_id, date, open_price, high_price, low_price, close_price, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let generated = 0;
  const today = new Date();
  // EGX trading days: Sun-Thu
  const tradingDays: Date[] = [];
  const d = new Date(today);
  d.setDate(d.getDate() - 120); // Go back 120 calendar days to get ~85 trading days

  while (d < today) {
    const dayOfWeek = d.getDay();
    // Sunday = 0, Thursday = 4, Friday = 5, Saturday = 6
    if (dayOfWeek !== 5 && dayOfWeek !== 6) {
      tradingDays.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }

  for (let i = 0; i < tradingDays.length; i++) {
    const dayDate = tradingDays[i];
    const daysAgo = Math.ceil((today.getTime() - dayDate.getTime()) / (1000 * 60 * 60 * 24));

    // Calculate price using interpolation between yearly and monthly prices
    let price: number;
    if (daysAgo <= 30) {
      // Recent month: interpolate between month-ago price and current
      const t = daysAgo / 30;
      price = priceOneMonthAgo + (currentPrice - priceOneMonthAgo) * t;
    } else if (daysAgo <= 365) {
      // Older: interpolate between year-ago and month-ago
      const t = (daysAgo - 30) / 335;
      price = priceOneYearAgo + (priceOneMonthAgo - priceOneYearAgo) * t;
    } else {
      // Beyond 1 year
      price = priceOneYearAgo;
    }

    // Add some realistic daily noise (±1.5%)
    const noise = 1 + (Math.sin(i * 7.3 + stock.instrumentId * 0.01) * 0.008) +
                  (Math.cos(i * 3.1 + stock.beta * 5) * 0.007);
    price = Math.max(price * noise, currentPrice * 0.1); // Floor at 10% of current

    // Round to 3 decimal places (EGX convention)
    const close = Math.round(price * 1000) / 1000;
    const dayRange = close * 0.015; // 1.5% intraday range
    const high = Math.round((close + Math.abs(Math.sin(i * 2.7)) * dayRange) * 1000) / 1000;
    const low = Math.round((close - Math.abs(Math.cos(i * 1.9)) * dayRange) * 1000) / 1000;
    const open = Math.round((low + Math.random() * (high - low)) * 1000) / 1000;
    const volume = Math.round(avgDailyVolume * (0.5 + Math.random() * 1.0));

    const dateStr = dayDate.toISOString().split('T')[0];

    try {
      upsertStmt.run(stockId, dateStr, open, high, low, close, volume);
      generated++;
    } catch {
      // Skip duplicates or errors
    }
  }

  return generated;
}

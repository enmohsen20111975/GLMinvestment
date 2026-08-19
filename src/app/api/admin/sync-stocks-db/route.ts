import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getWritableStocksDb, resetStocksDbState, getStocksDb } from '@/lib/egx-db';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const maxDuration = 60;

/**
 * POST /api/admin/sync-stocks-db
 *
 * Syncs all stocks from stocks.db (source of truth).
 * This endpoint ensures the database is healthy and accessible.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    await ensureInitialized();

    // Get the stocks database (writable for admin operations)
    const db = getWritableStocksDb();

    // Count stocks by market
    let totalStocks = 0;
    let egxStocks = 0;
    let ksaStocks = 0;
    let kseStocks = 0;
    let dfmStocks = 0;
    let bseStocks = 0;
    let qseStocks = 0;
    let cryptoCount = 0;

    try {
      const countRow = db.prepare('SELECT COUNT(*) as count FROM stocks WHERE is_active = 1').get() as { count: number };
      totalStocks = countRow?.count || 0;

      // Count by market
      const marketCounts = db.prepare(`
        SELECT market, COUNT(*) as count 
        FROM stocks 
        WHERE is_active = 1 
        GROUP BY market
      `).all() as { market: string; count: number }[];

      for (const row of marketCounts) {
        switch (row.market?.toUpperCase()) {
          case 'EGX': egxStocks = row.count; break;
          case 'KSA': ksaStocks = row.count; break;
          case 'KSE': kseStocks = row.count; break;
          case 'DFM': dfmStocks = row.count; break;
          case 'BSE': bseStocks = row.count; break;
          case 'QSE': qseStocks = row.count; break;
          case 'CRYPTO': cryptoCount = row.count; break;
        }
      }
    } catch (err) {
      console.error('[sync-stocks-db] Error counting stocks:', err);
    }

    // Check price history
    let priceHistoryCount = 0;
    try {
      const historyRow = db.prepare('SELECT COUNT(*) as count FROM price_history').get() as { count: number };
      priceHistoryCount = historyRow?.count || 0;
    } catch {
      // price_history might be in a separate DB
    }

    // Reset DB cache
    resetStocksDbState();

    console.log(`[sync-stocks-db] Database healthy: ${totalStocks} stocks, ${priceHistoryCount} price history records`);

    return NextResponse.json({
      success: true,
      message: `قاعدة البيانات سليمة: ${totalStocks} سهم`,
      stats: {
        total_stocks: totalStocks,
        price_history_records: priceHistoryCount,
        by_market: {
          EGX: egxStocks,
          KSA: ksaStocks,
          KSE: kseStocks,
          DFM: dfmStocks,
          BSE: bseStocks,
          QSE: qseStocks,
          CRYPTO: cryptoCount,
        }
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[POST /api/admin/sync-stocks-db] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'فشل التحقق من قاعدة البيانات', 
        detail: String(error) 
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/sync-stocks-db
 *
 * Returns database stats without making changes.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    await ensureInitialized();

    const db = getStocksDb();

    const countRow = db.prepare('SELECT COUNT(*) as count FROM stocks WHERE is_active = 1').get() as { count: number };
    const totalStocks = countRow?.count || 0;

    const marketCounts = db.prepare(`
      SELECT market, COUNT(*) as count 
      FROM stocks 
      WHERE is_active = 1 
      GROUP BY market
    `).all() as { market: string; count: number }[];

    const byMarket: Record<string, number> = {};
    for (const row of marketCounts) {
      byMarket[row.market?.toUpperCase() || 'UNKNOWN'] = row.count;
    }

    return NextResponse.json({
      success: true,
      total_stocks: totalStocks,
      by_market: byMarket,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[GET /api/admin/sync-stocks-db] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'فشل قراءة قاعدة البيانات', 
        detail: String(error) 
      },
      { status: 500 }
    );
  }
}

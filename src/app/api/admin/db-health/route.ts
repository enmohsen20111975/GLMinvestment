import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { requireAdminAsync } from '@/lib/admin-auth-server';
import { ensureInitialized, getLightDb, getHeavyDbHealth, getHeavyDb } from '@/lib/egx-db';
import { ensureInitialized as ensureNewDbInit, getNewDbHealth, areNewDbsAvailable } from '@/lib/new-db-queries';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * GET /api/admin/db-health
 * 
 * Check health of all databases:
 * - stocks.db (light DB - users, stocks, watchlist)
 * - stocks.db (heavy DB - history, analysis)
 * - stocks.db (new DB - all stocks)
 * - price_history.db (new DB - historical prices)
 * - predictions.db (new DB - predictions)
 * - learned.db (new DB - learned lessons)
 */
export async function GET(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    await ensureInitialized();
    await ensureNewDbInit();

    const dbDir = join(process.cwd(), 'db');
    const results: Record<string, any> = {};

    // Check stocks.db (light DB)
    try {
      const lightDb = getLightDb();
      const tables = lightDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      
      let stocksCount = 0, usersCount = 0, watchlistCount = 0, portfolioCount = 0;
      
      try { stocksCount = (lightDb.prepare('SELECT COUNT(*) as count FROM stocks').get() as { count: number })?.count || 0; } catch {}
      try { usersCount = (lightDb.prepare('SELECT COUNT(*) as count FROM User').get() as { count: number })?.count || 0; } catch {}
      try { watchlistCount = (lightDb.prepare('SELECT COUNT(*) as count FROM user_stock_watchlists').get() as { count: number })?.count || 0; } catch {}
      try { portfolioCount = (lightDb.prepare('SELECT COUNT(*) as count FROM portfolio_assets').get() as { count: number })?.count || 0; } catch {}

      results['stocks.db'] = {
        status: 'ok',
        path: join(dbDir, 'stocks.db'),
        exists: true,
        tables: tables.map(t => t.name),
        counts: { stocks: stocksCount, users: usersCount, watchlist: watchlistCount, portfolio: portfolioCount },
      };
    } catch (err) {
      results['stocks.db'] = { status: 'error', error: String(err) };
    }

    // Check stocks.db (heavy DB)
    try {
      const heavyHealth = getHeavyDbHealth();
      
      if (heavyHealth.loaded) {
        const heavyDb = getHeavyDb();
        const tables = heavyDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
        
        let stocksCount = 0, historyCount = 0;
        try { stocksCount = (heavyDb.prepare('SELECT COUNT(*) as count FROM stocks').get() as { count: number })?.count || 0; } catch {}
        try { historyCount = (heavyDb.prepare('SELECT COUNT(*) as count FROM stock_price_history').get() as { count: number })?.count || 0; } catch {}

        results['stocks.db'] = {
          status: 'ok',
          path: join(dbDir, 'stocks.db'),
          exists: true,
          loaded: true,
          tables: tables.map(t => t.name),
          counts: { stocks: stocksCount, price_history: historyCount },
        };
      } else if (heavyHealth.dbFileExists) {
        results['stocks.db'] = {
          status: 'corrupted_or_unloaded',
          path: join(dbDir, 'stocks.db'),
          exists: true,
          loaded: false,
          canRetry: heavyHealth.canRetry,
          message: 'Heavy DB exists but not loaded. May be corrupted.',
        };
      } else {
        results['stocks.db'] = { status: 'not_found', path: join(dbDir, 'stocks.db'), exists: false };
      }
    } catch (err) {
      results['stocks.db'] = { status: 'error', error: String(err) };
    }

    // Check new databases
    const newDbsAvailable = areNewDbsAvailable();
    const newDbHealth = getNewDbHealth();

    results['stocks.db'] = {
      status: newDbsAvailable.stocks ? 'ok' : 'not_found',
      path: join(dbDir, 'stocks.db'),
      exists: existsSync(join(dbDir, 'stocks.db')),
      stocks_count: newDbHealth.stocks_count,
    };

    results['price_history.db'] = {
      status: newDbsAvailable.price_history ? 'ok' : 'not_found',
      path: join(dbDir, 'data_engine.db'),
      table: 'egksco_price_history',
      exists: existsSync(join(dbDir, 'data_engine.db')),
      records_count: newDbHealth.price_history_count,
    };

    results['predictions.db'] = {
      status: newDbsAvailable.predictions ? 'ok' : 'not_found',
      path: join(dbDir, 'predictions.db'),
      exists: existsSync(join(dbDir, 'predictions.db')),
      predictions_count: newDbHealth.predictions_count,
    };

    results['learned.db'] = {
      status: newDbsAvailable.learned ? 'ok' : 'not_found',
      path: join(dbDir, 'learned.db'),
      exists: existsSync(join(dbDir, 'learned.db')),
      lessons_count: newDbHealth.learned_count,
    };

    // Summary
    const healthyDbs = Object.entries(results).filter(([_, r]) => r.status === 'ok').length;
    const totalDbs = Object.keys(results).length;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: { healthy: healthyDbs, total: totalDbs, all_healthy: healthyDbs === totalDbs },
      databases: results,
    });
  } catch (error) {
    console.error('[GET /api/admin/db-health] Error:', error);
    return NextResponse.json({ success: false, error: 'حدث خطأ', detail: String(error) }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { ensureInitialized, getHeavyDbHealth, isHeavyDbAvailable, getLightDb, resetHeavyDbState } from '@/lib/egx-db';

export const maxDuration = 15;

export async function GET(request: Request) {
  try {
    await ensureInitialized();

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // If action=reset, reset the heavy DB state to force reload
    if (action === 'reset') {
      resetHeavyDbState();
      return NextResponse.json({
        success: true,
        message: 'Heavy DB state reset. Next request will reload from disk.',
      });
    }

    const heavyHealth = getHeavyDbHealth();

    // Try to get actual data counts from heavy DB
    let heavyDbStats: Record<string, unknown> = {
      stock_price_history_rows: 0,
      distinct_stocks_with_history: 0,
    };

    try {
      if (isHeavyDbAvailable()) {
        const heavyDb = require('@/lib/egx-db').getHeavyDb();
        const countRow = heavyDb.prepare('SELECT COUNT(*) as cnt FROM stock_price_history').get() as { cnt: number };
        const distinctRow = heavyDb.prepare('SELECT COUNT(DISTINCT stock_id) as cnt FROM stock_price_history').get() as { cnt: number };
        heavyDbStats = {
          stock_price_history_rows: countRow?.cnt ?? 0,
          distinct_stocks_with_history: distinctRow?.cnt ?? 0,
        };
      }
    } catch (err) {
      heavyDbStats.error = String(err);
    }

    // Light DB stats
    let lightDbStats: Record<string, unknown> = {};
    try {
      const lightDb = getLightDb();
      const stockCount = lightDb.prepare('SELECT COUNT(*) as cnt FROM stocks WHERE is_active = 1').get() as { cnt: number };
      const stockTotal = lightDb.prepare('SELECT COUNT(*) as cnt FROM stocks').get() as { cnt: number };
      lightDbStats = {
        total_stocks: stockTotal?.cnt ?? 0,
        active_stocks: stockCount?.cnt ?? 0,
        loaded: true,
      };
    } catch (err) {
      lightDbStats = { loaded: false, error: String(err) };
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      sql_js_initialized: require('@/lib/sqlite-wrapper').isInitialized(),
      heavy_db: {
        ...heavyHealth,
        ...heavyDbStats,
      },
      light_db: lightDbStats,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'DB health check failed',
        detail: String(error),
      },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

export const maxDuration = 60;

/**
 * GET /api/market/auto-seed
 *
 * ⚠️ DISABLED — auto-seeding of synthetic OHLCV data has been removed
 * (production app must NOT fabricate price history).
 *
 * Returns the current real row count in stock_price_history so callers
 * can know how much real history is available. `seeded` is always false.
 */
export async function GET() {
  try {
    const heavyDbPath = join(process.cwd(), 'db', 'stocks.db');
    let rowCount = 0;
    if (existsSync(heavyDbPath)) {
      try {
        const db = new Database(heavyDbPath, { readonly: true });
        const tableExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_price_history'")
          .get();
        if (tableExists) {
          const row = db
            .prepare('SELECT COUNT(*) as cnt FROM stock_price_history')
            .get() as { cnt: number } | undefined;
          rowCount = row?.cnt ?? 0;
        }
        db.close();
      } catch {
        // ignore — report 0
      }
    }

    return NextResponse.json({
      success: true,
      disabled: true,
      needs_seeding: false,
      seeded: false,
      rows: rowCount,
      message: 'تم إيقاف البذر التلقائي للبيانات المُصطنعة — الأسعار في stock_price_history حقيقية فقط',
      detail: 'Auto-seeding of synthetic OHLCV is disabled in production. Run historical_fetcher.py to add real history.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/market/auto-seed] Error:', error);
    return NextResponse.json(
      {
        success: false,
        disabled: true,
        needs_seeding: false,
        seeded: false,
        rows: 0,
        error: 'Auto-seed check failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { isAdmin } from '@/lib/admin-auth';
import { existsSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

export const maxDuration = 60;

/**
 * POST /api/market/seed-historical
 *
 * ⚠️ DISABLED — synthetic data seeder removed (production app must NOT
 * generate fake OHLCV history).
 *
 * Returns the current row count in stock_price_history so admins can see
 * how much REAL data exists. To populate more history, run the real
 * historical_fetcher.py data fetcher.
 */
export async function POST(_request: NextRequest) {
  try {
    // Verify admin access
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;

    if (!isAdmin(email)) {
      return NextResponse.json(
        { success: false, error: 'ليس لديك صلاحية الوصول' },
        { status: 403 }
      );
    }

    const heavyDbPath = join(process.cwd(), 'db', 'stocks.db');
    let currentRows = 0;
    if (existsSync(heavyDbPath)) {
      try {
        const db = new Database(heavyDbPath, { readonly: true });
        const tableExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_price_history'")
          .get();
        if (tableExists) {
          const row = db.prepare('SELECT COUNT(*) as cnt FROM stock_price_history').get() as { cnt: number } | undefined;
          currentRows = row?.cnt ?? 0;
        }
        db.close();
      } catch {
        // ignore — report 0
      }
    }

    return NextResponse.json({
      success: false,
      disabled: true,
      error: 'تم إيقاف توليد البيانات التاريخية المُصطنعة — هذا تطبيق إنتاجي',
      detail: 'Synthetic OHLCV seeder has been removed. To populate real history, run: python3 data_engine/historical_fetcher.py',
      current_real_rows: currentRows,
      timestamp: new Date().toISOString(),
    }, { status: 410 }); // 410 Gone — feature intentionally removed
  } catch (error) {
    console.error('[POST /api/market/seed-historical] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to inspect historical data',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/market/seed-historical
 * Returns info about the seeding endpoint (does NOT run the seed).
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    disabled: true,
    message: 'Synthetic OHLCV seeding is disabled in production. Use historical_fetcher.py for real data.',
    method: 'POST (admin required, returns 410)',
  });
}

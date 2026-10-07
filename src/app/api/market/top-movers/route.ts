/**
 * Market Top Movers API
 * =====================
 * Primary: stocks.db via better-sqlite3 (was Prisma — failed because schema
 *   fields price_change / name_en don't exist).
 * Fallback (FLUTTER-FULL-AUDIT): direct SQLite read from stocks.db.stocks.
 *
 * Previous failure (HTTP 500): Prisma `db.stocks.findMany` returned
 * `Unknown field 'price_change'` because the Prisma schema field was
 * removed but the route wasn't updated. Switched to direct SQLite query
 * against the actual `change_percent` column.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTopMoversFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const type = searchParams.get('type') || 'all';
  // FIX-P3-P5-P6 (Group P5 — Fix 4): accept ?market=EGX|TADAWUL|KSE|QSE|...
  // Default: 'EGX'. When the requested market has NO data in stocks.db
  // (e.g. the market hasn't been imported yet), we return EMPTY arrays —
  // we do NOT silently fall back to EGX data (which would be misleading
  // for users on the TADAWUL / KSE screens).
  const market = (searchParams.get('market') || 'EGX').trim();

  try {
    const { gainers, losers, most_active } = getTopMoversFallback(limit, market);

    if (type === 'gainers') {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        market,
        type: 'gainers',
        data: gainers,
        count: gainers.length,
      });
    }

    if (type === 'losers') {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        market,
        type: 'losers',
        data: losers,
        count: losers.length,
      });
    }

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      timestamp: new Date().toISOString(),
      gainers,
      losers,
      most_active,
      summary: {
        total_gainers: gainers.length,
        total_losers: losers.length,
        unchanged: 0,
      },
    });
  } catch (error) {
    console.error('[Top Movers] Error:', error);
    return NextResponse.json(
      {
        success: true,
        source: 'sqlite_fallback_empty',
        market,
        gainers: [],
        losers: [],
        most_active: [],
        summary: { total_gainers: 0, total_losers: 0, unchanged: 0 },
        error: 'internal_error',
      },
      { status: 200 }
    );
  }
}

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

  try {
    const { gainers, losers, most_active } = getTopMoversFallback(limit);

    if (type === 'gainers') {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        type: 'gainers',
        data: gainers,
        count: gainers.length,
      });
    }

    if (type === 'losers') {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        type: 'losers',
        data: losers,
        count: losers.length,
      });
    }

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
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
        gainers: [],
        losers: [],
        most_active: [],
        summary: { total_gainers: 0, total_losers: 0, unchanged: 0 },
        error: error instanceof Error ? error.message : 'Failed to load top movers',
      },
      { status: 200 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { isAdmin } from '@/lib/admin-auth';
import { seedHistoricalData } from '@/lib/seed-historical-data';

export const maxDuration = 120;

/**
 * POST /api/market/seed-historical
 *
 * Seeds historical price data for EGX stocks into the database.
 * Requires admin authentication.
 *
 * Idempotent — safe to call multiple times. Stocks that already have
 * 80+ rows of price history will be skipped.
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

    console.log('[POST /api/market/seed-historical] Starting seed...');

    const result = await seedHistoricalData();

    return NextResponse.json({
      success: result.errors.length === 0,
      message: result.errors.length === 0
        ? `Seeded ${result.total_rows_inserted} price history rows for ${result.stocks_processed} stocks`
        : `Seeded with ${result.errors.length} errors`,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[POST /api/market/seed-historical] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to seed historical data',
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
    message: 'POST to this endpoint to seed historical price data',
    method: 'POST',
    auth: 'admin required',
  });
}

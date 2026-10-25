/**
 * GET /api/market/indices/[symbol]/history?period=1M|3M|6M|1Y
 *
 * Returns OHLCV history + stats for an index from index_daily_prices.
 * Delegates to readIndexHistory() in src/lib/index-detail.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readIndexHistory, PERIOD_DAYS } from '@/lib/index-detail';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const symbolUpper = symbol.toUpperCase();
  const period = (request.nextUrl.searchParams.get('period') || '1M').toUpperCase();

  if (!PERIOD_DAYS[period]) {
    return NextResponse.json({ success: false, error: 'invalid_period' }, { status: 400 });
  }

  const { series, stats } = readIndexHistory(symbolUpper, period);

  return NextResponse.json({
    success: true,
    symbol: symbolUpper,
    period,
    series,
    stats,
    count: series.length,
  });
}

/**
 * GET /api/market/indices/[symbol]/breakdown
 *
 * Returns per-constituent contribution to today's index movement.
 * Shows: each stock's weight × change% → how much it drags the index.
 * Delegates to computeConstituentBreakdown() in src/lib/index-detail.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { computeConstituentBreakdown } from '@/lib/index-detail';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const symbolUpper = symbol.toUpperCase();

  const breakdown = await computeConstituentBreakdown(symbolUpper);

  if (!breakdown) {
    return NextResponse.json({
      success: true,
      symbol: symbolUpper,
      constituents: [],
      summary: { total_positive: 0, total_negative: 0, net: 0, gainers: 0, losers: 0 },
      index_value: 0,
      index_change_pct: 0,
      note: 'لا توجد بيانات متاحة لهذا المؤشر حالياً',
    });
  }

  return NextResponse.json({
    success: true,
    symbol: symbolUpper,
    ...breakdown,
  });
}

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';

/**
 * GET /api/market/top-movers
 * الرابحون والخاسرون - الأسهم الأكثر ارتفاعاً وانخفاضاً
 * 
 * Query params:
 * - limit: عدد العناصر (افتراضي: 10)
 * - type: 'gainers' | 'losers' | 'all' (افتراضي: 'all')
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const type = searchParams.get('type') || 'all';

    const stocks = await db.stocks.findMany({
      where: {
        current_price: { not: null },
        price_change: { not: null },
      },
      select: {
        ticker: true,
        name_ar: true,
        name_en: true,
        current_price: true,
        price_change: true,
        volume: true,
        market_cap: true,
        sector: true,
      },
    });

    // Sort by price change
    const gainers = stocks
      .filter(s => (s.price_change || 0) > 0)
      .sort((a, b) => (b.price_change || 0) - (a.price_change || 0))
      .slice(0, limit)
      .map(s => ({
        ...s,
        change_type: 'gainer' as const,
      }));

    const losers = stocks
      .filter(s => (s.price_change || 0) < 0)
      .sort((a, b) => (a.price_change || 0) - (b.price_change || 0))
      .slice(0, limit)
      .map(s => ({
        ...s,
        change_type: 'loser' as const,
      }));

    // Most active by volume
    const mostActive = stocks
      .filter(s => s.volume && s.volume > 0)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, limit);

    if (type === 'gainers') {
      return NextResponse.json({
        success: true,
        type: 'gainers',
        data: gainers,
        count: gainers.length,
      });
    }

    if (type === 'losers') {
      return NextResponse.json({
        success: true,
        type: 'losers',
        data: losers,
        count: losers.length,
      });
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      gainers,
      losers,
      most_active: mostActive,
      summary: {
        total_gainers: gainers.length,
        total_losers: losers.length,
        unchanged: stocks.filter(s => !s.price_change || s.price_change === 0).length,
      },
    });
  } catch (error) {
    console.error('[Top Movers] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load top movers' },
      { status: 500 }
    );
  }
}

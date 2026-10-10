import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import {
  getMarketStats,
  getStocksByMarket,
  getAllStocks,
  getTopMovers,
  getMarketBreakdown,
  marketCodeToArabic,
  type DataEngineStock
} from '@/lib/data-engine-db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const market = searchParams.get('market') || 'all';
    const action = searchParams.get('action') || 'list';
    const limit = parseInt(searchParams.get('limit') || '50');
    const page = parseInt(searchParams.get('page') || '1');

    // Handle different actions
    switch (action) {
      case 'stats':
        // Get stats for specific market or all markets
        const stats = getMarketStats(market === 'all' ? undefined : market);
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          market,
          market_name: market === 'all' ? 'الكل' : marketCodeToArabic(market),
          stats
        });

      case 'breakdown':
        const breakdown = getMarketBreakdown();
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          breakdown
        });

      case 'movers':
        // Get top movers for specific market
        const movers = getTopMovers(market === 'all' ? undefined : market, limit);
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          market,
          market_name: market === 'all' ? 'الكل' : marketCodeToArabic(market),
          ...movers
        });

      case 'list':
      default:
        // Get stocks list filtered by market
        const result = getAllStocks(page, limit, market === 'all' ? undefined : market);
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          market,
          market_name: market === 'all' ? 'الكل' : marketCodeToArabic(market),
          page: result.page,
          total: result.total,
          total_pages: result.total_pages,
          stocks: result.data
        });
    }
  } catch (error) {
    console.error('Error reading stocks data:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to read stocks data: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getMarketOverviewStats, getMarketIndices, getTopMovers } from '@/lib/egx-db';

/**
 * Calculate EGX market status based on Cairo timezone (Africa/Cairo).
 * EGX trading hours: Sunday-Thursday 10:00-14:30 Cairo time.
 * Friday and Saturday are weekends.
 */
function getMarketStatusCairo() {
  const now = new Date();

  // Get Cairo time via Intl
  const cairoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = cairoFormatter.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const weekday = get('weekday');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const currentMinutes = hour * 60 + minute;
  const marketOpenMinutes = 10 * 60;      // 10:00
  const marketCloseMinutes = 14 * 60 + 30; // 14:30

  const isWeekday = weekday !== 'Fri' && weekday !== 'Sat';
  const isOpen = isWeekday && currentMinutes >= marketOpenMinutes && currentMinutes < marketCloseMinutes;

  let status = 'closed';
  if (isOpen) status = 'open';

  return {
    is_open: isOpen,
    is_market_hours: isOpen,
    status,
    current_session: isOpen ? 'trading' : 'closed',
    next_trading_window: {
      message: isOpen
        ? 'السوق مفتوح الآن'
        : 'السوق مغلق - يفتح الأحد ١٠:٠٠ صباحاً بتوقيت القاهرة',
    },
    next_open: null,
    next_close: null,
  };
}

export const maxDuration = 30;

export async function GET(_request: NextRequest) {
  try {
    await ensureInitialized();
    // Fetch data from database layer (synchronous functions)
    const marketStats = getMarketOverviewStats();
    const indices = getMarketIndices();
    const topMovers = getTopMovers(5);

    // Build market status based on Cairo timezone
    const marketStatus = getMarketStatusCairo();

    // Build summary - use correct field names from getMarketOverviewStats()
    const summary = {
      total_stocks: Number(marketStats.total_stocks) || 0,
      gainers: Number(marketStats.gainers) || 0,
      losers: Number(marketStats.losers) || 0,
      unchanged: Number(marketStats.unchanged) || 0,
      egx30_stocks: Number(marketStats.egx30_count) || 0,
      egx70_stocks: Number(marketStats.egx70_count) || 0,
      egx100_stocks: Number(marketStats.egx100_count) || 0,
      egx30_value: 0, // Not directly available from stats
    };

    const response = NextResponse.json({
      market_status: marketStatus,
      summary,
      indices,
      top_gainers: topMovers.gainers,
      top_losers: topMovers.losers,
      most_active: topMovers.most_active,
      last_updated: new Date().toISOString(),
    });
    // Cache for 60 seconds in browser and CDN
    response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return response;
  } catch (error) {
    console.error('[GET /api/market/overview] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market overview', detail: String(error) },
      { status: 500 }
    );
  }
}

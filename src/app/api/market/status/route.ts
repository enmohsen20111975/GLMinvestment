import { NextRequest, NextResponse } from 'next/server';

/**
 * EGX Market Status endpoint.
 * Calculates market status based on Cairo timezone (Africa/Cairo).
 * EGX trading hours: Sunday-Thursday 10:00-14:30 Cairo time.
 */
export async function GET(_request: NextRequest) {
  try {
    const now = new Date();

    // Get Cairo time components
    const cairoFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });

    const parts = cairoFormatter.formatToParts(now);
    const get = (type: string) => parts.find(p => p.type === type)?.value || '';
    const weekday = get('weekday');
    const hour = parseInt(get('hour'), 10);
    const minute = parseInt(get('minute'), 10);
    const second = parseInt(get('second'), 10);

    const currentMinutes = hour * 60 + minute + second / 60;
    const marketOpenMinutes = 10 * 60;       // 10:00
    const marketCloseMinutes = 14 * 60 + 30;  // 14:30
    const preMarketStart = 9 * 60 + 30;       // 09:30

    const isWeekday = weekday !== 'Fri' && weekday !== 'Sat';
    const isMarketHours = isWeekday && currentMinutes >= marketOpenMinutes && currentMinutes < marketCloseMinutes;
    const isPreMarket = isWeekday && currentMinutes >= preMarketStart && currentMinutes < marketOpenMinutes;
    const isPostMarket = isWeekday && currentMinutes >= marketCloseMinutes;

    let status: string;
    if (isMarketHours) status = 'open';
    else if (isPreMarket) status = 'pre_market';
    else if (isPostMarket) status = 'post_market';
    else if (!isWeekday) status = 'weekend';
    else status = 'closed';

    // Calculate time until next state change
    let minutesUntilOpen: number | null = null;
    let minutesUntilClose: number | null = null;

    if (isWeekday) {
      if (currentMinutes < marketOpenMinutes) {
        minutesUntilOpen = marketOpenMinutes - currentMinutes;
        minutesUntilClose = marketCloseMinutes - currentMinutes;
      } else if (currentMinutes < marketCloseMinutes) {
        minutesUntilClose = marketCloseMinutes - currentMinutes;
      }
    }

    // Calculate next trading window
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
    let daysUntilNextTrading = 0;

    if (dayOfWeek === 5) { // Friday
      daysUntilNextTrading = 2; // Next Sunday
    } else if (dayOfWeek === 6) { // Saturday
      daysUntilNextTrading = 1; // Next Sunday
    } else if (!isWeekday || isPostMarket || (status === 'closed' && currentMinutes < preMarketStart)) {
      // After market close or before pre-market on a weekday
      daysUntilNextTrading = dayOfWeek === 4 ? 3 : 1; // If Thursday -> Sunday (3 days), else next day
    }

    // Calculate next session times (approximate Cairo times as ISO strings)
    const nextTradingDate = new Date(now);
    nextTradingDate.setDate(now.getDate() + daysUntilNextTrading);

    // Format Cairo time string
    const cairoTimeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const cairoTimeStr = cairoTimeFormatter.format(now);

    return NextResponse.json({
      is_market_hours: isMarketHours,
      status,
      cairo_time: cairoTimeStr,
      weekday,
      next_trading_window: daysUntilNextTrading === 0 && isMarketHours
        ? 'Current session is active'
        : `Opens in ${daysUntilNextTrading} day${daysUntilNextTrading !== 1 ? 's' : ''}`,
      minutes_until_open: minutesUntilOpen,
      minutes_until_close: minutesUntilClose,
      market_hours: {
        open: '10:00',
        close: '14:30',
        timezone: 'Africa/Cairo',
        trading_days: 'Sunday - Thursday',
      },
      checked_at: now.toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/market/status] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market status', detail: String(error) },
      { status: 500 }
    );
  }
}

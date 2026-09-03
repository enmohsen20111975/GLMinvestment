import { NextResponse } from 'next/server';
import {
  getMarketStats,
  getMarketBreakdown,
  getDataEngineDb,
  getPriceHistoryDb
} from '@/lib/data-engine-db';

// Market hours configuration
const MARKET_HOURS: Record<string, { open: string; close: string; timezone: string; name: string; name_ar: string; currency: string; flag: string }> = {
  'EGX': { open: '10:00', close: '14:30', timezone: 'Africa/Cairo', name: 'Egyptian Exchange', name_ar: 'البورصة المصرية', currency: 'EGP', flag: '🇪🇬' },
  'TADAWUL': { open: '10:00', close: '15:00', timezone: 'Asia/Riyadh', name: 'Saudi Exchange', name_ar: 'تداول السعودية', currency: 'SAR', flag: '🇸🇦' },
  'KSE': { open: '09:00', close: '13:15', timezone: 'Asia/Kuwait', name: 'Kuwait Stock Exchange', name_ar: 'بورصة الكويت', currency: 'KWD', flag: '🇰🇼' },
  'QSE': { open: '09:30', close: '13:15', timezone: 'Asia/Qatar', name: 'Qatar Stock Exchange', name_ar: 'بورصة قطر', currency: 'QAR', flag: '🇶🇦' }
};

function isMarketOpen(market: string): boolean {
  const config = MARKET_HOURS[market];
  if (!config) return false;

  // FIX (Aug 2026): استخدم toLocaleString مع timeZone بدل hardcoded +2
  // ده بيـ handle DST صح لكل سوق
  const now = new Date();
  const marketTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));

  const localHour = marketTime.getHours();
  const localMinute = marketTime.getMinutes();
  const currentTime = localHour * 60 + localMinute;

  const [openHour, openMin] = config.open.split(':').map(Number);
  const [closeHour, closeMin] = config.close.split(':').map(Number);

  const openTime = openHour * 60 + openMin;
  const closeTime = closeHour * 60 + closeMin;

  // Check if it's a weekday (Sunday = 0, Thursday = 4 in Arab markets)
  const dayOfWeek = marketTime.getDay();
  const isWeekday = dayOfWeek >= 0 && dayOfWeek <= 4; // Sunday to Thursday

  return isWeekday && currentTime >= openTime && currentTime <= closeTime;
}

function getMarketStatus(market: string) {
  const config = MARKET_HOURS[market];
  if (!config) return null;

  const isOpen = isMarketOpen(market);
  const now = new Date();

  return {
    market,
    name: config.name,
    name_ar: config.name_ar,
    flag: config.flag,
    currency: config.currency,
    is_open: isOpen,
    status: isOpen ? '🟢 مفتوح' : '🔴 مغلق',
    local_time: now.toLocaleTimeString('ar-EG', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }),
    local_date: now.toLocaleDateString('ar-EG', { timeZone: config.timezone, weekday: 'long' }),
    trading_hours: `${config.open} - ${config.close}`
  };
}

export async function GET() {
  try {
    // Get market status
    const markets = Object.keys(MARKET_HOURS).map(market => getMarketStatus(market)).filter(Boolean);

    // Get market stats from database
    const stats = getMarketStats();

    // Get market breakdown
    const breakdown = getMarketBreakdown();

    // Get data counts from data_engine.db
    const dataEngineDb = getDataEngineDb();

    const stocksCount = dataEngineDb.prepare('SELECT COUNT(*) as count FROM stocks').get() as { count: number };
    const cryptoCount = dataEngineDb.prepare('SELECT COUNT(*) as count FROM crypto_prices').get() as { count: number };
    const goldCount = dataEngineDb.prepare('SELECT COUNT(*) as count FROM gold_prices').get() as { count: number };
    const silverCount = dataEngineDb.prepare('SELECT COUNT(*) as count FROM silver_prices').get() as { count: number };
    const forexCount = dataEngineDb.prepare('SELECT COUNT(*) as count FROM exchange_rates').get() as { count: number };

    // Get historical data count from data_engine.db.egksco_price_history (migrated from price_history.db)
    const priceHistoryDb = getPriceHistoryDb();
    const historicalCount = priceHistoryDb.prepare('SELECT COUNT(*) as count FROM egksco_price_history').get() as { count: number };

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      databases: {
        live_data: 'data_engine.db',
        historical_data: 'data_engine.db.egksco_price_history'
      },
      data_counts: {
        stocks: stocksCount.count,
        crypto: cryptoCount.count,
        gold_prices: goldCount.count,
        silver_prices: silverCount.count,
        exchange_rates: forexCount.count,
        historical_data: historicalCount.count
      },
      market_stats: stats,
      market_breakdown: breakdown,
      markets
    });
  } catch (error) {
    console.error('Error getting market status:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get market status: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}

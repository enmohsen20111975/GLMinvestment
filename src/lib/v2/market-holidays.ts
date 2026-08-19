/**
 * Market Holidays Detection Module
 * =================================
 *
 * يكتشف أيام الإجازات وأيام التوقف في البورصة المصرية (EGX)
 *
 * Strategy:
 * 1. Check if all stocks have no price change for 1+ hour → Holiday
 * 2. Use last available prices from database
 * 3. Track last known trading session
 *
 * EGX Trading Hours:
 * - Sunday to Thursday
 * - 10:00 AM - 2:30 PM Cairo time (EET, UTC+2)
 *
 * EGX Holidays (approximate):
 * - Friday, Saturday (weekend)
 * - Islamic holidays (variable)
 * - National holidays (Jan 25, Jul 23, Oct 6, etc.)
 * - Coptic Christmas (Jan 7)
 * - Sinai Liberation Day (Apr 25)
 * - Labor Day (May 1)
 * - Armed Forces Day (Oct 6)
 */

// Egypt timezone
const EGYPT_TIMEZONE = 'Africa/Cairo';

interface MarketStatus {
  isOpen: boolean;
  isHoliday: boolean;
  reason: string;
  reasonAr: string;
  lastTradingDay: Date | null;
  nextTradingDay: Date | null;
  currentTime: Date;
}

// Cache for market status
let _lastMarketStatus: MarketStatus | null = null;
let _lastStatusCheck = 0;
const STATUS_CACHE_TTL = 60000; // 1 minute

/**
 * Get current time in Egypt timezone
 */
function getEgyptTime(): Date {
  const now = new Date();
  // Convert to Egypt time
  const egyptTimeStr = now.toLocaleString('en-US', { timeZone: EGYPT_TIMEZONE });
  return new Date(egyptTimeStr);
}

/**
 * Check if a date is a known Egyptian holiday
 */
function isKnownHoliday(date: Date): { isHoliday: boolean; name?: string; nameAr?: string } {
  const month = date.getMonth() + 1; // 1-12
  const day = date.getDate();

  // Fixed holidays
  const holidays: Array<{ month: number; day: number; name: string; nameAr: string }> = [
    { month: 1, day: 7, name: 'Coptic Christmas', nameAr: 'عيد الميلاد المجيد' },
    { month: 1, day: 25, name: 'Police Day', nameAr: 'عيد الشرطة' },
    { month: 4, day: 25, name: 'Sinai Liberation Day', nameAr: 'عيد تحرير سيناء' },
    { month: 5, day: 1, name: 'Labor Day', nameAr: 'عيد العمال' },
    { month: 6, day: 30, name: 'June 30 Revolution', nameAr: 'ثورة 30 يونيو' },
    { month: 7, day: 23, name: 'July 23 Revolution', nameAr: 'ثورة 23 يوليو' },
    { month: 10, day: 6, name: 'Armed Forces Day', nameAr: 'عيد القوات المسلحة' },
  ];

  for (const h of holidays) {
    if (h.month === month && h.day === day) {
      return { isHoliday: true, name: h.name, nameAr: h.nameAr };
    }
  }

  return { isHoliday: false };
}

/**
 * Check if current time is within trading hours
 */
function isWithinTradingHours(date: Date): boolean {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const currentTime = hours * 60 + minutes;

  // Trading hours: 10:00 - 14:30 (10:00 AM - 2:30 PM)
  const marketOpen = 10 * 60; // 10:00 AM
  const marketClose = 14 * 60 + 30; // 2:30 PM

  return currentTime >= marketOpen && currentTime <= marketClose;
}

/**
 * Check if date is a trading day (Sunday to Thursday in Egypt)
 */
function isTradingDay(date: Date): boolean {
  const day = date.getDay();
  // 0 = Sunday, 4 = Thursday, 5 = Friday, 6 = Saturday
  // EGX trades Sunday to Thursday
  return day >= 0 && day <= 4;
}

/**
 * Get the last trading day from a given date
 */
function getLastTradingDay(fromDate: Date): Date {
  let date = new Date(fromDate);

  // Go back until we find a trading day that's not a holiday
  for (let i = 0; i < 30; i++) { // Max 30 days back
    date.setDate(date.getDate() - 1);

    if (!isTradingDay(date)) continue;
    if (isKnownHoliday(date).isHoliday) continue;

    return date;
  }

  return date;
}

/**
 * Get the next trading day from a given date
 */
function getNextTradingDay(fromDate: Date): Date {
  let date = new Date(fromDate);

  // Go forward until we find a trading day that's not a holiday
  for (let i = 0; i < 30; i++) { // Max 30 days forward
    date.setDate(date.getDate() + 1);

    if (!isTradingDay(date)) continue;
    if (isKnownHoliday(date).isHoliday) continue;

    return date;
  }

  return date;
}

/**
 * Get current market status
 */
export function getMarketStatus(): MarketStatus {
  const now = Date.now();

  // Use cached status if recent
  if (_lastMarketStatus && (now - _lastStatusCheck) < STATUS_CACHE_TTL) {
    return _lastMarketStatus;
  }

  const egyptTime = getEgyptTime();
  const dayOfWeek = egyptTime.getDay();

  // Check for weekend (Friday = 5, Saturday = 6 in Egypt)
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    const status: MarketStatus = {
      isOpen: false,
      isHoliday: true,
      reason: 'Weekend',
      reasonAr: 'عطلة نهاية الأسبوع',
      lastTradingDay: getLastTradingDay(egyptTime),
      nextTradingDay: getNextTradingDay(egyptTime),
      currentTime: egyptTime,
    };
    _lastMarketStatus = status;
    _lastStatusCheck = now;
    return status;
  }

  // Check for known holidays
  const holidayCheck = isKnownHoliday(egyptTime);
  if (holidayCheck.isHoliday) {
    const status: MarketStatus = {
      isOpen: false,
      isHoliday: true,
      reason: holidayCheck.name || 'Holiday',
      reasonAr: holidayCheck.nameAr || 'إجازة',
      lastTradingDay: getLastTradingDay(egyptTime),
      nextTradingDay: getNextTradingDay(egyptTime),
      currentTime: egyptTime,
    };
    _lastMarketStatus = status;
    _lastStatusCheck = now;
    return status;
  }

  // Check if within trading hours
  const withinHours = isWithinTradingHours(egyptTime);

  if (withinHours) {
    const status: MarketStatus = {
      isOpen: true,
      isHoliday: false,
      reason: 'Market Open',
      reasonAr: 'البورصة مفتوحة',
      lastTradingDay: egyptTime,
      nextTradingDay: getNextTradingDay(egyptTime),
      currentTime: egyptTime,
    };
    _lastMarketStatus = status;
    _lastStatusCheck = now;
    return status;
  }

  // Before or after trading hours
  const hours = egyptTime.getHours();
  const reason = hours < 10 ? 'Before Market Open' : 'After Market Close';
  const reasonAr = hours < 10 ? 'قبل فتح البورصة' : 'بعد إغلاق البورصة';

  const status: MarketStatus = {
    isOpen: false,
    isHoliday: false,
    reason,
    reasonAr,
    lastTradingDay: getLastTradingDay(egyptTime),
    nextTradingDay: hours < 10 ? egyptTime : getNextTradingDay(egyptTime),
    currentTime: egyptTime,
  };

  _lastMarketStatus = status;
  _lastStatusCheck = now;
  return status;
}

/**
 * Check if market is currently open
 */
export function isMarketOpen(): boolean {
  return getMarketStatus().isOpen;
}

/**
 * Check if today is a holiday (including weekends)
 */
export function isTodayHoliday(): boolean {
  return getMarketStatus().isHoliday;
}

/**
 * Detect if all stocks have stale prices (no updates for 1+ hour)
 * This indicates a market holiday or data issue
 */
export function detectStalePrices(
  stocks: Array<{ last_updated?: string; last_update?: string; current_price?: number }>
): { isStale: boolean; minutesSinceUpdate: number; reason: string } {
  if (!stocks || stocks.length === 0) {
    return { isStale: true, minutesSinceUpdate: 0, reason: 'No stocks data' };
  }

  const now = Date.now();
  let maxUpdateTime = 0;

  for (const stock of stocks) {
    const lastUpdate = stock.last_updated || stock.last_update;
    if (lastUpdate) {
      const updateTime = new Date(lastUpdate).getTime();
      if (updateTime > maxUpdateTime) {
        maxUpdateTime = updateTime;
      }
    }
  }

  if (maxUpdateTime === 0) {
    return { isStale: true, minutesSinceUpdate: 0, reason: 'No update timestamps found' };
  }

  const minutesSinceUpdate = Math.floor((now - maxUpdateTime) / (1000 * 60));

  // If no updates for 60+ minutes, consider prices stale
  const isStale = minutesSinceUpdate >= 60;

  return {
    isStale,
    minutesSinceUpdate,
    reason: isStale
      ? `No price updates for ${minutesSinceUpdate} minutes - likely holiday or market closed`
      : 'Prices are current',
  };
}

/**
 * Get market status summary for display
 */
export function getMarketStatusSummary(): {
  status: string;
  statusAr: string;
  color: string;
  icon: string;
} {
  const status = getMarketStatus();

  if (status.isOpen) {
    return {
      status: 'Market Open',
      statusAr: 'البورصة مفتوحة',
      color: 'emerald',
      icon: '🟢',
    };
  }

  if (status.isHoliday) {
    return {
      status: status.reason,
      statusAr: status.reasonAr,
      color: 'amber',
      icon: '🔶',
    };
  }

  return {
    status: status.reason,
    statusAr: status.reasonAr,
    color: 'gray',
    icon: '⚫',
  };
}

export default {
  getMarketStatus,
  isMarketOpen,
  isTodayHoliday,
  detectStalePrices,
  getMarketStatusSummary,
};

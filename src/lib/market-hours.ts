/**
 * Market Hours & Session Verification Utility for EGX, Saudi, US, Crypto, and Gold
 * ===============================================================================
 * Calculates market status strictly according to local timezone, official trading days,
 * and session hours.
 */

export interface MarketSessionStatus {
  isOpen: boolean;
  reason: string;
  marketNameAr: string;
  timezone: string;
  scheduleText: string;
}

/**
 * Checks if the Egyptian Exchange (EGX) is currently open for live trading.
 * - Trading Days: Sunday, Monday, Tuesday, Wednesday, Thursday
 * - Off Days (Weekend): Friday and Saturday (All day CLOSED)
 * - Trading Hours: 10:00 AM to 03:00 PM (Cairo Time / EET)
 */
export function getEGXMarketStatus(date: Date = new Date()): MarketSessionStatus {
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'Africa/Cairo',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    };
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);

    let weekdayStr = '';
    let hour = 0;
    let minute = 0;

    for (const part of parts) {
      if (part.type === 'weekday') weekdayStr = part.value; // 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
      if (part.type === 'hour') hour = parseInt(part.value, 10);
      if (part.type === 'minute') minute = parseInt(part.value, 10);
    }

    // EGX Trading Days: Sunday through Thursday.
    // Off Days: Friday ('Fri') & Saturday ('Sat')
    const isWeekend = weekdayStr === 'Fri' || weekdayStr === 'Sat';

    if (isWeekend) {
      return {
        isOpen: false,
        reason: 'عطلة نهاية الأسبوع (الجمعة والسبت)',
        marketNameAr: 'البورصة المصرية EGX',
        timezone: 'Africa/Cairo',
        scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)',
      };
    }

    // EGX Session Hours: 10:00 AM to 03:00 PM (10:00 to 15:00)
    const timeInMinutes = hour * 60 + minute;
    const sessionOpenMinutes = 10 * 60; // 10:00 AM
    const sessionCloseMinutes = 15 * 60; // 03:00 PM (15:00)

    if (timeInMinutes < sessionOpenMinutes) {
      return {
        isOpen: false,
        reason: 'قبل بداية الجلسة (افتتاح 10:00 ص)',
        marketNameAr: 'البورصة المصرية EGX',
        timezone: 'Africa/Cairo',
        scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)',
      };
    }

    if (timeInMinutes > sessionCloseMinutes) {
      return {
        isOpen: false,
        reason: 'بعد إغلاق الجلسة الرسمية (إغلاق 03:00 م)',
        marketNameAr: 'البورصة المصرية EGX',
        timezone: 'Africa/Cairo',
        scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)',
      };
    }

    return {
      isOpen: true,
      reason: 'الجلسة حية ومباشرة (10:00 ص - 3:00 م)',
      marketNameAr: 'البورصة المصرية EGX',
      timezone: 'Africa/Cairo',
      scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)',
    };
  } catch (err) {
    const day = date.getDay();
    const hour = date.getHours();
    const isWeekend = day === 5 || day === 6;
    const isOpen = !isWeekend && hour >= 10 && hour < 15;
    return {
      isOpen,
      reason: isOpen ? 'الجلسة حية ومباشرة (10:00 ص - 3:00 م)' : 'السوق مغلق',
      marketNameAr: 'البورصة المصرية EGX',
      timezone: 'Africa/Cairo',
      scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)',
    };
  }
}

/**
 * Checks market status for various asset classes.
 * - 'EGX': Egyptian Exchange (Sun-Thu 10:00-15:00)
 * - 'CRYPTO': 24/7 Always Open
 * - 'GOLD': 24/5 Mon-Fri
 */
export function getMarketStatus(market: string = 'EGX', date: Date = new Date()): MarketSessionStatus {
  const m = market.toUpperCase();
  
  if (m === 'CRYPTO') {
    return {
      isOpen: true,
      reason: 'سوق العملات الرقمية مفتوح 24/7',
      marketNameAr: 'العملات الرقمية',
      timezone: 'UTC',
      scheduleText: 'مفتوح 24 ساعة / 7 أيام',
    };
  }

  if (m === 'GOLD' || m === 'METALS') {
    const day = date.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    return {
      isOpen: !isWeekend,
      reason: isWeekend ? 'عطلة المعادن الدولية (السبت والأحد)' : 'سوق المعادن مفتوح',
      marketNameAr: 'الذهب والمعادن',
      timezone: 'UTC',
      scheduleText: '24 ساعة / 5 أيام (الاثنين - الجمعة)',
    };
  }

  // Multi-market routing (2026-09-30)
  if (m === 'TADAWUL' || m === 'KSA' || m === 'SAUDI') return getTADAWULMarketStatus(date);
  if (m === 'KSE' || m === 'KUWAIT') return getKSEMarketStatus(date);
  if (m === 'QSE' || m === 'QATAR') return getQSEMarketStatus(date);
  if (m === 'US' || m === 'NYSE' || m === 'NASDAQ' || m === 'AMERICA') return getUSMarketStatus(date);

  // Default: EGX
  return getEGXMarketStatus(date);
}

// ============================================================================
// Multi-Market Status (2026-09-30) — TADAWUL + KSE + QSE + US added
// ============================================================================

/** TADAWUL (Saudi) — Sun-Thu, 10:00-15:00 Riyadh time */
export function getTADAWULMarketStatus(date: Date = new Date()): MarketSessionStatus {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(date);
    let weekdayStr = '', hour = 0, minute = 0;
    for (const p of parts) {
      if (p.type === 'weekday') weekdayStr = p.value;
      if (p.type === 'hour') hour = parseInt(p.value);
      if (p.type === 'minute') minute = parseInt(p.value);
    }
    const isWeekend = weekdayStr === 'Fri' || weekdayStr === 'Sat';
    if (isWeekend) return { isOpen: false, reason: 'عطلة نهاية الأسبوع', marketNameAr: 'تداول السعودية', timezone: 'Asia/Riyadh', scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)' };
    const t = hour * 60 + minute;
    if (t < 600) return { isOpen: false, reason: 'قبل الجلسة (10:00 ص)', marketNameAr: 'تداول السعودية', timezone: 'Asia/Riyadh', scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)' };
    if (t > 900) return { isOpen: false, reason: 'بعد الإغلاق (3:00 م)', marketNameAr: 'تداول السعودية', timezone: 'Asia/Riyadh', scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)' };
    return { isOpen: true, reason: 'السوق مفتوح', marketNameAr: 'تداول السعودية', timezone: 'Asia/Riyadh', scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)' };
  } catch { return { isOpen: false, reason: 'تعذّر التحقق', marketNameAr: 'تداول السعودية', timezone: 'Asia/Riyadh', scheduleText: 'الأحد - الخميس (10:00 ص - 3:00 م)' }; }
}

/** KSE (Kuwait) — Sun-Thu, 06:00-09:30 Kuwait time */
export function getKSEMarketStatus(date: Date = new Date()): MarketSessionStatus {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kuwait', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(date);
    let weekdayStr = '', hour = 0, minute = 0;
    for (const p of parts) {
      if (p.type === 'weekday') weekdayStr = p.value;
      if (p.type === 'hour') hour = parseInt(p.value);
      if (p.type === 'minute') minute = parseInt(p.value);
    }
    const isWeekend = weekdayStr === 'Fri' || weekdayStr === 'Sat';
    if (isWeekend) return { isOpen: false, reason: 'عطلة نهاية الأسبوع', marketNameAr: 'بورصة الكويت', timezone: 'Asia/Kuwait', scheduleText: 'الأحد - الخميس (6:00 ص - 9:30 ص)' };
    const t = hour * 60 + minute;
    if (t < 360) return { isOpen: false, reason: 'قبل الجلسة (6:00 ص)', marketNameAr: 'بورصة الكويت', timezone: 'Asia/Kuwait', scheduleText: 'الأحد - الخميس (6:00 ص - 9:30 ص)' };
    if (t > 570) return { isOpen: false, reason: 'بعد الإغلاق (9:30 ص)', marketNameAr: 'بورصة الكويت', timezone: 'Asia/Kuwait', scheduleText: 'الأحد - الخميس (6:00 ص - 9:30 ص)' };
    return { isOpen: true, reason: 'السوق مفتوح', marketNameAr: 'بورصة الكويت', timezone: 'Asia/Kuwait', scheduleText: 'الأحد - الخميس (6:00 ص - 9:30 ص)' };
  } catch { return { isOpen: false, reason: 'تعذّر التحقق', marketNameAr: 'بورصة الكويت', timezone: 'Asia/Kuwait', scheduleText: 'الأحد - الخميس (6:00 ص - 9:30 ص)' }; }
}

/** QSE (Qatar) — Sun-Thu, 09:00-13:00 Doha time */
export function getQSEMarketStatus(date: Date = new Date()): MarketSessionStatus {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Qatar', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(date);
    let weekdayStr = '', hour = 0, minute = 0;
    for (const p of parts) {
      if (p.type === 'weekday') weekdayStr = p.value;
      if (p.type === 'hour') hour = parseInt(p.value);
      if (p.type === 'minute') minute = parseInt(p.value);
    }
    const isWeekend = weekdayStr === 'Fri' || weekdayStr === 'Sat';
    if (isWeekend) return { isOpen: false, reason: 'عطلة نهاية الأسبوع', marketNameAr: 'بورصة قطر', timezone: 'Asia/Qatar', scheduleText: 'الأحد - الخميس (9:00 ص - 1:00 م)' };
    const t = hour * 60 + minute;
    if (t < 540) return { isOpen: false, reason: 'قبل الجلسة (9:00 ص)', marketNameAr: 'بورصة قطر', timezone: 'Asia/Qatar', scheduleText: 'الأحد - الخميس (9:00 ص - 1:00 م)' };
    if (t > 780) return { isOpen: false, reason: 'بعد الإغلاق (1:00 م)', marketNameAr: 'بورصة قطر', timezone: 'Asia/Qatar', scheduleText: 'الأحد - الخميس (9:00 ص - 1:00 م)' };
    return { isOpen: true, reason: 'السوق مفتوح', marketNameAr: 'بورصة قطر', timezone: 'Asia/Qatar', scheduleText: 'الأحد - الخميس (9:00 ص - 1:00 م)' };
  } catch { return { isOpen: false, reason: 'تعذّر التحقق', marketNameAr: 'بورصة قطر', timezone: 'Asia/Qatar', scheduleText: 'الأحد - الخميس (9:00 ص - 1:00 م)' }; }
}

/** US Market (NYSE/NASDAQ) — Mon-Fri, 09:30-16:00 ET (14:30-21:00 UTC) */
export function getUSMarketStatus(date: Date = new Date()): MarketSessionStatus {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(date);
    let weekdayStr = '', hour = 0, minute = 0;
    for (const p of parts) {
      if (p.type === 'weekday') weekdayStr = p.value;
      if (p.type === 'hour') hour = parseInt(p.value);
      if (p.type === 'minute') minute = parseInt(p.value);
    }
    const isWeekend = weekdayStr === 'Sat' || weekdayStr === 'Sun';
    if (isWeekend) return { isOpen: false, reason: 'Weekend', marketNameAr: 'البورصة الأمريكية', timezone: 'America/New_York', scheduleText: 'Mon-Fri (9:30 AM - 4:00 PM ET)' };
    const t = hour * 60 + minute;
    if (t < 570) return { isOpen: false, reason: 'Before market (9:30 AM ET)', marketNameAr: 'البورصة الأمريكية', timezone: 'America/New_York', scheduleText: 'Mon-Fri (9:30 AM - 4:00 PM ET)' };
    if (t > 960) return { isOpen: false, reason: 'After close (4:00 PM ET)', marketNameAr: 'البورصة الأمريكية', timezone: 'America/New_York', scheduleText: 'Mon-Fri (9:30 AM - 4:00 PM ET)' };
    return { isOpen: true, reason: 'Market open', marketNameAr: 'البورصة الأمريكية', timezone: 'America/New_York', scheduleText: 'Mon-Fri (9:30 AM - 4:00 PM ET)' };
  } catch { return { isOpen: false, reason: 'Error', marketNameAr: 'البورصة الأمريكية', timezone: 'America/New_York', scheduleText: 'Mon-Fri (9:30 AM - 4:00 PM ET)' }; }
}

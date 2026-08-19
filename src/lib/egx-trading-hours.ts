/**
 * egx-trading-hours.ts
 * أدوات للتعامل مع أوقات تداول البورصة المصرية
 *
 * البورصة المصرية تعمل من:
 * - 9:30 صباحاً إلى 3:00 مساءً (توقيت القاهرة)
 * - من الأحد إلى الخميس
 * - مغلق: الجمعة والسبت
 */

// توقيت القاهرة (Africa/Cairo)
const CAIRO_TIMEZONE = 'Africa/Cairo';

// ساعات التداول (بالدقائق من بداية اليوم)
const TRADING_START_MINUTES = 9 * 60 + 30;  // 9:30 صباحاً = 570 دقيقة
const TRADING_END_MINUTES = 15 * 60;        // 3:00 مساءً = 900 دقيقة

// ساعات للعرض فقط
const TRADING_START_HOUR = 9;
const TRADING_START_MINUTE = 30;
const TRADING_END_HOUR = 15;
const TRADING_END_MINUTE = 0;

// أيام التداول (0 = الأحد، 1 = الإثنين، ...، 4 = الخميس)
const TRADING_DAYS = [0, 1, 2, 3, 4]; // الأحد للخميس

/**
 * الحصول على التوقيت الحالي في القاهرة
 */
export function getCairoTime(date: Date = new Date()): Date {
  const cairoTime = new Date(date.toLocaleString('en-US', { timeZone: CAIRO_TIMEZONE }));
  return cairoTime;
}

/**
 * التحقق مما إذا كانت البورصة مفتوحة الآن
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const cairoTime = getCairoTime(now);
  const dayOfWeek = cairoTime.getDay(); // 0 = الأحد
  const hour = cairoTime.getHours();
  const minute = cairoTime.getMinutes();
  const currentMinutes = hour * 60 + minute;

  // التحقق من اليوم (الأحد للخميس)
  if (!TRADING_DAYS.includes(dayOfWeek)) {
    return false;
  }

  // التحقق من الوقت (9:30 صباحاً - 3:00 مساءً)
  if (currentMinutes < TRADING_START_MINUTES || currentMinutes >= TRADING_END_MINUTES) {
    return false;
  }

  return true;
}

/**
 * الحصول على حالة السوق بالعربية
 */
export function getMarketStatusText(now: Date = new Date()): string {
  const cairoTime = getCairoTime(now);
  const dayOfWeek = cairoTime.getDay();
  const hour = cairoTime.getHours();
  const minute = cairoTime.getMinutes();
  const currentMinutes = hour * 60 + minute;
  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  if (!TRADING_DAYS.includes(dayOfWeek)) {
    return `السوق مغلق - عطلة نهاية الأسبوع (${dayNames[dayOfWeek]})`;
  }

  if (currentMinutes < TRADING_START_MINUTES) {
    return `السوق مغلق - يفتح الساعة 9:30 صباحاً`;
  }

  if (currentMinutes >= TRADING_END_MINUTES) {
    return `السوق مغلق - جلسة التداول انتهت`;
  }

  return `السوق مفتوح - جلسة التداول جارية`;
}

/**
 * الحصول على وقت الفتح التالي
 */
export function getNextMarketOpen(now: Date = new Date()): Date {
  const cairoTime = getCairoTime(now);
  const dayOfWeek = cairoTime.getDay();
  const hour = cairoTime.getHours();
  const minute = cairoTime.getMinutes();
  const currentMinutes = hour * 60 + minute;

  let daysUntilOpen = 0;
  let nextDay = dayOfWeek;

  // حساب عدد الأيام حتى يوم التداول التالي
  if (TRADING_DAYS.includes(dayOfWeek) && currentMinutes < TRADING_START_MINUTES) {
    // اليوم هو يوم تداول ولكن قبل وقت الفتح
    daysUntilOpen = 0;
  } else if (TRADING_DAYS.includes(dayOfWeek) && currentMinutes >= TRADING_END_MINUTES) {
    // اليوم هو يوم تداول ولكن بعد الإغلاق
    nextDay = (dayOfWeek + 1) % 7;
    while (!TRADING_DAYS.includes(nextDay)) {
      nextDay = (nextDay + 1) % 7;
      daysUntilOpen++;
    }
  } else {
    // اليوم ليس يوم تداول
    nextDay = (dayOfWeek + 1) % 7;
    while (!TRADING_DAYS.includes(nextDay)) {
      nextDay = (nextDay + 1) % 7;
      daysUntilOpen++;
    }
  }

  // إنشاء تاريخ وقت الفتح التالي (9:30 صباحاً)
  const nextOpen = new Date(cairoTime);
  nextOpen.setDate(nextOpen.getDate() + daysUntilOpen);
  nextOpen.setHours(9, 30, 0, 0);

  return nextOpen;
}

/**
 * التحقق مما إذا كان يجب تحديث البيانات
 * يعيد true فقط إذا كان السوق مفتوحاً
 */
export function shouldUpdateData(now: Date = new Date()): boolean {
  return isMarketOpen(now);
}

/**
 * الحصول على وقت الانتظار حتى التحديث التالي بالدقائق
 */
export function getMinutesUntilNextUpdate(now: Date = new Date()): number {
  if (isMarketOpen(now)) {
    return 5; // تحديث كل 5 دقائق أثناء التداول
  }

  const nextOpen = getNextMarketOpen(now);
  const diffMs = nextOpen.getTime() - getCairoTime(now).getTime();
  return Math.ceil(diffMs / (1000 * 60));
}

/**
 * تنسيق الوقت المتبقي بالعربية
 */
export function formatTimeUntilOpen(now: Date = new Date()): string {
  // إذا السوق مفتوح، لا نرجع وقت الانتظار
  if (isMarketOpen(now)) {
    return 'السوق مفتوح الآن';
  }

  const nextOpen = getNextMarketOpen(now);
  const cairoNow = getCairoTime(now);
  const diffMs = nextOpen.getTime() - cairoNow.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `يفتح بعد ${days} يوم`;
  }

  if (hours > 0) {
    return `يفتح بعد ${hours} ساعة و ${minutes} دقيقة`;
  }

  if (minutes > 0) {
    return `يفتح بعد ${minutes} دقيقة`;
  }

  return `يفتح قريباً`;
}

// تصدير الثوابت للاستخدام الخارجي
export const EGX_CONFIG = {
  timezone: CAIRO_TIMEZONE,
  tradingStartHour: TRADING_START_HOUR,
  tradingStartMinute: TRADING_START_MINUTE,
  tradingEndHour: TRADING_END_HOUR,
  tradingEndMinute: TRADING_END_MINUTE,
  tradingDays: TRADING_DAYS,
  tradingDaysAr: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'],
  weekendDaysAr: ['الجمعة', 'السبت'],
  tradingHoursAr: 'من 9:30 صباحاً إلى 3:00 مساءً',
};

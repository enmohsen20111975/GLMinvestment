/**
 * Premium Chart — Utilities
 * =====================================================================
 *
 * دوال مساعدة للشارت — مأخودة من archived interactive-chart/utils.ts ومُحسّنة:
 * - toTime: تحويل string/number → Time (lightweight-charts)
 * - timeToNumber: تحويل Time → unix seconds (للترتيب والمقارنة)
 * - sanitizeCandles: تنظيف الشموع (منع crashes في lightweight-charts)
 * - fmtDateLabel: تنسيق التاريخ للعرض
 * - formatLineData, formatVolumeData: تحويل البيانات للصيغة المتوقعة
 */

import type { Time } from 'lightweight-charts';
import type { ChartData, IndicatorData } from './types';
import { DARK_THEME } from './types';

/** تحويل string|number → Time قابل للاستخدام في lightweight-charts */
export function toTime(timeVal: string | number): Time {
  if (typeof timeVal === 'number') {
    return timeVal as Time;
  }
  if (!timeVal) {
    return Math.floor(Date.now() / 1000) as Time;
  }
  const s = String(timeVal).trim();
  const asNum = Number(s);
  if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s)) {
    return Math.floor(asNum) as Time;
  }
  // yyyy-mm-dd format (lightweight-charts native)
  if (s.length === 10 && s[4] === '-' && s[7] === '-') {
    return s as Time;
  }
  // DD/MM HH:MM format (intraday)
  if (s.includes('/')) {
    const parts = s.split(' ');
    const dateParts = parts[0].split('/');
    const timeParts = parts[1] ? parts[1].split(':') : ['00', '00'];
    const now = new Date();
    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const year = dateParts[2] ? parseInt(dateParts[2], 10) : now.getFullYear();
    const hours = parseInt(timeParts[0], 10) || 0;
    const mins = parseInt(timeParts[1], 10) || 0;
    const d = new Date(year, month, day, hours, mins);
    if (!isNaN(d.getTime())) {
      return Math.floor(d.getTime() / 1000) as Time;
    }
  }
  // ISO format
  const parsed = Date.parse(s.replace(' ', 'T'));
  if (!isNaN(parsed)) {
    return Math.floor(parsed / 1000) as Time;
  }
  return s as Time;
}

/** تحويل Time → unix seconds (للترتيب والمقارنة) */
export function timeToNumber(t: Time | string | number): number {
  if (typeof t === 'number') return t;
  const s = String(t);
  const p = s.split('-');
  if (p.length === 3 && p[0].length === 4) {
    const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return Math.floor(d.getTime() / 1000);
  }
  const parsed = Date.parse(s.replace(' ', 'T'));
  return isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

/**
 * Sanitize OHLCV — يمنع crashes في lightweight-charts:
 * - يرفع الشموع الفارغة (null/NaN)
 * - يرفع القيم المتطرفة (outliers)
 * - يرتّب تصاعدياً ويحذف التكرار
 */
export function sanitizeCandles(data: ChartData[]): ChartData[] {
  const cleaned: ChartData[] = [];
  for (const d of data) {
    const o = Number(d.open);
    const h = Number(d.high);
    const l = Number(d.low);
    const c = Number(d.close);
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    if (o <= 0 || c <= 0) continue;

    // Outlier suppression (e.g. 52-week low/high dumped into daily candle)
    let safeHigh = Math.max(h, o, c);
    let safeLow = Math.min(l, o, c);
    if (c > 10 && safeLow < c * 0.4) {
      safeLow = Math.min(o, c) * 0.98;
    }
    if (c > 10 && safeHigh > c * 3.0) {
      safeHigh = Math.max(o, c) * 1.05;
    }

    const tnum = timeToNumber(toTime(d.time));
    if (tnum <= 0) continue;
    cleaned.push({
      time: d.time,
      open: Math.round(o * 1000) / 1000,
      high: Math.round(safeHigh * 1000) / 1000,
      low: Math.round(safeLow * 1000) / 1000,
      close: Math.round(c * 1000) / 1000,
      volume: Number(d.volume) || 0,
    });
  }
  cleaned.sort((a, b) => timeToNumber(toTime(a.time)) - timeToNumber(toTime(b.time)));
  // Dedupe by time (keep last occurrence's values)
  const out: ChartData[] = [];
  let lastKey = 0;
  for (const d of cleaned) {
    const key = timeToNumber(toTime(d.time));
    if (out.length > 0 && key === lastKey) {
      out[out.length - 1] = d;
    } else {
      out.push(d);
      lastKey = key;
    }
  }
  return out;
}

/** تنسيق التاريخ للعرض: DD/MM HH:MM */
export function fmtDateLabel(timeVal: string | number): string {
  let date: Date;
  if (typeof timeVal === 'number') {
    date = new Date(timeVal * 1000);
  } else {
    const d = new Date(timeVal);
    date = isNaN(d.getTime()) ? new Date(Number(timeVal) * 1000) : d;
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hour}:${minute}`;
}

/** تنسيق رقم بسعر (مع منع NaN) */
export function formatPrice(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  return value.toFixed(decimals);
}

/** تحويل IndicatorData[] إلى صيغة lightweight-charts */
export function formatLineData(data: IndicatorData[]) {
  return data
    .filter((d) => d.value !== null && d.value !== undefined && !isNaN(d.value))
    .map((d) => ({
      time: toTime(d.time),
      value: d.value,
    }));
}

/** تحويل الشموع إلى بيانات حجم بألوان صعود/هبوط */
export function formatVolumeData(data: ChartData[]) {
  return data.map((d) => ({
    time: toTime(d.time),
    value: d.volume,
    color: d.close >= d.open ? DARK_THEME.upColor + '40' : DARK_THEME.downColor + '40',
  }));
}

/** تنسيق الحجم: 1.2M, 350K, إلخ */
export function formatVolume(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}

/** نسبة مئوية مع علامة + أو - */
export function formatPct(value: number, decimals = 2): string {
  if (!isFinite(value)) return '—';
  return (value >= 0 ? '+' : '') + value.toFixed(decimals) + '%';
}

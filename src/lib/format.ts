/**
 * format.ts — دوال التنسيق الموحدة لكل المشروع.
 *
 * Rule 28 (NO-DUPLICATION): كان فيه 20+ نسخة من formatPrice/formatNumber/formatPercent
 * في مكونات مختلفة. دلوقتي اتوحدوا هنا.
 *
 * الاستخدام:
 *   import { formatPrice, formatNumber, formatPercent, formatDate } from '@/lib/format';
 */

/**
 * تنسيق السعر حسب السوق.
 * - EGX: جنيه مصري (ج.م)
 * - CRYPTO: دولار ($)
 * - TADAWUL: ريال (ر.س)
 * - KSE: دينار كويتي (د.ك)
 * - QSE: ريال قطري (ر.ق)
 */
export function formatPrice(
  n: number | null | undefined,
  market: 'EGX' | 'CRYPTO' | 'TADAWUL' | 'KSE' | 'QSE' = 'EGX'
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';

  const currencyMap: Record<string, string> = {
    EGX: 'ج.م',
    CRYPTO: '$',
    TADAWUL: 'ر.س',
    KSE: 'د.ك',
    QSE: 'ر.ق',
  };

  const prefix = market === 'CRYPTO' ? '$' : '';
  const suffix = market !== 'CRYPTO' ? ' ' + currencyMap[market] : '';

  if (market === 'CRYPTO') {
    if (n >= 1000) return prefix + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1) return prefix + n.toFixed(2);
    if (n >= 0.01) return prefix + n.toFixed(4);
    return prefix + n.toFixed(6);
  }

  return prefix + n.toFixed(2) + suffix;
}

/**
 * تنسيق الأرقام الكبيرة (K/M/B/T).
 */
export function formatNumber(
  n: number | null | undefined,
  digits: number = 2
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(digits) + 'T';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(digits) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(digits) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(digits) + 'K';
  return n.toFixed(digits);
}

/**
 * تنسيق النسبة المئوية مع علامة +/-
 */
export function formatPercent(
  n: number | null | undefined,
  digits: number = 2
): { text: string; positive: boolean } {
  if (n === null || n === undefined || Number.isNaN(n))
    return { text: '—', positive: false };
  return {
    text: (n >= 0 ? '+' : '') + n.toFixed(digits) + '%',
    positive: n >= 0,
  };
}

/**
 * تنسيق حجم التداول
 */
export function formatVolume(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(0);
}

/**
 * تنسيق التاريخ (YYYY-MM-DD → DD/MM/YYYY)
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch { // silent fallback (safe-by-design)
    return '—';
  }
}

/**
 * تنسيق التاريخ والوقت
 */
export function formatDateTime(date: string | null | undefined): string {
  if (!date) return '—';
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch { // silent fallback (safe-by-design)
    return '—';
  }
}

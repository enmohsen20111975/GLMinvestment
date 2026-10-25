/**
 * stocks-view/helpers.ts
 * ============================================================================
 * F-Phase3-Split-StocksView: utility functions used by StocksView sub-components.
 *
 * قبل كده: كل الـ helpers كانوا inline في StocksView.tsx.
 * دلوقتي: مستوردين من هنا → single source of truth.
 *
 * NOTE على السلوك: كل الـ functions هنا بـ تحافظ على الـ exact behaviour
 * اللي كان في الـ original file (حتى لو فيه quirks مثل trailing spaces في
 * `SECTOR_COLOR_MAP` — Phase 2 migration هـ ينظّفهم).
 * ============================================================================
 */

// ─── Sector color map (local copy — see lib/sector-constants.ts for the
// canonical migrated version; this preserves the exact original classes
// including trailing spaces, so behaviour is byte-identical to pre-refactor).
export const SECTOR_COLOR_MAP: Record<string, string> = {
  'Financials': 'bg-profit/10 text-profit border border-profit/20 ',
  'القطاع المالي': 'bg-profit/10 text-profit border border-profit/20 ',
  'Basic Materials': 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
  'الأساسية': 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
  'Real Estate': 'bg-primary text-primary/30 ',
  'العقارات': 'bg-primary text-primary/30 ',
  'Consumer Goods': 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  'الاستهلاكية': 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  'Industrials': 'bg-whale text-whale/30 ',
  'الصناعات التحويلية': 'bg-whale text-whale/30 ',
  'Food & Beverage': 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
  'الأغذية والمشروبات': 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
  'Technology': 'bg-whale/10 text-whale dark:bg-whale/10 dark:text-whale',
  'التكنولوجيا': 'bg-whale/10 text-whale dark:bg-whale/10 dark:text-whale',
  'Consumer Services': 'bg-loss/10 text-loss border border-loss/20 ',
  'الخدمات الاستهلاكية': 'bg-loss/10 text-loss border border-loss/20 ',
  'Healthcare': 'bg-loss/10 text-loss border border-loss/20 ',
  'الرعاية الصحية': 'bg-loss/10 text-loss border border-loss/20 ',
  'Energy': 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
  'الطاقة': 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
  'Telecommunications': 'bg-whale text-whale/30 ',
  'الاتصالات': 'bg-whale text-whale/30 ',
};

export const SECTOR_FALLBACK_COLOR = 'bg-muted text-muted-foreground dark:text-muted-foreground';

/**
 * Extract the clean EGX ticker symbol from a TradingView-merged string.
 * TradingView's scraper concatenates the ticker + company name + trailing "D",
 * e.g. "LUTSLotus For Agricultural...D" → "LUTS", "CPMECatalyst...D" → "CPME".
 *
 * The greedy /^[A-Z]{2,6}/ match grabs "LUTSL" because "Lotus" starts with a
 * capital L. We detect this CamelCase word boundary: if the character right
 * AFTER the matched run is a lowercase letter, the last matched capital is
 * actually the start of the company name → drop it. Repeat until stable.
 */
export function formatCleanTicker(rawTicker: string): string {
  if (!rawTicker) return '';
  if (rawTicker.length > 6) {
    const match = rawTicker.match(/^[A-Z]{2,6}/);
    if (match) {
      let clean = match[0];
      // Trim trailing capital that begins a CamelCase word (e.g. "LUTS" + "Lotus")
      while (clean.length > 2 && clean.length < rawTicker.length) {
        const nextChar = rawTicker[clean.length];
        if (nextChar && nextChar === nextChar.toLowerCase() && nextChar !== nextChar.toUpperCase()) {
          // next char is lowercase → last char of `clean` starts a word → drop it
          clean = clean.slice(0, -1);
        } else {
          break;
        }
      }
      return clean;
    }
  }
  return rawTicker;
}

export function parseVolStr(vol: unknown): number {
  if (vol == null) return 0;
  if (typeof vol === 'number') return Number.isFinite(vol) ? vol : 0;
  const s = String(vol).trim().replace(/\u202f/g, '').replace(/\s/g, '').toUpperCase();
  if (!s) return 0;
  const mult: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  const last = s[s.length - 1];
  if (mult[last]) {
    const num = parseFloat(s.slice(0, -1));
    return Number.isFinite(num) ? num * mult[last] : 0;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function formatVolume(vol: unknown): string {
  const v = parseVolStr(vol);
  if (v <= 0) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toString();
}

export function formatTurnover(val: number | undefined | null): string {
  if (!val) return '—';
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M ج.م';
  if (val >= 1_000) return (val / 1_000).toFixed(0) + 'K ج.م';
  return (val ?? 0).toFixed(0) + ' ج.م';
}

export function formatPercent(val: number | null | undefined, decimals = 2): string {
  if (val == null || !Number.isFinite(val)) return '—';
  return `${val >= 0 ? '+' : ''}${val.toFixed(decimals)}%`;
}

export function getSectorColor(sector: string | undefined | null): string {
  if (!sector) return SECTOR_FALLBACK_COLOR;
  // Exact match first
  if (SECTOR_COLOR_MAP[sector]) return SECTOR_COLOR_MAP[sector];
  // Substring match (Arabic sectors often have suffixes like "القطاع المالي - بنوك")
  for (const key of Object.keys(SECTOR_COLOR_MAP)) {
    if (sector.includes(key) || key.includes(sector)) return SECTOR_COLOR_MAP[key];
  }
  return SECTOR_FALLBACK_COLOR;
}

export function formatMarketCap(cap: number): string {
  if (cap >= 1_000_000_000) return (cap / 1_000_000_000).toFixed(1) + 'B';
  if (cap >= 1_000_000) return (cap / 1_000_000).toFixed(1) + 'M';
  return cap.toLocaleString();
}

// src/modules/screener/components/screener-advanced/helpers.ts
// F-Phase3-Split-Screener — كل الدوال المساعدة والثوابت المستخدمة في
// StockScreenerAdvanced و sub-components. ما فيش JSX هنا عشان الملف يفضل .ts
// (Rule 67: separation of concerns — logic ≠ presentation).

import {
  type ScreenerStock,
  type TopPerformersResponse,
} from '@/hooks/useScreenerData';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';
import type { TFunc } from './types';

// ─── State Colors (mirrors vps-service/utils/stock_state.py STATE_COLORS) ────

export const STATE_BADGE_COLORS: Record<string, string> = {
  CORRECTION_END: 'bg-profit/10 text-profit border border-profit/20 border-profit ',
  BALANCED_MOMENTUM: 'bg-profit/10 text-profit border border-profit/20 border-success dark:border-success',
  NEAR_BREAKOUT: 'bg-whale/10 text-whale dark:bg-whale/10 border-whale/20 dark:border-whale/30',
  AT_PEAK: 'bg-loss/10 text-loss border border-loss/20 border-loss ',
  NEAR_PEAK: 'bg-warning/10 text-warning dark:text-warning border border-warning/20 border-orange-200 dark:border-orange-800',
  NEUTRAL: 'bg-muted text-muted-foreground /60 border-border ',
  CORRECTION: 'bg-warning/10 text-warning dark:text-warning border border-warning/20 border-orange-200 dark:border-orange-800',
  DECLINING: 'bg-loss/10 text-loss border border-loss/20 border-loss ',
  INSUFFICIENT_DATA: 'bg-muted text-muted-foreground/60 dark:text-muted-foreground border-border',
};

export function getStateLabels(t: TFunc): Record<string, string> {
  return {
    CORRECTION_END: t('screener.advanced.stateNames.recovery'),
    BALANCED_MOMENTUM: t('screener.advanced.stateNames.balancedMomentum'),
    NEAR_BREAKOUT: t('screener.advanced.stateNames.nearBreak'),
    AT_PEAK: t('screener.advanced.stateNames.atPeak'),
    NEAR_PEAK: t('screener.advanced.stateNames.nearPeak'),
    NEUTRAL: t('screener.advanced.stateNames.neutral'),
    CORRECTION: t('screener.advanced.stateNames.inCorrection'),
    DECLINING: t('screener.advanced.stateNames.stillFalling'),
    INSUFFICIENT_DATA: t('screener.advanced.stateNames.insufficientData'),
  };
}

export function getStateExplanations(t: TFunc): Record<string, string> {
  return {
    CORRECTION_END: t('screener.advanced.stateDescriptions.recovery'),
    BALANCED_MOMENTUM: t('screener.advanced.stateDescriptions.balancedMomentum'),
    NEAR_BREAKOUT: t('screener.advanced.stateDescriptions.nearBreak'),
    AT_PEAK: t('screener.advanced.stateDescriptions.atPeak'),
    NEAR_PEAK: t('screener.advanced.stateDescriptions.nearPeak'),
    NEUTRAL: t('screener.advanced.stateDescriptions.neutral'),
    CORRECTION: t('screener.advanced.stateDescriptions.inCorrection'),
    DECLINING: t('screener.advanced.stateDescriptions.stillFalling'),
    INSUFFICIENT_DATA: t('screener.advanced.stateDescriptions.insufficientData'),
  };
}

export const STATE_ORDER: Record<string, number> = {
  CORRECTION_END: 1,
  BALANCED_MOMENTUM: 2,
  NEAR_BREAKOUT: 3,
  NEUTRAL: 4,
  NEAR_PEAK: 5,
  AT_PEAK: 6,
  CORRECTION: 7,
  DECLINING: 8,
  INSUFFICIENT_DATA: 9,
};

// ─── Format helpers ─────────────────────────────────────────────────────────

export function formatNumber(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || isNaN(n as number)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

export function formatEGP(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return (v ?? 0).toFixed(0);
}

export function getChangeColor(change: number): string {
  if (change > 0) return 'text-profit ';
  if (change < 0) return 'text-loss ';
  return 'text-muted-foreground';
}

// ─── Export text generators ────────────────────────────────────────────────────

export function generateScreenerText(
  stocks: ScreenerStock[],
  market: string,
  sector: string,
  t: TFunc,
): string {
  if (!stocks.length) return '';
  const marketName = market === 'EGX' ? t('screener.advanced.filters.egx') : t('screener.advanced.filters.allMarkets');
  const sectorSuffix = sector !== 'ALL' ? ` / ${sector}` : '';
  const header = t('screener.advanced.shareText.screenerHeader', { market: marketName }) + sectorSuffix;
  const lines: string[] = [header, t('screener.advanced.shareText.resultCount', { count: stocks.length }), ''];
  stocks.forEach((s) => {
    const pct = s.change_percent > 0 ? '+' : '';
    lines.push(
      `• ${s.ticker} — ${s.name_ar || s.name}`,
      t('screener.advanced.shareText.stockLine', { price: formatNumber(s.current_price), sign: pct, changePercent: formatNumber(s.change_percent) }),
      t('screener.advanced.shareText.stockLineLiquidity', { volume: formatVolume(s.volume), liquidity: formatEGP(s.turnover_egp) }),
      ` 📈 P/E: ${formatNumber(s.pe_ratio, 1)} | 🏦 ROE: ${s.roe !== null ? formatNumber(s.roe, 1) : '—'}% | 📍 RSI: ${formatNumber(s.rsi, 0)}`,
      t('screener.advanced.shareText.stockLineExtra', { state: s.stock_state_ar || s.stock_state, momentum: s.momentum_score }),
    );
  });
  lines.push('', t('screener.advanced.shareText.disclaimer'), OFFICIAL_LINKS_BLOCK);
  return lines.join('\n');
}

export function generateTopPerformersText(data: TopPerformersResponse, t: TFunc): string {
  const results = data.results || [];
  if (!results.length) return '';
  const periodLabel = getPeriods(t).find((p) => p.value === data.period)?.label || data.period;
  const directionLabel = data.direction === 'gainers' ? t('screener.advanced.performers.directions.gainers') : data.direction === 'losers' ? t('screener.advanced.performers.directions.losers') : t('screener.advanced.performers.directions.all');
  const lines: string[] = [
    t('screener.advanced.shareText.performersHeader'),
    t('screener.advanced.shareText.performersPeriod', { period: periodLabel, direction: directionLabel, count: results.length }),
    t('screener.advanced.shareText.performersDateRange', { startDate: data.start_date, endDate: data.end_date }),
    '',
  ];
  results.forEach((s) => {
    const pct = s.change_pct >= 0 ? '+' : '';
    lines.push(
      `• ${s.ticker} — ${s.name_ar || s.name}${s.sector ? ` (${s.sector})` : ''}`,
      t('screener.advanced.shareText.performersStockLine', { startPrice: formatNumber(s.start_price), endPrice: formatNumber(s.end_price), sign: pct, changePct: s.change_pct }),
      t('screener.advanced.shareText.performersStockPeriod', { days: s.period_days }),
    );
  });
  lines.push('', t('screener.advanced.shareText.disclaimer'), OFFICIAL_LINKS_BLOCK);
  return lines.join('\n');
}

// ─── Filter explanations (short Arabic text under each filter) ────────────────

export function getFilterHelp(t: TFunc): Record<string, string> {
  return {
    market: t('screener.advanced.filterHelp.market'),
    sector: t('screener.advanced.filterHelp.sector'),
    price: t('screener.advanced.filterHelp.price'),
    volume: t('screener.advanced.filterHelp.volume'),
    turnover: t('screener.advanced.filterHelp.turnover'),
    trend: t('screener.advanced.filterHelp.trend'),
    above_ma: t('screener.advanced.filterHelp.aboveMa'),
    rsi: t('screener.advanced.filterHelp.rsi'),
    volume_surge: t('screener.advanced.filterHelp.volume_surge'),
    near_52w_high: t('screener.advanced.filterHelp.near_52w_high'),
    near_52w_low: t('screener.advanced.filterHelp.near_52w_low'),
    pe: t('screener.advanced.filterHelp.pe'),
    roe: t('screener.advanced.filterHelp.roe'),
    dividend_yield: t('screener.advanced.filterHelp.dividend_yield'),
    market_cap: t('screener.advanced.filterHelp.market_cap'),
    stock_state: t('screener.advanced.filterHelp.stock_state'),
  };
}

// ─── Period options (Tab 2 — Top Performers) ────────────────────────────────

export function getPeriods(t: TFunc) {
  return [
    { value: '1d', label: t('screener.advanced.periods.yesterday') },
    { value: '7d', label: t('screener.advanced.periods.week') },
    { value: '15d', label: t('screener.advanced.periods.fifteenDays') },
    { value: '1m', label: t('screener.advanced.periods.month') },
    { value: '3m', label: t('screener.advanced.periods.threeMonths') },
    { value: '6m', label: t('screener.advanced.periods.sixMonths') },
    { value: 'YTD', label: t('screener.advanced.periods.ytd') },
    { value: '1y', label: t('screener.advanced.periods.year') },
  ];
}

export function getDirections(t: TFunc) {
  return [
    { value: 'both', label: t('screener.advanced.performers.both') },
    { value: 'gainers', label: t('screener.advanced.performers.gainers') },
    { value: 'losers', label: t('screener.advanced.performers.losers') },
  ];
}

// ─── (UNIFIED-TABLE-UPGRADE) Computed-value helpers ──────────────────────
// تُستخدم بواسطة كل من render و sortValue عشان يبقوا متطابقين دائماً.
// كل القيم null/0 → -1 (sorts to bottom). Rule 27: لا fabrication.

export function computeScreenerEntry(s: ScreenerStock): number {
  if (s.current_price && s.current_price > 0) return s.current_price;
  return -1;
}

export function computeScreenerStop(s: ScreenerStock): number {
  if (s.support && s.support > 0) return s.support;  // real support, no multiplier
  return -1;  // ISSUE-3 FIX: no fabrication
}

export function computeScreenerTarget(s: ScreenerStock): number {
  if (s.resistance && s.resistance > 0) return s.resistance;  // real resistance
  return -1;  // ISSUE-3 FIX: no fabrication
}

export function computeScreenerRR(s: ScreenerStock): number {
  const entry = computeScreenerEntry(s);
  const stop = computeScreenerStop(s);
  const target = computeScreenerTarget(s);
  if (entry > 0 && stop > 0 && target > 0 && entry > stop && target > entry) {
    return (target - entry) / (entry - stop);
  }
  return -1;
}

export function computeOpportunityQuality(s: ScreenerStock): number {
  let quality = s.momentum_score || 0;
  if (s.volume_surge) quality += 20;
  if (s.above_ma_50) quality += 15;
  if (s.rsi !== null && s.rsi > 0 && s.rsi >= 30 && s.rsi <= 50) quality += 15;
  if (s.maker_activity === 'عالي' || s.maker_activity === 'مرتفع' || s.maker_activity === 'high') quality += 10;
  if (s.accumulation && (s.accumulation.includes('قوي') || s.accumulation.includes('تجميع'))) quality += 10;
  return quality;
}

/** stop_distance = (current_price - stop) / current_price * 100 */
export function computeStopDistancePct(s: ScreenerStock): number {
  if (!s.current_price || s.current_price <= 0) return -1;
  const stop = computeScreenerStop(s);
  if (stop <= 0) return -1;
  return ((s.current_price - stop) / s.current_price) * 100;
}

/** يتحقق لو السهم عليه نشاط ميكر "عالي" */
export function isHighMakerActivity(s: ScreenerStock): boolean {
  const a = s.maker_activity;
  if (!a) return false;
  return a === 'عالي' || a === 'مرتفع' || a.toLowerCase() === 'high';
}

// ─── Preset color map (used by AdvancedFiltersTab) ───────────────────────────

export const PRESET_COLOR_MAP: Record<string, string> = {
  emerald: 'border-profit/20 bg-profit/10 text-profit hover:bg-profit/20 ',
  teal: 'border-whale/20 bg-whale/10 text-whale hover:bg-whale/20 ',
  amber: 'border-warning/20 bg-warning/10 text-warning hover:bg-warning/20 ',
  orange: 'border-orange-500/40 bg-warning/10 text-warning hover:bg-warning/20 ',
  red: 'border-loss/20 bg-loss/10 text-loss hover:bg-loss/20 ',
  gray: 'border-border/40 bg-muted/10 text-muted-foreground hover:bg-muted/20 ',
  purple: 'border-purple-500/40 bg-primary/10 text-primary hover:bg-primary/20 ',
  rose: 'border-loss/20 bg-loss/10 text-loss hover:bg-loss/20 ',
  green: 'border-success/20 bg-success/10 text-success hover:bg-success/20 ',
  yellow: 'border-yellow-500/40 bg-warning/10 text-warning hover:bg-warning/20 ',
  gold: 'border-yellow-600/40 bg-warning/10 text-warning hover:bg-warning/20 ',
  cyan: 'border-whale/20/40 bg-whale/10 text-whale hover:bg-whale/20',
  violet: 'border-violet-500/40 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 dark:text-violet-300',
  slate: 'border-slate-500/40 bg-slate-500/10 text-muted-foreground hover:bg-slate-500/20 dark:text-muted-foreground',
};

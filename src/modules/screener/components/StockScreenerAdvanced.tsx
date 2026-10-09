'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LegalDisclaimerFooter } from '@/components/legal/DisclaimerBanner';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Download,
  Filter,
  Zap,
  Search,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  AlertTriangle,
  Trophy,
  BarChart3,
  Gauge,
  Flame,
  Snowflake,
  PiggyBank,
  Target,
  Shield,
  Crown,
  Facebook,
  Copy,
  Check,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { getTrialStatus } from '@/lib/subscription-gate';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
// Task 37: «الجدول المتقدّم» (Advanced Table) — owner reverted to UnifiedTable.
// Rule 67 root cause: AG Grid (Community v36) had 3 critical problems on the
// owner's VPS: (1) npm install fails with EHOSTUNREACH → build crashes;
// (2) `ag-theme-quartz` uses its OWN color palette, ignores the app's HSL
// variables — theme mismatch even after CSS var mapping (commit 9ac8817);
// (3) Range selection + clipboard + XLSX export are Enterprise-only — the
// community "Excel export" was CSV-only.
// Owner directive (EXACT QUOTE): «الجدول الجديد الى انت عملتة دة بجد مش أحسن
// حاجة خالص هو مكتبة جاهزة بس زبالة بصراحة ممكن انت تستعمل الجدول الموحد
// بس هنا هاتعمل فية نفس التحكم الى فى المكتبة ويكون بتعنا احنا ونسمى
// المكون دة الجدول المتقدم»
// Translation: AG Grid is garbage — use UnifiedTable instead, add the same
// controls, call it "الجدول المتقدم" (Advanced Table). Done.
// UnifiedTable now has: column resize by drag + inline edit + copy/paste to
// Excel + multi-sort + AutoFilter + column pinning + drag-drop reorder +
// calculated columns + saved presets + CSV export + conditional formatting.
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
// StockPublisher اتشال من عمود الـ ticker (Owner directive: "أسلوب إن انت
// حاط زرار للنشر جنب كل سهم ده وحش جدا"). الجدول دلوقتي نضيف زي الـ radar table.
import { useTranslation } from '@/lib/i18n-context';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScreenerStock {
  ticker: string;
  name: string;
  name_ar: string;
  market: string;
  sector: string;
  industry: string;
  current_price: number;
  change_percent: number;
  volume: number;
  market_cap: number;
  pe_ratio: number | null;
  pb_ratio: number | null;
  eps: number | null;
  roe: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  dividend_yield: number | null;
  profit_margin: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi: number | null;
  trend: string | null;
  signal: number | null;
  beta: number | null;
  high_52w: number | null;
  low_52w: number | null;
  avg_volume: number;
  turnover_egp: number;
  value_traded: number;
  is_egx30: boolean;
  is_egx70: boolean;
  is_egx100: boolean;
  free_float_percentage: number | null;
  dps_ttm: number | null;
  book_value_per_share: number | null;
  support: number | null;
  resistance: number | null;
  volume_surge: boolean;
  above_ma_50: boolean;
  above_ma_200: boolean;
  distance_from_52w_high: number | null;
  distance_from_52w_low: number | null;
  stock_state: string;
  stock_state_ar: string;
  stock_state_reason: string;
  momentum_score: number;
  // ── Liquidity radar fields (linked from /api/maker-radar) ──
  maker_activity?: string | null;
  buy_pct?: number | null;
  net_flow_egp?: number | null;
  accumulation?: string | null;
  life_cycle?: string | null;
  expected?: string | null;
  path?: string | null;
  position_size?: number | null;
  volume_ratio_10d_vs_20d?: number | null;
}

interface ScreenerResponse {
  success: boolean;
  stocks: ScreenerStock[];
  total: number;
  sectors: string[];
  summary?: {
    total: number;
    advancers: number;
    decliners: number;
    unchanged: number;
    avg_change: number;
    total_turnover: number;
    volume_surge_count: number;
  };
  filters?: Record<string, unknown>;
  error?: string;
}

// ─── Top Performers types ────────────────────────────────────────────────────

interface TopPerformerStock {
  ticker: string;
  name: string;
  name_ar: string | null;
  sector: string | null;
  market: string;
  start_price: number;
  end_price: number;
  change_pct: number;
  period_days: number;
  start_date: string;
  end_date: string;
  start_volume: number;
  end_volume: number;
}

interface TopPerformersResponse {
  success: boolean;
  period: string;
  direction: string;
  market: string;
  start_date: string;
  end_date: string;
  results: TopPerformerStock[];
  summary: {
    total_stocks: number;
    gainers: number;
    losers: number;
    avg_change: number;
    best_performer: TopPerformerStock | null;
    worst_performer: TopPerformerStock | null;
  };
  error?: string;
  hint?: string;
}

// ─── State Colors (mirrors vps-service/utils/stock_state.py STATE_COLORS) ────

const STATE_BADGE_COLORS: Record<string, string> = {
  CORRECTION_END: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  BALANCED_MOMENTUM: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800',
  NEAR_BREAKOUT: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800',
  AT_PEAK: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800',
  NEAR_PEAK: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-200 dark:border-orange-800',
  NEUTRAL: 'bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300 border-gray-200 dark:border-gray-700',
  CORRECTION: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-200 dark:border-orange-800',
  DECLINING: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400 border-slate-200 dark:border-slate-700',
};

function getStateLabels(t: (k: string, p?: any) => string): Record<string, string> {
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

function getStateExplanations(t: (k: string, p?: any) => string): Record<string, string> {
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

const STATE_ORDER: Record<string, number> = {
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

function StateBadge({ state, reason }: { state: string; reason?: string }) {
  const t = useTranslation();
  const colorClass = STATE_BADGE_COLORS[state] || STATE_BADGE_COLORS.NEUTRAL;
  const label = getStateLabels(t)[state] || state;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border cursor-help', colorClass)}>
            {label}
          </span>
        </TooltipTrigger>
        {reason && (
          <TooltipContent side="top" className="max-w-[280px] text-right">
            {reason}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── UNIFIED-MARKET-UX (Task 3): Collapsible Section ───────────────────────
// كل فلتر/section في #stock-filters لازم يكون قابل للطي والفرد.
// CollapsibleSection بيلفّ Card في Collapsible شادوكل radix،
// default-open=true عشان كل الـ sections مفتوحة افتراضياً (زي ما العميل طلب).
// الـ trigger هو الـ CardHeader كله (عنوان + أيقونة chevron بتلف).
interface CollapsibleSectionProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  children,
  className,
  contentClassName,
}: CollapsibleSectionProps) {
  const t = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={className}>
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-between w-full text-right cursor-pointer hover:opacity-80 transition-opacity"
              aria-expanded={open}
            >
              <CardTitle className="text-base flex items-center gap-2 flex-1">
                {icon}
                {title}
              </CardTitle>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {open ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('screener.advanced.collapsible.collapse')}</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('screener.advanced.collapsible.expand')}</span>
                  </>
                )}
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className={cn('space-y-3', contentClassName)}>
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ─── Format helpers ─────────────────────────────────────────────────────────

function formatNumber(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || isNaN(n as number)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function formatEGP(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return (v ?? 0).toFixed(0);
}

function getChangeColor(change: number): string {
  if (change > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (change < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

// ─── Export text generators ────────────────────────────────────────────────────

function generateScreenerText(
  stocks: ScreenerStock[],
  market: string,
  sector: string,
  t: (k: string, p?: any) => string,
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
      `  📈 P/E: ${formatNumber(s.pe_ratio, 1)} | 🏦 ROE: ${s.roe !== null ? formatNumber(s.roe, 1) : '—'}% | 📍 RSI: ${formatNumber(s.rsi, 0)}`,
      t('screener.advanced.shareText.stockLineExtra', { state: s.stock_state_ar || s.stock_state, momentum: s.momentum_score }),
    );
  });
  lines.push('', t('screener.advanced.shareText.disclaimer'), OFFICIAL_LINKS_BLOCK);
  return lines.join('\n');
}

function generateTopPerformersText(data: TopPerformersResponse, t: (k: string, p?: any) => string): string {
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

// ─── Sort field types ────────────────────────────────────────────────────────

type SortField =
  | 'ticker' | 'current_price' | 'change_percent' | 'volume'
  | 'turnover_egp' | 'pe_ratio' | 'roe' | 'rsi' | 'stock_state'
  | 'momentum_score' | 'above_ma_50' | 'distance_from_52w_high';

type SortDir = 'asc' | 'desc';

// ─── Filter explanations (short Arabic text under each filter) ────────────────

function getFilterHelp(t: (k: string, p?: any) => string): Record<string, string> {
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

function getPeriods(t: (k: string, p?: any) => string) {
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

function getDirections(t: (k: string, p?: any) => string) {
  return [
    { value: 'both', label: t('screener.advanced.performers.both') },
    { value: 'gainers', label: t('screener.advanced.performers.gainers') },
    { value: 'losers', label: t('screener.advanced.performers.losers') },
  ];
}

// ─── (UNIFIED-TABLE-UPGRADE) Computed-value helpers ──────────────────────
// تُستخدم بواسطة كل من render و sortValue عشان يبقوا متطابقين دائماً.
// كل القيم null/0 → -1 (sorts to bottom). Rule 27: لا fabrication.
function computeScreenerEntry(s: ScreenerStock): number {
  if (s.support && s.support > 0) return s.support * 1.02;
  return s.current_price > 0 ? s.current_price : -1;
}
function computeScreenerStop(s: ScreenerStock): number {
  if (s.support && s.support > 0) return s.support * 0.97;
  return s.current_price > 0 ? s.current_price * 0.95 : -1;
}
function computeScreenerTarget(s: ScreenerStock): number {
  if (s.resistance && s.resistance > 0) return s.resistance;
  return s.current_price > 0 ? s.current_price * 1.10 : -1;
}
function computeScreenerRR(s: ScreenerStock): number {
  const entry = computeScreenerEntry(s);
  const stop = computeScreenerStop(s);
  const target = computeScreenerTarget(s);
  if (entry > 0 && stop > 0 && target > 0 && entry > stop && target > entry) {
    return (target - entry) / (entry - stop);
  }
  return -1;
}
function computeOpportunityQuality(s: ScreenerStock): number {
  let quality = s.momentum_score || 0;
  if (s.volume_surge) quality += 20;
  if (s.above_ma_50) quality += 15;
  if (s.rsi !== null && s.rsi > 0 && s.rsi >= 30 && s.rsi <= 50) quality += 15;
  if (s.maker_activity === 'عالي' || s.maker_activity === 'مرتفع' || s.maker_activity === 'high') quality += 10;
  if (s.accumulation && (s.accumulation.includes('قوي') || s.accumulation.includes('تجميع'))) quality += 10;
  return quality;
}
/** stop_distance = (current_price - stop) / current_price * 100 */
function computeStopDistancePct(s: ScreenerStock): number {
  if (!s.current_price || s.current_price <= 0) return -1;
  const stop = computeScreenerStop(s);
  if (stop <= 0) return -1;
  return ((s.current_price - stop) / s.current_price) * 100;
}
/** يتحقق لو السهم عليه نشاط ميكر "عالي" */
function isHighMakerActivity(s: ScreenerStock): boolean {
  const a = s.maker_activity;
  if (!a) return false;
  return a === 'عالي' || a === 'مرتفع' || a.toLowerCase() === 'high';
}

// ─── (UNIFIED-TABLE-UPGRADE) One-Click Trader Presets types ─────────────
interface ExtraClientFilter {
  label: string;
  test: (s: ScreenerStock) => boolean;
}

// ─── Main component ──────────────────────────────────────────────────────────

interface StockScreenerAdvancedProps {
  initialTab?: 'advanced' | 'top-performers';
  initialMarket?: string;
}

export function StockScreenerAdvanced({ initialTab = 'advanced', initialMarket }: StockScreenerAdvancedProps) {
  const t = useTranslation();
  const [tab, setTab] = useState<'advanced' | 'top-performers'>(initialTab);

  // Read ?tab= query param on mount (for redirects from #top-performers).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t === 'top-performers') setTab('top-performers');
    else if (t === 'advanced') setTab('advanced');
  }, []);

  return (
    <div className="space-y-4 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-600" />
            {t('screener.advanced.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('screener.advanced.subtitle')}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'advanced' | 'top-performers')} className="w-full">
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="advanced" className="gap-1.5">
            <Filter className="w-3.5 h-3.5" />
            {t('screener.advanced.tabs.advancedFilters')}
          </TabsTrigger>
          <TabsTrigger value="top-performers" className="gap-1.5">
            <Trophy className="w-3.5 h-3.5" />
            {t('screener.advanced.tabs.topPerformers')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="advanced">
          <AdvancedFiltersTab initialMarket={initialMarket} />
        </TabsContent>
        <TabsContent value="top-performers">
          <TopPerformersTab />
        </TabsContent>
      </Tabs>

      {/* إخلاء مسؤولية قانوني */}
      <LegalDisclaimerFooter />
    </div>
  );
}

// ─── Tab 1: Advanced Filters ──────────────────────────────────────────────────

function AdvancedFiltersTab({ initialMarket }: { initialMarket?: string }) {
  const t = useTranslation();
  const FILTER_HELP = getFilterHelp(t);
  const loadStockDetail = useAppStore((s) => s.loadStockDetail);

  // Filter state — لو initialMarket='CRYPTO' → ابدأ بـ CRYPTO
  // FIX (Oct 2026 — owner directive): sync مع store.currentMarket
  const _storeMarket = useAppStore((s) => s.currentMarket);
  const [market, setMarket] = useState(initialMarket || _storeMarket || 'EGX');
  // لما الـ store market يتغير، حدّث الـ local state
  useEffect(() => {
    if (_storeMarket) setMarket(_storeMarket);
  }, [_storeMarket]);
  const [sector, setSector] = useState('ALL');
  const [sort, setSort] = useState('turnover_egp');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState(100);

  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minVolume, setMinVolume] = useState('');
  const [minTurnover, setMinTurnover] = useState('');
  const [trend, setTrend] = useState('all');
  const [aboveMa, setAboveMa] = useState('all');
  const [rsi, setRsi] = useState('all');
  const [volumeSurge, setVolumeSurge] = useState(false);
  const [near52wHigh, setNear52wHigh] = useState(false);
  const [near52wLow, setNear52wLow] = useState(false);

  const [minPe, setMinPe] = useState('');
  const [maxPe, setMaxPe] = useState('');
  const [minRoe, setMinRoe] = useState('');
  const [minDividendYield, setMinDividendYield] = useState('');
  const [minMarketCap, setMinMarketCap] = useState('');
  const [maxMarketCap, setMaxMarketCap] = useState('');

  const [stockState, setStockState] = useState('ALL');

  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [showStateHelp, setShowStateHelp] = useState(false);

  // Column visibility state (show/hide any column)
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});

  // Data state
  const [stocks, setStocks] = useState<ScreenerStock[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [summary, setSummary] = useState<ScreenerResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sort state (client-side header click sorting on top of server-side default sort)
  const [clientSortField, setClientSortField] = useState<SortField | null>(null);
  const [clientSortDir, setClientSortDir] = useState<SortDir>('desc');

  // ─── (UNIFIED-TABLE-UPGRADE) One-Click Trader Presets ────────────────
  // فلتر إضافي client-side للحقول اللي الـ server مش بيدعمها (rr، score،
  // stop_distance، maker_activity، accumulation). كل preset يطبّق الفلاتر
  // اللي يقدر عليها في الـ state + يضبط ده للباقي. Rule 27: لا fabrication.
  const [clientExtraFilter, setClientExtraFilter] = useState<ExtraClientFilter | null>(null);

  // قوالب المتداول المحترف (One-Click Trader Presets)
  const traderPresets: ExtraClientFilter[] = useMemo(() => [
    {
      label: '🌟 زبدة الرادار',
      test: (s) => isHighMakerActivity(s)
        && s.turnover_egp > 1_000_000
        && computeScreenerRR(s) >= 2.0,
    },
    {
      label: '🚀 انفجار سعري',
      test: (s) => !!s.volume_surge
        && s.above_ma_50
        && computeOpportunityQuality(s) >= 70,
    },
    {
      label: '💎 قيعان ارتدادية',
      test: (s) => s.rsi !== null && s.rsi >= 30 && s.rsi <= 45
        && !!s.accumulation && s.accumulation.includes('تجميع'),
    },
    {
      label: '🛡️ استثمار دفاعي',
      test: (s) => {
        const dist = computeStopDistancePct(s);
        return dist > 0 && dist < 3 && s.turnover_egp > 5_000_000;
      },
    },
  ], []);

  const fetchScreener = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        market,
        sort,
        order,
        limit: String(limit),
      });
      if (sector !== 'ALL') params.set('sector', sector);
      if (minPrice) params.set('min_price', minPrice);
      if (maxPrice) params.set('max_price', maxPrice);
      if (minVolume) params.set('min_volume', minVolume);
      if (minTurnover) params.set('min_turnover', minTurnover);
      if (trend !== 'all') params.set('trend', trend);
      if (aboveMa !== 'all') params.set('above_ma', aboveMa);
      if (rsi === 'oversold') params.set('rsi_oversold', '1');
      if (rsi === 'overbought') params.set('rsi_overbought', '1');
      if (volumeSurge) params.set('volume_surge', '1');
      if (near52wHigh) params.set('near_52w_high', '1');
      if (near52wLow) params.set('near_52w_low', '1');
      if (minPe) params.set('min_pe', minPe);
      if (maxPe) params.set('max_pe', maxPe);
      if (minRoe) params.set('min_roe', minRoe);
      if (minDividendYield) params.set('min_dividend_yield', minDividendYield);
      if (minMarketCap) params.set('min_market_cap', minMarketCap);
      if (maxMarketCap) params.set('max_market_cap', maxMarketCap);
      if (stockState !== 'ALL') params.set('stock_state', stockState);

      // Parallel fetch: screener + liquidity radar (linking only — no new code)
      const [screenerRes, radarRes] = await Promise.all([
        fetch(`/api/screener/advanced?${params}`, { cache: 'no-store' }),
        fetch(`/api/maker-radar?market=${encodeURIComponent(market)}&minQuietSignals=5&minPrice=1.0`, { cache: 'no-store' }).catch(() => null),
      ]);
      const json: ScreenerResponse = await screenerRes.json();

      // Build ticker → radar lookup map (linking data, not new code)
      const radarMap = new Map<string, Record<string, unknown>>();
      if (radarRes && radarRes.ok) {
        try {
          const radarJson = await radarRes.json();
          const lists = [
            ...(radarJson.quiet_list || []),
            ...(radarJson.pre_surge_list || []),
            ...(radarJson.explosive_list || []),
            ...(radarJson.early_break_list || []),
          ];
          for (const item of lists) {
            if (item?.ticker) radarMap.set(String(item.ticker).toUpperCase(), item);
          }
        } catch { /* radar optional — fail silently */ }
      }

      if (json.success) {
        // Merge radar fields into each stock (linking)
        const mergedStocks = (json.stocks || []).map((s) => {
          const r = radarMap.get(s.ticker.toUpperCase());
          if (!r) return s;
          return {
            ...s,
            maker_activity: (r.maker_activity as string) ?? null,
            buy_pct: (r.buy_pct as number) ?? null,
            net_flow_egp: (r.net_flow_egp as number) ?? null,
            accumulation: (r.accumulation as string) ?? null,
            life_cycle: (r.life_cycle as string) ?? null,
            expected: (r.expected as string) ?? null,
            path: (r.path as string) ?? null,
            position_size: (r.position_size as number) ?? null,
            volume_ratio_10d_vs_20d: (r.volume_ratio_10d_vs_20d as number) ?? null,
          };
        });
        setStocks(mergedStocks);
        setSectors(json.sectors || []);
        setSummary(json.summary || null);
      } else {
        setError(json.error || t('screener.advanced.toast.loadFailed'));
        toast.error(json.error || t('screener.advanced.toast.loadFailed'));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('screener.advanced.toast.connectionError');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [
    market, sector, sort, order, limit,
    minPrice, maxPrice, minVolume, minTurnover,
    trend, aboveMa, rsi, volumeSurge, near52wHigh, near52wLow,
    minPe, maxPe, minRoe, minDividendYield, minMarketCap, maxMarketCap,
    stockState,
  ]);

  useEffect(() => {
    fetchScreener();
  }, [fetchScreener]);

   // Reset filters
   const resetFilters = () => {
     setMarket(initialMarket || 'EGX');
     setSector('ALL');
     setSort('turnover_egp');
     setOrder('desc');
     setLimit(100);
     setMinPrice(''); setMaxPrice(''); setMinVolume(''); setMinTurnover('');
     setTrend('all'); setAboveMa('all'); setRsi('all');
     setVolumeSurge(false); setNear52wHigh(false); setNear52wLow(false);
     setMinPe(''); setMaxPe(''); setMinRoe('');
     setMinDividendYield(''); setMinMarketCap(''); setMaxMarketCap('');
     setStockState('ALL');
     setSearchQuery('');
     setClientExtraFilter(null); // (UNIFIED-TABLE-UPGRADE) clear trader preset too
     toast.success(t('screener.advanced.toast.filtersReset'));
   };

   // Presets — FIX-UI-AUDIT (re-applied to NEW path): primary presets shown
   // as inline buttons (7 audit-approved), the rest collapsed into a
   // shadcn DropdownMenu «المزيد (N)» to reduce visual clutter (20+ → 8).
   const presets = [
     {
       label: t('screener.advanced.presets.recovery'),
       icon: TrendingUp,
       color: 'emerald',
       primary: true,
       apply: () => {
         setStockState('CORRECTION_END');
         setTrend('up');
         setVolumeSurge(true);
         setSort('momentum_score');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.highMomentum'),
       icon: Gauge,
       color: 'teal',
       primary: true,
       apply: () => {
         setVolumeSurge(true);
         setAboveMa('above');
         setTrend('up');
         setSort('momentum_score');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.nearBreak'),
       icon: Zap,
       color: 'amber',
       primary: true,
       apply: () => {
         setNear52wHigh(true);
         setAboveMa('above');
         setSort('momentum_score');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.atPeak'),
       icon: Trophy,
       color: 'orange',
       apply: () => {
         setStockState('AT_PEAK');
         setRsi('overbought');
         setSort('change_percent');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.active'),
       icon: Flame,
       color: 'red',
       apply: () => {
         setVolumeSurge(true);
         setMinVolume('500000');
         setSort('volume');
         setOrder('desc');
         setLimit(200);
       },
     },
     {
       label: t('screener.advanced.presets.dead'),
       icon: Snowflake,
       color: 'gray',
       apply: () => {
         setVolumeSurge(false);
         setMinVolume('10000');
         setSort('volume');
         setOrder('asc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.undervalued'),
       icon: PiggyBank,
       color: 'purple',
       apply: () => {
         setMaxPe('10');
         setMinRoe('15');
         setSort('pe_ratio');
         setOrder('asc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.oversold'),
       icon: TrendingDown,
       color: 'rose',
       apply: () => {
         setRsi('oversold');
         setNear52wLow(true);
         setSort('rsi');
         setOrder('asc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.highDividend'),
       icon: BarChart3,
       color: 'green',
       apply: () => {
         setMinDividendYield('5');
         setMinRoe('10');
         setSort('dividend_yield');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.growth'),
       icon: TrendingUp,
       color: 'teal',
       apply: () => {
         setMinRoe('20');
         setAboveMa('above');
         setSort('roe');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.value'),
       icon: Shield,
       color: 'cyan',
       apply: () => {
         setMaxPe('12');
         setMinDividendYield('3');
         setMaxMarketCap('50000000000');
         setSort('pe_ratio');
         setOrder('asc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.largeCap'),
       icon: Crown,
       color: 'yellow',
       apply: () => {
         setMinMarketCap('100000000000');
         setSort('market_cap');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.highLiquidity'),
       icon: Activity,
       color: 'cyan',
       primary: true,
       apply: () => {
         setMinTurnover('50000000');
         setMinVolume('1000000');
         setSort('turnover_egp');
         setOrder('desc');
         setLimit(200);
       },
     },
     {
       label: t('screener.advanced.presets.sharpDrop'),
        icon: TrendingDown,
       color: 'red',
       apply: () => {
         setTrend('down');
         setRsi('oversold');
         setNear52wLow(true);
         setSort('change_percent');
         setOrder('asc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.low52w'),
       icon: Target,
       color: 'violet',
       apply: () => {
         setNear52wLow(true);
         setRsi('oversold');
         setStockState('CORRECTION');
         setSort('distance_from_52w_low');
         setOrder('asc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.high52w'),
       icon: Trophy,
       color: 'gold',
       apply: () => {
         setNear52wHigh(true);
         setStockState('AT_PEAK');
         setSort('distance_from_52w_high');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.aboveMa'),
       icon: TrendingUp,
       color: 'emerald',
       primary: true,
       apply: () => {
         setAboveMa('above');
         setTrend('up');
         setSort('momentum_score');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.belowMa'),
       icon: TrendingDown,
       color: 'slate',
       apply: () => {
         setAboveMa('below');
         setTrend('down');
         setSort('momentum_score');
         setOrder('asc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.moderateRsi'),
       icon: Gauge,
       color: 'teal',
       primary: true,
       apply: () => {
         setRsi('neutral');
         setStockState('BALANCED_MOMENTUM');
         setSort('rsi');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.reversalOpportunity'),
       icon: Shield,
       color: 'teal',
       apply: () => {
         setVolumeSurge(true);
         setStockState('CORRECTION_END');
         setTrend('up');
         setSort('momentum_score');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: t('screener.advanced.presets.stable'),
       icon: Shield,
       color: 'gray',
       apply: () => {
         setTrend('neutral');
         setRsi('neutral');
         setAboveMa('both');
         setStockState('NEUTRAL');
         setSort('volatility');
         setOrder('asc');
         setLimit(100);
       },
     },
     {
       // FIX-UI-AUDIT: NEW preset — institutional accumulation
       // (above MA + volume surge + strong turnover + uptrend, sorted by
       // momentum_score desc). Audit-approved primary button.
       label: t('screener.advanced.presets.strongAccumulation'),
       icon: PiggyBank,
       color: 'emerald',
       primary: true,
       apply: () => {
         setAboveMa('above');
         setTrend('up');
         setVolumeSurge(true);
         setMinTurnover('20000000');
         setSort('momentum_score');
         setOrder('desc');
         setLimit(100);
       },
     },
   ];

   const colorMap: Record<string, string> = {
     emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300',
     teal: 'border-teal-500/40 bg-teal-500/10 text-teal-700 hover:bg-teal-500/20 dark:text-teal-300',
     amber: 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300',
     orange: 'border-orange-500/40 bg-orange-500/10 text-orange-700 hover:bg-orange-500/20 dark:text-orange-300',
     red: 'border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300',
     gray: 'border-gray-500/40 bg-gray-500/10 text-gray-700 hover:bg-gray-500/20 dark:text-gray-300',
     purple: 'border-purple-500/40 bg-purple-500/10 text-purple-700 hover:bg-purple-500/20 dark:text-purple-300',
     rose: 'border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300',
     green: 'border-green-500/40 bg-green-500/10 text-green-700 hover:bg-green-500/20 dark:text-green-300',
     yellow: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-300',
     gold: 'border-yellow-600/40 bg-yellow-600/10 text-yellow-800 hover:bg-yellow-600/20 dark:text-yellow-400',
     cyan: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 dark:text-cyan-300',
     violet: 'border-violet-500/40 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 dark:text-violet-300',
     slate: 'border-slate-500/40 bg-slate-500/10 text-slate-700 hover:bg-slate-500/20 dark:text-slate-300',
   };

   const applyPreset = (preset: typeof presets[0]) => {
     resetFilters();
     preset.apply();
     toast.success(t('screener.advanced.toast.presetApplied', { preset: preset.label }));
   };

  // Client-side search + sort
  const filteredStocks = useMemo(() => {
    let list = stocks;
    if (searchQuery.trim()) {
      const q = searchQuery.toUpperCase();
      list = list.filter(s =>
        s.ticker.includes(q) ||
        s.name.toUpperCase().includes(q) ||
        (s.name_ar || '').includes(searchQuery)
      );
    }
    // (UNIFIED-TABLE-UPGRADE) One-Click Trader Preset client-side filter —
    // يطبّق الفلاتر على الحقول اللي server مش بيدعمها (rr، score،
    // stop_distance، maker_activity، accumulation). Rule 27: لا fabrication.
    if (clientExtraFilter) {
      list = list.filter(s => clientExtraFilter.test(s));
    }
    if (clientSortField) {
      const dir = clientSortDir === 'desc' ? -1 : 1;
      const field = clientSortField;
      const sorted = [...list].sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        // booleans
        if (typeof av === 'boolean' && typeof bv === 'boolean') {
          return dir * ((av ? 1 : 0) - (bv ? 1 : 0));
        }
        // nulls/undefined last
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
        // string compare for state — use STATE_ORDER
        if (field === 'stock_state') {
          const ao = STATE_ORDER[(av as string)] ?? 99;
          const bo = STATE_ORDER[(bv as string)] ?? 99;
          return dir * (ao - bo);
        }
        return dir * String(av).localeCompare(String(bv));
      });
      list = sorted;
    }
    return list;
  }, [stocks, searchQuery, clientExtraFilter, clientSortField, clientSortDir]);

  // PAYWALL Gate 5: free users (post-trial) see only first 5 filter results.
  // Paid users + trial users see the full list. Strategy §4.1 row 2.
  const screenerSubscriptionUser = useAppStore((s) => s.user);
  const screenerSubStatus = getTrialStatus(screenerSubscriptionUser);
  const screenerLocked = screenerSubStatus.isFreeUser && screenerSubStatus.isTrialExpired;
  const FREE_RESULTS_LIMIT = 5;
  // --------------------------------------------------------------------
  // FIX-UI-AUDIT (re-applied to NEW path): compute summary KPIs from
  // filteredStocks, not from the server `summary` (which is often 0/null
  // before the screener backend warms up). Rule 27: every displayed
  // number traces back to a displayed row.
  // --------------------------------------------------------------------
  const derivedSummary = useMemo(() => {
    if (!filteredStocks.length) return null;
    const gainers = filteredStocks.filter(s => (s.change_percent ?? 0) > 0).length;
    const losers = filteredStocks.filter(s => (s.change_percent ?? 0) < 0).length;
    const avgChange = filteredStocks.reduce((sum, s) => sum + (s.change_percent || 0), 0) / filteredStocks.length;
    const totalLiquidity = filteredStocks.reduce((sum, s) => sum + (s.turnover_egp || 0), 0);
    const volumeMomentum = filteredStocks.filter(s => s.volume_surge).length;
    return {
      gainers,
      losers,
      avgChange,
      totalLiquidity,
      volumeMomentum,
      total: filteredStocks.length,
    };
  }, [filteredStocks]);

  const visibleStocks = useMemo(
    () => (screenerLocked ? filteredStocks.slice(0, FREE_RESULTS_LIMIT) : filteredStocks),
    [screenerLocked, filteredStocks],
  );
  const hiddenResultsCount = Math.max(0, filteredStocks.length - FREE_RESULTS_LIMIT);

  // Toggle sort on header click
  const toggleSort = (field: SortField) => {
    if (clientSortField === field) {
      setClientSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setClientSortField(field);
      setClientSortDir('desc');
    }
  };

  const onRowClick = (ticker: string) => {
    loadStockDetail(ticker);
  };

  // N6: double-click / long-press يفتح شاشة التفاصيل الكاملة للسهم
  const onRowDoubleClick = (ticker: string) => {
    loadStockDetail(ticker);
  };

  // ── UnifiedTable columns for screener results ──
  const screenerColumns: Column<ScreenerStock>[] = useMemo(
    () => [
      {
        key: 'ticker',
        header: t('screener.advanced.columns.stock'),
        align: 'right',
        sortable: true,
        filterable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: ticker string (alphabetic via fallback path)
        sortValue: (s) => s.ticker || '',
        filterValue: (s) => s.ticker,
        render: (s) => (
          <div>
            <div className="font-mono font-bold text-sm">{s.ticker}</div>
            <div className="text-xs text-muted-foreground truncate max-w-[150px]">
              {s.name_ar || s.name}
            </div>
            <div className="text-xs text-muted-foreground">{s.sector}</div>
          </div>
        ),
      },
      {
        key: 'current_price',
        header: t('screener.advanced.columns.price'),
        align: 'left',
        sortable: true,
        filterable: true,
        editable: true, // (Task 37) «الجدول المتقدّم» — inline edit (local only)
        // (UNIFIED-TABLE-UPGRADE) sortValue: current_price (0/null → -1)
        sortValue: (s) => s.current_price > 0 ? s.current_price : -1,
        render: (s) => (
          <span className="font-mono text-sm">{formatNumber(s.current_price)}</span>
        ),
      },
      {
        key: 'change_percent',
        header: t('screener.advanced.columns.changePercent'),
        align: 'left',
        sortable: true,
        filterable: true,
        editable: true, // (Task 37) «الجدول المتقدّم» — inline edit (local only)
        // (UNIFIED-TABLE-UPGRADE) sortValue: change_percent (null → -Infinity to bottom)
        sortValue: (s) => Number.isFinite(s.change_percent) ? s.change_percent : -Infinity,
        render: (s) => (
          <span className={cn('font-mono text-sm font-medium', getChangeColor(s.change_percent))}>
            {s.change_percent > 0 ? '+' : ''}{formatNumber(s.change_percent)}%
          </span>
        ),
      },
      {
        key: 'sparkline',
        header: t('screener.advanced.columns.chart'),
        align: 'center',
        render: (s) => (
          <MiniSparkline ticker={s.ticker} height={24} width={80} showArea={false} />
        ),
      },
      // ── Owner directive: "حط أعمدة Entry / Stop / Target / R/R في المقدمة" ──
      {
        key: 'entry',
        header: 'دخول',
        align: 'left',
        sortable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: computed entry price (-1 if invalid)
        sortValue: (s) => computeScreenerEntry(s),
        render: (s) => {
          const entry = computeScreenerEntry(s);
          return <span className="font-mono text-xs font-semibold text-foreground">{entry > 0 ? (entry ?? 0).toFixed(2) : '—'}</span>;
        },
      },
      {
        key: 'stop',
        header: 'وقف',
        align: 'left',
        sortable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: computed stop price (-1 if invalid)
        sortValue: (s) => computeScreenerStop(s),
        render: (s) => {
          const stop = computeScreenerStop(s);
          return <span className="font-mono text-xs font-semibold text-red-600 dark:text-red-400">{stop > 0 ? (stop ?? 0).toFixed(2) : '—'}</span>;
        },
      },
      {
        key: 'target',
        header: 'هدف',
        align: 'left',
        sortable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: computed target price (-1 if invalid)
        sortValue: (s) => computeScreenerTarget(s),
        render: (s) => {
          const target = computeScreenerTarget(s);
          return <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">{target > 0 ? (target ?? 0).toFixed(2) : '—'}</span>;
        },
      },
      {
        key: 'risk_reward',
        header: 'R:R',
        align: 'left',
        sortable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: computed R:R (-1 if invalid)
        sortValue: (s) => computeScreenerRR(s),
        render: (s) => {
          const rr = computeScreenerRR(s);
          if (rr > 0) {
            const rrColor = rr >= 2 ? 'text-emerald-600 dark:text-emerald-400' : rr >= 1.5 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
            return <span className={`font-mono text-xs font-bold ${rrColor}`}>{(rr ?? 0).toFixed(2)}</span>;
          }
          return <span className="text-muted-foreground">—</span>;
        },
      },
      {
        key: 'opportunity_quality',
        header: 'جودة',
        align: 'left',
        sortable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: opportunity_quality score (-1 if invalid)
        sortValue: (s) => computeOpportunityQuality(s),
        render: (s) => {
          const quality = computeOpportunityQuality(s);
          const color = quality >= 70 ? 'text-emerald-600 dark:text-emerald-400' : quality >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground';
          return <span className={`font-mono text-xs font-bold ${color}`}>{quality}</span>;
        },
      },
      {
        key: 'volume',
        header: t('screener.advanced.columns.volume'),
        align: 'left',
        sortable: true,
        filterable: true,
        editable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: volume (-1 if invalid)
        sortValue: (s) => s.volume > 0 ? s.volume : -1,
        render: (s) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatVolume(s.volume)}
            {s.volume_surge && <Zap className="inline w-3 h-3 text-amber-500 mr-1" />}
          </span>
        ),
      },
      {
        key: 'turnover_egp',
        header: t('screener.advanced.columns.liquidityEGP'),
        align: 'left',
        sortable: true,
        filterable: true,
        editable: true, // (Task 37) «الجدول المتقدّم» — inline edit (local only)
        // (UNIFIED-TABLE-UPGRADE) sortValue: turnover_egp (-1 if invalid)
        sortValue: (s) => s.turnover_egp > 0 ? s.turnover_egp : -1,
        render: (s) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatEGP(s.turnover_egp)}
          </span>
        ),
      },
      {
        key: 'pe_ratio',
        header: t('screener.advanced.columns.peRatio'),
        align: 'left',
        sortable: true,
        filterable: true,
        editable: true, // (Task 37) «الجدول المتقدّم» — inline edit (local only)
        // (UNIFIED-TABLE-UPGRADE) sortValue: pe_ratio (-1 if null/0/15 placeholder)
        sortValue: (s) => (s.pe_ratio !== null && s.pe_ratio > 0 && s.pe_ratio !== 15.0) ? s.pe_ratio : -1,
        render: (s) => (
          <span className="font-mono text-xs">
            {s.pe_ratio !== null ? formatNumber(s.pe_ratio, 1) : '—'}
          </span>
        ),
      },
      {
        key: 'roe',
        header: 'ROE %',
        align: 'left',
        sortable: true,
        filterable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: ROE (-1 if null/0/15 placeholder)
        sortValue: (s) => (s.roe !== null && s.roe !== undefined && s.roe !== 0 && s.roe !== 15.0) ? s.roe : -1,
        render: (s) => {
          // Owner directive: "متظهرش أرقام وهمية" — ROE=15.0 placeholder أو 0 = "—"
          const val = s.roe;
          const isValid = val !== null && val !== undefined && val !== 0 && val !== 15.0;
          return <span className="font-mono text-xs">{isValid ? formatNumber(val, 1) : '—'}</span>;
        },
      },
      {
        key: 'rsi',
        header: 'RSI',
        align: 'left',
        sortable: true,
        filterable: true,
        editable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: RSI (-1 if null/0)
        sortValue: (s) => (s.rsi !== null && s.rsi !== undefined && s.rsi > 0) ? s.rsi : -1,
        render: (s) => {
          // Owner directive: "متظهرش أرقام وهمية" — RSI=0 = "—"
          const val = s.rsi;
          const isValid = val !== null && val !== undefined && val > 0;
          return <span className="font-mono text-xs">{isValid ? formatNumber(val, 0) : '—'}</span>;
        },
      },
      {
        key: 'stock_state',
        header: t('screener.advanced.columns.stockState'),
        align: 'right',
        sortable: true,
        filterable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: STATE_ORDER rank (99 if unknown)
        sortValue: (s) => STATE_ORDER[s.stock_state] ?? 99,
        filterValue: (s) => s.stock_state,
        render: (s) => <StateBadge state={s.stock_state} reason={s.stock_state_reason} />,
      },
      {
        key: 'above_ma_50',
        header: t('screener.advanced.columns.aboveMa50'),
        align: 'center',
        sortable: true,
        filterable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: 1 if above, 0 if below
        sortValue: (s) => s.above_ma_50 ? 1 : 0,
        filterValue: (s) => s.above_ma_50 ? 'above' : 'below',
        render: (s) =>
          s.above_ma_50 ? (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-xs px-2 py-0.5">
              {t('screener.advanced.stockStateColumn.above')}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs px-2 py-0.5">
              {t('screener.advanced.stockStateColumn.below')}
            </Badge>
          ),
      },
      // ── Liquidity radar columns (linked from /api/maker-radar) ──
      {
        key: 'maker_activity',
        header: 'نشاط الميكر',
        align: 'right',
        sortable: true,
        filterable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: 3=high, 2=med, 1=low, 0=unknown (-1 if null)
        sortValue: (s) => {
          const a = s.maker_activity;
          if (!a) return -1;
          if (a === 'عالي' || a === 'مرتفع' || a.toLowerCase() === 'high') return 3;
          if (a === 'متوسط' || a.toLowerCase() === 'medium' || a.toLowerCase() === 'moderate') return 2;
          if (a === 'منخفض' || a.toLowerCase() === 'low') return 1;
          return 0;
        },
        filterValue: (s) => s.maker_activity || '—',
        render: (s) => (
          <span className="text-xs">
            {s.maker_activity || '—'}
          </span>
        ),
      },
      {
        key: 'buy_pct',
        header: 'ضغط الشراء %',
        align: 'left',
        sortable: true,
        filterable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: buy_pct (-1 if null)
        sortValue: (s) => (s.buy_pct !== null && s.buy_pct !== undefined) ? s.buy_pct : -1,
        render: (s) => (
          <span className={cn('font-mono text-xs', (s.buy_pct ?? 0) >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {s.buy_pct !== null && s.buy_pct !== undefined ? formatNumber(s.buy_pct, 1) + '%' : '—'}
          </span>
        ),
      },
      {
        key: 'net_flow_egp',
        header: 'التدفق الصافي',
        align: 'left',
        sortable: true,
        filterable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: net_flow_egp (-Infinity if null)
        sortValue: (s) => (s.net_flow_egp !== null && s.net_flow_egp !== undefined && Number.isFinite(s.net_flow_egp)) ? s.net_flow_egp : -Infinity,
        render: (s) => (
          <span className={cn('font-mono text-xs', (s.net_flow_egp ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : (s.net_flow_egp ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
            {s.net_flow_egp !== null && s.net_flow_egp !== undefined ? formatEGP(s.net_flow_egp) : '—'}
          </span>
        ),
      },
      {
        key: 'accumulation',
        header: 'التجميع',
        align: 'right',
        sortable: true,
        filterable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: 3=قوي, 2=تجميع, 1=محايد, 0=تصريف (-1 if null)
        sortValue: (s) => {
          const a = s.accumulation;
          if (!a) return -1;
          if (a.includes('تجميع قوي')) return 4;
          if (a.includes('تجميع')) return 3;
          if (a.includes('محايد')) return 2;
          if (a.includes('تصريف')) return 1;
          return 0;
        },
        filterValue: (s) => s.accumulation || '—',
        render: (s) => (
          <span className="text-xs">
            {s.accumulation || '—'}
          </span>
        ),
      },
      {
        key: 'life_cycle',
        header: 'دورة الحياة',
        align: 'right',
        sortable: true,
        filterable: true,
        // (UNIFIED-TABLE-UPGRADE) sortValue: life_cycle string (alphabetic via fallback)
        sortValue: (s) => s.life_cycle || '',
        filterValue: (s) => s.life_cycle || '—',
        render: (s) => (
          <span className="text-xs">
            {s.life_cycle || '—'}
          </span>
        ),
      },
      {
        key: 'expected',
        header: 'المتوقع',
        align: 'right',
        sortable: false,
        // (UNIFIED-TABLE-UPGRADE) sortValue: expected string (sortable via fallback)
        sortValue: (s) => s.expected || '',
        filterValue: (s) => s.expected || '—',
        render: (s) => (
          <span className="text-xs text-muted-foreground truncate block max-w-[180px]">
            {s.expected || '—'}
          </span>
        ),
      },
      // Entry/Stop/Target/R:R/Opportunity_Quality moved to front (after sparkline)
      // — duplicates removed (Owner directive: "حط Entry/Stop/Target/R/R في المقدمة")
    ],
    []
  );

  // CSV export
  const exportCSV = () => {
    const headers = ['Ticker', 'Name', 'Sector', 'Price', 'Change%', 'Volume', 'Turnover', 'PE', 'ROE', 'RSI', 'State', 'Momentum', 'MakerActivity', 'BuyPct', 'NetFlow', 'Accumulation', 'LifeCycle'];
    const rows = filteredStocks.map(s => [
      s.ticker, s.name_ar || s.name, s.sector,
      s.current_price, s.change_percent, s.volume,
      s.turnover_egp,
      s.pe_ratio ?? '', s.roe ?? '',
      s.rsi ?? '',
      s.stock_state_ar || s.stock_state,
      s.momentum_score,
      s.maker_activity ?? '',
      s.buy_pct ?? '',
      s.net_flow_egp ?? '',
      s.accumulation ?? '',
      s.life_cycle ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screener_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
     toast.success(t('screener.advanced.toast.exported', { count: filteredStocks.length }));
   };

  const screenerShareText = useMemo(
    () => generateScreenerText(filteredStocks, market, sector, t),
    [filteredStocks, market, sector],
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters((s) => !s)}
          className="gap-1.5"
        >
          {showFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showFilters ? t('screener.advanced.collapsible.hideFilters') : t('screener.advanced.collapsible.showFilters')}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            {t('screener.advanced.buttons.reset')}
          </Button>
          <ExportDropdown
            shareText={screenerShareText}
            disabled={!filteredStocks.length}
            showCsv
            onExportCsv={exportCSV}
          />
          <UnifiedPublishButton
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            title={t('screener.advanced.share.filterTitle')}
            content={screenerShareText || t('screener.advanced.share.title', { count: filteredStocks.length })}
            filename={`screener-${market}-${Date.now()}`}
            hashtags={t('screener.advanced.share.hashtags').split(',').concat([market])}
            triggerLabel={t('screener.advanced.buttons.publish')}
          />
          <Button variant="default" size="sm" onClick={fetchScreener} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            {t('screener.advanced.buttons.refresh')}
          </Button>
        </div>
      </div>

      {/* Presets — UNIFIED-MARKET-UX (Task 3): Collapsible.
          FIX-UI-AUDIT (re-applied to NEW path): only 7 audit-approved
          primary presets render as inline buttons; the rest collapse into
          a shadcn DropdownMenu «المزيد (N)». Reduces 20+ buttons → 8. */}
      <CollapsibleSection
        title={t('screener.advanced.collapsible.readyFilters')}
        icon={<Zap className="w-4 h-4 text-amber-600" />}
      >
        <div className="flex flex-wrap gap-2 items-center">
          {presets.filter(p => p.primary).map((preset) => {
            const Icon = preset.icon;
            return (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(preset)}
                className={cn('gap-1.5 border', colorMap[preset.color])}
              >
                <Icon className="w-3.5 h-3.5" />
                {preset.label}
              </Button>
            );
          })}
          {(() => {
            const secondary = presets.filter(p => !p.primary);
            if (secondary.length === 0) return null;
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-slate-400/40 bg-slate-50/50 text-slate-700 hover:bg-slate-100 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:bg-slate-800/60"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    {t('screener.advanced.presets.more')}
                    <Badge variant="secondary" className="h-4 text-[10px] px-1">{secondary.length}</Badge>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-[60vh] overflow-y-auto overflow-x-hidden w-56"
                  dir="rtl"
                >
                  <DropdownMenuLabel>
                    {t('screener.advanced.collapsible.readyFilters')}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {secondary.map((preset) => {
                    const Icon = preset.icon;
                    return (
                      <DropdownMenuItem
                        key={preset.label}
                        onClick={() => applyPreset(preset)}
                        className="gap-2 cursor-pointer"
                      >
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{preset.label}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })()}
        </div>
      </CollapsibleSection>

      {/* ─── (UNIFIED-TABLE-UPGRADE) One-Click Trader Presets ────────────
          أزرار فلترة سريعة للمتداول المحترف (فوق الجدول مباشرة). كل زر يطبّق
          تركيبة فلاتر متخصصة على الـ clientExtraFilter + يضبط ما يقدر عليه
          من الـ server filter state. Rule 27: لا fabrication. */}
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-950/10">
        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">قوالب المتداول المحترف</span>
        {traderPresets.map((preset) => {
          const isActive = clientExtraFilter?.label === preset.label;
          return (
            <Button
              key={preset.label}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                if (isActive) {
                  // toggle off — امسح الفلتر الإضافي
                  setClientExtraFilter(null);
                } else {
                  // طبّق preset: لا reset كامل عشان نحافظ على فلتر السوق/القطاع
                  // اللي اختاره المستخدم. بس اضبط الفلتر الإضافي.
                  setClientExtraFilter(preset);
                }
                toast.success(
                  isActive
                    ? t('screener.advanced.toast.filtersReset')
                    : `تم تطبيق: ${preset.label}`
                );
              }}
              className={cn(
                'h-8 text-xs gap-1.5 transition-all',
                isActive
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'border-emerald-500/40 bg-background text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30',
              )}
              title={isActive ? 'إزالة الفلتر' : 'تطبيق القالب'}
            >
              {preset.label}
            </Button>
          );
        })}
        {clientExtraFilter && (
          <button
            onClick={() => setClientExtraFilter(null)}
            className="text-[10px] text-rose-500 hover:text-rose-700 px-1.5 py-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
            title="مسح فلتر القالب"
          >
            ✕ مسح القالب
          </button>
        )}
      </div>

      {/* Filters Panel — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      {/* N5: الفلاتر المتقدمة مطوية افتراضياً لتحسين تجربة المستخدم أول التحميل */}
      {showFilters && (
        <CollapsibleSection
          title={t('screener.advanced.tabs.advancedFilters')}
          icon={<Filter className="w-4 h-4" />}
          defaultOpen={false}
        >
            {/* Search row */}
            <div className="relative max-w-sm">
              <Search className="absolute right-2 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('screener.advanced.filters.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-8 h-9"
              />
            </div>

            {/* Grid of filters — 2 cols mobile, 3 sm, 4 lg */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Market */}
              <FilterField label={t('screener.advanced.filters.market')} help={FILTER_HELP.market}>
                <Select value={market} onValueChange={setMarket}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EGX">{t('screener.advanced.filters.egx')}</SelectItem>
                    <SelectItem value="ALL">{t('screener.advanced.filters.allMarkets')}</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Sector */}
              <FilterField label={t('screener.advanced.filters.sector')} help={FILTER_HELP.sector}>
                <Select value={sector} onValueChange={setSector}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t('screener.advanced.filters.allSectors')}</SelectItem>
                    {sectors.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Sort */}
              <FilterField label={t('screener.advanced.filters.labels.sortBy')}>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="turnover_egp">{t('screener.advanced.filters.sortOptions.liquidity')}</SelectItem>
                    <SelectItem value="change_percent">{t('screener.advanced.filters.sortOptions.changePercent')}</SelectItem>
                    <SelectItem value="volume">{t('screener.advanced.filters.sortOptions.volume')}</SelectItem>
                    <SelectItem value="market_cap">{t('screener.advanced.filters.sortOptions.marketCap')}</SelectItem>
                    <SelectItem value="rsi">RSI</SelectItem>
                    <SelectItem value="pe_ratio">{t('screener.advanced.filters.sortOptions.peRatio')}</SelectItem>
                    <SelectItem value="roe">{t('screener.advanced.filters.sortOptions.roe')}</SelectItem>
                    <SelectItem value="high_52w">{t('screener.advanced.filters.sortOptions.high52w')}</SelectItem>
                    <SelectItem value="low_52w">{t('screener.advanced.filters.sortOptions.low52w')}</SelectItem>
                    <SelectItem value="dividend_yield">{t('screener.advanced.filters.sortOptions.dividendYield')}</SelectItem>
                    <SelectItem value="momentum_score">{t('screener.advanced.filters.sortOptions.momentum')}</SelectItem>
                    <SelectItem value="stock_state">{t('screener.advanced.filters.sortOptions.stockState')}</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Order */}
              <FilterField label={t('screener.advanced.filters.labels.orderDirection')}>
                <Select value={order} onValueChange={(v) => setOrder(v as 'asc' | 'desc')}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">{t('screener.advanced.filters.order.desc')}</SelectItem>
                    <SelectItem value="asc">{t('screener.advanced.filters.order.asc')}</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Trend */}
              <FilterField label={t('screener.advanced.filters.labels.dailyTrend')} help={FILTER_HELP.trend}>
                <Select value={trend} onValueChange={setTrend}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('screener.advanced.filters.trend.all')}</SelectItem>
                    <SelectItem value="up">{t('screener.advanced.filters.trend.upOnly')}</SelectItem>
                    <SelectItem value="down">{t('screener.advanced.filters.trend.downOnly')}</SelectItem>
                    <SelectItem value="neutral">{t('screener.advanced.filters.trend.neutral')}</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Above MA */}
              <FilterField label={t('screener.advanced.filters.labels.aboveBelowMa')} help={FILTER_HELP.above_ma}>
                <Select value={aboveMa} onValueChange={setAboveMa}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('screener.advanced.filters.aboveMa.all')}</SelectItem>
                    <SelectItem value="50">{t('screener.advanced.filters.aboveMa.ma50')}</SelectItem>
                    <SelectItem value="200">{t('screener.advanced.filters.aboveMa.ma200')}</SelectItem>
                    <SelectItem value="both">{t('screener.advanced.filters.aboveMa.both')}</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* RSI */}
              <FilterField label={t('screener.advanced.filters.labels.rsiIndicator')} help={FILTER_HELP.rsi}>
                <Select value={rsi} onValueChange={setRsi}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('screener.advanced.filters.rsi.all')}</SelectItem>
                    <SelectItem value="oversold">{t('screener.advanced.filters.rsi.oversold')}</SelectItem>
                    <SelectItem value="overbought">{t('screener.advanced.filters.rsi.overbought')}</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Stock State */}
              <FilterField label={t('screener.advanced.filters.labels.technicalStockState')} help={FILTER_HELP.stock_state}>
                <Select value={stockState} onValueChange={setStockState}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t('screener.advanced.filters.stockState.all')}</SelectItem>
                    <SelectItem value="CORRECTION_END">{t('screener.advanced.filters.stockState.recovery')}</SelectItem>
                    <SelectItem value="BALANCED_MOMENTUM">{t('screener.advanced.filters.stockState.balancedMomentum')}</SelectItem>
                    <SelectItem value="NEAR_BREAKOUT">{t('screener.advanced.filters.stockState.nearBreak')}</SelectItem>
                    <SelectItem value="NEUTRAL">{t('screener.advanced.filters.stockState.neutral')}</SelectItem>
                    <SelectItem value="NEAR_PEAK">{t('screener.advanced.filters.stockState.nearPeak')}</SelectItem>
                    <SelectItem value="AT_PEAK">{t('screener.advanced.filters.stockState.atPeak')}</SelectItem>
                    <SelectItem value="CORRECTION">{t('screener.advanced.filters.stockState.inCorrection')}</SelectItem>
                    <SelectItem value="DECLINING">{t('screener.advanced.filters.stockState.stillFalling')}</SelectItem>
                    <SelectItem value="INSUFFICIENT_DATA">{t('screener.advanced.filters.stockState.insufficientData')}</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Min Price */}
              <FilterField label={t('screener.advanced.filters.minPrice')} help={FILTER_HELP.price}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Max Price */}
              <FilterField label={t('screener.advanced.filters.maxPrice')} help={FILTER_HELP.price}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="1000"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Min Volume */}
              <FilterField label={t('screener.advanced.filters.minVolume')} help={FILTER_HELP.volume}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={minVolume}
                  onChange={(e) => setMinVolume(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Min Turnover */}
              <FilterField label={t('screener.advanced.filters.minTurnover')} help={FILTER_HELP.turnover}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={minTurnover}
                  onChange={(e) => setMinTurnover(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Min PE */}
              <FilterField label={t('screener.advanced.filters.minPe')} help={FILTER_HELP.pe}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={minPe}
                  onChange={(e) => setMinPe(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Max PE */}
              <FilterField label={t('screener.advanced.filters.maxPe')} help={FILTER_HELP.pe}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="50"
                  value={maxPe}
                  onChange={(e) => setMaxPe(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Min ROE */}
              <FilterField label={t('screener.advanced.filters.minRoe')} help={FILTER_HELP.roe}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={minRoe}
                  onChange={(e) => setMinRoe(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Min Dividend Yield */}
              <FilterField label={t('screener.advanced.filters.minDividendYield')} help={FILTER_HELP.dividend_yield}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={minDividendYield}
                  onChange={(e) => setMinDividendYield(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Min Market Cap */}
              <FilterField label={t('screener.advanced.filters.minMarketCap')} help={FILTER_HELP.market_cap}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={minMarketCap}
                  onChange={(e) => setMinMarketCap(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Max Market Cap */}
              <FilterField label={t('screener.advanced.filters.maxMarketCap')} help={FILTER_HELP.market_cap}>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="100000000000"
                  value={maxMarketCap}
                  onChange={(e) => setMaxMarketCap(e.target.value)}
                  className="h-9"
                />
              </FilterField>

              {/* Limit */}
              <FilterField label={t('screener.advanced.filters.resultCount')}>
                <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </div>

            {/* Checkboxes row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
              <CheckboxField
                label={t('screener.advanced.filters.volumeSurge')}
                help={FILTER_HELP.volume_surge}
                checked={volumeSurge}
                onChange={setVolumeSurge}
              />
              <CheckboxField
                label={t('screener.advanced.filters.near52wHigh')}
                help={FILTER_HELP.near_52w_high}
                checked={near52wHigh}
                onChange={setNear52wHigh}
              />
              <CheckboxField
                label={t('screener.advanced.filters.near52wLow')}
                help={FILTER_HELP.near_52w_low}
                checked={near52wLow}
                onChange={setNear52wLow}
              />
            </div>

            {/* State legend / explanations */}
            <div className="border-t border-border pt-3">
              <button
                onClick={() => setShowStateHelp((s) => !s)}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                {(showStateHelp ? t('screener.advanced.collapsible.hideStateHelp') : t('screener.advanced.collapsible.showStateHelp')) + ' ' + t('screener.advanced.collapsible.stateHelpLabel')}
              </button>
              {showStateHelp && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {Object.entries(getStateExplanations(t)).map(([key, text]) => (
                    <div key={key} className="flex items-start gap-2 p-2 rounded bg-muted/30">
                      <StateBadge state={key} />
                      <p className="text-xs text-muted-foreground leading-relaxed flex-1">{text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
        </CollapsibleSection>
      )}

      {/* Inline summary KPIs (no cards) — FIX-UI-AUDIT: derived from
          filteredStocks (Rule 27), not from server `summary`. When the
          filter yields no rows, show an actionable reason banner instead
          of dead zeros. */}
      {derivedSummary ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <KPIBox label={t('screener.advanced.kpi.totalResults')} value={derivedSummary.total} />
          <KPIBox label={t('screener.advanced.kpi.gainers')} value={derivedSummary.gainers} color="text-emerald-600 dark:text-emerald-400" />
          <KPIBox label={t('screener.advanced.kpi.losers')} value={derivedSummary.losers} color="text-red-600 dark:text-red-400" />
          <KPIBox label={t('screener.advanced.kpi.avgChange')} value={`${derivedSummary.avgChange > 0 ? '+' : ''}${(derivedSummary.avgChange ?? 0).toFixed(2)}%`} color={derivedSummary.avgChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
          <KPIBox label={t('screener.advanced.kpi.totalLiquidity')} value={`${formatEGP(derivedSummary.totalLiquidity)} ${t('screener.advanced.kpi.egpSuffix')}`} />
          <KPIBox label={t('screener.advanced.kpi.volumeMomentum')} value={derivedSummary.volumeMomentum} color="text-amber-600 dark:text-amber-400" />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-4 py-3 text-center text-xs text-muted-foreground">
          لا توجد أسهم تحقق شروط الفلتر الحالي — جرّب فلتراً آخر أو وسّع النطاق
        </div>
      )}

      {/* Results Table — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      <CollapsibleSection
        title={t('screener.advanced.kpi.filterResults')}
        icon={<BarChart3 className="w-4 h-4 text-emerald-600" />}
        contentClassName="p-0 space-y-0"
      >
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            {t('screener.advanced.loading.loadingStocks')}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
            {error}
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={fetchScreener} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                {t('screener.advanced.buttons.retry')}
              </Button>
            </div>
          </div>
        ) : filteredStocks.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
            {t('screener.advanced.empty.noResults')}
          </div>
        ) : (
          <>
            {/* Task 37: «الجدول المتقدّم» (Advanced Table) — UnifiedTable with
                excelGrid={true} now has ALL Excel features (column resize by
                drag + inline edit + copy/paste + multi-sort + AutoFilter +
                column pinning + drag-drop reorder + calc columns + presets).
                AG Grid was trashed (theme mismatch + npm install failure).
                Rule 67: our own component > third-party library. */}
            <UnifiedTable
              columns={screenerColumns}
              data={visibleStocks}
              keyField="ticker"
              excelGrid
              columnToggle
              filterable
              showColumnFilters
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              showColumnToggle
              dense
              storageKey="screener-advanced"
              maxHeight="max-h-[600px]"
              emptyTextAr={t('screener.advanced.empty.noResults')}
              onRowClick={(row: ScreenerStock) => onRowClick(row.ticker)}
              onRowDoubleClick={(row: ScreenerStock) => onRowDoubleClick(row.ticker)}
              onRowLongPress={(row: ScreenerStock) => onRowDoubleClick(row.ticker)}
              publishable
              publishTitle={t('screener.advanced.share.filterTitleProfessional')}
              publishFilename={`screener-${new Date().toISOString().slice(0,10)}`}
              publishHashtags={t('screener.advanced.share.hashtags').split(',')}
            />
            {/* PAYWALL Gate 5: lock CTA — free users see first 5 only */}
            {screenerLocked && hiddenResultsCount > 0 && (
              <div className="border-t border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20 p-4 text-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                    <Lock className="h-4 w-4" />
                    <span className="text-sm font-semibold">
                      {hiddenResultsCount} نتائج أخرى — اشترك لعرض الكل
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground max-w-md">
                    النتائج المعروضة حالياً ({visibleStocks.length} من {filteredStocks.length}) كافية لتلمّس الفرص.
                    اشترك في Premium لعرض جميع النتائج + فلتر متقدم + تصدير PDF.
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5 mt-1"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.location.href = '/pricing';
                      }
                    }}
                  >
                    اشترك لعرض كل النتائج
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* Footer hint */}
      <div className="text-xs text-muted-foreground text-center pt-1">
        {t('screener.advanced.subtitleAuto')}
      </div>
    </div>
  );
}

// ─── Tab 2: Top Performers ───────────────────────────────────────────────────

function TopPerformersTab() {
  const t = useTranslation();
  const loadStockDetail = useAppStore((s) => s.loadStockDetail);
  // FIX (Oct 2026 — owner directive): sync مع store.currentMarket
  const _storeMarket = useAppStore((s) => s.currentMarket);

  const [period, setPeriod] = useState('1m');
  const [direction, setDirection] = useState('both');
  const [market, setMarket] = useState(_storeMarket || 'EGX');
  // لما الـ store market يتغير، حدّث الـ local state
  useEffect(() => {
    if (_storeMarket) setMarket(_storeMarket);
  }, [_storeMarket]);
  const [limit, setLimit] = useState(20);
  const [data, setData] = useState<TopPerformersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // client-side sort
  const [sortField, setSortField] = useState<'ticker' | 'start_price' | 'end_price' | 'change_pct' | 'period_days' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        period,
        direction,
        market,
        limit: String(limit),
      });
      const res = await fetch(`/api/stocks/top-performers?${params}`, { cache: 'no-store' });
      const json: TopPerformersResponse = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || json.hint || t('screener.advanced.toast.loadFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('screener.advanced.toast.connectionError'));
    } finally {
      setLoading(false);
    }
  }, [period, direction, market, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const results = data?.results || [];
  const summary = data?.summary;
  const periodLabel = getPeriods(t).find((p) => p.value === period)?.label || period;

  const sortedResults = useMemo(() => {
    if (!sortField) return results;
    const dir = sortDir === 'desc' ? -1 : 1;
    return [...results].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv));
    });
  }, [results, sortField, sortDir]);

  // ── UnifiedTable columns for top performers ──
  const topPerformerColumns: Column<TopPerformerStock>[] = useMemo(
    () => [
      {
        key: 'ticker',
        header: t('screener.advanced.performers.columns.stock'),
        align: 'right',
        sortable: true,
        filterable: true,
        render: (s) => (
          <div>
            <div className="font-mono font-bold text-sm">{s.ticker}</div>
            <div className="text-xs text-muted-foreground truncate max-w-[180px]">
              {s.name_ar || s.name}
            </div>
          </div>
        ),
      },
      {
        key: 'sector',
        header: t('screener.advanced.performers.columns.sector'),
        align: 'right',
        sortable: true,
        filterable: true,
        render: (s) => (
          <span className="text-xs text-muted-foreground">{s.sector || '—'}</span>
        ),
      },
      {
        key: 'start_price',
        header: t('screener.advanced.performers.columns.startPrice'),
        align: 'left',
        sortable: true,
        filterable: true,
        render: (s) => <span className="font-mono text-sm">{formatNumber(s.start_price)}</span>,
      },
      {
        key: 'end_price',
        header: t('screener.advanced.performers.columns.endPrice'),
        align: 'left',
        sortable: true,
        filterable: true,
        render: (s) => <span className="font-mono text-sm">{formatNumber(s.end_price)}</span>,
      },
      {
        key: 'change_pct',
        header: t('screener.advanced.performers.columns.changePct'),
        align: 'left',
        sortable: true,
        filterable: true,
        render: (s) => (
          <span
            className={cn(
              'font-mono font-bold',
              s.change_pct >= 0 ? 'text-emerald-600' : 'text-red-600',
            )}
          >
            {s.change_pct >= 0 ? '+' : ''}{s.change_pct}%
          </span>
        ),
      },
      {
        key: 'period_days',
        header: t('screener.advanced.performers.columns.days'),
        align: 'left',
        sortable: true,
        filterable: true,
        render: (s) => (
          <span className="font-mono text-xs text-muted-foreground">{s.period_days} يوم</span>
        ),
      },
      {
        key: 'end_volume',
        header: t('screener.advanced.performers.columns.volume'),
        align: 'left',
        sortable: true,
        filterable: true,
        render: (s) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatVolume(s.end_volume)}
          </span>
        ),
      },
    ],
    []
  );

  const toggleSort = (field: 'ticker' | 'start_price' | 'end_price' | 'change_pct' | 'period_days') => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const topPerformersShareText = useMemo(() => {
    return data ? generateTopPerformersText(data, t) : '';
  }, [data, t]);

  return (
    <div className="space-y-3">
      {/* Filters Card — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      <CollapsibleSection
        title={t('screener.advanced.performers.topPerformersTitle')}
        icon={<Trophy className="w-4 h-4 text-amber-600" />}
      >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <FilterField label={t('screener.advanced.performers.filters.period')}>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {getPeriods(t).map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label={t('screener.advanced.performers.filters.direction')}>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {getDirections(t).map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label={t('screener.advanced.performers.filters.market')}>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EGX">{t('screener.advanced.filters.egx')}</SelectItem>
                  <SelectItem value="ALL">{t('screener.advanced.filters.allMarkets')}</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label={t('screener.advanced.filters.resultCount')}>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>

          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border flex-wrap gap-2">
            <div className="text-xs text-muted-foreground">
              {t('screener.advanced.performers.periodLabel')} <span className="font-medium">{periodLabel}</span>
              {data && (
                <>
                  {' • ' + t('screener.advanced.performers.fromWord') + ' '}
                  <span className="font-mono">{data.start_date}</span>
                  {' ' + t('screener.advanced.performers.toWord') + ' '}
                  <span className="font-mono">{data.end_date}</span>
                </>
              )}
            </div>
             <Button variant="default" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              {t('screener.advanced.buttons.refresh')}
            </Button>
            <ExportDropdown shareText={topPerformersShareText} disabled={!topPerformersShareText} />
          </div>
      </CollapsibleSection>

      {/* Summary KPIs inline */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KPIBox label={t('screener.advanced.performers.kpi.totalStocks')} value={summary.total_stocks} />
          <KPIBox label={t('screener.advanced.performers.kpi.gainers')} value={summary.gainers} color="text-emerald-600" />
          <KPIBox label={t('screener.advanced.performers.kpi.losers')} value={summary.losers} color="text-red-600" />
          <KPIBox
            label={t('screener.advanced.performers.kpi.avgChange')}
            value={`${summary.avg_change >= 0 ? '+' : ''}${summary.avg_change}%`}
            color={summary.avg_change >= 0 ? 'text-emerald-600' : 'text-red-600'}
          />
        </div>
      )}

      {/* Best / Worst performer — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      {summary && (summary.best_performer || summary.worst_performer) && (
        <CollapsibleSection
          title={t('screener.advanced.performers.kpi.bestWorst')}
          icon={<Trophy className="w-4 h-4 text-amber-500" />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.best_performer && (
              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      {t('screener.advanced.performers.topGainer', { period: periodLabel })}
                    </span>
                  </div>
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => loadStockDetail(summary.best_performer!.ticker)}
                  >
                    <div>
                      <div className="font-mono font-bold text-lg">{summary.best_performer.ticker}</div>
                      <div className="text-xs text-muted-foreground">
                        {summary.best_performer.name_ar || summary.best_performer.name}
                        {summary.best_performer.sector && ` • ${summary.best_performer.sector}`}
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-emerald-600 font-mono font-bold text-xl">
                        +{summary.best_performer.change_pct}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatNumber(summary.best_performer.start_price)} → {formatNumber(summary.best_performer.end_price)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {summary.worst_performer && (
              <Card className="border-red-500/30 bg-red-500/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                      {t('screener.advanced.performers.topLoser', { period: periodLabel })}
                    </span>
                  </div>
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => loadStockDetail(summary.worst_performer!.ticker)}
                  >
                    <div>
                      <div className="font-mono font-bold text-lg">{summary.worst_performer.ticker}</div>
                      <div className="text-xs text-muted-foreground">
                        {summary.worst_performer.name_ar || summary.worst_performer.name}
                        {summary.worst_performer.sector && ` • ${summary.worst_performer.sector}`}
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-red-600 font-mono font-bold text-xl">
                        {summary.worst_performer.change_pct}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatNumber(summary.worst_performer.start_price)} → {formatNumber(summary.worst_performer.end_price)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Results Table — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      <CollapsibleSection
        title={t('screener.advanced.performers.filters.resultsTable')}
        icon={<BarChart3 className="w-4 h-4 text-emerald-600" />}
        contentClassName="p-0 space-y-0"
      >
        {loading && !data ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            {t('screener.advanced.loading.loadingPerformers')}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
            {error}
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                {t('screener.advanced.buttons.retry')}
              </Button>
            </div>
          </div>
        ) : sortedResults.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {t('screener.advanced.performers.empty')}
          </div>
        ) : (
          <UnifiedTable<TopPerformerStock>
            columns={topPerformerColumns}
            data={sortedResults}
            keyField="ticker"
            onRowClick={(row) => loadStockDetail(row.ticker)}
            dense
            maxHeight="max-h-[600px]"
            emptyTextAr={t('screener.advanced.performers.empty')}
            filterable
            columnToggle
          />
        )}
      </CollapsibleSection>

      {/* Footer hint */}
      <div className="text-xs text-muted-foreground text-center pt-1">
        {t('screener.advanced.performers.footer')}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FilterField({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs flex items-center gap-1">
        {label}
        {help && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3 h-3 text-muted-foreground/70 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-right">
                {help}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </Label>
      {children}
      {help && <p className="text-[10px] text-muted-foreground leading-tight">{help}</p>}
    </div>
  );
}

function CheckboxField({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5"
      />
      <div className="space-y-0.5 flex-1">
        <Label className="text-xs cursor-pointer" onClick={() => onChange(!checked)}>
          {label}
        </Label>
        {help && <p className="text-[10px] text-muted-foreground leading-tight">{help}</p>}
      </div>
    </div>
  );
}

function KPIBox({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="border border-border rounded-lg p-2 bg-card">
      <div className="text-[11px] text-muted-foreground truncate">{label}</div>
      <div className={cn('text-base font-bold font-mono', color)}>{value}</div>
    </div>
  );
}

// ─── WhatsApp icon (inline SVG — lucide has no WhatsApp export) ─────────────────

export function WhatsAppIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 01 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// ─── Reusable export dropdown (نص / WhatsApp / Facebook / CSV) ──────────────────

export interface ExportDropdownProps {
  shareText: string;
  disabled?: boolean;
  showCsv?: boolean;
  onExportCsv?: () => void;
}

export function ExportDropdown({
  shareText,
  disabled = false,
  showCsv = false,
  onExportCsv,
}: ExportDropdownProps) {
  const t = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopyText = useCallback(async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      toast.success(t('screener.advanced.toast.copyToClipboard'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('screener.advanced.toast.copyFailed'));
    }
  }, [shareText]);

  const handleShareWhatsApp = useCallback(() => {
    if (!shareText) return;
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank', 'width=600,height=400');
  }, [shareText]);

  const handleShareFacebook = useCallback(() => {
    if (!shareText) return;
    const platformUrl = encodeURIComponent(window.location.href);
    const quote = encodeURIComponent(shareText.slice(0, 200));
    const url = `https://www.facebook.com/sharer/sharer.php?u=${platformUrl}&quote=${quote}`;
    window.open(url, '_blank', 'width=600,height=400');
  }, [shareText]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={disabled}>
          <Download className="w-3.5 h-3.5" />
          {t('screener.advanced.buttons.export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" dir="rtl">
        <DropdownMenuLabel>{t('screener.advanced.share.exportResults')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopyText} className="gap-2 cursor-pointer">
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          {t('screener.advanced.share.copyText')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareWhatsApp} className="gap-2 cursor-pointer">
          <WhatsAppIcon className="w-4 h-4 text-[#25D366]" />
          {t('screener.advanced.share.whatsapp')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareFacebook} className="gap-2 cursor-pointer">
          <Facebook className="w-4 h-4 text-[#1877F2]" />
          {t('screener.advanced.share.facebook')}
        </DropdownMenuItem>
        {showCsv && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExportCsv} className="gap-2 cursor-pointer">
              <Download className="w-4 h-4" />
              CSV
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

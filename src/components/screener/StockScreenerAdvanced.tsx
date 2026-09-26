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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';

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

const STATE_LABELS_AR: Record<string, string> = {
  CORRECTION_END: 'التصحيح خلص',
  BALANCED_MOMENTUM: 'زخم متزن',
  NEAR_BREAKOUT: 'قرب يكسر',
  AT_PEAK: 'في قمة',
  NEAR_PEAK: 'قرب قمة',
  NEUTRAL: 'محايد',
  CORRECTION: 'في تصحيح',
  DECLINING: 'لسة نازل',
  INSUFFICIENT_DATA: 'بيانات غير كافية',
};

const STATE_EXPLANATIONS_AR: Record<string, string> = {
  CORRECTION_END: 'RSI بين 40-45 + فوق MA50 + صاعد اليوم — مؤشر تعافي بعد تصحيح.',
  BALANCED_MOMENTUM: 'RSI بين 55-65 + فوق MA50 — زخم صحي مستمر.',
  NEAR_BREAKOUT: 'السعر قرب من المتوسط من تحت (within 2%) — مرشح للكسر للأعلى.',
  AT_PEAK: 'RSI ≥ 70 — تشبع شرائي، قد يتراجع بعد القمة.',
  NEAR_PEAK: 'RSI بين 65-70 — قرب التشبع الشرائي، حذر.',
  NEUTRAL: 'RSI بين 45-55 + حجم تداول مناسب — بانتظار اتجاه واضح.',
  CORRECTION: 'RSI < 40 + تحت MA50 — في مرحلة تصحيح. لو RSI < 30 وقريب من أدنى 52 أسبوع → تشبع بيعي (قد يرتد).',
  DECLINING: 'RSI < 40 + تحت MA50 + نازل اليوم — لسه في هبوط.',
  INSUFFICIENT_DATA: 'بيانات غير كافية للتصنيف (RSI أو MA50 مفقود) — يحتاج تحديث البيانات.',
};

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
  const colorClass = STATE_BADGE_COLORS[state] || STATE_BADGE_COLORS.NEUTRAL;
  const label = STATE_LABELS_AR[state] || state;
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
                    <span className="hidden sm:inline">طي</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span className="hidden sm:inline">فرد</span>
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
  return v.toFixed(0);
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
): string {
  if (!stocks.length) return '';
  const header = `📊 فلاتر الأسهم المتقدمة — ${market === 'EGX' ? 'البورصة المصرية' : 'كل الأسواق'}${sector !== 'ALL' ? ` / ${sector}` : ''}`;
  const lines: string[] = [header, `📋 عدد النتائج: ${stocks.length}`, ''];
  stocks.forEach((s) => {
    const pct = s.change_percent > 0 ? '+' : '';
    lines.push(
      `• ${s.ticker} — ${s.name_ar || s.name}`,
      `  💰 السعر: ${formatNumber(s.current_price)} ج.م | ⚡ التغير: ${pct}${formatNumber(s.change_percent)}%`,
      `  📊 الحجم: ${formatVolume(s.volume)} | 💸 السيولة: ${formatEGP(s.turnover_egp)} ج.م`,
      `  📈 P/E: ${formatNumber(s.pe_ratio, 1)} | 🏦 ROE: ${s.roe !== null ? formatNumber(s.roe, 1) : '—'}% | 📍 RSI: ${formatNumber(s.rsi, 0)}`,
      `  🏷️ الحالة: ${s.stock_state_ar || s.stock_state} | 🔥 الزخم: ${s.momentum_score}`,
    );
  });
  lines.push('', '⚠️ هذا التحليل لأغراض تعليمية فقط — ليس نصيحة استثمارية', OFFICIAL_LINKS_BLOCK);
  return lines.join('\n');
}

function generateTopPerformersText(data: TopPerformersResponse): string {
  const results = data.results || [];
  if (!results.length) return '';
  const periodLabel = PERIODS.find((p) => p.value === data.period)?.label || data.period;
  const lines: string[] = [
    `🏆 أعلى الأرباح / الخسائر`,
    `📋 الفترة: ${periodLabel} (${data.direction === 'gainers' ? 'أرباح' : data.direction === 'losers' ? 'خسائر' : 'كل'}) | عدد النتائج: ${results.length}`,
    `📅 من ${data.start_date} إلى ${data.end_date}`,
    '',
  ];
  results.forEach((s) => {
    const pct = s.change_pct >= 0 ? '+' : '';
    lines.push(
      `• ${s.ticker} — ${s.name_ar || s.name}${s.sector ? ` (${s.sector})` : ''}`,
      `  💰 من ${formatNumber(s.start_price)} → ${formatNumber(s.end_price)} ج.م | ⚡ التغير: ${pct}${s.change_pct}%`,
      `  📅 الفترة: ${s.period_days} يوم`,
    );
  });
  lines.push('', '⚠️ هذا التحليل لأغراض تعليمية فقط — ليس نصيحة استثمارية', OFFICIAL_LINKS_BLOCK);
  return lines.join('\n');
}

// ─── Sort field types ────────────────────────────────────────────────────────

type SortField =
  | 'ticker' | 'current_price' | 'change_percent' | 'volume'
  | 'turnover_egp' | 'pe_ratio' | 'roe' | 'rsi' | 'stock_state'
  | 'momentum_score' | 'above_ma_50' | 'distance_from_52w_high';

type SortDir = 'asc' | 'desc';

// ─── Filter explanations (short Arabic text under each filter) ────────────────

const FILTER_HELP: Record<string, string> = {
  market: 'يحدد السوق المالي (EGX = البورصة المصرية).',
  sector: 'يحدد القطاع — اختر القطاع من القائمة أو الكل.',
  price: 'نطاق السعر (أدنى / أقصى) بالجنيه.',
  volume: 'الحد الأدنى لحجم التداول اليومي (عدد الأسهم المتداولة).',
  turnover: 'الحد الأدنى للسيولة (قيمة التداول بالجنيه = سعر × حجم).',
  trend: 'اتجاه التغير اليومي: صاعد (> 0)، هابط (< 0)، أو محايد (~ 0).',
  above_ma: 'فوق المتوسط المتحرك: MA50 (أوائل)، MA200 (طويل الأجل)، أو الاثنين.',
  rsi: 'مؤشر القوة النسبية: تشبع بيعي < 30 (قد يرتد)، تشبع شرائي > 70 (قد يتراجع).',
  volume_surge: 'الحجم أعلى من 1.5× متوسط الحجم — دخول سيولة محتمل.',
  near_52w_high: 'السعر ضمن 5% من أعلى 52 أسبوع — قرب اختبار القمة.',
  near_52w_low: 'السعر ضمن 5% من أدنى 52 أسبوع — قرب اختبار القاع.',
  pe: 'مكرر الربحية (P/E): نطاق القيمة. أقل = أرخص نسبياً.',
  roe: 'الحد الأدنى للعائد على حقوق الملكية (%) — أعلى = أفضل كفاءة.',
  dividend_yield: 'الحد الأدنى لتوزيعات الأرباح (%) — دخل منتظم.',
  market_cap: 'القيمة السوقية (ج.م): نطاق حجم الشركة.',
  stock_state: 'حالة السهم الفنية: انظر الشرح بجوار كل خيار.',
};

// ─── Period options (Tab 2 — Top Performers) ────────────────────────────────

const PERIODS = [
  { value: '1d', label: 'أمس (1 يوم)' },
  { value: '7d', label: 'أسبوع (7 أيام)' },
  { value: '15d', label: '15 يوم' },
  { value: '1m', label: 'شهر (30 يوم)' },
  { value: '3m', label: '3 شهور' },
  { value: '6m', label: '6 شهور' },
  { value: 'YTD', label: 'من أول السنة' },
  { value: '1y', label: 'عام كامل (365 يوم)' },
];

const DIRECTIONS = [
  { value: 'both', label: 'أعلى وأدنى' },
  { value: 'gainers', label: 'أعلى الأرباح' },
  { value: 'losers', label: 'أعلى الخسائر' },
];

// ─── Main component ──────────────────────────────────────────────────────────

interface StockScreenerAdvancedProps {
  initialTab?: 'advanced' | 'top-performers';
  initialMarket?: string;
}

export function StockScreenerAdvanced({ initialTab = 'advanced', initialMarket }: StockScreenerAdvancedProps) {
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
            فلاتر الأسهم المتقدمة
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            فلترة شاملة + تحديد حالة السهم الفنية (تصحيح / تعافي / قمة / قرب كسر)
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'advanced' | 'top-performers')} className="w-full">
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="advanced" className="gap-1.5">
            <Filter className="w-3.5 h-3.5" />
            الفلاتر المتقدمة
          </TabsTrigger>
          <TabsTrigger value="top-performers" className="gap-1.5">
            <Trophy className="w-3.5 h-3.5" />
            أعلى الأرباح / الخسائر
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
  const loadStockDetail = useAppStore((s) => s.loadStockDetail);

  // Filter state — لو initialMarket='CRYPTO' → ابدأ بـ CRYPTO
  const [market, setMarket] = useState(initialMarket || 'EGX');
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

  // Data state
  const [stocks, setStocks] = useState<ScreenerStock[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [summary, setSummary] = useState<ScreenerResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sort state (client-side header click sorting on top of server-side default sort)
  const [clientSortField, setClientSortField] = useState<SortField | null>(null);
  const [clientSortDir, setClientSortDir] = useState<SortDir>('desc');

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

      const res = await fetch(`/api/screener/advanced?${params}`, { cache: 'no-store' });
      const json: ScreenerResponse = await res.json();

      if (json.success) {
        setStocks(json.stocks || []);
        setSectors(json.sectors || []);
        setSummary(json.summary || null);
      } else {
        setError(json.error || 'فشل تحميل البيانات');
        toast.error(json.error || 'فشل تحميل البيانات');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطأ في الاتصال';
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
     toast.success('تم إعادة ضبط الفلاتر');
   };

   // Presets
   const presets = [
     {
       label: 'تعافي بعد تصحيح',
       icon: TrendingUp,
       color: 'emerald',
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
       label: 'زخم متزن',
       icon: Gauge,
       color: 'teal',
       apply: () => {
         setStockState('BALANCED_MOMENTUM');
         setAboveMa('above');
         setSort('turnover_egp');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: 'قرب كسر للأعلى',
       icon: Zap,
       color: 'amber',
       apply: () => {
         setNear52wHigh(true);
         setAboveMa('above');
         setSort('momentum_score');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: 'في قمة',
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
       label: 'أسهم نشطة',
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
       label: 'أسهم ميتة',
       icon: Snowflake,
       color: 'gray',
       apply: () => {
         setVolumeSurge(false);
         setMinVolume('10000');
         setMaxVolume('100000');
         setSort('volume');
         setOrder('asc');
         setLimit(100);
       },
     },
     {
       label: 'مقيّمة (PE منخفض)',
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
       label: 'تشبع بيعي',
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
       label: 'أسهم أرباح عالية',
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
       label: 'أسهم نمو',
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
       label: 'أسهم قيمة',
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
       label: 'كبار القيمة',
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
       label: 'سيولة عالية',
       icon: Activity,
       color: 'cyan',
       apply: () => {
         setMinTurnover('50000000');
         setMinVolume('1000000');
         setSort('turnover_egp');
         setOrder('desc');
         setLimit(200);
       },
     },
     {
       label: 'انخفاض حاد',
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
       label: 'قاع 52 أسبوع',
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
       label: 'أعلى 52 أسبوع',
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
       label: 'فوق المتوسطات',
       icon: TrendingUp,
       color: 'emerald',
       apply: () => {
         setAboveMa('above');
         setTrend('up');
         setSort('momentum_score');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: 'تحت المتوسطات',
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
       label: 'RSI معتدل',
       icon: Gauge,
       color: 'teal',
       apply: () => {
         setRsi('neutral');
         setStockState('BALANCED_MOMENTUM');
         setSort('rsi');
         setOrder('desc');
         setLimit(100);
       },
     },
     {
       label: 'فرص انعكاس',
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
       label: 'مستقرة (لا تذبذب)',
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
     toast.success(`تم تطبيق: ${preset.label}`);
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
  }, [stocks, searchQuery, clientSortField, clientSortDir]);

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

  // ── UnifiedTable columns for screener results ──
  const screenerColumns: Column<ScreenerStock>[] = useMemo(
    () => [
      {
        key: 'ticker',
        header: 'السهم',
        align: 'right',
        sortable: true,
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
        header: 'السعر',
        align: 'left',
        sortable: true,
        render: (s) => (
          <span className="font-mono text-sm">{formatNumber(s.current_price)}</span>
        ),
      },
      {
        key: 'change_percent',
        header: 'التغير %',
        align: 'left',
        sortable: true,
        render: (s) => (
          <span className={cn('font-mono text-sm font-medium', getChangeColor(s.change_percent))}>
            {s.change_percent > 0 ? '+' : ''}{formatNumber(s.change_percent)}%
          </span>
        ),
      },
      {
        key: 'sparkline',
        header: 'الرسم البياني',
        align: 'center',
        render: (s) => (
          <MiniSparkline ticker={s.ticker} height={24} width={80} showArea={false} />
        ),
      },
      {
        key: 'volume',
        header: 'الحجم',
        align: 'left',
        sortable: true,
        render: (s) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatVolume(s.volume)}
            {s.volume_surge && <Zap className="inline w-3 h-3 text-amber-500 mr-1" />}
          </span>
        ),
      },
      {
        key: 'turnover_egp',
        header: 'السيولة (ج.م)',
        align: 'left',
        sortable: true,
        render: (s) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatEGP(s.turnover_egp)}
          </span>
        ),
      },
      {
        key: 'pe_ratio',
        header: 'مكرر الربحية',
        align: 'left',
        sortable: true,
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
        render: (s) => (
          <span className="font-mono text-xs">
            {s.roe !== null ? formatNumber(s.roe, 1) : '—'}
          </span>
        ),
      },
      {
        key: 'rsi',
        header: 'RSI',
        align: 'left',
        sortable: true,
        render: (s) => (
          <span className="font-mono text-xs">
            {s.rsi !== null ? formatNumber(s.rsi, 0) : '—'}
          </span>
        ),
      },
      {
        key: 'stock_state',
        header: 'حالة السهم',
        align: 'right',
        sortable: true,
        render: (s) => <StateBadge state={s.stock_state} reason={s.stock_state_reason} />,
      },
      {
        key: 'above_ma_50',
        header: 'فوق MA50',
        align: 'center',
        sortable: true,
        render: (s) =>
          s.above_ma_50 ? (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-xs px-2 py-0.5">
              فوق
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs px-2 py-0.5">
              تحت
            </Badge>
          ),
      },
    ],
    []
  );

  // CSV export
  const exportCSV = () => {
    const headers = ['Ticker', 'Name', 'Sector', 'Price', 'Change%', 'Volume', 'Turnover', 'PE', 'ROE', 'RSI', 'State', 'Momentum'];
    const rows = filteredStocks.map(s => [
      s.ticker, s.name_ar || s.name, s.sector,
      s.current_price, s.change_percent, s.volume,
      s.turnover_egp,
      s.pe_ratio ?? '', s.roe ?? '',
      s.rsi ?? '',
      s.stock_state_ar || s.stock_state,
      s.momentum_score,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screener_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
     toast.success(`تم تصدير ${filteredStocks.length} سهم`);
   };

  const screenerShareText = useMemo(
    () => generateScreenerText(filteredStocks, market, sector),
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
          {showFilters ? 'إخفاء الفلاتر' : 'إظهار الفلاتر'}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            إعادة الضبط
          </Button>
          <ExportDropdown
            shareText={screenerShareText}
            disabled={!filteredStocks.length}
            showCsv
            onExportCsv={exportCSV}
          />
          <Button variant="default" size="sm" onClick={fetchScreener} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            تحديث
          </Button>
        </div>
      </div>

      {/* Presets — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      <CollapsibleSection
        title="فلاتر جاهزة"
        icon={<Zap className="w-4 h-4 text-amber-600" />}
      >
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => {
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
        </div>
      </CollapsibleSection>

      {/* Filters Panel — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      {showFilters && (
        <CollapsibleSection
          title="الفلاتر المتقدمة"
          icon={<Filter className="w-4 h-4" />}
        >
            {/* Search row */}
            <div className="relative max-w-sm">
              <Search className="absolute right-2 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو الرمز..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-8 h-9"
              />
            </div>

            {/* Grid of filters — 2 cols mobile, 3 sm, 4 lg */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Market */}
              <FilterField label="السوق" help={FILTER_HELP.market}>
                <Select value={market} onValueChange={setMarket}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EGX">البورصة المصرية</SelectItem>
                    <SelectItem value="ALL">كل الأسواق</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Sector */}
              <FilterField label="القطاع" help={FILTER_HELP.sector}>
                <Select value={sector} onValueChange={setSector}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">كل القطاعات</SelectItem>
                    {sectors.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Sort */}
              <FilterField label="ترتيب بـ">
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="turnover_egp">السيولة</SelectItem>
                    <SelectItem value="change_percent">نسبة التغير</SelectItem>
                    <SelectItem value="volume">الحجم</SelectItem>
                    <SelectItem value="market_cap">القيمة السوقية</SelectItem>
                    <SelectItem value="rsi">RSI</SelectItem>
                    <SelectItem value="pe_ratio">مكرر الربحية</SelectItem>
                    <SelectItem value="roe">العائد على الحقوق</SelectItem>
                    <SelectItem value="high_52w">أعلى 52 أسبوع</SelectItem>
                    <SelectItem value="low_52w">أدنى 52 أسبوع</SelectItem>
                    <SelectItem value="dividend_yield">توزيعات الأرباح</SelectItem>
                    <SelectItem value="momentum_score">الزخم (محسوب)</SelectItem>
                    <SelectItem value="stock_state">حالة السهم (محسوب)</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Order */}
              <FilterField label="اتجاه الترتيب">
                <Select value={order} onValueChange={(v) => setOrder(v as 'asc' | 'desc')}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">تنازلي (الأعلى أولاً)</SelectItem>
                    <SelectItem value="asc">تصاعدي (الأقل أولاً)</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Trend */}
              <FilterField label="الاتجاه اليومي" help={FILTER_HELP.trend}>
                <Select value={trend} onValueChange={setTrend}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="up">صاعد فقط (&gt; 0)</SelectItem>
                    <SelectItem value="down">هابط فقط (&lt; 0)</SelectItem>
                    <SelectItem value="neutral">محايد (~ 0)</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Above MA */}
              <FilterField label="فوق/تحت المتوسط" help={FILTER_HELP.above_ma}>
                <Select value={aboveMa} onValueChange={setAboveMa}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="50">فوق MA50 فقط</SelectItem>
                    <SelectItem value="200">فوق MA200 فقط</SelectItem>
                    <SelectItem value="both">فوق الاثنين</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* RSI */}
              <FilterField label="مؤشر RSI" help={FILTER_HELP.rsi}>
                <Select value={rsi} onValueChange={setRsi}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="oversold">تشبع بيعي (&lt; 30)</SelectItem>
                    <SelectItem value="overbought">تشبع شرائي (&gt; 70)</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Stock State */}
              <FilterField label="حالة السهم الفنية" help={FILTER_HELP.stock_state}>
                <Select value={stockState} onValueChange={setStockState}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">كل الحالات</SelectItem>
                    <SelectItem value="CORRECTION_END">التصحيح خلص (تعافي)</SelectItem>
                    <SelectItem value="BALANCED_MOMENTUM">زخم متزن</SelectItem>
                    <SelectItem value="NEAR_BREAKOUT">قرب يكسر (للأعلى)</SelectItem>
                    <SelectItem value="NEUTRAL">محايد</SelectItem>
                    <SelectItem value="NEAR_PEAK">قرب قمة</SelectItem>
                    <SelectItem value="AT_PEAK">في قمة</SelectItem>
                    <SelectItem value="CORRECTION">في تصحيح</SelectItem>
                    <SelectItem value="DECLINING">لسة نازل</SelectItem>
                    <SelectItem value="INSUFFICIENT_DATA">بيانات غير كافية</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {/* Min Price */}
              <FilterField label="أدنى سعر" help={FILTER_HELP.price}>
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
              <FilterField label="أقصى سعر" help={FILTER_HELP.price}>
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
              <FilterField label="أدنى حجم تداول" help={FILTER_HELP.volume}>
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
              <FilterField label="أدنى سيولة (ج.م)" help={FILTER_HELP.turnover}>
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
              <FilterField label="أدنى مكرر ربحية" help={FILTER_HELP.pe}>
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
              <FilterField label="أقصى مكرر ربحية" help={FILTER_HELP.pe}>
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
              <FilterField label="أدنى ROE (%)" help={FILTER_HELP.roe}>
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
              <FilterField label="أدنى توزيعات أرباح (%)" help={FILTER_HELP.dividend_yield}>
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
              <FilterField label="أدنى قيمة سوقية (ج.م)" help={FILTER_HELP.market_cap}>
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
              <FilterField label="أقصى قيمة سوقية (ج.م)" help={FILTER_HELP.market_cap}>
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
              <FilterField label="عدد النتائج">
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
                label="زخم الحجم (1.5× المتوسط)"
                help={FILTER_HELP.volume_surge}
                checked={volumeSurge}
                onChange={setVolumeSurge}
              />
              <CheckboxField
                label="قرب من أعلى 52 أسبوع"
                help={FILTER_HELP.near_52w_high}
                checked={near52wHigh}
                onChange={setNear52wHigh}
              />
              <CheckboxField
                label="قرب من أدنى 52 أسبوع"
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
                {showStateHelp ? 'إخفاء' : 'إظهار'} شرح حالات السهم السبع
              </button>
              {showStateHelp && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {Object.entries(STATE_EXPLANATIONS_AR).map(([key, text]) => (
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

      {/* Inline summary KPIs (no cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        <KPIBox label="إجمالي النتائج" value={summary?.total ?? filteredStocks.length} />
        <KPIBox label="صاعدة" value={summary?.advancers ?? 0} color="text-emerald-600" />
        <KPIBox label="هابطة" value={summary?.decliners ?? 0} color="text-red-600" />
        <KPIBox label="متوسط التغير" value={`${summary?.avg_change != null ? (summary.avg_change > 0 ? '+' : '') : ''}${(summary?.avg_change ?? 0).toFixed(2)}%`} color={summary && summary.avg_change >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <KPIBox label="إجمالي السيولة" value={`${formatEGP(summary?.total_turnover ?? 0)} ج.م`} />
        <KPIBox label="زخم الحجم" value={summary?.volume_surge_count ?? 0} color="text-amber-600" />
      </div>

      {/* Results Table — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      <CollapsibleSection
        title="نتائج الفلاتر"
        icon={<BarChart3 className="w-4 h-4 text-emerald-600" />}
        contentClassName="p-0 space-y-0"
      >
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            جاري تحميل الأسهم...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
            {error}
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={fetchScreener} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                إعادة المحاولة
              </Button>
            </div>
          </div>
        ) : filteredStocks.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
            لا توجد نتائج مطابقة للفلاتر الحالية
          </div>
        ) : (
          <UnifiedTable<ScreenerStock>
            columns={screenerColumns}
            data={filteredStocks}
            keyField="ticker"
            onRowClick={(row) => onRowClick(row.ticker)}
            dense
            maxHeight="max-h-[600px]"
            emptyTextAr="لا توجد نتائج مطابقة للفلاتر الحالية"
          />
        )}
      </CollapsibleSection>

      {/* Footer hint */}
      <div className="text-xs text-muted-foreground text-center pt-1">
        فلترة شاملة + تحديد حالة السهم الفنية — النتائج محدّثة تلقائياً
      </div>
    </div>
  );
}

// ─── Tab 2: Top Performers ───────────────────────────────────────────────────

function TopPerformersTab() {
  const loadStockDetail = useAppStore((s) => s.loadStockDetail);

  const [period, setPeriod] = useState('1m');
  const [direction, setDirection] = useState('both');
  const [market, setMarket] = useState('EGX');
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
        setError(json.error || json.hint || 'فشل في تحميل البيانات');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [period, direction, market, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const results = data?.results || [];
  const summary = data?.summary;
  const periodLabel = PERIODS.find((p) => p.value === period)?.label || period;

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
        header: 'السهم',
        align: 'right',
        sortable: true,
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
        header: 'القطاع',
        align: 'right',
        sortable: true,
        render: (s) => (
          <span className="text-xs text-muted-foreground">{s.sector || '—'}</span>
        ),
      },
      {
        key: 'start_price',
        header: 'سعر البداية',
        align: 'left',
        sortable: true,
        render: (s) => <span className="font-mono text-sm">{formatNumber(s.start_price)}</span>,
      },
      {
        key: 'end_price',
        header: 'سعر النهاية',
        align: 'left',
        sortable: true,
        render: (s) => <span className="font-mono text-sm">{formatNumber(s.end_price)}</span>,
      },
      {
        key: 'change_pct',
        header: 'التغير %',
        align: 'left',
        sortable: true,
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
        header: 'عدد الأيام',
        align: 'left',
        sortable: true,
        render: (s) => (
          <span className="font-mono text-xs text-muted-foreground">{s.period_days} يوم</span>
        ),
      },
      {
        key: 'end_volume',
        header: 'الحجم (نهاية)',
        align: 'left',
        sortable: true,
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
    return data ? generateTopPerformersText(data) : '';
  }, [data]);

  return (
    <div className="space-y-3">
      {/* Filters Card — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      <CollapsibleSection
        title="أعلى الأسهم أرباحاً / خسارة"
        icon={<Trophy className="w-4 h-4 text-amber-600" />}
      >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <FilterField label="الفترة">
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="النوع">
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIRECTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="السوق">
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EGX">البورصة المصرية</SelectItem>
                  <SelectItem value="ALL">كل الأسواق</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="عدد النتائج">
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
              الفترة: <span className="font-medium">{periodLabel}</span>
              {data && (
                <>
                  {' • من '}
                  <span className="font-mono">{data.start_date}</span>
                  {' إلى '}
                  <span className="font-mono">{data.end_date}</span>
                </>
              )}
            </div>
             <Button variant="default" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              تحديث
            </Button>
            <ExportDropdown shareText={topPerformersShareText} disabled={!topPerformersShareText} />
          </div>
      </CollapsibleSection>

      {/* Summary KPIs inline */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KPIBox label="إجمالي الأسهم" value={summary.total_stocks} />
          <KPIBox label="الرابحة" value={summary.gainers} color="text-emerald-600" />
          <KPIBox label="الخاسرة" value={summary.losers} color="text-red-600" />
          <KPIBox
            label="متوسط التغير"
            value={`${summary.avg_change >= 0 ? '+' : ''}${summary.avg_change}%`}
            color={summary.avg_change >= 0 ? 'text-emerald-600' : 'text-red-600'}
          />
        </div>
      )}

      {/* Best / Worst performer — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      {summary && (summary.best_performer || summary.worst_performer) && (
        <CollapsibleSection
          title="الأفضل والأ أسوأ سهم"
          icon={<Trophy className="w-4 h-4 text-amber-500" />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.best_performer && (
              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      الأعلى ربحاً — {periodLabel}
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
                      الأعلى خسارة — {periodLabel}
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
        title="جدول النتائج"
        icon={<BarChart3 className="w-4 h-4 text-emerald-600" />}
        contentClassName="p-0 space-y-0"
      >
        {loading && !data ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            جاري تحميل أعلى الأسهم أرباحاً / خسارة...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
            {error}
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                إعادة المحاولة
              </Button>
            </div>
          </div>
        ) : sortedResults.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            لا توجد نتائج للفلاتر الحالية
          </div>
        ) : (
          <UnifiedTable<TopPerformerStock>
            columns={topPerformerColumns}
            data={sortedResults}
            keyField="ticker"
            onRowClick={(row) => loadStockDetail(row.ticker)}
            dense
            maxHeight="max-h-[600px]"
            emptyTextAr="لا توجد نتائج للفلاتر الحالية"
          />
        )}
      </CollapsibleSection>

      {/* Footer hint */}
      <div className="text-xs text-muted-foreground text-center pt-1">
        أعلى الأرباح والخسائر — النتائج محدّثة تلقائياً
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
  const [copied, setCopied] = useState(false);

  const handleCopyText = useCallback(async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      toast.success('تم نسخ النص إلى الحافظة');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('فشل نسخ النص');
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
          تصدير
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" dir="rtl">
        <DropdownMenuLabel>تصدير النتائج</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopyText} className="gap-2 cursor-pointer">
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          نسخ النص
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareWhatsApp} className="gap-2 cursor-pointer">
          <WhatsAppIcon className="w-4 h-4 text-[#25D366]" />
          واتساب
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareFacebook} className="gap-2 cursor-pointer">
          <Facebook className="w-4 h-4 text-[#1877F2]" />
          فيسبوك
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

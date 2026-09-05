'use client';

// ============================================================================
// رادار الميكرز — Professional Client-Facing Maker Radar
// ============================================================================
// Source of truth:
//   • GET /api/maker-radar?market=EGX           → main radar lists
//   • GET /api/maker-radar/stock?ticker=X&days=30 → stock detail drawer
//   • GET /api/stocks?market=EGX&page_size=1000 → ticker→sector/fundamentals map
//   • POST /api/maker-radar/track                → tracking management
//
// The component auto-refreshes every 60s while the EGX market is open and the
// tab is visible (useVisibilityAwarePolling). All UI is RTL Arabic, shadcn-based.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Radar, RefreshCw, Eye, Flame, TrendingUp, TrendingDown,
  Activity, AlertTriangle, Star, StarOff, X, ChevronLeft,
  Layers, Target, Zap, Gauge, Award, Crosshair, Clock,
  BarChart3, Sparkles, Eye as MicroscopeIcon, Flame as FlameIcon,
  Rocket, ArrowUpRight, ArrowDownRight, ShieldCheck, Info,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { useAppStore } from '@/lib/store';
import { getMarketStatus } from '@/lib/market-hours';
import {
  Dialog, DialogContent, DialogClose, DialogTitle,
} from '@/components/ui/dialog';

// ============================================================================
// Types — Maker Radar API contract
// ============================================================================
type RadarPath =
  | 'A_pre_surge'
  | 'B_quiet_accumulation_strong'
  | 'C_quiet_accumulation_weak'
  | 'D_explosive_surge'
  | 'E_early_break';

interface QuietDetails {
  signal_count: number;
  signals_met: string[];
  signals_failed: string[];
  days_high_volume?: number;
  avg_20_vol?: number;
  buy_pressure_days?: number;
  range_10d_pct?: number;
  avg_vol_ratio?: number;
  roc_10d?: number;
  distribution_days?: number;
}

interface PreSurgeDetails {
  signal_count: number;
  signals_met: string[];
  signals_failed: string[];
  volume_gradient?: number;
  range_10d_pct?: number;
  buy_days_7?: number;
  distance_from_ma10_pct?: number;
}

interface ExplosiveDetails {
  vol_ratio: number;
  sma20: number;
  price_vs_sma20: number;
  range_pct: number;
  range_compressed: boolean;
}

interface RadarStock {
  ticker: string;
  current_price: number;
  price_bucket: 'low_price' | 'mid_price' | 'high_price';
  avg_turnover_20d: number;
  avg_volume_20d: number;
  avg_volume_10d: number;
  volume_ratio_10d_vs_20d: number;
  price_stability: number;
  range_10d_pct: number;
  roc_10d: number | null;
  path: RadarPath;
  position_size: number;
  reason: string;
  quiet_details?: QuietDetails | null;
  pre_surge_details?: PreSurgeDetails | null;
  explosive_details?: ExplosiveDetails | null;
  break_reason?: string | null;
  isTracked?: boolean;
  trackingEntryDate?: string;
  trackingEntryPrice?: number;
  changeSinceTracking?: number;
}

interface MakerRadarResponse {
  success: boolean;
  market?: string;
  min_quiet_signals?: number;
  min_price?: number;
  total_scanned?: number;
  under_microscope_count?: number;
  quiet_count?: number;
  pre_surge_count?: number;
  explosive_count?: number;
  early_break_count?: number;
  quiet_list?: RadarStock[];
  pre_surge_list?: RadarStock[];
  explosive_list?: RadarStock[];
  early_break_list?: RadarStock[];
  tracked_count?: number;
  tracked_tickers?: string[];
  generated_at?: string;
  cached?: boolean;
  cache_age_seconds?: number;
  error?: string;
}

interface PriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

interface StockStats {
  lastClose: number;
  changePct: number;
  roc10d: number;
  avgVolume20: number;
  avgTurnover20: number;
  max20: number;
  min20: number;
  range20Pct: number;
  dataPoints: number;
}

interface StockInfoRow {
  ticker: string;
  name?: string;
  name_ar?: string;
  sector?: string | null;
  industry?: string | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  pb_ratio?: number | null;
  ps_ratio?: number | null;
  eps?: number | null;
  roe?: number | null;
  roa?: number | null;
  dividend_yield?: number | null;
  support?: number | null;
  resistance?: number | null;
  change_percent?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
}

interface StockDetail {
  success: boolean;
  ticker: string;
  stock_info?: StockInfoRow | null;
  prices?: PriceRow[];
  stats?: StockStats;
  tracking?: {
    isTracked: boolean;
    entryDate?: string;
    entryPrice?: number;
    currentPrice?: number;
    changeSinceTracking?: number;
    daysTracked?: number;
  } | null;
}

interface StockListItem {
  ticker: string;
  name?: string;
  name_ar?: string;
  sector?: string | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  pb_ratio?: number | null;
  roe?: number | null;
  eps?: number | null;
  change_percent?: number | null;
  dividend_yield?: number | null;
  support?: number | null;
  resistance?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  current_price?: number | null;
}

interface StocksListResponse {
  success: boolean;
  stocks?: StockListItem[];
  total?: number;
}

interface SectorAgg {
  sector: string;
  avgChange: number;
  advancers: number;
  decliners: number;
  totalStocks: number;
  totalTurnover: number;
  marketCapSum: number;
}

// ============================================================================
// Helpers — formatting & colors
// ============================================================================
const fmtNum = (n: number | null | undefined, digits = 2): string => {
  if (n == null || isNaN(n as number)) return '-';
  const num = Number(n);
  return num.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
};

const fmtMoney = (n: number | null | undefined): string => {
  if (n == null || isNaN(n as number)) return '-';
  const num = Number(n);
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toFixed(0);
};

const fmtPct = (n: number | null | undefined, withSign = true): string => {
  if (n == null || isNaN(n as number)) return '-';
  const num = Number(n);
  const sign = withSign && num > 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
};

const pnlColorClass = (pnl: number | null | undefined): string => {
  if (pnl == null || pnl === 0) return 'text-muted-foreground';
  return pnl > 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400';
};

const bucketLabel: Record<string, string> = {
  low_price: 'رخيص',
  mid_price: 'وسط',
  high_price: 'غالي',
};

const pathMeta: Record<RadarPath, { ar: string; short: string; accent: AccentKey; icon: React.ReactNode }> = {
  A_pre_surge: {
    ar: 'Pre-Surge (تجميع مبكر)',
    short: 'Pre-Surge',
    accent: 'purple',
    icon: <Rocket className="h-4 w-4" />,
  },
  B_quiet_accumulation_strong: {
    ar: 'تحت الميكروسكوب',
    short: 'ميكروسكوب',
    accent: 'amber',
    icon: <Eye className="h-4 w-4" />,
  },
  C_quiet_accumulation_weak: {
    ar: 'تجميع ضعيف',
    short: 'ضعيف',
    accent: 'amber',
    icon: <Eye className="h-4 w-4" />,
  },
  D_explosive_surge: {
    ar: 'موجة انفجارية',
    short: 'منفجر',
    accent: 'rose',
    icon: <Flame className="h-4 w-4" />,
  },
  E_early_break: {
    ar: 'اختراق مبكر',
    short: 'اختراق',
    accent: 'emerald',
    icon: <Zap className="h-4 w-4" />,
  },
};

type AccentKey = 'amber' | 'rose' | 'emerald' | 'purple';

const accentClasses: Record<AccentKey, {
  card: string;
  headerBg: string;
  iconColor: string;
  badge: string;
  border: string;
  softBg: string;
}> = {
  amber: {
    card: 'border-amber-200 dark:border-amber-900/40',
    headerBg: 'bg-amber-50/60 dark:bg-amber-950/20',
    iconColor: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    border: 'border-amber-300 dark:border-amber-800/50',
    softBg: 'bg-amber-50/50 dark:bg-amber-950/10',
  },
  rose: {
    card: 'border-rose-200 dark:border-rose-900/40',
    headerBg: 'bg-rose-50/60 dark:bg-rose-950/20',
    iconColor: 'text-rose-600 dark:text-rose-400',
    badge: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
    border: 'border-rose-300 dark:border-rose-800/50',
    softBg: 'bg-rose-50/50 dark:bg-rose-950/10',
  },
  emerald: {
    card: 'border-emerald-200 dark:border-emerald-900/40',
    headerBg: 'bg-emerald-50/60 dark:bg-emerald-950/20',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    border: 'border-emerald-300 dark:border-emerald-800/50',
    softBg: 'bg-emerald-50/50 dark:bg-emerald-950/10',
  },
  purple: {
    card: 'border-purple-200 dark:border-purple-900/40',
    headerBg: 'bg-purple-50/60 dark:bg-purple-950/20',
    iconColor: 'text-purple-600 dark:text-purple-400',
    badge: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800',
    border: 'border-purple-300 dark:border-purple-800/50',
    softBg: 'bg-purple-50/50 dark:bg-purple-950/10',
  },
};

// Translate signal strings (e.g. "1.volume_high_recurring(4/3)") to short Arabic labels
const SIGNAL_AR: Record<string, string> = {
  volume_high_recurring: 'حجم متكرر',
  buy_pressure: 'ضغط شرائي',
  compressed: 'ضغط نطاق',
  volume_not_low: 'حجم صحي',
  not_explosive: 'غير منفجر',
  no_distribution: 'لا توزيع',
  volume_gradient: 'تصاعد حجم',
  range_compressed: 'نطاق مضغوط',
  near_ma10: 'قرب MA10',
  buy_days: 'أيام شراء',
};

const shortSignal = (s: string): string => {
  // 1.volume_high_recurring(4/3) → "حجم متكرر (4/3)"
  const m = s.match(/^\d+\.([a-z_]+)\(([^)]+)\)$/i);
  if (m) {
    const key = m[1];
    const detail = m[2];
    return `${SIGNAL_AR[key] || key} (${detail})`;
  }
  return s;
};

// Compute entry/stop/target from current price using the system's risk rules
// (8% hard stop, 16-20% target → 2-2.5R)
const computeTradePlan = (price: number, support?: number | null, resistance?: number | null) => {
  if (!price || price <= 0) return null;
  const entry = price;
  const stop = Math.max(0, price * 0.92); // -8% hard stop (matches enforce_stop_loss)
  const target = price * 1.20;            // +20% (2.5R)
  const riskPerShare = entry - stop;
  const rewardPerShare = target - entry;
  const rr = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;
  return {
    entry,
    stop,
    target,
    rr,
    riskPct: ((entry - stop) / entry) * 100,
    rewardPct: ((target - entry) / entry) * 100,
  };
};

// ============================================================================
// Backtest / proof constants (from scripts/output/retroactive_radar_test_*.json)
// These are static-shown metrics. Live values would require a separate API.
// ============================================================================
const PROOF_METRICS = {
  total_detections: 3265,
  target_hits: 790,
  precision: 24.20,
  explosive_moves: 555,
  detected_explosive: 117,
  recall: 21.08,
  avg_rr: 0.014,
  lookforward: 10,
  surge_threshold: 15,
};

// ============================================================================
// Main Component
// ============================================================================
interface MakerRadarTabProps {
  market?: string;
}

type FilterKey = 'all' | 'pre_surge' | 'quiet' | 'explosive' | 'early_break' | 'tracked';

export function MakerRadarTab({ market = 'EGX' }: MakerRadarTabProps) {
  const [data, setData] = useState<MakerRadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Stock universe (ticker → sector / fundamentals) — fetched once per market
  const [stockMap, setStockMap] = useState<Map<string, StockListItem> | null>(null);

  // --------------------------------------------------------------------
  // Fetchers
  // --------------------------------------------------------------------
  const fetchData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    if (!silent) setError(null);
    try {
      const params = new URLSearchParams({
        market,
        minQuietSignals: '5',
        minPrice: '1.0',
      });
      const res = await fetch(`/api/maker-radar?${params}`, { cache: 'no-store' });
      const json: MakerRadarResponse = await res.json();
      // The API cache layer sometimes omits the `success` flag — treat presence of
      // any radar list as success.
      const hasData = json.success || Array.isArray(json.quiet_list) || Array.isArray(json.explosive_list);
      if (hasData) {
        setData({ ...json, success: true });
        setLastUpdated(new Date());
      } else {
        setError(json.error || 'فشل في تحميل بيانات الرادار');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [market]);

  const fetchStockMap = useCallback(async () => {
    try {
      const res = await fetch(`/api/stocks?market=${market}&page_size=1000`, { cache: 'no-store' });
      const json: StocksListResponse = await res.json();
      if (json.success && Array.isArray(json.stocks)) {
        const map = new Map<string, StockListItem>();
        for (const s of json.stocks) {
          if (s && s.ticker) map.set(s.ticker.toUpperCase(), s);
        }
        setStockMap(map);
      }
    } catch {
      // silent — sector strip will just hide
    }
  }, [market]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchStockMap(); }, [fetchStockMap]);

  useVisibilityAwarePolling(
    () => fetchData(true),
    60_000,
    [fetchData],
    { market, allowOffMarket: false },
  );

  const handleTrackToggle = useCallback(async (ticker: string, currentPrice: number, isTracked: boolean) => {
    try {
      const res = await fetch('/api/maker-radar/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          entryPrice: currentPrice,
          action: isTracked ? 'remove' : 'add',
          notes: 'tracked from maker radar tab',
        }),
      });
      const json = await res.json();
      if (json.success) {
        fetchData(true);
      }
    } catch (e) {
      console.error('track toggle error:', e);
    }
  }, [fetchData]);

  // --------------------------------------------------------------------
  // Derived data — sector heat strip (client-side aggregation)
  // --------------------------------------------------------------------
  const sectors = useMemo<SectorAgg[]>(() => {
    if (!stockMap || stockMap.size === 0) return [];
    const agg = new Map<string, SectorAgg>();
    for (const s of stockMap.values()) {
      const sector = s.sector || 'غير مصنف';
      if (!agg.has(sector)) {
        agg.set(sector, {
          sector,
          avgChange: 0,
          advancers: 0,
          decliners: 0,
          totalStocks: 0,
          totalTurnover: 0,
          marketCapSum: 0,
        });
      }
      const entry = agg.get(sector)!;
      const chg = typeof s.change_percent === 'number' ? s.change_percent : null;
      if (chg != null) {
        entry.avgChange += chg;
        if (chg > 0) entry.advancers += 1;
        else if (chg < 0) entry.decliners += 1;
      }
      entry.totalStocks += 1;
    }
    const list: SectorAgg[] = [];
    for (const v of agg.values()) {
      if (v.totalStocks === 0) continue;
      v.avgChange = v.avgChange / v.totalStocks;
      list.push(v);
    }
    list.sort((a, b) => b.avgChange - a.avgChange);
    return list;
  }, [stockMap]);

  const sectorForTicker = useCallback((ticker: string): string | null => {
    if (!stockMap) return null;
    return stockMap.get(ticker.toUpperCase())?.sector || null;
  }, [stockMap]);

  const marketStatus = getMarketStatus(market);

  // --------------------------------------------------------------------
  // Filtering
  // --------------------------------------------------------------------
  const filteredPreSurge = useMemo(() => {
    const list = data?.pre_surge_list || [];
    if (filter === 'all' || filter === 'pre_surge') return list;
    if (filter === 'tracked') return list.filter((s) => s.isTracked);
    return [];
  }, [data, filter]);

  const filteredQuiet = useMemo(() => {
    const list = data?.quiet_list || [];
    if (filter === 'all' || filter === 'quiet') return list;
    if (filter === 'tracked') return list.filter((s) => s.isTracked);
    return [];
  }, [data, filter]);

  const filteredExplosive = useMemo(() => {
    const list = data?.explosive_list || [];
    if (filter === 'all' || filter === 'explosive') return list;
    if (filter === 'tracked') return list.filter((s) => s.isTracked);
    return [];
  }, [data, filter]);

  const filteredEarlyBreak = useMemo(() => {
    const list = data?.early_break_list || [];
    if (filter === 'all' || filter === 'early_break') return list;
    if (filter === 'tracked') return list.filter((s) => s.isTracked);
    return [];
  }, [data, filter]);

  // --------------------------------------------------------------------
  // Loading / error states
  // --------------------------------------------------------------------
  if (loading && !data) {
    return (
      <div className="space-y-3 p-4" dir="rtl">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-6 text-center" dir="rtl">
        <AlertTriangle className="h-10 w-10 text-rose-500 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground mb-3">{error}</p>
        <Button size="sm" onClick={() => fetchData()}>
          <RefreshCw className="h-4 w-4 ml-1" /> إعادة المحاولة
        </Button>
      </Card>
    );
  }

  const totalCardsShown =
    filteredPreSurge.length + filteredQuiet.length +
    filteredExplosive.length + filteredEarlyBreak.length;

  return (
    <div className="space-y-4" dir="rtl">
      {/* ===== HEADER ===== */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-l from-emerald-50/80 via-emerald-50/30 to-transparent dark:from-emerald-950/30 dark:to-transparent p-4 md:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="h-12 w-12 rounded-xl bg-emerald-600/10 dark:bg-emerald-400/10 flex items-center justify-center">
                  <Radar className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                {marketStatus.isOpen && (
                  <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 animate-pulse border-2 border-background" />
                )}
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
                  رادار الميكرز
                  <Badge
                    variant="outline"
                    className={
                      marketStatus.isOpen
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 text-[10px]'
                        : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 text-[10px]'
                    }
                  >
                    <span className={`h-1.5 w-1.5 rounded-full mr-1 ${marketStatus.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                    {marketStatus.isOpen ? 'LIVE' : 'السوق مقفول'}
                  </Badge>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  اكتشف الأسهم قبل ما تنفجر — بيانات حية
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {lastUpdated && (
                <span className="text-xs text-muted-foreground">
                  آخر تحديث: {lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {data?.cached && (
                <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200 dark:text-amber-400">
                  cache {data.cache_age_seconds}s
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => fetchData(true)}
                disabled={refreshing || loading}
                className="h-8"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline mr-1">تحديث</span>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* ===== KPI CARDS ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<Activity className="h-4 w-4" />}
          label="إجمالي الأسهم المفحوصة"
          value={data?.total_scanned ?? 0}
          sub="مسح يومي شامل"
          accent="blue"
        />
        <KpiCard
          icon={<MicroscopeIcon className="h-4 w-4" />}
          label="تحت الميكروسكوب"
          value={data?.under_microscope_count ?? 0}
          sub={`${data?.quiet_count ?? 0} تجميع هادئ`}
          accent="amber"
        />
        <KpiCard
          icon={<FlameIcon className="h-4 w-4" />}
          label="موجات منفجرة"
          value={data?.explosive_count ?? 0}
          sub={`${data?.early_break_count ?? 0} اختراق مبكر`}
          accent="rose"
        />
        <KpiCard
          icon={<Star className="h-4 w-4" />}
          label="أسهم متابَعة"
          value={data?.tracked_count ?? 0}
          sub="في قائمتك"
          accent="gold"
        />
      </div>

      {/* ===== SECTOR HEAT STRIP ===== */}
      <SectorHeatStrip sectors={sectors} loading={!stockMap} />

      {/* ===== FILTER BAR ===== */}
      <Card className="p-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground ml-1">فلترة:</span>
          {([
            { key: 'all', label: 'الكل', emoji: null },
            { key: 'pre_surge', label: 'Pre-Surge', emoji: '🚀' },
            { key: 'quiet', label: 'ميكروسكوب', emoji: '🎯' },
            { key: 'explosive', label: 'منفجرة', emoji: '🔥' },
            { key: 'early_break', label: 'اختراق', emoji: '⚡' },
            { key: 'tracked', label: 'متابَعة', emoji: '⭐' },
          ] as const).map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setFilter(f.key)}
            >
              {f.emoji && <span className="ml-1">{f.emoji}</span>}
              {f.label}
              {f.key === 'tracked' && data?.tracked_count ? (
                <Badge variant="secondary" className="mr-1 h-4 text-[10px] px-1">{data.tracked_count}</Badge>
              ) : null}
            </Button>
          ))}
        </div>
      </Card>

      {/* ===== STOCK SECTIONS ===== */}

      {/* Pre-Surge (purple) */}
      {(filter === 'all' || filter === 'pre_surge' || filter === 'tracked') && filteredPreSurge.length > 0 && (
        <RadarSection
          title="🚀 Pre-Surge — متوقعة الانفجار"
          subtitle="أعلى أولوية — السهم بيتجمع قبل الانفجار"
          icon={<Rocket className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
          accent="purple"
          stocks={filteredPreSurge}
          sectorForTicker={sectorForTicker}
          onSelect={setSelectedTicker}
          onTrackToggle={handleTrackToggle}
        />
      )}

      {/* Explosive (rose) */}
      {(filter === 'all' || filter === 'explosive' || filter === 'tracked') && filteredExplosive.length > 0 && (
        <RadarSection
          title="🔥 الأسهم المنفجرة الآن"
          subtitle="حجم فجائي + حركة قوية — تنبيه فوري"
          icon={<Flame className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
          accent="rose"
          stocks={filteredExplosive}
          sectorForTicker={sectorForTicker}
          onSelect={setSelectedTicker}
          onTrackToggle={handleTrackToggle}
        />
      )}

      {/* Quiet accumulation (amber) */}
      {(filter === 'all' || filter === 'quiet' || filter === 'tracked') && filteredQuiet.length > 0 && (
        <RadarSection
          title="🎯 تحت الميكروسكوب"
          subtitle="تجميع هادئ — أسهم بتتراكم قبل ما تنفجر"
          icon={<Eye className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          accent="amber"
          stocks={filteredQuiet}
          sectorForTicker={sectorForTicker}
          onSelect={setSelectedTicker}
          onTrackToggle={handleTrackToggle}
        />
      )}

      {/* Early break (emerald) */}
      {(filter === 'all' || filter === 'early_break' || filter === 'tracked') && filteredEarlyBreak.length > 0 && (
        <RadarSection
          title="⚡ اختراق مبكر"
          subtitle="خروج من نطاق ضيق بحجم — أول إشارة اختراق"
          icon={<Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          accent="emerald"
          stocks={filteredEarlyBreak}
          sectorForTicker={sectorForTicker}
          onSelect={setSelectedTicker}
          onTrackToggle={handleTrackToggle}
        />
      )}

      {/* Empty state */}
      {totalCardsShown === 0 && (
        <Card className="p-8 text-center">
          <Radar className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">مفيش أسهم مطابقة للفلتر الحالي</p>
          <p className="text-xs text-muted-foreground mt-1">جرّب فلتر تاني أو حدّث بعد شوية</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setFilter('all')}>
            عرض الكل
          </Button>
        </Card>
      )}

      {/* ===== PROOF SECTION (collapsible) ===== */}
      <ProofSection />

      {/* ===== Stock Detail Drawer (Dialog) ===== */}
      <Dialog open={!!selectedTicker} onOpenChange={(open) => { if (!open) setSelectedTicker(null); }}>
        <DialogContent
          className="max-w-[95vw] w-full h-[92vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg sm:max-w-3xl"
          showCloseButton={false}
        >
          {selectedTicker && (
            <StockDetailDrawer
              ticker={selectedTicker}
              sectorForTicker={sectorForTicker}
              sectorChangeForTicker={(t) => {
                const sec = sectorForTicker(t);
                if (!sec) return null;
                const agg = sectors.find((s) => s.sector === sec);
                return agg?.avgChange ?? null;
              }}
              onClose={() => setSelectedTicker(null)}
              onTrackToggle={handleTrackToggle}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// KPI Card
// ============================================================================
interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  accent: 'blue' | 'amber' | 'rose' | 'emerald' | 'gold';
}

function KpiCard({ icon, label, value, sub, accent }: KpiCardProps) {
  const colors: Record<KpiCardProps['accent'], { bg: string; text: string; ring: string }> = {
    blue:   { bg: 'bg-blue-50 dark:bg-blue-950/40',     text: 'text-blue-600 dark:text-blue-400',     ring: 'ring-blue-100 dark:ring-blue-900/40' },
    amber:  { bg: 'bg-amber-50 dark:bg-amber-950/40',  text: 'text-amber-600 dark:text-amber-400',   ring: 'ring-amber-100 dark:ring-amber-900/40' },
    rose:   { bg: 'bg-rose-50 dark:bg-rose-950/40',    text: 'text-rose-600 dark:text-rose-400',     ring: 'ring-rose-100 dark:ring-rose-900/40' },
    emerald:{ bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-100 dark:ring-emerald-900/40' },
    gold:   { bg: 'bg-yellow-50 dark:bg-yellow-950/40', text: 'text-yellow-600 dark:text-yellow-400', ring: 'ring-yellow-100 dark:ring-yellow-900/40' },
  };
  const c = colors[accent];
  return (
    <Card className="p-3 relative overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-muted-foreground mb-1 truncate">{label}</div>
          <div className={`text-2xl font-bold ${c.text}`}>{value.toLocaleString('en-US')}</div>
          {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
        </div>
        <div className={`h-9 w-9 rounded-lg ${c.bg} flex items-center justify-center flex-shrink-0`}>
          <div className={c.text}>{icon}</div>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Sector Heat Strip (horizontal scrollable pills)
// ============================================================================
interface SectorHeatStripProps {
  sectors: SectorAgg[];
  loading: boolean;
}

function SectorHeatStrip({ sectors, loading }: SectorHeatStripProps) {
  if (loading) {
    return (
      <Card className="p-2">
        <div className="flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <Skeleton className="h-6 w-40" />
          <div className="flex gap-2 overflow-hidden">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-7 w-24 rounded-md" />)}
          </div>
        </div>
      </Card>
    );
  }

  if (sectors.length === 0) return null;

  return (
    <Card className="p-2">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap pl-1">
          <Layers className="h-4 w-4" />
          <span className="hidden sm:inline">خريطة القطاعات</span>
        </div>
        <ScrollArea className="flex-1 w-full" orientation="horizontal">
          <div className="flex items-center gap-1.5 px-1 pb-1 min-w-max">
            {sectors.map((s) => {
              const chg = s.avgChange;
              const cls =
                chg > 2 ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800' :
                chg > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50' :
                chg === 0 ? 'bg-muted text-muted-foreground border-muted' :
                chg > -2 ? 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50' :
                'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800';
              return (
                <div
                  key={s.sector}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs ${cls}`}
                  title={`${s.sector} · ${s.totalStocks} سهم · صاعد ${s.advancers} · هابط ${s.decliners}`}
                >
                  <span className="font-medium truncate max-w-[120px]">{s.sector}</span>
                  <span className="font-mono font-bold">
                    {chg > 0 ? '+' : ''}{chg.toFixed(1)}%
                  </span>
                  <span className="text-[9px] opacity-70 hidden md:inline">{s.totalStocks}</span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}

// ============================================================================
// Radar Section (group of stock cards)
// ============================================================================
interface RadarSectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: AccentKey;
  stocks: RadarStock[];
  sectorForTicker: (ticker: string) => string | null;
  onSelect: (ticker: string) => void;
  onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

function RadarSection({
  title, subtitle, icon, accent, stocks,
  sectorForTicker, onSelect, onTrackToggle,
}: RadarSectionProps) {
  const a = accentClasses[accent];
  return (
    <Card className={`overflow-hidden ${a.card}`}>
      <div className={`flex items-center justify-between p-3 md:p-4 ${a.headerBg} border-b ${a.border}`}>
        <div className="flex items-center gap-2">
          <div className={`${a.iconColor}`}>{icon}</div>
          <div>
            <h4 className="text-sm md:text-base font-semibold">{title}</h4>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Badge variant="secondary" className="text-xs">
          {stocks.length} سهم
        </Badge>
      </div>

      <div className="p-3 md:p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {stocks.map((stock) => (
            <StockCard
              key={stock.ticker}
              stock={stock}
              sector={sectorForTicker(stock.ticker)}
              accent={accent}
              onSelect={() => onSelect(stock.ticker)}
              onTrackToggle={() => onTrackToggle(stock.ticker, stock.current_price, !!stock.isTracked)}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Stock Card
// ============================================================================
interface StockCardProps {
  stock: RadarStock;
  sector: string | null;
  accent: AccentKey;
  onSelect: () => void;
  onTrackToggle: () => void;
}

function StockCard({ stock, sector, accent, onSelect, onTrackToggle }: StockCardProps) {
  const a = accentClasses[accent];
  const meta = pathMeta[stock.path];

  const volRatio = stock.volume_ratio_10d_vs_20d;
  const volHighlight = volRatio >= 1.5;

  const plan = computeTradePlan(stock.current_price);
  const psPct = (stock.position_size * 100).toFixed(1);

  // signal count summary
  const signalCount =
    stock.pre_surge_details?.signal_count ??
    stock.quiet_details?.signal_count ?? null;
  const signalMax = stock.pre_surge_details ? 4 : stock.quiet_details ? 6 : null;

  return (
    <div
      onClick={onSelect}
      className={`group relative cursor-pointer rounded-lg border ${a.border} ${a.softBg} p-3 transition-all hover:shadow-md hover:border-foreground/30`}
    >
      {/* Row 1: Ticker + Arabic name + Star */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); onTrackToggle(); }}
              className="text-muted-foreground hover:text-amber-500 transition-colors"
              title={stock.isTracked ? 'إزالة من المتابعة' : 'أضف للمتابعة'}
            >
              {stock.isTracked ? (
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              ) : (
                <StarOff className="h-3.5 w-3.5" />
              )}
            </button>
            <span className="font-bold text-base">{stock.ticker}</span>
            {stock.isTracked && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300">
                متابَع
              </Badge>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {bucketLabel[stock.price_bucket] || ''}
            {bucketLabel[stock.price_bucket] && sector ? ' · ' : ''}
            {sector || 'قطاع غير محدد'}
          </div>
        </div>
        <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>

      {/* Row 2: Price + ROC */}
      <div className="flex items-end justify-between gap-2 mb-2">
        <div>
          <div className="text-[10px] text-muted-foreground">السعر</div>
          <div className="text-lg font-bold font-mono">{fmtNum(stock.current_price)}</div>
        </div>
        <div className="text-left">
          <div className="text-[10px] text-muted-foreground">ROC 10 أيام</div>
          <div className={`text-sm font-bold font-mono ${pnlColorClass(stock.roc_10d)}`}>
            {fmtPct(stock.roc_10d)}
          </div>
        </div>
      </div>

      {/* Row 3: Volume ratio + stability */}
      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
        <div className="flex items-center justify-between bg-background/60 rounded px-2 py-1">
          <span className="text-[10px] text-muted-foreground">حجم نسبي</span>
          <span className={`font-mono font-semibold ${volHighlight ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
            {volRatio.toFixed(2)}×
          </span>
        </div>
        <div className="flex items-center justify-between bg-background/60 rounded px-2 py-1">
          <span className="text-[10px] text-muted-foreground">استقرار</span>
          <span className={`font-mono font-semibold ${
            stock.price_stability >= 0.7 ? 'text-emerald-600 dark:text-emerald-400' :
            stock.price_stability >= 0.5 ? 'text-amber-600 dark:text-amber-400' :
            'text-muted-foreground'
          }`}>
            {(stock.price_stability * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Row 4: signals OR trade plan */}
      {signalCount != null && signalMax != null && (
        <div className="flex items-center gap-1.5 mb-2">
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${a.badge}`}>
            <Sparkles className="h-3 w-3" />
            {signalCount}/{signalMax} إشارات
          </div>
          {stock.range_10d_pct > 0 && (
            <span className="text-[10px] text-muted-foreground">
              نطاق {stock.range_10d_pct.toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {stock.path === 'D_explosive_surge' && plan && (
        <div className="grid grid-cols-3 gap-1.5 mb-2 text-[10px]">
          <div className="bg-background/60 rounded px-1.5 py-1 border border-border/40">
            <div className="text-muted-foreground">دخول</div>
            <div className="font-mono font-semibold">{fmtNum(plan.entry)}</div>
          </div>
          <div className="bg-rose-50/60 dark:bg-rose-950/20 rounded px-1.5 py-1 border border-rose-200/40 dark:border-rose-900/40">
            <div className="text-muted-foreground">وقف</div>
            <div className="font-mono font-semibold text-rose-600 dark:text-rose-400">{fmtNum(plan.stop)}</div>
          </div>
          <div className="bg-emerald-50/60 dark:bg-emerald-950/20 rounded px-1.5 py-1 border border-emerald-200/40 dark:border-emerald-900/40">
            <div className="text-muted-foreground">هدف</div>
            <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{fmtNum(plan.target)}</div>
          </div>
          <div className="col-span-3 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">
              R:R <span className="font-bold text-foreground">{plan.rr.toFixed(2)}:1</span>
            </span>
            <span className="text-muted-foreground">
              مخاطرة <span className="font-bold text-rose-600 dark:text-rose-400">{plan.riskPct.toFixed(1)}%</span>
              {' · '}
              عائد <span className="font-bold text-emerald-600 dark:text-emerald-400">{plan.rewardPct.toFixed(1)}%</span>
            </span>
          </div>
        </div>
      )}

      {/* Row 5: footer badges — position size + change since tracking + sector */}
      <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-border/30">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="text-[9px] h-4 px-1">
            <Target className="h-2.5 w-2.5 ml-0.5" />
            {psPct}% حجم
          </Badge>
          {stock.isTracked && stock.changeSinceTracking != null && (
            <Badge variant="outline" className={`text-[9px] h-4 px-1 ${pnlColorClass(stock.changeSinceTracking)}`}>
              {fmtPct(stock.changeSinceTracking)}
            </Badge>
          )}
        </div>
        {sector && (
          <Badge variant="outline" className="text-[9px] h-4 px-1 max-w-[120px] truncate">
            <span className="ml-1">{meta.icon}</span>
            <span className="truncate">{sector}</span>
          </Badge>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Stock Detail Drawer
// ============================================================================
interface StockDetailDrawerProps {
  ticker: string;
  sectorForTicker: (ticker: string) => string | null;
  sectorChangeForTicker: (ticker: string) => number | null;
  onClose: () => void;
  onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

function StockDetailDrawer({
  ticker, sectorForTicker, sectorChangeForTicker, onClose, onTrackToggle,
}: StockDetailDrawerProps) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadStockDetail = useAppStore((s) => s.loadStockDetail);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/maker-radar/stock?ticker=${ticker}&days=30`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setDetail(json);
      } else {
        setError(json.error || 'فشل تحميل البيانات');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const handleTrack = async () => {
    if (!detail?.stats?.lastClose) return;
    await onTrackToggle(ticker, detail.stats.lastClose, !!detail?.tracking?.isTracked);
    fetchDetail();
  };

  // sparkline geometry
  const sparkline = useMemo(() => {
    if (!detail?.prices || detail.prices.length < 2) return null;
    const prices = detail.prices.map((p) => p.close).filter((c) => c > 0);
    if (prices.length < 2) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const w = 320;
    const h = 60;
    const points = prices.map((p, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const isUp = prices[prices.length - 1] >= prices[0];
    const firstP = prices[0];
    const lastP = prices[prices.length - 1];
    const totalChange = firstP > 0 ? ((lastP - firstP) / firstP) * 100 : 0;
    return { points, isUp, w, h, min, max, totalChange };
  }, [detail]);

  const sector = sectorForTicker(ticker);
  const sectorChange = sectorChangeForTicker(ticker);
  const stockInfo = detail?.stock_info;
  const plan = detail?.stats ? computeTradePlan(detail.stats.lastClose) : null;

  return (
    <>
      {/* sticky header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-2 flex-wrap">
          <DialogTitle className="text-base font-bold">{ticker}</DialogTitle>
          {(stockInfo?.name_ar || stockInfo?.name) && (
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {stockInfo.name_ar || stockInfo.name}
            </span>
          )}
          {sector && (
            <Badge variant="outline" className="text-xs">
              <Layers className="h-3 w-3 ml-1" />
              {sector}
            </Badge>
          )}
          {sectorChange != null && (
            <Badge variant="outline" className={`text-xs ${pnlColorClass(sectorChange)}`}>
              القطاع {fmtPct(sectorChange)}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {detail && (
            <Button
              size="sm"
              variant={detail.tracking?.isTracked ? 'default' : 'outline'}
              onClick={handleTrack}
              className="h-8"
              disabled={loading}
            >
              {detail.tracking?.isTracked ? (
                <><Star className="h-3.5 w-3.5 fill-current" /> متابَع</>
              ) : (
                <><StarOff className="h-3.5 w-3.5" /> أضف للمتابعة</>
              )}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => loadStockDetail(ticker)} className="h-8" title="افتح صفحة السهم الكاملة">
            <BarChart3 className="h-3.5 w-3.5 ml-1" />
            <span className="hidden sm:inline">صفحة السهم</span>
          </Button>
          <DialogClose asChild>
            <Button size="sm" variant="ghost" onClick={onClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-4 bg-muted/10">
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {error && !loading && (
          <Card className="p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-rose-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" onClick={fetchDetail} className="mt-3">
              <RefreshCw className="h-4 w-4 ml-1" /> إعادة
            </Button>
          </Card>
        )}

        {detail && !loading && (
          <div className="space-y-3">
            {/* === Price + sparkline === */}
            <Card className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs text-muted-foreground">السعر الحالي</div>
                  <div className="text-2xl font-bold font-mono">
                    {fmtNum(detail.stats?.lastClose ?? 0)}
                    <span className="text-xs text-muted-foreground mr-1">EGP</span>
                  </div>
                </div>
                <div className="text-left">
                  <div className="text-xs text-muted-foreground">تغير {detail.stats?.dataPoints ?? 0} يوم</div>
                  <div className={`text-lg font-bold font-mono ${pnlColorClass(detail.stats?.changePct)}`}>
                    {fmtPct(detail.stats?.changePct)}
                  </div>
                </div>
              </div>
              {sparkline && (
                <div className="mt-2">
                  <svg viewBox={`0 0 ${sparkline.w} ${sparkline.h}`} className="w-full h-14" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={sparkline.isUp ? '#10b981' : '#f43f5e'} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={sparkline.isUp ? '#10b981' : '#f43f5e'} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <polyline
                      points={`0,${sparkline.h} ${sparkline.points} ${sparkline.w},${sparkline.h}`}
                      fill="url(#sparkGrad)"
                      stroke="none"
                    />
                    <polyline
                      points={sparkline.points}
                      fill="none"
                      stroke={sparkline.isUp ? '#10b981' : '#f43f5e'}
                      strokeWidth="1.5"
                    />
                  </svg>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                    <span>أدنى: {fmtNum(sparkline.min)}</span>
                    <Badge variant="outline" className={sparkline.isUp ? 'text-emerald-600' : 'text-rose-600'}>
                      {sparkline.isUp ? <TrendingUp className="h-3 w-3 ml-1" /> : <TrendingDown className="h-3 w-3 ml-1" />}
                      {fmtPct(sparkline.totalChange)}
                    </Badge>
                    <span>أعلى: {fmtNum(sparkline.max)}</span>
                  </div>
                </div>
              )}
            </Card>

            {/* === Tracking banner === */}
            {detail.tracking?.isTracked && (
              <Card className="p-3 bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    <span className="text-xs font-medium">
                      تحت المتابعة منذ {detail.tracking.entryDate}
                    </span>
                  </div>
                  <div className="text-left">
                    <div className={`text-sm font-bold ${pnlColorClass(detail.tracking.changeSinceTracking)}`}>
                      {fmtPct(detail.tracking.changeSinceTracking)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {detail.tracking.daysTracked} يوم · من {fmtNum(detail.tracking.entryPrice)} لـ {fmtNum(detail.tracking.currentPrice)}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* === Trade plan (explosive) === */}
            {plan && (
              <Card className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-semibold">خطة التداول المقترحة</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    R:R <span className="font-bold mr-1">{plan.rr.toFixed(2)}:1</span>
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-emerald-50/60 dark:bg-emerald-950/20 rounded-md p-2 border border-emerald-200/50 dark:border-emerald-900/40">
                    <div className="text-[10px] text-muted-foreground">دخول</div>
                    <div className="font-mono font-bold text-sm">{fmtNum(plan.entry)}</div>
                    <div className="text-[9px] text-emerald-600 dark:text-emerald-400">السعر الحالي</div>
                  </div>
                  <div className="bg-rose-50/60 dark:bg-rose-950/20 rounded-md p-2 border border-rose-200/50 dark:border-rose-900/40">
                    <div className="text-[10px] text-muted-foreground">وقف الخسارة</div>
                    <div className="font-mono font-bold text-sm text-rose-600 dark:text-rose-400">{fmtNum(plan.stop)}</div>
                    <div className="text-[9px] text-rose-600 dark:text-rose-400">{plan.riskPct.toFixed(1)}%- تحرك</div>
                  </div>
                  <div className="bg-blue-50/60 dark:bg-blue-950/20 rounded-md p-2 border border-blue-200/50 dark:border-blue-900/40">
                    <div className="text-[10px] text-muted-foreground">الهدف</div>
                    <div className="font-mono font-bold text-sm text-blue-600 dark:text-blue-400">{fmtNum(plan.target)}</div>
                    <div className="text-[9px] text-blue-600 dark:text-blue-400">+{plan.rewardPct.toFixed(1)}% هدف</div>
                  </div>
                </div>
              </Card>
            )}

            {/* === Stats grid === */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatCard
                label="ROC 10 أيام"
                value={fmtPct(detail.stats?.roc10d)}
                valueClass={pnlColorClass(detail.stats?.roc10d)}
                icon={<Gauge className="h-3 w-3" />}
              />
              <StatCard
                label="مدى 20 يوم"
                value={`${(detail.stats?.range20Pct ?? 0).toFixed(1)}%`}
                sub={`${fmtNum(detail.stats?.min20)} - ${fmtNum(detail.stats?.max20)}`}
                icon={<Activity className="h-3 w-3" />}
              />
              <StatCard
                label="متوسط حجم 20 يوم"
                value={fmtMoney(detail.stats?.avgVolume20)}
                icon={<BarChart3 className="h-3 w-3" />}
              />
              <StatCard
                label="متوسط سيولة 20 يوم"
                value={fmtMoney(detail.stats?.avgTurnover20)}
                sub="EGP"
                icon={<Gauge className="h-3 w-3" />}
              />
            </div>

            {/* === Sector context === */}
            {sector && sectorChange != null && (
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <div>
                      <div className="text-xs font-semibold">قطاع: {sector}</div>
                      <div className="text-[10px] text-muted-foreground">أداء القطاع اليوم</div>
                    </div>
                  </div>
                  <div className={`text-base font-bold ${pnlColorClass(sectorChange)}`}>
                    {fmtPct(sectorChange)}
                  </div>
                </div>
              </Card>
            )}

            {/* === Fundamentals === */}
            {(stockInfo && (stockInfo.pe_ratio || stockInfo.roe || stockInfo.market_cap || stockInfo.pb_ratio)) ? (
              <Card className="p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">البيانات الأساسية</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <FundamentalField label="P/E" value={stockInfo.pe_ratio != null ? stockInfo.pe_ratio.toFixed(2) : null} />
                  <FundamentalField label="P/B" value={stockInfo.pb_ratio != null ? stockInfo.pb_ratio.toFixed(2) : null} />
                  <FundamentalField label="ROE" value={stockInfo.roe != null ? `${stockInfo.roe.toFixed(1)}%` : null} />
                  <FundamentalField label="EPS" value={stockInfo.eps != null ? fmtNum(stockInfo.eps) : null} />
                  <FundamentalField label="القيمة السوقية" value={stockInfo.market_cap != null ? `${fmtMoney(stockInfo.market_cap)} EGP` : null} />
                  <FundamentalField label="توزيعات" value={stockInfo.dividend_yield != null ? `${stockInfo.dividend_yield.toFixed(2)}%` : null} />
                  <FundamentalField label="دعم" value={stockInfo.support != null ? fmtNum(stockInfo.support) : null} />
                  <FundamentalField label="مقاومة" value={stockInfo.resistance != null ? fmtNum(stockInfo.resistance) : null} />
                </div>
              </Card>
            ) : null}

            {/* === Last 10 days price table === */}
            {detail.prices && detail.prices.length > 0 && (
              <Card className="p-3">
                <div className="text-xs font-semibold mb-2">آخر {Math.min(detail.prices.length, 10)} أيام</div>
                <div className="overflow-x-auto -mx-3 md:mx-0">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/50">
                        <th className="text-right py-1.5 px-2 font-medium">التاريخ</th>
                        <th className="text-right py-1.5 px-2 font-medium">إغلاق</th>
                        <th className="text-right py-1.5 px-2 font-medium hidden sm:table-cell">أعلى</th>
                        <th className="text-right py-1.5 px-2 font-medium hidden sm:table-cell">أقل</th>
                        <th className="text-right py-1.5 px-2 font-medium">حجم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.prices.slice(-10).reverse().map((p) => (
                        <tr key={p.date} className="border-b border-border/30">
                          <td className="py-1.5 px-2 text-muted-foreground">{p.date}</td>
                          <td className="py-1.5 px-2 font-mono font-semibold">{fmtNum(p.close)}</td>
                          <td className="py-1.5 px-2 font-mono hidden sm:table-cell">{fmtNum(p.high)}</td>
                          <td className="py-1.5 px-2 font-mono hidden sm:table-cell">{fmtNum(p.low)}</td>
                          <td className="py-1.5 px-2 font-mono text-muted-foreground">{fmtMoney(p.volume)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* === Action guidance box === */}
            <Card className="p-3 bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-900/50">
              <div className="flex items-start gap-2">
                <div className="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">
                    💡 توجيه التداول
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {buildGuidance(ticker, detail)}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

function buildGuidance(ticker: string, detail: StockDetail): string {
  const stats = detail.stats;
  if (!stats) return `تابع ${ticker} مع التحديث اليومي للرادار.`;

  const roc = stats.roc10d ?? 0;
  const range = stats.range20Pct ?? 0;
  const change = stats.changePct ?? 0;

  if (roc > 12) {
    return `السهم في موجة صعودية قوية (ROC10 ${fmtPct(roc)}). انتظر ارتداد صغير للدخول، وضع وقف خسارة تحت آخر قاع — تجنب الشراء عند القمة.`;
  }
  if (roc < -5) {
    return `السهم في تصحيح (ROC10 ${fmtPct(roc)}). انتظر استقرار السعر فوق الدعم قبل الدخول. لو كسر القاع، تجنّب.`;
  }
  if (range < 6) {
    return `السهم في نطاق ضيق (${range.toFixed(1)}% خلال 20 يوم) — مرحلة تجميع. الكسر للأعلى بحجم > 1.5× يكون إشارة دخول.`;
  }
  if (change > 0) {
    return `السهم يتحرك بإيجابية (+${change.toFixed(1)}%). راقب حجم التداول: لو ارتفع فوق المتوسط بـ 1.5× يكون تأكيد استمرار.`;
  }
  return `السهم في مرحلة تجميع هادئة. راقب حجم التداول اليومي وإشارات الرادار لتحديد توقيت الدخول الأمثل.`;
}

// ============================================================================
// Stat Card (inside drawer)
// ============================================================================
interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  icon?: React.ReactNode;
}

function StatCard({ label, value, sub, valueClass, icon }: StatCardProps) {
  return (
    <Card className="p-2.5">
      <div className="flex items-center gap-1 mb-0.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <div className="text-[10px] text-muted-foreground">{label}</div>
      </div>
      <div className={`text-sm font-mono font-bold ${valueClass || ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function FundamentalField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-background/50 rounded-md px-2 py-1.5 border border-border/30">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold">{value ?? '—'}</div>
    </div>
  );
}

// ============================================================================
// Proof Section (collapsible)
// ============================================================================
function ProofSection() {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between p-3 md:p-4 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">إثباتات دقة الرادار</div>
                <div className="text-xs text-muted-foreground">نتائج الاختبار الرجعي — شفافية كاملة</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs hidden sm:inline-flex">
                <Award className="h-3 w-3 ml-1" />
                Recall {PROOF_METRICS.recall.toFixed(1)}%
              </Badge>
              <ChevronLeft className={`h-4 w-4 text-muted-foreground transition-transform ${open ? '-rotate-90' : ''}`} />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-3 md:p-4 pt-0 space-y-3 border-t border-border/50">
            {/* 4 metric cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
              <ProofMetricCard
                icon={<Crosshair className="h-4 w-4" />}
                label="Recall"
                value={`${PROOF_METRICS.recall.toFixed(1)}%`}
                sub={`${PROOF_METRICS.detected_explosive} من ${PROOF_METRICS.explosive_moves}`}
                accent="emerald"
              />
              <ProofMetricCard
                icon={<Target className="h-4 w-4" />}
                label="Precision"
                value={`${PROOF_METRICS.precision.toFixed(1)}%`}
                sub={`${PROOF_METRICS.target_hits} من ${PROOF_METRICS.total_detections}`}
                accent="blue"
              />
              <ProofMetricCard
                icon={<Clock className="h-4 w-4" />}
                label="نافذة الاختبار"
                value={`${PROOF_METRICS.lookforward} أيام`}
                sub={`عتبة ${PROOF_METRICS.surge_threshold}%`}
                accent="amber"
              />
              <ProofMetricCard
                icon={<BarChart3 className="h-4 w-4" />}
                label="متوسط R:R"
                value={PROOF_METRICS.avg_rr.toFixed(2)}
                sub="عبر كل التوقعات"
                accent="rose"
              />
            </div>

            {/* mini bar chart — explosive caught vs missed */}
            <Card className="p-3">
              <div className="text-xs font-semibold mb-2">الانفجارات المكتشفة مقابل الفائتة</div>
              <ExplosiveBarChart
                detected={PROOF_METRICS.detected_explosive}
                total={PROOF_METRICS.explosive_moves}
              />
            </Card>

            {/* Summary text */}
            <div className="bg-muted/30 rounded-md p-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                الرادار اكتشف <span className="font-bold text-foreground">{PROOF_METRICS.detected_explosive} سهم</span> من أصل{' '}
                <span className="font-bold text-foreground">{PROOF_METRICS.explosive_moves} انفجار</span> في فترة الاختبار الرجعي
                ({PROOF_METRICS.recall.toFixed(1)}% recall)، من أصل{' '}
                <span className="font-bold text-foreground">{PROOF_METRICS.total_detections} كشف</span> إجمالي للرادار
                ({PROOF_METRICS.precision.toFixed(1)}% precision).
              </p>
              <p className="mt-2 text-[11px]">
                الأرقام من الاختبار الرجعي على بيانات EGX التاريخية — يتم تحديثها دورياً.
              </p>
            </div>

            <Button variant="outline" size="sm" className="w-full" disabled>
              <Award className="h-4 w-4 ml-1" />
              شاهد التفاصيل الكاملة (قريباً)
            </Button>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

interface ProofMetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: 'blue' | 'amber' | 'rose' | 'emerald';
}

function ProofMetricCard({ icon, label, value, sub, accent }: ProofMetricCardProps) {
  const colors: Record<ProofMetricCardProps['accent'], { bg: string; text: string }> = {
    blue:    { bg: 'bg-blue-50 dark:bg-blue-950/40',    text: 'text-blue-600 dark:text-blue-400' },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-950/40',  text: 'text-amber-600 dark:text-amber-400' },
    rose:    { bg: 'bg-rose-50 dark:bg-rose-950/40',   text: 'text-rose-600 dark:text-rose-400' },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-600 dark:text-emerald-400' },
  };
  const c = colors[accent];
  return (
    <Card className="p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <div className={`h-6 w-6 rounded ${c.bg} flex items-center justify-center`}>
          <div className={c.text}>{icon}</div>
        </div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
      </div>
      <div className={`text-lg font-bold font-mono ${c.text}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

function ExplosiveBarChart({ detected, total }: { detected: number; total: number }) {
  const missed = Math.max(0, total - detected);
  const max = Math.max(detected, missed, 1);
  const detectedPct = (detected / max) * 100;
  const missedPct = (missed / max) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3 h-32">
        <div className="flex-1 flex flex-col items-center justify-end">
          <div className="text-[10px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 mb-1">
            {detected}
          </div>
          <div
            className="w-full bg-gradient-to-t from-emerald-500 to-emerald-400 rounded-t-md transition-all"
            style={{ height: `${Math.max(detectedPct, 4)}%` }}
            title={`${detected} مكتشفة`}
          />
          <div className="text-[10px] text-muted-foreground mt-1 text-center">مكتشفة</div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-end">
          <div className="text-[10px] font-mono font-semibold text-rose-600 dark:text-rose-400 mb-1">
            {missed}
          </div>
          <div
            className="w-full bg-gradient-to-t from-rose-500 to-rose-400 rounded-t-md transition-all"
            style={{ height: `${Math.max(missedPct, 4)}%` }}
            title={`${missed} فائتة`}
          />
          <div className="text-[10px] text-muted-foreground mt-1 text-center">فائتة</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/30">
        <span>إجمالي الانفجارات: <span className="font-bold text-foreground">{total}</span></span>
        <span>نسبة الاكتشاف: <span className="font-bold text-emerald-600 dark:text-emerald-400">
          {total > 0 ? ((detected / total) * 100).toFixed(1) : '0.0'}%
        </span></span>
      </div>
    </div>
  );
}

// ============================================================================
// Export
// ============================================================================
export default MakerRadarTab;

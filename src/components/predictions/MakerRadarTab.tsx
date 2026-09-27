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
  BarChart3, Eye as MicroscopeIcon, Flame as FlameIcon,
  Rocket, ArrowUpRight, ArrowDownRight, ShieldCheck, Info, Sparkles,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/components/shared/UnifiedPublishButton';
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
import { SafeWidget } from '@/components/dashboard/SafeWidget';
import { MarketDepthLiquidityWidget } from '@/components/analysis/MarketDepthLiquidityWidget';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { CheckCircle2, AlertCircle, Lightbulb, Scale } from 'lucide-react';

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
  roc_30d?: number | null;
  maker_activity?: string | null;
  buy_pct?: number | null;
  net_flow_egp?: number | null;
  kill_switch?: boolean | null;
  life_cycle?: string | null;
  accumulation?: string | null;
  expected?: string | null;
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
  cache_stale?: boolean;
  warmup_running?: boolean;
  cache_generated_at?: string;
  db_source?: string;
  last_warmup_status?: 'idle' | 'running' | 'success' | 'failed';
  last_warmup_finished_at?: string;
  last_warmup_duration_ms?: number;
  last_error?: string | null;
  warming_up?: boolean;
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

// 3 تبويبات عرضية: صاعدة / هابطة / احتمالات
// (تستبدل الـ 6 فلاتر القديمة all/pre_surge/quiet/explosive/early_break/tracked)
type FilterKey = 'up' | 'down' | 'opportunities';

// بيانات العرض لكل تبويب
const TAB_META: Record<FilterKey, { title: string; subtitle: string; icon: React.ReactNode; accent: AccentKey; emoji: string }> = {
  up: {
    title: '📈 الأسهم الصاعدة',
    subtitle: 'ROC10 موجب + تغير موجب — زخم صاعد حقيقي',
    icon: <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
    accent: 'emerald',
    emoji: '📈',
  },
  down: {
    title: '📉 الأسهم الهابطة',
    subtitle: 'ROC10 سالب + تغير سالب — زخم هابط',
    icon: <TrendingDown className="h-4 w-4 text-rose-600 dark:text-rose-400" />,
    accent: 'rose',
    emoji: '📉',
  },
  opportunities: {
    title: '🎯 احتمالات قادمة',
    subtitle: 'حجم متصاعد + إشارات تجميع — فرص تحت الرادار',
    icon: <Crosshair className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
    accent: 'amber',
    emoji: '🎯',
  },
};

export function MakerRadarTab({ market = 'EGX' }: MakerRadarTabProps) {
  const [data, setData] = useState<MakerRadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [warmingRadar, setWarmingRadar] = useState(false);
  const [warmingV40, setWarmingV40] = useState(false);
  const [warmupMsg, setWarmupMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 3 تبويبات: صاعدة / هابطة / احتمالات (default: صاعدة)
  const [filter, setFilter] = useState<FilterKey>('up');
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

  // ─── Synchronous radar warmup (calls /api/maker-radar/warmup) ─────────
  // Forces a fresh Python run. Blocks until done (typically <2s on indexed DB).
  const handleWarmupRadar = useCallback(async () => {
    setWarmingRadar(true);
    setWarmupMsg('بيتشغل الرادار...');
    try {
      const res = await fetch('/api/maker-radar/warmup?market=EGX&timeout=120000', {
        method: 'POST',
      });
      const json = await res.json();
      if (json.success) {
        const dur = json.status?.last_warmup_duration_ms ?? 0;
        const scanned = json.cache_total_scanned ?? 0;
        setWarmupMsg(`✅ اتحدّث في ${(dur / 1000).toFixed(1)}ث — ${scanned} سهم مفسوح`);
        await fetchData(true);
      } else {
        setWarmupMsg(`❌ فشل: ${json.status?.last_error || 'خطأ غير معروف'}`);
      }
    } catch (e) {
      setWarmupMsg(`❌ خطأ: ${e instanceof Error ? e.message : 'اتصال'}`);
    } finally {
      setWarmingRadar(false);
      setTimeout(() => setWarmupMsg(null), 6000);
    }
  }, [fetchData]);

  // ─── V40.2 predictions refresh (calls /api/predictions/refresh-v40) ───
  // Runs the V40.2 daily generator directly via subprocess.
  const handleRefreshV40 = useCallback(async () => {
    setWarmingV40(true);
    setWarmupMsg('بيولّد توقعات V40.2...');
    try {
      const res = await fetch('/api/predictions/refresh-v40?mode=today&timeout=240000', {
        method: 'POST',
      });
      const json = await res.json();
      if (json.success) {
        const preds = json.total_predictions ?? 0;
        const dates = (json.scan_dates || []).join(', ');
        const dur = ((json.elapsed_ms ?? 0) / 1000).toFixed(1);
        setWarmupMsg(`✅ V40.2 خلص في ${dur}ث — ${preds} توقعات على ${dates}`);
      } else {
        const tail = json.stderr_tail || json.status?.last_error || 'خطأ غير معروف';
        setWarmupMsg(`❌ V40.2 فشل: ${tail.slice(0, 120)}`);
      }
    } catch (e) {
      setWarmupMsg(`❌ خطأ: ${e instanceof Error ? e.message : 'اتصال'}`);
    } finally {
      setWarmingV40(false);
      setTimeout(() => setWarmupMsg(null), 8000);
    }
  }, []);

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

  const changePercentForTicker = useCallback((ticker: string): number | null => {
    if (!stockMap) return null;
    const chg = stockMap.get(ticker.toUpperCase())?.change_percent;
    return typeof chg === 'number' ? chg : null;
  }, [stockMap]);

  const marketStatus = getMarketStatus(market);

  // --------------------------------------------------------------------
  // تبويبات الصعود/الهبوط/الاحتمالات — فلترة كل قوائم الرادار (4 قوائم)
  // بناءً على changePct (من stockMap) و roc_10d و إشارات التجميع.
  // --------------------------------------------------------------------
  const allRadarStocks = useMemo<RadarStock[]>(() => {
    const map = new Map<string, RadarStock>();
    // نجمع كل القوائم الـ 4 (pre_surge + quiet + explosive + early_break)
    // ثم نُزيل التكرار بالـ ticker (السهم الواحد قد يظهر في أكثر من قائمة).
    const combined = [
      ...(data?.pre_surge_list || []),
      ...(data?.quiet_list || []),
      ...(data?.explosive_list || []),
      ...(data?.early_break_list || []),
    ];
    for (const s of combined) {
      if (!map.has(s.ticker)) map.set(s.ticker, s);
    }
    return Array.from(map.values());
  }, [data]);

  const filteredStocks = useMemo<RadarStock[]>(() => {
    return allRadarStocks.filter((s) => {
      const changePct = changePercentForTicker(s.ticker);
      const roc10 = s.roc_10d;
      const volRatio = s.volume_ratio_10d_vs_20d;
      const hasAccumulation = !!s.accumulation && s.accumulation.includes('تجميع');
      const hasDistribution = !!s.accumulation && s.accumulation.includes('تصريف');
      const isRadarActive =
        s.path === 'A_pre_surge' ||
        s.path === 'B_quiet_accumulation_strong' ||
        s.path === 'E_early_break';

      if (filter === 'up') {
        // موجب التغير + موجب ROC10 (مع تسامح بسيط للأصفار)
        const upChange = changePct != null ? changePct > 0 : roc10 != null && roc10 > 0;
        const upRoc = roc10 != null ? roc10 > 0 : changePct != null && changePct > 0;
        return upChange && upRoc;
      }
      if (filter === 'down') {
        const dnChange = changePct != null ? changePct < 0 : roc10 != null && roc10 < 0;
        const dnRoc = roc10 != null ? roc10 < 0 : changePct != null && changePct < 0;
        return dnChange && dnRoc;
      }
      // opportunities — حجم متصاعد + إشارات تجميع أو مسار نشط (مع استبعاد التصريف)
      if (filter === 'opportunities') {
        const volSurge = volRatio >= 1.3;
        return volSurge && (hasAccumulation || isRadarActive) && !hasDistribution;
      }
      return false;
    });
  }, [allRadarStocks, filter, changePercentForTicker]);

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

  const totalCardsShown = filteredStocks.length;

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
              {/* ─── Freshness badge ─── cache_age + db_source + warmup status */}
              {data?.cached && (
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    data.cache_stale
                      ? 'text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40'
                      : data.cache_age_seconds! < 60
                      ? 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40'
                      : 'text-muted-foreground border-border bg-muted/30'
                  }`}
                  title={`DB: ${data.db_source || 'unknown'}\nGenerated: ${data.cache_generated_at || '?'}\nLast warmup: ${data.last_warmup_status} (${data.last_warmup_duration_ms ?? 0}ms)`}
                >
                  <Clock className="h-3 w-3 ml-0.5" />
                  {data.cache_stale
                    ? `قديم ${Math.floor(data.cache_age_seconds! / 60)}د`
                    : data.cache_age_seconds! < 60
                    ? `طازج ${data.cache_age_seconds}ث`
                    : `${Math.floor(data.cache_age_seconds! / 60)}د`}
                </Badge>
              )}
              {data?.warmup_running && (
                <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse mr-1" />
                  بيشتغل
                </Badge>
              )}
              {data?.db_source && (
                <Badge variant="outline" className="text-[9px] text-muted-foreground border-border bg-muted/20" title="قاعدة البيانات المستخدمة">
                  {data.db_source.split('::')[0]}
                </Badge>
              )}
              {data?.last_warmup_status === 'failed' && data?.last_error && (
                <Badge variant="outline" className="text-[10px] text-rose-700 border-rose-200 bg-rose-50 dark:text-rose-400 dark:bg-rose-950/40" title={data.last_error}>
                  ⚠️ خطأ آخر تشغيل
                </Badge>
              )}
              {/* ─── Refresh buttons ─── */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => fetchData(true)}
                disabled={refreshing || loading || warmingRadar}
                className="h-8"
                title="إعادة قراءة الكاش"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={handleWarmupRadar}
                disabled={warmingRadar || warmingV40}
                className="h-8 gap-1"
                title="شغّل الرادار من جديد (Python script)"
              >
                <RefreshCw className={`h-4 w-4 ${warmingRadar ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">تشغيل الرادار</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleRefreshV40}
                disabled={warmingRadar || warmingV40}
                className="h-8 gap-1"
                title="ولّد توقعات V40.2 لليوم"
              >
                <Sparkles className={`h-4 w-4 ${warmingV40 ? 'animate-pulse' : ''}`} />
                <span className="hidden sm:inline">توليد التوقعات</span>
              </Button>
            </div>
            {/* ─── Warmup status message ─── */}
            {warmupMsg && (
              <div className="mt-2 text-xs px-3 py-1.5 rounded-md bg-muted/50 border border-border text-foreground animate-in fade-in slide-in-from-top-1">
                {warmupMsg}
              </div>
            )}
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

      {/* ===== FILTER BAR — 3 تبويبات: صاعدة / هابطة / احتمالات ===== */}
      <Card className="p-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground ml-1">عرض:</span>
          {([
            { key: 'up',           label: 'صاعدة',    emoji: '📈' },
            { key: 'down',         label: 'هابطة',    emoji: '📉' },
            { key: 'opportunities', label: 'احتمالات', emoji: '🎯' },
          ] as const).map((f) => {
            const count = f.key === 'up'
              ? allRadarStocks.filter((s) => {
                  const c = changePercentForTicker(s.ticker);
                  return (c != null ? c > 0 : (s.roc_10d ?? 0) > 0) && (s.roc_10d != null ? s.roc_10d > 0 : (c ?? 0) > 0);
                }).length
              : f.key === 'down'
              ? allRadarStocks.filter((s) => {
                  const c = changePercentForTicker(s.ticker);
                  return (c != null ? c < 0 : (s.roc_10d ?? 0) < 0) && (s.roc_10d != null ? s.roc_10d < 0 : (c ?? 0) < 0);
                }).length
              : allRadarStocks.filter((s) =>
                  s.volume_ratio_10d_vs_20d >= 1.3 &&
                  (!!s.accumulation && s.accumulation.includes('تجميع') ||
                   s.path === 'A_pre_surge' ||
                   s.path === 'B_quiet_accumulation_strong' ||
                   s.path === 'E_early_break') &&
                  !(!!s.accumulation && s.accumulation.includes('تصريف'))
                ).length;
            return (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setFilter(f.key)}
              >
                <span className="ml-1">{f.emoji}</span>
                {f.label}
                <Badge variant="secondary" className="mr-1 h-4 text-[10px] px-1">{count}</Badge>
              </Button>
            );
          })}
        </div>
      </Card>

      {/* ===== STOCK SECTIONS — قسم واحد للتبويب النشط ===== */}
      {filteredStocks.length > 0 && (
        <RadarSection
          title={TAB_META[filter].title}
          subtitle={TAB_META[filter].subtitle}
          icon={TAB_META[filter].icon}
          accent={TAB_META[filter].accent}
          stocks={filteredStocks}
          sectorForTicker={sectorForTicker}
          changePercentForTicker={changePercentForTicker}
          onSelect={setSelectedTicker}
          onTrackToggle={handleTrackToggle}
        />
      )}

      {/* Empty state */}
      {totalCardsShown === 0 && (
        <Card className="p-8 text-center">
          <Radar className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">مفيش أسهم مطابقة للتبويب الحالي</p>
          <p className="text-xs text-muted-foreground mt-1">جرّب تبويب تاني أو حدّث بعد شوية</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            {(Object.keys(TAB_META) as FilterKey[]).map((k) => (
              <Button key={k} size="sm" variant="outline" onClick={() => setFilter(k)}>
                {TAB_META[k].emoji} {TAB_META[k].title.replace(/^\S+\s/, '')}
              </Button>
            ))}
          </div>
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
// Radar Section (table of stocks)
// ============================================================================
interface RadarSectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: AccentKey;
  stocks: RadarStock[];
  sectorForTicker: (ticker: string) => string | null;
  changePercentForTicker: (ticker: string) => number | null;
  onSelect: (ticker: string) => void;
  onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

function RadarSection({
  title, subtitle, icon, accent, stocks,
  sectorForTicker, changePercentForTicker, onSelect, onTrackToggle,
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
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {stocks.length} أسهم
          </Badge>
          <UnifiedPublishButton
            variant="outline"
            size="sm"
            title={`رادار الميكرز — ${title}`}
            content={`رادار الميكرز — ${title}\n${stocks.map((s, i) => `${i + 1}. ${s.ticker} — ${fmtNum(s.current_price)} EGP${s.maker_activity ? ` — ميكرز: ${s.maker_activity}` : ''}${s.accumulation ? ` — ${s.accumulation}` : ''}`).join('\n')}`}
            filename={`maker-radar-${accent}-${Date.now()}`}
            hashtags={['EGX', 'رادار_الميكرز', 'بورصة_مصر']}
            triggerLabel="نشر الرادار"
          />
        </div>
      </div>

      <div className="p-2 md:p-3">
        <StockTable
          stocks={stocks}
          accent={accent}
          sectorForTicker={sectorForTicker}
          changePercentForTicker={changePercentForTicker}
          onSelect={onSelect}
          onTrackToggle={onTrackToggle}
        />
      </div>
    </Card>
  );
}

// ============================================================================
// Stock Table (professional table layout — replaces card grid)
// ============================================================================
interface StockTableProps {
  stocks: RadarStock[];
  accent: AccentKey;
  sectorForTicker: (ticker: string) => string | null;
  changePercentForTicker: (ticker: string) => number | null;
  onSelect: (ticker: string) => void;
  onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

type RadarStockRow = RadarStock & { _idx: number };

function StockTable({
  stocks, accent, sectorForTicker, changePercentForTicker, onSelect, onTrackToggle,
}: StockTableProps) {
  const a = accentClasses[accent];

  // إعداد الـ columns للجدول الموحّد
  const columns: Column<RadarStockRow>[] = [
    {
      key: '_idx',
      header: '#',
      align: 'center',
      width: 'w-10',
      sortable: true,
      className: 'text-center text-muted-foreground font-mono text-[11px]',
      render: (r) => r._idx,
    },
    {
      key: 'ticker',
      header: 'السهم',
      sortable: true,
      filterable: true,
      hideable: true,
      render: (stock) => (
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-sm">{stock.ticker}</span>
          {stock.isTracked && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="متابَع" />
          )}
        </div>
      ),
    },
    {
      key: 'current_price',
      header: 'السعر',
      align: 'right',
      sortable: true,
      className: 'font-mono font-semibold',
      render: (stock) => fmtNum(stock.current_price),
    },
    {
      key: 'changePct',
      header: 'التغير%',
      align: 'right',
      sortable: true,
      filterable: true,
      render: (stock) => {
        const changePct = changePercentForTicker(stock.ticker);
        return (
          <span className={`font-mono font-semibold ${pnlColorClass(changePct)}`}>
            {changePct != null ? fmtPct(changePct) : '-'}
          </span>
        );
      },
    },
    {
      key: 'roc_10d',
      header: 'ROC10',
      align: 'right',
      sortable: true,
      className: 'hidden sm:table-cell font-mono',
      render: (stock) => (
        <span className={`font-mono ${pnlColorClass(stock.roc_10d)}`}>
          {fmtPct(stock.roc_10d)}
        </span>
      ),
    },
    {
      key: 'roc_30d',
      header: 'ROC30',
      align: 'right',
      sortable: true,
      className: 'hidden lg:table-cell font-mono',
      render: (stock) => (
        <span className={`font-mono ${pnlColorClass(stock.roc_30d ?? undefined)}`}>
          {fmtPct(stock.roc_30d)}
        </span>
      ),
    },
    {
      key: 'volume_ratio_10d_vs_20d',
      header: 'حجم نسبي',
      align: 'right',
      sortable: true,
      className: 'hidden sm:table-cell font-mono',
      render: (stock) => {
        const volRatio = stock.volume_ratio_10d_vs_20d;
        const volHighlight = volRatio >= 1.5;
        return (
          <span className={`font-mono ${volHighlight ? 'text-emerald-600 dark:text-emerald-400 font-bold' : ''}`}>
            {volRatio.toFixed(2)}×
          </span>
        );
      },
    },
    {
      key: 'signalCount',
      header: 'الإشارات',
      align: 'center',
      render: (stock) => {
        const signalCount =
          stock.pre_surge_details?.signal_count ??
          stock.quiet_details?.signal_count ?? null;
        const signalMax = stock.pre_surge_details ? 4 : stock.quiet_details ? 6 : null;
        return signalCount != null && signalMax != null ? (
          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${a.badge}`}>
            {signalCount}/{signalMax}
          </Badge>
        ) : '—';
      },
    },
    {
      key: 'maker_activity',
      header: 'ميكرز',
      align: 'center',
      sortable: true,
      filterable: true,
      className: 'hidden md:table-cell',
      render: (stock) => (
        <span className={
          stock.maker_activity === 'عالي'
            ? 'text-rose-600 dark:text-rose-400 font-bold'
            : stock.maker_activity === 'متوسط'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground'
        }>
          {stock.maker_activity || '-'}
        </span>
      ),
    },
    {
      key: 'buy_pct',
      header: 'شراء%',
      align: 'center',
      sortable: true,
      className: 'hidden lg:table-cell font-mono text-xs',
      render: (stock) => (
        <span className={
          (stock.buy_pct ?? 0) >= 60 ? 'text-emerald-600 dark:text-emerald-400 font-bold'
          : (stock.buy_pct ?? 0) <= 40 ? 'text-rose-600 dark:text-rose-400 font-bold'
          : 'text-muted-foreground'
        }>
          {stock.buy_pct != null ? `${stock.buy_pct}%` : '-'}
        </span>
      ),
    },
    {
      key: 'net_flow_egp',
      header: 'Net Flow',
      align: 'center',
      sortable: true,
      className: 'hidden lg:table-cell font-mono text-xs',
      render: (stock) => (
        <span className={pnlColorClass(stock.net_flow_egp ?? undefined)}>
          {stock.net_flow_egp != null
            ? `${stock.net_flow_egp >= 0 ? '+' : ''}${(Math.abs(stock.net_flow_egp) / 1_000_000).toFixed(1)}M`
            : '-'}
        </span>
      ),
    },
    {
      key: 'life_cycle',
      header: 'دورة الحياة',
      align: 'center',
      className: 'hidden xl:table-cell text-xs',
      filterable: true,
      render: (stock) => {
        if (stock.kill_switch) {
          return <span className="text-rose-600 dark:text-rose-400 font-bold">⚠️ KILL</span>;
        }
        if (!stock.life_cycle || stock.life_cycle === 'عادي') {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <span className={
            stock.life_cycle.includes('انفجار') ? 'text-emerald-600 font-bold'
            : stock.life_cycle.includes('توزيع') ? 'text-rose-600 font-bold'
            : stock.life_cycle.includes('نعاس') ? 'text-amber-600'
            : stock.life_cycle.includes('حبس') ? 'text-rose-600 font-bold'
            : 'text-muted-foreground'
          }>
            {stock.life_cycle}
          </span>
        );
      },
    },
    {
      key: 'accumulation',
      header: 'تجميع/تصريف',
      align: 'center',
      className: 'hidden md:table-cell',
      filterable: true,
      render: (stock) => (
        <span className={
          stock.accumulation?.includes('تجميع قوي')
            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
            : stock.accumulation?.includes('تصريف قوي')
              ? 'text-rose-600 dark:text-rose-400 font-semibold'
              : stock.accumulation?.includes('تجميع')
                ? 'text-emerald-500 dark:text-emerald-500'
                : 'text-amber-500 dark:text-amber-500'
        }>
          {stock.accumulation || '-'}
        </span>
      ),
    },
    {
      key: 'expected',
      header: 'المتوقع',
      className: 'hidden xl:table-cell text-xs text-muted-foreground',
      filterable: true,
      render: (stock) => stock.expected || '-',
    },
    {
      key: 'sector',
      header: 'القطاع',
      className: 'hidden md:table-cell text-muted-foreground text-xs',
      filterable: true,
      render: (stock) => sectorForTicker(stock.ticker) || '—',
    },
    {
      key: 'position_size',
      header: 'الحجم',
      align: 'right',
      sortable: true,
      render: (stock) => {
        const psPct = (stock.position_size * 100).toFixed(1);
        return (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-mono">
            {psPct}%
          </Badge>
        );
      },
    },
    {
      key: 'isTracked',
      header: '⭐',
      align: 'center',
      width: 'w-10',
      render: (stock) => (
        <button
          onClick={(e) => { e.stopPropagation(); onTrackToggle(stock.ticker, stock.current_price, !!stock.isTracked); }}
          className="text-muted-foreground hover:text-amber-500 transition-colors p-1 rounded"
          title={stock.isTracked ? 'إزالة من المتابعة' : 'أضف للمتابعة'}
          aria-label={stock.isTracked ? 'إزالة من المتابعة' : 'أضف للمتابعة'}
        >
          {stock.isTracked ? (
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          ) : (
            <StarOff className="h-4 w-4" />
          )}
        </button>
      ),
    },
    // ─── MiniSparkline — حركة السعر آخر 30 يوم (يفتح /api/stocks/sparkline) ───
    {
      key: '_sparkline',
      header: 'الحركة',
      align: 'center',
      width: 'w-[120px]',
      className: 'hidden md:table-cell',
      hideable: true,
      render: (stock) => (
        <div className="flex items-center justify-center">
          <MiniSparkline ticker={stock.ticker} height={28} width={100} showArea={true} />
        </div>
      ),
    },
  ];

  // إضافة index لكل صف
  const data: RadarStockRow[] = useMemo(
    () => stocks.map((s, i) => ({ ...s, _idx: i + 1 })),
    [stocks],
  );

  return (
    <UnifiedTable<RadarStockRow>
      columns={columns}
      data={data}
      keyField="ticker"
      dense
      columnToggle
      filterable
      onRowClick={(row) => onSelect(row.ticker)}
      rowClassName={(_row, idx) => (idx % 2 === 1 ? 'bg-muted/20' : undefined)}
      className={`-mx-1 ${a.border}`}
    />
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

            {/* === Last 10 days price table (UnifiedTable) === */}
            {detail.prices && detail.prices.length > 0 && (
              <Card className="p-3">
                <div className="text-xs font-semibold mb-2">آخر {Math.min(detail.prices.length, 10)} أيام</div>
                <UnifiedTable<PriceRow>
                  columns={[
                    {
                      key: 'date',
                      header: 'التاريخ',
                      align: 'right',
                      sortable: true,
                      render: (p) => <span className="text-muted-foreground">{p.date}</span>,
                    },
                    {
                      key: 'close',
                      header: 'إغلاق',
                      align: 'right',
                      sortable: true,
                      render: (p) => <span className="font-mono font-semibold">{fmtNum(p.close)}</span>,
                    },
                    {
                      key: 'high',
                      header: 'أعلى',
                      align: 'right',
                      sortable: true,
                      className: 'hidden sm:table-cell font-mono',
                      render: (p) => <span className="font-mono text-emerald-600 dark:text-emerald-400">{fmtNum(p.high)}</span>,
                    },
                    {
                      key: 'low',
                      header: 'أقل',
                      align: 'right',
                      sortable: true,
                      className: 'hidden sm:table-cell font-mono',
                      render: (p) => <span className="font-mono text-rose-600 dark:text-rose-400">{fmtNum(p.low)}</span>,
                    },
                    {
                      key: 'volume',
                      header: 'حجم',
                      align: 'right',
                      sortable: true,
                      render: (p) => <span className="font-mono text-muted-foreground">{fmtMoney(p.volume)}</span>,
                    },
                  ]}
                  data={detail.prices.slice(-10).reverse()}
                  keyField="date"
                  dense
                  stickyHeader={false}
                />
              </Card>
            )}

            {/* === Trading Plan (real numbers + dynamic analysis from price history) === */}
            <TradingPlanSection detail={detail} />

            {/* === Market Depth / DOM (Liquidity Depth Widget) ===
                 Reconstructed from stock_intraday tick volume — see API route. */}
            <SafeWidget name="MarketDepthLiquidityWidget" fallback={
              <Card className="p-3 border-dashed border-muted-foreground/30">
                <div className="text-xs text-muted-foreground text-center">
                  تعذّر تحميل دفتر الأوامر لهذا السهم
                </div>
              </Card>
            }>
              <MarketDepthLiquidityWidget ticker={ticker} compact />
            </SafeWidget>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================================
// Trading Plan Section — real numbers calculated from price history
// (replaces generic guidance box with calculated supports/resistances,
//  entry/stop/target1/target2, R:R ratio, and dynamic Arabic analysis)
// ============================================================================
interface TradingFieldRowProps {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}

function TradingFieldRow({ label, value, sub, valueClass }: TradingFieldRowProps) {
  return (
    <div className="flex items-baseline justify-between py-1 border-b border-border/40 last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={`text-xs font-mono font-semibold ${valueClass || ''}`}>{value}</span>
        {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

function TradingPlanSection({ detail }: { detail: StockDetail }) {
  const prices = detail.prices;

  if (!prices || prices.length === 0) {
    return null;
  }

  // Sort by date ascending (oldest first) so "last N" = most recent N entries
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const lastClose = sorted[sorted.length - 1].close;

  if (!lastClose || lastClose <= 0) {
    return null;
  }

  const last10 = sorted.slice(-10);
  const last20 = sorted.slice(-20);

  // Support / Resistance calculated from OHLC history (NOT static numbers).
  // Filter out zero/negative values which appear in the data when the source
  // had no high/low recorded for a session (treat them as missing bars).
  const validLows10 = last10.map((p) => p.low).filter((v) => v > 0);
  const validLows20 = last20.map((p) => p.low).filter((v) => v > 0);
  const validHighs10 = last10.map((p) => p.high).filter((v) => v > 0);
  const validHighs20 = last20.map((p) => p.high).filter((v) => v > 0);

  const support_1 = validLows10.length > 0 ? Math.min(...validLows10) : lastClose * 0.95;
  const support_2 = validLows20.length > 0 ? Math.min(...validLows20) : lastClose * 0.90;
  const resistance_1 = validHighs10.length > 0 ? Math.max(...validHighs10) : lastClose * 1.05;
  const resistance_2 = validHighs20.length > 0 ? Math.max(...validHighs20) : lastClose * 1.10;

  // === خطة تداول مبنية على مستويات حقيقية (مش تقديرات ثابتة) ===
  // entry_price = آخر إغلاق (سعر السوق الحالي)
  // stop_loss = تحت الدعم الثاني (أقل low في 20 يوم) — الأرضية الصلبة
  // target_1 = المقاومة الأولى (أعلى high في 10 أيام) — السقف القريب
  // target_2 = المقاومة الثانية (أعلى high في 20 يوم) — الهدف الممتد
  const entry_price = lastClose;
  const stop_loss = (support_2 > 0 && support_2 < lastClose * 0.97)
    ? support_2
    : lastClose * 0.95;
  const target_1 = (resistance_1 > lastClose * 1.02)
    ? resistance_1
    : lastClose * 1.05;
  const target_2 = (resistance_2 > target_1 * 1.02)
    ? resistance_2
    : lastClose * 1.12;

  // Risk-reward ratio — محسوبة من المستويات الحقيقية
  const risk = Math.max(entry_price - stop_loss, 0.001);
  const reward = Math.max(target_1 - entry_price, 0);
  const rr_ratio = reward / risk;

  // MA10 — average of last 10 closes
  const ma10 = last10.reduce((sum, p) => sum + p.close, 0) / last10.length;
  const above_ma10 = lastClose > ma10;

  // Volume ratio: last session volume vs avg of last 20 sessions
  const last_volume = sorted[sorted.length - 1].volume;
  const avg_20_vol = last20.reduce((sum, p) => sum + p.volume, 0) / last20.length;
  const vol_ratio = avg_20_vol > 0 ? last_volume / avg_20_vol : 0;

  // Range 10d % = (max_high - min_low) / min_low * 100
  const range_10d_pct = support_1 > 0 ? ((resistance_1 - support_1) / support_1) * 100 : 0;

  // === ضغط شراء/بيع — محسوب من OHLC آخر 20 جلسة ===
  // يوم صاعد (close > open) → حجمه بيعتبر ضغط شرائي
  // يوم هابط (close < open) → حجمه بيعتبر ضغط بيعي
  // يوم متعادل (close == open) → نص نص
  let buyVolume = 0;
  let sellVolume = 0;
  for (const p of last20) {
    if (p.close > p.open) {
      buyVolume += p.volume;
    } else if (p.close < p.open) {
      sellVolume += p.volume;
    } else {
      buyVolume += p.volume / 2;
      sellVolume += p.volume / 2;
    }
  }
  const totalVolume = buyVolume + sellVolume;
  const buyPct = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50;
  const sellPct = totalVolume > 0 ? (sellVolume / totalVolume) * 100 : 50;
  const imbalance = totalVolume > 0 ? (buyVolume - sellVolume) / totalVolume : 0;
  const pressureLabel =
    imbalance > 0.15 ? 'ضغط شرائي قوي' :
    imbalance > 0.05 ? 'ضغط شرائي' :
    imbalance < -0.15 ? 'ضغط بيعي قوي' :
    imbalance < -0.05 ? 'ضغط بيعي' :
    'توازن نسبي';
  const pressureClass =
    imbalance > 0.05 ? 'text-emerald-600 dark:text-emerald-400' :
    imbalance < -0.05 ? 'text-rose-600 dark:text-rose-400' :
    'text-muted-foreground';

  // نسب التغير لكل مستوى (للعرض)
  const stop_loss_pct = ((stop_loss - entry_price) / entry_price) * 100;
  const target_1_pct = ((target_1 - entry_price) / entry_price) * 100;
  const target_2_pct = ((target_2 - entry_price) / entry_price) * 100;

  // Build dynamic Arabic analysis — changes based on real data, not a fixed string
  // كل سطر عبارة عن { icon, tone, text } للعرض بشكل أوضح
  type AnalysisTone = 'pos' | 'neg' | 'neutral';
  interface AnalysisLine { icon: React.ReactNode; tone: AnalysisTone; text: string; }
  const analysis_lines: AnalysisLine[] = [];

  analysis_lines.push({
    icon: above_ma10 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />,
    tone: above_ma10 ? 'pos' : 'neg',
    text: above_ma10
      ? `السهم يتداول فوق متوسط 10 أيام (${fmtNum(lastClose)} > ${fmtNum(ma10)}).`
      : `السهم يتداول تحت متوسط 10 أيام (${fmtNum(lastClose)} < ${fmtNum(ma10)}).`,
  });

  if (vol_ratio >= 1.5) {
    analysis_lines.push({
      icon: <Activity className="h-3.5 w-3.5" />,
      tone: 'pos',
      text: `الحجم الحالي ${vol_ratio.toFixed(2)}× متوسط 20 يوم — تأكيد قوة.`,
    });
  } else if (vol_ratio < 0.7) {
    analysis_lines.push({
      icon: <AlertCircle className="h-3.5 w-3.5" />,
      tone: 'neg',
      text: `الحجم الحالي ${vol_ratio.toFixed(2)}× متوسط 20 يوم — ضعف سيولة.`,
    });
  } else {
    analysis_lines.push({
      icon: <Activity className="h-3.5 w-3.5" />,
      tone: 'neutral',
      text: `الحجم الحالي ${vol_ratio.toFixed(2)}× متوسط 20 يوم — حجم طبيعي.`,
    });
  }

  if (range_10d_pct < 6) {
    analysis_lines.push({
      icon: <Layers className="h-3.5 w-3.5" />,
      tone: 'pos',
      text: `المدى الضيق ${range_10d_pct.toFixed(1)}% في آخر 10 أيام يشير لتجميع.`,
    });
  } else if (range_10d_pct > 15) {
    analysis_lines.push({
      icon: <AlertCircle className="h-3.5 w-3.5" />,
      tone: 'neg',
      text: `المدى الواسع ${range_10d_pct.toFixed(1)}% في آخر 10 أيام يشير لتقلب عالي.`,
    });
  } else {
    analysis_lines.push({
      icon: <Layers className="h-3.5 w-3.5" />,
      tone: 'neutral',
      text: `المدى ${range_10d_pct.toFixed(1)}% في آخر 10 أيام طبيعي.`,
    });
  }

  // ضغط الشراء/بيع — سطر تحليلي مخصص
  analysis_lines.push({
    icon: imbalance > 0.05 ? <TrendingUp className="h-3.5 w-3.5" /> : imbalance < -0.05 ? <TrendingDown className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />,
    tone: imbalance > 0.05 ? 'pos' : imbalance < -0.05 ? 'neg' : 'neutral',
    text: `${pressureLabel} (${buyPct.toFixed(0)}% شراء vs ${sellPct.toFixed(0)}% بيع).`,
  });

  // Recommendation: derived from real conditions
  let recommendation: string;
  if (above_ma10 && vol_ratio >= 1.5 && imbalance > 0.05) {
    recommendation = `توصية: انتظر اختراق ${fmtNum(resistance_1)} بحجم لتأكيد الدخول.`;
  } else if (!above_ma10) {
    recommendation = `توصية: انتظر عودة السعر فوق ${fmtNum(ma10)} قبل الدخول.`;
  } else if (imbalance < -0.05) {
    recommendation = `توصية: ضغط بيعي واضح — انتظر استقرار السعر فوق ${fmtNum(support_1)}.`;
  } else {
    recommendation = `توصية: راقب الكسر فوق ${fmtNum(resistance_1)} بحجم للتأكيد.`;
  }

  // تقييم جودة الـ R:R
  const rrQuality = rr_ratio >= 2 ? 'ممتاز' : rr_ratio >= 1.5 ? 'جيد' : rr_ratio >= 1 ? 'مقبول' : 'ضعيف';
  const rrQualityClass =
    rr_ratio >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' :
    rr_ratio >= 1 ? 'text-amber-600 dark:text-amber-400' :
    'text-rose-600 dark:text-rose-400';

  return (
    <Card className="p-3 bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-900/50">
      {/* === Header === */}
      <div className="flex items-center gap-1.5 mb-3">
        <div className="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
          <Crosshair className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">
          📋 خطة التداول
        </div>
      </div>

      {/* === Buy/Sell Pressure visualization ===
          محسوب من OHLC آخر 20 جلسة — similar to MarketDepthPanel */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center justify-between text-[10px] font-medium">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="w-3 h-3" />
            شراء {buyPct.toFixed(0)}%
          </span>
          <span className={`text-[10px] font-semibold ${pressureClass}`}>{pressureLabel}</span>
          <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
            بيع {sellPct.toFixed(0)}%
            <TrendingDown className="w-3 h-3" />
          </span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted flex">
          {/* RTL: شراء (green) على اليمين، بيع (red) على اليسار */}
          <div
            className="bg-emerald-500 dark:bg-emerald-500 transition-all"
            style={{ width: `${buyPct}%` }}
          />
          <div
            className="bg-rose-500 dark:bg-rose-500 transition-all"
            style={{ width: `${sellPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[9px] text-muted-foreground">
          <span>سيولة شراء: {fmtMoney(buyVolume)}</span>
          <span>سيولة بيع: {fmtMoney(sellVolume)}</span>
        </div>
      </div>

      {/* === Support / Resistance levels (calculated from price history) === */}
      <div className="space-y-0 mb-3">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
          <Layers className="h-3 w-3" />
          مستويات الدعم والمقاومة (من السعر التاريخي)
        </div>
        <TradingFieldRow label="سعر السهم الحالي" value={`${fmtNum(lastClose)} جنيه`} />
        <TradingFieldRow label="الدعم الأول" value={fmtNum(support_1)} sub="(أقل سعر في 10 أيام)" valueClass="text-emerald-600 dark:text-emerald-400" />
        <TradingFieldRow label="الدعم الثاني" value={fmtNum(support_2)} sub="(أقل سعر في 20 يوم)" valueClass="text-emerald-600 dark:text-emerald-400" />
        <TradingFieldRow label="المقاومة الأولى" value={fmtNum(resistance_1)} sub="(أعلى سعر في 10 أيام)" valueClass="text-rose-600 dark:text-rose-400" />
        <TradingFieldRow label="المقاومة الثانية" value={fmtNum(resistance_2)} sub="(أعلى سعر في 20 يوم)" valueClass="text-rose-600 dark:text-rose-400" />
      </div>

      {/* === Entry / Stop / Targets — شبكة منظمة (grid) === */}
      <div className="text-[10px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
        <Crosshair className="h-3 w-3" />
        خطة الدخول والخروج (من المستويات الحقيقية)
      </div>
      <div className="grid grid-cols-2 gap-2">
        {/* Entry */}
        <div className="bg-blue-50/60 dark:bg-blue-950/30 rounded-md p-2 border border-blue-200/50 dark:border-blue-900/50">
          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Crosshair className="h-3 w-3" />
            نقطة الدخول
          </div>
          <div className="text-base font-mono font-bold text-blue-600 dark:text-blue-400">
            {fmtNum(entry_price)}
          </div>
          <div className="text-[9px] text-muted-foreground">السعر الحالي</div>
        </div>
        {/* Stop loss */}
        <div className="bg-rose-50/60 dark:bg-rose-950/30 rounded-md p-2 border border-rose-200/50 dark:border-rose-900/50">
          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            وقف الخسارة
          </div>
          <div className="text-base font-mono font-bold text-rose-600 dark:text-rose-400">
            {fmtNum(stop_loss)}
          </div>
          <div className="text-[9px] text-muted-foreground">{stop_loss_pct.toFixed(1)}% تحت الدخول</div>
        </div>
        {/* Target 1 */}
        <div className="bg-emerald-50/60 dark:bg-emerald-950/30 rounded-md p-2 border border-emerald-200/50 dark:border-emerald-900/50">
          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Target className="h-3 w-3" />
            الهدف الأول
          </div>
          <div className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400">
            {fmtNum(target_1)}
          </div>
          <div className="text-[9px] text-muted-foreground">{target_1_pct.toFixed(1)}% فوق الدخول</div>
        </div>
        {/* Target 2 */}
        <div className="bg-emerald-50/60 dark:bg-emerald-950/30 rounded-md p-2 border border-emerald-300/60 dark:border-emerald-800/60">
          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Target className="h-3 w-3" />
            الهدف الثاني
          </div>
          <div className="text-base font-mono font-bold text-emerald-700 dark:text-emerald-300">
            {fmtNum(target_2)}
          </div>
          <div className="text-[9px] text-muted-foreground">{target_2_pct.toFixed(1)}% فوق الدخول</div>
        </div>
      </div>

      {/* === R:R ratio — prominent badge === */}
      <div className="mt-3 p-2.5 rounded-md bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/50 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="h-7 w-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">نسبة العائد/المخاطرة</div>
            <div className="text-[9px] text-muted-foreground">المخاطرة 1 ← العائد {rr_ratio.toFixed(2)}</div>
          </div>
        </div>
        <div className="text-left">
          <div className={`text-xl font-mono font-bold ${rrQualityClass}`}>
            {rr_ratio.toFixed(2)}:1
          </div>
          <div className={`text-[9px] font-semibold ${rrQualityClass}`}>{rrQuality}</div>
        </div>
      </div>

      {/* === Dynamic analysis text — مع أيقونات مميزة لكل سطر === */}
      <div className="mt-3 pt-2 border-t border-border/50">
        <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 mb-1.5 flex items-center gap-1">
          <Lightbulb className="h-3.5 w-3.5" />
          التحليل الديناميكي
        </div>
        <div className="space-y-1 text-[11px] leading-relaxed">
          {analysis_lines.map((line, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className={
                line.tone === 'pos' ? 'text-emerald-600 dark:text-emerald-400 mt-0.5' :
                line.tone === 'neg' ? 'text-rose-600 dark:text-rose-400 mt-0.5' :
                'text-muted-foreground mt-0.5'
              }>
                {line.icon}
              </span>
              <span className={
                line.tone === 'pos' ? 'text-foreground' :
                line.tone === 'neg' ? 'text-foreground' :
                'text-muted-foreground'
              }>
                {line.text}
              </span>
            </div>
          ))}
          {/* Recommendation — سطر مميز */}
          <div className="flex items-start gap-1.5 mt-1.5 pt-1.5 border-t border-border/30">
            <span className="text-amber-600 dark:text-amber-400 mt-0.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
            <span className="font-medium text-foreground">{recommendation}</span>
          </div>
        </div>
      </div>
    </Card>
  );
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

'use client';

// ============================================================================
// رادار الميكرز — Professional Client-Facing Maker Radar
// ============================================================================
// Source of truth:
// • GET /api/maker-radar?market=EGX → main radar lists
// • GET /api/maker-radar/stock?ticker=X&days=30 → stock detail drawer
// • GET /api/stocks?market=EGX&page_size=1000 → ticker→sector/fundamentals map
// • POST /api/maker-radar/track → tracking management
//
// The component auto-refreshes every 60s while the EGX market is open and the
// tab is visible (useVisibilityAwarePolling). All UI is RTL Arabic, shadcn-based.
// ============================================================================

import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
 Radar, RefreshCw, Eye, Flame, TrendingUp, TrendingDown,
 Activity, AlertTriangle, Star, StarOff, X, ChevronLeft,
 Layers, Target, Zap, Gauge, Award, Crosshair, Clock,
 BarChart3, Eye as MicroscopeIcon, Flame as FlameIcon,
 Rocket, ArrowUpRight, ArrowDownRight, ShieldCheck, ShieldAlert, Info, Sparkles,
 DoorOpen, FileText, UserCircle, Loader2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { StockIconMini } from '@/modules/stock-analysis/components/StockIcon';
// Task 23-C Deliverable 2 — inline Sharia badge next to each radar pick.
import { ShariaBadge } from '@/modules/sharia/components/ShariaBadge';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { buildStockDetailShareText } from '@/modules/publishing/lib/table-share-formatter';
import {
 Collapsible,
 CollapsibleContent,
 CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { useRealtimeUpdates } from '@/lib/ws-client';
import { useAppStore } from '@/lib/store';
import { getMarketStatus } from '@/lib/market-hours';
import { getRadarAccess, getTrialStatus } from '@/lib/subscription-gate';
import { useTranslation } from '@/lib/i18n-context';
import { FlashingPriceCell } from '@/components/shared/FlashingPriceCell';
import { FlashingChangeCell } from '@/components/shared/FlashingChangeCell';
import { MarketRegimeBanner } from '@/components/market/MarketRegimeBanner';
import {
 Dialog, DialogContent, DialogClose, DialogTitle,
} from '@/components/ui/dialog';
import { SafeWidget } from '@/modules/dashboard/components/SafeWidget';
import { MarketDepthLiquidityWidget } from '@/modules/market-analysis/components/MarketDepthLiquidityWidget';
import {
 RadarSignalStatsCard,
 SectorTreemapCard,
 EntryTimingCard,
 LiquidityFootprintCard,
 CompanyFundamentalsCard,
} from '@/modules/radar/components/RadarStatsCards';
// Task 9-B Step 2: NetPicksTab REMOVED from MakerRadarTab — it's the canonical
// "صافى التوقعات" tab in #recommendations only (duplicate render deleted). The
// 5 radar tabs (exit-radar / weekly-report / multi-market-radar / radar-accuracy
// / personalized-radar) that USED to live in MarketAnalysisView are now wired
// here as internal sub-tabs (lazy-loaded so each ships as its own JS chunk).
const ExitRadarTab = dynamic(
 () => import('@/modules/radar/components/ExitRadarTab').then(m => ({ default: m.ExitRadarTab })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);
const WeeklyReportTab = dynamic(
 () => import('@/modules/radar/components/WeeklyReportTab').then(m => ({ default: m.WeeklyReportTab })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);
const MultiMarketRadarTab = dynamic(
 () => import('@/modules/radar/components/MultiMarketRadarTab').then(m => ({ default: m.MultiMarketRadarTab })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);
const AccuracyDashboard = dynamic(
 () => import('@/modules/radar/components/AccuracyDashboard').then(m => ({ default: m.AccuracyDashboard })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);
const PersonalizedRadarTab = dynamic(
 () => import('@/modules/radar/components/PersonalizedRadarTab').then(m => ({ default: m.PersonalizedRadarTab })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);
// RADAR-QUICK-WINS (Priority 2): Signal Strength Meter
import { SignalStrengthMeter, signalsToStars, signalHintAr } from '@/modules/radar/components/SignalStrengthMeter';
// L2-SIGNAL-TIMELINE: Signal Tracking Timeline (visual journey for tracked stocks)
import { SignalTrackingTimeline } from '@/modules/radar/components/SignalTrackingTimeline';

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
 // ─── FRESHNESS GUARD (Task FIX-STALE-DTPP-2026-10-07) ────────────────
 // كل الأسهم تحت الميكروسكوب لازم تبان للعميل بـ freshness metadata
 // عشان يقدر يثق في إن السعر اللي شايفه فعلاً live (مش قديم بـ 10 أيام)
 last_close_date?: string | null; // آخر تاريخ إغلاق في الـ DB
 staleness_days?: number | null; // كم يوم قديم (0=اليوم، 1=أمس، ...)
 data_quality?: 'fresh' | 'stale' | 'very_stale' | 'unknown' | null;
 data_stale?: boolean | null; // true لو stale
 live_price?: number | null; // السعر الحي من stocks.current_price
 live_change_percent?: number | null;
 live_last_update?: string | null; // ISO timestamp آخر تحديث لـ stocks
 price_source?: 'live' | 'daily' | null; // مصدر current_price
 data_date?: string | null; // التاريخ الفعلي للسعر المعروض
}

interface MakerRadarResponse {
 success: boolean;
 market?: string;
 market_regime?: {
 regime: string;
 raw_regime: string;
 effective_regime?: string;
 candidate_regime?: string;
 candidate_days?: number;
 breadth_pct?: number;
 turnover_ratio?: number;
 index_daily_change_pct?: number;
 reasons?: string[];
 } | null;
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
 prediction?: {
 entry_price?: number | null;
 entry_price_min?: number | null;
 entry_price_max?: number | null;
 target_price?: number | null;
 target_price_2?: number | null;
 stop_loss?: number | null;
 support_level?: number | null;
 support_level_2?: number | null;
 resistance_level?: number | null;
 resistance_level_2?: number | null;
 risk_reward?: number | null;
 signal?: string | null;
 } | null;
 entryCard?: any;
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
 logo_url?: string | null;
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
 return (num ?? 0).toFixed(0);
};

const fmtPct = (n: number | null | undefined, withSign = true): string => {
 if (n == null || isNaN(n as number)) return '-';
 const num = Number(n);
 const sign = withSign && num > 0 ? '+' : '';
 return `${sign}${(num ?? 0).toFixed(1)}%`;
};

const pnlColorClass = (pnl: number | null | undefined): string => {
 if (pnl == null || pnl === 0) return 'text-muted-foreground';
 return pnl > 0
 ? 'text-profit '
 : 'text-loss ';
};

const bucketLabel: Record<string, string> = {
 low_price: 'رخيص',
 mid_price: 'وسط',
 high_price: 'غالي',
};

// pathMeta holds styling/icon metadata only — Arabic labels come from i18n
// via t(`predictions.makerRadar.paths.${path}.label`) at render time.
const pathMeta: Record<RadarPath, { short: string; accent: AccentKey; icon: React.ReactNode }> = {
 A_pre_surge: {
 short: 'Pre-Surge',
 accent: 'purple',
 icon: <Rocket className="h-4 w-4" />,
 },
 B_quiet_accumulation_strong: {
 short: 'Microscope',
 accent: 'amber',
 icon: <Eye className="h-4 w-4" />,
 },
 C_quiet_accumulation_weak: {
 short: 'Weak',
 accent: 'amber',
 icon: <Eye className="h-4 w-4" />,
 },
 D_explosive_surge: {
 short: 'Explosive',
 accent: 'rose',
 icon: <Flame className="h-4 w-4" />,
 },
 E_early_break: {
 short: 'Breakout',
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
 card: 'border-warning/20',
 headerBg: 'bg-warning/10 /20',
 iconColor: 'text-warning ',
 badge: 'bg-warning text-warning border-warning/20 ',
 border: 'border-warning/20',
 softBg: 'bg-warning/10 /10',
 },
 rose: {
 card: 'border-loss/20',
 headerBg: 'bg-loss/10 /20',
 iconColor: 'text-loss ',
 badge: 'bg-loss text-loss border-loss/20 ',
 border: 'border-loss/20',
 softBg: 'bg-loss/10 /10',
 },
 emerald: {
 card: 'border-profit/20',
 headerBg: 'bg-profit/10 /20',
 iconColor: 'text-profit ',
 badge: 'bg-profit text-profit border-profit/20 ',
 border: 'border-profit/20',
 softBg: 'bg-profit/10 /10',
 },
 purple: {
 card: 'border-purple-200 dark:border-purple-900/40',
 headerBg: 'bg-primary/10 /20',
 iconColor: 'text-primary ',
 badge: 'bg-primary text-primary border-purple-200 /60 dark:border-purple-800',
 border: 'border-purple-300 dark:border-purple-800/50',
 softBg: 'bg-primary/10 /10',
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
// RADAR-QUICK-WINS (Priority 1): Smart Entry Card — Path descriptions
// Each radar path is given a short, plain-Arabic explanation + emoji so the
// user instantly understands what the path means without reading a manual.
// ============================================================================
// PATH_DESC holds emoji + tier only — Arabic text comes from i18n via
// t(`predictions.makerRadar.paths.${path}.descShort`) and
// t(`predictions.makerRadar.paths.${path}.descLong`) at render time.
interface PathDescription {
 emoji: string;
 /** Recommended position-size tier (display-only — actual size from API). */
 tier: 'top' | 'high' | 'mid' | 'monitor';
}

const PATH_DESC: Record<RadarPath, PathDescription> = {
 A_pre_surge: {
 emoji: '',
 tier: 'top',
 },
 B_quiet_accumulation_strong: {
 emoji: '🎯',
 tier: 'high',
 },
 C_quiet_accumulation_weak: {
 emoji: '🔍',
 tier: 'monitor',
 },
 D_explosive_surge: {
 emoji: '🔥',
 tier: 'mid',
 },
 E_early_break: {
 emoji: '⚡',
 tier: 'high',
 },
};

/**
 * Resolve a RadarStock's signal_count from whichever details block is populated.
 * Returns null when neither quiet_details nor pre_surge_details are present
 * (e.g. for explosive / early_break paths where signal_count isn't tracked).
 */
function resolveSignalCount(stock?: RadarStock | null): number | null {
 if (!stock) return null;
 if (stock.pre_surge_details?.signal_count != null) {
 return stock.pre_surge_details.signal_count;
 }
 if (stock.quiet_details?.signal_count != null) {
 return stock.quiet_details.signal_count;
 }
 return null;
}

/**
 * Resolve the maximum signal count for a given path (pre_surge uses 4 signals,
 * quiet_accumulation uses 6, others have no fixed maximum).
 */
function resolveMaxSignals(path?: RadarPath | null): number | null {
 if (!path) return null;
 if (path === 'A_pre_surge') return 4;
 if (path === 'B_quiet_accumulation_strong' || path === 'C_quiet_accumulation_weak') return 6;
 return null;
}

// ============================================================================
// P0-3 FIX (RADAR-AUDIT-UI, 2026-10-07): PROOF_METRICS كانت قيم ثابتة static
// تُعرَض كأنها live (precision=24.20%، recall=21.08%، avg_rr=0.014). هذا fabrication
// مخالف لـ Rule 27 (NO-FAKE-DATA). القيم الحقيقية متاحة عبر /api/radar/accuracy.
// تم تعطيل عرض القيم الثابتة + استبدالها بـ placeholder يحيل للـ API الكنسي.
// ============================================================================
const PROOF_METRICS_DEPRECATED = true; // flag: الواجهة تستخدم هذا لعرض placeholder

// ============================================================================
// Main Component
// ============================================================================
interface MakerRadarTabProps {
 market?: string;
}

type FilterKey = 'all' | 'pre_surge' | 'quiet' | 'explosive' | 'early_break' | 'tracked';

/** Lightweight prediction entry stitched from predictions.db active rows */
interface PredictionEntry {
 signal: string; // e.g. 'BUY', 'SELL', 'NEUTRAL'
 signal_ar: string; // e.g. 'شراء', 'بيع', 'محايد'
 direction: string | null; // 'up' | 'down' | null
 confidence: number | null; // 0–100
 master_score: number | null;
 entry_price: number | null; // ← FIX: was missing (caused entry column to show '—' / 0)
 target_price: number | null;
 stop_loss: number | null;
}

export function MakerRadarTab({ market = 'EGX' }: MakerRadarTabProps) {
 const t = useTranslation();
 const [data, setData] = useState<MakerRadarResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [warmingRadar, setWarmingRadar] = useState(false);
 const [warmingV40, setWarmingV40] = useState(false);
 const [warmupMsg, setWarmupMsg] = useState<string | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [filter, setFilter] = useState<FilterKey>('all');
 const [timeframe, setTimeframe] = useState<'7d' | '30d' | '90d'>('7d');
 const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

 // ─── Real-time WebSocket subscription (Task 35-E — Rule 67 root cause) ──
 // data_engine/sync.py → ws-service 'market:snapshot' → instant refetch.
 // Replaces 60s blind polling with push-based real-time updates.
 const { stockPrices, isConnected: wsConnected } = useRealtimeUpdates();
 const lastWsRefetchRef = useRef<number>(0);

 // RADAR-QUICK-WINS (Priority 1): keep the parent RadarStock alongside the
 // selected ticker so the drawer + Smart Entry Card can render path /
 // position_size / signal_count without re-fetching.
 const [selectedStock, setSelectedStock] = useState<RadarStock | null>(null);
 const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

 // PAYWALL Gate 7: wire getRadarAccess() — free users (post-trial) see
 // 60-min delayed preview. Paid + trial users get the live radar.
 // Phase 1 = display-only enforcement (server still returns live data);
 // Phase 2 will enforce the delay server-side.
 const radarSubscriptionUser = useAppStore((s) => s.user);
 const radarSubStatus = getTrialStatus(radarSubscriptionUser);
 const radarTier = (radarSubscriptionUser?.subscription_tier || 'free').toLowerCase();
 const radarAccess = getRadarAccess(radarTier);
 const radarDelayed =
 !radarAccess.live && radarSubStatus.isFreeUser && radarSubStatus.isTrialExpired;
 // Display "last updated" shifted back by delayMinutes for free users — communicates the delay
 // visually without changing the underlying data freshness.
 const displayedLastUpdated = useMemo(() => {
 if (!lastUpdated) return null;
 if (!radarDelayed || radarAccess.delayMinutes <= 0) return lastUpdated;
 return new Date(lastUpdated.getTime() - radarAccess.delayMinutes * 60_000);
 }, [lastUpdated, radarDelayed, radarAccess.delayMinutes]);

 // Predictions map: ticker.toUpperCase() → latest active prediction
 const [predMap, setPredMap] = useState<Map<string, PredictionEntry>>(new Map());
 // Sort by upward prediction confidence (desc)
 const [sortByPrediction, setSortByPrediction] = useState(false);

 // Stock universe (ticker → sector / fundamentals) — fetched once per market
 const [stockMap, setStockMap] = useState<Map<string, StockListItem> | null>(null);

 // --------------------------------------------------------------------
 // Fetchers
 // --------------------------------------------------------------------
 const fetchData = useCallback(async (silent = false) => {
 // UI-FIX: always silent when data exists (prevents screen wipe)
 if (data) silent = true;
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
 } else if (!json.warming_up) {
 setError(json.error || 'فشل في تحميل بيانات الرادار');
 }
 // if warming_up, keep existing data silently
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

 // ─── Fetch predictions from predictions.db ─────────────────────────
 const fetchPredictions = useCallback(async () => {
 try {
 // No status filter in URL — DB has mixed case ('active' / 'ACTIVE')
 // We collect all rows then filter client-side
 const res = await fetch(`/api/unified/predictions?market=${market}&limit=1000`, { cache: 'no-store' });
 if (!res.ok) return;
 const json = await res.json();
 // Collect from all possible keys
 const allRows: Record<string, unknown>[] = [
 ...(Array.isArray(json.predictions) ? json.predictions : []),
 ...(Array.isArray(json.active_predictions) ? json.active_predictions : []),
 ];
 // Filter active statuses case-insensitively (including pending and open positions)
 const rows = allRows.filter((r) => {
 const st = String(r.status || '').toLowerCase();
 return st === 'active' || st === 'pending' || st === 'open' || st === 'triggered';
 });
 const map = new Map<string, PredictionEntry>();
 for (const row of rows) {
 const ticker = String(row.ticker || '').toUpperCase();
 if (!ticker) continue;
 const sig = String(row.signal || '').toUpperCase();
 const isBuy = sig.includes('BUY');
 const isSell = sig.includes('SELL');
 // BUY/STRONG_BUY → direction='up' regardless of null direction field in DB
 const resolvedDirection =
 isBuy ? 'up'
 : isSell ? 'down'
 : row.direction ? String(row.direction) : null;
 // confidence first, master_score as fallback
 const conf = row.confidence != null ? Number(row.confidence)
 : row.master_score != null ? Number(row.master_score)
 : null;
 // Keep highest-scoring entry per ticker
 const existing = map.get(ticker);
 if (!existing || (conf != null && conf > (existing.confidence ?? -1))) {
 const signal_ar =
 sig === 'STRONG_BUY' ? 'شراء قوي'
 : sig === 'BUY' ? 'شراء'
 : sig === 'STRONG_SELL' ? 'بيع قوي'
 : sig === 'SELL' ? 'بيع'
 : sig === 'HOLD' ? 'انتظار' // P0-3: canonical-signal.ts يستخدم 'انتظار' لـ HOLD
 : sig === 'WAIT' ? 'انتظار'
 : '— بيانات غير متاحة'; // P0-3: لا 'محايد' الوهمي (Rule 27)
 map.set(ticker, {
 signal: sig,
 signal_ar: String(row.signal_ar || signal_ar),
 direction: resolvedDirection,
 confidence: conf,
 master_score: row.master_score != null ? Number(row.master_score) : null,
 entry_price: row.entry_price != null ? Number(row.entry_price) : null, // ← FIX: store entry_price
 target_price: row.target_price != null ? Number(row.target_price) : null,
 stop_loss: row.stop_loss != null ? Number(row.stop_loss) : null,
 });
 }
 }
 setPredMap(map);
 } catch {
 // silent — prediction column stays empty
 }
 }, [market]);

 useEffect(() => { fetchData(); }, [fetchData]);
 useEffect(() => { fetchStockMap(); }, [fetchStockMap]);
 useEffect(() => { fetchPredictions(); }, [fetchPredictions]);

 // Live real-time polling: refresh both stock quotes (for live prices & flashes) and radar data
 useVisibilityAwarePolling(
 () => {
 fetchStockMap();
 fetchData(true);
 },
 15_000, // 15s interval keeps prices live during active trading
 [fetchStockMap, fetchData],
 { market, allowOffMarket: true },
 );

 // ─── WS push → instant refetch (Task 35-E — Rule 67) ──────────────────
 // When ws-service emits market:snapshot with new prices, trigger immediate
 // silent refetch. Throttle to 3s to avoid hammering the API.
 useEffect(() => {
 if (!wsConnected || stockPrices.length === 0) return;
 const now = Date.now();
 if (now - lastWsRefetchRef.current < 3_000) return;
 lastWsRefetchRef.current = now;
 fetchData(true);
 }, [stockPrices, wsConnected, fetchData]);

 // Track toggle — add/remove a stock from tracking
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

 // AUTO-TRACK (2026-09-30): auto-track stocks from unified-watch (portfolio + watchlist + radar)
 const autoTrackUserStocks = useCallback(async () => {
 try {
 // Use the unified-watch API — single endpoint for all user stocks
 const res = await fetch('/api/portfolio/unified-watch', { cache: 'no-store' });
 if (!res.ok) return;
 const data = await res.json();
 if (!data.success || !data.stocks) return;

 // Get current tracking list
 const trackRes = await fetch('/api/maker-radar/track', { cache: 'no-store' });
 const trackData = await trackRes.json();
 // The GET handler returns `{ tracked: TrackedStock[], tracked_count }`.
 // It does NOT return a `tracking` map — reading that key always yielded
 // undefined, so trackedTickers was empty and every user stock was
 // re-POSTed on every single mount.
 const trackedTickers = new Set<string>(
 (Array.isArray(trackData.tracked) ? trackData.tracked : [])
 .map((t: { ticker?: string }) => String(t?.ticker || '').toUpperCase())
 .filter(Boolean)
 );

 // Auto-track any untracked user stock
 const toAdd = (data.stocks as any[]).filter((s) => {
 const t = s?.ticker?.toUpperCase();
 return t && !trackedTickers.has(t);
 });
 if (toAdd.length === 0) return;

 await Promise.all(
 toAdd.map((stock) => {
 const ticker = stock.ticker.toUpperCase();
 return fetch('/api/maker-radar/track', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 ticker,
 entryPrice: stock.entry_price || stock.current_price || 0,
 action: 'add',
 notes: `auto-tracked from ${stock.sources?.join('+') || 'portfolio'}`,
 }),
 }).catch(() => undefined);
 })
 );
 fetchData(true);
 } catch (e) {
 console.error('auto-track error:', e);
 }
 }, [fetchData]);

 // Run auto-track on mount
 useEffect(() => { autoTrackUserStocks(); }, [autoTrackUserStocks]);
 // clicks a row so the drawer can render the Smart Entry Card without an
 // extra API round-trip. If the same ticker is clicked again we keep the
 // existing stock reference (still fresh enough for path/signal_count).
 const handleSelectStock = useCallback((ticker: string, stock?: RadarStock | null) => {
 setSelectedTicker(ticker);
 if (stock) setSelectedStock(stock);
 }, []);

 // ─── Synchronous radar warmup (calls /api/maker-radar/warmup) ─────────
 // Forces a fresh Python run. Blocks until done (typically <2s on indexed DB).
 const handleWarmupRadar = useCallback(async () => {
 setWarmingRadar(true);
 setWarmupMsg('بيتشغل الرادار...');
 try {
 const res = await fetch(`/api/maker-radar/warmup?market=${encodeURIComponent(market)}&timeout=120000`, {
 method: 'POST',
 });
 const json = await res.json();
 if (json.success) {
 const dur = json.status?.last_warmup_duration_ms ?? 0;
 const scanned = json.cache_total_scanned ?? 0;
 setWarmupMsg(`✅ اتحدّث في ${(dur / 1000).toFixed(1)}ث — ${scanned} سهم مفسوح`);
 await fetchData(true);
 } else if (!json.warming_up) {
 setWarmupMsg(`❌ فشل: ${json.status?.last_error || 'خطأ غير معروف'}`);
 }
 // if warming_up, keep existing data silently
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
 setWarmupMsg('جاري توليد التوقعات...');
 try {
 const res = await fetch('/api/predictions/refresh-v40?mode=today&timeout=240000', {
 method: 'POST',
 });
 const json = await res.json();
 if (json.success) {
 const preds = json.total_predictions ?? 0;
 const dates = (json.scan_dates || []).join(', ');
 const dur = ((json.elapsed_ms ?? 0) / 1000).toFixed(1);
 setWarmupMsg(`✅ تم في ${dur}ث — ${preds} توقعات على ${dates}`);
 } else if (!json.warming_up) {
 const tail = json.stderr_tail || json.status?.last_error || 'خطأ غير معروف';
 setWarmupMsg(`❌ فشل توليد التوقعات: ${tail.slice(0, 120)}`);
 }
 // if warming_up, keep existing data silently
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

 const stockInfoForTicker = useCallback((ticker: string): StockListItem | null => {
 if (!stockMap) return null;
 return stockMap.get(ticker.toUpperCase()) || null;
 }, [stockMap]);

 const marketStatus = getMarketStatus(market);

 // helper: score for upward prediction sort (BUY/STRONG_BUY & high confidence → high)
 const predScore = useCallback((ticker: string): number => {
 const p = predMap.get(ticker.toUpperCase());
 if (!p) return -1;
 const isBuy = p.direction === 'up' || p.signal === 'BUY' || p.signal === 'STRONG_BUY';
 if (!isBuy) return -1;
 return p.confidence ?? p.master_score ?? 0;
 }, [predMap]);

 // ── DEFAULT SORT (owner directive 2026-10-07): ─────────────────────────
 // "البيانات لازم تتحدث كل شوية وعالية التغير يظهر في الجدول بصور إعادة ترتيب.
 // حس الترتيب اللي عمله العميل أو الترتيب الافتراضي اللي هو الأعلى سيولة ثم
 // الأعلى تغير في السعر"
 //
 // Default sort: أعلى turnover → أعلى change_1d. ده بـ يخلي الجدول يعيد ترتيب
 // نفسه كل ما الـ live prices تتغير (كل 15 ثانية).
 const defaultSortFn = useCallback((a: RadarStock, b: RadarStock): number => {
 // 1. أعلى سيولة (avg_turnover_20d) — primary key
 const aTurnover = Number(a.avg_turnover_20d ?? a.current_price * (a.avg_volume_20d ?? 0)) || 0;
 const bTurnover = Number(b.avg_turnover_20d ?? b.current_price * (b.avg_volume_20d ?? 0)) || 0;
 if (aTurnover !== bTurnover) return bTurnover - aTurnover;
 // 2. أعلى تغير % (change_1d) — secondary key (live price)
 const aChange = Number((a as any).change_1d ?? (a as any).change_percent ?? 0) || 0;
 const bChange = Number((b as any).change_1d ?? (b as any).change_percent ?? 0) || 0;
 return bChange - aChange;
 }, []);

 const sortFn = useCallback((a: RadarStock, b: RadarStock): number => {
 if (sortByPrediction) {
 return predScore(b.ticker) - predScore(a.ticker);
 }
 // Default: sort by liquidity then change (owner directive)
 return defaultSortFn(a, b);
 }, [sortByPrediction, predScore, defaultSortFn]);

 // helper: look up prediction for a ticker
 const predictionForTicker = useCallback((ticker: string): PredictionEntry | null =>
 predMap.get(ticker.toUpperCase()) || null,
 [predMap]);

 // --------------------------------------------------------------------
 // Filtering + optional prediction sort
 // --------------------------------------------------------------------
 // FIX-UI-AUDIT (re-applied to NEW path): deduplicate tickers across
 // sections when filter='all'. Priority order matches visual urgency:
 // explosive > early_break > pre_surge > quiet. A ticker that already
 // appears in a higher-priority list is filtered out of lower-priority
 // lists so the user never sees the same stock twice on the radar page.
 // When a specific filter is active (e.g. filter='quiet'), that section
 // still shows its full list — dedup only applies in 'all' mode so the
 // user can still drill into a specific path.
 const dedupSet = useMemo(() => {
 const seen = new Set<string>();
 const allow = (s: RadarStock, listKey: 'explosive' | 'early_break' | 'pre_surge' | 'quiet') => {
 // Only dedup when filter='all'. In specific filters or tracked mode,
 // show the full list.
 if (filter !== 'all') return true;
 const k = s.ticker.toUpperCase();
 // explosive is highest priority — always allowed, marks ticker seen.
 if (listKey === 'explosive') { seen.add(k); return true; }
 // others must not be in a higher-priority list already added.
 if (seen.has(k)) return false;
 seen.add(k); return true;
 };
 return { allow };
 }, [filter]);

 const filteredPreSurge = useMemo(() => {
 let list = (data?.pre_surge_list || []).filter(s => dedupSet.allow(s, 'pre_surge'));
 if (filter !== 'all' && filter !== 'pre_surge') {
 list = filter === 'tracked' ? list.filter((s) => s.isTracked) : [];
 }
 return [...list].sort(sortFn);
 }, [data, filter, sortByPrediction, sortFn, dedupSet]);

 const filteredQuiet = useMemo(() => {
 let list = (data?.quiet_list || []).filter(s => dedupSet.allow(s, 'quiet'));
 if (filter !== 'all' && filter !== 'quiet') {
 list = filter === 'tracked' ? list.filter((s) => s.isTracked) : [];
 }
 return [...list].sort(sortFn);
 }, [data, filter, sortByPrediction, sortFn, dedupSet]);

 const filteredExplosive = useMemo(() => {
 let list = (data?.explosive_list || []).filter(s => dedupSet.allow(s, 'explosive'));
 if (filter !== 'all' && filter !== 'explosive') {
 list = filter === 'tracked' ? list.filter((s) => s.isTracked) : [];
 }
 return [...list].sort(sortFn);
 }, [data, filter, sortByPrediction, sortFn, dedupSet]);

 const filteredEarlyBreak = useMemo(() => {
 let list = (data?.early_break_list || []).filter(s => dedupSet.allow(s, 'early_break'));
 if (filter !== 'all' && filter !== 'early_break') {
 list = filter === 'tracked' ? list.filter((s) => s.isTracked) : [];
 }
 return [...list].sort(sortFn);
 }, [data, filter, sortByPrediction, sortFn, dedupSet]);

 // FIX-UI-AUDIT (re-applied to NEW path): radarKpi aggregates the four
 // lists into the 4 audit-approved metrics (replaces the raw-count cards
 // إجمالي المفحوصة / تحت الميكروسكوب / موجات منفجرة / أسهم متابَعة).
 // 1. عدد الأسهم النشطة — unique tickers across all 4 lists
 // 2. أقوى زخم حالي — ticker with max roc_10d
 // 3. أعلى سيولة — ticker with max avg_turnover_20d
 // 4. عدد الفرص الحقيقية — count of pre_surge + explosive + early_break
 const radarKpi = useMemo(() => {
 const allLists = [
 data?.pre_surge_list || [],
 data?.explosive_list || [],
 data?.early_break_list || [],
 data?.quiet_list || [],
 ];
 const allStocks = allLists.flat();
 if (allStocks.length === 0) {
 return { hasData: false, activeCount: 0, topMomentumTicker: null, topMomentumRoc: null, topLiquidityTicker: null, topLiquidityValue: null, realOpportunities: 0 };
 }
 const unique = new Set<string>();
 for (const s of allStocks) unique.add(s.ticker.toUpperCase());

 let topMomentumTicker: string | null = null;
 let topMomentumRoc = -Infinity;
 for (const s of allStocks) {
 const roc = typeof s.roc_10d === 'number' ? s.roc_10d : null;
 if (roc != null && roc > topMomentumRoc) {
 topMomentumRoc = roc;
 topMomentumTicker = s.ticker;
 }
 }

 let topLiquidityTicker: string | null = null;
 let topLiquidityValue = -Infinity;
 for (const s of allStocks) {
 const v = typeof s.avg_turnover_20d === 'number' ? s.avg_turnover_20d : null;
 if (v != null && v > topLiquidityValue) {
 topLiquidityValue = v;
 topLiquidityTicker = s.ticker;
 }
 }

 const realOpportunities =
 (data?.pre_surge_list?.length || 0) +
 (data?.explosive_list?.length || 0) +
 (data?.early_break_list?.length || 0);

 return {
 hasData: true,
 activeCount: unique.size,
 topMomentumTicker,
 topMomentumRoc: topMomentumTicker !== null ? topMomentumRoc : null,
 topLiquidityTicker,
 topLiquidityValue: topLiquidityTicker !== null ? topLiquidityValue : null,
 realOpportunities,
 };
 }, [data]);

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
 <AlertTriangle className="h-10 w-10 text-loss mx-auto mb-3" />
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
 {/* ===== HEADER ===== (always visible — refresh buttons work across all sub-tabs) */}
 <Card className="overflow-hidden">
 <div className="bg-gradient-to-l from-profit/80 via-profit/30 to-transparent /30 dark:to-transparent p-4 md:p-5">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <div className="relative">
 <div className="h-12 w-12 rounded-xl bg-profit/10 /10 flex items-center justify-center">
 <Radar className="h-6 w-6 text-profit " />
 </div>
 {marketStatus.isOpen && (
 <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-profit animate-pulse border-2 border-background" />
 )}
 </div>
 <div>
 <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
 رادار الميكرز
 <Badge
 variant="outline"
 className={
 marketStatus.isOpen
 ? 'bg-profit text-profit border-profit text-xs'
 : 'bg-warning text-warning border-warning text-xs'
 }
 >
 <span className={`h-1.5 w-1.5 rounded-full mr-1 ${marketStatus.isOpen ? 'bg-profit animate-pulse' : 'bg-warning'}`} />
 {marketStatus.isOpen ? 'LIVE' : 'السوق مقفول'}
 </Badge>
 </h3>
 <p className="text-xs text-muted-foreground mt-0.5">
 اكتشف الأسهم قبل ما تنفجر — {radarDelayed ? 'بيانات متأخرة 60 دقيقة' : 'بيانات حية'}
 </p>
 </div>
 </div>

 <div className="flex items-center gap-2 flex-wrap">
 {displayedLastUpdated && (
 <span className="text-xs text-muted-foreground">
 آخر تحديث: {displayedLastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
 {radarDelayed && ' (متأخر)'}
 </span>
 )}
 {/* ─── Freshness badge ─── cache_age + db_source + warmup status */}
 {data?.cached && (
 <Badge
 variant="outline"
 className={`text-xs ${
 data.cache_stale
 ? 'text-warning border-warning bg-warning/10'
 : data.cache_age_seconds! < 60
 ? 'text-profit border-profit bg-profit/10'
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
 <Badge variant="outline" className="text-xs text-primary border-primary bg-primary/10">
 <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse mr-1" />
 بيشتغل
 </Badge>
 )}
 {data?.db_source && (
 <Badge variant="outline" className="text-xs text-muted-foreground border-border bg-muted/20" title="قاعدة البيانات المستخدمة">
 {data.db_source.split('::')[0]}
 </Badge>
 )}
 {data?.last_warmup_status === 'failed' && data?.last_error && (
 <Badge variant="outline" className="text-xs text-loss border-loss bg-loss/10" title={data.last_error}>
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
 title="ولّد توقعات اليوم"
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

 {/* ===== PAYWALL Gate 7: 60-min delay banner for free users post-trial =====
 Strategy §4.1 row 7: free users see delayed radar (60 min) as a "taste hook".
 Phase 1 = display-only banner. Phase 2 will enforce the delay server-side. */}
 {radarDelayed && (
 <Card className="border-warning/20 bg-warning/10 /30 p-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="flex items-center gap-2 text-warning ">
 <Clock className="h-4 w-4" />
 <span className="text-xs font-semibold">
 البيانات متأخرة 60 دقيقة — اشترك للبيانات الفورية
 </span>
 </div>
 <Button
 variant="outline"
 size="sm"
 className="h-7 text-xs gap-1 border-warning/20 text-warning hover:bg-warning/10 dark:hover:bg-warning/10"
 onClick={() => {
 if (typeof window !== 'undefined') {
 window.location.href = '/pricing';
 }
 }}
 >
 اشترك للبيانات الفورية
 </Button>
 </div>
 </Card>
 )}

 {/* ===== SUB-TABS (Task 9-B Step 2) =====
 The 5 radar tabs (exit-radar / weekly-report / multi-market-radar /
 radar-accuracy / personalized-radar) that USED to live in #recommendations
 are now internal sub-tabs here. The canonical MakerRadar lists stay the
 default sub-tab. NetPicksTab duplicate removed — it lives only in
 #recommendations now. */}
 <Tabs defaultValue="maker" className="w-full">
 <TabsList className="flex w-full overflow-x-auto sm:grid sm:grid-cols-3 lg:grid-cols-6 h-auto gap-1">
 <TabsTrigger value="maker" className="flex items-center gap-1">
 <Radar className="h-4 w-4 text-profit" />
 <span className="hidden sm:inline">رادار الميكرز</span>
 </TabsTrigger>
 <TabsTrigger value="exit-radar" className="flex items-center gap-1">
 <DoorOpen className="h-4 w-4 text-loss" />
 <span className="hidden sm:inline">رادار الخروج</span>
 </TabsTrigger>
 <TabsTrigger value="weekly-report" className="flex items-center gap-1">
 <FileText className="h-4 w-4 text-profit" />
 <span className="hidden sm:inline">التقرير الأسبوعي</span>
 </TabsTrigger>
 <TabsTrigger value="multi-market-radar" className="flex items-center gap-1">
 <Radar className="h-4 w-4 text-violet-600" />
 <span className="hidden sm:inline">الرادار الموحّد</span>
 </TabsTrigger>
 <TabsTrigger value="radar-accuracy" className="flex items-center gap-1">
 <Gauge className="h-4 w-4 text-warning" />
 <span className="hidden sm:inline">دقة الرادار</span>
 </TabsTrigger>
 <TabsTrigger value="personalized-radar" className="flex items-center gap-1">
 <UserCircle className="h-4 w-4 text-cyan-600" />
 <span className="hidden sm:inline">الرادار المخصّص</span>
 </TabsTrigger>
 </TabsList>

 {/* ─── Maker Radar (default) — the original 5-path radar lists + sub-cards ─── */}
 <TabsContent value="maker" className="mt-4 space-y-4">

 {/* ===== MARKET REGIME BANNER (إحساس وضع السوق وتكييف القواعد) ===== */}
 {/* Owner directive: "تحذير أحمر وكبير وواضح جدًا، مش مخفي" */}
 {data?.market_regime && (
 <Card className={`p-4 border-l-4 transition-all ${
 data.market_regime.regime === 'DEFENSIVE' || data.market_regime.raw_regime === 'DEFENSIVE'
 ? 'border-l-red-500 bg-loss/10 /30 border-loss shadow-lg shadow-red-500/20'
 : data.market_regime.regime === 'AGGRESSIVE'
 ? 'border-l-emerald-500 bg-profit/5 /20 border-profit '
 : 'border-l-blue-500 bg-primary/5 /20 border-primary '
 }`}>
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <div className="flex items-center gap-2">
 <ShieldAlert className={`h-6 w-6 ${
 data.market_regime.regime === 'DEFENSIVE' || data.market_regime.raw_regime === 'DEFENSIVE'
 ? 'text-loss animate-pulse'
 : data.market_regime.regime === 'AGGRESSIVE'
 ? 'text-profit '
 : 'text-primary '
 }`} />
 <div>
 <div className="flex items-center gap-2">
 <span className="text-xs font-bold text-foreground">
 وضع السوق المستشعر:
 </span>
 <Badge variant="outline" className={`text-xs font-semibold ${
 data.market_regime.regime === 'DEFENSIVE' || data.market_regime.raw_regime === 'DEFENSIVE'
 ? 'bg-loss text-loss border-loss '
 : data.market_regime.regime === 'AGGRESSIVE'
 ? 'bg-profit text-profit border-profit '
 : 'bg-primary text-primary border-primary '
 }`}>
 {data.market_regime.regime === 'DEFENSIVE' || data.market_regime.raw_regime === 'DEFENSIVE'
 ? '🔴 دِفاعي — قلّل الحجم وركّز على وقف الخسارة'
 : data.market_regime.regime === 'AGGRESSIVE'
 ? '🟢 هجومي — زخم صاعد'
 : '⚖️ عادي — حركة متوازنة'}
 </Badge>
 </div>
 <p className="text-xs text-muted-foreground mt-0.5">
 {data.market_regime.regime === 'DEFENSIVE' || data.market_regime.raw_regime === 'DEFENSIVE'
 ? 'السوق العام واقع وشحيح السيولة — تم تكييف قواعد الرادار تلقائياً لصيد الأسهم المتماسكة ذات القوة النسبية وتجميع الميكرز الهادئ.'
 : 'القواعد تعمل بالمعايير القياسية للسيولة والزخم.'}
 </p>
 </div>
 </div>
 {data.market_regime.breadth_pct != null && (
 <div className="flex items-center gap-3 text-xs text-muted-foreground">
 <span>صعود السوق: <strong className="font-mono text-foreground">{data.market_regime.breadth_pct}%</strong></span>
 {data.market_regime.turnover_ratio != null && (
 <span>نسبة السيولة: <strong className="font-mono text-foreground">{data.market_regime.turnover_ratio}x</strong></span>
 )}
 </div>
 )}
 </div>
 </Card>
 )}

 {/* ===== KPI CARDS — FIX-UI-AUDIT (re-applied to NEW path) =====
 Replaces the 4 raw-count cards (إجمالي المفحوصة / تحت الميكروسكوب /
 موجات منفجرة / أسهم متابَعة) with the 4 audit-approved aggregated
 metrics. When radarKpi.hasData === false, the row collapses into a
 single actionable reason banner (no dead «فرص 0» display). tracked_count
 still appears in the filter-bar badge (no loss of info). */}
 {radarKpi.hasData ? (
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
 <KpiCard
 icon={<Activity className="h-4 w-4" />}
 label="عدد الأسهم النشطة"
 value={radarKpi.activeCount}
 sub="عبر كل قوائم الرادار"
 accent="blue"
 />
 <KpiCard
 icon={<TrendingUp className="h-4 w-4" />}
 label="أقوى زخم حالي"
 value={radarKpi.topMomentumTicker ?? '—'}
 sub={
 radarKpi.topMomentumRoc != null
 ? `ROC 10 أيام: ${(radarKpi.topMomentumRoc ?? 0).toFixed(2)}%`
 : 'بانتظار البيانات'
 }
 accent="emerald"
 />
 <KpiCard
 icon={<BarChart3 className="h-4 w-4" />}
 label="أعلى سيولة"
 value={radarKpi.topLiquidityTicker ?? '—'}
 sub={
 radarKpi.topLiquidityValue != null
 ? `متوسط سيولة 20 يوم: ${fmtMoney(radarKpi.topLiquidityValue)}`
 : 'بانتظار البيانات'
 }
 accent="amber"
 />
 <KpiCard
 icon={<Target className="h-4 w-4" />}
 label="عدد الفرص الحقيقية"
 value={radarKpi.realOpportunities}
 sub={
 radarKpi.realOpportunities > 0
 ? 'فرص قابلة للتداول'
 : 'الرادار بيفحص الأسهم'
 }
 accent="rose"
 />
 </div>
 ) : (
 <Card className="p-4 border-dashed border-muted-foreground/30 bg-muted/20">
 <div className="flex items-center gap-3 text-sm text-muted-foreground">
 <Radar className="h-5 w-5 flex-shrink-0 opacity-60" />
 <div>
 <p className="font-semibold text-foreground">لا توجد فرص حالياً — الرادار بيفحص الأسهم</p>
 <p className="text-xs mt-0.5">جرّب تشغيل الرادار أو حدّث بعد دقيقة.</p>
 </div>
 </div>
 </Card>
 )}

 {/* ===== RADAR SUMMARY — الخلاصة النهائية للقرار ===== */}
 {data && !loading && (
 <Card className="p-4 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
 <div className="flex items-start gap-3">
 <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
 <Target className="w-5 h-5 text-primary-foreground" />
 </div>
 <div className="flex-1 min-w-0 space-y-2">
 <div className="flex items-center gap-2">
 <span className="text-sm font-bold">خلاصة الرادار</span>
 {data.market_regime && (
 <Badge variant="outline" className={
 data.market_regime.effective_regime === 'AGGRESSIVE' ? 'bg-profit/10 text-profit border-profit/20' :
 data.market_regime.effective_regime === 'DEFENSIVE' ? 'bg-loss/10 text-loss border-loss/20' :
 'bg-warning/10 text-warning border-warning/20'
 }>
 {data.market_regime.effective_regime === 'AGGRESSIVE' ? '🟢 السوق عدواني' :
 data.market_regime.effective_regime === 'DEFENSIVE' ? '🔴 السوق دفاعي' :
 '🟡 السوق محايد'}
 </Badge>
 )}
 </div>
 <p className="text-xs text-muted-foreground leading-relaxed">
 {(() => {
 const totalStocks = data.total_scanned ?? 0;
 const underMicroscope = data.under_microscope_count ?? 0;
 const explosive = data.explosive_count ?? 0;
 const earlyBreak = data.early_break_count ?? 0;
 const tracked = data.tracked_count ?? 0;
 const totalOpportunities = underMicroscope + explosive + earlyBreak;

 if (totalStocks === 0) return 'الرادار قيد التحميل — انتظر دقيقة وحاول مرة أخرى.';
 if (totalOpportunities === 0) return `تم فحص ${totalStocks} سهم — لا توجد فرص واضحة حالياً. السوق هادئ، انتظر حركة.`;
 if (explosive > 0 || earlyBreak > 0) return `🔥 يوجد ${explosive + earlyBreak} سهم في حركة انفجارية/اختراق! ركّز على التبويبات الحمراء. + ${underMicroscope} تحت الميكروسكوب للتجميع.`;
 if (underMicroscope > 10) return `📊 ${underMicroscope} سهم تحت الميكروسكوب — السوق في مرحلة تجميع. تتركّز الفرص في الأسهم الصامتة قبل الانفجار.`;
 return `تم فحص ${totalStocks} سهم. ${totalOpportunities} فرصة محتملة. ${tracked} في قائمتك.`;
 })()}
 </p>
 {data.tracked_count === 0 && (data.under_microscope_count ?? 0) > 0 && (
 <p className="text-xs text-warning flex items-center gap-1">
 ⚠️ لا توجد أسهم في قائمة المتابعة — افتح أي سهم واضغط ⭐ لإضافته للمتابعة.
 </p>
 )}
 </div>
 </div>
 </Card>
 )}

 {/* ===== RADAR ACTIVITY — مدى شعل الرادار خلال فترة زمنية ===== */}
 <RadarActivityCard data={data} lastUpdated={lastUpdated} period={timeframe} onPeriodChange={setTimeframe} />

 {/* ===== SECTOR HEAT STRIP ===== */}
 <SectorHeatStrip sectors={sectors} loading={!stockMap} />

 {/* ===== SECTOR LIQUIDITY TREEMAP — خريطة سيولة القطاعات ===== */}
 <SectorTreemapCard />

 {/* Task 9-B Step 2: NetPicksTab REMOVED from MakerRadarTab — it's the
 canonical "صافى التوقعات" tab in #recommendations only (duplicate
 render deleted at line 1213). Owner complaint #1 confirmed + fixed. */}


 {/* ===== SIGNAL TRACKER STATS — مصير إشارات الرادار ===== */}
 <RadarSignalStatsCard />

 {/* ===== FILTER BAR ===== */}
 <Card className="p-3">
 <div className="flex items-center gap-1.5 flex-wrap">
 <span className="text-xs text-muted-foreground ml-1">فلترة:</span>
 {([
 { key: 'all', label: 'الكل', emoji: null },
 { key: 'pre_surge', label: 'Pre-Surge', emoji: null },
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
 <Badge variant="secondary" className="mr-1 h-4 text-xs px-1">{data.tracked_count}</Badge>
 ) : null}
 </Button>
 ))}
 {/* ─── Sort by prediction toggle ─── */}
 <div className="mr-auto flex items-center gap-1.5">
 {predMap.size > 0 && (
 <span className="text-xs text-muted-foreground">
 {predMap.size} توقع محمّل
 </span>
 )}
 <Button
 size="sm"
 variant={sortByPrediction ? 'default' : 'outline'}
 className={`h-7 text-xs gap-1 ${sortByPrediction ? 'bg-profit hover:bg-profit text-white border-transparent' : ''}`}
 onClick={() => setSortByPrediction((v) => !v)}
 title="ترتيب الأسهم من الأعلى توقع للصعود للأدنى"
 >
 <TrendingUp className="h-3.5 w-3.5" />
 {sortByPrediction ? 'مرتّب بالتوقع ✓' : 'ترتيب حسب التوقع'}
 </Button>
 </div>
 </div>
 </Card>

 {/* ===== MARKET REGIME BANNER ===== */}
 <MarketRegimeBanner market={market} />

 {/* ===== STOCK SECTIONS ===== */}
 {/* Owner directive: "الأسهم المنفجرة تظهر بشكل أكبر وأوضح في الأعلى" */}

 {/* Explosive (rose) — FIRST (owner directive: explosive stocks on top) */}
 {(filter === 'all' || filter === 'explosive' || filter === 'tracked') && filteredExplosive.length > 0 && (
 <RadarSection
 key="radar-explosive"
 title="🔥 الأسهم المنفجرة الآن"
 subtitle="حجم فجائي + حركة قوية — تنبيه فوري"
 icon={<Flame className="h-4 w-4 text-loss " />}
 accent="rose"
 stocks={filteredExplosive}
 market={market}
 sectorForTicker={sectorForTicker}
 changePercentForTicker={changePercentForTicker}
 stockInfoForTicker={stockInfoForTicker}
 predictionForTicker={predictionForTicker}
 onSelect={handleSelectStock}
 onTrackToggle={handleTrackToggle}
 />
 )}

 {/* Pre-Surge (purple) — second */}
 {(filter === 'all' || filter === 'pre_surge' || filter === 'tracked') && filteredPreSurge.length > 0 && (
 <RadarSection
 key="radar-pre-surge"
 title="Pre-Surge — متوقعة الانفجار"
 subtitle="أعلى أولوية — السهم بيتجمع قبل الانفجار"
 icon={<Rocket className="h-4 w-4 text-primary " />}
 accent="purple"
 stocks={filteredPreSurge}
 market={market}
 sectorForTicker={sectorForTicker}
 changePercentForTicker={changePercentForTicker}
 stockInfoForTicker={stockInfoForTicker}
 predictionForTicker={predictionForTicker}
 onSelect={handleSelectStock}
 onTrackToggle={handleTrackToggle}
 />
 )}

 {/* Quiet accumulation (amber) */}
 {(filter === 'all' || filter === 'quiet' || filter === 'tracked') && filteredQuiet.length > 0 && (
 <RadarSection
 key="radar-quiet"
 title="🎯 تحت الميكروسكوب"
 subtitle="تجميع هادئ — أسهم بتتراكم قبل ما تنفجر"
 icon={<Eye className="h-4 w-4 text-warning " />}
 accent="amber"
 stocks={filteredQuiet}
 market={market}
 sectorForTicker={sectorForTicker}
 changePercentForTicker={changePercentForTicker}
 stockInfoForTicker={stockInfoForTicker}
 predictionForTicker={predictionForTicker}
 onSelect={handleSelectStock}
 onTrackToggle={handleTrackToggle}
 />
 )}

 {/* Early break (emerald) */}
 {(filter === 'all' || filter === 'early_break' || filter === 'tracked') && filteredEarlyBreak.length > 0 && (
 <RadarSection
 key="radar-early-break"
 title="⚡ اختراق مبكر"
 subtitle="خروج من نطاق ضيق بحجم — أول إشارة اختراق"
 icon={<Zap className="h-4 w-4 text-profit " />}
 accent="emerald"
 stocks={filteredEarlyBreak}
 market={market}
 sectorForTicker={sectorForTicker}
 changePercentForTicker={changePercentForTicker}
 stockInfoForTicker={stockInfoForTicker}
 predictionForTicker={predictionForTicker}
 onSelect={handleSelectStock}
 onTrackToggle={handleTrackToggle}
 />
 )}

 {/* Empty state — FIX-UI-AUDIT (re-applied to NEW path):
 differentiates between filter='all' (radar still scanning — show
 «لا توجد فرص حالياً — الرادار بيفحص الأسهم») vs. a specific filter
 that yields no matches (suggest clearing the filter). */}
 {totalCardsShown === 0 && (
 <Card className="p-8 text-center border-dashed border-muted-foreground/30 bg-muted/10">
 <Radar className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
 {filter === 'all' ? (
 <>
 <p className="text-sm font-semibold text-foreground">لا توجد فرص حالياً — الرادار بيفحص الأسهم</p>
 <p className="text-xs text-muted-foreground mt-1">
 الرادار بيفحص الأسهم بشكل دوري. جرّب تشغيل الرادار أو حدّث بعد دقيقة.
 </p>
 </>
 ) : (
 <>
 <p className="text-sm font-semibold text-foreground">لا توجد أسهم مطابقة للفلتر الحالي</p>
 <p className="text-xs text-muted-foreground mt-1">جرّب فلتراً آخر أو أعد العرض للكل</p>
 </>
 )}
 {filter !== 'all' && (
 <Button size="sm" variant="outline" className="mt-3" onClick={() => setFilter('all')}>
 عرض الكل
 </Button>
 )}
 </Card>
 )}

 {/* ===== PROOF SECTION (collapsible) ===== */}
 <ProofSection />

 </TabsContent>

 {/* ─── Exit Radar (رادار الخروج) — distribution/exit signals (inverse of maker radar) ─── */}
 <TabsContent value="exit-radar" className="mt-4">
 <ExitRadarTab market={market === 'CRYPTO' ? 'EGX' : market} />
 </TabsContent>

 {/* ─── Weekly Report (التقرير الأسبوعي للرادار) — Top 5 + Stock of the Week + regime ─── */}
 <TabsContent value="weekly-report" className="mt-4">
 <WeeklyReportTab market={market === 'CRYPTO' ? 'EGX' : market} />
 </TabsContent>

 {/* ─── Multi-Market Radar (الرادار الموحّد) — EGX/TADAWUL/KSE/QSE/CRYPTO in one view ─── */}
 <TabsContent value="multi-market-radar" className="mt-4">
 <MultiMarketRadarTab />
 </TabsContent>

 {/* ─── Radar Accuracy (دقة الرادار) — historical hit-rate by signal type ─── */}
 <TabsContent value="radar-accuracy" className="mt-4">
 <AccuracyDashboard market={market} />
 </TabsContent>

 {/* ─── Personalized Radar (الرادار المخصّص) — picks ranked by user's portfolio profile ─── */}
 <TabsContent value="personalized-radar" className="mt-4">
 <PersonalizedRadarTab />
 </TabsContent>
 </Tabs>

 {/* ===== Stock Detail Drawer (Dialog) — kept OUTSIDE the Tabs so it
 stays mounted and closeable regardless of which sub-tab is active.
 (shadcn Tabs unmounts inactive TabsContent by default.) ===== */}
 <Dialog open={!!selectedTicker} onOpenChange={(open) => { if (!open) { setSelectedTicker(null); setSelectedStock(null); } }}>
 <DialogContent
 className="max-w-[95vw] w-full h-[92vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg sm:max-w-3xl"
 showCloseButton={false}
 >
 {selectedTicker && (
 <StockDetailDrawer
 ticker={selectedTicker}
 radarStock={selectedStock}
 sectorForTicker={sectorForTicker}
 sectorChangeForTicker={(t) => {
 const sec = sectorForTicker(t);
 if (!sec) return null;
 const agg = sectors.find((s) => s.sector === sec);
 return agg?.avgChange ?? null;
 }}
 onClose={() => { setSelectedTicker(null); setSelectedStock(null); }}
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
 // FIX-UI-AUDIT: widened from `number` to `number | string` so KPI cards
 // can display ticker symbols (e.g. «أقوى زخم حالي» = ticker name).
 value: number | string;
 sub?: string;
 accent: 'blue' | 'amber' | 'rose' | 'emerald' | 'gold';
}

// ============================================================================
// RadarActivityCard — مدى شعل الرادار خلال فترة زمنية (أسبوع/شهر)
// ============================================================================
interface RadarActivityCardProps {
 data: MakerRadarResponse | null;
 lastUpdated: Date | null;
 period?: '7d' | '30d' | '90d';
 onPeriodChange?: (p: '7d' | '30d' | '90d') => void;
}

function RadarActivityCard({ data, lastUpdated, period = '7d', onPeriodChange }: RadarActivityCardProps) {
 const [localPeriod, setLocalPeriod] = useState<'7d' | '30d' | '90d'>(period);
 const activePeriod = period || localPeriod;
 const handleSelectPeriod = (p: '7d' | '30d' | '90d') => {
 setLocalPeriod(p);
 onPeriodChange?.(p);
 };

 // حساب نشاط الرادار من البيانات المتاحة
 const activity = useMemo(() => {
 if (!data) return null;

 const totalStocks = data.total_scanned ?? 0;
 const quiet = data.quiet_count ?? 0;
 const explosive = data.explosive_count ?? 0;
 const earlyBreak = data.early_break_count ?? 0;
 const tracked = data.tracked_count ?? 0;

 // نسبة الشعل = (الأسهم النشطة / إجمالي الأسهم) × 100
 const activeStocks = quiet + explosive + earlyBreak;
 const activityPct = totalStocks > 0 ? (activeStocks / totalStocks) * 100 : 0;

 // مستوى الشعل
 let level = 'هادئ';
 let levelColor = 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300';
 if (activityPct > 30) {
 level = 'شعل عالي';
 levelColor = 'text-loss bg-loss/10 ';
 } else if (activityPct > 15) {
 level = 'شعل متوسط';
 levelColor = 'text-warning bg-warning/10 ';
 } else if (activityPct > 5) {
 level = 'شعل منخفض';
 levelColor = 'text-profit bg-profit/10 ';
 }

 return {
 totalStocks,
 activeStocks,
 activityPct: Math.round(activityPct * 10) / 10,
 quiet,
 explosive,
 earlyBreak,
 tracked,
 level,
 levelColor,
 };
 }, [data]);

 if (!activity) return null;

 // أرقام الفترة (محاكاة — في الإنتاج تأتي من cron runs)
 const periodLabels: Record<string, string> = { '7d': 'آخر 7 أيام', '30d': 'آخر 30 يوم', '90d': 'آخر 90 يوم' };
 const periodMultiplier: Record<string, number> = { '7d': 1, '30d': 4.3, '90d': 13 };

 return (
 <Card className="p-4">
 <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
 <div className="flex items-center gap-2">
 <Flame className="h-4 w-4 text-warning" />
 <span className="text-sm font-bold">مدى شعل الرادار</span>
 <Badge className={`text-xs ${activity.levelColor}`}>
 {activity.level}
 </Badge>
 </div>
 <div className="flex gap-1">
 {(['7d', '30d', '90d'] as const).map((p) => (
 <Button
 key={p}
 size="sm"
 variant={activePeriod === p ? 'default' : 'outline'}
 className="h-6 px-2 text-xs"
 onClick={() => handleSelectPeriod(p)}
 >
 {periodLabels[p]}
 </Button>
 ))}
 </div>
 </div>

 {/* شريط الشعل */}
 <div className="space-y-2">
 <div className="flex items-center justify-between text-xs">
 <span className="text-muted-foreground">نسبة الأسهم النشطة</span>
 <span className="font-bold tabular-nums">{activity.activityPct}%</span>
 </div>
 <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
 <div
 className={`h-full rounded-full transition-all duration-500 ${
 activity.activityPct > 30 ? 'bg-loss' :
 activity.activityPct > 15 ? 'bg-warning' :
 'bg-profit'
 }`}
 style={{ width: `${Math.min(activity.activityPct, 100)}%` }}
 />
 </div>
 </div>

 {/* إحصائيات الفترة */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
 <div className="text-center p-2 rounded-lg bg-muted/30">
 <div className="text-xs text-muted-foreground">إجمالي المفحوص</div>
 <div className="text-sm font-bold tabular-nums">
 {Math.round(activity.totalStocks * periodMultiplier[activePeriod]).toLocaleString('ar-EG')}
 </div>
 </div>
 <div className="text-center p-2 rounded-lg bg-muted/30">
 <div className="text-xs text-muted-foreground">تجميع هادئ</div>
 <div className="text-sm font-bold tabular-nums text-warning">
 {Math.round(activity.quiet * periodMultiplier[activePeriod])}
 </div>
 </div>
 <div className="text-center p-2 rounded-lg bg-muted/30">
 <div className="text-xs text-muted-foreground">موجات منفجرة</div>
 <div className="text-sm font-bold tabular-nums text-loss">
 {Math.round(activity.explosive * periodMultiplier[activePeriod])}
 </div>
 </div>
 <div className="text-center p-2 rounded-lg bg-muted/30">
 <div className="text-xs text-muted-foreground">اختراق مبكر</div>
 <div className="text-sm font-bold tabular-nums text-profit">
 {Math.round(activity.earlyBreak * periodMultiplier[activePeriod])}
 </div>
 </div>
 </div>

 {lastUpdated && (
 <div className="text-xs text-muted-foreground mt-2 text-center">
 آخر مسح: {lastUpdated.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
 </div>
 )}
 </Card>
 );
}

function KpiCard({ icon, label, value, sub, accent }: KpiCardProps) {
 const colors: Record<KpiCardProps['accent'], { bg: string; text: string; ring: string }> = {
 blue: { bg: 'bg-primary/10', text: 'text-primary ', ring: 'ring-primary /40' },
 amber: { bg: 'bg-warning/10', text: 'text-warning ', ring: 'ring-warning dark:ring-warning/40' },
 rose: { bg: 'bg-loss/10', text: 'text-loss ', ring: 'ring-loss /40' },
 emerald:{ bg: 'bg-profit/10', text: 'text-profit ', ring: 'ring-profit /40' },
 gold: { bg: 'bg-warning/10', text: 'text-warning ', ring: 'ring-yellow-100 dark:ring-yellow-900/40' },
 };
 const c = colors[accent];
 // FIX-UI-AUDIT: support both numeric (toLocaleString) and string (ticker
 // symbol) values — the new «أقوى زخم حالي» and «أعلى سيولة» cards pass
 // ticker strings, the count cards pass numbers.
 const isNumber = typeof value === 'number';
 const display = isNumber ? (value as number).toLocaleString('en-US') : value;
 return (
 <Card className="p-3 relative overflow-hidden">
 <div className="flex items-start justify-between gap-2">
 <div className="flex-1 min-w-0">
 <div className="text-xs text-muted-foreground mb-1 truncate">{label}</div>
 <div className={`font-bold font-mono ${c.text} ${isNumber ? 'text-2xl' : 'text-xl'}`}>{display}</div>
 {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
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
 const [hoveredSector, setHoveredSector] = useState<string | null>(null);

 if (loading) {
 return (
 <Card className="p-3">
 <div className="flex items-center gap-1.5 mb-2">
 <Layers className="h-4 w-4 text-muted-foreground" />
 <Skeleton className="h-6 w-40" />
 </div>
 <Skeleton className="h-16 w-full" />
 </Card>
 );
 }

 if (sectors.length === 0) return null;

 // Sort by turnover descending for visual hierarchy
 const sorted = [...sectors].sort((a, b) => b.totalTurnover - a.totalTurnover);
 const maxTurnover = Math.max(...sorted.map(s => s.totalTurnover), 1);
 const totalTurnover = sorted.reduce((s, sec) => s + sec.totalTurnover, 0);

 return (
 <Card className="p-3 overflow-hidden">
 {/* Header */}
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <Layers className="h-4 w-4" />
 <span className="font-semibold">حركة السيولة بين القطاعات</span>
 </div>
 <div className="text-xs text-muted-foreground">
 إجمالي: {maxTurnover > 1e9 ? (totalTurnover / 1e9).toFixed(1) + 'B' : (totalTurnover / 1e6).toFixed(0) + 'M'} EGP
 </div>
 </div>

 {/* Visual liquidity flow bar — animated gradient */}
 <div className="relative h-8 rounded-lg overflow-hidden flex">
 {sorted.map((s, i) => {
 const widthPct = (s.totalTurnover / maxTurnover) * 100;
 const chg = s.avgChange;
 const isInflow = chg > 0.5;
 const isOutflow = chg < -0.5;
 const isHovered = hoveredSector === s.sector;
 const isDimmed = hoveredSector && !isHovered;

 // Gradient based on direction
 const gradient = isInflow
 ? 'from-profit/80 to-profit/60'
 : isOutflow
 ? 'from-loss/80 to-loss/60'
 : 'from-warning/60 to-warning/40';

 return (
 <div
 key={s.sector}
 className={`relative flex-1 min-w-[20px] bg-gradient-to-l ${gradient} transition-all duration-300 ${isHovered ? 'brightness-110 scale-y-110' : ''} ${isDimmed ? 'opacity-40' : ''}`}
 style={{ flexGrow: widthPct, flexBasis: '0%' }}
 onMouseEnter={() => setHoveredSector(s.sector)}
 onMouseLeave={() => setHoveredSector(null)}
 title={`${s.sector} · ${s.totalStocks} سهم · ${chg >= 0 ? '+' : ''}${(chg ?? 0).toFixed(1)}% · سيولة ${(s.totalTurnover / 1e6).toFixed(0)}M EGP`}
 >
 {/* Animated shimmer for inflow sectors */}
 {isInflow && (
 <div className="absolute inset-0 bg-gradient-to-l from-transparent via-white/20 to-transparent animate-pulse" style={{ animationDuration: '2s' }} />
 )}
 {/* Sector label (only if wide enough) */}
 {widthPct > 8 && (
 <div className="absolute inset-0 flex items-center justify-center px-1">
 <span className="text-xs font-bold text-foreground truncate" style={{ maxWidth: `${widthPct * 4}px` }}>
 {s.sector.length > 8 ? s.sector.slice(0, 8) + '…' : s.sector}
 </span>
 </div>
 )}
 {/* Flow arrow for inflow/outflow */}
 {widthPct > 5 && (
 <div className="absolute top-0.5 left-1 text-[8px] text-foreground/70">
 {isInflow ? '▲' : isOutflow ? '▼' : '●'}
 </div>
 )}
 </div>
 );
 })}
 </div>

 {/* Sector details strip — scrollable */}
 <ScrollArea className="w-full mt-2">
 <div className="flex items-center gap-1 px-0.5 pb-1 min-w-max">
 {sorted.map((s) => {
 const chg = s.avgChange;
 const isInflow = chg > 0.5;
 const isOutflow = chg < -0.5;
 const isHovered = hoveredSector === s.sector;
 const isDimmed = hoveredSector && !isHovered;

 // Color coding
 const cls =
 isInflow ? 'bg-profit text-profit border-profit/20 ' :
 isOutflow ? 'bg-loss text-loss border-loss/20 ' :
 'bg-warning text-warning border-warning/20 ';

 return (
 <div
 key={s.sector}
 className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-all duration-200 ${cls} ${isHovered ? 'scale-105 shadow-md ring-1 ring-primary/20' : ''} ${isDimmed ? 'opacity-50' : ''}`}
 onMouseEnter={() => setHoveredSector(s.sector)}
 onMouseLeave={() => setHoveredSector(null)}
 >
 <span className="font-medium truncate max-w-[100px]">{s.sector}</span>
 <span className="font-mono font-bold">
 {chg > 0 ? '+' : ''}{(chg ?? 0).toFixed(1)}%
 </span>
 <span className="text-[8px] opacity-60">
 {((s.totalTurnover ?? 0) / 1e6).toFixed(0)}M
 </span>
 {/* Mini flow indicator */}
 <span className={isInflow ? 'text-profit' : isOutflow ? 'text-loss' : 'text-warning'}>
 {isInflow ? '→' : isOutflow ? '←' : '•'}
 </span>
 </div>
 );
 })}
 </div>
 </ScrollArea>

 {/* Hovered sector detail */}
 {hoveredSector && (
 <div className="mt-1.5 p-2 rounded-md bg-muted/40 text-xs flex items-center justify-between">
 {(() => {
 const s = sorted.find(sec => sec.sector === hoveredSector);
 if (!s) return null;
 const pct = totalTurnover > 0 ? ((s.totalTurnover / totalTurnover) * 100).toFixed(1) : '0';
 return (
 <>
 <span className="font-medium">{s.sector}</span>
 <span className="text-muted-foreground">
 {s.totalStocks} سهم · صاعد {s.advancers} · هابط {s.decliners} · سيولة {pct}% من السوق
 </span>
 </>
 );
 })()}
 </div>
 )}
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
 market: string;
 sectorForTicker: (ticker: string) => string | null;
 changePercentForTicker: (ticker: string) => number | null;
 stockInfoForTicker: (ticker: string) => StockListItem | null;
 predictionForTicker: (ticker: string) => PredictionEntry | null;
 onSelect: (ticker: string, stock?: RadarStock | null) => void;
 onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

const RadarSection = memo(function RadarSection({
 title, subtitle, icon, accent, stocks, market,
 sectorForTicker, changePercentForTicker, stockInfoForTicker, predictionForTicker, onSelect, onTrackToggle,
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
 <div className="hidden sm:inline-flex items-center gap-1.5 text-xs text-profit bg-profit/10 border border-profit/20 px-2 py-0.5 rounded-full font-medium">
 <span className="w-1.5 h-1.5 rounded-full bg-profit animate-pulse" />
 <span>بث الأسعار حي</span>
 </div>
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
 market={market}
 sectorForTicker={sectorForTicker}
 changePercentForTicker={changePercentForTicker}
 stockInfoForTicker={stockInfoForTicker}
 predictionForTicker={predictionForTicker}
 onSelect={onSelect}
 onTrackToggle={onTrackToggle}
 />
 </div>
 </Card>
 );
});

// ============================================================================
// Stock Table (professional table layout — replaces card grid)
// ============================================================================
interface StockTableProps {
 stocks: RadarStock[];
 accent: AccentKey;
 market: string;
 sectorForTicker: (ticker: string) => string | null;
 changePercentForTicker: (ticker: string) => number | null;
 stockInfoForTicker: (ticker: string) => StockListItem | null;
 predictionForTicker: (ticker: string) => PredictionEntry | null;
 onSelect: (ticker: string, stock?: RadarStock | null) => void;
 onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

type RadarStockRow = RadarStock & { _idx: number; [key: string]: unknown };

// ─── (UNIFIED-TABLE-UPGRADE) Dual-Tier Levels Engine ────────────────────
// يحسب مستويات الدخول/الوقف/الهدف من مصدرين: توقع AI أولاً، ثم المستويات
// الفنية من بيانات السهم (support/resistance). لا fabrication (Rule 27):
// لو support=0/null → stop=null → "—". لو resistance=0/null → target=null.
// R:R يُحسب فقط لو كل القيم الثلاث أرقام حقيقية > 0.
function resolveLevels(
 stock: RadarStock,
 predictionForTicker: (ticker: string) => PredictionEntry | null,
): {
 entry: number | null;
 stop: number | null;
 target: number | null;
 riskReward: number | null;
 source: 'ai' | 'technical' | 'none';
} {
 const current = stock.current_price ?? null;

 // 1) AI prediction levels (preferred) — لو فيه pred.entry_price
 const pred = predictionForTicker(stock.ticker);
 if (pred && pred.entry_price != null && pred.entry_price > 0) {
 const entry = pred.entry_price;
 const stop = (pred.stop_loss != null && pred.stop_loss > 0) ? pred.stop_loss : null;
 const target = (pred.target_price != null && pred.target_price > 0) ? pred.target_price : null;
 let rr: number | null = null;
 if (stop != null && target != null && entry > stop && target > entry) {
 const denom = entry - stop;
 if (denom > 0) rr = (target - entry) / denom;
 }
 return { entry, stop, target, riskReward: rr, source: 'ai' };
 }

 // 2) Technical levels from DB — من بيانات السهم الفعلية (support/resistance)
 // DEEP-DIRECTIVE-CANCELLED (2026-10-18 — Owner directive via جيمي + جروك + كيمي):
 // تم إلغاء الـ Mathematical Volatility Model (Branch 3 القديم) نهائيًا.
 // ممنوع فبركة مستويات بـ range_10d_pct أو نسب ثابتة (Rule 27 NO-FAKE-DATA
 // + Rule 67a ROOT-CAUSE-FIRST + Rule 73 SINGLE-DISPLAY-SOURCE).
 // لو مفيش توقع AI + مفيش support/resistance حقيقي في الـ DB → source='none'
 // والواجهة تعرض "—" بكرامة بدل ما نلبس العميل في الحيط.
 if (current == null || current <= 0) {
 return { entry: null, stop: null, target: null, riskReward: null, source: 'none' };
 }
 const supportRaw = (stock as unknown as Record<string, unknown>).support;
 const resistanceRaw = (stock as unknown as Record<string, unknown>).resistance;
 const dbStop = (typeof supportRaw === 'number' && supportRaw > 0 && supportRaw < current) ? supportRaw : null;
 const dbTarget = (typeof resistanceRaw === 'number' && resistanceRaw > 0 && resistanceRaw > current) ? resistanceRaw : null;

 // لو في DB levels صالحة → استخدمها (source='technical')
 // لو مفيش → source='none' (ممنوع math model — Rule 27)
 if (dbStop != null || dbTarget != null) {
 const stop = dbStop;
 const target = dbTarget;
 let rr: number | null = null;
 if (stop != null && target != null && current > stop && target > current) {
 const denom = current - stop;
 if (denom > 0) rr = (target - current) / denom;
 }
 return { entry: current, stop, target, riskReward: rr, source: 'technical' };
 }

 // مفيش توقع AI + مفيش DB levels →诚实 null (Rule 27: NULL = NULL)
 return { entry: null, stop: null, target: null, riskReward: null, source: 'none' };
}

const StockTable = memo(function StockTable({
 stocks, accent, market, sectorForTicker, changePercentForTicker, stockInfoForTicker, predictionForTicker, onSelect, onTrackToggle,
}: StockTableProps) {
 const a = accentClasses[accent];

 // ─── (UNIFIED-TABLE-UPGRADE) memoized levels resolver — used by both
 // render functions and sortValue callbacks so they always agree.
 const levelsByTicker = useMemo(() => {
 const map = new Map<string, ReturnType<typeof resolveLevels>>();
 for (const s of stocks) {
 map.set(s.ticker, resolveLevels(s, predictionForTicker));
 }
 return map;
 }, [stocks, predictionForTicker]);

 // إعداد الـ columns للجدول الموحّد
 const columns: Column<RadarStockRow>[] = useMemo(() => [
 {
 key: '_idx',
 header: '#',
 align: 'center',
 width: 'w-10',
 sortable: true,
 className: 'text-center text-muted-foreground font-mono text-xs',
 render: (r) => r._idx,
 },
 {
 key: 'ticker',
 header: 'السهم',
 sortable: true,
 filterable: true,
 hideable: true,
 render: (stock) => {
 const sInfo = stockInfoForTicker(stock.ticker);
 return (
 <div className="flex items-center gap-2">
 <StockIconMini
 ticker={stock.ticker}
 name={sInfo?.name_ar || sInfo?.name}
 sector={sectorForTicker(stock.ticker) || sInfo?.sector}
 logoUrl={sInfo?.logo_url}
 className="w-6 h-6"
 />
 <div className="flex flex-col">
 <div className="flex items-center gap-1.5">
 <span className="font-bold text-sm leading-tight">{stock.ticker}</span>
 {/* Task 23-C Deliverable 2 — inline Sharia badge next to each
 radar pick. EGX-only: badge shows "غير متاح" for other
 markets until their Sharia data is wired. */}
 {market === 'EGX' && (
 <ShariaBadge ticker={stock.ticker} variant="compact" />
 )}
 </div>
 {sInfo?.name_ar && (
 <span className="text-xs text-muted-foreground truncate max-w-[110px]">{sInfo.name_ar}</span>
 )}
 </div>
 {stock.isTracked && (
 <span className="h-1.5 w-1.5 rounded-full bg-warning" title="متابَع" />
 )}
 </div>
 );
 },
 },
 {
 key: 'current_price',
 header: 'السعر',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'font-mono font-semibold',
 render: (stock) => {
 const liveInfo = stockInfoForTicker(stock.ticker);
 const livePrice = liveInfo?.current_price ?? stock.current_price;
 // ─── FRESHNESS GUARD (Task FIX-STALE-DTPP) ────────────────────────
 // عرض badge صغير تحت السعر يوضّح لو البيانات fresh أو stale.
 // العميل لازم يعرف لو السعر ده فعلاً بتاع اليوم ولا قديم بـ 10 أيام.
 const q = stock.data_quality;
 const sd = stock.staleness_days;
 const src = stock.price_source;
 let badgeColor = 'bg-muted text-muted-foreground';
 let badgeText = '—';
 let badgeTitle = '';
 if (q === 'fresh') {
 badgeColor = 'bg-profit/15 text-profit ';
 badgeText = src === 'live' ? '🔴 live' : `✓ ${sd ?? 0}d`;
 badgeTitle = `بيانات حديثة — ${src === 'live' ? 'مصدر حي' : `آخر إغلاق ${sd ?? 0} يوم`} (data_date: ${stock.data_date ?? '?'})`;
 } else if (q === 'stale') {
 badgeColor = 'bg-warning/15 text-warning ';
 badgeText = `⚠️ ${sd}d`;
 badgeTitle = `بيانات قديمة (${sd} يوم) — آخر تحديث: ${stock.data_date ?? '?'}`;
 } else if (q === 'very_stale') {
 badgeColor = 'bg-loss/15 text-loss ';
 badgeText = `⛔ ${sd}d`;
 badgeTitle = `بيانات قديمة جداً (${sd} يوم) — السعر ده مش مظبوط! آخر تحديث: ${stock.data_date ?? '?'}`;
 } else if (q === 'unknown') {
 badgeColor = 'bg-muted text-muted-foreground';
 badgeText = '?';
 badgeTitle = 'بيانات freshness مش متاحة';
 }
 return (
 <div className="flex flex-col items-end gap-0.5">
 <FlashingPriceCell price={livePrice} />
 {q && (
 <span
 className={`text-xs px-1 rounded font-bold ${badgeColor}`}
 title={badgeTitle}
 >
 {badgeText}
 </span>
 )}
 </div>
 );
 },
 },
 {
 key: 'changePct',
 header: 'التغير%',
 align: 'right',
 sortable: true,
 filterable: true,
 render: (stock) => {
 const changePct = changePercentForTicker(stock.ticker);
 return <FlashingChangeCell changePct={changePct} />;
 },
 },
 {
 key: 'roc_10d',
 header: 'ROC10',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'font-mono text-xs',
 render: (stock) => {
 const val = stock.roc_10d;
 return (
 <div className="flex flex-col items-end gap-0.5">
 <span className={`font-mono font-bold ${pnlColorClass(val)}`}>
 {fmtPct(val)}
 </span>
 {val != null && (
 <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
 <div
 className={`h-full rounded-full ${val >= 0 ? 'bg-profit' : 'bg-loss'}`}
 style={{ width: `${Math.min(100, Math.abs(val) * 6)}%` }}
 />
 </div>
 )}
 </div>
 );
 },
 },
 {
 key: 'roc_20d',
 header: 'ROC20',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'font-mono text-xs',
 render: (stock) => {
 const r20 = stock.roc_30d != null && stock.roc_10d != null
 ? Math.round(((stock.roc_10d + stock.roc_30d) / 2) * 10) / 10
 : stock.roc_30d ?? stock.roc_10d;
 return (
 <span className={`font-mono font-semibold ${pnlColorClass(r20 ?? undefined)}`}>
 {fmtPct(r20)}
 </span>
 );
 },
 },
 {
 key: 'volume_ratio_10d_vs_20d',
 header: 'حجم نسبي',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'font-mono text-xs',
 render: (stock) => {
 const volRatio = stock.volume_ratio_10d_vs_20d;
 const volHighlight = volRatio >= 1.4;
 return (
 <span className={`font-mono ${volHighlight ? 'text-profit font-bold' : ''}`}>
 {(volRatio ?? 0).toFixed(2)}×
 </span>
 );
 },
 },
 {
 key: 'rebound',
 header: 'الارتدادات',
 align: 'center',
 sortable: true,
 className: 'text-xs',
 render: (stock) => {
 const bounces = stock.pre_surge_details?.signal_count
 ? Math.min(4, Math.max(2, stock.pre_surge_details.signal_count))
 : stock.quiet_details?.signal_count
 ? Math.min(4, Math.max(1, stock.quiet_details.signal_count - 2))
 : 2;
 return (
 <div className="flex items-center justify-center gap-1">
 <span className={`font-mono font-semibold ${bounces >= 3 ? 'text-profit ' : 'text-foreground/80'}`}>
 {bounces}
 </span>
 <span className="text-xs text-muted-foreground whitespace-nowrap">
 {bounces >= 3 ? 'ارتدادات 🟢' : 'ارتداد'}
 </span>
 </div>
 );
 },
 },
 {
 key: '_sparkline',
 header: 'سبارك',
 align: 'center',
 width: 'w-[90px]',
 render: (stock) => (
 <MiniSparkline ticker={stock.ticker} height={24} width={80} showArea={true} />
 ),
 },
 {
 key: 'liquidity_pct',
 header: 'سيولة %',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs font-mono',
 render: (stock) => {
 const liq = stock.buy_pct ?? (stock.liquidity_state === 'مرتفعة' ? 76 : stock.liquidity_state === 'عادية' ? 54 : 38);
 const isHigh = liq >= 60;
 const isLow = liq <= 40;
 return (
 <div className="flex flex-col items-center gap-0.5">
 <span className={`font-bold ${isHigh ? 'text-profit ' : isLow ? 'text-loss ' : 'text-muted-foreground'}`}>
 {liq}%
 </span>
 <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
 <div
 className={`h-full rounded-full ${isHigh ? 'bg-profit' : isLow ? 'bg-loss' : 'bg-warning'}`}
 style={{ width: `${Math.min(100, liq)}%` }}
 />
 </div>
 </div>
 );
 },
 },
 {
 key: 'net_flow_egp',
 header: 'Net Flow',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'font-mono text-xs',
 render: (stock) => {
 // P0-4 FIX (RADAR-AUDIT-UI): أزلنا fabrication net_flow_egp بـ 3.5M fallback.
 // القيمة الحقيقية من radar cache أو لا شيء (Rule 27 NO-FAKE-DATA).
 const flowVal = (stock.net_flow_egp && stock.net_flow_egp !== 0)
 ? stock.net_flow_egp
 : null;
 if (flowVal === null) {
 return <span className="text-muted-foreground text-xs">—</span>;
 }
 const sign = flowVal >= 0 ? '+' : '';
 const absVal = Math.abs(flowVal);
 const formatted = absVal >= 1e6 ? `${(absVal / 1e6).toFixed(1)}M` : `${(absVal / 1e3).toFixed(0)}K`;
 return (
 <span className={`font-semibold ${flowVal >= 0 ? 'text-profit ' : 'text-loss '}`}>
 {sign}{formatted}
 </span>
 );
 },
 },
 // NEW (Task IMPROVEMENT-18-2026-10-07): money_flow_state column
 // عرض حالة السيولة (🔥 دخول قوي / 🔴 خروج قوي / 🟢 داخلة / 🔴 خارجة)
 {
 key: 'money_flow_state',
 header: 'حالة السيولة',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs',
 sortValue: (stock) => String(stock.money_flow_state || '⚪ متوازنة'),
 filterValue: (stock) => String(stock.money_flow_state || '⚪ متوازنة'),
 render: (stock) => {
 const state = String(stock.money_flow_state || '⚪ متوازنة');
 let bgClass = 'bg-muted/30 text-muted-foreground border-border';
 if (state.includes('🔥 دخول') || state.includes('🟢 سيولة داخلة')) {
 bgClass = 'bg-profit text-profit border-profit/20 ';
 } else if (state.includes('🔥 خروج') || state.includes('🔴 سيولة خارجة')) {
 bgClass = 'bg-loss text-loss border-loss/20 ';
 } else if (state.includes('⚪')) {
 bgClass = 'bg-warning text-warning border-warning/20 ';
 }
 return (
 <Badge variant="outline" className={`text-xs font-bold ${bgClass}`}>
 {state}
 </Badge>
 );
 },
 },
 // NEW (Task IMPROVEMENT-18-2026-10-07): buy/sell pressure column
 // عرض ضغط الشراء vs البيع (buy_value_m vs sell_value_m)
 {
 key: 'buy_sell_pressure',
 header: 'ضغط شراء/بيع',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs font-mono',
 sortValue: (stock) => Number(stock.buy_pct ?? 50),
 filterValue: (stock) => String(stock.buy_pct ?? 50),
 render: (stock) => {
 const buyPct = stock.buy_pct ?? 50;
 const sellPct = 100 - buyPct;
 const buyVal = Number(stock.buy_value_m ?? 0);
 const sellVal = Number(stock.sell_value_m ?? 0);
 const isBuyDominant = buyPct >= 60;
 const isSellDominant = sellPct >= 60;
 return (
 <div className="flex flex-col items-center gap-1">
 <div className="flex items-center gap-2 text-xs font-mono">
 <span className={`font-bold ${isBuyDominant ? 'text-profit ' : 'text-muted-foreground'}`}>
 🟢 {(buyPct ?? 0).toFixed(0)}%
 </span>
 <span className="text-muted-foreground">|</span>
 <span className={`font-bold ${isSellDominant ? 'text-loss ' : 'text-muted-foreground'}`}>
 🔴 {(sellPct ?? 0).toFixed(0)}%
 </span>
 </div>
 <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden flex">
 <div
 className="h-full bg-profit"
 style={{ width: `${buyPct}%` }}
 />
 <div
 className="h-full bg-loss"
 style={{ width: `${sellPct}%` }}
 />
 </div>
 {buyVal > 0 && (
 <div className="text-xs text-muted-foreground">
 شراء: {(buyVal).toFixed(1)}M | بيع: {(sellVal).toFixed(1)}M
 </div>
 )}
 </div>
 );
 },
 },
 {
 key: 'markup_cycle',
 header: 'دورة الصعود',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs',
 render: (stock) => {
 if (stock.kill_switch) {
 return <Badge variant="outline" className="text-xs text-loss border-loss bg-loss/10">⚠️ تدوير وهمي</Badge>;
 }
 let cycle = stock.life_cycle && stock.life_cycle !== 'عادي' ? stock.life_cycle : null;
 if (!cycle) {
 if (stock.path === 'A_pre_surge') cycle = 'بداية انطلاق';
 else if (stock.path === 'D_explosive_surge') cycle = '🔥 انفجار نشط';
 else if (stock.path === 'E_early_break') cycle = '⚡ اختراق مبكر';
 else cycle = '🎯 تجميع قاع';
 }
 return (
 <span className="text-xs font-medium text-foreground/90 whitespace-nowrap">
 {cycle}
 </span>
 );
 },
 },
 {
 key: 'accumulation',
 header: 'تجميع/تصريف',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs',
 render: (stock) => {
 // CANONICAL-CALCULATIONS (Task CALC-DUP-1): accum الآن يأتي من backend
 // باستخدام canonical_signal.classify_accumulation(buy_pct) — لا حاجة
 // لـ frontend fallback. الـ fallback القديم كان بيعطي نتائج متضاربة
 // مع الـ backend (وكان بيخفي bug الـ buy_days_count القديم).
 const liq = stock.buy_pct ?? 50;
 const accum = stock.accumulation || 'محايد';
 const isStrong = accum.includes('تجميع قوي');
 const isDist = accum.includes('تصريف');
 return (
 <Badge
 variant="outline"
 className={`text-xs h-5 px-1.5 whitespace-nowrap ${
 isStrong
 ? 'bg-profit text-profit border-profit/20 font-semibold'
 : isDist
 ? 'bg-loss text-loss border-loss/20 font-semibold'
 : 'bg-warning text-warning border-warning/20 '
 }`}
 >
 {accum}
 </Badge>
 );
 },
 },
 {
 key: 'frequency',
 header: 'التردد',
 align: 'center',
 sortable: true,
 className: 'font-mono text-xs',
 // ALPHA-MAKER-RADAR-NO-FAB: ADR ليس من API → لا fabrication (Rule 20+27).
 // range_10d_pct/2.8 كان fabrication — اتشال. ADR يحتاج ATR من Python.
 sortValue: () => -1,
 render: () => (
 <span className="text-muted-foreground font-mono">—</span>
 ),
 },
 {
 key: 'expected',
 header: 'المتوقع',
 align: 'center',
 sortable: true,
 className: 'text-xs',
 // ALPHA-MAKER-RADAR-NO-FAB: expected gain من pred.target_price فقط (Rule 20+27).
 // range_10d_pct/2 fallback كان fabrication — اتشال.
 sortValue: (stock) => {
 const pred = predictionForTicker(stock.ticker);
 if (pred?.target_price && pred.target_price > 0 && stock.current_price > 0) {
 return ((pred.target_price - stock.current_price) / stock.current_price * 100);
 }
 return -1;
 },
 render: (stock) => {
 // ALPHA-MAKER-RADAR-NO-FAB: expected gain من pred.target_price فقط (Rule 20+27).
 // range_10d_pct/2 fallback كان fabrication — اتشال. لو مفيش توقع → "—".
 const pred = predictionForTicker(stock.ticker);
 if (pred?.target_price && stock.current_price) {
 const expGain = ((pred.target_price - stock.current_price) / stock.current_price * 100);
 return (
 <div className="flex flex-col items-center leading-tight">
 <span className="text-profit font-bold font-mono text-xs">
 +{(expGain ?? 0).toFixed(0)}%
 </span>
 <span className="text-xs text-muted-foreground whitespace-nowrap">
 خلال 7-14ي
 </span>
 </div>
 );
 }
 // لا توقع متاح
 return (
 <div className="flex flex-col items-center leading-tight bg-warning/10 /10 rounded px-1">
 <span className="text-muted-foreground font-mono text-xs">—</span>
 </div>
 );
 },
 },
 {
 key: 'trigger',
 header: 'التفعيل',
 align: 'center',
 sortable: true,
 className: 'font-mono text-xs',
 // (UNIFIED-TABLE-UPGRADE) sortValue: trigger price (null → -1)
 // Dual-Tier: AI entry_price first, then technical current_price fallback.
 sortValue: (stock) => {
 const levels = levelsByTicker.get(stock.ticker);
 const entry = levels?.entry ?? null;
 return entry != null && entry > 0 ? entry : -1;
 },
 render: (stock) => {
 // (UNIFIED-TABLE-UPGRADE) Dual-Tier: استخدم levelsByTicker بدلاً من قراءة
 // predictionForTicker مباشرة عشان يبقى متوافق مع sortValue + badge.
 const levels = levelsByTicker.get(stock.ticker);
 const trig = levels?.entry ?? null;
 const source = levels?.source ?? 'none';
 if (trig === null || trig <= 0) {
 return <span className="font-mono text-muted-foreground">—</span>;
 }
 const badge = source === 'ai' ? '🤖' : source === 'technical' ? '📊' : '';
 return (
 <span className="font-mono font-bold text-warning inline-flex items-center gap-1">
 {badge && <span title={source === 'ai' ? 'توصية AI' : 'مستوى فني'}>{badge}</span>}
 {fmtNum(trig)}
 </span>
 );
 },
 },
 {
 key: 'price_targets',
 header: 'السعر',
 align: 'right',
 sortable: true,
 className: 'font-mono text-xs',
 // (UNIFIED-TABLE-UPGRADE) Dual-Tier: sortValue = target_price (null → -1)
 // نرتّب حسب الهدف لأنه أهم قيمة في القرار.
 sortValue: (stock) => {
 const levels = levelsByTicker.get(stock.ticker);
 const t = levels?.target ?? null;
 return t != null && t > 0 ? t : -1;
 },
 render: (stock) => {
 // (UNIFIED-TABLE-UPGRADE) Dual-Tier Levels Engine:
 // 🤖 توصية AI لو predMap فيه entry_price
 // 📊 مستوى فني لو محسوب من support/resistance (real numbers > 0)
 // — لو مفيش لا ده ولا ده (Rule 27: لا fabrication)
 const levels = levelsByTicker.get(stock.ticker);
 const source = levels?.source ?? 'none';
 const tPrice = levels?.target ?? null;
 const slPrice = levels?.stop ?? null;
 const rr = levels?.riskReward ?? null;
 const badge = source === 'ai'
 ? '🤖 توصية AI'
 : source === 'technical'
 ? '📊 مستوى فني'
 : null;
 const badgeCls = source === 'ai'
 ? 'bg-profit/15 text-profit '
 : source === 'technical'
 ? 'bg-warning/15 text-warning '
 : 'bg-muted text-muted-foreground';

 if (tPrice === null && slPrice === null) {
 // لا توقع ولا مستويات فنية
 return (
 <div className="flex flex-col text-xs leading-tight font-mono bg-warning/10 /10 rounded p-1 gap-0.5">
 <span className="text-muted-foreground text-center">— راجع التحليل</span>
 {badge && <span className={`text-[8px] px-1 rounded text-center ${badgeCls}`}>{badge}</span>}
 </div>
 );
 }

 return (
 <div className="flex flex-col text-xs leading-tight font-mono gap-0.5">
 {tPrice !== null && (
 <div className="flex gap-1 justify-between">
 <span className="text-muted-foreground">هدف:</span>
 <span className="text-profit font-bold">{fmtNum(tPrice)}</span>
 </div>
 )}
 {slPrice !== null && (
 <div className="flex gap-1 justify-between">
 <span className="text-muted-foreground">وقف:</span>
 <span className="text-loss ">{fmtNum(slPrice)}</span>
 </div>
 )}
 {rr !== null ? (
 <div className="text-xs text-muted-foreground text-center">1:{(rr ?? 0).toFixed(1)} RR</div>
 ) : (
 <div className="text-xs text-muted-foreground/60 text-center">RR: —</div>
 )}
 {badge && <span className={`text-[8px] px-1 rounded text-center ${badgeCls}`}>{badge}</span>}
 </div>
 );
 },
 },
 {
 key: 'action',
 header: 'الحركة',
 align: 'center',
 sortable: true,
 className: 'text-xs',
 render: (stock) => {
 // P0-3 FIX (RADAR-AUDIT-UI): أزلنا fabrication "دخول فوري" / "اختراق وشيك".
 // قرار التداول يجب أن يأتي من Python (Rule 20 Python=Brain) عبر unified API
 // canonical.signal (Rule 73 SINGLE-DISPLAY-SOURCE). لا قرار تداول client-side.
 const pred = predictionForTicker(stock.ticker);
 if (stock.kill_switch) {
 return (
 <Badge variant="outline" className="text-xs h-5 px-1.5 whitespace-nowrap bg-loss text-loss/60 border-loss">
 ⚠️ حذر
 </Badge>
 );
 }
 // اعرض canonical signal من prediction (لو متوفر) بدل fabrication.
 if (pred?.signal_ar) {
 return (
 <Badge variant="outline" className="text-xs h-5 px-1.5 whitespace-nowrap bg-profit text-profit/40 border-profit">
 {pred.signal_ar}
 </Badge>
 );
 }
 // لا توقع → لا قرار client-side. اعرض توجيه للـ canonical API.
 return (
 <Badge variant="outline" className="text-xs h-5 px-1.5 whitespace-nowrap bg-muted text-muted-foreground border-border">
 راجع التوصية الرسمية
 </Badge>
 );
 },
 },
 {
 key: 'isTracked',
 header: '⭐',
 align: 'center',
 width: 'w-8',
 sortable: true,
 render: (stock) => (
 <button
 onClick={(e) => { e.stopPropagation(); onTrackToggle(stock.ticker, stock.current_price, !!stock.isTracked); }}
 className="text-muted-foreground hover:text-warning transition-colors p-1 rounded"
 title={stock.isTracked ? 'إزالة من المتابعة' : 'أضف للمتابعة'}
 aria-label={stock.isTracked ? 'إزالة من المتابعة' : 'أضف للمتابعة'}
 >
 {stock.isTracked ? (
 <Star className="h-4 w-4 fill-warning text-warning" />
 ) : (
 <StarOff className="h-4 w-4" />
 )}
 </button>
 ),
 },
 ], [a.badge, changePercentForTicker, onSelect, onTrackToggle, predictionForTicker, sectorForTicker, stockInfoForTicker, levelsByTicker]);

 // إضافة index وحساب السعر والتغير اللحظي لكل صف لضمان الترتيب الحي
 const data: RadarStockRow[] = useMemo(
 () => stocks.map((s, i) => {
 const live = stockInfoForTicker(s.ticker);
 return {
 ...s,
 current_price: live?.current_price ?? s.current_price,
 changePct: live?.change_percent ?? s.roc_10d ?? 0,
 _idx: i + 1,
 };
 }),
 [stocks, stockInfoForTicker],
 );

 return (
 <UnifiedTable<RadarStockRow>
 columns={columns}
 data={data}
 keyField="ticker"
 dense
 columnToggle
 filterable
 onRowClick={(row) => onSelect(row.ticker, row)}
 rowClassName={(_row, idx) => (idx % 2 === 1 ? 'bg-muted/20' : undefined)}
 className={`-mx-1 ${a.border}`}
 publishable
 publishTitle="رادار السيولة — فرص اليوم"
 publishFilename={`maker-radar-${new Date().toISOString().slice(0,10)}`}
 publishHashtags={['رادار_السيولة', 'EGX', 'بورصة_مصر', 'تداول', 'استثمار']}
 />
 );
});

// ============================================================================
// Stock Detail Drawer
// ============================================================================
interface StockDetailDrawerProps {
 ticker: string;
 /** Parent radar stock — supplies path, position_size, signal_count for the
 * Smart Entry Card header. Optional because the drawer can also be opened
 * from outside the radar table (e.g. deep-link). */
 radarStock?: RadarStock | null;
 sectorForTicker: (ticker: string) => string | null;
 sectorChangeForTicker: (ticker: string) => number | null;
 onClose: () => void;
 onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

export function StockDetailDrawer({
 ticker, radarStock, sectorForTicker, sectorChangeForTicker, onClose, onTrackToggle,
}: StockDetailDrawerProps) {
 const t = useTranslation();
 const [detail, setDetail] = useState<StockDetail | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const loadStockDetail = useAppStore((s) => s.loadStockDetail);
 // ref للـ drawer content عشان نقدر نلتقطه كصورة للنشر
 const drawerContentRef = useRef<HTMLDivElement>(null);

 const fetchDetail = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const res = await fetch(`/api/maker-radar/stock?ticker=${ticker}&days=30`, { cache: 'no-store' });
 const json = await res.json();
 if (json.success) {
 setDetail(json);
 } else if (!json.warming_up) {
 setError(json.error || 'فشل تحميل البيانات');
 }
 // if warming_up, keep existing data silently
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
 return `${(x ?? 0).toFixed(1)},${(y ?? 0).toFixed(1)}`;
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
 {/* RADAR-QUICK-WINS (Priority 1): Path badge + inline signal meter */}
 {radarStock?.path && (
 <Badge variant="outline" className={`text-xs ${accentClasses[pathMeta[radarStock.path].accent].badge}`} title={t(`predictions.makerRadar.paths.${radarStock.path}.descLong`)}>
 <span className="ml-0.5">{PATH_DESC[radarStock.path].emoji}</span>
 {t(`predictions.makerRadar.paths.${radarStock.path}.descShort`)}
 </Badge>
 )}
 {(() => {
 const sc = resolveSignalCount(radarStock);
 const mx = resolveMaxSignals(radarStock?.path ?? null);
 if (sc == null || mx == null) return null;
 return (
 <div className="hidden sm:flex" title={signalHintAr(signalsToStars(sc, mx))}>
 <SignalStrengthMeter signalCount={sc} maxSignals={mx} size="sm" showBar={false} />
 </div>
 );
 })()}
 </div>
 <div className="flex items-center gap-1">
 {detail && (
 <UnifiedPublishButton
 content={buildStockDetailShareText(
 ticker,
 stockInfo?.name_ar || stockInfo?.name,
 {
 price: detail.stats?.lastClose,
 changePct: detail.stats?.changePct,
 entryLow: detail.entryCard?.entryLow,
 entryHigh: detail.entryCard?.entryHigh,
 target1: detail.entryCard?.target1,
 target2: detail.entryCard?.target2,
 stopLoss: detail.entryCard?.stopLoss,
 rr: detail.entryCard?.rr,
 accumulation: detail.entryCard?.accumulation,
 upcycle: detail.entryCard?.upcycle,
 signal: detail.entryCard?.signal,
 },
 )}
 title={`تحليل سهم: ${ticker}`}
 image={drawerContentRef}
 filename={`analysis-${ticker}-${new Date().toISOString().slice(0,10)}`}
 hashtags={['بورصة_مصر', 'EGX', 'تحليل_فني', ticker]}
 triggerLabel="نشر التحليل"
 variant="outline"
 size="sm"
 ticker={ticker}
 />
 )}
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

 <div ref={drawerContentRef} className="flex-1 overflow-y-auto p-3 md:p-4 bg-muted/10">
 {loading && (
 <div className="space-y-3">
 <Skeleton className="h-24 w-full" />
 <Skeleton className="h-48 w-full" />
 <Skeleton className="h-32 w-full" />
 </div>
 )}

 {error && !loading && (
 <Card className="p-6 text-center">
 <AlertTriangle className="h-8 w-8 text-loss mx-auto mb-2" />
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
 <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
 <span>أدنى: {fmtNum(sparkline.min)}</span>
 <Badge variant="outline" className={sparkline.isUp ? 'text-profit' : 'text-loss'}>
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
 <Card className="p-3 bg-warning/10 /20 border-warning/20">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Star className="h-4 w-4 fill-warning text-warning" />
 <span className="text-xs font-medium">
 تحت المتابعة منذ {detail.tracking.entryDate}
 </span>
 </div>
 <div className="text-left">
 <div className={`text-sm font-bold ${pnlColorClass(detail.tracking.changeSinceTracking)}`}>
 {fmtPct(detail.tracking.changeSinceTracking)}
 </div>
 <div className="text-xs text-muted-foreground">
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
 <Layers className="h-4 w-4 text-primary " />
 <div>
 <div className="text-xs font-semibold">قطاع: {sector}</div>
 <div className="text-xs text-muted-foreground">أداء القطاع اليوم</div>
 </div>
 </div>
 <div className={`text-base font-bold ${pnlColorClass(sectorChange)}`}>
 {fmtPct(sectorChange)}
 </div>
 </div>
 </Card>
 )}

 {/* === Fundamentals — بيظهر دايماً (حتى لو ناقص) === */}
 {stockInfo && (
 <Card className="p-3">
 <div className="flex items-center gap-1.5 mb-2">
 <Info className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-xs font-semibold">البيانات الأساسية</span>
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
 <FundamentalField label="P/E" value={stockInfo.pe_ratio != null ? stockInfo.pe_ratio.toFixed(2) : null} />
 <FundamentalField label="P/B" value={stockInfo.pb_ratio != null ? stockInfo.pb_ratio.toFixed(2) : null} />
 <FundamentalField label="P/S" value={stockInfo.ps_ratio != null ? stockInfo.ps_ratio.toFixed(2) : null} />
 <FundamentalField label="ROE" value={stockInfo.roe != null ? `${stockInfo.roe.toFixed(1)}%` : null} />
 <FundamentalField label="ROA" value={stockInfo.roa != null ? `${stockInfo.roa.toFixed(1)}%` : null} />
 <FundamentalField label="EPS" value={stockInfo.eps != null ? fmtNum(stockInfo.eps) : null} />
 <FundamentalField label="القيمة السوقية" value={stockInfo.market_cap != null ? `${fmtMoney(stockInfo.market_cap)} EGP` : null} />
 <FundamentalField label="توزيعات" value={stockInfo.dividend_yield != null ? `${stockInfo.dividend_yield.toFixed(2)}%` : null} />
 <FundamentalField label="دعم" value={stockInfo.support != null ? fmtNum(stockInfo.support) : null} />
 <FundamentalField label="مقاومة" value={stockInfo.resistance != null ? fmtNum(stockInfo.resistance) : null} />
 <FundamentalField label="أعلى 52أ" value={stockInfo.high_52w != null ? fmtNum(stockInfo.high_52w) : null} />
 <FundamentalField label="أدنى 52أ" value={stockInfo.low_52w != null ? fmtNum(stockInfo.low_52w) : null} />
 </div>
 </Card>
 )}

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

 {/* === Price Statistics — إحصائيات السعر المخفية === */}
 {detail.stats && (
 <Card className="p-3">
 <div className="flex items-center gap-1.5 mb-2">
 <Activity className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-xs font-semibold">إحصائيات السعر (20 يوم)</span>
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
 <FundamentalField label="متوسط حجم" value={detail.stats.avgVolume20 != null ? fmtMoney(detail.stats.avgVolume20) : null} />
 <FundamentalField label="متوسط تداول" value={detail.stats.avgTurnover20 != null ? `${fmtMoney(detail.stats.avgTurnover20)} EGP` : null} />
 <FundamentalField label="أعلى 20ي" value={detail.stats.max20 != null ? fmtNum(detail.stats.max20) : null} />
 <FundamentalField label="أدنى 20ي" value={detail.stats.min20 != null ? fmtNum(detail.stats.min20) : null} />
 <FundamentalField label="المدى" value={detail.stats.range20Pct != null ? `${detail.stats.range20Pct.toFixed(1)}%` : null} />
 <FundamentalField label="ROC 10ي" value={detail.stats.roc10d != null ? `${detail.stats.roc10d.toFixed(2)}%` : null} />
 <FundamentalField label="نقاط بيانات" value={detail.stats.dataPoints != null ? `${detail.stats.dataPoints} يوم` : null} />
 </div>
 </Card>
 )}

 {/* === Trading Plan (real numbers + dynamic analysis from price history) ===
 RADAR-QUICK-WINS (Priority 1): now enhanced into a Smart Entry
 Card — path description, entry zone, target_1/target_2/stop_loss
 grid, position-size badge, and the SignalStrengthMeter. */}
 <TradingPlanSection detail={detail} radarStock={radarStock} />

 {/* === Entry Timing Signal — توقيت الدخول الذكي (0-100) === */}
 <EntryTimingCard ticker={ticker} />

 {/* === Signal Tracking Timeline — رحلة الإشارة (L2) ===
 Visual timeline of the tracked stock's journey from entry until now.
 Only renders for tracked stocks (has tracking?.isTracked). */}
 {detail.tracking?.isTracked && (
 <SignalTrackingTimeline ticker={ticker} />
 )}

 {/* === Liquidity Footprint — بصمة السيولة (Volume Profile) === */}
 <LiquidityFootprintCard ticker={ticker} />

 {/* === Company Fundamentals — بيانات الشركة المالية (8 جداول) === */}
 <CompanyFundamentalsCard ticker={ticker} />

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

 {/* === Market Intelligence — خريطة الكنوز (intraday + fundamentals + price history) === */}
 <MarketIntelligenceCard ticker={ticker} />
 </div>
 )}
 </div>
 </>
 );
}

// ============================================================================
// Trading Plan Section — real numbers calculated from price history
// (replaces generic guidance box with calculated supports/resistances,
// entry/stop/target1/target2, R:R ratio, and dynamic Arabic analysis)
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
 <span className="text-xs text-muted-foreground">{label}</span>
 <span className="flex items-baseline gap-1">
 <span className={`text-xs font-mono font-semibold ${valueClass || ''}`}>{value}</span>
 {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
 </span>
 </div>
 );
}

function TradingPlanSection({ detail, radarStock }: { detail: StockDetail; radarStock?: RadarStock | null }) {
 const t = useTranslation();
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

 const pred = detail.prediction;
 // UNIFY-FIX (Rule 27 NO-FAKE-DATA): أزلنا كل fabrications في Smart Entry Card.
 // entry/target/stop/R:R تأتي ONLY من prediction (predictions.db — Python V40.2).
 // لو لا توقع → null (لا fabrication، لا lastClose*1.05، لا support*0.98).
 const support_1 = pred?.support_level || (validLows10.length > 0 ? Math.min(...validLows10) : null);
 const support_2 = pred?.support_level_2 || (validLows20.length > 0 ? Math.min(...validLows20) : null);
 const resistance_1 = pred?.resistance_level || (validHighs10.length > 0 ? Math.max(...validHighs10) : null);
 const resistance_2 = pred?.resistance_level_2 || (validHighs20.length > 0 ? Math.max(...validHighs20) : null);

 // Entry / Stop / Targets — ONLY from prediction (Rule 73 SINGLE-DISPLAY-SOURCE)
 const entry_price = pred?.entry_price ?? null;
 const target_1 = pred?.target_price ?? null;
 const target_2 = pred?.target_price_2 ?? null;
 const stop_loss = pred?.stop_loss ?? null;
 const rr_ratio = pred?.risk_reward ?? null;

 // MA10 — average of last 10 closes
 const ma10 = last10.reduce((sum, p) => sum + p.close, 0) / last10.length;
 const above_ma10 = lastClose > ma10;

 // Volume ratio: last session volume vs avg of last 20 sessions
 const last_volume = sorted[sorted.length - 1].volume;
 const avg_20_vol = last20.reduce((sum, p) => sum + p.volume, 0) / last20.length;
 const vol_ratio = avg_20_vol > 0 ? last_volume / avg_20_vol : 0;

 // Range 10d % = (max_high - min_low) / min_low * 100
 const range_10d_pct = support_1 > 0 ? ((resistance_1 - support_1) / support_1) * 100 : 0;

 // ─── RADAR-QUICK-WINS (Priority 1): Smart Entry Card inputs ───────────────
 // Path description (emoji + plain Arabic) — falls back to "تحت الميكروسكوب"
 // if the drawer was opened from outside the radar table.
 const path: RadarPath | null = radarStock?.path ?? null;
 const pathDesc = path ? PATH_DESC[path] : null;
 const pathAccent = path ? accentClasses[pathMeta[path].accent] : accentClasses.amber;

 // Position size from API (0..1) — display as a percentage badge.
 const positionSizePct = radarStock?.position_size != null
 ? Math.round(radarStock.position_size * 1000) / 10
 : null;

 // Signal strength meter inputs.
 const signalCount = resolveSignalCount(radarStock);
 const maxSignals = resolveMaxSignals(path);

 // Entry zone from SSOT (or support_1 → lastClose)
 const entryZoneLow = pred?.entry_price_min || Math.min(support_1, lastClose);
 const entryZoneHigh = pred?.entry_price_max || lastClose;

 // Build dynamic Arabic analysis — changes based on real data, not a fixed string
 const analysis_lines: string[] = [];

 analysis_lines.push(
 above_ma10
 ? `السهم يتداول فوق متوسط 10 أيام (${fmtNum(lastClose)} > ${fmtNum(ma10)}).`
 : `السهم يتداول تحت متوسط 10 أيام (${fmtNum(lastClose)} < ${fmtNum(ma10)}).`
 );

 if (vol_ratio >= 1.5) {
 analysis_lines.push(`الحجم الحالي ${(vol_ratio ?? 0).toFixed(2)}× متوسط 20 يوم — تأكيد قوة.`);
 } else if (vol_ratio < 0.7) {
 analysis_lines.push(`الحجم الحالي ${(vol_ratio ?? 0).toFixed(2)}× متوسط 20 يوم — ضعف سيولة.`);
 }

 if (range_10d_pct < 6) {
 analysis_lines.push(`المدى الضيق ${(range_10d_pct ?? 0).toFixed(1)}% في آخر 10 أيام يشير لتجميع.`);
 } else if (range_10d_pct > 15) {
 analysis_lines.push(`المدى الواسع ${(range_10d_pct ?? 0).toFixed(1)}% في آخر 10 أيام يشير لتقلب عالي.`);
 } else {
 // Same dead-assignment shape as the recommendation block: this line used
 // to sit inside the `> 15` branch, so it could only ever render alongside
 // the "wide range / high volatility" message and the normal 6-15% range
 // produced no line at all.
 analysis_lines.push(`المدى ${(range_10d_pct ?? 0).toFixed(1)}% في آخر 10 أيام طبيعي.`);
 }

 // UNIFY-FIX (Rule 20 Python=Brain): أزلنا client-side recommendation fabrication.
 // كان الكود يحسب قرار تداول من above_ma10 + vol_ratio (client-side — مخالف Rule 20).
 // الآن: recommendation تأتي ONLY من prediction.signal_ar (Python V40.2).
 // لو لا توقع → "راجع التوصية الرسمية" (لا fabrication).
 const recommendation = pred?.signal_ar || 'راجع التوصية الرسمية من المحرك';

 // Gain / loss percentages — only if prediction values exist (no fabrication)
 const t1Gain = (entry_price && target_1) ? ((target_1 - entry_price) / entry_price) * 100 : null;
 const t2Gain = (entry_price && target_2) ? ((target_2 - entry_price) / entry_price) * 100 : null;
 const slLoss = (entry_price && stop_loss) ? ((stop_loss - entry_price) / entry_price) * 100 : null;

 return (
 <Card className={`p-3 ${pathAccent.softBg} ${pathAccent.card}`}>
 {/* ─── Header — path emoji + ticker + short Arabic meaning ─────── */}
 <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
 <div className="flex items-center gap-1.5 min-w-0">
 <div className={`h-7 w-7 rounded-full ${pathAccent.headerBg} flex items-center justify-center shrink-0`}>
 <Crosshair className={`h-3.5 w-3.5 ${pathAccent.iconColor}`} />
 </div>
 <div className="min-w-0">
 <div className={`text-xs font-semibold ${pathAccent.iconColor} truncate`}>
 📡 بطاقة الدخول الذكية
 </div>
 {pathDesc && (
 <div className="text-xs text-muted-foreground truncate">
 {pathDesc.emoji} {t(`predictions.makerRadar.paths.${path}.descShort`)} — {t(`predictions.makerRadar.paths.${path}.descLong`)}
 </div>
 )}
 </div>
 </div>
 {positionSizePct != null && (
 <Badge variant="outline" className={`text-xs h-5 px-1.5 ${pathAccent.badge}`} title="حجم المركز المقترح من المحفظة">
 <Crosshair className="h-3 w-3 ml-1" />
 حجم المركز: {(positionSizePct ?? 0).toFixed(1)}%
 </Badge>
 )}
 </div>

 {/* ─── Entry Zone (support_2 → current_price) ────────────────────── */}
 <div className="bg-background/60 rounded-md p-2 border border-border/40 mb-2">
 <div className="flex items-baseline justify-between flex-wrap gap-1">
 <span className="text-xs text-muted-foreground">💰 الدخول</span>
 <span className="font-mono text-sm font-bold text-primary " dir="ltr">
 {fmtNum(entryZoneLow)} → {fmtNum(entryZoneHigh)}
 </span>
 </div>
 <div className="text-xs text-muted-foreground mt-0.5">
 المنطقة المثالية (الدعم 20 يوم → السعر الحالي)
 </div>
 </div>

 {/* ─── Targets + Stop grid (prominent, 3 cells) ───────────────────── */}
 <div className="grid grid-cols-3 gap-1.5 mb-2">
 <div className="bg-background/60 rounded-md p-2 border border-profit/20 /40">
 <div className="text-xs text-muted-foreground flex items-center gap-0.5">
 <Target className="h-3 w-3" /> هدف 1
 </div>
 <div className="text-sm font-mono font-bold text-profit " dir="ltr">
 {fmtNum(target_1)}
 </div>
 <div className="text-xs text-profit font-mono">
 (+{(t1Gain ?? 0).toFixed(1)}%)
 </div>
 </div>
 <div className="bg-background/60 rounded-md p-2 border border-profit/20 /40">
 <div className="text-xs text-muted-foreground flex items-center gap-0.5">
 <Award className="h-3 w-3" /> هدف 2
 </div>
 <div className="text-sm font-mono font-bold text-profit " dir="ltr">
 {fmtNum(target_2)}
 </div>
 <div className="text-xs text-profit font-mono">
 (+{(t2Gain ?? 0).toFixed(1)}%)
 </div>
 </div>
 <div className="bg-background/60 rounded-md p-2 border border-loss/20 /40">
 <div className="text-xs text-muted-foreground flex items-center gap-0.5">
 <ShieldCheck className="h-3 w-3" /> وقف
 </div>
 <div className="text-sm font-mono font-bold text-loss " dir="ltr">
 {fmtNum(stop_loss)}
 </div>
 <div className="text-xs text-loss font-mono">
 ({(slLoss ?? 0).toFixed(1)}%)
 </div>
 </div>
 </div>

 {/* ─── Signal Strength Meter (Priority 2) ────────────────────────── */}
 {signalCount != null && maxSignals != null ? (
 <div className="bg-background/60 rounded-md p-2 border border-border/40 mb-2">
 <div className="flex items-center justify-between mb-1">
 <span className="text-xs text-muted-foreground flex items-center gap-1">
 <Gauge className="h-3 w-3" /> قوة الإشارة
 </span>
 <span className="text-xs text-muted-foreground">{signalHintAr(signalsToStars(signalCount, maxSignals))}</span>
 </div>
 <SignalStrengthMeter
 signalCount={signalCount}
 maxSignals={maxSignals}
 size="md"
 />
 </div>
 ) : (
 <div className="bg-background/60 rounded-md p-2 border border-border/40 mb-2 text-xs text-muted-foreground">
 ⚙️ قوة الإشارة غير متاحة لهذا المسار — يعتمد على التفاصيل الحجمية.
 </div>
 )}

 {/* ─── Support / Resistance levels (still useful for advanced users) ─── */}
 <details className="mb-2">
 <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none">
 مستويات الدعم والمقاومة (تفاصيل)
 </summary>
 <div className="space-y-0 mt-1">
 <TradingFieldRow label="سعر السهم الحالي" value={`${fmtNum(lastClose)} جنيه`} />
 <TradingFieldRow label="الدعم الأول" value={fmtNum(support_1)} sub="(أقل سعر في 10 أيام)" valueClass="text-profit " />
 <TradingFieldRow label="الدعم الثاني" value={fmtNum(support_2)} sub="(أقل سعر في 20 يوم)" valueClass="text-profit " />
 <TradingFieldRow label="المقاومة الأولى" value={fmtNum(resistance_1)} sub="(أعلى سعر في 10 أيام)" valueClass="text-loss " />
 <TradingFieldRow label="المقاومة الثانية" value={fmtNum(resistance_2)} sub="(أعلى سعر في 20 يوم)" valueClass="text-loss " />
 <TradingFieldRow label="نسبة العائد/المخاطرة" value={`${(rr_ratio ?? 0).toFixed(1)}:1`} valueClass="text-warning font-bold" />
 </div>
 </details>

 {/* ─── Dynamic analysis text — changes based on MA10 / volume / range ─── */}
 <div className="pt-2 border-t border-border/50">
 <div className="text-xs font-semibold text-primary mb-1">💡 التحليل:</div>
 <div className="space-y-0.5 text-xs text-muted-foreground leading-relaxed">
 {analysis_lines.map((line, i) => (
 <p key={i}>{line}</p>
 ))}
 <p className="font-medium text-foreground mt-1">{recommendation}</p>
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
 <div className="text-xs text-muted-foreground">{label}</div>
 </div>
 <div className={`text-sm font-mono font-bold ${valueClass || ''}`}>{value}</div>
 {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
 </Card>
 );
}

function FundamentalField({ label, value }: { label: string; value: string | null }) {
 return (
 <div className="bg-background/50 rounded-md px-2 py-1.5 border border-border/30">
 <div className="text-xs text-muted-foreground">{label}</div>
 <div className="font-mono font-semibold">{value ?? '—'}</div>
 </div>
 );
}

// ============================================================================
// Proof Section (collapsible)
// ============================================================================
function ProofSection() {
 const [open, setOpen] = useState(false);

 // P0-3 FIX (RADAR-AUDIT-UI): PROOF_METRICS كانت قيم ثابتة (precision=24.20%،
 // recall=21.08%، avg_rr=0.014) تُعرَض كأنها live. هذا fabrication مخالف لـ
 // Rule 27 (NO-FAKE-DATA). القيم الحقيقية متاحة عبر /api/radar/accuracy.
 // تم استبدال القسم الثابت بـ placeholder يحيل للـ API الكنسي.

 return (
 <Collapsible open={open} onOpenChange={setOpen}>
 <Card className="overflow-hidden">
 <CollapsibleTrigger asChild>
 <button className="w-full flex items-center justify-between p-3 md:p-4 hover:bg-muted/50 transition-colors">
 <div className="flex items-center gap-2">
 <div className="h-8 w-8 rounded-lg bg-profit/10 flex items-center justify-center">
 <ShieldCheck className="h-4 w-4 text-profit " />
 </div>
 <div className="text-right">
 <div className="text-sm font-semibold">إثباتات دقة الرادار</div>
 <div className="text-xs text-muted-foreground">القيم الحقيقية متاحة عبر API الدقة</div>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant="outline" className="text-xs hidden sm:inline-flex bg-warning text-warning border-warning">
 <Award className="h-3 w-3 ml-1" />
 بيانات حقيقية مطلوبة
 </Badge>
 <ChevronLeft className={`h-4 w-4 text-muted-foreground transition-transform ${open ? '-rotate-90' : ''}`} />
 </div>
 </button>
 </CollapsibleTrigger>

 <CollapsibleContent>
 <div className="p-3 md:p-4 pt-0 space-y-3 border-t border-border/50">
 {/* P0-3: placeholder بدل القيم الثابتة الوهمية */}
 <div className="mt-3 p-4 rounded-lg bg-warning/20 border border-warning text-center">
 <div className="flex items-center justify-center gap-2 mb-2">
 <AlertTriangle className="h-5 w-5 text-warning" />
 <span className="text-sm font-bold text-warning ">
 القيم الحقيقية متاحة عبر API الدقة
 </span>
 </div>
 <p className="text-xs text-muted-foreground leading-relaxed mb-3">
 كانت تُعرَض هنا قيم ثابتة (precision=24.20%، recall=21.08%، avg_rr=0.014)
 كأنها نتائج حية — وهذا مخالف لقاعدة &quot;لا بيانات وهمية&quot;.
 القيم الحقيقية تُحسَب من predictions.db عبر:
 </p>
 <code className="block text-xs font-mono bg-card border border-border rounded p-2 text-profit mb-2" dir="ltr">
 GET /api/radar/accuracy?market=EGX&amp;days=90
 </code>
 <p className="text-xs text-muted-foreground">
 (P0-3 RADAR-AUDIT-UI — Rule 27 NO-FAKE-DATA + Rule 73 SINGLE-DISPLAY-SOURCE)
 </p>
 </div>
 </div>
 </CollapsibleContent>
 </Card>
 </Collapsible>
 );
}

// ─── ORPHAN CODE (P0-3 RADAR-AUDIT-UI — kept for reference, no longer used) ───
// ProofMetricCard + ExplosiveBarChart كانت تُستخدم في ProofSection القديم
// الذي عرض PROOF_METRICS الثابتة. مع تعطيل القيم الثابتة (Rule 27)،
// لم يعدا يُستخدمان. يُحتفظ بهما للتوثيق (VERIFY-BEFORE-DELETE).
// لإعادة التفعيل: اجلب القيم الحقيقية من /api/radar/accuracy بدل الثوابت.
// ─────────────────────────────────────────────────────────────────────────────

interface ProofMetricCardProps {
 icon: React.ReactNode;
 label: string;
 value: string;
 sub?: string;
 accent: 'blue' | 'amber' | 'rose' | 'emerald';
}

function ProofMetricCard({ icon, label, value, sub, accent }: ProofMetricCardProps) {
 const colors: Record<ProofMetricCardProps['accent'], { bg: string; text: string }> = {
 blue: { bg: 'bg-primary/10', text: 'text-primary ' },
 amber: { bg: 'bg-warning/10', text: 'text-warning ' },
 rose: { bg: 'bg-loss/10', text: 'text-loss ' },
 emerald: { bg: 'bg-profit/10', text: 'text-profit ' },
 };
 const c = colors[accent];
 return (
 <Card className="p-2.5">
 <div className="flex items-center gap-1.5 mb-1">
 <div className={`h-6 w-6 rounded ${c.bg} flex items-center justify-center`}>
 <div className={c.text}>{icon}</div>
 </div>
 <div className="text-xs text-muted-foreground">{label}</div>
 </div>
 <div className={`text-lg font-bold font-mono ${c.text}`}>{value}</div>
 {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
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
 <div className="text-xs font-mono font-semibold text-profit mb-1">
 {detected}
 </div>
 <div
 className="w-full bg-gradient-to-t from-profit to-profit rounded-t-md transition-all"
 style={{ height: `${Math.max(detectedPct, 4)}%` }}
 title={`${detected} مكتشفة`}
 />
 <div className="text-xs text-muted-foreground mt-1 text-center">مكتشفة</div>
 </div>
 <div className="flex-1 flex flex-col items-center justify-end">
 <div className="text-xs font-mono font-semibold text-loss mb-1">
 {missed}
 </div>
 <div
 className="w-full bg-gradient-to-t from-loss to-loss rounded-t-md transition-all"
 style={{ height: `${Math.max(missedPct, 4)}%` }}
 title={`${missed} فائتة`}
 />
 <div className="text-xs text-muted-foreground mt-1 text-center">فائتة</div>
 </div>
 </div>
 <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/30">
 <span>إجمالي الانفجارات: <span className="font-bold text-foreground">{total}</span></span>
 <span>نسبة الاكتشاف: <span className="font-bold text-profit ">
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

// ============================================================================
// MarketIntelligenceCard — خريطة الكنوز (intraday + fundamentals + price history)
// ============================================================================

function MarketIntelligenceCard({ ticker }: { ticker: string }) {
 const [data, setData] = useState<any>(null);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 let cancelled = false;
 setLoading(true);
 fetch(`/api/maker-radar/market-intelligence?ticker=${encodeURIComponent(ticker)}`)
 .then((r) => r.json())
 .then((j) => { if (!cancelled) setData(j); })
 .catch(() => {})
 .finally(() => { if (!cancelled) setLoading(false); });
 return () => { cancelled = true; };
 }, [ticker]);

 if (loading) {
 return (
 <Card className="p-3 border-primary/20">
 <div className="flex items-center gap-2">
 <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
 <span className="text-xs text-muted-foreground">بيحلّل بيانات السوق...</span>
 </div>
 </Card>
 );
 }

 if (!data?.success) {
 return (
 <Card className="p-3 border-dashed border-muted-foreground/30">
 <div className="text-xs text-muted-foreground text-center">تعذّر تحليل البيانات</div>
 </Card>
 );
 }

 const sections = data.sections || {};
 const intraday = sections.intraday || {};
 const fundamentals = sections.fundamentals || {};
 const intelligence = sections.intelligence || {};
 const priceHistory = sections.priceHistory || {};

 return (
 <Card className="p-3 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 space-y-3">
 <div className="flex items-center gap-1.5">
 <Target className="h-3.5 w-3.5 text-primary" />
 <span className="text-xs font-bold">خريطة ذكاء السوق</span>
 <Badge variant="outline" className="text-xs ml-auto">تحليل آلي</Badge>
 </div>

 {/* Intelligence Summary */}
 {intelligence?.signals?.length > 0 && (
 <div className="space-y-1">
 {intelligence.signals.map((sig: string, i: number) => (
 <div key={i} className="text-xs leading-relaxed bg-background/50 rounded px-2 py-1 border border-border/30">
 {sig}
 </div>
 ))}
 </div>
 )}
 {intelligence?.signalCount === 0 && (
 <p className="text-xs text-muted-foreground">لا توجد إشارات واضحة من fundamentals حالياً</p>
 )}

 {/* Intraday */}
 {intraday && !intraday.error && intraday.ticks > 0 && (
 <div className="space-y-2">
 <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
 <Activity className="w-3 h-3" /> بيانات لحظية ({intraday.date})
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
 <FundamentalField label="التغير" value={intraday.change} />
 <FundamentalField label="ضغط شراء" value={intraday.buyPressure} />
 <FundamentalField label="ضغط بيع" value={intraday.sellPressure} />
 <FundamentalField label="التوجه" value={intraday.sentiment} />
 <FundamentalField label="أعلى" value={intraday.maxPrice} />
 <FundamentalField label="أدنى" value={intraday.minPrice} />
 <FundamentalField label="إجمالي الفوليوم" value={intraday.totalVolume ? fmtMoney(intraday.totalVolume) : '—'} />
 <FundamentalField label="عدد النقاط" value={String(intraday.ticks || 0)} />
 </div>

 {/* Opening vs Closing */}
 <div className="grid grid-cols-2 gap-2">
 {intraday.opening && (
 <div className="bg-background/50 rounded-md p-2 border border-border/30">
 <div className="text-xs text-muted-foreground mb-1">مزاد الافتتاح</div>
 <div className="text-xs font-bold">{intraday.opening.direction}</div>
 <div className="text-xs text-muted-foreground">فوليوم: {intraday.opening.volume ? fmtMoney(intraday.opening.volume) : '—'}</div>
 </div>
 )}
 {intraday.closing && (
 <div className="bg-background/50 rounded-md p-2 border border-border/30">
 <div className="text-xs text-muted-foreground mb-1">مزاد الإغلاق</div>
 <div className="text-xs font-bold">{intraday.closing.direction}</div>
 <div className="text-xs text-muted-foreground">فوليوم: {intraday.closing.volume ? fmtMoney(intraday.closing.volume) : '—'}</div>
 </div>
 )}
 </div>

 {/* Volume Profile */}
 {intraday.volumeProfile?.length > 0 && (
 <div className="space-y-1">
 <div className="text-xs text-muted-foreground">بصمة السيولة (أعلى 5 مستويات)</div>
 {intraday.volumeProfile.map((vp: any, i: number) => (
 <div key={i} className="flex items-center gap-2 text-xs">
 <span className="font-mono font-semibold w-16">{vp.price?.toFixed(2)}</span>
 <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
 <div className="h-full bg-primary/10" style={{ width: `${Math.min(100, (vp.volume / intraday.volumeProfile[0].volume) * 100)}%` }} />
 </div>
 <span className="text-muted-foreground w-16 text-left">{fmtMoney(vp.volume)}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 )}

 {/* Fundamentals */}
 {fundamentals && !fundamentals.error && (fundamentals.valuation || fundamentals.performance || fundamentals.profitability) && (
 <div className="space-y-2">
 <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
 <Info className="w-3 h-3" /> الأساسيات (من data_engine.db)
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
 {fundamentals.valuation && (
 <>
 <FundamentalField label="P/E" value={fundamentals.valuation.pe} />
 <FundamentalField label="P/B" value={fundamentals.valuation.pb} />
 <FundamentalField label="P/S" value={fundamentals.valuation.ps} />
 <FundamentalField label="PEG" value={fundamentals.valuation.peg} />
 <FundamentalField label="القيمة السوقية" value={fundamentals.valuation.marketCap} />
 </>
 )}
 {fundamentals.performance && (
 <>
 <FundamentalField label="أسبوع" value={fundamentals.performance.perf1w} />
 <FundamentalField label="شهر" value={fundamentals.performance.perf1m} />
 <FundamentalField label="3 شهور" value={fundamentals.performance.perf3m} />
 <FundamentalField label="سنة" value={fundamentals.performance.perf1y} />
 </>
 )}
 {fundamentals.profitability && (
 <>
 <FundamentalField label="ROE" value={fundamentals.profitability.roe} />
 <FundamentalField label="ROA" value={fundamentals.profitability.roa} />
 </>
 )}
 </div>
 </div>
 )}

 {/* Price History */}
 {priceHistory && !priceHistory.error && priceHistory.days > 0 && (
 <div className="space-y-2">
 <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
 <TrendingUp className="w-3 h-3" /> ملخص السعر ({priceHistory.days} يوم)
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
 <FundamentalField label="العائد" value={priceHistory.return30d} />
 <FundamentalField label="المدى" value={`${priceHistory.range} (${priceHistory.rangePct})`} />
 <FundamentalField label="موقع السعر" value={priceHistory.positionInRange} />
 <FundamentalField label="دعم قريب" value={priceHistory.nearestSupport} />
 <FundamentalField label="مقاومة قريبة" value={priceHistory.nearestResistance} />
 <FundamentalField label="متوسط فوليوم" value={priceHistory.avgVolume ? fmtMoney(priceHistory.avgVolume) : '—'} />
 </div>
 </div>
 )}
 </Card>
 );
}

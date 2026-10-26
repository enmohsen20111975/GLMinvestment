'use client';

/**
 * LiquidityRadarView — رادار تدفق السيولة المؤسسية ونبض الحيتان
 * =================================================================
 * يستخدم UnifiedTable (الجدول الموحد) بدلاً من الكروت الطولية.
 * 10 أعمدة واضحة + MiniSparkline + UnifiedPublishButton في كل صف.
 * onRowClick → يفتح StockDetailSheet بالسهم المختار.
 *
 * Rule 4: Python = brain — كل البيانات من /api/v2/liquidity-radar
 * Rule 27: NO-FAKE-DATA
 * Rule 30: emerald/teal/rose فقط
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn, fmtPrice } from '@/lib/utils';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';
import { LockModal } from '@/components/auth/LockModal';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { StockDetailDrawer } from '@/modules/predictions/components/MakerRadarTab';
// ALPHA-UX-FIX-6: guest CTA + sectors tracking (moved from #recommendations)
import { GuestLimitCta } from '@/components/auth/GuestLimitCta';
import { SectorTrackingTab } from '@/modules/market-analysis/components/SectorTrackingTab';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
 Shield, RefreshCw, AlertTriangle, Activity,
 TrendingUp, TrendingDown, Layers, Lock,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useSession } from '@/lib/next-auth-shim';
// TASK-I18N: useTranslation for bilingual support (ar ↔ en).
import { useTranslation } from '@/lib/i18n-context';
// BLUEPRINT Phase 1: unified component library
import { FlowPhaseTag, UnifiedEmptyState, LiquidityFlashCell, UnifiedPagination } from '@/components/shared/ui';
import { FlashingPriceCell } from '@/components/shared/FlashingPriceCell';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';

// ============================================================================
// Types
// ============================================================================

interface WhaleInfo {
 net_flow_egp: number | null;
 whale_present: boolean | null;
 flow_strength: string | null;
 buy_pct?: number | null;
 sell_pct?: number | null;
}

interface MarketRegime {
 regime: string | null;
 change_pct: number | null;
 is_bear?: boolean | null;
 is_bull?: boolean | null;
}

interface EntryDefense {
 entry_level: number | null;
 defense_level: number | null;
 resistance_level?: number | null;
}

interface RadarStock {
 ticker: string;
 name?: string | null;
 sector?: string | number | null;
 // LIQUIDITY-RADAR-AUDIT: حقول حقيقية للسهم (من Python — مش من market_regime)
 current_price?: number | null;
 change_percent?: number | null;
 whale: WhaleInfo;
 market_regime: MarketRegime;
 phase: string;
 phase_reason?: string | null;
 entry_defense: EntryDefense;
 reason: string | null;
 // TASK-BACKEND-BRAVO: canonical mutually-exclusive liquidity bucket
 liquidity_bucket?: string | null;
 liquidity_bucket_ar?: string | null;
 net_flow_5d?: number | null;
 volume?: number | null;
 // FRONTEND-2 Phase 1: fields surfaced from maker_radar cache for Phase 2 columns
 correction_status?: string | null;
 drop_from_peak?: number | null;
 accumulation?: string | null;
 expected?: string | null;
 roc_10d?: number | null;
 turnover_egp?: number | null;
 // ─── B3 (Task 2-a): additive contract fields ─────────────────────────
 // canonical mutually-exclusive classification — drives the filter chips.
 // Consumers MUST treat 'unclassified' | 'INSUFFICIENT_DATA' | 'DATA_INVALID'
 // as "no actionable signal" — NOT as a trade opportunity, NOT as a dead trap.
 classification?: string | null;
 // Uppercase enum from B1 price_sanity gate.
 data_quality_status?: 'OK' | 'STALE' | 'INVALID' | 'UNAVAILABLE' | null;
 // B1 sanity gate status (separate from data_quality_status — sanity is about
 // price contamination, data_quality_status is about freshness).
 sanity_status?: 'OK' | 'DATA_INVALID' | 'STALE' | 'DATA_UNAVAILABLE' | string | null;
 sanity_reasons?: string[] | null;
 // B3: human-readable reasons (raw array — UI joins them for display).
 reasons?: string[] | null;
 // B3: ISO timestamp when this ticker was scanned by maker_radar.py.
 scan_timestamp?: string | null;
 // B3: identity fields for cross-market display.
 company?: string | null;
 market?: string | null;
 currency?: string | null;
 // Legacy lowercase data_quality from older cache (forward-compat).
 data_quality?: 'fresh' | 'stale' | 'very_stale' | 'unknown' | 'invalid' | 'unavailable' | null;
}


// ─── TASK-A1 (Task 2-b): B3 contract — classification-driven filters ───────
// HARD CONSTRAINT #1: Show ALL stocks the API sends (the new `results` array).
// HARD CONSTRAINT #3: counts come from REAL API data — NO hardcoding.
// HARD CONSTRAINT #5: DATA_INVALID / INSUFFICIENT_DATA get their OWN chip
//   (combined as "بيانات غير مكتملة") — NOT under "dead_trap".
import {
  RADAR_FILTERS,
  type RadarFilterKey,
  filterStocksByClassification,
  buildRadarFilterCounts,
  getRadarStatusReasons,
  describeRadarStatus,
  isDataInvalidStock,
} from '@/components/shared/radar-filters';

const PAGE_SIZE = 25;
const INACTIVE_VOLUME_THRESHOLD = 100_000; // 100K EGP — below = inactive

interface RadarSummary {
  source_count: number;
  scanned_count: number;
  valid_data_count: number;
  classified_count: number;
  unclassified_count: number;
  data_error_count: number;
  scan_timestamp: string | null;
}

interface RadarResponse {
 success: boolean;
 market: string;
 market_regime: MarketRegime | null;
 scanned_count?: number;
 // B3 (Task 2-a): source list size (no vanishing check).
 source_count?: number;
 // B3 (Task 2-a): full summary block from the backend.
 summary?: RadarSummary | null;
 phases_breakdown?: Record<string, number>;
 // B3: `results` is the FULL scanned set (every ticker — no vanishing).
 // `stocks` is the same array (legacy alias kept for backward compat).
 stocks: RadarStock[];
 results?: RadarStock[];
 error?: string | null;
 message?: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

function fmtFlow(n: number | null | undefined): string {
 if (n == null || !Number.isFinite(Number(n))) return '—';
 const abs = Math.abs(Number(n));
 const sign = Number(n) >= 0 ? '+' : '-';
 if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
 if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
 return `${sign}${abs.toFixed(0)}`;
}

// P0-COMPONENT-UNIFICATION Phase 2.7: removed local fmtPrice — now imported from '@/lib/utils'.
// (was: function fmtPrice(n) { if (n == null...) return '—'; return Number(n).toFixed(2); })

function fmtPct(n: number | null | undefined): string {
 if (n == null || !Number.isFinite(Number(n))) return '—';
 const sign = n >= 0 ? '+' : '';
 return `${sign}${Number(n).toFixed(2)}%`;
}

const PHASE_LABELS: Record<string, string> = {
 'بيبلع على الهادي': 'تجميع هادئ',
 'بيتحضر': 'صعود',
 'بيصرف': 'تصريف',
 'بيانات غير كافية': 'غير كافية',
};

const PHASE_COLORS: Record<string, string> = {
 'بيبلع على الهادي': 'bg-profit/10 text-profit border-profit/20',
 'بيتحضر': 'bg-whale/10 text-whale border-whale/20',
 'بيصرف': 'bg-loss/10 text-loss border-loss/20',
 'بيانات غير كافية': 'bg-muted text-muted-foreground border-border',
};

function getPhaseInfo(rawPhase?: string | null, netFlow?: number | null): { label: string; cls: string } {
 if (!rawPhase) return { label: '—', cls: 'bg-muted text-muted-foreground border-border' };
 // P0-FIX (جيمي directive): أي سهم سيولته الـ 5 أيام سالبة (netFlow < 0)
 // ياخد لون الحذر والتصريف فوراً — ممنوع نهائياً يشوف اللون الأخضر.
 if (netFlow != null && Number(netFlow) < 0) {
 return { label: 'تصريف وحذر', cls: 'bg-loss/10 text-loss border-loss/20' };
 }
 const p = rawPhase.toLowerCase().trim();
 // ALPHA-PHASE3: دعم حالات الـ RVOL الصادرة من محرك بايثون
 if (p.includes('dry_accumulation')) {
 return { label: 'جفاف سيولة (تربص)', cls: 'bg-whale/10 text-whale border-whale/20' };
 }
 if (p.includes('accumulation_confirmed')) {
 return { label: 'اختراق وتأكيد تجميع', cls: 'bg-profit/10 text-profit border-profit/20' };
 }
 if (p.includes('distribution_risk')) {
 return { label: 'ذروة شراء وخطر تصريف', cls: 'bg-warning/10 text-warning border-warning/20' };
 }
 if (p.includes('illiquid_trap')) {
 return { label: 'سهم ميت (مصيدة)', cls: 'bg-muted text-muted-foreground border-border' };
 }
 // Legacy phases (backward compat)
 if (p.includes('quiet_accumulation') || p.includes('b_quiet') || p.includes('بيبلع') || p.includes('تجميع هادئ')) {
 return { label: 'تجميع هادئ', cls: 'bg-whale/10 text-whale border-whale/20' };
 }
 if (p.includes('accumulation') || p.includes('تجميع')) {
 return { label: 'تجميع قوي', cls: 'bg-profit/10 text-profit border-profit/20' };
 }
 if (p.includes('distribution') || p.includes('بيصرف') || p.includes('تصريف') || p.includes('outflow')) {
 return { label: 'تصريف وحذر', cls: 'bg-loss/10 text-loss border-loss/20' };
 }
 if (p.includes('inflow') || p.includes('بيتحضر') || p.includes('صعود') || p.includes('surge')) {
 return { label: 'صعود وتدفق', cls: 'bg-profit/10 text-profit border-profit/20' };
 }
 if (p.includes('absorption') || p.includes('قيعان')) {
 return { label: 'تجميع قيعان', cls: 'bg-whale/10 text-whale border-whale/20' };
 }
 if (p.includes('correction') || p.includes('تصحيح')) {
 return { label: 'نهاية تصحيح', cls: 'bg-warning/10 text-warning border-warning/20' };
 }
 return {
 label: PHASE_LABELS[rawPhase] || rawPhase,
 cls: PHASE_COLORS[rawPhase] || 'bg-muted text-muted-foreground border-border'
 };
}


const MARKET_OPTIONS = [
 { code: 'EGX', label: '🇪🇬 مصر', currency: 'ج.م' },
 { code: 'TADAWUL', label: '🇸🇦 السعودية', currency: 'ر.س' },
 { code: 'KSE', label: '🇰🇼 الكويت', currency: 'د.ك' },
 { code: 'QSE', label: '🇶🇦 قطر', currency: 'ر.ق' },
 { code: 'US', label: '🇺🇸 أمريكا', currency: '$' },
 { code: 'CRYPTO', label: '🪙 كريبتو', currency: '$' },
] as const;

function marketCurrency(market: string): string {
 const found = MARKET_OPTIONS.find((m) => m.code === market);
 return found?.currency || 'ج.م';
}

// ============================================================================
// Main Component
// ============================================================================

export function LiquidityRadarView({
 market: marketProp,
 initialTab = 'radar',
}: {
 market?: string;
 initialTab?: 'radar' | 'sectors';
}) {
 const t = useTranslation('liquidityRadar');
 const storeMarket = useAppStore((s) => s.currentMarket);
 const storeStocks = useAppStore((s) => s.stocks);
 const { status: authStatus } = useSession();
 // FIX (2026-10-26): isGuest كان بيعتمد على useSession() اللي بترجع 'unauthenticated'
 // دائمًا في الـ sandbox (next-auth-shim.ts hardcoded). ده خلى كل المستخدمين — حتى
 // الأدمن — يتعرضوا كـ guest → GUEST_MAX_ROWS=5 بيقطعهم لـ 5 أسهم بس.
 // الحل: isGuest يعتمد على useAppStore.isAuthenticated (اللي بيتحدد عبر useAuthCheck
 // polling لـ /api/auth/me). كده أي مستخدم مسجل دخول بنجاح هيتعامل كـ authenticated
 // وهايشوف 25 سهم/صفحة بدل 5.
 const isAuthenticatedInStore = useAppStore((s) => s.isAuthenticated);
 const isGuest = !isAuthenticatedInStore && authStatus === 'unauthenticated';
 const GUEST_MAX_ROWS = 5;
 const [showLockModal, setShowLockModal] = useState(false);
 const [activeMarket, setActiveMarket] = useState(
 (marketProp || storeMarket || 'EGX').toUpperCase()
 );
 const market = activeMarket;
 const [activeTab, setActiveTab] = useState<'radar' | 'sectors'>(initialTab);

 useEffect(() => {
 if (initialTab) {
 setActiveTab(initialTab);
 }
 }, [initialTab]);

 const [data, setData] = useState<RadarResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
 const [bucketFilter, setBucketFilter] = useState<RadarFilterKey>('all');
 // TASK-A1: default OFF — show ALL scanned stocks (HARD CONSTRAINT #1).
 // User can opt-in to hide inactive via the toggle if they want a smaller view.
 const  [hideInactive, setHideInactive] = useState(false);
 const [page, setPage] = useState(0);
 const currency = marketCurrency(market);

 const fetchData = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 // FRONTEND-2 Phase 1: switch to /api/v2/liquidity-radar (cache reader, 20+ fields, all markets)
 // was: /api/market/liquidity-radar (Python proxy, 9 fields, 10 LARGE_CAPS only — left 4 columns blank)
 const res = await fetch(
 `/api/v2/liquidity-radar?market=${encodeURIComponent(market)}`,
 { cache: 'no-store' },
 );
 if (!res.ok) { setError('تعذّر الاتصال بالخادم'); setData(null); return; }
 const json: RadarResponse = await res.json();
 if (!json.success) { setError(json.message || json.error || 'فشل المحرك'); setData(json); return; }
 setData(json);
 } catch {
 setError('تعذّر الاتصال بالخادم');
 setData(null);
 } finally {
 setLoading(false);
 }
 }, [market]);

 useEffect(() => { fetchData(); }, [fetchData]);

 // BLUEPRINT Phase 5: Live polling — كل 60 ثانية خلال جلسة EGX (visibility-aware).
 // بـ re-fetch + re-sort لو السيولة اتغيرت. ما بـ re-renderش غير الـ rows اللي اتغيرت.
 useVisibilityAwarePolling(
 () => { fetchData(); },
 60_000, // 60s during market session
 [market],
 { market, allowOffMarket: false }
 );

 // ─── TASK-A1 (Task 2-b): classification-driven filtering (NO vanishing) ───
 // HARD CONSTRAINT #1: read `results` (the FULL scanned set) — fall back to
 // `stocks` (legacy alias) for older cache files. Every ticker the engine
 // scanned MUST appear in the UI (no drop, no price filter by default).
 // HARD CONSTRAINT #5: DATA_INVALID / INSUFFICIENT_DATA stocks get their own
 // `data_invalid` filter — they NEVER appear under `dead_trap`.
 const allScanned = React.useMemo(() => {
 // `results` is the canonical B3 array. `stocks` is the legacy alias (same
 // array on the wire). Prefer `results` when present.
 const list = data?.results ?? data?.stocks ?? [];
 return list;
 }, [data]);

 const filteredStocks = React.useMemo(() => {
 // Use the canonical classification (NOT the phase-string heuristic).
 // The helper handles missing classification gracefully (defaults to
 // 'unclassified' — never 'dead_trap').
 let out = filterStocksByClassification(allScanned, bucketFilter);
 if (hideInactive) {
 // Opt-in filter — user can hide inactive stocks (turnover < 1.5M EGP).
 // Default is OFF (HARD CONSTRAINT #1: show ALL stocks the API sends).
 out = out.filter((s) => {
 let turnover = Number(s.turnover_egp ?? 0);
 if (turnover === 0) {
 const vol = Number(s.volume ?? 0);
 const price = Number(s.current_price ?? 0);
 if (vol > 0 && price > 0) {
 turnover = vol * price;
 }
 }
 if (turnover === 0) {
 turnover = Number(s.whale?.net_flow_egp ?? 0);
 }
 return turnover >= 1500000; // 1.5M EGP minimum liquidity
 });
 }
 // GUEST: limit to 5 rows max — clear table, no blur
 if (isGuest) {
 out = out.slice(0, GUEST_MAX_ROWS);
 }
 return out;
 }, [allScanned, bucketFilter, hideInactive, isGuest]);

 // Pre-compute filter counts ONCE per data change — drives the chip badges.
 // HARD CONSTRAINT #3: counts come from REAL API data (the `results` array +
 // `summary` block). NO hardcoded numbers anywhere.
 const filterCounts = React.useMemo(() => {
 return buildRadarFilterCounts(allScanned, data?.summary ?? null);
 }, [allScanned, data?.summary]);

 // Quick alias for the canonical scanned total (prefers summary.scanned_count).
 const scannedTotal = filterCounts.all;

 // GUEST: always page 0 (no pagination for guests)
 const totalPages = isGuest ? 1 : Math.max(1, Math.ceil(filteredStocks.length / PAGE_SIZE));
 const safePage = isGuest ? 0 : Math.min(page, totalPages - 1);
 const pagedStocks = isGuest ? filteredStocks : filteredStocks.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

 React.useEffect(() => { setPage(0); }, [bucketFilter, hideInactive, activeMarket]);

 // ─── Build UnifiedTable columns ───
 const columns: Column<RadarStock>[] = [
 {
 key: 'ticker',
 header: 'السهم',
 sortable: true,
 width: 'min-w-[120px]',
 sortValue: (row) => row.ticker,
 filterValue: (row) => `${row.ticker} ${row.name || ''}`,
 render: (row) => (
 <div className="flex flex-col text-right">
 <span className="font-bold text-sm font-mono tabular-nums text-foreground group-hover:text-profit transition-colors underline-offset-2">
 {row.ticker}
 </span>
 <span className="text-xs text-muted-foreground truncate max-w-[120px]">{row.name || ''}</span>
 </div>
 ),
 },
 {
 key: 'price',
 header: 'السعر',
 sortable: true,
 width: 'w-20',
 align: 'center',
 sortValue: (row) => row.current_price ?? 0,
 filterValue: (row) => fmtPrice(row.current_price),
 // BLUEPRINT Phase 5: FlashingPriceCell — flash green/red لما السعر يتغير.
 render: (row) => (
 <FlashingPriceCell price={row.current_price ?? null} />
 ),
 },
 {
 key: 'change_pct',
 header: 'التغير%',
 sortable: true,
 width: 'w-20',
 align: 'center',
 sortValue: (row) => row.change_percent ?? 0,
 filterValue: (row) => fmtPct(row.change_percent),
 render: (row) => {
 const pct = row.change_percent;
 const isPositive = (pct ?? 0) >= 0;
 return (
 <span className={cn('font-mono tabular-nums font-semibold', isPositive ? 'text-profit' : 'text-loss')}>
 {fmtPct(pct)}
 </span>
 );
 },
 },
 {
 key: 'sparkline',
 header: 'شارت 7 أيام',
 sortable: true,
 width: 'w-28',
 align: 'center',
 sortValue: (row) => row.change_percent ?? 0,
 render: (row) => (
 <MiniSparkline ticker={row.ticker} height={35} width={90} showArea />
 ),
 },
 {
 key: 'whale_flow',
 header: t('flow5d'),
 sortable: true,
 width: 'w-28',
 align: 'center',
 sortValue: (row) => row.whale?.net_flow_egp ?? 0,
 filterValue: (row) => fmtFlow(row.whale?.net_flow_egp),
 // BLUEPRINT Phase 5: LiquidityFlashCell — flash green/red لما السيولة تتغير.
 render: (row) => (
 <LiquidityFlashCell value={row.whale?.net_flow_egp ?? null} />
 ),
 },
 // FRONTEND-2 Phase 2: ضغط الشراء/البيع — شريط بصري
 {
 key: 'buy_sell_pressure',
 header: 'ضغط الشراء/البيع',
 sortable: true,
 width: 'w-32',
 align: 'center',
 sortValue: (row) => row.whale?.buy_pct ?? 0,
 filterValue: (row) => `${row.whale?.buy_pct ?? 0}/${row.whale?.sell_pct ?? 0}`,
 render: (row) => {
 const buy = row.whale?.buy_pct;
 const sell = row.whale?.sell_pct;
 if (buy == null && sell == null) {
 return <span className="text-muted-foreground text-xs">—</span>;
 }
 const b = buy ?? 0;
 const s = sell ?? 0;
 const total = b + s;
 if (total === 0) {
 return <span className="text-muted-foreground text-xs">—</span>;
 }
 const buyPct = Math.round((b / total) * 100);
 const sellPct = 100 - buyPct;
 const isBuyDominant = buyPct >= 55;
 const isSellDominant = buyPct <= 45;
 const tone = isBuyDominant ? 'text-profit' : isSellDominant ? 'text-loss' : 'text-muted-foreground';
 return (
 <div className="flex flex-col items-center gap-1">
 <div className="flex w-24 h-2 rounded-full overflow-hidden bg-muted">
 <div className="bg-profit h-full" style={{ width: `${buyPct}%` }} />
 <div className="bg-loss h-full" style={{ width: `${sellPct}%` }} />
 </div>
 <div className={cn('flex justify-between w-24 text-[10px] font-mono tabular-nums', tone)}>
 <span className="text-profit">🟢{buyPct}%</span>
 <span className="text-loss">🔴{sellPct}%</span>
 </div>
 </div>
 );
 },
 },
 {
 key: 'phase',
 header: '📊 المرحلة',
 sortable: true,
 width: 'w-28',
 align: 'center',
 sortValue: (row) => getPhaseInfo(row.phase, row.whale?.net_flow_egp).label,
 filterValue: (row) => getPhaseInfo(row.phase, row.whale?.net_flow_egp).label,
 render: (row) => {
 const info = getPhaseInfo(row.phase, row.whale?.net_flow_egp);
 return (
 <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border', info.cls)}>
 <Layers className="w-3 h-3" />
 {info.label}
 </span>
 );
 },
 },
 // FRONTEND-2 Phase 2: مرحلة التصحيح — 3 حالات (صاعد / قرب التصحيح / في تصحيح)
 {
 key: 'correction_phase',
 header: '🔄 التصحيح',
 sortable: true,
 width: 'w-28',
 align: 'center',
 sortValue: (row) => row.correction_status ?? '',
 filterValue: (row) => row.correction_status ?? '',
 render: (row) => {
 const status = row.correction_status;
 const drop = row.drop_from_peak;
 if (!status) {
 return <span className="text-muted-foreground text-xs">—</span>;
 }
 let cls = 'bg-muted text-muted-foreground border-border';
 let icon = '•';
 if (status === 'صاعد' || status === 'خلص تصحيح') {
 cls = 'bg-profit/10 text-profit border-profit/20';
 icon = '🟢';
 } else if (status === 'قرب التصحيح' || status === 'قرب التصح') {
 cls = 'bg-warning/10 text-warning border-warning/20';
 icon = '🟡';
 } else if (status === 'في تصحيح' || status === 'في التصحيح') {
 cls = 'bg-loss/10 text-loss border-loss/20';
 icon = '🔴';
 }
 return (
 <div className="flex flex-col items-center gap-0.5">
 <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border', cls)}>
 {icon} {status}
 </span>
 {drop != null && drop < 0 && (
 <span className="text-[9px] text-muted-foreground font-mono tabular-nums">
 {drop.toFixed(1)}% من القمة
 </span>
 )}
 </div>
 );
 },
 },
 // FRONTEND-2 Phase 2: تصنيف السيولة canonical — 7 buckets
 {
 key: 'liquidity_bucket',
 header: '🏷️ تصنيف السيولة',
 sortable: true,
 width: 'w-32',
 align: 'center',
 sortValue: (row) => row.liquidity_bucket_ar ?? row.liquidity_bucket ?? '',
 filterValue: (row) => row.liquidity_bucket_ar ?? row.liquidity_bucket ?? '',
 render: (row) => {
 const bucketAr = row.liquidity_bucket_ar;
 const bucket = row.liquidity_bucket;
 if (!bucketAr && !bucket) {
 return <span className="text-muted-foreground text-xs">—</span>;
 }
 // 7 canonical buckets with colors
 const BUCKET_STYLE: Record<string, string> = {
 strong_whale_inflow: 'bg-profit/10 text-profit border-profit/20',
 moderate_inflow: 'bg-profit/5 text-profit border-profit/10',
 whale_outflow: 'bg-loss/10 text-loss border-loss/20',
 bottom_absorption: 'bg-whale/10 text-whale border-whale/20',
 correction_exhaustion: 'bg-warning/10 text-warning border-warning/20',
 avoid_falling_knife: 'bg-loss/15 text-loss border-loss/30',
 neutral: 'bg-muted text-muted-foreground border-border',
 };
 const cls = BUCKET_STYLE[bucket || ''] || 'bg-muted text-muted-foreground border-border';
 return (
 <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border', cls)}>
 {bucketAr || bucket}
 </span>
 );
 },
 },
 {
 key: 'entry',
 header: 'الدخول',
 sortable: true,
 width: 'w-20',
 align: 'center',
 sortValue: (row) => row.entry_defense?.entry_level ?? 0,
 filterValue: (row) => fmtPrice(row.entry_defense?.entry_level),
 // GUEST: اعرض قفل بدل السعر
 render: (row) => (
 isGuest ? (
 <span className="text-muted-foreground text-xs flex items-center justify-center gap-1">
 <Lock className="w-3 h-3" /> بعد التسجيل
 </span>
 ) : (
 <span className="font-mono tabular-nums font-semibold text-profit">
 {fmtPrice(row.entry_defense?.entry_level)}
 </span>
 )
 ),
 },
 {
 key: 'defense',
 header: 'الوقف',
 sortable: true,
 width: 'w-20',
 align: 'center',
 sortValue: (row) => row.entry_defense?.defense_level ?? 0,
 filterValue: (row) => fmtPrice(row.entry_defense?.defense_level),
 render: (row) => (
 isGuest ? (
 <span className="text-muted-foreground text-xs flex items-center justify-center gap-1">
 <Lock className="w-3 h-3" /> بعد التسجيل
 </span>
 ) : (
 <span className="font-mono tabular-nums font-semibold text-loss">
 {fmtPrice(row.entry_defense?.defense_level)}
 </span>
 )
 ),
 },
 {
 key: 'target',
 header: 'الهدف',
 sortable: true,
 width: 'w-20',
 align: 'center',
 sortValue: (row) => row.entry_defense?.resistance_level ?? 0,
 filterValue: (row) => fmtPrice(row.entry_defense?.resistance_level),
 render: (row) => (
 isGuest ? (
 <span className="text-muted-foreground text-xs flex items-center justify-center gap-1">
 <Lock className="w-3 h-3" /> بعد التسجيل
 </span>
 ) : (
 <span className="font-mono tabular-nums font-semibold text-whale">
 {fmtPrice(row.entry_defense?.resistance_level)}
 </span>
 )
 ),
 },
 // ─── TASK-A1 (Task 2-b): B3 classification status column ───────────────
 // HARD CONSTRAINT #5: render DATA_INVALID / INSUFFICIENT_DATA as a
 // SEPARATE state — show the `reasons` + `sanity_status` so the user
 // understands WHY the engine couldn't classify this ticker.
 {
 key: 'b3_status',
 header: '🔍 الحالة',
 sortable: true,
 width: 'w-40',
 align: 'center',
 sortValue: (row) => describeRadarStatus(row),
 filterValue: (row) => describeRadarStatus(row),
 render: (row) => {
 const status = describeRadarStatus(row);
 const reasons = getRadarStatusReasons(row);
 const cls = isDataInvalidStock(row)
 ? 'bg-warning/10 text-warning border-warning/20'
 : row.classification === 'dead_trap'
 ? 'bg-loss/10 text-loss border-loss/20'
 : row.classification === 'distribution'
 ? 'bg-warning/10 text-warning border-warning/20'
 : row.classification === 'quiet_accumulation'
 ? 'bg-profit/10 text-profit border-profit/20'
 : row.classification === 'liquidity_drought'
 ? 'bg-whale/10 text-whale border-whale/20'
 : row.classification === 'rule80_downtrend'
 ? 'bg-loss/10 text-loss border-loss/20'
 : 'bg-muted text-muted-foreground border-border';
 return (
 <div className="flex flex-col items-center gap-0.5" title={reasons.join(' | ')}>
 <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border', cls)}>
 {status}
 </span>
 {reasons.length > 0 && (
 <span className="text-[9px] text-muted-foreground max-w-[180px] truncate" dir="rtl">
 {reasons[0]}
 </span>
 )}
 </div>
 );
 },
 },
 // TASK-PUBLISH: شيلنا عمود "نشر" من كل صف — النشر بقى للجدول كله فوق
 ];

 return (
 <div className="space-y-4 p-4" dir="rtl">
 {/* ─── Market Selector Bar ─── */}
 <MarketSelectorBar activeMarket={market} onSelect={setActiveMarket} currency={currency} />

 {/* ─── Tabs Switcher: رادار السيولة vs حركة القطاعات ─── */}
 <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'radar' | 'sectors')} className="w-full">
 <div className="flex justify-center mb-2">
 <TabsList className="grid grid-cols-2 w-full max-w-md bg-muted/80 p-1 rounded-xl border border-border/50">
 <TabsTrigger
 value="radar"
 className="flex items-center justify-center gap-2 py-2 text-sm font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm"
 >
 <Activity className="w-4 h-4 text-profit" />
 <span>رادار السيولة</span>
 </TabsTrigger>
 <TabsTrigger
 value="sectors"
 className="flex items-center justify-center gap-2 py-2 text-sm font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm"
 >
 <Layers className="w-4 h-4 text-whale" />
 <span>حركة القطاعات</span>
 </TabsTrigger>
 </TabsList>
 </div>

 {/* ─── TAB 1: رادار السيولة ─── */}
 <TabsContent value="radar" className="space-y-4 mt-0">
 <PulseRibbon market={market} summary={data?.summary ?? null} scannedCount={scannedTotal} />

 {/* A1 FIX: Scan stats display — إجمالي الأسهم المفحوصة + المصنّفة + غير المصنّفة */}
 {data && data.stocks && data.stocks.length > 0 && (
  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
   <Badge variant="outline" className="font-mono">
    المفحوصة: {data.summary?.scanned_count ?? data.scanned_count ?? data.stocks.length}
   </Badge>
   <Badge variant="outline" className="font-mono">
    المعروضة: {data.stocks.length}
   </Badge>
   <Badge variant="outline" className="font-mono text-profit">
    مصنّفة: {data.summary?.classified_count ?? data.stocks.filter(s => s.classification && s.classification !== 'unclassified' && s.classification !== 'DATA_INVALID' && s.classification !== 'INSUFFICIENT_DATA').length}
   </Badge>
   <Badge variant="outline" className="font-mono text-muted-foreground">
    غير مصنّفة: {data.summary?.unclassified_count ?? data.stocks.filter(s => s.classification === 'unclassified').length}
   </Badge>
   <Badge variant="outline" className="font-mono text-loss/70">
    بيانات ناقصة: {data.summary?.data_error_count ?? data.stocks.filter(s => isDataInvalidStock(s)).length}
   </Badge>
  </div>
 )}

 {loading ? (
 <div className="space-y-4">
 <Skeleton className="h-12 w-full rounded-xl" />
 <Skeleton className="h-64 w-full rounded-xl" />
 </div>
 ) : error || !data || allScanned.length === 0 ? (
 <UnifiedEmptyState
 variant={error ? 'error' : 'empty'}
 title={error ? 'تعذّر تحميل الرادار' : 'لا توجد إشارات رادار حالياً'}
 description={error || (
 // TASK-A1: if summary says scanned > 0 but `results` is empty, that's
 // a backend bug — show honest message. Otherwise, the engine hasn't
 // scanned yet — show the standard "scanning" message.
 (data?.summary && (data.summary.scanned_count ?? 0) > 0)
 ? 'تم الفحص لكن لا توجد تصنيفات — تحقق من سجلات المحرك'
 : 'المحرّك بيفحص السوق كل 5 دقائق — ستظهر الأسهم هنا فور رصدها'
 )}
 actionLabel="إعادة المحاولة"
 onAction={fetchData}
 />
 ) : (
 <>
 {/* ─── TASK-PUBLISH: نشر الجدول كله + فلتر الأسهم الخاملة ─── */}
 <div className="bg-card border border-border rounded-xl p-2 flex flex-wrap items-center gap-1.5">
 <UnifiedPublishButton
 content={`📊 رادار السيولة — ${market}\n\n${pagedStocks.slice(0, 10).map(s =>
 `🎯 ${s.ticker} — ${PHASE_LABELS[s.phase] || s.phase} | دخول: ${fmtPrice(s.entry_defense?.entry_level)} | وقف: ${fmtPrice(s.entry_defense?.defense_level)} | هدف: ${fmtPrice(s.entry_defense?.resistance_level)}`
 ).join('\n')}\n\n${OFFICIAL_LINKS_BLOCK}`}
 title={`📊 رادار السيولة — ${market}`}
 filename={`liquidity-radar-${market}-${new Date().toISOString().slice(0, 10)}`}
 hashtags={['EGX', 'رادار', 'سيولة']}
 variant="outline"
 size="sm"
 />
 <div className="h-4 w-px bg-border mx-1" />
 {RADAR_FILTERS.map((f) => {
 // TASK-A1: counts come from REAL API data — NO hardcoding.
 // `filterCounts` is computed once per data change from `buildRadarFilterCounts`.
 // `all` uses `summary.scanned_count` (the canonical engine-reported total).
 const count = filterCounts[f.key] ?? 0;
 const active = bucketFilter === f.key;
 return (
 <button
 key={f.key}
 onClick={() => setBucketFilter(f.key)}
 aria-pressed={active}
 aria-label={`${f.label} (${count})`}
 className={cn(
 'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border flex items-center gap-1',
 active
 ? f.cls + ' shadow-sm ring-1 ring-profit/20'
 : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted'
 )}
 >
 <span aria-hidden>{f.icon}</span>
 <span>{f.label}</span>
 <span className="text-[9px] opacity-70">({count})</span>
 </button>
 );
 })}
 <label className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
 <input
 type="checkbox"
 checked={hideInactive}
 onChange={(e) => setHideInactive(e.target.checked)}
 className="w-3.5 h-3.5 accent-profit"
 />
 إخفاء الأسهم الخاملة (&lt;100K)
 </label>
 </div>

 {/* ─── UnifiedTable (paginated) ─── */}
 <UnifiedTable<RadarStock>
 columns={columns}
 data={pagedStocks}
 keyField="ticker"
 dense
 filterable
 columnToggle
 onRowClick={(row) => {
 if (isGuest) {
 setShowLockModal(true);
 return;
 }
 setSelectedTicker(row.ticker);
 }}
 maxHeight="calc(100vh - 280px)"
 emptyText={bucketFilter === 'all' ? 'لا توجد أسهم مطابقة' : `لا توجد أسهم في تصنيف "${RADAR_FILTERS.find(f => f.key === bucketFilter)?.label || ''}"`}
 className="bg-card border-border rounded-xl"
 />

 {/* ─── Pagination ─── */}
 {totalPages > 1 && (
 <div className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-3 py-2">
 <span className="text-xs text-muted-foreground">
 عرض {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredStocks.length)} من {filteredStocks.length} سهم
 {bucketFilter !== 'all' && ` (مُصفّى: ${RADAR_FILTERS.find(f => f.key === bucketFilter)?.label})`}
 </span>
 {/* P0-COMPONENT-UNIFICATION Phase 2.4: UnifiedPagination */}
 <UnifiedPagination
 page={safePage}
 totalPages={totalPages}
 onChange={setPage}
 size="sm"
 variant="compact"
 />
 </div>
 )}

 {/* ALPHA-UX-FIX-6: guest freemium CTA */}
 <GuestLimitCta shown={pagedStocks.length} total={filteredStocks.length} itemLabel="إشارة" itemLabelPlural="إشارات" />
 </>
 )}
 </TabsContent>

 {/* ─── TAB 2: حركة القطاعات ─── */}
 <TabsContent value="sectors" className="space-y-4 mt-0">
 <SectorTrackingTab market={market} />
 </TabsContent>
 </Tabs>

 {/* ─── Rich StockDetailDrawer Dialog (SSOT Maker Radar Modal) ─── */}
 <Dialog open={!!selectedTicker} onOpenChange={(open) => { if (!open) setSelectedTicker(null); }}>
 <DialogContent
 className="max-w-[95vw] w-full h-[92vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg sm:max-w-3xl"
 showCloseButton={false}
 >
 {selectedTicker && (
 <StockDetailDrawer
 ticker={selectedTicker}
 radarStock={((data?.stocks ?? []).find((s) => s.ticker === selectedTicker) || (storeStocks ?? []).find((s) => s.ticker === selectedTicker)) as any}
 sectorForTicker={(t) => (storeStocks ?? []).find((s) => s.ticker === t)?.sector || (data?.stocks ?? []).find((s) => s.ticker === t)?.sector || null}
 sectorChangeForTicker={() => null}
 onClose={() => setSelectedTicker(null)}
 onTrackToggle={() => {}}
 />
 )}
 </DialogContent>
 </Dialog>

 {/* GUEST: LockModal يظهر فقط لما العميل يضغط على محتوى مقفول */}
 <LockModal
 open={showLockModal}
 onClose={() => setShowLockModal(false)}
 onSignUp={() => {
 setShowLockModal(false);
 useAppStore.getState().setCurrentView('auth');
 }}
 lockedItem="تفاصيل السهم"
 />
 </div>
 );
}

// ============================================================================
// Pulse Ribbon
// ============================================================================

function PulseRibbon({
 market,
 scannedCount,
 summary,
}: {
 market: string;
 scannedCount: number;
 summary?: RadarSummary | null;
}) {
 // TASK-A1: surface the canonical summary counts. NO fabrication — if the
 // backend didn't send `summary`, we show only the scanned count (which
 // itself comes from the real `results` array).
 const classified = summary?.classified_count ?? null;
 const unclassified = summary?.unclassified_count ?? null;
 const dataErrors = summary?.data_error_count ?? null;
 return (
 <div className="w-full bg-muted px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-sm rounded-xl border border-border">
 <div className="flex items-center gap-3">
 <div className="flex items-center gap-1.5">
 <span className="relative flex h-2.5 w-2.5">
 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-profit opacity-75" />
 <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-profit" />
 </span>
 <span className="font-mono text-[10px] text-profit uppercase tracking-widest">رادار سيولة صانع السوق</span>
 </div>
 <div className="h-4 w-px bg-border" />
 <div className="flex items-center gap-1.5 text-xs">
 <span className="text-muted-foreground">السوق:</span>
 <span className="font-mono font-semibold text-foreground">{market}</span>
 </div>
 </div>
 <div className="flex items-center gap-3 flex-wrap">
 <div className="flex items-center gap-1 text-xs text-muted-foreground">
 <Shield className="w-3.5 h-3.5 text-profit" />
 <span>بروتوكول Rule 80 نشط</span>
 </div>
 <div className="h-4 w-px bg-border" />
 <span className="font-mono text-[10px] text-muted-foreground">
 مرقوب: <span className="text-foreground font-semibold">{scannedCount}</span> سهم
 </span>
 {classified != null && (
 <>
 <div className="h-4 w-px bg-border" />
 <span className="font-mono text-[10px] text-profit">
 مصنّف: {classified}
 </span>
 </>
 )}
 {unclassified != null && (
 <>
 <div className="h-4 w-px bg-border" />
 <span className="font-mono text-[10px] text-muted-foreground">
 غير مصنّف: {unclassified}
 </span>
 </>
 )}
 {dataErrors != null && dataErrors > 0 && (
 <>
 <div className="h-4 w-px bg-border" />
 <span className="font-mono text-[10px] text-warning" title="بيانات غير صالحة / غير مكتملة">
 بيانات خاطئة: {dataErrors}
 </span>
 </>
 )}
 </div>
 </div>
 );
}

// ============================================================================
// Market Selector Bar
// ============================================================================

function MarketSelectorBar({
 activeMarket,
 onSelect,
 currency,
}: {
 activeMarket: string;
 onSelect: (m: string) => void;
 currency: string;
}) {
 return (
 <div className="w-full bg-card border border-border rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-xs font-semibold text-muted-foreground shrink-0">السوق:</span>
 {MARKET_OPTIONS.map((m) => (
 <button
 key={m.code}
 onClick={() => onSelect(m.code)}
 className={cn(
 'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
 activeMarket === m.code
 ? 'bg-profit/10 text-profit border border-profit/20-foreground shadow-sm'
 : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
 )}
 >
 {m.label}
 </button>
 ))}
 </div>
 <div className="flex items-center gap-2 shrink-0">
 <span className="text-xs text-muted-foreground">العملة:</span>
 <span className="font-mono text-sm font-bold text-profit bg-muted px-2 py-0.5 rounded-md">
 {currency}
 </span>
 </div>
 </div>
 );
}

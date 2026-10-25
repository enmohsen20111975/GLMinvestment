// src/modules/screener/components/screener-advanced/AdvancedFiltersTab.tsx
// F-Phase3-Split-Screener — Tab 1 of StockScreenerAdvanced: فلترة متقدمة +
// جدول النتائج (UnifiedTable). بيانات الـ fetch في useScreenerData (Phase 2).
//
// (UNIFIED-TABLE-UPGRADE) Entry/Stop/Target/R:R columns moved to front
// (Owner directive: «حط Entry/Stop/Target/R/R في المقدمة»).
// (FIX-UI-AUDIT) only 7 audit-approved primary presets render as inline
// buttons; the rest collapse into a shadcn DropdownMenu «المزيد (N)».

'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
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
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { getTrialStatus } from '@/lib/subscription-gate';
import { toast } from 'sonner';
import { UnifiedTable } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { useTranslation } from '@/lib/i18n-context';
import {
  useScreenerData,
  type ScreenerStock,
} from '@/hooks/useScreenerData';
import {
  getFilterHelp,
  getStateExplanations,
  formatEGP,
  generateScreenerText,
  computeScreenerRR,
  computeOpportunityQuality,
  computeStopDistancePct,
  isHighMakerActivity,
  STATE_ORDER,
  PRESET_COLOR_MAP,
} from './helpers';
import { CollapsibleSection } from './CollapsibleSection';
import { FilterField, CheckboxField } from './FilterField';
import { KPIBox } from './KPIBox';
import { ExportDropdown } from './ExportDropdown';
import { StateBadge } from './StateBadge';
import { buildScreenerColumns } from './screenerColumns';
import type {
  AdvancedFiltersTabProps,
  SortField,
  SortDir,
  ExtraClientFilter,
} from './types';

export function AdvancedFiltersTab({ initialMarket }: AdvancedFiltersTabProps) {
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

  // Data state — F-Strangler-Screener: data logic moved to useScreenerData hook
  // 3 fetches (screener/advanced + maker-radar + stocks/top-performers) now
  // live in @/hooks/useScreenerData. The hook returns `results` already
  // merged with radar liquidity fields (radar merge logic preserved verbatim).
  const {
    results: stocks,
    sectors,
    loading,
    error,
    refetch: refetchScreener,
  } = useScreenerData({
    market, sector, sort, order, limit,
    minPrice, maxPrice, minVolume, minTurnover,
    trend, aboveMa, rsi, volumeSurge, near52wHigh, near52wLow,
    minPe, maxPe, minRoe, minDividendYield, minMarketCap, maxMarketCap,
    stockState,
  });

  // F-Strangler-Screener: preserve original toast.error on fetch failure
  // (was inside `fetchScreener` catch block before extraction).
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

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
    { label: t('screener.advanced.presets.recovery'), icon: TrendingUp, color: 'emerald', primary: true, apply: () => { setStockState('CORRECTION_END'); setTrend('up'); setVolumeSurge(true); setSort('momentum_score'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.highMomentum'), icon: Gauge, color: 'teal', primary: true, apply: () => { setVolumeSurge(true); setAboveMa('above'); setTrend('up'); setSort('momentum_score'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.nearBreak'), icon: Zap, color: 'amber', primary: true, apply: () => { setNear52wHigh(true); setAboveMa('above'); setSort('momentum_score'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.atPeak'), icon: Trophy, color: 'orange', apply: () => { setStockState('AT_PEAK'); setRsi('overbought'); setSort('change_percent'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.active'), icon: Flame, color: 'red', apply: () => { setVolumeSurge(true); setMinVolume('500000'); setSort('volume'); setOrder('desc'); setLimit(200); } },
    { label: t('screener.advanced.presets.dead'), icon: Snowflake, color: 'gray', apply: () => { setVolumeSurge(false); setMinVolume('10000'); setSort('volume'); setOrder('asc'); setLimit(100); } },
    { label: t('screener.advanced.presets.undervalued'), icon: PiggyBank, color: 'purple', apply: () => { setMaxPe('10'); setMinRoe('15'); setSort('pe_ratio'); setOrder('asc'); setLimit(100); } },
    { label: t('screener.advanced.presets.oversold'), icon: TrendingDown, color: 'rose', apply: () => { setRsi('oversold'); setNear52wLow(true); setSort('rsi'); setOrder('asc'); setLimit(100); } },
    { label: t('screener.advanced.presets.highDividend'), icon: BarChart3, color: 'green', apply: () => { setMinDividendYield('5'); setMinRoe('10'); setSort('dividend_yield'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.growth'), icon: TrendingUp, color: 'teal', apply: () => { setMinRoe('20'); setAboveMa('above'); setSort('roe'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.value'), icon: Shield, color: 'cyan', apply: () => { setMaxPe('12'); setMinDividendYield('3'); setMaxMarketCap('50000000000'); setSort('pe_ratio'); setOrder('asc'); setLimit(100); } },
    { label: t('screener.advanced.presets.largeCap'), icon: Crown, color: 'yellow', apply: () => { setMinMarketCap('100000000000'); setSort('market_cap'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.highLiquidity'), icon: TrendingUp, color: 'cyan', primary: true, apply: () => { setMinTurnover('50000000'); setMinVolume('1000000'); setSort('turnover_egp'); setOrder('desc'); setLimit(200); } },
    { label: t('screener.advanced.presets.sharpDrop'), icon: TrendingDown, color: 'red', apply: () => { setTrend('down'); setRsi('oversold'); setNear52wLow(true); setSort('change_percent'); setOrder('asc'); setLimit(100); } },
    { label: t('screener.advanced.presets.low52w'), icon: Target, color: 'violet', apply: () => { setNear52wLow(true); setRsi('oversold'); setStockState('CORRECTION'); setSort('distance_from_52w_low'); setOrder('asc'); setLimit(100); } },
    { label: t('screener.advanced.presets.high52w'), icon: Trophy, color: 'gold', apply: () => { setNear52wHigh(true); setStockState('AT_PEAK'); setSort('distance_from_52w_high'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.aboveMa'), icon: TrendingUp, color: 'emerald', primary: true, apply: () => { setAboveMa('above'); setTrend('up'); setSort('momentum_score'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.belowMa'), icon: TrendingDown, color: 'slate', apply: () => { setAboveMa('below'); setTrend('down'); setSort('momentum_score'); setOrder('asc'); setLimit(100); } },
    { label: t('screener.advanced.presets.moderateRsi'), icon: Gauge, color: 'teal', primary: true, apply: () => { setRsi('neutral'); setStockState('BALANCED_MOMENTUM'); setSort('rsi'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.reversalOpportunity'), icon: Shield, color: 'teal', apply: () => { setVolumeSurge(true); setStockState('CORRECTION_END'); setTrend('up'); setSort('momentum_score'); setOrder('desc'); setLimit(100); } },
    { label: t('screener.advanced.presets.stable'), icon: Shield, color: 'gray', apply: () => { setTrend('neutral'); setRsi('neutral'); setAboveMa('both'); setStockState('NEUTRAL'); setSort('volatility'); setOrder('asc'); setLimit(100); } },
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

  const applyPreset = (preset: (typeof presets)[0]) => {
    resetFilters();
    preset.apply();
    toast.success(t('screener.advanced.toast.presetApplied', { preset: preset.label }));
  };

  // Client-side search + sort
  const filteredStocks = useMemo(() => {
    let list = stocks;
    if (searchQuery.trim()) {
      const q = searchQuery.toUpperCase();
      list = list.filter(
        (s) =>
          s.ticker.includes(q) ||
          s.name.toUpperCase().includes(q) ||
          (s.name_ar || '').includes(searchQuery),
      );
    }
    // (UNIFIED-TABLE-UPGRADE) One-Click Trader Preset client-side filter —
    // يطبّق الفلاتر على الحقول اللي server مش بيدعمها (rr، score،
    // stop_distance، maker_activity، accumulation). Rule 27: لا fabrication.
    if (clientExtraFilter) {
      list = list.filter((s) => clientExtraFilter.test(s));
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
          const ao = STATE_ORDER[av as string] ?? 99;
          const bo = STATE_ORDER[bv as string] ?? 99;
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
    const gainers = filteredStocks.filter((s) => (s.change_percent ?? 0) > 0).length;
    const losers = filteredStocks.filter((s) => (s.change_percent ?? 0) < 0).length;
    const avgChange =
      filteredStocks.reduce((sum, s) => sum + (s.change_percent || 0), 0) / filteredStocks.length;
    const totalLiquidity = filteredStocks.reduce((sum, s) => sum + (s.turnover_egp || 0), 0);
    const volumeMomentum = filteredStocks.filter((s) => s.volume_surge).length;
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
  const screenerColumns = useMemo(() => buildScreenerColumns(t), [t]);

  // CSV export
  const exportCSV = () => {
    const headers = [
      'Ticker', 'Name', 'Sector', 'Price', 'Change%', 'Volume', 'Turnover',
      'PE', 'ROE', 'RSI', 'State', 'Momentum', 'MakerActivity', 'BuyPct',
      'NetFlow', 'Accumulation', 'LifeCycle',
    ];
    const rows = filteredStocks.map((s) => [
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
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
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
    [filteredStocks, market, sector, t],
  );

  // toggleSort is preserved from the original implementation; UnifiedTable
  // handles column sorting internally via sortValue. Kept for any callers
  // that may extend this component in the future.
  void toggleSort;

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
          <Button variant="default" size="sm" onClick={refetchScreener} disabled={loading} className="gap-1.5">
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
        icon={<Zap className="w-4 h-4 text-warning" />}
      >
        <div className="flex flex-wrap gap-2 items-center">
          {presets.filter((p) => p.primary).map((preset) => {
            const Icon = preset.icon;
            return (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(preset)}
                className={cn('gap-1.5 border', PRESET_COLOR_MAP[preset.color])}
              >
                <Icon className="w-3.5 h-3.5" />
                {preset.label}
              </Button>
            );
          })}
          {(() => {
            const secondary = presets.filter((p) => !p.primary);
            if (secondary.length === 0) return null;
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-slate-400/40 bg-slate-50/50 text-muted-foreground hover:bg-muted dark:text-muted-foreground dark:hover:bg-slate-800/60"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    {t('screener.advanced.presets.more')}
                    <Badge variant="secondary" className="h-4 text-xs px-1">{secondary.length}</Badge>
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
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-profit/20 bg-profit/10 /10">
        <span className="text-xs font-bold text-profit uppercase tracking-wide">قوالب المتداول المحترف</span>
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
                    : `تم تطبيق: ${preset.label}`,
                );
              }}
              className={cn(
                'h-8 text-xs gap-1.5 transition-all',
                isActive
                  ? 'bg-profit text-white hover:bg-profit'
                  : 'border-profit/20 bg-background text-profit hover:bg-profit dark:hover:bg-profit/10',
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
            className="text-xs text-loss hover:text-loss px-1.5 py-0.5 rounded hover:bg-loss dark:hover:bg-loss/10 transition-colors"
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
              <Input type="number" inputMode="numeric" placeholder="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="h-9" />
            </FilterField>
            {/* Max Price */}
            <FilterField label={t('screener.advanced.filters.maxPrice')} help={FILTER_HELP.price}>
              <Input type="number" inputMode="numeric" placeholder="1000" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="h-9" />
            </FilterField>
            {/* Min Volume */}
            <FilterField label={t('screener.advanced.filters.minVolume')} help={FILTER_HELP.volume}>
              <Input type="number" inputMode="numeric" placeholder="0" value={minVolume} onChange={(e) => setMinVolume(e.target.value)} className="h-9" />
            </FilterField>
            {/* Min Turnover */}
            <FilterField label={t('screener.advanced.filters.minTurnover')} help={FILTER_HELP.turnover}>
              <Input type="number" inputMode="numeric" placeholder="0" value={minTurnover} onChange={(e) => setMinTurnover(e.target.value)} className="h-9" />
            </FilterField>
            {/* Min PE */}
            <FilterField label={t('screener.advanced.filters.minPe')} help={FILTER_HELP.pe}>
              <Input type="number" inputMode="numeric" placeholder="0" value={minPe} onChange={(e) => setMinPe(e.target.value)} className="h-9" />
            </FilterField>
            {/* Max PE */}
            <FilterField label={t('screener.advanced.filters.maxPe')} help={FILTER_HELP.pe}>
              <Input type="number" inputMode="numeric" placeholder="50" value={maxPe} onChange={(e) => setMaxPe(e.target.value)} className="h-9" />
            </FilterField>
            {/* Min ROE */}
            <FilterField label={t('screener.advanced.filters.minRoe')} help={FILTER_HELP.roe}>
              <Input type="number" inputMode="numeric" placeholder="0" value={minRoe} onChange={(e) => setMinRoe(e.target.value)} className="h-9" />
            </FilterField>
            {/* Min Dividend Yield */}
            <FilterField label={t('screener.advanced.filters.minDividendYield')} help={FILTER_HELP.dividend_yield}>
              <Input type="number" inputMode="numeric" placeholder="0" value={minDividendYield} onChange={(e) => setMinDividendYield(e.target.value)} className="h-9" />
            </FilterField>
            {/* Min Market Cap */}
            <FilterField label={t('screener.advanced.filters.minMarketCap')} help={FILTER_HELP.market_cap}>
              <Input type="number" inputMode="numeric" placeholder="0" value={minMarketCap} onChange={(e) => setMinMarketCap(e.target.value)} className="h-9" />
            </FilterField>
            {/* Max Market Cap */}
            <FilterField label={t('screener.advanced.filters.maxMarketCap')} help={FILTER_HELP.market_cap}>
              <Input type="number" inputMode="numeric" placeholder="100000000000" value={maxMarketCap} onChange={(e) => setMaxMarketCap(e.target.value)} className="h-9" />
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
          <KPIBox label={t('screener.advanced.kpi.gainers')} value={derivedSummary.gainers} color="text-profit " />
          <KPIBox label={t('screener.advanced.kpi.losers')} value={derivedSummary.losers} color="text-loss " />
          <KPIBox label={t('screener.advanced.kpi.avgChange')} value={`${derivedSummary.avgChange > 0 ? '+' : ''}${(derivedSummary.avgChange ?? 0).toFixed(2)}%`} color={derivedSummary.avgChange >= 0 ? 'text-profit ' : 'text-loss '} />
          <KPIBox label={t('screener.advanced.kpi.totalLiquidity')} value={`${formatEGP(derivedSummary.totalLiquidity)} ${t('screener.advanced.kpi.egpSuffix')}`} />
          <KPIBox label={t('screener.advanced.kpi.volumeMomentum')} value={derivedSummary.volumeMomentum} color="text-warning " />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-4 py-3 text-center text-xs text-muted-foreground">
          لا توجد أسهم تحقق شروط الفلتر الحالي — جرّب فلتراً آخر أو وسّع النطاق
        </div>
      )}

      {/* Results Table — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      <CollapsibleSection
        title={t('screener.advanced.kpi.filterResults')}
        icon={<BarChart3 className="w-4 h-4 text-profit" />}
        contentClassName="p-0 space-y-0"
      >
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            {t('screener.advanced.loading.loadingStocks')}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-loss">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
            {error}
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={refetchScreener} className="gap-1.5">
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
              publishFilename={`screener-${new Date().toISOString().slice(0, 10)}`}
              publishHashtags={t('screener.advanced.share.hashtags').split(',')}
            />
            {/* PAYWALL Gate 5: lock CTA — free users see first 5 only */}
            {screenerLocked && hiddenResultsCount > 0 && (
              <div className="border-t border-warning/20 bg-warning/10 /20 p-4 text-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 text-warning ">
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

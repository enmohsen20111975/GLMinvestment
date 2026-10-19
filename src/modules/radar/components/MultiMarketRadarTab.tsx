'use client';

// ============================================================================
// MultiMarketRadarTab — Unified Multi-Market Radar
// ============================================================================
// Shows all markets (EGX, TADAWUL, KSE, QSE, US, CRYPTO, GOLD) in one panel.
//
// Layout:
//   ┌──────────────────────────────────────────────────────┐
//   │  🌐 الرادار الموحّد متعدد الأسواق                     │
//   │  [EGX] [TADAWUL] [KSE] [QSE] [US] [CRYPTO] [GOLD]    │
//   ├──────────────────────────────────────────────────────┤
//   │  📊 ملخص الأسواق:                                     │
//   │  🇪🇬 EGX: 96 سهم | DEFENSIVE | 5 top picks           │
//   │  🇸🇦 TADAWUL: 45 سهم | NORMAL | 3 top picks          │
//   ├──────────────────────────────────────────────────────┤
//   │  🏆 أعلى 5 فرص عبر كل الأسواق (unified_top_5):       │
//   │  1. 🇺🇸 NVDA — Pre-Surge   $450.20 → $520 (+15%)    │
//   ├──────────────────────────────────────────────────────┤
//   │  📈 تفصيل كل سوق (collapsible):                       │
//   │  ▶ 🇪🇬 EGX (96 سهم) — DEFENSIVE                       │
//   └──────────────────────────────────────────────────────┘
//
// API:
//   GET /api/maker-radar/multi-market?markets=EGX,TADAWUL,KSE,QSE,US,CRYPTO,GOLD
//   (fetched on mount + every 60s)
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Radar, RefreshCw, ChevronDown, ChevronLeft, Globe,
  TrendingUp, TrendingDown, Activity, AlertTriangle,
  Trophy, Layers, Eye, Flame, Zap, Rocket, Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { useTranslation } from '@/lib/i18n-context';
import { useRealtimeUpdates } from '@/lib/ws-client';

// ─── Constants ──────────────────────────────────────────────────────────

const ALL_MARKETS = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO', 'GOLD'] as const;
type MarketCode = typeof ALL_MARKETS[number];

const MARKET_FLAG: Record<string, string> = {
  EGX: '🇪🇬',
  TADAWUL: '🇸🇦',
  KSE: '🇰🇼',
  QSE: '🇶🇦',
  US: '🇺🇸',
  CRYPTO: '₿',
  GOLD: '🥇',
};

// MARKET_NAME_AR was an unused static table — actual market name comes from
// the API response (`section.name_ar` / `pick.market_name_ar`).

const REGIME_LABEL: Record<string, { color: string }> = {
  defensive: { color: 'bg-warning text-warning border-warning dark:bg-warning/60 dark:text-warning dark:border-warning' },
  normal: { color: 'bg-profit text-profit border-profit dark:bg-profit/60 dark:text-profit dark:border-profit' },
  aggressive: { color: 'bg-loss text-loss border-loss dark:bg-loss/60 dark:text-loss dark:border-loss' },
  bull: { color: 'bg-profit text-profit border-profit dark:bg-profit/60 dark:text-profit dark:border-profit' },
  bear: { color: 'bg-loss text-loss border-loss dark:bg-loss/60 dark:text-loss dark:border-loss' },
  sideways: { color: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700' },
  unknown: { color: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-400 dark:border-slate-700' },
};

const PATH_META: Record<string, { tKey: string; icon: React.ReactNode; color: string }> = {
  A_pre_surge: { tKey: 'preSurge', icon: <Rocket className="h-3.5 w-3.5" />, color: 'text-purple-600 dark:text-purple-400' },
  B_quiet_accumulation_strong: { tKey: 'strongAccumulation', icon: <Eye className="h-3.5 w-3.5" />, color: 'text-warning dark:text-warning' },
  C_quiet_accumulation_weak: { tKey: 'weakAccumulation', icon: <Eye className="h-3.5 w-3.5" />, color: 'text-warning dark:text-warning' },
  D_explosive_surge: { tKey: 'explosiveSurge', icon: <Flame className="h-3.5 w-3.5" />, color: 'text-loss dark:text-loss' },
  E_early_break: { tKey: 'earlyBreak', icon: <Zap className="h-3.5 w-3.5" />, color: 'text-profit dark:text-profit' },
};

const pathLabel = (path?: string): { tKey: string | null; icon: React.ReactNode; color: string } => {
  if (!path) return { tKey: null, icon: null, color: '' };
  return PATH_META[path] ?? { tKey: null, icon: <Layers className="h-3.5 w-3.5" />, color: '' };
};

const fmtNum = (n: number | null | undefined, digits = 2): string => {
  if (n == null || isNaN(n as number)) return '-';
  const num = Number(n);
  return num.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
};

const fmtPct = (n: number | null | undefined, withSign = true): string => {
  if (n == null || isNaN(n as number)) return '-';
  const num = Number(n);
  const sign = withSign && num > 0 ? '+' : '';
  return `${sign}${(num ?? 0).toFixed(1)}%`;
};

const fmtCurrency = (n: number | null | undefined, currency: string): string => {
  if (n == null || isNaN(n as number)) return '-';
  const num = Number(n);
  const symbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : currency === 'KWD' ? 'د.ك' : currency === 'QAR' ? 'ر.ق' : '$';
  if (num >= 1000) return `${num.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${symbol}`;
  return `${(num ?? 0).toFixed(2)} ${symbol}`;
};

// ─── Types (mirror API contract) ─────────────────────────────────────────

interface RadarPick {
  ticker: string;
  current_price?: number;
  path?: string;
  position_size?: number;
  roc_10d?: number | null;
  target_price?: number;
  market?: string;
  market_name_ar?: string;
  currency?: string;
  [key: string]: unknown;
}

interface MarketSection {
  market: string;
  name_ar: string;
  currency: string;
  is_open: boolean;
  regime: string;
  regime_ar: string;
  market_score: number;
  market_open_utc: string;
  market_close_utc: string;
  count: number;
  top_picks: RadarPick[];
  /**
   * Rule 67 (Task 35-A): `warming_up` is only true on the very first
   * generation. After the cache exists, it becomes `false` (even if stale)
   * — the UI should show real data + a freshness warning instead of a
   * permanent "under heating" lie.
   */
  warming_up: boolean;
  /** True only on the first generation (cache miss). Distinguishes "first
   *  time warming up (honest)" from "stale data + background refresh". */
  first_generation?: boolean;
  cached: boolean;
  cache_age_seconds: number | null;
  /** ISO timestamp of when the cache was generated (from JSON generated_at). */
  last_generated_at?: string | null;
  db_source: string | null;
}

interface MultiMarketResponse {
  success: boolean;
  markets?: Record<string, MarketSection>;
  unified_top_5?: RadarPick[];
  served_at?: string;
  supported_markets?: string[];
  invalid_markets?: string[];
  error?: string;
}

// ─── Component ────────────────────────────────────────────────────────────

export function MultiMarketRadarTab() {
  const t = useTranslation();
  const [data, setData] = useState<MultiMarketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Toggle state — which markets to show
  const [selectedMarkets, setSelectedMarkets] = useState<Set<MarketCode>>(
    new Set(ALL_MARKETS)
  );

  // Collapsible per-market detail sections
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set());

  // ─── Real-time WebSocket subscription (Task 35-E — Rule 67 root cause) ──
  // The data_engine/sync.py pushes new prices → ws-service emits 'market:snapshot'
  // → we subscribe here → trigger immediate refetch of /api/maker-radar.
  // This replaces the 60s blind polling with push-based real-time updates.
  // The API itself already reads live prices from stocks.db at request time,
  // so a refetch = instant fresh data.
  const { stockPrices, isConnected: wsConnected } = useRealtimeUpdates();

  // ─── Fetcher ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    if (!silent) setError(null);
    try {
      const marketsParam = Array.from(selectedMarkets).join(',');
      const res = await fetch(
        `/api/maker-radar/multi-market?markets=${encodeURIComponent(marketsParam)}`,
        { cache: 'no-store' }
      );
      const json: MultiMarketResponse = await res.json();
      if (json.success) {
        setData(json);
        setLastUpdated(new Date());
      } else {
        setError(json.error || t('radar.multiMarket.loadFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('radar.multiMarket.connectionError'));
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [selectedMarkets]);

  // Initial fetch + 30s backup polling (was 60s — reduced since WS handles pushes)
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchData(true);
    }, 30_000); // 30s backup (was 60s) — WS pushes handle real-time
    return () => clearInterval(timer);
  }, [fetchData]);

  // ─── WS push → instant refetch (Task 35-E — Rule 67) ──────────────────
  // When ws-service emits market:snapshot (every 2-30s depending on session),
  // stockPrices array updates → we refetch the API to pull fresh enriched data.
  // Throttle to max 1 refetch per 3s to avoid hammering the API.
  const lastWsRefetchRef = useRef<number>(0);
  useEffect(() => {
    if (!wsConnected || stockPrices.length === 0) return;
    const now = Date.now();
    if (now - lastWsRefetchRef.current < 3_000) return; // 3s throttle
    lastWsRefetchRef.current = now;
    fetchData(true); // silent refetch — pull fresh prices from API
  }, [stockPrices, wsConnected, fetchData]);

  // ─── Handlers ─────────────────────────────────────────────────────────
  const toggleMarket = (m: MarketCode) => {
    setSelectedMarkets(prev => {
      const next = new Set(prev);
      if (next.has(m)) {
        // Don't allow empty selection
        if (next.size > 1) next.delete(m);
      } else {
        next.add(m);
      }
      return next;
    });
  };

  const toggleExpand = (market: string) => {
    setExpandedMarkets(prev => {
      const next = new Set(prev);
      if (next.has(market)) next.delete(market);
      else next.add(market);
      return next;
    });
  };

  // ─── Derived data ──────────────────────────────────────────────────────
  const markets = useMemo(() => {
    const all = data?.markets ?? {};
    return Array.from(selectedMarkets)
      .map(m => all[m])
      .filter((m): m is MarketSection => !!m);
  }, [data, selectedMarkets]);

  const unifiedTop5 = useMemo(() => data?.unified_top_5 ?? [], [data]);

  const totalStocks = useMemo(
    () => markets.reduce((sum, m) => sum + (m.count || 0), 0),
    [markets]
  );

  const openCount = useMemo(
    () => markets.filter(m => m.is_open).length,
    [markets]
  );

  // ─── Loading / Error states ─────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="space-y-3 p-4" dir="rtl">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
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
          <RefreshCw className="h-4 w-4 ml-1" /> {t('radar.multiMarket.retry')}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4" dir="rtl" data-testid="multi-market-radar">
      {/* ===== HEADER ===== */}
      <Card className="overflow-hidden">
        <div className="bg-profit/80 dark:bg-profit/30 p-4 md:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-profit/10 dark:bg-profit/10 flex items-center justify-center">
                <Globe className="h-6 w-6 text-profit dark:text-profit" />
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
                  {t('radar.multiMarket.title')}
                  <Badge variant="outline" className="text-[10px] bg-profit text-profit border-profit dark:bg-profit dark:text-profit">
                    {t('radar.multiMarket.marketsCount', { count: markets.length })}
                  </Badge>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span>{t('radar.multiMarket.stocksUnderRadar', { count: totalStocks })}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Activity className="h-3 w-3 text-profit" />
                    {t('radar.multiMarket.marketsOpen', { count: openCount })}
                  </span>
                  {lastUpdated && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="gap-1"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {t('radar.multiMarket.refresh')}
            </Button>
          </div>
        </div>
      </Card>

      {/* ===== MARKET TOGGLES ===== */}
      <Card data-testid="market-toggles">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground ml-1">
              {t('radar.multiMarket.displayedMarkets')}
            </span>
            {ALL_MARKETS.map(m => {
              const selected = selectedMarkets.has(m);
              return (
                <button
                  key={m}
                  onClick={() => toggleMarket(m)}
                  data-testid={`market-toggle-${m}`}
                  aria-pressed={selected}
                  aria-label={`toggle ${m}`}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all flex items-center gap-1 ${
                    selected
                      ? 'bg-profit text-profit border-profit dark:bg-profit/60 dark:text-profit dark:border-profit'
                      : 'bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted'
                  }`}
                >
                  <span>{MARKET_FLAG[m]}</span>
                  <span>{m}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ===== MARKET SUMMARY CARDS ===== */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <Layers className="h-4 w-4 text-profit" />
          <h4 className="text-sm font-bold">{t('radar.multiMarket.summaryTitle')}</h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {markets.map(section => {
            const regime = REGIME_LABEL[section.regime] ?? REGIME_LABEL.unknown;
            return (
              <Card
                key={section.market}
                data-testid={`market-card-${section.market}`}
                className="overflow-hidden hover:border-profit dark:hover:border-profit transition-colors"
              >
                <CardContent className="p-3 space-y-2">
                  {/* Flag + name + open/closed */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-2xl leading-none">{MARKET_FLAG[section.market]}</span>
                      <div className="min-w-0">
                        <div className="font-bold text-sm truncate">{section.market}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{section.name_ar}</div>
                      </div>
                    </div>
                    {section.is_open ? (
                      <Badge className="text-[9px] bg-profit text-profit border-profit dark:bg-profit/60 dark:text-profit">
                        <span className="h-1.5 w-1.5 rounded-full bg-profit mr-1 animate-pulse" />
                        LIVE
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] bg-muted/40">
                        {t('radar.multiMarket.marketClosed')}
                      </Badge>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-1 text-center">
                    <div className="bg-muted/30 rounded-md py-1 px-1">
                      <div className="text-[9px] text-muted-foreground">{t('radar.multiMarket.stats.stocks')}</div>
                      <div className="font-bold text-sm" data-testid={`count-${section.market}`}>
                        {section.count || 0}
                      </div>
                    </div>
                    <div className="bg-muted/30 rounded-md py-1 px-1">
                      <div className="text-[9px] text-muted-foreground">{t('radar.multiMarket.stats.opportunities')}</div>
                      <div className="font-bold text-sm">{section.top_picks.length}</div>
                    </div>
                    <div className="bg-muted/30 rounded-md py-1 px-1">
                      <div className="text-[9px] text-muted-foreground">{t('radar.multiMarket.stats.currency')}</div>
                      <div className="font-bold text-xs">{section.currency}</div>
                    </div>
                  </div>

                  {/* Regime badge */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">{t('radar.multiMarket.marketRegimeLabel')}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${regime.color}`}
                      data-testid={`regime-badge-${section.market}`}
                    >
                      {t(`radar.multiMarket.regimes.${section.regime}`)} · {section.regime}
                    </Badge>
                  </div>

                  {section.warming_up && (
                    <div className="text-[10px] text-warning dark:text-warning flex items-center gap-1">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      {section.first_generation
                        ? t('radar.multiMarket.firstGeneration', { defaultValue: 'تحميل لأول مرة — حاول تاني خلال دقيقة' })
                        : t('radar.multiMarket.warmingUp')}
                    </div>
                  )}
                  {section.cached && section.cache_age_seconds != null && (
                    <div className="text-[9px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {section.cache_age_seconds < 60
                        ? t('radar.multiMarket.cacheAge.seconds', { count: section.cache_age_seconds })
                        : t('radar.multiMarket.cacheAge.minutes', { count: Math.round(section.cache_age_seconds / 60) })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ===== UNIFIED TOP 5 ===== */}
      <Card data-testid="unified-top-5" className="overflow-hidden">
        <CardHeader className="pb-2 bg-warning/60 dark:bg-warning/20">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning dark:text-warning" />
            {t('radar.multiMarket.unifiedTop5.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {unifiedTop5.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-warning" />
              {t('radar.multiMarket.unifiedTop5.empty')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">{t('radar.multiMarket.table.rank')}</TableHead>
                  <TableHead>{t('radar.multiMarket.table.market')}</TableHead>
                  <TableHead>{t('radar.multiMarket.table.stock')}</TableHead>
                  <TableHead>{t('radar.multiMarket.table.path')}</TableHead>
                  <TableHead className="text-left">{t('radar.multiMarket.table.price')}</TableHead>
                  <TableHead className="text-left">{t('radar.multiMarket.table.target')}</TableHead>
                  <TableHead className="text-left">{t('radar.multiMarket.table.change')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unifiedTop5.map((pick, idx) => {
                  const path = pathLabel(pick.path);
                  const currency = pick.currency || 'USD';
                  const change = pick.roc_10d != null
                    ? pick.roc_10d
                    : (pick.target_price && pick.current_price
                        ? ((pick.target_price - pick.current_price) / pick.current_price) * 100
                        : null);
                  return (
                    <TableRow key={`${pick.market}-${pick.ticker}-${idx}`}>
                      <TableCell className="text-center font-bold text-warning dark:text-warning">
                        {idx + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="text-base">{MARKET_FLAG[pick.market || ''] || '🌐'}</span>
                          <span className="text-xs text-muted-foreground">{pick.market || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-bold text-sm">{pick.ticker}</div>
                        {pick.market_name_ar && (
                          <div className="text-[10px] text-muted-foreground">{pick.market_name_ar}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${path.color}`}>
                          {path.icon}
                          {path.tKey ? t(`radar.multiMarket.paths.${path.tKey}`) : (pick.path || '-')}
                        </span>
                      </TableCell>
                      <TableCell className="text-left font-mono text-sm">
                        {fmtCurrency(pick.current_price, currency)}
                      </TableCell>
                      <TableCell className="text-left font-mono text-sm">
                        {fmtCurrency(pick.target_price ?? null, currency)}
                      </TableCell>
                      <TableCell className="text-left">
                        <span className={`font-mono text-sm font-bold flex items-center gap-1 ${
                          (change ?? 0) > 0
                            ? 'text-profit dark:text-profit'
                            : (change ?? 0) < 0
                              ? 'text-loss dark:text-loss'
                              : 'text-muted-foreground'
                        }`}>
                          {(change ?? 0) > 0 ? <TrendingUp className="h-3 w-3" /> : (change ?? 0) < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                          {fmtPct(change)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ===== PER-MARKET DETAIL (Collapsible) ===== */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <Radar className="h-4 w-4 text-profit" />
          <h4 className="text-sm font-bold">{t('radar.multiMarket.detailTitle')}</h4>
        </div>
        <div className="space-y-2">
          {markets.map(section => {
            const isExpanded = expandedMarkets.has(section.market);
            const regime = REGIME_LABEL[section.regime] ?? REGIME_LABEL.unknown;
            return (
              <Collapsible
                key={section.market}
                open={isExpanded}
                onOpenChange={() => toggleExpand(section.market)}
                data-testid={`collapsible-${section.market}`}
              >
                <Card className="overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <button
                      className="w-full p-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                      data-testid={`collapsible-trigger-${section.market}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl">{MARKET_FLAG[section.market]}</span>
                        <div className="min-w-0 text-right">
                          <div className="font-bold text-sm flex items-center gap-2">
                            {section.market}
                            <span className="text-xs font-normal text-muted-foreground">
                              ({section.name_ar})
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {t('radar.multiMarket.marketDetail.stocksAndOpportunities', { stockCount: section.count, opportunityCount: section.top_picks.length })}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${regime.color}`}
                        >
                          {t(`radar.multiMarket.regimes.${section.regime}`)}
                        </Badge>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t border-border/50 p-3 bg-muted/10">
                      {section.top_picks.length === 0 ? (
                        <div className="text-center text-sm text-muted-foreground py-4">
                          {section.warming_up
                            ? (section.first_generation
                                ? t('radar.multiMarket.marketDetail.firstGeneration', { defaultValue: 'جاري التحميل لأول مرة — حاول تاني خلال دقيقة' })
                                : t('radar.multiMarket.marketDetail.warmingUp'))
                            : t('radar.multiMarket.marketDetail.empty')}
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('radar.multiMarket.table.stock')}</TableHead>
                              <TableHead>{t('radar.multiMarket.table.path')}</TableHead>
                              <TableHead className="text-left">{t('radar.multiMarket.table.price')}</TableHead>
                              <TableHead className="text-left">{t('radar.multiMarket.table.roc10d')}</TableHead>
                              <TableHead className="text-left">{t('radar.multiMarket.table.volume')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {section.top_picks.map((pick, idx) => {
                              const path = pathLabel(pick.path);
                              return (
                                <TableRow key={`${pick.ticker}-${idx}`}>
                                  <TableCell className="font-bold text-sm">
                                    {pick.ticker}
                                  </TableCell>
                                  <TableCell>
                                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${path.color}`}>
                                      {path.icon}
                                      {path.tKey ? t(`radar.multiMarket.paths.${path.tKey}`) : (pick.path || '-')}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-left font-mono text-xs">
                                    {fmtCurrency(pick.current_price, section.currency)}
                                  </TableCell>
                                  <TableCell className="text-left font-mono text-xs">
                                    <span className={
                                      (pick.roc_10d ?? 0) > 0
                                        ? 'text-profit dark:text-profit font-bold'
                                        : (pick.roc_10d ?? 0) < 0
                                          ? 'text-loss dark:text-loss font-bold'
                                          : 'text-muted-foreground'
                                    }>
                                      {fmtPct(pick.roc_10d ?? null)}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-left font-mono text-xs text-muted-foreground">
                                    {fmtNum(Number(pick.position_size) || 0, 0)}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      </div>

      {/* ===== Footer info ===== */}
      <Card className="bg-muted/40">
        <CardContent className="p-3 text-center text-xs text-muted-foreground">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Clock className="h-3 w-3" />
            <span>{t('radar.multiMarket.footer.autoRefresh')}</span>
            <span>•</span>
            <span>{t('radar.multiMarket.footer.dataSource')}</span>
            {data?.served_at && (
              <>
                <span>•</span>
                <span>
                  {t('radar.multiMarket.footer.lastUpdate')} {new Date(data.served_at).toLocaleString('ar-EG')}
                </span>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default MultiMarketRadarTab;

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/components/shared/UnifiedPublishButton';
import {
  TrendingUp, TrendingDown, Clock, Calendar,
  BarChart3, Target, AlertTriangle, CheckCircle,
  Activity, ArrowUpRight, ArrowDownRight, Info,
  RefreshCw, Moon, Copy, Share2, ShieldCheck, ShieldX, Crosshair, Gauge, Facebook, ArrowRight, ArrowLeft,
  Bitcoin, Zap, Download, Image as ImageIcon, FileText, Camera, Loader2, X, Layers, Send
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { Radio, Radar } from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn, getRRVerdict, getStockRiskAlert, safeToFixed, verdictStyle, computeRR, rrColor, scoreColor, fmtPrice, formatNumber } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { useAnalysisStore } from '@/lib/analysis-store';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS } from '@/lib/official-links';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

import { isBuySignalLabel, isSellSignalLabel } from '@/lib/signal-utils';
import { PersonaImageCard, PersonaPick } from '@/components/market/PersonaImageCard';
import { ExpertPredictionsImageCard } from '@/components/market/ExpertPredictionsImageCard';
import { PredictionsImageCard } from '@/components/market/PredictionsImageCard';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import { MarketStatusExport } from '@/components/market/MarketStatusExport';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
import { ExpertRecommendationsPanel } from '@/components/analysis/ExpertRecommendationsPanel';
import { ExpertIntelligencePanel } from '@/components/shared/ExpertIntelligencePanel';
import { DailyPicksPoster } from '@/components/daily-picks/DailyPicksPoster';
import type {
  StockData,
  LifecycleStatus,
  StatusBadgeStyle,
  PreviousPrediction,
  PersonaData,
  AnalysisJson,
  StoredAnalysisItem,
  NameMap,
  CryptoPrediction,
  CryptoPredictionsResponse,
  SectorTrackingStock,
  SectorTrackingEntry,
  SectorTrackingResponse,
  SectorSortField,
  SectorStockSortField,
  MorningBellStock,
  PredictionRow,
} from './types';
import {
  pickValidPrice,
  getStatusBadge,
  pnlColorClass,
  formatPnl,
  formatChangePct,
  formatDateShort,
  mapPredictionToStockData,
  MARKET_CODES,
  isMarketClosedNow,
  getNextTradingDay,
  formatDateLabel,
  formatAllPredictionsText,
  formatSinglePredictionText,
  formatSinglePersonaPickText,
  formatAllPersonaPicksText,
  formatComprehensiveStockText,
  formatSingleExpertPredictionText,
  formatAllExpertPredictionsText,
  isTraderPrediction,
  evalPrediction,
  buildNameMap,
  enrichItems,
  pickPersonaMix,
  pickPersonaDiverged,
  getVerdictColor,
  getScoreColor,
  PERSONA_DISPLAY_LIMIT,
  PERSONA_PAGE_SIZE,
  usdCurrencyFmt,
  arDateTimeFmt,
  cryptoSignalStyle,
  cryptoSignalLabelAr,
  cryptoSymbolMeta,
  HEAT_LEVEL_STYLE,
  formatVolumeShort,
  formatEGPShort,
  avgChangeHeatClass,
  stockChangeHeatClass,
  _isEgxIntradayNow,
} from './helpers';


export function SectorTrackingTab({ market }: { market: MarketType }) {
  const [data, setData] = useState<SectorTrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSector, setExpandedSector] = useState<string | null>(null);
  const [withRotation, setWithRotation] = useState(false);
  const [sortBy, setSortBy] = useState<SectorSortField>('turnover');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [heatFilter, setHeatFilter] = useState<string>('');
  // فرز مستقل لجدول الأسهم (ينطبق على القطاع المفتوح حالياً)
  const [stockSortBy, setStockSortBy] = useState<SectorStockSortField>('turnover_egp');
  const [stockSortOrder, setStockSortOrder] = useState<'asc' | 'desc'>('desc');

  const marketCode = market === 'CRYPTO' ? 'CRYPTO' : 'EGX';
  const loadStockDetail = useAppStore((s) => s.loadStockDetail);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        market: marketCode,
        with_stocks: '1',
        sort: sortBy,
        order: sortOrder,
      });
      if (withRotation) params.set('with_rotation', '1');
      if (heatFilter) params.set('heat_level', heatFilter);
      const res = await fetch(`/api/sectors/tracking?${params}`, { cache: 'no-store' });
      const json: SectorTrackingResponse = await res.json();
      if (json.success) {
        setData(json);
        if (json.sectors && json.sectors.length > 0 && !expandedSector) {
          setExpandedSector(json.sectors[0].sector);
        }
      } else {
        setError(json.error || json.hint || 'فشل في تحميل البيانات');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [marketCode, withRotation, sortBy, sortOrder, heatFilter, expandedSector]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (field: SectorSortField) => {
    if (sortBy === field) {
      setSortOrder(o => o === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const handleStockSort = (field: SectorStockSortField) => {
    if (stockSortBy === field) {
      setStockSortOrder(o => o === 'desc' ? 'asc' : 'desc');
    } else {
      setStockSortBy(field);
      setStockSortOrder('desc');
    }
  };

  // فرز الأسهم محلياً (الـ Python بيرجعها مرتبة بـ change_percent)
  const sortStocks = (stocks: SectorTrackingStock[]): SectorTrackingStock[] => {
    const arr = [...stocks];
    const dir = stockSortOrder === 'desc' ? -1 : 1;
    arr.sort((a, b) => {
      let av: any; let bv: any;
      if (stockSortBy === 'ticker') {
        av = a.ticker; bv = b.ticker;
        return av.localeCompare(bv) * dir;
      }
      av = (a as any)[stockSortBy];
      bv = (b as any)[stockSortBy];
      // null/undefined goes last
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return ((av as number) - (bv as number)) * dir;
    });
    return arr;
  };

  // ملاحظة: SortHeader / StockSortHeader components أصبحت غير مستخدمة بعد الترحيل لـ UnifiedTable
  // (الذي بيوفر sort built-in)، لكن بنحتفظ بـ handleSort/handleStockSort لاستخدامهما المحتمل
  // في فلترة خارجية مستقبلاً. بنستخدم sortBy/sortOrder/stockSortBy/stockSortOrder لطلب الـ API.
  void handleSort;
  void handleStockSort;

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" />
          جاري تحميل تتبع القطاعات...
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-4 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-rose-500" />
            <div className="text-sm font-medium text-rose-700 dark:text-rose-300">
              {error}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              تأكد أن Python backend يعمل على port 8010 (محتاج: <code className="font-mono">/api/sectors/tracking</code>)
            </div>
            <Button variant="outline" size="sm" onClick={fetchData} className="mt-3">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const ms = data.market_summary;
  const sectors = data.sectors || [];
  const rotation = data.rotation;

  // ─── UnifiedTable columns (sector overview + nested stock grid) ────────────
  const sectorColumns: Column<SectorTrackingEntry>[] = [
    {
      key: 'sector',
      header: 'القطاع',
      sortable: true,
      filterable: true,
      className: 'font-medium',
      render: (s) => {
        const heat = HEAT_LEVEL_STYLE[s.heat_level] || HEAT_LEVEL_STYLE.NEUTRAL;
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-base">{heat.icon}</span>
            <span className="font-bold">{s.sector}</span>
          </div>
        );
      },
    },
    {
      key: 'heat_level',
      header: 'الحرارة',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (s) => {
        const heat = HEAT_LEVEL_STYLE[s.heat_level] || HEAT_LEVEL_STYLE.NEUTRAL;
        return (
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border', heat.bg, heat.text)}>
            {heat.label}
          </span>
        );
      },
    },
    {
      key: 'avg_change',
      header: 'متوسط التغير %',
      align: 'right',
      sortable: true,
      width: 'w-32',
      render: (s) => (
        <span className={cn('font-mono font-bold', avgChangeHeatClass(s.avg_change),
          s.avg_change >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>
          {s.avg_change >= 0 ? '+' : ''}{s.avg_change}%
        </span>
      ),
    },
    {
      key: 'turnover',
      header: 'إجمالي السيولة',
      align: 'right',
      sortable: true,
      width: 'w-36',
      className: 'font-mono text-xs',
      render: (s) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-bold">{formatEGPShort(s.turnover)}</span>
          <span className="text-muted-foreground text-[10px]">
            {s.turnover_pct}% من السوق
          </span>
        </div>
      ),
    },
    {
      key: 'gainers',
      header: 'رابحة',
      align: 'right',
      sortable: true,
      width: 'w-20',
      className: 'font-mono text-emerald-600 font-bold',
    },
    {
      key: 'losers',
      header: 'خاسرة',
      align: 'right',
      sortable: true,
      width: 'w-20',
      className: 'font-mono text-rose-600 font-bold',
    },
    {
      key: 'leader_change',
      header: 'سهم القائد',
      align: 'right',
      sortable: true,
      width: 'w-40',
      render: (s) => s.leader_ticker ? (
        <button
          onClick={(e) => { e.stopPropagation(); loadStockDetail(s.leader_ticker); }}
          className="flex items-center gap-1.5 text-xs hover:bg-muted/60 rounded px-1.5 py-0.5 transition-colors"
          title={`عرض تفاصيل ${s.leader_ticker}`}
        >
          <span className="text-amber-600">👑</span>
          <span className="font-mono font-bold">{s.leader_ticker}</span>
          <span className={cn('font-mono', s.leader_change != null && s.leader_change >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
            {s.leader_change != null && s.leader_change >= 0 ? '+' : ''}{s.leader_change ?? '—'}%
          </span>
        </button>
      ) : '—',
    },
    {
      key: 'total_market_cap',
      header: 'القيمة السوقية',
      align: 'right',
      sortable: true,
      width: 'w-32',
      className: 'font-mono text-xs',
      render: (s) => s.total_market_cap > 0 ? formatEGPShort(s.total_market_cap) : '—',
    },
    {
      key: 'stock_count',
      header: 'التفاصيل',
      align: 'right',
      width: 'w-24',
      render: (s) => (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border">
          <span>عرض ({s.stocks?.length || 0})</span>
          <span className="text-[10px]">▼</span>
        </span>
      ),
    },
  ];

  const stockColumns: Column<SectorTrackingStock>[] = [
    {
      key: 'ticker',
      header: 'السهم',
      sortable: true,
      filterable: true,
      width: 'w-44',
      render: (st) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-bold text-xs">{st.ticker}</span>
          <span className="text-muted-foreground text-[11px] truncate max-w-[140px]">
            {st.name_ar || st.name}
          </span>
          {st.volume_surge && (
            <Zap className="w-3 h-3 text-amber-500 shrink-0" />
          )}
        </div>
      ),
    },
    {
      key: 'current_price',
      header: 'السعر',
      align: 'right',
      sortable: true,
      width: 'w-24',
      className: 'font-mono text-xs',
      render: (st) => formatNumber(st.current_price),
    },
    {
      key: 'change_percent',
      header: 'التغير %',
      align: 'right',
      sortable: true,
      width: 'w-28',
      render: (st) => (
        <span className={cn('font-mono text-xs font-bold', stockChangeHeatClass(st.change_percent),
          st.change_percent >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>
          {st.change_percent >= 0 ? '+' : ''}{st.change_percent}%
        </span>
      ),
    },
    {
      key: 'volume',
      header: 'الحجم',
      align: 'right',
      sortable: true,
      width: 'w-24',
      className: 'font-mono text-xs text-muted-foreground',
      render: (st) => formatVolumeShort(st.volume),
    },
    {
      key: 'turnover_egp',
      header: 'السيولة (ج.م)',
      align: 'right',
      sortable: true,
      width: 'w-32',
      className: 'font-mono text-xs',
      render: (st) => st.turnover_egp > 0 ? formatEGPShort(st.turnover_egp) : '—',
    },
    {
      key: 'market_cap',
      header: 'القيمة السوقية',
      align: 'right',
      sortable: true,
      width: 'w-32',
      className: 'font-mono text-xs',
      render: (st) => st.market_cap > 0 ? formatEGPShort(st.market_cap) : '—',
    },
    {
      key: 'above_ma50',
      header: 'فوق/تحت MA50',
      align: 'right',
      width: 'w-24',
      filterable: true,
      render: (st) => st.above_ma50 == null ? (
        <span className="text-muted-foreground text-xs">—</span>
      ) : st.above_ma50 ? (
        <span className="inline-flex items-center gap-0.5 text-emerald-600 text-xs font-medium">
          <TrendingUp className="w-3 h-3" /> فوق
        </span>
      ) : (
        <span className="inline-flex items-center gap-0.5 text-rose-600 text-xs font-medium">
          <TrendingDown className="w-3 h-3" /> تحت
        </span>
      ),
    },
    {
      key: 'rsi',
      header: 'RSI',
      align: 'right',
      sortable: true,
      width: 'w-20',
      className: 'font-mono text-xs',
      render: (st) => st.rsi != null ? (
        <span className={cn(
          st.rsi >= 70 ? 'text-rose-600' : st.rsi <= 30 ? 'text-emerald-600' : 'text-muted-foreground'
        )}>
          {st.rsi.toFixed(0)}
        </span>
      ) : '—',
    },
    {
      key: 'distance_from_52w_high',
      header: 'من قمة 52أ',
      align: 'right',
      sortable: true,
      width: 'w-28',
      className: 'font-mono text-xs',
      render: (st) => st.distance_from_52w_high != null ? (
        <span className="text-muted-foreground">
          -{st.distance_from_52w_high}%
        </span>
      ) : '—',
    },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      {/* ============= Header: Toolbar + inline summary (لا كروتات) ============= */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Layers className="w-5 h-5 text-teal-600" />
          <h3 className="text-base font-bold">تتبع حركة القطاعات — {marketCode}</h3>
          <Badge variant="outline" className="text-xs">
            {ms.total_sectors} قطاع | {ms.total_stocks} سهم
          </Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Heat level filter */}
          <Select value={heatFilter} onValueChange={v => setHeatFilter(v === 'ALL' ? '' : v)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="كل الحرارات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">كل الحرارات</SelectItem>
              <SelectItem value="HOT">🔥 نار</SelectItem>
              <SelectItem value="WARM">☀️ دافئ</SelectItem>
              <SelectItem value="NEUTRAL">➖ محايد</SelectItem>
              <SelectItem value="COOL">💧 بارد</SelectItem>
              <SelectItem value="COLD">❄️ بارد جداً</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => setWithRotation(v => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors h-8',
              withRotation
                ? 'bg-teal-50 border-teal-200 text-teal-700 dark:bg-teal-950 dark:border-teal-800'
                : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50'
            )}
            title="تفعيل كشف دوران السيولة (أبطأ لكن predictive)"
          >
            <RefreshCw className="w-3 h-3" />
            دوران السيولة
          </button>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5 h-8">
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </Button>
          <UnifiedPublishButton
            variant="outline"
            size="sm"
            title="تتبع حركة القطاعات"
            content={`تتبع حركة القطاعات — ${marketCode}\nعدد القطاعات: ${ms?.total_sectors ?? 0} | عدد الأسهم: ${ms?.total_sectors ?? 0}\nمتوسط التغير: ${ms?.avg_change ?? 0}%\n\n${sectors.slice(0, 15).map((s, i) => `${i + 1}. ${s.sector} — ${s.avg_change >= 0 ? '+' : ''}${s.avg_change}% — رابحة ${s.gainers}/خاسرة ${s.losers} — السيولة ${formatEGPShort(s.turnover)}`).join('\n')}`}
            filename={`sector-tracking-${marketCode}-${Date.now()}`}
            hashtags={['قطاعات', marketCode, 'بورصة']}
            triggerLabel="نشر"
          />
        </div>
      </div>

      {/* ============= Inline summary strip (لا كروتات) — السيولة + التغير ============= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs px-1">
        <div className="flex flex-col gap-0.5 py-1.5 px-2 rounded-md border border-emerald-500/20 bg-emerald-500/5">
          <span className="text-muted-foreground">صاعدة</span>
          <span className="text-emerald-600 font-bold font-mono text-sm">{ms.advancers}</span>
        </div>
        <div className="flex flex-col gap-0.5 py-1.5 px-2 rounded-md border border-rose-500/20 bg-rose-500/5">
          <span className="text-muted-foreground">هابطة</span>
          <span className="text-red-600 font-bold font-mono text-sm">{ms.decliners}</span>
        </div>
        <div className="flex flex-col gap-0.5 py-1.5 px-2 rounded-md border border-muted">
          <span className="text-muted-foreground">متوسط التغير</span>
          <span className={cn('font-bold font-mono text-sm', ms.avg_change >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {ms.avg_change >= 0 ? '+' : ''}{ms.avg_change}%
          </span>
        </div>
        <div className="flex flex-col gap-0.5 py-1.5 px-2 rounded-md border border-muted">
          <span className="text-muted-foreground">اتساع السوق</span>
          <span className="font-bold font-mono text-sm">{ms.breadth}%</span>
        </div>
        <div className="flex flex-col gap-0.5 py-1.5 px-2 rounded-md border border-muted">
          <span className="text-muted-foreground">إجمالي السيولة</span>
          <span className="font-bold font-mono text-sm">{formatEGPShort(ms.total_turnover)}</span>
        </div>
        <div className="flex flex-col gap-0.5 py-1.5 px-2 rounded-md border border-muted">
          <span className="text-muted-foreground">عدد القطاعات</span>
          <span className="font-bold font-mono text-sm">{ms.total_sectors}</span>
        </div>
      </div>

      {/* ============= Rotation signals (optional) ============= */}
      {rotation && !rotation.error && (rotation.entering?.length > 0 || rotation.leaving?.length > 0) && (
        <div className="border border-teal-500/30 bg-teal-500/5 rounded-md p-3">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-teal-600" />
            <span className="text-sm font-semibold">إشارات دوران السيولة</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {rotation.entering?.map((r: any, i: number) => (
              <span key={`en-${i}`} className="text-xs px-2 py-1 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
                {r.sector} — السيولة راجعة ({r.days_rising} أيام صعود)
              </span>
            ))}
            {rotation.leaving?.map((r: any, i: number) => (
              <span key={`lv-${i}`} className="text-xs px-2 py-1 rounded border bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300">
                {r.sector} — السيولة بتهرب ({r.days_falling} أيام هبوط)
              </span>
            ))}
            {rotation.rotation_signals?.map((sig: string, i: number) => (
              <span key={`sig-${i}`} className="text-xs px-2 py-1 rounded border bg-slate-500/10 border-slate-500/30 text-slate-700 dark:text-slate-300">
                {sig}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ============= الجدول الرئيسي للقطاعات — UnifiedTable (expandable) ============= */}
      <div className="rounded-lg border border-border overflow-hidden">
        {data && sectors.length > 0 && (
          <UnifiedTable<SectorTrackingEntry>
            key={`sectors-${marketCode}-${heatFilter}-${withRotation ? '1' : '0'}`}
            columns={sectorColumns}
            data={sectors}
            keyField="sector"
            expandable
            defaultExpandedKey={sectors[0]?.sector}
            expandRender={(s) => {
              const heat = HEAT_LEVEL_STYLE[s.heat_level] || HEAT_LEVEL_STYLE.NEUTRAL;
              void heat;
              return (
                <div className="rounded-md border border-border bg-background overflow-hidden m-1">
                  <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      أسهم قطاع {s.sector} — {s.stocks.length} سهم
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      اضغط على أي صف لعرض تفاصيل السهم
                    </span>
                  </div>
                  <UnifiedTable<SectorTrackingStock>
                    columns={stockColumns}
                    data={sortStocks(s.stocks)}
                    keyField="ticker"
                    dense
                    columnToggle
                    filterable
                    maxHeight="max-h-80"
                    onRowClick={(st) => loadStockDetail(st.ticker)}
                    rowClassName={() => 'cursor-pointer hover:bg-muted/50 transition-colors'}
                  />
                </div>
              );
            }}
            columnToggle
            filterable
            maxHeight="max-h-[640px]"
            rowClassName={(s) => cn(
              'cursor-pointer hover:bg-muted/40 transition-colors',
              expandedSector === s.sector && 'bg-muted/30',
            )}
            onRowClick={(s) => setExpandedSector(prev => prev === s.sector ? null : s.sector)}
          />
        )}
        {data && sectors.length === 0 && (
          <div className="text-center text-muted-foreground py-8">
            لا توجد قطاعات مطابقة للفلاتر الحالية
          </div>
        )}
      </div>

      {/* ملاحظة للعميل — شرح الألوان */}
      <div className="text-[11px] text-muted-foreground px-1 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-300/40" />
          تغير إيجابي
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-rose-100 dark:bg-rose-950/50 border border-rose-300/40" />
          تغير سلبي
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-muted/40 border border-border" />
          محايد
        </span>
        <span>•</span>
        <span>اضغط على عنوان أي عمود للترتيب</span>
        <span>•</span>
        <span>اضغط على صف القطاع لعرض أسهمه</span>
        <span>•</span>
        <span>اضغط على أي سهم لعرض تفاصيله</span>
      </div>
    </div>
  );
}


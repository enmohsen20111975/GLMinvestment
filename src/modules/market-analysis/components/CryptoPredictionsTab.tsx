'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
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
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
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
import { ExpertRecommendationsPanel } from '@/modules/market-analysis/components/ExpertRecommendationsPanel';
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


function CryptoIndicatorRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number | null | undefined;
  hint?: string;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold tabular-nums" title={hint}>{value}</span>
    </div>
  );
}


function CryptoPredictionCard({ p }: { p: CryptoPrediction }) {
  const meta = cryptoSymbolMeta(p.symbol);
  const style = cryptoSignalStyle(p.signal);
  const analysis = p.analysis || {};
  const indicators =
    (analysis['indicators'] as Record<string, unknown> | undefined) || undefined;
  const rsi = indicators ? (indicators['rsi'] as number | undefined) : undefined;
  const macdHist = indicators
    ? (indicators['macd_hist'] as number | undefined)
    : undefined;
  const macdLine = indicators
    ? (indicators['macd_line'] as number | undefined)
    : undefined;
  const macdSignal = indicators
    ? (indicators['macd_signal'] as number | undefined)
    : undefined;
  const atrPct = indicators
    ? (indicators['atr_pct'] as number | undefined)
    : undefined;
  const trendUp = analysis['trend_up'] as boolean | undefined;
  const change24h = analysis['change_24h_pct'] as number | undefined;
  const fusion = analysis['fusion'] as
    | { signal?: string; signal_ar?: string; score?: number }
    | undefined;
  const finalSignalAr = analysis['final_signal_ar'] as string | undefined;
  const candlesAnalyzed = analysis['candles_analyzed'] as number | undefined;

  const rsiNum = typeof rsi === 'number' ? rsi : undefined;
  const rsiColor =
    rsiNum === undefined
      ? 'text-muted-foreground'
      : rsiNum >= 70
        ? 'text-rose-600'
        : rsiNum <= 30
          ? 'text-emerald-600'
          : 'text-foreground';

  return (
    <Card className={cn('overflow-hidden border-border/60', style.bg)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-background border border-border text-2xl font-bold leading-none shadow-sm">
              {meta.icon}
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                {p.symbol}
                {p.symbol === 'BTC' ? (
                  <Bitcoin className="h-4 w-4 text-amber-500" />
                ) : p.symbol === 'ETH' ? (
                  <Zap className="h-4 w-4 text-violet-500" />
                ) : null}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{meta.name}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className={cn('px-2.5 py-1 text-xs font-bold', style.badge)}>
              {cryptoSignalLabelAr(p.signal)} · {p.signal}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">
              ثقة {(p.confidence ?? 0).toFixed(1)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Prices grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">الدخول</p>
            <p className="text-sm font-semibold tabular-nums">
              {usdCurrencyFmt.format(p.entry_price)}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">الهدف</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-600">
              {usdCurrencyFmt.format(p.target_price)}
            </p>
          </div>
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">الإيقاف</p>
            <p className="text-sm font-semibold tabular-nums text-rose-600">
              {usdCurrencyFmt.format(p.stop_loss)}
            </p>
          </div>
        </div>

        {/* Risk/Reward quick stats */}
        {p.entry_price > 0 && p.target_price > 0 && p.stop_loss > 0 && (
          <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
            <span className="text-muted-foreground">المخاطرة/العائد</span>
            <span className="font-semibold tabular-nums">
              1 :
              {(
                Math.abs(p.target_price - p.entry_price) /
                Math.max(Math.abs(p.entry_price - p.stop_loss), 1e-9)
              ).toFixed(2)}
            </span>
          </div>
        )}

        {/* Indicators */}
        {indicators && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">
              المؤشرات الفنية
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground">RSI</span>
                <span className={cn('text-xs font-semibold tabular-nums', rsiColor)}>
                  {rsiNum !== undefined ? (rsiNum ?? 0).toFixed(2) : '—'}
                </span>
              </div>
              <CryptoIndicatorRow
                label="MACD Hist"
                value={
                  typeof macdHist === 'number' ? (macdHist ?? 0).toFixed(4) : '—'
                }
                hint="MACD Histogram"
              />
              <CryptoIndicatorRow
                label="ATR %"
                value={
                  typeof atrPct === 'number' ? `${(atrPct ?? 0).toFixed(2)}%` : '—'
                }
                hint="Average True Range %"
              />
              <CryptoIndicatorRow
                label="تغيّر 24h"
                value={
                  typeof change24h === 'number'
                    ? `${change24h >= 0 ? '+' : ''}${(change24h ?? 0).toFixed(2)}%`
                    : '—'
                }
              />
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground">الاتجاه</span>
                <span
                  className={cn(
                    'text-xs font-semibold',
                    trendUp === true
                      ? 'text-emerald-600'
                      : trendUp === false
                        ? 'text-rose-600'
                        : 'text-muted-foreground'
                  )}
                >
                  {trendUp === true
                    ? 'صاعد ↑'
                    : trendUp === false
                      ? 'هابط ↓'
                      : '—'}
                </span>
              </div>
            </div>
            {typeof macdLine === 'number' && typeof macdSignal === 'number' && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground">
                  MACD Line / Signal
                </span>
                <span className="text-xs font-semibold tabular-nums">
                  {(macdLine ?? 0).toFixed(2)} / {(macdSignal ?? 0).toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Fusion / final signal */}
        {(fusion || finalSignalAr) && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
            {finalSignalAr && (
              <span className="font-semibold">{finalSignalAr}</span>
            )}
            {fusion?.signal_ar && (
              <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                دمج: {fusion.signal_ar}
              </Badge>
            )}
            {typeof fusion?.score === 'number' && (
              <span className="text-muted-foreground tabular-nums">
                نقطة الدمج: {fusion.score}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {arDateTimeFmt.format(new Date(p.created_at))}
          </span>
          {typeof candlesAnalyzed === 'number' && (
            <span className="tabular-nums">{candlesAnalyzed} شمعة</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Phase P5: Sector Tracking Tab — تتبع حركة القطاعات (السيولة + الزخم + الحركة)
// Node = DISPLAY ONLY. كل logic في Python (engine/flow_system.py).
// ----------------------------------------------------------------------------
// Redesign (part1-sectors-redesign): جدول احترافي للعميل — جداول فقط (لا كروتات)،
// sortable بكل الأعمدة + heatmap بسيط على عمود متوسط التغير + جدول فرعي collapsible
// للأسهم مع clickable row → #stock-detail.
// ============================================================================

export function CryptoPredictionsTab() {
  const [data, setData] = useState<CryptoPredictionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setError(null);
    try {
      const res = await fetch('/api/crypto-lab/predictions', {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as CryptoPredictionsResponse;
      if (!json.success) {
        throw new Error(json.error || 'فشل في تحميل التوقعات');
      }
      setData(json);
      setError(null);
      setLastFetchAt(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      if (!silent) {
        console.error('[CryptoPredictionsTab] fetch failed:', err);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // 🔥 P14: polling بيتوقف لو liveMode مش مفعّل (افتراضي). الكريبتو 24/7 بس
    // مانريدش نحمّل الـ backend كل دقيقة لو المستخدم مش متابع نشط.
    const interval = setInterval(() => {
      if (!useAnalysisStore.getState().liveMode) return;
      fetchData(true);
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ---- Loading state ----
  if (loading && !data) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          جارٍ تحميل توقعات الكريبتو...
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (error && !data) {
    return (
      <Card className="border-rose-500/30 bg-rose-500/5">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
          <p className="text-sm font-semibold text-rose-600">
            تعذّر تحميل توقعات الكريبتو
          </p>
          <p className="text-xs text-muted-foreground break-all">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            className="mt-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  const predictions = data?.predictions ?? [];

  // ---- Empty state ----
  if (predictions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Bitcoin className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">
            لا توجد توقعات كريبتو بعد. المختبر يعمل كل 15 دقيقة وستظهر التوقعات
            قريباً.
          </p>
          {data?.note && (
            <p className="text-xs text-muted-foreground">{data.note}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            className="mt-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            تحديث
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- Success state ----
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bitcoin className="h-4 w-4 text-amber-500" />
          <span>
            توقعات لحظية لـ BTC و ETH — يُحدّث المختبر كل 15 دقيقة، وتُحدّث
            الصفحة كل دقيقة.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastFetchAt && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              آخر تحديث للصفحة:{' '}
              {new Intl.DateTimeFormat('ar-EG', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }).format(lastFetchAt)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            disabled={loading}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', loading && 'animate-spin')}
            />
            تحديث
          </Button>
        </div>
      </div>

      {data?.last_updated && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          آخر توقعة من المختبر:{' '}
          <span className="font-semibold tabular-nums">
            {arDateTimeFmt.format(new Date(data.last_updated))}
          </span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {predictions.map((p) => (
          <CryptoPredictionCard key={p.id} p={p} />
        ))}
      </div>

      {error && (
        <p className="text-xs text-amber-600">
          تحذير: آخر تحديث صامت فشل ({error}). يتم عرض آخر بيانات ناجحة.
        </p>
      )}
    </div>
  );
}

// ============================================================================
// P17 Morning Bell — جرس الصباح (أعلى 3 فرص EGX)
// ============================================================================


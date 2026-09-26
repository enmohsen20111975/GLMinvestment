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
import { PreviousPredictionsArchive } from './PredictionsTab';

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
  StockDetail,
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

// NOTE: PHASE3-BUNDLE-OPT — dynamic imports relocated from MarketAnalysisView.tsx.
// Relative paths point one directory up since this file lives in market-analysis/.
const TradingChartViewDynamic = dynamic(
  () => import('../TradingChartView').then(m => ({ default: m.TradingChartView })),
  { ssr: false, loading: () => <Skeleton className='h-[500px] w-full rounded-xl' /> }
);

const SingleStockAnalysisViewDynamic = dynamic(
  () => import('../SingleStockAnalysisView').then(m => ({ default: m.SingleStockAnalysisView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    ),
  }
);


function PersonaCard({
  ticker,
  persona,
  data,
  maestroScore,
  updatedAt,
  narrative,
  market,
  nameAr,
  logoUrl,
  fundamentals,
  onClick,
}: {
  ticker: string;
  // P26: 3 personas (conservative / balanced / gambler) بدل 2
  persona: 'conservative' | 'balanced' | 'gambler';
  data: PersonaData;
  maestroScore?: number;
  updatedAt?: string;
  narrative?: { line1?: string; line2?: string; line3?: string };
  market: MarketType;
  nameAr?: string;
  logoUrl?: string | null;
  fundamentals?: StoredAnalysisItem['fundamentals'];
  onClick?: () => void;
}) {
  const { loadStockDetail } = useAppStore();
  const colors = getVerdictColor(data.verdict);
  const score = data.score ?? 0;
  // P26: isInvestor بقى معناها "أفق طويل" = conservative (conservative = alias قديم لـ investor)
  const isInvestor = persona === 'conservative' || persona === 'investor';

  // ألوان البرسونا — emerald للمستثمر، amber للمتوازن، fuchsia للمضارب (تجنّب blue/indigo)
  const personaTheme = isInvestor
    ? { emoji: '🛡️', label: 'المستثمر', accent: 'text-emerald-700 dark:text-emerald-400', accentBg: 'bg-emerald-50 dark:bg-emerald-950/40', accentBorder: 'border-emerald-200 dark:border-emerald-900' }
    : persona === 'balanced'
    ? { emoji: '⚖️', label: 'المتوازن', accent: 'text-amber-700 dark:text-amber-400', accentBg: 'bg-amber-50 dark:bg-amber-950/40', accentBorder: 'border-amber-200 dark:border-amber-900' }
    : { emoji: '🎯', label: 'المضارب', accent: 'text-fuchsia-700 dark:text-fuchsia-400', accentBg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40', accentBorder: 'border-fuchsia-200 dark:border-fuchsia-900' };

  const targetPct = data.entry && data.target && data.entry > 0
    ? ((data.target - data.entry) / data.entry) * 100
    : null;
  const stopPct = data.entry && data.stop && data.entry > 0
    ? ((data.stop - data.entry) / data.entry) * 100
    : null;

  // Gates data from sniper engine
  const hasGates = data.gates && data.gates.passed > 0;
  const gatesList = data.gates ? [
    { label: 'السيولة', passed: data.gates.liquidity, detail: data.gate_details?.liquidity_reason },
    { label: 'الاتجاه', passed: data.gates.trend, detail: data.gate_details?.trend_reason },
    { label: 'دعم/مقاومة', passed: data.gates.support_resistance, detail: data.gate_details?.sr_reason },
    { label: 'عائد/مخاطرة', passed: data.gates.risk_reward, detail: data.gate_details?.rr_reason },
    { label: 'التأكيد', passed: data.gates.confirmation, detail: data.gate_details?.confirmation_reason },
  ] : [];

  // Format volume for display
  const formatVol = (v: number | undefined) => {
    if (!v) return '—';
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString();
  };

  // Performance color
  const perfColor = (v: number | undefined) => {
    if (v === undefined || v === null) return 'text-muted-foreground';
    return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';
  };

  return (
    <Card className={cn('border-2', colors.border, 'overflow-hidden transition-all duration-200 hover:shadow-md cursor-pointer',
      hasGates && data.gates!.passed >= 4 && 'ring-1 ring-emerald-300 dark:ring-emerald-700',
      hasGates && data.gates!.passed >= 5 && 'ring-2 ring-emerald-400 dark:ring-emerald-600',
    )} onClick={onClick || (() => loadStockDetail(ticker))}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={ticker}
                className="w-9 h-9 rounded-full object-contain bg-background border border-border flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <span className="text-2xl flex-shrink-0">{personaTheme.emoji}</span>
            )}
            <div>
              <CardTitle className="text-lg">{ticker}</CardTitle>
              {nameAr && (
                <p className="text-xs text-muted-foreground leading-tight">{nameAr}</p>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className={cn('text-xs font-semibold', personaTheme.accent)}>
                  {personaTheme.label}
                </p>
                {/* C2-SECTOR-HEAT + CL7-UI-SECTORS: اعرض القطاع من fundamentals
                    (الـ backend بيملأه) مع شارة سخونة القطاع (🔥 hot / ❄️ dead)
                    وشارة دور السهم (قائد/تابع/متأخر). ده بيخلي العميل يفهم ليه
                    المنصة اختارت السهم ده (لأنه قائد قطاع بيتحرك). */}
                {(fundamentals?.sector || data.sector) && (
                  <span className={cn(
                    'text-xs px-1.5 py-0 rounded-full border flex items-center gap-0.5',
                    fundamentals?.sector_heat === 'hot'
                      ? 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800'
                      : fundamentals?.sector_heat === 'dead'
                      ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800'
                      : 'bg-muted text-muted-foreground border-border'
                  )} title={
                    fundamentals?.sector_heat === 'hot'
                      ? 'قطاع سخن — دوران قطاعي إيجابي (+15% boost للمضارب)'
                      : fundamentals?.sector_heat === 'dead'
                      ? 'قطاع ميت — معظم الأسهم هابطة (-10% penalty للمضارب)'
                      : undefined
                  }>
                    {fundamentals?.sector_heat === 'hot' && <span>🔥</span>}
                    {fundamentals?.sector_heat === 'dead' && <span>❄️</span>}
                    {fundamentals?.sector || data.sector}
                  </span>
                )}
                {/* CL7-UI-SECTORS: شارة دور السهم جوه قطاعه (قائد/تابع/متأخر).
                    قائد قطاع ساخن = فرصة قوية للمضارب. متأخر في قطاع ميت = تجنّب. */}
                {fundamentals?.sector_role && fundamentals.sector_role !== 'mid' && (
                  <span
                    className={cn(
                      'text-xs px-1.5 py-0 rounded-full border flex items-center gap-0.5',
                      fundamentals.sector_role === 'leader'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                        : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800'
                    )}
                    title={
                      fundamentals.sector_role === 'leader'
                        ? 'قائد القطاع — السهم بيقود حركة القطاع (مفضّل للمضارب في قطاع ساخن)'
                        : 'متأخر عن القطاع — السهم بيتأخر عن حركة القطاع (مرفوض للمضارب في قطاع ميت)'
                    }
                  >
                    {fundamentals.sector_role === 'leader' ? '👑 قائد' : '⬇️ متأخر'}
                  </span>
                )}
                {data.is_egx30 && (
                  <span className="text-xs px-1.5 py-0 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                    EGX30
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-left flex flex-col items-end gap-1">
            <Badge className={cn(colors.bg, colors.text, 'border-0 text-sm font-bold')}>
              {data.verdict || 'قيد التحليل'}
            </Badge>
            {/* DYNAMIC-SYSTEM-001: شارة "مراقبة" صفراء للأسهم اللي إشارتها HOLD
                بس درجتها عالية (>= 50%) — عشان تبويب المستثمر ميفضلش فاضي.
                المستخدم طلب: "لو السهم إشارته HOLD بس درجته عالية، اعرضه
                واكتب تحته بـ Badge لونه أصفر: مراقبة - انتظر كسر المقاومة" */}
            {isInvestor && data.signal && String(data.signal).toUpperCase() === 'HOLD' && (data.score ?? 0) >= 50 && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                👁️ مراقبة — انتظر كسر المقاومة
              </Badge>
            )}
            {data.gates && (
              <Badge variant="outline" className={cn(
                'text-xs px-1.5 py-0',
                data.gates.passed >= 4 ? 'border-emerald-300 text-emerald-600 dark:text-emerald-400' :
                data.gates.passed >= 3 ? 'border-amber-300 text-amber-600 dark:text-amber-400' :
                'border-red-300 text-red-600 dark:text-red-400'
              )}>
                <Crosshair className="h-2.5 w-2.5 ml-0.5" />
                {data.gates.passed}/5
              </Badge>
            )}
            {updatedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(updatedAt).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ══════ P16-PERSONA-DIVERGENCE: توقيع البرسونا (chip مميز لكل persona) ══════ */}
        {fundamentals && (
          <div className={cn(
            'rounded-md p-2 text-xs flex flex-wrap items-center gap-1.5',
            personaTheme.accentBg,
            personaTheme.accentBorder,
            'border'
          )}>
            {isInvestor ? (
              <>
                <span className={cn('font-bold', personaTheme.accent)}>🏦 توقيع المستثمر:</span>
                {fundamentals.pe_ratio ? <span>P/E {fundamentals.pe_ratio.toFixed(1)}</span> : null}
                {fundamentals.roe ? <span>• ROE {fundamentals.roe.toFixed(0)}%</span> : null}
                {fundamentals.fair_value_upside ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    • خصم {fundamentals.fair_value_upside.toFixed(1)}%
                  </span>
                ) : null}
                {fundamentals.dividend_yield ? <span>• توزيع {fundamentals.dividend_yield.toFixed(1)}%</span> : null}
              </>
            ) : (
              <>
                <span className={cn('font-bold', personaTheme.accent)}>🎯 توقيع المضارب:</span>
                {fundamentals.volume_ratio && fundamentals.volume_ratio >= 1.0 ? (
                  <span>حجم {fundamentals.volume_ratio.toFixed(1)}x</span>
                ) : null}
                {fundamentals.change_1d ? (
                  <span className={fundamentals.change_1d > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                    • {fundamentals.change_1d > 0 ? '+' : ''}{fundamentals.change_1d.toFixed(1)}%
                  </span>
                ) : null}
                {fundamentals.volatility ? <span>• تقلب {fundamentals.volatility.toFixed(1)}%</span> : null}
                {fundamentals.rsi ? <span>• RSI {fundamentals.rsi.toFixed(0)}</span> : null}
              </>
            )}
          </div>
        )}

        {/* ══════ التوقع — المحور الأساسي ══════ */}
        {(data.entry || data.target || data.stop) && (
          <div className={cn(
            'rounded-lg p-3 border-2',
            data.risk_reward && data.risk_reward >= 2.0
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800'
              : data.risk_reward && data.risk_reward >= 1.5
              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800'
              : 'bg-muted/50 border-border'
          )}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-foreground">🎯 التوقع</span>
              {data.risk_reward && data.risk_reward > 0 && (
                <span className={cn(
                  'text-lg font-black',
                  data.risk_reward >= 3 ? 'text-emerald-600 dark:text-emerald-400' :
                  data.risk_reward >= 2 ? 'text-emerald-500' :
                  data.risk_reward >= 1.5 ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400'
                )}>
                  1:{data.risk_reward.toFixed(1)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm min-w-0">
              <div className="rounded-md bg-background/60 p-2 min-w-0">
                <p className="text-muted-foreground text-xs mb-0.5">💰 ادخل</p>
                <p className="font-bold text-foreground text-base">{data.entry ? data.entry.toFixed(2) : '—'}</p>
              </div>
              <div className="rounded-md bg-emerald-100/60 dark:bg-emerald-900/30 p-2">
                <p className="text-emerald-700 dark:text-emerald-400 text-xs mb-0.5">
                  📈 هدف{targetPct !== null && ` +${targetPct.toFixed(1)}%`}
                </p>
                <p className="font-bold text-emerald-700 dark:text-emerald-400 text-base">
                  {data.target ? data.target.toFixed(2) : '—'}
                </p>
              </div>
              <div className="rounded-md bg-red-100/60 dark:bg-red-900/30 p-2">
                <p className="text-red-700 dark:text-red-400 text-xs mb-0.5">
                  🛑 وقف{stopPct !== null && ` ${stopPct.toFixed(1)}%`}
                </p>
                <p className="font-bold text-red-700 dark:text-red-400 text-base">
                  {data.stop ? data.stop.toFixed(2) : '—'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* تنبيه R/R ضعيف — يوليو 2026 */}
        {data.risk_reward !== null && data.risk_reward !== undefined && data.risk_reward > 0 && data.risk_reward < 1.5 && (data.entry || data.target || data.stop) && (
          <div className="flex items-center gap-1.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-2 text-xs text-red-700 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>⚠️ عائد/مخاطرة {data.risk_reward.toFixed(2)}:1 — المخاطرة أكبر من الربح، الصفقة غير آمنة.</span>
          </div>
        )}

        {/* Score bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">{data.sniper_score ? '🎯 نتيجة التصطاد' : 'النتيجة'}</span>
            <span className="font-bold">{score.toFixed(0)}/100</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', getScoreColor(score))}
              style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            />
          </div>
        </div>

        {/* Gates visual — من محرك التصطاد (مع أسباب كل بوابة) */}
        {hasGates && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1">
                <Crosshair className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">بوابات التصفية ({data.gates.passed}/5)</span>
              </div>
            </div>
            <div className="flex gap-1">
              {gatesList.map((gate, i) => (
                <div
                  key={i}
                  title={gate.detail || ''}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-0.5 rounded-md py-1.5 px-0.5 text-xs transition-colors cursor-default',
                    gate.passed
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                      : 'bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400'
                  )}
                >
                  {gate.passed ? (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldX className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate w-full text-center">{gate.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick metrics row — RSI + R/R + Volume */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          {/* RSI */}
          <div className="rounded-md bg-muted/50 p-1.5 text-center">
            <p className="text-muted-foreground text-xs mb-0.5">RSI</p>
            <span className={cn(
              'font-semibold text-sm',
              data.rsi && data.rsi > 70 ? 'text-red-600 dark:text-red-400' :
              data.rsi && data.rsi < 30 ? 'text-emerald-600 dark:text-emerald-400' :
              'text-foreground'
            )}>
              {data.rsi && data.rsi > 0 ? data.rsi.toFixed(0) : '—'}
            </span>
          </div>
          {/* Risk/Reward */}
          <div className={cn(
            'rounded-md p-1.5 text-center',
            data.risk_reward && data.risk_reward >= 3 ? 'bg-emerald-50 dark:bg-emerald-950/40' :
            data.risk_reward && data.risk_reward >= 1.5 ? 'bg-amber-50 dark:bg-amber-950/40' :
            data.risk_reward && data.risk_reward > 0 ? 'bg-red-50 dark:bg-red-950/40' :
            'bg-muted/50'
          )}>
            <p className="text-muted-foreground text-xs mb-0.5">عائد/مخاطرة</p>
            <span className={cn(
              'font-bold text-sm',
              data.risk_reward && data.risk_reward >= 3 ? 'text-emerald-600 dark:text-emerald-400' :
              data.risk_reward && data.risk_reward >= 1.5 ? 'text-amber-600 dark:text-amber-400' :
              data.risk_reward && data.risk_reward > 0 ? 'text-red-600 dark:text-red-400' :
              'text-muted-foreground'
            )}>
              {data.risk_reward && data.risk_reward > 0 ? `${data.risk_reward.toFixed(1)}` : '—'}
            </span>
          </div>
          {/* Volume */}
          <div className="rounded-md bg-muted/50 p-1.5 text-center">
            <p className="text-muted-foreground text-xs mb-0.5">الحجم</p>
            <span className="font-semibold text-sm text-foreground">
              {formatVol(data.volume)}
              {data.volume_ratio && data.volume_ratio > 1 && (
                <span className="text-emerald-600 dark:text-emerald-400 text-xs mr-0.5">↑{data.volume_ratio.toFixed(1)}x</span>
              )}
            </span>
          </div>
        </div>

        {/* Momentum / Performance (for المضارب) */}
        {!isInvestor && (data.perf_1w !== undefined || data.perf_1m !== undefined) && (
          <div className="flex items-center gap-3 px-1 text-xs">
            {data.perf_1w !== undefined && (
              <span className={cn('font-semibold', perfColor(data.perf_1w))}>
                أسبوع: {data.perf_1w > 0 ? '+' : ''}{data.perf_1w.toFixed(1)}%
              </span>
            )}
            {data.perf_1m !== undefined && (
              <span className={cn('font-semibold', perfColor(data.perf_1m))}>
                شهر: {data.perf_1m > 0 ? '+' : ''}{data.perf_1m.toFixed(1)}%
              </span>
            )}
            {data.perf_3m !== undefined && (
              <span className={cn('font-semibold', perfColor(data.perf_3m))}>
                3 أشهر: {data.perf_3m > 0 ? '+' : ''}{data.perf_3m.toFixed(1)}%
              </span>
            )}
          </div>
        )}

        {/* Fundamentals (for المستثمر) */}
        {isInvestor && (data.pe_ratio || data.roe || data.net_margin) && (
          <div className="flex items-center gap-3 px-1 text-xs flex-wrap">
            {data.pe_ratio && data.pe_ratio > 0 && (
              <span className="text-muted-foreground">
                P/E: <span className="font-semibold text-foreground">{data.pe_ratio.toFixed(1)}</span>
              </span>
            )}
            {data.roe && (
              <span className="text-muted-foreground">
                ROE: <span className={cn('font-semibold', data.roe > 10 ? 'text-emerald-600' : 'text-foreground')}>{data.roe.toFixed(1)}%</span>
              </span>
            )}
            {data.net_margin && (
              <span className="text-muted-foreground">
                هامش: <span className={cn('font-semibold', data.net_margin > 0 ? 'text-emerald-600' : 'text-red-600')}>{data.net_margin.toFixed(1)}%</span>
              </span>
            )}
            {data.debt_to_equity && (
              <span className="text-muted-foreground">
                دين/حقوق: <span className={cn('font-semibold', data.debt_to_equity < 1 ? 'text-emerald-600' : 'text-amber-600')}>{data.debt_to_equity.toFixed(2)}</span>
              </span>
            )}
          </div>
        )}

        {/* Market regime badge */}
        {data.market_regime && (
          <div className="flex items-center gap-1.5 px-1 text-xs">
            <Gauge className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">وضع السوق:</span>
            <span className={cn(
              'font-semibold',
              data.market_regime === 'bullish' ? 'text-emerald-600 dark:text-emerald-400' :
              data.market_regime === 'bearish' ? 'text-red-600 dark:text-red-400' :
              'text-amber-600 dark:text-amber-400'
            )}>
              {data.market_regime === 'bullish' ? 'صاعد' : data.market_regime === 'bearish' ? 'هابط' : 'متعادل'}
            </span>
          </div>
        )}

        {/* S/R levels */}
        {(data.support_level || data.resistance_level) && (
          <div className="flex items-center gap-3 px-1 text-xs">
            {data.support_level && (
              <span className="text-muted-foreground">
                دعم: <span className="font-semibold text-emerald-600">{data.support_level.toFixed(2)}</span>
              </span>
            )}
            {data.resistance_level && (
              <span className="text-muted-foreground">
                مقاومة: <span className="font-semibold text-red-600">{data.resistance_level.toFixed(2)}</span>
              </span>
            )}
            {data.price_vs_sr === 'near_support' && (
              <span className="text-xs px-1.5 py-0 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                قرب الدعم ✓
              </span>
            )}
            {data.price_vs_sr === 'near_resistance' && (
              <span className="text-xs px-1.5 py-0 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                قرب المقاومة ⚡
              </span>
            )}
          </div>
        )}

        {/* Reason */}
        {data.reason && (
          <p className="text-sm leading-relaxed text-foreground/90 bg-muted/50 rounded-md p-2">
            {data.reason}
          </p>
        )}

        {/* Narrative — القصة */}
        {narrative && (narrative.line1 || narrative.line2 || narrative.line3) && (
          <div className={cn('rounded-md p-2 text-xs space-y-1', personaTheme.accentBg)}>
            {narrative.line1 && <p className="text-foreground/80">📍 {narrative.line1}</p>}
            {narrative.line2 && <p className="text-foreground/80">📊 {narrative.line2}</p>}
            {narrative.line3 && <p className="text-foreground/80">🔮 {narrative.line3}</p>}
          </div>
        )}

        {/* Timeframe (للمستثمر) */}
        {isInvestor && data.timeframe && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>الإطار الزمني: <span className="font-semibold text-foreground">{data.timeframe}</span></span>
          </div>
        )}

        {/* Fair value (للمستثمر) */}
        {isInvestor && data.fair_value && data.fair_value > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Target className="h-3 w-3" />
            <span>القيمة العادلة: <span className="font-semibold text-foreground">{data.fair_value.toFixed(2)}</span></span>
          </div>
        )}

        {/* Conditions */}
        {data.conditions && data.conditions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">الشروط والأسباب:</p>
            <div className="flex flex-wrap gap-1.5">
              {data.conditions.slice(0, 5).map((c, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground/80 border border-border"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* أزرار النسخ والمشاركة */}
        <div className="flex gap-2 mt-3 pt-2 border-t border-border/50">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 text-xs flex-1"
            onClick={() => {
              const text = formatSinglePersonaPickText({
                ticker,
                nameAr: data.name_ar,
                name: ticker,
                analysisJson: { [persona]: data },
              } as StoredAnalysisItem, persona, market);
              navigator.clipboard.writeText(text);
              toast.success('تم نسخ التوقع ✓');
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            نسخ
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 text-xs flex-1"
            onClick={async () => {
              const text = formatSinglePersonaPickText({
                ticker,
                nameAr: data.name_ar,
                name: ticker,
                analysisJson: { [persona]: data },
              } as StoredAnalysisItem, persona, market);
              if (navigator.share) {
                try {
                  await navigator.share({ title: `توقعة ${ticker}`, text });
                } catch {}
              } else {
                navigator.clipboard.writeText(text);
                toast.success('تم نسخ التوقع ✓');
              }
            }}
          >
            <Share2 className="h-3.5 w-3.5" />
            مشاركة
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 text-xs flex-1 border-teal-400 text-teal-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"
            onClick={() => {
              const text = formatSinglePersonaPickText({
                ticker,
                nameAr: data.name_ar,
                name: ticker,
                analysisJson: { [persona]: data },
              } as StoredAnalysisItem, persona, market);
              navigator.clipboard.writeText(text);
              window.open('https://www.facebook.com/', '_blank');
              toast.success('تم نسخ التوقع وجاري فتح فيسبوك لصق المنشور 💙');
            }}
          >
            <Facebook className="h-3.5 w-3.5" />
            فيسبوك
          </Button>
        </div>

        {/* Footer — score reference + volatility */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
          <span>{data.sniper_score ? `تصطاد: ${data.sniper_score}` : maestroScore ? `مايسترو: ${maestroScore}` : ''}</span>
          <div className="flex items-center gap-2">
            {data.beta !== undefined && data.beta > 0 && (
              <span>β {data.beta.toFixed(2)}</span>
            )}
            {data.volatility !== undefined && data.volatility > 0 && (
              <span>σ {data.volatility.toFixed(1)}%</span>
            )}
            {data.signal && <span>{data.signal}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}



function PersonaTableView({ items, persona, market, onSelectItem }: { items: StoredAnalysisItem[], persona: 'conservative' | 'balanced' | 'gambler', market: MarketType, onSelectItem?: (item: StoredAnalysisItem) => void }) {
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor، balanced→gambler كتقريب)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  const stocks = useAnalysisStore((state) => state.stocks) || [];
  const stocksMap = React.useMemo(() => {
    const map = new Map<string, any>();
    stocks.forEach((s) => {
      if (s.ticker) {
        const clean = s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
        map.set(clean, s);
        map.set(s.ticker.toUpperCase(), s);
      }
    });
    return map;
  }, [stocks]);

  return (
    <div className="rounded-md border overflow-x-auto bg-card">
      <table className="w-full text-sm min-w-[950px]">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="p-2 text-center font-medium w-10">#</th>
            <th className="p-2 text-right font-medium">السهم</th>
            <th className="p-2 text-right font-medium">الاسم</th>
            <th className="p-2 text-center font-medium text-primary">السعر وقت التحليل</th>
            <th className="p-2 text-center font-medium">أعلى / أقل سعر</th>
            <th className="p-2 text-center font-medium">التقييم</th>
            <th className="p-2 text-center font-medium">النتيجة</th>
            <th className="p-2 text-center font-medium">الدخول</th>
            <th className="p-2 text-center font-medium">الهدف</th>
            <th className="p-2 text-center font-medium">الوقف</th>
            <th className="p-2 text-center font-medium">R/R</th>
            <th className="p-2 text-center font-medium hidden md:table-cell">أفق الاستثمار</th>
            <th className="p-2 text-right font-medium hidden lg:table-cell">السبب</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => {
            // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
            const pd: PersonaData = it.analysisJson?.[_personaKey] || {
              verdict: it.recommendationAr || '',
              score: it.maestroScore || 0,
              reason: '',
              signal: it.recommendation || 'HOLD',
              entry: it.entry?.price ?? null,
              target: it.entry?.target ?? null,
              stop: it.entry?.stopLoss ?? null,
              timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
            };
            const cleanTicker = it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
            const stockInfo = stocksMap.get(cleanTicker) || stocksMap.get(it.ticker.toUpperCase());
            const curPrice = pickValidPrice(stockInfo?.current_price, stockInfo?.close, pd.entry, typeof it.entry === 'object' ? it.entry?.price : undefined, it.analysisJson?.context?.historical?.current_price_zone);
            const highPrice = pickValidPrice(
              stockInfo?.high_price && stockInfo?.low_price && stockInfo.high_price !== stockInfo.low_price ? stockInfo.high_price : undefined,
              stockInfo?.high_52w && stockInfo?.low_52w && stockInfo.high_52w !== stockInfo.low_52w ? stockInfo.high_52w : undefined,
              pd.high,
              pd.resistance,
              stockInfo?.resistance,
              pd.target && pd.entry ? Math.max(Number(pd.target), Number(pd.entry)) : pd.target,
              stockInfo?.high_price
            );
            const lowPrice = pickValidPrice(
              stockInfo?.high_price && stockInfo?.low_price && stockInfo.high_price !== stockInfo.low_price ? stockInfo.low_price : undefined,
              stockInfo?.high_52w && stockInfo?.low_52w && stockInfo.high_52w !== stockInfo.low_52w ? stockInfo.low_52w : undefined,
              pd.low,
              pd.support,
              stockInfo?.support,
              pd.stop && pd.entry ? Math.min(Number(pd.stop), Number(pd.entry)) : pd.stop,
              stockInfo?.low_price
            );
            const style = verdictStyle(pd.verdict);
            const rr = computeRR(pd);
            const score = pd.score ?? it.maestroScore ?? 0;
            // 🔥 P0-UI FIX: STALE/MISMATCH flags من الـ backend
            // it.stale = السعر الحي بعيد عن entry بـ >20% (توقع قديمة)
            // it.priceTargetMismatch = السعر الحالي ≥ target (الهدف محقّق، التوقع منتهية)
            const isStale = Boolean(it.stale);
            const isMismatch = Boolean(it.priceTargetMismatch);
            const staleReason = (it.staleReason as string) || '';
            const rowOpacity = isMismatch ? 'opacity-50' : (isStale ? 'opacity-70' : '');

            return (
              <tr key={cleanTicker} className={cn("border-t border-border hover:bg-muted/40 transition-colors cursor-pointer", rowOpacity)} onClick={() => onSelectItem?.(it)}>
                <td className="p-2 text-center font-mono text-xs">{idx + 1}</td>
                <td className="p-2 font-bold text-xs">
                  <div className="flex items-center gap-1.5">
                    {it.logoUrl ? (
                      <img
                        src={it.logoUrl}
                        alt={cleanTicker}
                        className="w-5 h-5 rounded-full object-contain flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : null}
                    <span>{cleanTicker}</span>
                    {(isStale || isMismatch) && (
                      <span
                        title={staleReason || (isMismatch ? 'الهدف محقّق — التوقع منتهية' : 'توقع قديمة')}
                        className={cn(
                          "text-[10px] px-1 rounded font-bold cursor-help",
                          isMismatch
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                        )}
                      >
                        {isMismatch ? 'منتهية' : `قديمة ${it.stalePct ? `${it.stalePct}%` : ''}`}
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-2 text-xs text-muted-foreground max-w-[120px] truncate" title={it.nameAr || it.name || cleanTicker}>{it.nameAr || it.name || cleanTicker}</td>
                <td className={cn("p-2 text-center font-mono text-xs font-bold", isStale || isMismatch ? "text-amber-600 dark:text-amber-400" : "text-primary")} title={isStale || isMismatch ? staleReason : undefined}>
                  {fmtPrice(curPrice)}
                </td>
                <td className="p-2 text-center font-mono text-xs whitespace-nowrap">
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">▲ {fmtPrice(highPrice)}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">▼ {fmtPrice(lowPrice)}</span>
                </td>
                <td className="p-2 text-center">
                  {isMismatch ? (
                    <Badge className="text-xs font-bold border-0 bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200">
                      منتهية
                    </Badge>
                  ) : isStale ? (
                    <Badge className="text-xs font-bold border-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200" title={staleReason}>
                      ⚠️ قديمة
                    </Badge>
                  ) : (
                    <Badge style={{ backgroundColor: style.bg, color: style.color }} className="text-xs font-bold border-0">
                      {pd.verdict || 'متابعة'}
                    </Badge>
                  )}
                </td>
                <td className={cn('p-2 text-center font-mono text-xs', scoreColor(pd.score))}>
                  {Number(score).toFixed(0)}
                </td>
                <td className="p-2 text-center font-mono text-xs">{fmtPrice(pd.entry)}</td>
                <td className="p-2 text-center font-mono text-xs text-emerald-600 dark:text-emerald-400">{fmtPrice(pd.target)}</td>
                <td className="p-2 text-center font-mono text-xs text-rose-600 dark:text-rose-400">{fmtPrice(pd.stop)}</td>
                <td className={cn('p-2 text-center font-mono text-xs', rrColor(rr))}>
                  {rr != null ? `${rr.toFixed(2)}:1` : '—'}
                </td>
                <td className="p-2 text-center text-xs hidden md:table-cell">{pd.timeframe || '—'}</td>
                <td className="p-2 text-right hidden lg:table-cell text-xs text-muted-foreground max-w-[250px] truncate" title={pd.reason}>{pd.reason || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// بناء خريطة رمز ← اسم من API الأسهم المباشر (لإثراء نتائج التصطاد بأسماء حقيقية)

function StockDetailPanel({ item, persona, market, subTab, onSubTabChange, onBack, stockDetail }: {
  item: StoredAnalysisItem;
  // P26: 3 personas (conservative / balanced / gambler)
  persona: 'conservative' | 'balanced' | 'gambler';
  market: MarketType;
  subTab: 'details' | 'chart' | 'verdict';
  onSubTabChange: (tab: 'details' | 'chart' | 'verdict') => void;
  onBack: () => void;
  stockDetail: StockDetail | null;
}) {
  const currencyLabel = MARKET_CURRENCY_LABEL[market] || 'ج.م';
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson + fallback للحقول العلوية للسهم
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  const pd: PersonaData = item.analysisJson?.[_personaKey] || {
    verdict: item.recommendationAr || '',
    score: item.maestroScore || 0,
    reason: '',
    signal: item.recommendation || 'HOLD',
    entry: item.entry?.price ?? null,
    target: item.entry?.target ?? null,
    stop: item.entry?.stopLoss ?? null,
    timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
  };
  const ticker = item.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const analysisCardRef = useRef<HTMLDivElement>(null);
  const [capturingChart, setCapturingChart] = useState(false);
  const [capturingCard, setCapturingCard] = useState(false);

  // P43-VIRAL-SHARE: نسخ التحليل الشامل (نص غني + Footer ثابت)
  const handleCopyComprehensive = useCallback(() => {
    const text = formatComprehensiveStockText(item, market, stockDetail);
    navigator.clipboard.writeText(text);
    toast.success('تم نسخ التحليل الشامل ✓', {
      description: 'جاهز للّصق في تليجرام / فيسبوك / واتساب',
    });
  }, [item, market, stockDetail]);

  // P43-VIRAL-SHARE: التقاط صورة لكونتبر الشارت التفاعلي (Telegram-ready)
  const handleChartImage = useCallback(async () => {
    if (!chartContainerRef.current) {
      toast.error('افتح تبويب «الشارت» الأول عشان تلتقط صورته');
      return;
    }
    setCapturingChart(true);
    try {
      const dataUrl = await toPng(chartContainerRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        skipFonts: true,
      });
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const link = document.createElement('a');
      link.download = `${ticker}-chart-${yyyy}-${mm}-${dd}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تم تحميل صورة الشارت ✓');
    } catch (err) {
      console.error('[ChartImage] toPng error:', err);
      toast.error('فشل في التقاط صورة الشارت');
    } finally {
      setCapturingChart(false);
    }
  }, [ticker]);

  // P43-VIRAL-SHARE: توليد بطاقة تحليل مخصصة (800x600 Telegram-ready) + نسخ النص الشامل
  const handleAnalysisCard = useCallback(async () => {
    if (!analysisCardRef.current) {
      toast.error('البطاقة غير متاحة');
      return;
    }
    setCapturingCard(true);
    try {
      const dataUrl = await toPng(analysisCardRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#0f172a',
        cacheBust: true,
        skipFonts: true,
      });
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const link = document.createElement('a');
      link.download = `${ticker}-analysis-${yyyy}-${mm}-${dd}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // نسخ النص الشامل في نفس الوقت
      const text = formatComprehensiveStockText(item, market, stockDetail);
      try {
        await navigator.clipboard.writeText(text);
        toast.success('تم نسخ النص وتحميل بطاقة التحليل ✓', {
          description: 'شارك التوقع على تليجرام أو فيسبوك',
        });
      } catch {
        toast.success('تم تحميل بطاقة التحليل ✓');
      }
    } catch (err) {
      console.error('[AnalysisCard] toPng error:', err);
      toast.error('فشل في توليد بطاقة التحليل');
    } finally {
      setCapturingCard(false);
    }
  }, [item, market, stockDetail, ticker]);

  // بيانات للبطاقة المخفية
  const inv = item.analysisJson?.investor || {};
  const gam = item.analysisJson?.gambler || {};
  const activePd = pd;
  const price = pickValidPrice(stockDetail?.current_price, activePd.entry, inv.entry, gam.entry) || 0;
  const changePct = stockDetail?.change_percent != null ? stockDetail.change_percent : 0;
  const gates = activePd.gates;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowRight className="h-4 w-4" />
          رجوع
        </Button>
        <span className="font-bold text-lg">{ticker}</span>
        <span className="text-muted-foreground text-sm">{item.nameAr || item.name}</span>
        {/* P43-VIRAL-SHARE: أزرار النسخ الشامل + بطاقة التحليل + صورة الشارت */}
        <div className="flex items-center gap-2 mr-auto flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8"
            onClick={handleCopyComprehensive}
          >
            <FileText className="h-3.5 w-3.5" />
            نسخ شامل
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 border-emerald-400 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
            onClick={handleAnalysisCard}
            disabled={capturingCard}
          >
            {capturingCard ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            بطاقة تحليل
          </Button>
          {subTab === 'chart' && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 h-8 border-fuchsia-400 text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-950/20"
              onClick={handleChartImage}
              disabled={capturingChart}
            >
              {capturingChart ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              صورة الشارت
            </Button>
          )}
        </div>
      </div>

      <Tabs value={subTab} onValueChange={(v) => onSubTabChange(v as 'details' | 'chart' | 'verdict')} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="details">بيانات السهم</TabsTrigger>
          <TabsTrigger value="chart">الشارت</TabsTrigger>
          <TabsTrigger value="verdict">التوقع</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardContent className="p-4 space-y-3">
              {!stockDetail ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">السعر وقت التحليل</p>
                    <p className="font-bold">{stockDetail?.current_price ? `${stockDetail.current_price.toFixed(2)} ${currencyLabel}` : pd.entry?.price ? `${pd.entry.price.toFixed(2)} ${currencyLabel}` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">التغير</p>
                    <p className="font-bold">{stockDetail?.change_percent != null ? `${stockDetail.change_percent >= 0 ? '+' : ''}${stockDetail.change_percent.toFixed(2)}%` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الحجم</p>
                    <p className="font-bold">{stockDetail?.volume ? formatVolume(stockDetail.volume) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">القطاع</p>
                    <p className="font-bold">{stockDetail?.sector || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">P/E</p>
                    <p className="font-bold">{stockDetail?.pe_ratio ? stockDetail.pe_ratio.toFixed(2) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">P/B</p>
                    <p className="font-bold">{stockDetail?.pb_ratio ? stockDetail.pb_ratio.toFixed(2) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">القيمة السوقية</p>
                    <p className="font-bold">{stockDetail?.market_cap ? formatNumber(stockDetail.market_cap) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الرأي</p>
                    <p className="font-bold">{pd.verdict || '—'}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chart">
          <Card>
            <CardContent className="p-2">
              <div className="h-[65vh]" ref={chartContainerRef}>
                <TradingChartViewDynamic initialTicker={ticker} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verdict">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="space-y-2">
                <h4 className="font-semibold">التوقع</h4>
                <p className="text-lg font-bold">{pd.verdict || 'متابعة'}</p>
                <p className="text-sm text-muted-foreground">{pd.reason}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded bg-muted text-center">
                  <p className="text-xs text-muted-foreground">الدخول</p>
                  <p className="font-bold">{pd.entry?.price ? pd.entry.price.toFixed(2) : '—'}</p>
                </div>
                <div className="p-3 rounded bg-muted text-center">
                  <p className="text-xs text-muted-foreground">الهدف</p>
                  <p className="font-bold text-emerald-600">{pd.target ? pd.target.toFixed(2) : '—'}</p>
                </div>
                <div className="p-3 rounded bg-muted text-center">
                  <p className="text-xs text-muted-foreground">الوقف</p>
                  <p className="font-bold text-rose-600">{pd.stop ? pd.stop.toFixed(2) : '—'}</p>
                </div>
              </div>
              {pd.conditions && pd.conditions.length > 0 && (
                <div className="space-y-1">
                  <h5 className="text-sm font-semibold">الشروط</h5>
                  <ul className="list-disc list-inside text-sm text-muted-foreground">
                    {pd.conditions.slice(0, 5).map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* P43-VIRAL-SHARE: بطاقة التحليل المخفية (800x600 Telegram-ready) للتصدير كصورة */}
      <div style={{ position: 'absolute', left: '-99999px', top: 0, pointerEvents: 'none' }} aria-hidden>
        <div
          ref={analysisCardRef}
          style={{
            width: '800px',
            minHeight: '600px',
            padding: '0',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            borderRadius: '20px',
            fontFamily: 'Arial, sans-serif',
            direction: 'rtl',
            color: '#f8fafc',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #ea580c, #d97706)',
            padding: '20px 28px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'white', marginBottom: '4px' }}>
                {ticker} · {item.nameAr || item.name || ticker}
              </div>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
                تحليل شامل · المستثمر + المضارب
              </div>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{
                background: 'rgba(255,255,255,0.2)',
                padding: '6px 14px',
                borderRadius: '10px',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '13px',
              }}>
                دليل الاستثمار
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', marginTop: '4px', textAlign: 'left' }} suppressHydrationWarning>
                {new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '24px 28px' }}>
            {/* Price + Change + Verdict */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>السعر وقت التحليل</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fbbf24' }}>
                  {price ? price.toFixed(2) : '—'} <span style={{ fontSize: '14px', color: '#94a3b8' }}>{currencyLabel}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>التغير اليومي</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: changePct >= 0 ? '#10b981' : '#ef4444' }}>
                  {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                </div>
              </div>
              <div style={{
                padding: '8px 18px',
                borderRadius: '12px',
                background: (activePd.verdict || '').includes('شراء') ? 'rgba(16,185,129,0.2)'
                  : (activePd.verdict || '').includes('بيع') ? 'rgba(239,68,68,0.2)'
                  : 'rgba(245,158,11,0.2)',
                color: (activePd.verdict || '').includes('شراء') ? '#10b981'
                  : (activePd.verdict || '').includes('بيع') ? '#ef4444'
                  : '#f59e0b',
                fontWeight: 'bold',
                fontSize: '16px',
              }}>
                {activePd.verdict || 'متابعة'}
              </div>
            </div>

            {/* Entry / Target / Stop grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '18px' }}>
              <div style={{ background: 'rgba(251,191,36,0.1)', padding: '12px', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(251,191,36,0.2)' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>الدخول</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fbbf24' }}>{activePd.entry ? activePd.entry.toFixed(2) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(16,185,129,0.1)', padding: '12px', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(16,185,129,0.2)' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>الهدف</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981' }}>{activePd.target ? activePd.target.toFixed(2) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(239,68,68,0.2)' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>الوقف</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ef4444' }}>{activePd.stop ? activePd.stop.toFixed(2) : '—'}</div>
              </div>
            </div>

            {/* Metrics row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '18px' }}>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>R/R</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>1:{activePd.risk_reward ? activePd.risk_reward.toFixed(1) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>RSI</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{activePd.rsi != null ? activePd.rsi.toFixed(0) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Score</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{activePd.score != null ? activePd.score.toFixed(0) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Gates</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{gates ? `${gates.passed}/5` : '—'}</div>
              </div>
            </div>

            {/* Reason */}
            {activePd.reason && (
              <div style={{
                background: 'rgba(255,255,255,0.05)',
                padding: '12px 16px',
                borderRadius: '10px',
                fontSize: '13px',
                color: '#cbd5e1',
                marginBottom: '14px',
                lineHeight: '1.6',
              }}>
                📝 {activePd.reason}
              </div>
            )}

            {/* Footer links */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(234,88,12,0.15), rgba(217,119,6,0.15))',
              borderRadius: '10px',
              padding: '12px 16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '6px' }}>
                🔗 invist.m2y.net | ✈️ t.me/Arabian_investment_guide
              </div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>
                ⚠️ تعليمي فقط — ليس نصيحة استثمارية
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// P42-NO-FREEZE: ثوابت منع تجميد الشاشة.
// PERSONA_DISPLAY_LIMIT: عدد الأسهم اللي بنحتفظ بيها في الـ state (10).
// PERSONA_PAGE_SIZE: عدد الكروت اللي بتترسم في نفس اللحظة (5) — عشان المتصفح مايموتش.

export function PersonaTab({ market, persona }: { market: MarketType; persona: 'conservative' | 'balanced' | 'gambler' }) {
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor، balanced→gambler كتقريب)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  // cache-bust-force-refresh-20260715
  // RECOMMENDATIONS-FIX-022 (يوليو 2026): default viewMode بقى 'table' عشان
  // المستخدم يشوف الجدول بكل الأعمدة (ticker, name_ar, score, entry, target,
  // stop, R/R, verdict) بدل ما يحتاج يضغط على view selector.
  const [items, setItems] = useState<StoredAnalysisItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'image' | 'cards' | 'table' | 'text'>('table');
  const [usingFallback, setUsingFallback] = useState(false);
  const [dataSource, setDataSource] = useState<'stored' | 'predictions'>('stored');
  const [selectedItem, setSelectedItem] = useState<StoredAnalysisItem | null>(null);
  // ══════ Unified Analysis Modal: السهم المختار لفتح نافذة التحليل الشاملة ══════
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'details' | 'chart' | 'verdict'>('details');
  // P42-NO-FREEZE: ترقيم صفحات الكروت (5 لكل صفحة)
  const [personaPage, setPersonaPage] = useState(0);
  const [stockDetail, setStockDetail] = useState<StockDetail | null>(null);
  // P6-PREDICTIONS: أرشيف التوقعات السابقة (يتم عرضه أسفل الـ PersonaTableView).
  // بيتسحب من نفس /api/unified/predictions تحت مفتاح previous_predictions.
  const [previousPredictions, setPreviousPredictions] = useState<PreviousPrediction[]>([]);
  // C2-SECTOR-HEAT: قطاعات ساخنة/ميتة من الـ backend meta (للـ banner).
  const [sectorHeat, setSectorHeat] = useState<{
    hot?: Array<{ sector: string; avg_chg: number; rising_ratio: number; n: number; boost: number }>;
    dead?: Array<{ sector: string; avg_chg: number; rising_ratio: number; n: number; boost: number }>;
  } | null>(null);
  // CL7-UI-SECTORS: ملخص قطاعي ديناميكي كامل من meta.sectorSummary — لكل قطاع:
  // status, n, avg_chg, rising_ratio, leaders/mids/laggards, top_leader, top_laggard.
  // بيتم عرضه في Section "ذكاء القطاعات" عشان العميل يفهم ليه المنصة اختارت السهم.
  const [sectorSummary, setSectorSummary] = useState<Array<{
    sector: string;
    status: 'hot' | 'dead' | 'neutral';
    n: number;
    avg_chg: number;
    rising_ratio: number;
    boost: number;
    leaders: number;
    mids: number;
    laggards: number;
    top_leader: string | null;
    top_leader_chg: number;
    top_laggard: string | null;
    top_laggard_chg: number;
  }>>([]);

  const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];

  // Unified Analysis Modal: بدل ما نعرض StockDetailPanel داخل الصفحة،
  // نفتح نافذة منبثقة ضخمة فيها كل مكونات التحليل (شارت + DNA + SMC + خطة التداول).
  const handleSelectItem = useCallback((item: StoredAnalysisItem) => {
    setSelectedTicker(item.ticker);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedItem(null);
    setStockDetail(null);
    setSelectedTicker(null);
  }, []);

  useEffect(() => {
    if (!selectedItem) { setStockDetail(null); return; }
    let cancelled = false;
    fetch(`/api/stocks/${selectedItem.ticker}?market=${marketCode}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setStockDetail(d); })
      .catch(() => { if (!cancelled) setStockDetail(null); });
    return () => { cancelled = true; };
  }, [selectedItem, marketCode]);

  useEffect(() => {
    setSelectedItem(null);
    setStockDetail(null);
    setSelectedTicker(null);
    setPersonaPage(0);
  }, [market, persona]);

  // P6-PREDICTIONS: جلب أرشيف التوقعات السابقة من /api/unified/predictions.
  // الـ endpoint بيرجّع previous_predictions كـ list — بنعرضها في تبويب البرسونا
  // عشان المستخدم يشوف أداء التوقعات السابقة جنب التوقعات الحالية.
  // RL-FIX-9: بنمرّر persona للـ API علشان كل تبويب يعرض توقعاته الخاصة
  // (مش نفس الأرشيف لكل التبويبات).
  useEffect(() => {
    let cancelled = false;
    const fetchPrevious = async () => {
      try {
        const res = await fetch(`/api/unified/predictions?market=${marketCode}&limit=100&persona=${persona}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const prev = Array.isArray(data.previous_predictions) ? data.previous_predictions : [];
        // P26: isLongTerm = conservative (أفق طويل) — للـ balanced و gambler نعرض كل التوقعات.
        const isLongTerm = persona === 'conservative' || persona === 'investor';
        // فلترة خفيفة حسب البرسونا:
        // - المستثمر: يهتم بالأسهم الشرائية (BUY/STRONG_BUY/ACCUMULATE/HOLD).
        // - المتوازن/المضارب: يشوف كل التوقعات بما فيها البيع (SELL/STRONG_SELL/REDUCE).
        const investorSignals = new Set(['BUY', 'STRONG_BUY', 'ACCUMULATE', 'HOLD']);
        const filtered = isLongTerm
          ? prev.filter((p: Record<string, unknown>) => investorSignals.has(String(p.signal || '').toUpperCase()))
          : prev;
        setPreviousPredictions(filtered);
      } catch (err) {
        // فشل صامت — الأرشيف مكمّل مش أساسي
        console.warn('[PersonaTab] previous predictions fetch failed', err);
      }
    };
    fetchPrevious();
    // 🔥 P14: polling بيتوقف لو liveMode مش مفعّل (افتراضي).
    const intervalId = setInterval(() => {
      if (!useAnalysisStore.getState().liveMode) return;
      fetchPrevious();
    }, 300_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [marketCode, persona]);

  const fetchPersona = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUsingFallback(false);
    setDataSource('stored');
    handleBack();
    try {
      const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];

      // Check cache first
      const cache = useAnalysisStore.getState();
      if (cache.storedAnalysis && cache.market === marketCode && Date.now() - cache.lastFetched < 300000) {
        const nameMap = await buildNameMap(marketCode);
        // P16-PERSONA-DIVERGENCE: لو الـ cached items فيها fundamentals،
        // نستخدم pickPersonaDiverged (فلترة وترتيب مستقل لكل persona).
        // غير كده، fallback لـ pickPersonaMix (السلوك القديم).
        const hasFundamentals = (cache.storedAnalysis as unknown as StoredAnalysisItem[] | undefined)?.some(
          (it) => it?.fundamentals && (it.fundamentals.is_gambler_opportunity !== undefined || it.fundamentals.is_investor_opportunity !== undefined)
        );
        // P42-NO-FREEZE: cap cached items to 20 before persona sort (bounds client work)
        const cachedCapped = ((cache.storedAnalysis as unknown as StoredAnalysisItem[]) || []).slice(0, 20);
        const filtered = hasFundamentals
          ? pickPersonaDiverged(cachedCapped, persona, PERSONA_DISPLAY_LIMIT)
          : pickPersonaMix(cachedCapped, persona, PERSONA_DISPLAY_LIMIT);
        if (filtered.length > 0) {
          setItems(enrichItems(filtered, nameMap));
          setDataSource('stored');
          setLoading(false);
          return;
        }
      }

      // خريطة الأسماء (لإثراء النتائج بأسماء الأسهم الحقيقية)
      const nameMap = await buildNameMap(marketCode);

      // ═══════════════════════════════════════════════════════
      // PRIMARY: stored-analysis/results — المخزن الذي يُحدَّث كل 15 دقيقة
      // تلقائياً أثناء الجلسة (MarketScheduler.run_daily_closer → generate_predictions_internal)
      // المصدر الأساسي لكل التحليلات والتوقعات
      // ═══════════════════════════════════════════════════════
      try {
        // P16-PERSONA-DIVERGENCE: نمرّر persona param للـ backend عشان يفلتر
        // ويرتّب الأسهم بمنطق مختلف (مضارب: زخم/حجم، مستثمر: أساسيات/قيمة عادلة).
        // الـ backend بيرجّع قوائم مختلفة جذرياً لكل persona بدل ما يرجّع نفس
        // الأسهم بتغيير الـ verdict بس.
        // P42-NO-FREEZE: limit=20 (كان 400) — مفيش فايدة نعمل sort على 400 سهم
        // في المتصفح والمستثمر مش هيفتح 50. محرك التصطاد بيرجّع كام سهم بس.
        const storedRes = await fetch(`/api/stored-analysis/results?market=${marketCode}&limit=20&persona=${persona}`, {
          cache: 'no-store',
        });
        if (storedRes.ok) {
          const storedData = await storedRes.json();
          const all: StoredAnalysisItem[] = storedData.data || [];
          // لو الـ backend طبّق persona filter → الـ items أصلاً مرتبة صح.
          // لو لأ (fallback) → pickPersonaMix بيرتّب محلياً على 20 بس (خفيف).
          const filtered = storedData.meta?.personaFilterApplied
            ? all.slice(0, PERSONA_DISPLAY_LIMIT)
            : pickPersonaMix(all, persona, PERSONA_DISPLAY_LIMIT);
          // C2-SECTOR-HEAT: خد خريطة القطاعات من الـ meta (للـ banner).
          setSectorHeat(storedData.meta?.sectorHeat || null);
          // CL7-UI-SECTORS: خد ملخص القطاعات الكامل من الـ meta (للـ Section).
          setSectorSummary(storedData.meta?.sectorSummary || []);
          if (filtered.length > 0) {
            setItems(enrichItems(filtered, nameMap));
            setDataSource('stored');
            return; // نجح — لا حاجة لـ fallback
          }
        }
      } catch (storedErr) {
        console.warn('[PersonaTab] stored-analysis failed:', storedErr);
      }

      // ═══════════════════════════════════════════════════════
      // P42-NO-FREEZE: تم إزالة الـ fallback لـ /api/sniper/scan نهائياً.
      // كان بيشتغل MasterAnalyzer لحظياً على مجموعة أسهم وبيوقف المتصفح
      // ثواني/دقايق (الـ "تموت"/freeze). الشاشة دي دلوقتي بتعتمد على القراءة
      // فقط (stored-analysis + predictions). لو القاعدتين فاضيين → نعرض
      // "جاري تحليل الفرص، سيتم التحديث خلال دقائق" بدون أي API ثقيل.
      // ═══════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════
      // FALLBACK: unified/predictions (قراءة من DB — مش حسابات لحظية)
      // ═══════════════════════════════════════════════════════
      try {
        const fbRes = await fetch(`/api/unified/predictions?market=${marketCode}&limit=50`, {
          cache: 'no-store',
        });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          const preds: Array<Record<string, unknown>> = Array.isArray(fbData.predictions) ? fbData.predictions : [];
          const mappedPreds = preds.map((p): StoredAnalysisItem | null => {
            const signal = String(p.signal || 'HOLD').toUpperCase();
            const confidence = Number(p.confidence || p.score || 0);
            const reasons: string[] = Array.isArray(p.reasons) ? p.reasons : [];
            // Only show BUY/STRONG_BUY - skip HOLD/SELL
            if (signal !== 'BUY' && signal !== 'STRONG_BUY') return null;
            // P26: isLongTerm = conservative (أفق طويل). balanced و gambler = أفق أقصر.
            const isLongTerm = persona === 'conservative' || persona === 'investor';
            let verdict = isLongTerm ? 'شراء قوي' : 'شراء';
            const personaReason = isLongTerm
              ? `توقع ${signal === 'BUY' ? 'صاعد' : signal === 'SELL' ? 'هابط' : 'متعادل'} — ثقة ${confidence.toFixed(0)}% — مدى متوسط/طويل`
              : `زخم ${signal === 'BUY' ? 'إيجابي' : signal === 'SELL' ? 'سلبي' : 'محايد'} — ثقة ${confidence.toFixed(0)}% — مدى قصير`;
            // P26: _personaKey معرّف على مستوى الـ component (مش محتاجين نعيد تعريفه هنا)
            const pd: PersonaData = {
              verdict,
              score: confidence,
              reason: reasons.length > 0 ? `${personaReason}. ${reasons.slice(0, 2).join(' — ')}` : personaReason,
              conditions: reasons.length > 0 ? reasons.slice(0, 5) : (Array.isArray(p.analysis_methods) ? p.analysis_methods.slice(0, 5) : []),
              entry: p.entry_price !== null && p.entry_price !== undefined ? Number(p.entry_price) : null,
              target: p.target_price !== null && p.target_price !== undefined ? Number(p.target_price) : null,
              stop: p.stop_loss !== null && p.stop_loss !== undefined ? Number(p.stop_loss) : null,
              signal: p.signal,
              timeframe: isLongTerm ? '6-12 شهر' : (persona === 'balanced' ? '2-6 أسابيع' : 'يومي-أسبوعي'),
              fair_value: null,
            };
            return {
              ticker: (p.symbol || p.ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
              market: marketCode,
              name: p.name || p.stock_name || p.name_ar || p.symbol || p.ticker || '',
              nameAr: p.name_ar || p.name || p.stock_name || p.symbol || p.ticker || '',
              logoUrl: p.logo_url || null,
              maestroScore: Number(p.score) || 0,
              confidence,
              recommendation: p.signal,
              recommendationAr: p.signal_ar,
              entry: {
                price: p.entry_price !== null && p.entry_price !== undefined ? Number(p.entry_price) : undefined,
                target: p.target_price !== null && p.target_price !== undefined ? Number(p.target_price) : undefined,
                stopLoss: p.stop_loss !== null && p.stop_loss !== undefined ? Number(p.stop_loss) : undefined,
                riskReward: p.risk_reward !== null && p.risk_reward !== undefined ? Number(p.risk_reward) : undefined,
              },
              updatedAt: p.prediction_date || p.created_at || new Date().toISOString(),
              analysisJson: {
                // P26: استخدم _personaKey (investor للـ conservative، gambler للـ balanced/gambler)
                [_personaKey]: pd,
                narrative: {
                  line1: p.trend_direction ? `الاتجاه: ${p.trend_direction}` : undefined,
                  line2: p.sr_zone ? `منطقة الدعم/المقاومة: ${p.sr_zone}` : undefined,
                  line3: p.regime ? `نظام السوق: ${p.regime}` : undefined,
                },
              },
            } as StoredAnalysisItem;
          });
          const mappedFiltered = mappedPreds.filter((x): x is StoredAnalysisItem => x !== null);
          if (mappedFiltered.length > 0) {
            setItems(enrichItems(mappedFiltered.slice(0, PERSONA_DISPLAY_LIMIT), nameMap));
            setDataSource('predictions');
            setUsingFallback(true);
            return;
          }
        }
      } catch (fbErr) {
        console.error('[PersonaTab] fallback failed', fbErr);
      }

      // لا توجد بيانات من أي مصدر (DB فاضي) → عرض حالة "جاري التحليل"
      // بدون أي API ثقيل (P42-NO-FREEZE).
      setItems([]);
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error('[PersonaTab]', err);
    } finally {
      setLoading(false);
    }
  }, [market, persona]);

  useEffect(() => {
    const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];
    const cache = useAnalysisStore.getState();
    if (cache.storedAnalysis && cache.market === marketCode && Date.now() - cache.lastFetched < 300000) {
      (async () => {
        const nameMap = await buildNameMap(marketCode);
        // P16-PERSONA-DIVERGENCE: استخدم pickPersonaDiverged لو fundamentals موجودة
        const hasFundamentals = (cache.storedAnalysis as unknown as StoredAnalysisItem[] | undefined)?.some(
          (it) => it?.fundamentals && (it.fundamentals.is_gambler_opportunity !== undefined || it.fundamentals.is_investor_opportunity !== undefined)
        );
        // P42-NO-FREEZE: cap cached items to 20 before persona sort (bounds client work)
        const cachedCapped = ((cache.storedAnalysis as unknown as StoredAnalysisItem[]) || []).slice(0, 20);
        const filtered = hasFundamentals
          ? pickPersonaDiverged(cachedCapped, persona, PERSONA_DISPLAY_LIMIT)
          : pickPersonaMix(cachedCapped, persona, PERSONA_DISPLAY_LIMIT);
        if (filtered.length > 0) {
          setItems(enrichItems(filtered, nameMap));
          setDataSource('stored');
          setLoading(false);
        }
      })();
    } else {
      fetchPersona();
    }

    // Auto-refresh recommendations every 5 minutes
    // 🔥 P14: polling بيتوقف لو liveMode مش مفعّل (افتراضي).
    const intervalId = setInterval(() => {
      if (!useAnalysisStore.getState().liveMode) return;
      fetchPersona();
    }, 300_000);

    function onAnalyticsRefreshed() {
      fetchPersona();
    }
    window.addEventListener('analyticsRefreshed', onAnalyticsRefreshed);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('analyticsRefreshed', onAnalyticsRefreshed);
    };
  }, [fetchPersona, market, persona]);

  // P26: isLongTerm = conservative (أفق طويل). balanced & gambler = أفق أقصر.
  const isLongTerm = persona === 'conservative' || persona === 'investor';
  // P42-NO-FREEZE: ترقيم الصفحات — نرسم 5 كروت بس في كل لحظة عشان المتصفح مايموتش
  const personaTotalPages = Math.max(1, Math.ceil(items.length / PERSONA_PAGE_SIZE));
  const personaPageItems = items.slice(personaPage * PERSONA_PAGE_SIZE, (personaPage + 1) * PERSONA_PAGE_SIZE);
  // P26: ألوان/عناوين 3 شخصيات — 🛡️ مستثمر / ⚖️ متوازن / 🎯 مضارب
  const headerTheme = isLongTerm
    ? { emoji: '🛡️', title: 'المستثمر', subtitle: 'فرص طويلة المدى — محرك التصطاد يختار الأسهم اللي تناسبك (6-12 شهر)', accent: 'text-emerald-700 dark:text-emerald-400' }
    : persona === 'balanced'
    ? { emoji: '⚖️', title: 'المتوازن', subtitle: 'فرص متوسطة المدى — توازن بين الزخم والقيمة (2-6 أسابيع)', accent: 'text-amber-700 dark:text-amber-400' }
    : { emoji: '🎯', title: 'المضارب', subtitle: 'فرص قصيرة المدى — محرك التصطاد يصطاد الزخم والسيولة والارتداد (يومي-أسبوعي)', accent: 'text-fuchsia-700 dark:text-fuchsia-400' };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchPersona}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <span className="text-4xl mb-3 block">{headerTheme.emoji}</span>
          <p className="text-lg font-semibold mb-1">جاري تحليل الفرص — سيتم التحديث خلال دقائق</p>
          <p className="text-sm text-muted-foreground mb-4">
            {isLongTerm
              ? 'محرك المستثمر بيدوّر على فرص تناسب الشخصية طويلة المدى (6-12 شهر). البيانات بتتحدث كل 15 دقيقة تلقائياً — مفيش تحليل لحظي على الشاشة دي.'
              : persona === 'balanced'
              ? 'محرك المتوازن بيدوّر على فرص متوسطة المدى (2-6 أسابيع). البيانات بتتحدث كل 15 دقيقة تلقائياً — مفيش تحليل لحظي على الشاشة دي.'
              : 'محرك المضارب بيدوّر على فرص زخم قصيرة المدى (يومي-أسبوعي). البيانات بتتحدث كل 15 دقيقة تلقائياً — مفيش تحليل لحظي على الشاشة دي.'}
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={fetchPersona}>
              <RefreshCw className="h-4 w-4 ml-2" />
              تحديث الآن
            </Button>
            <a
              href="https://invist.m2y.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              invist.m2y.net
            </a>
          </div>
        </CardContent>
      </Card>
    );
  }

  const viewSelector = (
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/40">
        {([['image', 'صورة'], ['cards', 'كروت'], ['table', 'جدول'], ['text', 'نص']] as const).map(([m, l]) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={cn(
              'px-3 py-1 text-xs rounded font-medium transition-colors',
              viewMode === m ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <RefreshAnalyticsButton variant="glow" size="sm" onRefreshed={fetchPersona} />
        {items.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => {
              const text = formatAllPersonaPicksText(items, persona, market);
              navigator.clipboard.writeText(text);
              toast.success('تم نسخ جميع التوقعات ✓');
            }}>
              <Copy className="h-3.5 w-3.5" />
              نسخ الكل
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
              const text = formatAllPersonaPicksText(items, persona, market);
              if (navigator.share) {
                try { await navigator.share({ title: `توقعات ${headerTheme.title}`, text }); } catch {}
              } else {
                navigator.clipboard.writeText(text);
                toast.success('تم نسخ جميع التوقعات ✓');
              }
            }}>
              <Share2 className="h-3.5 w-3.5" />
              مشاركة
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {selectedItem ? (
        <StockDetailPanel
          item={selectedItem}
          persona={persona}
          market={market}
          subTab={subTab}
          onSubTabChange={setSubTab}
          onBack={handleBack}
          stockDetail={stockDetail}
        />
      ) : (
        <>
          {viewSelector}
          {/* ملاحظة وضع الـ fallback (predictions فقط — sniper اتشال في P42) */}
          {usingFallback && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800">
          <CardContent className="p-2.5 flex items-center gap-2 text-xs">
            <Info className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <p className="text-amber-800 dark:text-amber-300">
              {dataSource === 'predictions'
                ? `التحليل المخزن غير متوفر بعد، نعرض أحدث التوقعات (${items.length} سهم). سيتم تحديث التحليل المخزن تلقائياً.`
                : `التحليل المخزن غير متوفر لهذا السوق (${items.length} سهم).`
              }
            </p>
          </CardContent>
        </Card>
      )}

      {/* C2-SECTOR-HEAT: banner القطاعات السخنة (للمضارب فقط) — بيظهر لما في قطاع
          سخن (avg_chg≥1% AND ≥60% صاعد). ده الـ "sector rotation" اللي المفروض
          المضارب يركز عليه. المستثمر مش بيشوف الـ banner ده. */}
      {persona === 'gambler' && sectorHeat && sectorHeat.hot && sectorHeat.hot.length > 0 && (
        <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800">
          <CardContent className="p-2.5 flex items-start gap-2 text-xs">
            <span className="text-base flex-shrink-0">🔥</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-orange-800 dark:text-orange-300 mb-1">
                قطاعات ساخنة — دوران قطاعي إيجابي
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sectorHeat.hot.slice(0, 4).map((s) => (
                  <span
                    key={s.sector}
                    className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-900/40 dark:text-orange-400 dark:border-orange-700 whitespace-nowrap"
                    title={`avg change ${s.avg_chg.toFixed(2)}% — ${Math.round(s.rising_ratio * 100)}% صاعد — ${s.n} سهم — boost +${Math.round(s.boost * 100)}%`}
                  >
                    {s.sector} <span className="opacity-70">+{s.avg_chg.toFixed(1)}%</span>
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-1 opacity-80">
                أسهم هذه القطاعات حصلت على +{Math.round((sectorHeat.hot[0]?.boost || 0.15) * 100)}% boost في ترتيب المضارب
              </p>
            </div>
          </CardContent>
        </Card>
      )}



      {/* بطاقة البرسونا القابلة للمشاركة (تحميل صورة / نشر تيليجرام) */}
      {viewMode === 'image' && (
      <ImageCardExport
        title={`بطاقة ${headerTheme.title}`}
        description="حمّل صورة جاهزة للنشر أو انشرها مباشرة على قناة تيليجرام"
        filename={`${persona}-picks-${MARKET_CODES[market]}`}
        telegramCaption={`📊 ${headerTheme.emoji} ${headerTheme.title} — ${MARKET_NAMES_AR[market]}\n${headerTheme.subtitle}\n\nمنصة دليل الاستثمار | invist.m2y.net`}
        telegramMarket={MARKET_CODES[market]}
        // P26: 3 persona themes — emerald للمحافظ، amber للمتوازن، fuchsia للمغامر
        accentColor={isLongTerm ? '#15803d' : (persona === 'balanced' ? '#d97706' : '#a21caf')}
        borderClass={isLongTerm ? 'border-emerald-200' : (persona === 'balanced' ? 'border-amber-200' : 'border-fuchsia-200')}
        bgClass={
          isLongTerm
            ? 'bg-gradient-to-br from-emerald-50 via-teal-50/40 to-emerald-100/40'
            : persona === 'balanced'
            ? 'bg-gradient-to-br from-amber-50 via-yellow-50/40 to-amber-100/40'
            : 'bg-gradient-to-br from-fuchsia-50 via-pink-50/40 to-fuchsia-100/40'
        }
        hasData={items.length > 0}
        emptyHint={
          isLongTerm
            ? 'محرك التصطاد لسه بيدور على فرص تناسب المستثمر.'
            : persona === 'balanced'
            ? 'محرك التصطاد لسه بيدور على فرص تناسب المتوازن.'
            : 'محرك التصطاد لسه بيدور على فرص تناسب المضارب.'
        }
      >
        {(ref) => {
          const picks: PersonaPick[] = items.map((it) => {
            // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
            const pd: PersonaData = it.analysisJson?.[_personaKey] || {
              verdict: it.recommendationAr || '',
              score: it.maestroScore || 0,
              reason: '',
              signal: it.recommendation || 'HOLD',
              entry: it.entry?.price ?? null,
              target: it.entry?.target ?? null,
              stop: it.entry?.stopLoss ?? null,
              timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
            };
            return {
              ticker: it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
              name_ar: it.nameAr || it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
              verdict: pd.verdict,
              score: pd.score,
              reason: pd.reason,
              conditions: pd.conditions,
              entry: pd.entry,
              target: pd.target,
              stop: pd.stop,
              timeframe: pd.timeframe,
              fair_value: pd.fair_value,
            };
          });
          return (
            <PersonaImageCard
              ref={ref}
              market={market}
              // P26: PersonaImageCard بيقبل 'investor'|'gambler' بس — مرّرله المفتاح المظبوط
              persona={_personaKey}
              picks={picks}
              lastUpdate={items[0]?.updatedAt ? new Date(items[0].updatedAt).toLocaleTimeString('ar-EG') : undefined}
            />
          );
        }}
      </ImageCardExport>
      )}

      {/* رأس التاب */}
      <Card className={cn('border-l-4', isLongTerm ? 'border-l-emerald-500' : (persona === 'balanced' ? 'border-l-amber-500' : 'border-l-fuchsia-500'))}>
        <CardContent className="p-3 flex items-center gap-3">
          <span className="text-3xl">{headerTheme.emoji}</span>
          <div>
            <h3 className={cn('text-lg font-bold', headerTheme.accent)}>{headerTheme.title}</h3>
            <p className="text-xs text-muted-foreground">{headerTheme.subtitle}</p>
          </div>
          <Badge variant="secondary" className="mr-auto">{items.length} سهم</Badge>
        </CardContent>
      </Card>

      {/* ═══ P21-PERSONA-CONSTRAINTS (Aug 2026): HOLD Banner for Conservative ═══
          لما تبقى إشارات كلها HOLD في تبويب المستثمر، اعرض رسالة واضحة فوق الكروت
          عشان العميل يفهم إن دي حماية لرأس المال، مش "منصة ميتة".
          المضارب لازم يبدأ يعرض توقعات الشراء اللحظية (بعد تعديل الباك-إند). */}
      {isLongTerm && (() => {
        const holdItems = items.filter((it) => {
          // P26: استخدم _personaKey (investor للـ conservative) بدل ما نظبظبط 'investor'
          const pd = it.analysisJson?.[_personaKey] || {};
          const sig = String(pd.signal || pd.verdict || '').toUpperCase();
          return sig.includes('HOLD') || sig.includes('انتظر') || sig.includes('ابعد');
        });
        const holdRatio = items.length > 0 ? holdItems.length / items.length : 0;
        if (holdRatio >= 0.6) {
          return (
            <Card className="border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800">
              <CardContent className="p-3 flex items-start gap-2.5">
                <span className="text-xl flex-shrink-0 mt-0.5">🛡️</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200 mb-0.5">
                    وضع السوق الحالي لا يناسب الاستثمار طويل المدى
                  </p>
                  <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    التوقعات الحالية للانتظار والحفاظ على رأس المال ({holdItems.length} من {items.length} سهم).
                    لو عايز فرص شراء يومية/أسبوعية، حوّل لتبويب المضارب 🎯 — السهم اللي مش فرصة استثمار ممكن يكون فرصة مضاربة.
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        }
        return null;
      })()}

      {/* قائمة الكروت */}
      {viewMode === 'cards' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {personaPageItems.map((it) => {
          // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
          const personaData: PersonaData = it.analysisJson?.[_personaKey] || {
            verdict: it.recommendationAr || '',
            score: it.maestroScore || 0,
            reason: '',
            signal: it.recommendation || 'HOLD',
            entry: it.entry?.price ?? null,
            target: it.entry?.target ?? null,
            stop: it.entry?.stopLoss ?? null,
            timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
          };
          return (
            <PersonaCard
              key={`${it.ticker}-${persona}`}
              ticker={it.ticker}
              persona={persona}
              data={personaData}
              maestroScore={it.maestroScore}
              updatedAt={it.updatedAt}
              narrative={it.analysisJson?.narrative}
              market={market}
              nameAr={it.nameAr}
              logoUrl={it.logoUrl}
              fundamentals={it.fundamentals}
              onClick={() => handleSelectItem(it)}
            />
          );
        })}
      </div>
      )}

      {/* عرض الجدول */}
      {viewMode === 'table' && (
         <PersonaTableView items={personaPageItems} persona={persona} market={market} onSelectItem={handleSelectItem} />
      )}

      {/* عرض النص المنسق للمشاركة */}
      {viewMode === 'text' && (
        <div className="space-y-3">
          {personaPageItems.map((it, idx) => {
            // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
            const pd: PersonaData = it.analysisJson?.[_personaKey] || {
              verdict: it.recommendationAr || '',
              score: it.maestroScore || 0,
              reason: '',
              signal: it.recommendation || 'HOLD',
              entry: it.entry?.price ?? null,
              target: it.entry?.target ?? null,
              stop: it.entry?.stopLoss ?? null,
              timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
            };
            const ticker = it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
            const singleText = formatSinglePersonaPickText(it, persona, market);
            return (
              <Card key={`txt-${ticker}`} className="border border-border cursor-pointer" onClick={() => handleSelectItem(it)}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold">{ticker} - {it.nameAr || it.name}</span>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(singleText);
                          toast.success('تم نسخ التحليل ✓');
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        نسخ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (navigator.share) {
                            try { await navigator.share({ title: `تحليل ${ticker}`, text: singleText }); } catch {}
                          } else {
                            navigator.clipboard.writeText(singleText);
                            toast.success('تم نسخ التحليل ✓');
                          }
                        }}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        مشاركة
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs border-teal-400 text-teal-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                        onClick={() => {
                          navigator.clipboard.writeText(singleText);
                          window.open('https://www.facebook.com/', '_blank');
                          toast.success('تم نسخ التحليل وجاري فتح فيسبوك لصق المنشور 💙');
                        }}
                      >
                        <Facebook className="h-3.5 w-3.5" />
                        فيسبوك
                      </Button>
                    </div>
                  </div>
                  <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground/90" dir="rtl">
                    {singleText}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* P42-NO-FREEZE: ترقيم الصفحات — 5 كروت لكل صفحة عشان المتصفح مايموتش */}
      {personaTotalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={personaPage === 0}
            onClick={() => setPersonaPage((p) => Math.max(0, p - 1))}
          >
            <ArrowRight className="h-4 w-4" />
            السابق
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums px-2">
            {personaPage + 1} / {personaTotalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={personaPage >= personaTotalPages - 1}
            onClick={() => setPersonaPage((p) => Math.min(personaTotalPages - 1, p + 1))}
          >
            التالي
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* P6-PREDICTIONS: أرشيف التوقعات السابقة — اتنقل هنا من التبويب العام */}
      <PreviousPredictionsArchive
        predictions={previousPredictions}
        title="التوقعات السابقة"
      />
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          🪟 نافذة التحليل الشامل (Unified Analysis Modal)
          بدل ما المستهم يتنقل لصفحة جديدة، نفتح Dialog ضخمة فوق الشاشة
          فيها كل مكونات التحليل: الشارت التفاعلي + بصمة السهم (Stock DNA)
          + تحليل الحيتان (SMC) + توقع الشمعة (Candle Probability) + خطة التداول.
          نعيد استخدام SingleStockAnalysisView الموجود بالفعل وتمرير ticker فقط.
          ════════════════════════════════════════════════════════════════════ */}
      <Dialog
        open={!!selectedTicker}
        onOpenChange={(open) => { if (!open) setSelectedTicker(null); }}
      >
        <DialogContent
          className="max-w-[95vw] sm:max-w-[95vw] w-full h-[90vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg"
          showCloseButton={false}
        >
          {/* ─── Sticky Header — يظل ثابتاً أثناء التمرير للأسفل ─── */}
          <div className="flex items-center justify-between gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2.5 flex-shrink-0 z-10">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                <BarChart3 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-sm md:text-base font-bold truncate">
                  نافذة التحليل الشامل
                </DialogTitle>
                {selectedTicker && (
                  <p className="text-[11px] md:text-xs text-muted-foreground truncate">
                    {selectedTicker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '')} — الشارت • بصمة السهم • SMC • خطة التداول
                  </p>
                )}
              </div>
            </div>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0 h-9 w-9 rounded-full hover:bg-muted"
                aria-label="إغلاق نافذة التحليل"
              >
                <X className="h-5 w-5" />
              </Button>
            </DialogClose>
          </div>

          {/* ─── Scrollable Body — SingleStockAnalysisView يحتوي على كل المكونات ─── */}
          <div className="flex-1 overflow-y-auto p-3 md:p-4 bg-muted/10">
            {selectedTicker && (
              <SingleStockAnalysisViewDynamic
                key={selectedTicker}
                initialTicker={selectedTicker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '')}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Crypto Predictions Tab (BTC + ETH from CryptoLabScheduler)
// ============================================================================


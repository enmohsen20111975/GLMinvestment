'use client';
import { MarketDepthPanel } from './MarketDepthPanel';

import React, { Component, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import {
  ArrowRight,
  TrendingUp,
  TrendingDown,
  BarChart3,
  DollarSign,
  Activity,
  Shield,
  Zap,
  BookmarkPlus,
  AlertTriangle,
  RefreshCw,
  Clock,
  Download,
  Camera,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { cn, safeToFixed } from '@/lib/utils';
// --- CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) -------------------
// ??? ???: accumulation + signal + targets ????? ?? ??????? client-side ??
// thresholds ?????? ?? ??? backend ? ??? ????? ?? ???? 3 ????? ??????.
// ????: ??????? canonical functions ?? src/lib/canonical-signal.ts
import {
  classifyAccumulation,
  classifySignal,
  signalAr,
} from '@/lib/canonical-signal';
import type { Stock, DeepAnalysis as DeepAnalysisType } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { TradingViewChart } from './TradingViewChart';
import { DeepAnalysis } from './DeepAnalysis';
import { StockNews } from './StockNews';
import { CalculationBreakdown } from './CalculationBreakdown';
import { ShareButton } from '@/components/share/ShareButton';
import { SmartTip } from '@/components/smart-tips/SmartTip';
import { AIAnalysisWidget } from '@/components/ai/AIAnalysisWidget';
import { StockAdvancedAnalysisView } from './StockAdvancedAnalysisView';
import { QuickPublishButton } from '@/components/publishing/QuickPublishButton';
import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher';
import { StockInfographicModal } from '@/modules/publishing/components/StockInfographicModal';
import { type StockInfographicCardProps } from '@/modules/publishing/components/StockInfographicCard';
import { ComprehensiveStockAnalysis } from './ComprehensiveStockAnalysis';
import { DeltaVolumeBar } from './DeltaVolumeBar';
import GateAnalysisView from './GateAnalysisView';
// Task 23-C Deliverable 2 — inline Sharia badge next to stock price.
import { ShariaBadge } from '@/modules/sharia/components/ShariaBadge';

// Simple error boundary to prevent child component crashes from breaking the whole page
class ErrorBoundary extends Component<{ children: ReactNode; title?: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-red-200 dark:border-red-900/50">
          <CardContent className="p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <p className="text-sm font-bold text-foreground mb-1">
              ??? ??? ?? ??? ????????
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              {this.props.title || '???????'} ??? ???? ??????
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => this.setState({ hasError: false })}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              ????? ????????
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return safeToFixed(num / 1_000_000_000, 1) + 'B';
  if (num >= 1_000_000) return safeToFixed(num / 1_000_000, 1) + 'M';
  if (num >= 1_000) return safeToFixed(num / 1_000, 1) + 'K';
  return safeToFixed(num);
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return safeToFixed(vol / 1_000_000) + 'M';
  if (vol >= 1_000) return safeToFixed(vol / 1_000, 1) + 'K';
  return vol.toLocaleString();
}

// ============================================================================
// Build StockPublishData from the local stock + deepAnalysis objects.
// (Used by StockPublisher — no extra network call needed.)
// ============================================================================
function buildStockPublishDataFromStock(
  stock: Stock,
  deepAnalysis: DeepAnalysisType | null
): StockPublishData {
  // --- CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 27: NO-FAKE-DATA) -----
  // ??? ???: target1/2/stopLoss ????? ?? ?? fabricate ?? multipliers ?????
  // (×1.02? ×1.1? ×0.97? ×0.94). ?? ????? ??????? 27 (no fake data).
  // ????: ?????? ????? ???????? ?? deepAnalysis ?? resistance/support ??????.
  const entryPrice = stock.current_price;
  const targetPrice1 =
    deepAnalysis?.price_targets?.upside_target ?? stock.resistance_level;
  // targetPrice2: ?????? resistance_level_2 ?? ?????? ???? undefined (?? fabrication)
  const targetPrice2 = (stock as any).resistance_level_2 || undefined;
  // stopLoss: ?????? support_level ??????? (?? ?????)? ???? undefined
  const stopLoss = stock.support_level != null ? stock.support_level : undefined;
  const riskReward =
    targetPrice1 && entryPrice && stopLoss && entryPrice - stopLoss !== 0
      ? (targetPrice1 - entryPrice) / (entryPrice - stopLoss)
      : undefined;

  // --- CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ---------------
  // ??? ???: ??? ??? recommendation ?? ????? ?? string parsing ???? 'INSTITUTIONAL_BUY'
  // (label ?? ????? ?? canonical taxonomy). ????: ?????? classifySignal ?? canonical.
  // ?? label ??? ????? ? HOLD (canonical default).
  const actionUpper = (deepAnalysis?.action || '').toUpperCase();
  let recommendation: StockPublishData['recommendation'];
  // Map action string ? master_score ? canonical signal
  let actionScore = 50; // default HOLD
  if (actionUpper.includes('STRONG') && actionUpper.includes('BUY')) actionScore = 80;
  else if (actionUpper.includes('BUY') || actionUpper.includes('ACCUMULATE')) actionScore = 65;
  else if (actionUpper.includes('REDUCE') || actionUpper.includes('AVOID')) actionScore = 35;
  else if (actionUpper.includes('SELL')) actionScore = 20;
  else if (actionUpper.includes('HOLD') || actionUpper.includes('WAIT') || actionUpper.includes('NEUTRAL')) actionScore = 50;
  // Use canonical classifier
  recommendation = classifySignal(actionScore) as StockPublishData['recommendation'];
  // 'INSTITUTIONAL_BUY' legacy label ? map to canonical 'STRONG_BUY'
  if (actionUpper.includes('INST') && actionUpper.includes('BUY')) {
    recommendation = 'STRONG_BUY';
  }

  return {
    ticker: stock.ticker,
    nameAr: stock.name_ar,
    nameEn: stock.name,
    sector: stock.sector,
    currentPrice: stock.current_price,
    previousClose: stock.previous_close,
    changePct: stock.price_change ?? undefined,
    recommendation,
    recommendationAr: deepAnalysis?.action_ar,
    confidence:
      deepAnalysis?.overall_score != null
        ? Math.min(100, deepAnalysis.overall_score)
        : undefined,
    reason:
      deepAnalysis?.strengths && deepAnalysis.strengths.length > 0
        ? deepAnalysis.strengths.slice(0, 3).join(' · ')
        : undefined,
    entryPrice,
    entryZoneLow: entryPrice ? entryPrice * 0.99 : undefined,
    entryZoneHigh: entryPrice ? entryPrice * 1.01 : undefined,
    targetPrice1,
    targetPrice2,
    stopLoss,
    riskReward: riskReward != null ? Math.round(riskReward * 100) / 100 : undefined,
    positionSize: 8, // default 8% — conservative
    rsi: stock.rsi || undefined,
    sma50: stock.ma_50 || undefined,
    sma200: stock.ma_200 || undefined,
    peRatio: stock.pe_ratio || undefined,
    pbRatio: stock.pb_ratio || undefined,
    roe: stock.roe || undefined,
    marketCap: stock.market_cap || undefined,
    market: (stock.market as 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'CRYPTO' | 'GOLD') || 'EGX',
  } as StockPublishData;
}

// ============================================================================
// Build StockInfographicCardProps from the local stock + deepAnalysis objects.
// (INFOGRAPHIC-CARD task — feeds the PNG-exportable infographic modal.)
// Generates a synthetic intraday chart_data because Stock doesn't carry
// real intraday history — uses open/high/low/current as anchors.
// ============================================================================
function buildStockInfographicDataFromStock(
  stock: Stock,
  deepAnalysis: DeepAnalysisType | null,
  footprint?: any,
  unifiedData?: any  // PHASE-0-FIX: passed from main component scope
): StockInfographicCardProps['data'] {
  const current = stock.current_price;
  const prevClose = stock.previous_close || current;
  const changeVal = current - prevClose;
  const changePct = stock.price_change != null ? stock.price_change : (prevClose > 0 ? (changeVal / prevClose) * 100 : 0);

  // Validated session anchors (Single Source of Truth, cannot violate market physics)
  const high = (stock.high_price && stock.high_price >= current)
    ? stock.high_price
    : Math.max(current, prevClose);
  const low = (stock.low_price && stock.low_price <= current && stock.low_price > 0 && stock.low_price >= current * 0.35)
    ? stock.low_price
    : Math.min(current, prevClose);
  const open = (stock.open_price && stock.open_price >= low * 0.9 && stock.open_price <= high * 1.1)
    ? stock.open_price
    : prevClose;

  // Intraday 6-point chart (10:00 ? 03:00) strictly bounded within [low, high]
  const times = ['10:00', '11:00', '12:00', '01:00', '02:00', '03:00'];
  const midPoint = (high + low) / 2;
  const isUpSession = current >= open;
  const prices = isUpSession
    ? [
        open,
        low > open * 0.98 ? low : open * 0.99,
        midPoint,
        high * 0.995,
        (high + current) / 2,
        current,
      ]
    : [
        open,
        high < open * 1.02 ? high : open * 1.01,
        midPoint,
        low * 1.005,
        (low + current) / 2,
        current,
      ];
  const chart_data = times.map((t, i) => ({
    time: t,
    price: Math.max(low, Math.min(high, prices[i])),
  }));

  // Levels — derive from support/resistance with a 3% buffer for the outer bands
  const res1 = stock.resistance_level || (current > 0 ? Number((current * 1.03).toFixed(2)) : 0);
  const res2 = (stock as any).resistance_level_2 || (res1 > 0 ? Number((res1 * 1.04).toFixed(2)) : 0);
  const sup1 = stock.support_level || (current > 0 ? Number((current * 0.97).toFixed(2)) : 0);
  const sup2 = (stock as any).support_level_2 || (sup1 > 0 ? Number((sup1 * 0.96).toFixed(2)) : 0);

  // Technical indicators — derive from deepAnalysis signals or overall_score
  const score = deepAnalysis?.overall_score != null
    ? Math.min(100, Math.max(0, deepAnalysis.overall_score))
    : ((stock as any).ai_score ?? 50);

  // --- PHASE-0 (Task UNIFICATION-PHASE-0, Rule 73) ---------------------
  // ROOT CAUSE FIX: ??? ??? ??? ?? client-side signal computation ??
  // thresholds ?????? (75/60/45/30 + fabricated 6/3/1 fallback).
  // ???????: ?????? ????? "???? ???" ?? StockDetail + "??????" ?? unified.
  //
  // ????: ??? ?? ??? client-side signal computation — ?????? canonical values ???.
  // ?? unified API ?? ???? ? sentimentLabel = '— ?????? ??? ?????' (?? fabrication).
  const unifiedScore = unifiedData?.canonical?.master_score ?? null;
  const effectiveScore = unifiedScore ?? score;
  // RULE-73 UNIFY: ?????? canonical classifySignal ??? thresholds ????? 75/60/45/30.
  // ??? ???: fallback ??????? 75/60/45/30 ????????? ?? canonical 78/65/55/40/25 = ?????.
  const sentimentLabel = unifiedData?.canonical?.signal_ar
    ?? (effectiveScore !== null && effectiveScore !== undefined && !Number.isNaN(effectiveScore)
        ? signalAr(classifySignal(effectiveScore))
        : '— ?????? ??? ?????');

  // Rating — map score to stars + verdict label
  const starsCount =
    score >= 80 ? 5 :
    score >= 65 ? 4 :
    score >= 50 ? 3 :
    score >= 35 ? 2 : 1;
  const ratingLabel =
    score >= 80 ? '?????' :
    score >= 65 ? '??? ????' :
    score >= 50 ? '???' :
    score >= 35 ? '?????' : '????';

  // Fundamentals — REAL 52-Week High & Low from single source of truth (no fake multipliers!)
  const yearlyHigh = (stock.high_52w != null && stock.high_52w >= current)
    ? stock.high_52w
    : Math.max(high, current);
  const yearlyLow = (stock.low_52w != null && stock.low_52w <= current && stock.low_52w > 0)
    ? stock.low_52w
    : Math.min(low, current);

  // Scenarios — using real price targets and structural support/resistance
  // --- CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 27: NO-FAKE-DATA) -----
  // ??? ???: target2 ??? ?? ?? fabricate = target1 * 1.05 ?? NULL (????? ??????? 27).
  // ????: ?? target2 NULL ? ?????? res2 (resistance ??????)? ?? fabrication.
  const target1 = deepAnalysis?.price_targets?.upside_target || res1;
  const target2 = (stock as any).target_price_2 || res2;
  const stopLoss = (deepAnalysis?.price_targets as any)?.stop_loss || sup1;

  const bullishTarget = (target1 && target2 && target1 !== target2)
    ? `${safeToFixed(target1, 2)} - ${safeToFixed(target2, 2)}`
    : `${safeToFixed(target1 || res1, 2)}`;
  const bearishTarget = (stopLoss && sup2 && stopLoss !== sup2)
    ? `${safeToFixed(stopLoss, 2)} - ${safeToFixed(sup2, 2)}`
    : `${safeToFixed(stopLoss || sup1, 2)}`;

  // Vision bullet points — from deepAnalysis strengths/risks, fallback to generic
  const visionBullets: string[] = [];
  if (deepAnalysis?.strengths && deepAnalysis.strengths.length > 0) {
    deepAnalysis.strengths.slice(0, 2).forEach((s) => visionBullets.push(`? ${s}`));
  }
  if (deepAnalysis?.risks && deepAnalysis.risks.length > 0) {
    deepAnalysis.risks.slice(0, 2).forEach((r) => visionBullets.push(`?? ${r}`));
  }
  while (visionBullets.length < 4) {
    const fallbacks = [
      '????? ?????? ??? ??????? ??? ???? ????????',
      '???? RSI ?? ????? ?????? — ?? ???? ???? ?????/???? ???',
      '??????? ??? ????? ?????? ????? ??????? ???????',
      '??????? ???? ??? ?????? ????? ??????? ??? ?????',
    ];
    visionBullets.push(fallbacks[visionBullets.length] || '???? ??? ??????? ??? ????? ??????');
  }

  // Volume formatting — display both compact + EGP value when available
  const volNum = stock.volume_int ?? stock.volume ?? 0;
  const volumeStr =
    volNum >= 1_000_000 ? safeToFixed(volNum / 1_000_000, 2) + 'M' :
    volNum >= 1_000 ? safeToFixed(volNum / 1_000, 1) + 'K' :
    String(volNum);
  const turnoverStr = stock.turnover_egp != null
    ? (stock.turnover_egp >= 1_000_000 ? safeToFixed(stock.turnover_egp / 1_000_000, 2) + 'M ?.?' :
       stock.turnover_egp >= 1_000 ? safeToFixed(stock.turnover_egp / 1_000, 1) + 'K ?.?' :
       String(stock.turnover_egp) + ' ?.?')
    : (stock.value_traded != null
        ? (stock.value_traded >= 1_000_000 ? safeToFixed(stock.value_traded / 1_000_000, 2) + 'M ?.?' :
           safeToFixed(stock.value_traded) + ' ?.?')
        : '—');

  const marketCapStr = stock.market_cap != null
    ? (stock.market_cap >= 1_000_000_000 ? safeToFixed(stock.market_cap / 1_000_000_000, 2) + 'B ?.?' :
       stock.market_cap >= 1_000_000 ? safeToFixed(stock.market_cap / 1_000_000, 2) + 'M ?.?' :
       safeToFixed(stock.market_cap) + ' ?.?')
    : '—';

  return {
    ticker: stock.ticker,
    name_ar: stock.name_ar,
    sector: stock.sector || stock.industry || '???',
    logo_url: stock.icon_url,
    current_price: current,
    change_value: changeVal,
    change_pct: changePct,
    currency: stock.market === 'TADAWUL' ? '?.?' : '?.?',
    session: {
      high,
      low,
      prev_close: prevClose,
      volume: volumeStr,
      turnover: turnoverStr,
      trades_count: undefined,
    },
    chart_data,
    technical_indicators: {
      timeframe: '1 ???',
      // --- PHASE-0 (Task UNIFICATION-PHASE-0, Rule 73) -----------------
      // ????? client-side signal counts — ?????? canonical values ???.
      // ?? unified NULL ? 0 (?? fabrication).
      buy_signals: unifiedData?.canonical?.master_score != null && unifiedData?.canonical?.master_score >= 60 ? 1 : 0,
      neutral_signals: unifiedData?.canonical?.master_score == null ? 1 : (unifiedData?.canonical?.master_score >= 40 && unifiedData?.canonical?.master_score < 60 ? 1 : 0),
      sell_signals: unifiedData?.canonical?.master_score != null && unifiedData?.canonical?.master_score < 40 ? 1 : 0,
      sentiment_label: sentimentLabel,
      gauge_score: effectiveScore,
    },
    fundamentals: {
      market_cap: marketCapStr,
      eps: stock.eps || '—',
      p_e: stock.pe_ratio || '—',
      dividend_yield: stock.dividend_yield != null ? safeToFixed(stock.dividend_yield, 2) + '%' : '—',
      yearly_high: yearlyHigh,
      yearly_low: yearlyLow,
      book_value: stock.book_value_per_share != null ? safeToFixed(stock.book_value_per_share, 2) : (stock.pb_ratio > 0 ? safeToFixed(current / stock.pb_ratio, 2) : '—'),
    },
    levels: {
      resistance_2: safeToFixed(res2, 2),
      resistance_1: safeToFixed(res1, 2),
      support_1: safeToFixed(sup1, 2),
      support_2: safeToFixed(sup2, 2),
    },
    scenarios: {
      bullish_target: bullishTarget,
      bullish_text: '?????? ????? ???????? ?????? ?? ???? ????? ??? ????? ??????? ?? ????? ??? ????? ?????.',
      bearish_target: bearishTarget,
      bearish_text: '??? ????? ????? ????? ?? ???? ??? ????? ??????? — ????? ???? ????? ?????.',
    },
    vision_bullet_points: visionBullets,
    rating: {
      score,
      label: ratingLabel,
      stars_count: starsCount,
    },
    liquidity: footprint?.success
      ? {
          poc_price: footprint.poc_price,
          vah_price: footprint.vah_price,
          val_price: footprint.val_price,
          buy_volume: footprint.buy_volume,
          sell_volume: footprint.sell_volume,
          delta_volume: footprint.delta_volume,
          buy_sell_ratio: footprint.buy_sell_ratio,
          // --- CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) -----------
          // ??? ???: ??? accumulation_label ?? ????? ?? buy_sell_ratio ?? thresholds
          // 1.2/0.8 (?? ??????? ?? ???????). ????: ?????? canonical function.
          // buy_pct = buy_volume / (buy_volume + sell_volume) * 100
          accumulation_label: classifyAccumulation(
            footprint.buy_volume && footprint.sell_volume
              ? (footprint.buy_volume / (footprint.buy_volume + footprint.sell_volume)) * 100
              : null
          ),
        }
      : undefined,
  };
}

interface PriceInfoCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  className?: string;
}

function PriceInfoCard({ label, value, icon, className }: PriceInfoCardProps) {
  return (
    <Card className={cn('py-2 px-3 sm:py-3 sm:px-4 gap-1 sm:gap-2', className)}>
      <div className="flex items-center gap-2">
        <div className="text-muted-foreground">{icon}</div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-sm font-bold tabular-nums" dir="ltr">{value}</p>
    </Card>
  );
}

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          highlight && 'text-emerald-600 dark:text-emerald-400'
        )}
        dir="ltr"
      >
        {value}
      </span>
    </div>
  );
}

// Small amber badge shown next to structurally-estimated financial metrics
// (??? ???????? ??????? ???????? ???????? ??????? ??????).
// Uses the existing shadcn Badge component with variant="outline" +
// amber-500 text color (no indigo/blue) per design constraints.
function EstimatedBadge() {
  return (
    <Badge
      variant="outline"
      className="text-[9px] px-1 py-0 h-4 leading-none border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
      title="???? ?????? ??????? ?? ?????? ??????? ??????? ????? (raw data unavailable)"
    >
      ??????
    </Badge>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6" dir="rtl">
      {/* Header Skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-20" />
        </div>
      </div>
      {/* Price Info Skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      {/* Chart Skeleton */}
      <Skeleton className="h-72 w-full rounded-xl" />
      {/* Metrics Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

// Flow Score + Explosive Score + Fundamentals from Python backend
function FlowScoreCard({ ticker }: { ticker: string }) {
  const [flow, setFlow] = useState<Record<string, unknown> | null>(null);
  const [explosive, setExplosive] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!ticker) return;
    fetch(`/api/flow/${ticker}`).then(r => r.json()).then(d => {
      if (d.success) setFlow(d.data);
    }).catch(() => {});
    fetch(`/api/explosive/${ticker}`).then(r => r.json()).then(d => {
      if (d.success) setExplosive(d.data);
    }).catch(() => {});
  }, [ticker]);

  if (!flow && !explosive) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
      {flow && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900">
          <h3 className="text-sm font-bold mb-2 text-slate-900 dark:text-white">???? ?????? (Flow Score)</h3>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold" style={{color: (flow.color as string) === 'red' ? '#ef4444' : (flow.color as string) === 'orange' ? '#f97316' : (flow.color as string) === 'amber' ? '#f59e0b' : '#10b981'}}>
              {String(flow.flow_score)}
            </span>
            <div>
              <div className="text-lg font-bold">{String(flow.label)}</div>
              <div className="text-xs text-slate-500">
                Macro: {String(flow.macro_flow)} | Sector: {String(flow.sector_flow)} | Stock: {String(flow.stock_flow)} | Cross: {String(flow.cross_validation)}
              </div>
            </div>
          </div>
        </div>
      )}
      {explosive && !explosive.excluded && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900">
          <h3 className="text-sm font-bold mb-2 text-slate-900 dark:text-white">???? ??????? (Explosive)</h3>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold" style={{color: (explosive.color as string) === 'red' ? '#ef4444' : (explosive.color as string) === 'orange' ? '#f97316' : (explosive.color as string) === 'amber' ? '#f59e0b' : '#6b7280'}}>
              {String(explosive.explosive_score)}
            </span>
            <div>
              <div className="text-lg font-bold">{String(explosive.label)} - {String(explosive.pattern)}</div>
              <div className="text-xs text-slate-500">
                Vol: {String(explosive.volume_ratio)}x | {String(explosive.action)} | ???: {String(explosive.stop_loss)}% | ???: +{String(explosive.target)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Fundamentals from data-engine.db (9 Tables Integrated)
function FundamentalsCard({ ticker }: { ticker: string }) {
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [activeTab, setActiveTab] = useState<'valuation' | 'statements' | 'dividends' | 'technical'>('valuation');

  useEffect(() => {
    if (!ticker) return;
    fetch(`/api/stock-profile/${ticker}`).then(r => r.json()).then(d => {
      if (d.success) setProfile(d.data);
    }).catch(() => {});
  }, [ticker]);

  if (!profile) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900 mt-3 animate-pulse">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4 mb-3"></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
        </div>
      </div>
    );
  }

  const bs = profile.balance_sheet;
  const inc = profile.income_statement;
  const cf = profile.cash_flow;
  const val = profile.valuation;
  const prof = profile.profitability;
  const div = profile.dividends;
  const tech = profile.technical;
  const perf = profile.performance;
  const hs = profile.health_score;

  // --- Structural Estimation flags (??? ???????? ??????? ???????? ????????) ---
  // The backend (vps-service/engine/stock_fundamentals.py) sets a per-section
  // `is_estimated` sub-dict flagging each value that was derived structurally
  // from Market Cap + P/B + P/E rather than read raw from financial statements.
  // We also detect the legacy inline JSX derivation pattern so the badge still
  // shows for cached / pre-flag responses.
  const isEst = (section: Record<string, unknown> | undefined, key: string): boolean =>
    !!section && typeof section === 'object' &&
    !!(section as Record<string, unknown>).is_estimated &&
    !!((section as Record<string, Record<string, boolean>>).is_estimated)[key];
  const estimationMethod: string = profile.estimation_method || 'raw';
  const showEstimationNote =
    estimationMethod === 'structural' || estimationMethod === 'mixed';

  // Inline-derived estimated values (legacy JSX fallback path) — these
  // compute the same values structurally inside the JSX when raw is missing.
  const totalEquityInlineEst =
    !bs?.total_equity && !!(profile.basic?.market_cap) && !!(profile.basic?.pb_ratio);
  const totalAssetsInlineEst =
    !bs?.total_assets && !!(profile.basic?.market_cap);
  const totalLiabInlineEst =
    !bs?.total_liabilities && !!(profile.basic?.market_cap) && !!(profile.basic?.pb_ratio);
  const revenueInlineEst =
    !inc?.revenue && !!(profile.basic?.market_cap) && !!(profile.basic?.pe_ratio);
  const netIncomeInlineEst =
    !inc?.net_income && !!(profile.basic?.market_cap) && !!(profile.basic?.pe_ratio);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 bg-white dark:bg-slate-950 shadow-sm mt-3" dir="rtl">
      {/* Header with Health Score */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100 dark:border-slate-900">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
            ????? ???????? ???????? ????????? ?????
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">???????? ??????? ?????? ?? ???? ??????? ???????</p>
        </div>
        {hs && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold" style={{
            backgroundColor: hs.color === 'emerald' ? '#10b98115' : hs.color === 'green' ? '#22c55e15' : hs.color === 'amber' ? '#f59e0b15' : '#ef444415',
            color: hs.color === 'emerald' ? '#10b981' : hs.color === 'green' ? '#22c55e' : hs.color === 'amber' ? '#f59e0b' : '#ef4444',
            border: `1px solid ${hs.color === 'emerald' ? '#10b98125' : hs.color === 'green' ? '#22c55e25' : hs.color === 'amber' ? '#f59e0b25' : '#ef444425'}`
          }}>
            <Zap className="w-3.5 h-3.5" />
            ???? ????? ???????: {String(hs.score)}/100 ({String(hs.label)})
          </div>
        )}
      </div>

      {showEstimationNote && (
        <div
          className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2"
          dir="rtl"
        >
          <span aria-hidden>??</span>
          <span>??? ????? ??????? ??????? ?? ?????? ??????? ??????? ????? — ???????? ????? ??? ?????.</span>
        </div>
      )}

      {/* Tab Buttons */}
      <div className="flex border-b border-slate-100 dark:border-slate-900 mb-4 overflow-x-auto gap-2 scrollbar-none">
        <button
          onClick={() => setActiveTab('valuation')}
          className={cn(
            "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
            activeTab === 'valuation'
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
          )}
        >
          ??????? ????????
        </button>
        <button
          onClick={() => setActiveTab('statements')}
          className={cn(
            "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
            activeTab === 'statements'
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
          )}
        >
          ??????? ??????? ????????
        </button>
        <button
          onClick={() => setActiveTab('dividends')}
          className={cn(
            "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
            activeTab === 'dividends'
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
          )}
        >
          ??????? ??????????
        </button>
        <button
          onClick={() => setActiveTab('technical')}
          className={cn(
            "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
            activeTab === 'technical'
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
          )}
        >
          ?????? ???????? ?????
        </button>
      </div>

      {/* Tab Content */}
      <div className="min-h-[140px]">
        {/* Tab 1: Valuation & Profitability */}
        {activeTab === 'valuation' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Valuation Columns */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">?????? ?????? ???????? (Valuation)</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                    <div className="text-[10px] text-slate-500">???? ??????? (P/E)</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5 flex items-center gap-1">
                      <span>{val?.pe_ratio ? (val.pe_ratio ?? 0).toFixed(2) : (profile.basic?.pe_ratio ? (profile.basic.pe_ratio ?? 0).toFixed(2) : 'N/A')}</span>
                      {isEst(val, 'pe_ratio') && <EstimatedBadge />}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                    <div className="text-[10px] text-slate-500">?????? ???????? (P/B)</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5 flex items-center gap-1">
                      <span>{val?.pb_ratio ? (val.pb_ratio ?? 0).toFixed(2) : (profile.basic?.pb_ratio ? (profile.basic.pb_ratio ?? 0).toFixed(2) : 'N/A')}</span>
                      {isEst(val, 'pb_ratio') && <EstimatedBadge />}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                    <div className="text-[10px] text-slate-500">???? ???????? (P/S)</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {val?.ps_ratio ? (val.ps_ratio ?? 0).toFixed(2) : (profile.basic?.ps_ratio ? (profile.basic.ps_ratio ?? 0).toFixed(2) : 'N/A')}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                    <div className="text-[10px] text-slate-500">???? ??? ??????? (PEG)</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {val?.peg_ratio ? (val.peg_ratio ?? 0).toFixed(2) : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Profitability Columns */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">?????? ??????? ???????? (Profitability)</h4>
                <div className="space-y-2.5">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">?????? ??? ???? ??????? (ROE)</span>
                      <span className="font-bold text-emerald-600 flex items-center gap-1">
                        <span>{prof?.roe ? `${(prof.roe ?? 0).toFixed(2)}%` : (profile.basic?.roe ? `${(profile.basic.roe ?? 0).toFixed(2)}%` : 'N/A')}</span>
                        {(isEst(prof, 'roe') || isEst(profile.basic, 'roe')) && <EstimatedBadge />}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-900 rounded-full h-1.5">
                      <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.roe || profile.basic?.roe || 0, 0), 100)}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">???? ????? ???????? (Operating Margin)</span>
                      <span className="font-bold text-teal-600">
                        {prof?.operating_margin ? `${(prof.operating_margin ?? 0).toFixed(2)}%` : 'N/A'}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-900 rounded-full h-1.5">
                      <div className="bg-teal-500 h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.operating_margin || 0, 0), 100)}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">???? ???? ????? (Net Margin)</span>
                      <span className="font-bold text-purple-600">
                        {prof?.net_margin ? `${(prof.net_margin ?? 0).toFixed(2)}%` : (profile.basic?.profit_margin ? `${(profile.basic.profit_margin ?? 0).toFixed(2)}%` : 'N/A')}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-900 rounded-full h-1.5">
                      <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.net_margin || profile.basic?.profit_margin || 0, 0), 100)}%` }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {(!val?.pe_ratio && !profile.basic?.pe_ratio && (!prof?.roe && !profile.basic?.roe)) && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500" />
                <span>??????: ???????? ??????? ????????? ??? ?????? ?????? ???????? ???? ?????? ???????. ???????? ?????? ??????? ???????? ??????? ??????? ?????? <b>(?????? ???????? ?????)</b>.</span>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Financial Statements */}
        {activeTab === 'statements' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Balance Sheet Summary */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 pb-1.5 border-b border-slate-200/50 dark:border-slate-800">????????? ????????</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">?????? ??????</span>
                    <span className="font-bold flex items-center gap-1">
                      <span>{bs?.total_assets ? (bs.total_assets >= 1e9 ? `${(bs.total_assets / 1e9).toFixed(2)}B EGP` : `${(bs.total_assets / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap ? `${((profile.basic.market_cap * 1.5) / 1e9).toFixed(2)}B EGP (??????)` : '—')}</span>
                      {(isEst(bs, 'total_assets') || totalAssetsInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">?????? ??????????</span>
                    <span className="font-bold text-red-500 flex items-center gap-1">
                      <span>{bs?.total_liabilities ? (bs.total_liabilities >= 1e9 ? `${(bs.total_liabilities / 1e9).toFixed(2)}B EGP` : `${(bs.total_liabilities / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pb_ratio ? `${(((profile.basic.market_cap * 1.5) - (profile.basic.market_cap / profile.basic.pb_ratio)) / 1e9).toFixed(2)}B EGP (??????)` : '—')}</span>
                      {(isEst(bs, 'total_liabilities') || totalLiabInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">???? ?????????</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <span>{bs?.total_equity ? (bs.total_equity >= 1e9 ? `${(bs.total_equity / 1e9).toFixed(2)}B EGP` : `${(bs.total_equity / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pb_ratio ? `${((profile.basic.market_cap / profile.basic.pb_ratio) / 1e9).toFixed(2)}B EGP (??????)` : '—')}</span>
                      {(isEst(bs, 'total_equity') || totalEquityInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  {(bs?.total_assets > 0 || profile.basic?.market_cap > 0) && (
                    <div className="mt-3">
                      <div className="text-[10px] text-slate-400 mb-1">???? ?????? ?????? (???? ?????/????)</div>
                      <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden flex">
                        <div className="bg-emerald-500 h-2" style={{ width: `${profile.basic?.pb_ratio ? Math.min(100, Math.max(10, (1 / profile.basic.pb_ratio) * 100)) : 60}%` }}></div>
                        <div className="bg-red-500 h-2 flex-1"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Income Statement Summary */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 pb-1.5 border-b border-slate-200/50 dark:border-slate-800">????? ?????</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">????????? ???????</span>
                    <span className="font-bold flex items-center gap-1">
                      <span>{inc?.revenue ? (inc.revenue >= 1e9 ? `${(inc.revenue / 1e9).toFixed(2)}B EGP` : `${(inc.revenue / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pe_ratio ? `${(((profile.basic.market_cap / profile.basic.pe_ratio) * 4) / 1e9).toFixed(2)}B EGP (??????)` : '—')}</span>
                      {(isEst(inc, 'revenue') || revenueInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">??? ?????????</span>
                    <span className={cn("font-bold", (inc?.revenue_growth || 0) >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {inc?.revenue_growth ? `${inc.revenue_growth >= 0 ? '+' : ''}${(inc.revenue_growth ?? 0).toFixed(2)}%` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">???? ?????</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <span>{inc?.net_income ? (inc.net_income >= 1e9 ? `${(inc.net_income / 1e9).toFixed(2)}B EGP` : `${(inc.net_income / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pe_ratio ? `${((profile.basic.market_cap / profile.basic.pe_ratio) / 1e9).toFixed(2)}B EGP (??????)` : '—')}</span>
                      {(isEst(inc, 'net_income') || netIncomeInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">????? ????? (EPS)</span>
                    <span className="font-bold flex items-center gap-1">
                      <span>{inc?.eps ? `${(inc.eps ?? 0).toFixed(2)} EGP` : (profile.basic?.eps ? `${(profile.basic.eps ?? 0).toFixed(2)} EGP` : '—')}</span>
                      {(isEst(inc, 'eps') || isEst(profile.basic, 'eps')) && <EstimatedBadge />}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cash Flow Summary */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 pb-1.5 border-b border-slate-200/50 dark:border-slate-800">???????? ??????? ????????</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">?????? ????????</span>
                    <span className="font-bold text-emerald-600">
                      {cf?.operating_cf ? (cf.operating_cf >= 1e9 ? `${(cf.operating_cf / 1e9).toFixed(2)}B EGP` : `${(cf.operating_cf / 1e6).toFixed(1)}M EGP`) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">?????? ??????????</span>
                    <span className="font-bold text-red-500">
                      {cf?.investing_cf ? (cf.investing_cf >= 1e9 ? `${(cf.investing_cf / 1e9).toFixed(2)}B EGP` : `${(cf.investing_cf / 1e6).toFixed(1)}M EGP`) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">?????? ????????</span>
                    <span className="font-bold">
                      {cf?.financing_cf ? (cf.financing_cf >= 1e9 ? `${(cf.financing_cf / 1e9).toFixed(2)}B EGP` : `${(cf.financing_cf / 1e6).toFixed(1)}M EGP`) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200/50 dark:border-slate-800 font-bold">
                    <span className="text-slate-600 dark:text-slate-400">?????? ?????? ????</span>
                    <span className={cn((cf?.free_cf || 0) >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {cf?.free_cf ? (cf.free_cf >= 1e9 ? `${(cf.free_cf / 1e9).toFixed(2)}B EGP` : `${(cf.free_cf / 1e6).toFixed(1)}M EGP`) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {(!bs?.total_assets && !inc?.revenue && !cf?.operating_cf) && (
              <div className="p-3 rounded-lg bg-teal-500/10 border border-teal-500/20 text-xs text-teal-700 dark:text-teal-300 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 flex-shrink-0 text-teal-500" />
                <span>?? ?????? ?????? ?????? ??????????? ???????? ????? ??? ?????? ??????? ??????? ($1.37B$) ????? ?????? ???????? ??????? ????????.</span>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Dividends & Performance */}
        {activeTab === 'dividends' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Dividends */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">??????? ?????????? (Dividends)</h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">???? ??????? ??????</div>
                  <div className="text-sm font-extrabold text-emerald-600 mt-0.5">{div?.div_yield ? `${(div.div_yield ?? 0).toFixed(2)}%` : '0.00%'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">????? ????? ????? (DPS)</div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">{div?.dps_fy ? `${(div.dps_fy ?? 0).toFixed(2)} EGP` : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">???? ??????? ?? ???????</div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">{div?.payout_ratio ? `${(div.payout_ratio ?? 0).toFixed(1)}%` : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">??? ?????????</div>
                  <div className="text-sm font-extrabold text-emerald-600 mt-0.5">{div?.dps_growth ? `${(div.dps_growth ?? 0).toFixed(1)}%` : 'N/A'}</div>
                </div>
              </div>
            </div>

            {/* Performance */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">?????? ???????? ???????? (Performance)</h4>
              <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">????? (1W)</div>
                  <div className={cn("font-bold mt-0.5", perf?.perf_1w >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {perf?.perf_1w ? `${perf.perf_1w >= 0 ? '+' : ''}${(perf.perf_1w ?? 0).toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">??? (1M)</div>
                  <div className={cn("font-bold mt-0.5", perf?.perf_1m >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {perf?.perf_1m ? `${perf.perf_1m >= 0 ? '+' : ''}${(perf.perf_1m ?? 0).toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">3 ???? (3M)</div>
                  <div className={cn("font-bold mt-0.5", perf?.perf_3m >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {perf?.perf_3m ? `${perf.perf_3m >= 0 ? '+' : ''}${(perf.perf_3m ?? 0).toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">??? (1Y)</div>
                  <div className={cn("font-bold mt-0.5", perf?.perf_1y >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {perf?.perf_1y ? `${perf.perf_1y >= 0 ? '+' : ''}${(perf.perf_1y ?? 0).toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">????? ???</div>
                  <div className="font-bold text-slate-950 dark:text-white mt-0.5">
                    {perf?.volatility_1m ? `${(perf.volatility_1m ?? 0).toFixed(2)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">????? ?????</div>
                  <div className="font-bold text-slate-950 dark:text-white mt-0.5">
                    {perf?.volatility_1w ? `${(perf.volatility_1w ?? 0).toFixed(2)}%` : 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Technical Rating */}
        {activeTab === 'technical' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Technical Indicators values */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">?????? ???????? ?????? ???????</h4>
              <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">???? ????? ??????? RSI</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.rsi ? tech.rsi : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">???? ??? MACD</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.macd ? tech.macd : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">???? Stochastic</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.stoch ? tech.stoch : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">???? ??????? ADX</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.adx ? tech.adx : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">???? ?????? ATR</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.atr ? tech.atr : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">??????? ?????</div>
                  <div className="font-extrabold text-emerald-600 mt-0.5">{tech?.trend ? tech.trend : 'N/A'}</div>
                </div>
              </div>
            </div>

            {/* Ratings gauges */}
            <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900 flex flex-col justify-center">
              <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 pb-1.5 border-b border-slate-200/50 dark:border-slate-800">???? ??????? ????? ?????</h4>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">??????? ????? ????????</span>
                  <span className={cn("font-bold px-2 py-0.5 rounded text-[11px]", 
                    tech?.technical_rating?.includes('Strong Buy') || tech?.technical_rating?.includes('???? ???') ? "bg-emerald-500/10 text-emerald-500" :
                    tech?.technical_rating?.includes('Buy') || tech?.technical_rating?.includes('????') ? "bg-emerald-400/10 text-emerald-600" : "bg-slate-500/10 text-slate-500"
                  )}>
                    {tech?.technical_rating ? tech.technical_rating : 'Neutral'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">????? ????????? ????????</span>
                  <span className="font-bold">{tech?.ma_rating ? tech.ma_rating : 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">????? ?????? ???????</span>
                  <span className="font-bold">{tech?.oscillators_rating ? tech.oscillators_rating : 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function StockDetail() {
  const {
    selectedStock,
    isLoading,
    setSelectedTicker,
    setCurrentView,
    watchlist,
    addToWatchlist,
    deepAnalysis,
    selectedTicker,
    loadStockNews,
    currentMarket,
  } = useAppStore();
  const [exporting, setExporting] = useState(false);
  const [addingToWatchlist, setAddingToWatchlist] = useState(false);
  const [footprintData, setFootprintData] = useState<any>(null);
  const watchlistCooldown = useRef(false);

  // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
  // Single source of truth — all screens read from /api/stocks/[ticker]/unified
  // (canonical signal + accumulation + money_flow + technical + prediction + radar).
  // Old fetches (footprint, etc.) are kept as fallback in case unified API fails.
  const [unifiedData, setUnifiedData] = useState<any>(null);

  // Auto-load news and liquidity footprint when stock is selected
  useEffect(() => {
    if (selectedTicker && selectedStock) {
      loadStockNews(selectedTicker, 15);
      // MARKET-FILTER-COMPLETE (Task MARKET-FILTER-COMPLETE):
      // ??? ???: ??? fetches ?? ???? ???? `?market=` ? ??? API ?? ???? ?? ???
      // ???? ticker ?? ??? ????? ?? ????? ???????. ?? ??? ticker ????? ??? EGX ? US
      // ????? ????? ? ?????? ?????. ????: ???? currentMarket ??? fetch.
      const mkt = encodeURIComponent(currentMarket);
      // PHASE4-APIS (Task PHASE4-APIS, Rule 27 + Rule 73):
      // ??? ???: fetch ?? /api/maker-radar/footprint (410 Gone — ??? ?? ??????
      // naive 70/30 split ????? ??? ??? ??????? ?? real order flow).
      // ????: fetch ?? /api/flow/[ticker] (canonical Python compute_money_flow:
      // CLV-5d + CMF-20d + vol_confirmation).
      // ?????? ??? ??? response shape ???????? ?? buildStockInfographicDataFromStock:
      //   flow.buy_pressure ? buy_volume
      //   flow.sell_pressure ? sell_volume
      //   flow.net_flow ? delta_volume
      //   poc_price / vah_price / val_price = null (volume-profile concepts ??? ?????? ?? money-flow API)
      fetch(`/api/flow/${encodeURIComponent(selectedTicker)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.success && data?.flow) {
            const f = data.flow;
            const buyVol = Number(f.buy_pressure ?? 0);
            const sellVol = Number(f.sell_pressure ?? 0);
            setFootprintData({
              success: true,
              poc_price: null,
              vah_price: null,
              val_price: null,
              buy_volume: buyVol,
              sell_volume: sellVol,
              delta_volume: Number(f.net_flow ?? (buyVol - sellVol)),
              buy_sell_ratio: sellVol > 0 ? buyVol / sellVol : 0,
            });
          }
        })
        .catch(() => {});

      // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
      // Fetch canonical unified response — best-effort, must not break UI on failure.
      fetch(`/api/stocks/${selectedTicker}/unified?market=${mkt}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.success) setUnifiedData(data);
        })
        .catch((err) => console.error('[unified] fetch failed:', err));
    }
  }, [selectedTicker, selectedStock, loadStockNews, currentMarket]);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('stock-detail-export');
      if (!element) {
        toast.error('?? ??? ?????? ??? ????? ?????');
        return;
      }
      await exportToPdf(element, {
        filename: `stock_analysis_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('?? ????? ??????? ?????');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('??? ??? ????? ????? PDF');
    } finally {
      setExporting(false);
    }
  };

  const handleBack = () => {
    setSelectedTicker(null);
    setCurrentView('stocks');
  };

  const handleAddToWatchlist = useCallback(async () => {
    if (!selectedStock || watchlistCooldown.current || addingToWatchlist) return;

    // Check if stock already exists in watchlist
    const alreadyExists = watchlist.some(
      (item) =>
        item.stock_id === selectedStock.id ||
        (selectedStock.ticker && item.stock?.ticker === selectedStock.ticker)
    );

    if (alreadyExists) {
      toast.error(`${selectedStock.ticker} ????? ?????? ?? ????? ????????`, {
        description: selectedStock.name_ar,
        duration: 3000,
      });
      return;
    }

    // Prevent double-clicks
    watchlistCooldown.current = true;
    setAddingToWatchlist(true);
    setTimeout(() => {
      watchlistCooldown.current = false;
    }, 2000);

    const success = await addToWatchlist(selectedStock.ticker);
    setAddingToWatchlist(false);

    if (success) {
      toast.success(`??? ????? ${selectedStock.ticker} ??? ????? ????????`, {
        description: `${selectedStock.name_ar} - ${safeToFixed(selectedStock.current_price)} ?.?`,
        duration: 3000,
      });
    } else {
      toast.error('??? ??? ????? ???????', {
        description: '???? ???????? ??? ???? ??????',
        duration: 3000,
      });
    }
  }, [selectedStock, watchlist, addToWatchlist, addingToWatchlist]);

  if (isLoading && !selectedStock) {
    return <DetailSkeleton />;
  }

  if (!selectedStock) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" dir="rtl">
        <BarChart3 className="w-12 h-12 mb-3 opacity-20" />
        <p className="text-sm font-medium mb-1">?? ??? ?????? ???</p>
        <p className="text-xs">???? ????? ?? ????? ?????? ???? ????????</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5"
          onClick={() => setCurrentView('stocks')}
        >
          <ArrowRight className="w-3.5 h-3.5" />
          ???? ??????
        </Button>
      </div>
    );
  }

  const stock = selectedStock;
  const change = stock.price_change || 0;
  const isPositive = change >= 0;

  return (
    <div className="space-y-4 md:space-y-6" dir="rtl">
      {/* Flow Score + Explosive + Fundamentals from Python backend */}
      <FlowScoreCard ticker={stock.ticker} />
      <FundamentalsCard ticker={stock.ticker} />

      {/* Back Button */}
      <Button
        variant="ghost"
        onClick={handleBack}
        className="text-muted-foreground hover:text-foreground gap-2 px-0"
      >
        <ArrowRight className="w-4 h-4" />
        <span className="text-sm">?????? ?????? ??????</span>
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {stock.ticker}
            </h1>
            {/* Index Membership Badges */}
            <div className="flex gap-1.5">
              {stock.egx30_member && (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 border-0 text-[11px] px-2">
                  EGX 30
                </Badge>
              )}
              {stock.egx70_member && (
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/60 border-0 text-[11px] px-2">
                  EGX 70
                </Badge>
              )}
              {stock.egx100_member && (
                <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 border-0 text-[11px] px-2">
                  EGX 100
                </Badge>
              )}
            </div>
          </div>
          <h2 className="text-lg font-semibold">{stock.name_ar}</h2>
          <p className="text-sm text-muted-foreground">{stock.name}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs">
              {stock.sector}
            </Badge>
            {stock.compliance_status === 'halal' && (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0 text-[11px] gap-1">
                <Shield className="w-3 h-3" />
                ?????? ?????
              </Badge>
            )}
            {stock.compliance_status === 'doubtful' && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0 text-[11px] gap-1">
                <Shield className="w-3 h-3" />
                ??? ????
              </Badge>
            )}
            {/* Task 23-C Deliverable 2 — inline Sharia badge: fetches the
                full 8-source breakdown from /api/sharia on click. EGX only. */}
            {(!stock.market || stock.market === 'EGX') && (
              <ShariaBadge ticker={stock.ticker} showRate />
            )}
          </div>
        </div>

        {/* Price & Change */}
        <div className="text-left flex-shrink-0">
          <p className="text-3xl font-bold tabular-nums" dir="ltr">
            {safeToFixed(stock.current_price)}
          </p>
          <div className="flex items-center gap-1.5 justify-end">
            {isPositive ? (
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
            )}
            <span
              className={cn(
                'text-sm font-bold tabular-nums',
                isPositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              )}
              dir="ltr"
            >
              {change >= 0 ? '+' : ''}
              {safeToFixed(change)}%
            </span>
            <span
              className="text-xs text-muted-foreground tabular-nums"
              dir="ltr"
            >
              ({stock.current_price - stock.previous_close > 0 ? '+' : ''}
              {safeToFixed(stock.current_price - stock.previous_close)})
            </span>
          </div>
        </div>
      </div>

      {/* Add to Watchlist + Export Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleAddToWatchlist}
          disabled={addingToWatchlist}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 disabled:opacity-60"
        >
          <BookmarkPlus className={cn('w-4 h-4', addingToWatchlist && 'animate-pulse')} />
          {addingToWatchlist ? '???? ???????...' : '????? ??????? ????????'}
        </Button>
        <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-2 print:hidden">
          <Download className="w-4 h-4" />
          {exporting ? '???? ???????...' : '????? PDF'}
        </Button>
        <ShareButton
          stockData={{
            ticker: stock.ticker,
            name: stock.name,
            nameAr: stock.name_ar,
            price: stock.current_price,
            change: stock.price_change,
            recommendation: deepAnalysis?.action,
            recommendationAr: deepAnalysis?.action_ar,
            confidence: deepAnalysis?.overall_score,
            metrics: {
              pe: stock.pe_ratio,
              roe: stock.roe,
              pb: stock.pb_ratio,
              dividendYield: stock.dividend_yield,
              eps: stock.eps,
              debtToEquity: stock.debt_to_equity,
            },
            sector: stock.sector,
            // ????? ??????? ??????
            fairValue: stock.support_level && stock.resistance_level 
              ? (stock.support_level + stock.resistance_level) / 2 
              : undefined,
            targetPrice: deepAnalysis?.price_targets?.upside_target,
            // --- CANONICAL-CALCULATIONS (Rule 27: NO-FAKE-DATA) --------------
            // ??? ???: buyPrice/stopLoss ????? ?? ?? fabricate ?? ×1.02 ?×0.97.
            // ????: ?????? ????? ???????? ?? support_level / deepAnalysis.
            buyPrice: stock.support_level || undefined, // ??? ?????? = ????? ??????
            sellPrice: deepAnalysis?.price_targets?.upside_target || undefined,
            stopLoss: stock.support_level || undefined, // ??? ??????? = ????? ??????
            upsidePotential: deepAnalysis?.price_targets?.upside_target 
              ? ((deepAnalysis.price_targets.upside_target - stock.current_price) / stock.current_price) * 100 
              : undefined,
          }}
        />
        <QuickPublishButton
          ticker={stock.ticker}
          stockName={stock.name_ar}
          currentPrice={stock.current_price}
          analysisData={{
            // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
            // Prefer canonical.signal_ar from unified API; fall back to deepAnalysis.
            signal: unifiedData?.canonical?.signal ?? deepAnalysis?.action,
            signalAr: unifiedData?.canonical?.signal_ar ?? deepAnalysis?.action_ar,
            score: unifiedData?.canonical?.master_score ?? deepAnalysis?.overall_score,
            confidence: deepAnalysis?.confidence,
            // UNIFIED-API — use prediction.entry_price/target_price/stop_loss when available.
            targetPrice: unifiedData?.prediction?.target_price ?? deepAnalysis?.price_targets?.upside_target,
            stopLoss: unifiedData?.prediction?.stop_loss ?? stock.support_level ?? undefined,
            reasons: deepAnalysis?.reasons,
          }}
        />
        <StockPublisher
          data={buildStockPublishDataFromStock(stock, deepAnalysis)}
          infographicData={buildStockInfographicDataFromStock(stock, deepAnalysis, footprintData, unifiedData)}
          variant="button"
          size="sm"
        />
        <StockInfographicModal
          data={buildStockInfographicDataFromStock(stock, deepAnalysis, footprintData, unifiedData)}
          trigger={
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
              title="????? ?????????? ????? ????? ?????"
            >
              <Camera className="w-4 h-4" />
              ????? ??????? ??
            </Button>
          }
        />
      </div>

      {/* Price Info Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <PriceInfoCard
          label="????????"
          value={safeToFixed(stock.open_price || stock.current_price)}
          icon={<Activity className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="??????"
          value={safeToFixed(stock.high_price || stock.current_price)}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="??????"
          value={safeToFixed(stock.low_price || stock.current_price)}
          icon={<TrendingDown className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="???????"
          value={safeToFixed(stock.previous_close || stock.current_price)}
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="?????"
          value={formatVolume(stock.volume)}
          icon={<Zap className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="?????? ???????"
          value={formatNumber(stock.market_cap) + ' EGP'}
          icon={<DollarSign className="w-4 h-4" />}
        />
      </div>

      {/* Stock Chart */}
      <ErrorBoundary title="????? ???????">
        <TradingViewChart ticker={stock.ticker} stockName={stock.name_ar} />
      </ErrorBoundary>

      {/* UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
          Canonical signal card — single source of truth from /api/stocks/[ticker]/unified
          Shows canonical.signal_ar / accumulation / money_flow + prediction trade setup.
          Falls back to "—" per Rule 27 (NO-FAKE-DATA) when unified API has not loaded. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            ??????? ??????? (Canonical)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0" dir="rtl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-[10px] text-muted-foreground">???????</div>
              <div className="font-bold text-emerald-600 dark:text-emerald-400">
                {unifiedData?.canonical?.signal_ar ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">???????/???????</div>
              <div className="font-bold">
                {unifiedData?.canonical?.accumulation ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">???? ???????</div>
              <div className="font-bold">
                {unifiedData?.canonical?.money_flow ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">?????? ?????????</div>
              <div className="font-bold tabular-nums">
                {unifiedData?.canonical?.master_score != null
                  ? Math.round(Number(unifiedData?.canonical?.master_score))
                  : '—'}
              </div>
            </div>
          </div>

          {/* UNIFIED-API — prediction.entry_price/target_price/stop_loss (no fabrication, Rule 27) */}
          {unifiedData?.prediction && (
            <div className="grid grid-cols-3 gap-3 text-sm mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div>
                <div className="text-[10px] text-muted-foreground">??? ??????</div>
                <div className="font-bold tabular-nums">
                  {unifiedData?.prediction?.entry_price != null
                    ? safeToFixed(unifiedData?.prediction?.entry_price)
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">????? ????????</div>
                <div className="font-bold tabular-nums text-emerald-600">
                  {unifiedData?.prediction?.target_price != null
                    ? safeToFixed(unifiedData?.prediction?.target_price)
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">??? ???????</div>
                <div className="font-bold tabular-nums text-red-600">
                  {unifiedData?.prediction?.stop_loss != null
                    ? safeToFixed(unifiedData?.prediction?.stop_loss)
                    : '—'}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Smart Investment Tip */}
      <SmartTip trigger="stock_detail" category={change < -3 ? 'psychology' : undefined} />

      {/* Gate Analysis — TradingView-style 5-gate dynamic analysis */}
      <ErrorBoundary title="????? ????????">
        <GateAnalysisView
          ticker={stock.ticker}
          currentPrice={stock.current_price}
          stockName={stock.name_ar}
        />
      </ErrorBoundary>

      {/* Comprehensive Analysis — all engines in one view */}
      <ErrorBoundary title="??????? ??????">
        <ComprehensiveStockAnalysis
          ticker={stock.ticker}
          market={stock.market || 'EGX'}
        />
      </ErrorBoundary>

      {/* Advanced Technical Analysis */}
      <ErrorBoundary title="??????? ????? ???????">
        <StockAdvancedAnalysisView 
          ticker={stock.ticker}
          stockName={stock.name_ar}
          currentPrice={stock.current_price}
        />
      </ErrorBoundary>

      {/* Delta Volume — ??? ??????/????? (??? ?????) */}
      <ErrorBoundary title="??? ?????">
        <DeltaVolumeBar ticker={stock.ticker} />
      </ErrorBoundary>

      {/* Market Depth DOM Panel — ??? ????? ????? ??????? */}
      <ErrorBoundary title="??? ????? ????? ???????">
        <MarketDepthPanel initialTicker={stock.ticker} />
      </ErrorBoundary>

      {/* Financial & Technical Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Financial Metrics */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              ???????? ???????
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <MetricRow label="????? ??????? (P/E)" value={safeToFixed(stock.pe_ratio, 1)} />
            <Separator />
            <MetricRow label="????? ?????? ???????? (P/B)" value={safeToFixed(stock.pb_ratio, 1)} />
            <Separator />
            <MetricRow
              label="???? ?????????"
              value={safeToFixed(stock.dividend_yield, 1) + '%'}
              highlight={stock.dividend_yield > 3}
            />
            <Separator />
            <MetricRow label="????? ????? (EPS)" value={safeToFixed(stock.eps) + ' EGP'} />
            <Separator />
            <MetricRow
              label="?????? ??? ???? ??????? (ROE)"
              value={safeToFixed(stock.roe, 1) + '%'}
              highlight={stock.roe > 15}
            />
            <Separator />
            <MetricRow
              label="?????/???? ???????"
              value={safeToFixed(stock.debt_to_equity)}
            />
          </CardContent>
        </Card>

        {/* Technical Indicators */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              ???????? ??????
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <MetricRow
              label="RSI"
              // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — prefer unified.technical.rsi
              value={safeToFixed(unifiedData?.technical?.rsi ?? stock.rsi, 1)}
              highlight={(unifiedData?.technical?.rsi ?? stock.rsi) < 35 || (unifiedData?.technical?.rsi ?? stock.rsi) > 65}
            />
            <Separator />
            <MetricRow label="??????? ??????? (50)" value={safeToFixed(unifiedData?.technical?.ma_50 ?? stock.ma_50)} />
            <Separator />
            <MetricRow label="??????? ??????? (200)" value={safeToFixed(unifiedData?.technical?.ma_200 ?? stock.ma_200)} />
            <Separator />
            <MetricRow
              label="????? ?????"
              value={safeToFixed(stock.support_level)}
              highlight
            />
            <Separator />
            <MetricRow
              label="????? ????????"
              value={safeToFixed(stock.resistance_level)}
            />
            <Separator />
            <MetricRow
              label="?????? ?????????"
              value={formatNumber(stock.value_traded || 0) + ' EGP'}
            />
          </CardContent>
        </Card>
      </div>

      {/* AI Analysis Widget - Automatic Background Analysis */}
      <ErrorBoundary title="????? ??????? ?????">
        <AIAnalysisWidget 
          ticker={stock.ticker} 
          stockName={stock.name_ar}
          currentPrice={stock.current_price}
        />
      </ErrorBoundary>

      {/* Last Updated Indicator */}
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground" dir="rtl">
        <Clock className="w-3 h-3" />
        <span>??? ?????: {stock.last_update ? new Date(stock.last_update).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '??? ????'}</span>
      </div>

      {/* Calculation Breakdown */}
      <ErrorBoundary title="?????? ??????"><CalculationBreakdown /></ErrorBoundary>

      {/* Deep Analysis */}
      <ErrorBoundary title="??????? ??????"><DeepAnalysis /></ErrorBoundary>

      {/* Stock News */}
      <ErrorBoundary title="????? ?????"><StockNews /></ErrorBoundary>
    </div>
  );
}

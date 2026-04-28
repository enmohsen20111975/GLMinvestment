'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Brain,
  ArrowUpCircle,
  ArrowDownCircle,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  Activity,
  Zap,
  Shield,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Target,
  BarChart3,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Percent,
  DollarSign,
  Droplets,
  Timer,
  Layers,
  PieChart,
  Info,
  Download,
  Clock,
  Radio,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn, safeNum } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { StockRecommendation, MarketRegime, ConfidenceBreakdown } from '@/types/v2';
import type { StockStatusItem } from '@/types';
import { toast } from 'sonner';
import { ShareButton } from '@/components/share/ShareButton';

// ==================== V2 HELPERS ====================

function getV2RecommendationBadge(rec: string): { label: string; color: string; bg: string; border: string; icon: React.ReactNode } {
  switch (rec) {
    case 'Strong Buy': return { label: 'شراء قوي', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950/50', border: 'border-emerald-300 dark:border-emerald-800', icon: <ArrowUpCircle className="w-3 h-3" /> };
    case 'Buy': return { label: 'شراء', color: 'text-green-700 dark:text-green-300', bg: 'bg-green-50 dark:bg-green-950/40', border: 'border-green-200 dark:border-green-800', icon: <TrendingUp className="w-3 h-3" /> };
    case 'Hold': return { label: 'احتفاظ', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800', icon: <Eye className="w-3 h-3" /> };
    case 'Avoid': return { label: 'تجنب', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800', icon: <AlertTriangle className="w-3 h-3" /> };
    case 'Strong Avoid': return { label: 'تجنب قوي', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950/50', border: 'border-red-300 dark:border-red-800', icon: <ArrowDownCircle className="w-3 h-3" /> };
    default: return { label: rec, color: 'text-muted-foreground', bg: 'bg-muted/50', border: 'border-muted', icon: <Minus className="w-3 h-3" /> };
  }
}

function getRegimeInfo(regime: MarketRegime): { label: string; color: string; bg: string; border: string; icon: React.ReactNode } {
  switch (regime) {
    case 'bull': return { label: 'سوق صاعد (Bull)', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950/50', border: 'border-emerald-300 dark:border-emerald-800', icon: <TrendingUp className="w-5 h-5" /> };
    case 'bear': return { label: 'سوق هابط (Bear)', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950/50', border: 'border-red-300 dark:border-red-800', icon: <TrendingDown className="w-5 h-5" /> };
    default: return { label: 'سوق محايد (Neutral)', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-950/50', border: 'border-amber-300 dark:border-amber-800', icon: <Minus className="w-5 h-5" /> };
  }
}

function getVerdictBadge(verdict: string, verdictAr?: string): { color: string; bg: string } {
  switch (verdict) {
    case 'undervalued': return { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/50' };
    case 'fair': return { color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/50' };
    case 'overvalued': return { color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/50' };
    default: return { color: 'text-muted-foreground', bg: 'bg-muted/50' };
  }
}

function getRiskColor(level: string): { color: string; bg: string } {
  switch (level) {
    case 'Low': return { color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-900/50' };
    case 'Medium': return { color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/50' };
    case 'High': return { color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-900/50' };
    case 'Very High': return { color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/50' };
    default: return { color: 'text-muted-foreground', bg: 'bg-muted/50' };
  }
}

function getScoreBarColor(score: number): string {
  if (score >= 75) return '[&>div]:bg-emerald-500';
  if (score >= 55) return '[&>div]:bg-green-500';
  if (score >= 42) return '[&>div]:bg-amber-500';
  if (score >= 28) return '[&>div]:bg-orange-500';
  return '[&>div]:bg-red-500';
}

// ==================== NEW HELPERS (V2 Enhanced) ====================

function formatVolume(vol: number): string {
  const v = Number(vol) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(0) + 'K';
  return v.toString();
}

function formatValue(val: number): string {
  const v = Number(val) || 0;
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  return (v / 1_000).toFixed(0) + 'K';
}

function getCapBadge(cat: string): { label: string; labelAr: string; color: string; bg: string } {
  switch (cat) {
    case 'large': return { label: 'Large Cap', labelAr: 'رأس مال كبير', color: 'text-sky-700 dark:text-sky-300', bg: 'bg-sky-100 dark:bg-sky-900/50' };
    case 'mid': return { label: 'Mid Cap', labelAr: 'رأس مال متوسط', color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-100 dark:bg-purple-900/50' };
    default: return { label: 'Small Cap', labelAr: 'رأس مال صغير', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-900/50' };
  }
}

function getLiquidityBadge(rating: string): { label: string; color: string; bg: string } {
  switch (rating) {
    case 'high': return { label: 'سيولة عالية', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-900/50' };
    case 'medium': return { label: 'سيولة متوسطة', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/50' };
    default: return { label: 'سيولة منخفضة', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/50' };
  }
}

function getDataQualityBadge(level: string): { label: string; color: string; bg: string; border: string } {
  switch (level) {
    case 'high': return { label: 'بيانات موثوقة', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-900/50', border: 'border-emerald-300 dark:border-emerald-800' };
    case 'medium': return { label: 'بيانات متوسطة', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/50', border: 'border-amber-300 dark:border-amber-800' };
    default: return { label: 'بيانات محدودة', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/50', border: 'border-red-300 dark:border-red-800' };
  }
}

function getConfidenceBarColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function getTimeHorizonLabel(months: number): string {
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rem = months % 12;
    return rem > 0 ? `${years} سنة و ${rem} أشهر` : `${years} سنة`;
  }
  return `${months} ${months === 1 ? 'شهر' : months === 2 ? 'شهرين' : months <= 10 ? 'أشهر' : 'شهر'}`;
}

/** Mini 5-segment confidence breakdown bar for inline display */
function ConfidenceMiniBar({ breakdown, className }: { breakdown: ConfidenceBreakdown; className?: string }) {
  const segments = [
    { key: 'quality', label: 'جودة', score: breakdown.qualityScore },
    { key: 'technical', label: 'فني', score: breakdown.technicalScore },
    { key: 'valuation', label: 'تقييم', score: breakdown.valuationScore },
    { key: 'momentum', label: 'زخم', score: breakdown.momentumScore },
    { key: 'data', label: 'بيانات', score: breakdown.dataReliability },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex h-2 rounded-full overflow-hidden gap-px bg-muted/30', className)}>
        {segments.map((seg) => (
          <Tooltip key={seg.key}>
            <TooltipTrigger asChild>
              <div
                className={cn('h-full transition-all rounded-full first:rounded-s-full last:rounded-e-full', getConfidenceBarColor(seg.score))}
                style={{ flex: seg.score, minWidth: '4px' }}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              <span>{seg.label}: {seg.score}</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

// ==================== OLD API HELPERS (fallback) ====================

function getOldRecommendation(score: number): { label: string; color: string; bg: string; border: string; icon: React.ReactNode } {
  if (score >= 75) return { label: 'شراء قوي', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950/50', border: 'border-emerald-300 dark:border-emerald-800', icon: <ArrowUpCircle className="w-3 h-3" /> };
  if (score >= 55) return { label: 'شراء', color: 'text-green-700 dark:text-green-300', bg: 'bg-green-50 dark:bg-green-950/40', border: 'border-green-200 dark:border-green-800', icon: <TrendingUp className="w-3 h-3" /> };
  if (score >= 42) return { label: 'متابعة', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800', icon: <Eye className="w-3 h-3" /> };
  if (score >= 28) return { label: 'بيع', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800', icon: <ArrowDownCircle className="w-3 h-3" /> };
  return { label: 'بيع قوي', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950/50', border: 'border-red-300 dark:border-red-800', icon: <TrendingDown className="w-3 h-3" /> };
}

function getSentimentInfo(sentiment: string): { label: string; color: string; bg: string; icon: React.ReactNode } {
  switch (sentiment) {
    case 'bullish': return { label: 'صعودي', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-900/50', icon: <TrendingUp className="w-6 h-6" /> };
    case 'bearish': return { label: 'هبوطي', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/50', icon: <TrendingDown className="w-6 h-6" /> };
    default: return { label: 'محايد', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/50', icon: <Minus className="w-6 h-6" /> };
  }
}

function getRiskLabel(risk: string): { label: string; color: string; bg: string } {
  switch (risk) {
    case 'low': return { label: 'منخفض', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-900/50' };
    case 'high': return { label: 'مرتفع', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/50' };
    default: return { label: 'متوسط', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/50' };
  }
}

function getDecisionLabel(decision: string): string {
  switch (decision) {
    case 'accumulate_selectively': return 'التجميع الانتقائي — ابحث عن الفرص الجيدة';
    case 'hold_and_rebalance': return 'الاحتفاظ وإعادة التوازن';
    case 'reduce_risk': return 'تقليل المخاطر — حذف المراكز الضعيفة';
    default: return 'ترقب السوق';
  }
}

function getRiskIcon(risk: string): React.ReactNode {
  switch (risk) {
    case 'low': return <ShieldCheck className="w-5 h-5 text-emerald-600" />;
    case 'high': return <ShieldAlert className="w-5 h-5 text-red-600" />;
    default: return <Shield className="w-5 h-5 text-amber-600" />;
  }
}

// ==================== V2: SECTION 1 — MARKET OVERVIEW HEADER (ENHANCED) ====================

function V2MarketOverview() {
  const { v2Data } = useAppStore();
  if (!v2Data) return null;

  const { market } = v2Data;
  const regime = getRegimeInfo(market.regime);
  const recs = market.recommendations;
  const totalRecs = recs.strongBuy + recs.buy + recs.hold + recs.avoid + recs.strongAvoid;

  // Cap distribution data
  const capDist = market.capDistribution;
  const totalCaps = capDist ? capDist.large + capDist.mid + capDist.small : 0;

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">محرك التحليلات V2</CardTitle>
            <Badge variant="outline" className="text-[10px]">{v2Data.analysisVersion}</Badge>
          </div>
          <div className={cn('flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold border', regime.bg, regime.color, regime.border)}>
            {regime.icon}
            <span>{regime.label}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Regime + Safety Stats */}
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground mb-1.5">مضاعف النظام</p>
              <p className="text-2xl font-bold text-foreground">{safeNum(market.regimeMultiplier).toFixed(2)}x</p>
              <p className="text-[10px] text-muted-foreground">نسبة التحسين على التحليلات</p>
            </div>
            <div className="rounded-xl border p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">فلتر الأمان</p>
                <span className="text-sm font-bold">
                  {market.passedSafetyFilter}/{market.totalStocksAnalyzed}
                </span>
              </div>
              <Progress
                value={market.totalStocksAnalyzed > 0 ? (market.passedSafetyFilter / market.totalStocksAnalyzed) * 100 : 0}
                className="h-2 [&>div]:bg-emerald-500"
              />
              <p className="text-[10px] text-muted-foreground mt-1">تم اجتياز معايير السلامة المالية</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground mb-1">نسبة الاحتفاظ بالنقد</p>
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-amber-500" />
                <span className="text-lg font-bold text-amber-600">{safeNum(market.fearCashPercent).toFixed(0)}%</span>
              </div>
              <p className="text-[10px] text-muted-foreground">احتياطي نقدي مقترح في السوق الحالي</p>
            </div>
          </div>

          {/* Recommendation Distribution */}
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground mb-3">توزيع التحليلات</p>
            {/* Stacked bar */}
            <div className="flex h-8 rounded-lg overflow-hidden mb-3">
              {recs.strongBuy > 0 && (
                <div className="bg-emerald-500 flex items-center justify-center" style={{ width: `${(recs.strongBuy / totalRecs) * 100}%` }}>
                  <span className="text-[10px] font-bold text-white">{recs.strongBuy}</span>
                </div>
              )}
              {recs.buy > 0 && (
                <div className="bg-green-500 flex items-center justify-center" style={{ width: `${(recs.buy / totalRecs) * 100}%` }}>
                  <span className="text-[10px] font-bold text-white">{recs.buy}</span>
                </div>
              )}
              {recs.hold > 0 && (
                <div className="bg-amber-500 flex items-center justify-center" style={{ width: `${(recs.hold / totalRecs) * 100}%` }}>
                  <span className="text-[10px] font-bold text-white">{recs.hold}</span>
                </div>
              )}
              {recs.avoid > 0 && (
                <div className="bg-orange-500 flex items-center justify-center" style={{ width: `${(recs.avoid / totalRecs) * 100}%` }}>
                  <span className="text-[10px] font-bold text-white">{recs.avoid}</span>
                </div>
              )}
              {recs.strongAvoid > 0 && (
                <div className="bg-red-500 flex items-center justify-center" style={{ width: `${(recs.strongAvoid / totalRecs) * 100}%` }}>
                  <span className="text-[10px] font-bold text-white">{recs.strongAvoid}</span>
                </div>
              )}
            </div>
            {/* Legend */}
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: 'شراء قوي', count: recs.strongBuy, color: 'bg-emerald-500', textColor: 'text-emerald-700' },
                { label: 'شراء', count: recs.buy, color: 'bg-green-500', textColor: 'text-green-700' },
                { label: 'احتفاظ', count: recs.hold, color: 'bg-amber-500', textColor: 'text-amber-700' },
                { label: 'تجنب', count: recs.avoid, color: 'bg-orange-500', textColor: 'text-orange-700' },
                { label: 'تجنب قوي', count: recs.strongAvoid, color: 'bg-red-500', textColor: 'text-red-700' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <div className={cn('w-2.5 h-2.5 rounded-sm', item.color)} />
                  <span className="text-[10px] text-muted-foreground">{item.label}</span>
                  <span className={cn('text-[10px] font-bold mr-auto', item.textColor)}>{item.count}</span>
                </div>
              ))}
            </div>

            {/* Cap Distribution Bar */}
            {capDist && totalCaps > 0 && (
              <>
                <Separator className="my-3" />
                <div>
                  <p className="text-xs text-muted-foreground mb-2">توزيع القيمة السوقية</p>
                  <div className="flex h-4 rounded-full overflow-hidden gap-px">
                    {capDist.large > 0 && (
                      <div className="bg-sky-500 flex items-center justify-center" style={{ width: `${(capDist.large / totalCaps) * 100}%` }}>
                        <span className="text-[8px] font-bold text-white">{capDist.large}</span>
                      </div>
                    )}
                    {capDist.mid > 0 && (
                      <div className="bg-purple-500 flex items-center justify-center" style={{ width: `${(capDist.mid / totalCaps) * 100}%` }}>
                        <span className="text-[8px] font-bold text-white">{capDist.mid}</span>
                      </div>
                    )}
                    {capDist.small > 0 && (
                      <div className="bg-orange-500 flex items-center justify-center" style={{ width: `${(capDist.small / totalCaps) * 100}%` }}>
                        <span className="text-[8px] font-bold text-white">{capDist.small}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[10px] mt-1.5">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm bg-sky-500" />
                      <span className="text-muted-foreground">كبير: </span>
                      <span className="font-bold text-sky-700 dark:text-sky-300">{capDist.large}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm bg-purple-500" />
                      <span className="text-muted-foreground">متوسط: </span>
                      <span className="font-bold text-purple-700 dark:text-purple-300">{capDist.mid}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm bg-orange-500" />
                      <span className="text-muted-foreground">صغير: </span>
                      <span className="font-bold text-orange-700 dark:text-orange-300">{capDist.small}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Key stats */}
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground mb-1">إجمالي الأسهم المحللة</p>
              <p className="text-2xl font-bold text-foreground">{market.totalStocksAnalyzed}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground mb-1">أسهم الشراء (شراء قوي + شراء)</p>
              <p className="text-2xl font-bold text-emerald-600">{recs.strongBuy + recs.buy}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground mb-1">أسهم التجنب (تجنب + تجنب قوي)</p>
              <p className="text-2xl font-bold text-red-600">{recs.avoid + recs.strongAvoid}</p>
            </div>
          </div>
        </div>

        {/* Diversification Warnings in Market Overview */}
        {market.diversificationIssues && market.diversificationIssues.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-bold text-amber-700 dark:text-amber-400">تنبيهات التنويع</span>
            </div>
            <ul className="space-y-1">
              {market.diversificationIssues.map((issue, idx) => (
                <li key={idx} className="text-[11px] text-amber-600 dark:text-amber-500 flex items-start gap-1.5">
                  <span className="mt-0.5">•</span>
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== V2: SECTION 2 — STOCK RECOMMENDATIONS TABLE (ENHANCED) ====================

const PAGE_SIZE = 15;

function V2StocksTable() {
  const { v2Data, loadStockDetail } = useAppStore();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<string>('all');

  const sortedStocks = useMemo(() => {
    if (!v2Data || !v2Data.stocks || !Array.isArray(v2Data.stocks)) return [];
    let stocks = [...v2Data.stocks].sort((a, b) => b.compositeScore - a.compositeScore);

    if (filter !== 'all') {
      stocks = stocks.filter(s => s.recommendation === filter);
    }
    return stocks;
  }, [v2Data, filter]);

  if (!v2Data) return null;

  const totalPages = Math.ceil(sortedStocks.length / PAGE_SIZE);
  const paginated = sortedStocks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filters = [
    { value: 'all', label: 'الكل' },
    { value: 'Strong Buy', label: 'شراء قوي' },
    { value: 'Buy', label: 'شراء' },
    { value: 'Hold', label: 'احتفاظ' },
    { value: 'Avoid', label: 'تجنب' },
    { value: 'Strong Avoid', label: 'تجنب قوي' },
  ];

  const getChangePercent = (stock: StockRecommendation): number => {
    if (stock.previousClose <= 0) return 0;
    return ((stock.currentPrice - stock.previousClose) / stock.previousClose) * 100;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">تحليلات الأسهم V2</CardTitle>
            <Badge variant="secondary" className="text-xs">{sortedStocks.length} سهم</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filters.map(f => (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? 'default' : 'outline'}
                className={cn('text-xs h-7 px-2.5', filter === f.value && 'bg-primary text-primary-foreground')}
                onClick={() => { setFilter(f.value); setPage(1); }}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="sticky top-0 bg-background z-10">
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead className="w-20">الرمز</TableHead>
                <TableHead className="hidden md:table-cell min-w-[120px]">الاسم</TableHead>
                <TableHead className="hidden lg:table-cell">القطاع</TableHead>
                <TableHead className="text-center hidden xl:table-cell">القيمة السوقية</TableHead>
                <TableHead className="text-center">السعر</TableHead>
                <TableHead className="text-center">التغير</TableHead>
                <TableHead className="text-center hidden md:table-cell">القيمة العادلة</TableHead>
                <TableHead className="text-center hidden md:table-cell">التقييم</TableHead>
                <TableHead className="text-center hidden lg:table-cell min-w-[80px]">الجودة</TableHead>
                <TableHead className="text-center hidden lg:table-cell min-w-[80px]">الزخم</TableHead>
                <TableHead className="text-center hidden xl:table-cell">حجم التداول</TableHead>
                <TableHead className="text-center hidden xl:table-cell">جودة البيانات</TableHead>
                <TableHead className="text-center hidden xl:table-cell">نقطة الدخول</TableHead>
                <TableHead className="text-center hidden xl:table-cell">الهدف</TableHead>
                <TableHead className="text-center hidden xl:table-cell">وقف الخسارة</TableHead>
                <TableHead className="text-center hidden xl:table-cell">المخاطرة</TableHead>
                <TableHead className="text-center w-24">التحليل</TableHead>
                <TableHead className="text-center hidden sm:table-cell w-16">الثقة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((stock, idx) => {
                const rec = getV2RecommendationBadge(stock.recommendation);
                const globalRank = (page - 1) * PAGE_SIZE + idx + 1;
                const changePct = getChangePercent(stock);
                const verdict = getVerdictBadge(stock.fairValue.verdict);
                const riskCol = getRiskColor(stock.riskAssessment.level);
                const capBadge = stock.marketCapCategory ? getCapBadge(stock.marketCapCategory) : null;
                const liqBadge = stock.volume ? getLiquidityBadge(stock.volume.liquidityRating) : null;
                const volRatio = stock.volume ? stock.volume.volumeRatio : 0;
                const dqBadge = stock.dataQuality ? getDataQualityBadge(stock.dataQuality.level) : null;

                return (
                  <TableRow
                    key={stock.ticker}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => loadStockDetail(stock.ticker)}
                  >
                    <TableCell className="text-center text-xs text-muted-foreground font-mono">{globalRank}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-xs text-foreground">{stock.ticker}</span>
                        {!stock.safetyPassed && (
                          <AlertTriangle className="w-3 h-3 text-amber-500" title="لم يجتز فلتر الأمان" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-xs text-muted-foreground truncate max-w-[140px] block">{stock.nameAr}</span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant="outline" className="text-[9px] font-normal">{stock.sector}</Badge>
                    </TableCell>
                    {/* Market Cap Category */}
                    <TableCell className="text-center hidden xl:table-cell">
                      {capBadge ? (
                        <Badge variant="outline" className={cn('text-[8px] font-bold border-0', capBadge.bg, capBadge.color)}>
                          {stock.marketCapCategoryAr || capBadge.labelAr}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">{safeNum(stock.currentPrice).toFixed(2)}</TableCell>
                    <TableCell className={cn('text-center font-mono text-xs font-medium', changePct >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {changePct >= 0 ? '+' : ''}{safeNum(changePct).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-center hidden md:table-cell font-mono text-xs">
                      {safeNum(stock.fairValue.averageFairValue).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-center hidden md:table-cell">
                      <Badge variant="outline" className={cn('text-[9px] font-bold border-0', verdict.bg, verdict.color)}>
                        {stock.fairValue.verdictAr}
                      </Badge>
                    </TableCell>
                    {/* Quality Score */}
                    <TableCell className="text-center hidden lg:table-cell">
                      <div className="flex items-center gap-1 justify-center">
                        <Progress value={stock.qualityScore.total} className={cn('h-1.5 w-14', getScoreBarColor(stock.qualityScore.total))} />
                        <span className="text-[10px] font-bold text-muted-foreground">{stock.qualityScore.total}</span>
                      </div>
                    </TableCell>
                    {/* Momentum Score */}
                    <TableCell className="text-center hidden lg:table-cell">
                      <div className="flex items-center gap-1 justify-center">
                        <Progress value={stock.momentumScore.score} className={cn('h-1.5 w-14', getScoreBarColor(stock.momentumScore.score))} />
                        <span className="text-[10px] font-bold text-muted-foreground">{stock.momentumScore.score}</span>
                      </div>
                    </TableCell>
                    {/* Volume Ratio */}
                    <TableCell className="text-center hidden xl:table-cell">
                      {stock.volume ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[10px] font-bold tabular-nums" dir="ltr">
                            {formatVolume(stock.volume.currentVolume)}
                          </span>
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={cn('text-[8px] tabular-nums', volRatio >= 1.5 ? 'text-emerald-600 font-bold' : volRatio >= 0.7 ? 'text-muted-foreground' : 'text-red-500')}>
                                  {safeNum(volRatio).toFixed(1)}x
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-[10px]">
                                <span>متوسط 20 يوم: {formatVolume(stock.volume.avgVolume20)}</span>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {/* Data Quality */}
                    <TableCell className="text-center hidden xl:table-cell">
                      {dqBadge ? (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className={cn('text-[8px] font-bold border', dqBadge.bg, dqBadge.color, dqBadge.border)}>
                                {dqBadge.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[200px] text-[10px]">
                              <div className="text-right">
                                <p className="font-bold mb-1">جودة البيانات: {stock.dataQuality?.score}/100</p>
                                {stock.dataQuality?.reasons.map((r, i) => (
                                  <p key={i}>• {r}</p>
                                ))}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {/* Entry Price */}
                    <TableCell className="text-center hidden xl:table-cell font-mono text-xs">
                      <span className="text-emerald-600 dark:text-emerald-400">{safeNum(stock.entryPrice).toFixed(2)}</span>
                    </TableCell>
                    {/* Target Price */}
                    <TableCell className="text-center hidden xl:table-cell font-mono text-xs">
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{safeNum(stock.exitStrategy.targetPrice).toFixed(2)}</span>
                    </TableCell>
                    {/* Stop Loss */}
                    <TableCell className="text-center hidden xl:table-cell font-mono text-xs">
                      <span className="text-red-600 dark:text-red-400">{safeNum(stock.exitStrategy.stopLoss).toFixed(2)}</span>
                    </TableCell>
                    {/* Risk Level Badge */}
                    <TableCell className="text-center hidden xl:table-cell">
                      <Badge variant="outline" className={cn('text-[8px] font-bold border-0', riskCol.bg, riskCol.color)}>
                        {stock.riskAssessment.levelAr || stock.riskAssessment.level}
                      </Badge>
                    </TableCell>
                    {/* Recommendation */}
                    <TableCell className="text-center">
                      <div className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold', rec.bg, rec.color, rec.border)}>
                        {rec.icon}
                        <span>{rec.label}</span>
                      </div>
                    </TableCell>
                    {/* Confidence */}
                    <TableCell className="text-center hidden sm:table-cell">
                      <Badge variant="outline" className={cn(
                        'text-[9px] font-bold border-0',
                        stock.confidence >= 70 && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
                        stock.confidence >= 50 && stock.confidence < 70 && 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
                        stock.confidence < 50 && 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
                      )}>
                        {safeNum(stock.confidence).toFixed(0)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4 pt-3 border-t">
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground px-3">{page} / {totalPages}</span>
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== V2: SECTION 3 — RECOMMENDATION DISTRIBUTION ====================

function V2RecommendationDistribution() {
  const { v2Data } = useAppStore();
  if (!v2Data) return null;

  const recs = v2Data.market.recommendations;

  const items = [
    { label: 'شراء قوي', count: recs.strongBuy, icon: <ArrowUpCircle className="w-5 h-5" />, color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950/50', border: 'border-emerald-300 dark:border-emerald-800' },
    { label: 'شراء', count: recs.buy, icon: <TrendingUp className="w-5 h-5" />, color: 'text-green-700 dark:text-green-300', bg: 'bg-green-50 dark:bg-green-950/40', border: 'border-green-200 dark:border-green-800' },
    { label: 'احتفاظ', count: recs.hold, icon: <Eye className="w-5 h-5" />, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800' },
    { label: 'تجنب', count: recs.avoid, icon: <AlertTriangle className="w-5 h-5" />, color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800' },
    { label: 'تجنب قوي', count: recs.strongAvoid, icon: <ArrowDownCircle className="w-5 h-5" />, color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950/50', border: 'border-red-300 dark:border-red-800' },
  ];

  const total = items.reduce((sum, i) => sum + i.count, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg">توزيع التحليلات</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {items.map(item => (
            <div key={item.label} className={cn('rounded-xl border p-3 text-center', item.bg, item.border)}>
              <div className={cn('inline-flex items-center justify-center mb-1.5', item.color)}>
                {item.icon}
              </div>
              <p className={cn('text-2xl font-bold', item.color)}>{item.count}</p>
              <p className={cn('text-[11px] font-medium', item.color)}>{item.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{total > 0 ? ((item.count / total) * 100).toFixed(1) : 0}%</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== V2: SECTION 4 — BEST OPPORTUNITIES (COMPLETE REDESIGN) ====================

function V2BestOpportunities() {
  const { v2Data, loadStockDetail } = useAppStore();
  if (!v2Data) return null;

  const best = [...v2Data.stocks]
    .filter(s => s.recommendation === 'Strong Buy' || s.recommendation === 'Buy')
    .filter(s => s.fairValue.upsidePotential > 10)
    .sort((a, b) => b.fairValue.upsidePotential - a.fairValue.upsidePotential)
    .slice(0, 5);

  if (best.length === 0) return null;

  return (
    <Card className="border-2 border-emerald-300 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/80 to-white dark:from-emerald-950/30 dark:to-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-emerald-700 dark:text-emerald-400">🏆 أفضل الفرص الاستثمارية</CardTitle>
              <CardDescription className="text-[10px] text-muted-foreground">أسهم بمعدل نمو مرتفع وإشارات شراء قوية</CardDescription>
            </div>
          </div>
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 border-0 text-[10px]">
            {best.length} فرص
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {best.map((stock, i) => {
            const rec = getV2RecommendationBadge(stock.recommendation);
            const riskCol = getRiskColor(stock.riskAssessment?.level || 'Medium');
            const capBadge = stock.marketCapCategory ? getCapBadge(stock.marketCapCategory) : null;
            const liqBadge = stock.volume ? getLiquidityBadge(stock.volume.liquidityRating) : null;
            const hasBreakdown = !!stock.confidenceBreakdown;
            const isDataReliable = (stock.fairValue as Record<string, unknown>).dataReliable !== false;

            return (
              <div
                key={stock.ticker}
                className="p-3 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 bg-white/60 dark:bg-emerald-950/10 cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                onClick={() => loadStockDetail(stock.ticker)}
              >
                {/* Row 1: Ticker, name, recommendation badge, market cap badge */}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-emerald-500 text-white font-bold text-[10px] flex-shrink-0">
                    {i + 1}
                  </div>
                  <span className="font-bold text-xs text-foreground">{stock.ticker}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{stock.nameAr}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    {capBadge && (
                      <Badge variant="outline" className={cn('text-[8px] font-bold border-0', capBadge.bg, capBadge.color)}>
                        {stock.marketCapCategoryAr || capBadge.labelAr}
                      </Badge>
                    )}
                    <div className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold inline-flex items-center gap-0.5 border', rec.bg, rec.color, rec.border)}>
                      {rec.icon}{rec.label}
                    </div>
                  </div>
                </div>

                {/* Row 2: Price → Target | Upside % | Fair Value */}
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap mb-1.5 pl-8">
                  <span>السعر: <strong className="text-foreground tabular-nums" dir="ltr">{safeNum(stock.currentPrice).toFixed(2)}</strong></span>
                  <span className="text-emerald-500">→</span>
                  <span>الهدف: <strong className="text-emerald-600 tabular-nums" dir="ltr">{safeNum(stock.exitStrategy.targetPrice).toFixed(2)}</strong></span>
                  <Badge variant="outline" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 border-0 text-[9px] font-bold px-1.5">
                    +{safeNum(stock.fairValue.upsidePotential).toFixed(1)}%
                  </Badge>
                  <span className="text-[10px]">
                    القيمة العادلة: <strong className="tabular-nums text-foreground" dir="ltr">{safeNum(stock.fairValue.averageFairValue).toFixed(2)}</strong>
                  </span>
                </div>

                {/* Row 3: Stop Loss (red) | Time Horizon | Risk Level badge | Liquidity badge */}
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap pl-8 mb-1.5">
                  <span className="flex items-center gap-1">
                    <Target className="w-3 h-3 text-red-500" />
                    وقف: <strong className="text-red-600 tabular-nums" dir="ltr">{safeNum(stock.exitStrategy.stopLoss).toFixed(2)}</strong>
                  </span>
                  <Separator orientation="vertical" className="h-3" />
                  <span className="flex items-center gap-1">
                    <Timer className="w-3 h-3" />
                    أفق: <strong className="text-foreground">{stock.exitStrategy.timeHorizonMonths} {stock.exitStrategy.timeHorizonMonths === 12 ? 'سنة' : stock.exitStrategy.timeHorizonMonths === 6 ? '6 أشهر' : 'شهر'}</strong>
                  </span>
                  <Separator orientation="vertical" className="h-3" />
                  <Badge variant="outline" className={cn('text-[8px] font-bold border-0', riskCol.bg, riskCol.color)}>
                    <Shield className="w-2.5 h-2.5 ml-0.5" />
                    {stock.riskAssessment?.levelAr || '—'}
                  </Badge>
                  {liqBadge && (
                    <>
                      <Separator orientation="vertical" className="h-3" />
                      <Badge variant="outline" className={cn('text-[8px] font-bold border-0', liqBadge.bg, liqBadge.color)}>
                        <Droplets className="w-2.5 h-2.5 ml-0.5" />
                        {liqBadge.label}
                      </Badge>
                    </>
                  )}
                  {stock.dataQuality && (
                    (() => {
                      const dq = getDataQualityBadge(stock.dataQuality.level);
                      return (
                        <>
                          <Separator orientation="vertical" className="h-3" />
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className={cn('text-[8px] font-bold border', dq.bg, dq.color, dq.border)}>
                                  <Radio className="w-2.5 h-2.5 ml-0.5" />
                                  {dq.label}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-[10px] max-w-[200px] text-right">
                                <p className="font-bold mb-1">جودة البيانات: {stock.dataQuality.score}/100</p>
                                {stock.dataQuality.reasons.map((r, ri) => (
                                  <p key={ri}>• {r}</p>
                                ))}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </>
                      );
                    })()
                  )}
                </div>

                {/* Row 4: Confidence score with mini breakdown bar (5 segments) */}
                <div className="flex items-center gap-3 pl-8">
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">الثقة:</span>
                          <Badge variant="outline" className={cn(
                            'text-[9px] font-bold border-0',
                            stock.confidence >= 70 && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
                            stock.confidence >= 50 && stock.confidence < 70 && 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
                            stock.confidence < 50 && 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
                          )}>
                            {safeNum(stock.confidence).toFixed(0)}%
                          </Badge>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[10px] max-w-[200px]">
                        <p className="font-bold mb-1">تفصيل درجة الثقة</p>
                        {hasBreakdown ? (
                          <div className="space-y-0.5">
                            <span>جودة: {stock.confidenceBreakdown!.qualityScore}</span>
                            <span>فني: {stock.confidenceBreakdown!.technicalScore}</span>
                            <span>تقييم: {stock.confidenceBreakdown!.valuationScore}</span>
                            <span>زخم: {stock.confidenceBreakdown!.momentumScore}</span>
                            <span>بيانات: {stock.confidenceBreakdown!.dataReliability}</span>
                          </div>
                        ) : (
                          <span>لا تتوفر تفاصيل</span>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {hasBreakdown && (
                    <div className="flex-1 max-w-[200px]">
                      <ConfidenceMiniBar breakdown={stock.confidenceBreakdown!} />
                    </div>
                  )}

                  {/* Data reliability warning */}
                  {!isDataReliable && (
                    <Badge variant="outline" className="border-0 text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 ml-auto">
                      ⚠️ بيانات غير موثوقة
                    </Badge>
                  )}

                  {/* Share Button */}
                  <div className="mr-auto">
                    <ShareButton
                      stockData={{
                        ticker: stock.ticker,
                        name: stock.name,
                        nameAr: stock.nameAr,
                        price: stock.currentPrice,
                        change: stock.previousClose > 0 ? ((stock.currentPrice - stock.previousClose) / stock.previousClose) * 100 : 0,
                        recommendation: stock.recommendation,
                        recommendationAr: stock.recommendationAr,
                        confidence: stock.confidence,
                        metrics: {
                          pe: stock.fairValue.details?.eps && stock.fairValue.details?.sectorTargetPE ? stock.currentPrice / (stock.fairValue.details?.eps || 1) : undefined,
                          roe: undefined,
                          dividendYield: stock.fairValue.details?.marginOfSafety ? undefined : undefined,
                        },
                        fairValue: stock.fairValue.averageFairValue,
                        upsidePotential: stock.fairValue.upsidePotential,
                        targetPrice: stock.exitStrategy.targetPrice,
                        stopLoss: stock.exitStrategy.stopLoss,
                        riskLevel: stock.riskAssessment?.level,
                        sector: stock.sector,
                      }}
                      iconOnly
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== V2: SECTION 5 — QUICK SUMMARY ====================

function V2QuickSummary() {
  const { v2Data } = useAppStore();
  if (!v2Data) return null;

  const { market, stocks } = v2Data;
  const regime = getRegimeInfo(market.regime);
  const buyStocks = stocks.filter(s => s.recommendation === 'Strong Buy' || s.recommendation === 'Buy');
  const avgConfidence = buyStocks.length > 0 ? buyStocks.reduce((sum, s) => sum + s.confidence, 0) / buyStocks.length : 0;
  const avgUpside = buyStocks.length > 0 ? buyStocks.reduce((sum, s) => sum + s.fairValue.upsidePotential, 0) / buyStocks.length : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">ملخص سريع</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">حالة السوق</p>
              <div className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold', regime.bg, regime.color)}>
                {regime.icon}
                <span>{regime.label}</span>
              </div>
            </div>
            <div className="rounded-xl border p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">مضاعف النظام</p>
              <p className="text-2xl font-bold text-foreground">{safeNum(market.regimeMultiplier).toFixed(2)}x</p>
            </div>
            <div className="rounded-xl border p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">متوسط ثقة التحليلات الشرائية</p>
              <p className={cn('text-2xl font-bold', avgConfidence >= 70 ? 'text-emerald-600' : avgConfidence >= 50 ? 'text-amber-600' : 'text-red-600')}>
                {safeNum(avgConfidence).toFixed(0)}%
              </p>
            </div>
            <div className="rounded-xl border p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">متوسط إمكانية النمو</p>
              <p className="text-2xl font-bold text-emerald-600">+{safeNum(avgUpside).toFixed(1)}%</p>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-muted/50 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">إجمالي محلل</p>
              <p className="text-sm font-bold">{market.totalStocksAnalyzed}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">اجتاز الأمان</p>
              <p className="text-sm font-bold text-emerald-600">{market.passedSafetyFilter}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">تحليلات شراء</p>
              <p className="text-sm font-bold text-emerald-600">{market.recommendations.strongBuy + market.recommendations.buy}</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            نسخة التحليل: <span className="font-bold text-foreground">{v2Data.analysisVersion}</span>
            {' — '}
            تم التحليل: <span className="font-bold text-foreground">{v2Data.generatedAt ? new Date(v2Data.generatedAt).toLocaleString('ar-EG') : '—'}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== V2: NEW SECTION — CONFIDENCE DETAIL ====================

function V2ConfidenceDetail() {
  const { v2Data } = useAppStore();
  if (!v2Data) return null;

  const top3 = [...v2Data.stocks]
    .filter(s => s.confidenceBreakdown)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  if (top3.length === 0) return null;

  const breakdownLabels: { key: keyof ConfidenceBreakdown; labelAr: string; icon: React.ReactNode }[] = [
    { key: 'qualityScore', labelAr: 'جودة الشركة', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { key: 'technicalScore', labelAr: 'التوقيت الفني', icon: <Activity className="w-3.5 h-3.5" /> },
    { key: 'valuationScore', labelAr: 'التقييم', icon: <Target className="w-3.5 h-3.5" /> },
    { key: 'momentumScore', labelAr: 'الزخم', icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { key: 'dataReliability', labelAr: 'موثوقية البيانات', icon: <Info className="w-3.5 h-3.5" /> },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">تفصيل الثقة — أفضل 3 تحليلات</CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground">
              تحليل مكونات درجة الثقة لكل سهم: الجودة، التحليل الفني، التقييم، الزخم، وموثوقية البيانات
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {top3.map((stock) => {
            const bd = stock.confidenceBreakdown!;
            const rec = getV2RecommendationBadge(stock.recommendation);

            return (
              <div key={stock.ticker} className="rounded-xl border p-4 space-y-3">
                {/* Stock header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground">{stock.ticker}</span>
                    <span className="text-xs text-muted-foreground">{stock.nameAr}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn(
                      'text-[10px] font-bold border-0 px-2 py-0.5',
                      stock.confidence >= 70 && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
                      stock.confidence >= 50 && stock.confidence < 70 && 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
                      stock.confidence < 50 && 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
                    )}>
                      إجمالي الثقة: {safeNum(stock.confidence).toFixed(0)}%
                    </Badge>
                    <div className={cn('px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 border', rec.bg, rec.color, rec.border)}>
                      {rec.icon}{rec.label}
                    </div>
                  </div>
                </div>

                {/* Confidence bars */}
                <div className="space-y-2.5">
                  {breakdownLabels.map(({ key, labelAr, icon }) => {
                    const score = bd[key];
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 min-w-[110px]">
                          <span className="text-muted-foreground">{icon}</span>
                          <span className="text-[11px] text-muted-foreground">{labelAr}</span>
                        </div>
                        <div className="flex-1">
                          <div className="h-3 rounded-full bg-muted/40 overflow-hidden">
                            <div
                              className={cn('h-full rounded-full transition-all duration-500', getConfidenceBarColor(score))}
                              style={{ width: `${Math.min(score, 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className={cn(
                          'text-[11px] font-bold min-w-[28px] text-left tabular-nums',
                          score >= 70 && 'text-emerald-600 dark:text-emerald-400',
                          score >= 50 && score < 70 && 'text-amber-600 dark:text-amber-400',
                          score < 50 && 'text-red-600 dark:text-red-400',
                        )}>
                          {score}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== V2: NEW SECTION — DIVERSIFICATION WARNING ====================

function V2DiversificationWarning() {
  const { v2Data } = useAppStore();
  if (!v2Data) return null;

  const { market, stocks } = v2Data;
  const issues = market.diversificationIssues || [];
  const capDist = market.capDistribution;

  // Check if there are no large-cap stocks in buy recommendations
  const buyStocks = stocks.filter(s => s.recommendation === 'Strong Buy' || s.recommendation === 'Buy');
  const hasLargeCapInBuys = buyStocks.some(s => s.marketCapCategory === 'large');
  const hasMidCapInBuys = buyStocks.some(s => s.marketCapCategory === 'mid');
  const onlySmallCaps = buyStocks.length > 0 && !hasLargeCapInBuys && !hasMidCapInBuys;

  // Build issue list
  const allIssues: string[] = [...issues];

  if (onlySmallCaps) {
    allIssues.push('جميع التحليلات الشرائية لأسهم رأس مال صغير فقط — قد يكون المخاطرة أعلى');
  }

  if (capDist && capDist.large === 0) {
    allIssues.push('لا توجد أسهم رأس مال كبير في التحليل الحالي');
  }

  if (allIssues.length === 0) return null;

  return (
    <Card className="border-2 border-amber-300 dark:border-amber-700 bg-gradient-to-br from-amber-50/80 to-white dark:from-amber-950/20 dark:to-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center">
            <PieChart className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold text-amber-700 dark:text-amber-400">⚠️ تنبيهات التنويع</CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground">
              تحليل تنوع المحفظة وتوزيع المخاطر
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          <ul className="space-y-1.5">
            {allIssues.map((issue, idx) => (
              <li key={idx} className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-500">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>

          {/* Suggestions */}
          {onlySmallCaps && (
            <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
              <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mb-1">💡 اقتراح:</p>
              <p className="text-[11px] text-amber-600 dark:text-amber-500">
                يُنصح بإضافة أسهم من فئة رأس مال كبير أو متوسط لتحسين توازن المحفظة وتقليل المخاطر. الأسهم الكبيرة توفر استقراراً أكبر في فترات التقلب.
              </p>
            </div>
          )}

          {/* Cap distribution quick view */}
          {capDist && (
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground mb-1.5">توزيع فئات القيمة السوقية في التحليل:</p>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-sky-500" />
                  <span className="text-[11px]">كبير: <strong className="text-sky-700 dark:text-sky-300">{capDist.large}</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-purple-500" />
                  <span className="text-[11px]">متوسط: <strong className="text-purple-700 dark:text-purple-300">{capDist.mid}</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-orange-500" />
                  <span className="text-[11px]">صغير: <strong className="text-orange-700 dark:text-orange-300">{capDist.small}</strong></span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== FALLBACK: OLD API COMPONENTS ====================

function OldMarketOutlookHeader() {
  const { aiInsights } = useAppStore();
  if (!aiInsights) return null;

  const sentimentInfo = getSentimentInfo(aiInsights.market_sentiment);
  const riskInfo = getRiskLabel(aiInsights.risk_assessment);
  const totalStocks = aiInsights.gainers + aiInsights.losers + aiInsights.unchanged;
  const breadthPercent = aiInsights.market_breadth;

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg">نظرة السوق العامة</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="relative inline-flex items-center justify-center w-40 h-40">
              <svg width={160} height={160} className="-rotate-90">
                <circle cx="80" cy="80" r="72" fill="none" stroke="currentColor" strokeWidth={10} className="text-muted/30" />
                <circle
                  cx="80" cy="80" r="72" fill="none"
                  stroke={aiInsights.market_score >= 70 ? '#10b981' : aiInsights.market_score >= 55 ? '#22c55e' : aiInsights.market_score >= 45 ? '#f59e0b' : '#ef4444'}
                  strokeWidth={10} strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 72}
                  strokeDashoffset={2 * Math.PI * 72 - (aiInsights.market_score / 100) * 2 * Math.PI * 72}
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold">{safeNum(aiInsights.market_score).toFixed(0)}</span>
                <span className="text-xs text-muted-foreground">من 100</span>
              </div>
            </div>
            <div className={cn('flex items-center gap-2 px-4 py-2 rounded-full text-base font-bold', sentimentInfo.bg, sentimentInfo.color)}>
              {sentimentInfo.icon}
              <span>{sentimentInfo.label}</span>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-4">
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground mb-1.5">القرار الموصى به</p>
              <p className="text-sm font-bold text-foreground leading-relaxed">{getDecisionLabel(aiInsights.decision)}</p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border p-4">
              {getRiskIcon(aiInsights.risk_assessment)}
              <div>
                <p className="text-xs text-muted-foreground">مستوى المخاطر</p>
                <div className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold mt-0.5', riskInfo.bg, riskInfo.color)}>
                  {riskInfo.label}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/50 p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">التقلبات</p>
                <p className="text-sm font-bold text-foreground">{safeNum(aiInsights.volatility_index).toFixed(2)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">متوسط التغير</p>
                <p className={cn('text-sm font-bold', aiInsights.avg_change_percent >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                  {aiInsights.avg_change_percent >= 0 ? '+' : ''}{safeNum(aiInsights.avg_change_percent).toFixed(2)}%
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-4">
            <div className="rounded-xl border p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">اتساع السوق</p>
                <span className="text-sm font-bold">{safeNum(breadthPercent).toFixed(0)}%</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div className={cn('h-full rounded-full transition-all duration-700', breadthPercent >= 50 ? 'bg-emerald-500' : 'bg-red-500')} style={{ width: `${breadthPercent}%` }} />
              </div>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground mb-2">توزيع الأسهم</p>
              <div className="flex h-5 rounded-full overflow-hidden mb-2">
                <div className="bg-emerald-500" style={{ width: `${(aiInsights.gainers / totalStocks) * 100}%` }} />
                <div className="bg-gray-400 dark:bg-gray-600" style={{ width: `${(aiInsights.unchanged / totalStocks) * 100}%` }} />
                <div className="bg-red-500" style={{ width: `${(aiInsights.losers / totalStocks) * 100}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">مرتفع: </span>
                  <span className="font-bold text-emerald-600">{aiInsights.gainers}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-600" />
                  <span className="text-muted-foreground">ثابت: </span>
                  <span className="font-bold">{aiInsights.unchanged}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-muted-foreground">منخفض: </span>
                  <span className="font-bold text-red-600">{aiInsights.losers}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OldStockTable() {
  const { aiInsights, loadStockDetail } = useAppStore();
  const [page, setPage] = useState(1);
  const [filterScore, setFilterScore] = useState<string>('all');

  const sortedStocks = useMemo(() => {
    if (!aiInsights) return [];
    let stocks = [...aiInsights.stock_statuses].sort((a, b) => b.score - a.score);
    if (filterScore !== 'all') {
      const min = Number(filterScore);
      stocks = stocks.filter(s => s.score >= min);
    }
    return stocks;
  }, [aiInsights, filterScore]);

  if (!aiInsights) return null;

  const totalPages = Math.ceil(sortedStocks.length / PAGE_SIZE);
  const paginatedStocks = sortedStocks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filters = [
    { value: 'all', label: 'الكل' },
    { value: '75', label: 'شراء قوي' },
    { value: '55', label: 'شراء' },
    { value: '42', label: 'متابعة' },
    { value: '28', label: 'بيع' },
    { value: '0', label: 'بيع قوي' },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">تحليلات الأسهم</CardTitle>
            <Badge variant="secondary" className="text-xs">{sortedStocks.length} سهم</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filters.map(f => (
              <Button key={f.value} size="sm" variant={filterScore === f.value ? 'default' : 'outline'}
                className={cn('text-xs h-7 px-2.5', filterScore === f.value && 'bg-primary text-primary-foreground')}
                onClick={() => { setFilterScore(f.value); setPage(1); }}>
                {f.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="sticky top-0 bg-background z-10">
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead className="w-20">الرمز</TableHead>
                <TableHead className="hidden md:table-cell">الاسم</TableHead>
                <TableHead className="hidden lg:table-cell">القطاع</TableHead>
                <TableHead className="text-center">السعر</TableHead>
                <TableHead className="text-center">التغير</TableHead>
                <TableHead className="text-center">القيمة العادلة</TableHead>
                <TableHead className="text-center hidden md:table-cell">التقييم</TableHead>
                <TableHead className="text-center w-20">النتيجة</TableHead>
                <TableHead className="text-center w-20">التحليل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedStocks.map((stock, idx) => {
                const rec = getOldRecommendation(stock.score);
                const globalRank = (page - 1) * PAGE_SIZE + idx + 1;
                const changeColor = stock.price_change >= 0 ? 'text-emerald-600' : 'text-red-600';
                return (
                  <TableRow key={stock.ticker} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => loadStockDetail(stock.ticker)}>
                    <TableCell className="text-center text-xs text-muted-foreground font-mono">{globalRank}</TableCell>
                    <TableCell><span className="font-bold text-xs">{stock.ticker}</span></TableCell>
                    <TableCell className="hidden md:table-cell"><span className="text-xs text-muted-foreground truncate max-w-[120px] block">{stock.name_ar}</span></TableCell>
                    <TableCell className="hidden lg:table-cell"><Badge variant="outline" className="text-[9px] font-normal">{stock.sector}</Badge></TableCell>
                    <TableCell className="text-center font-mono text-xs">{safeNum(stock.current_price).toFixed(2)}</TableCell>
                    <TableCell className={cn('text-center font-mono text-xs font-medium', changeColor)}>
                      {stock.price_change >= 0 ? '+' : ''}{safeNum(stock.price_change).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">{safeNum(stock.fair_value).toFixed(2)}</TableCell>
                    <TableCell className="text-center hidden md:table-cell">
                      <Badge variant="outline" className={cn(
                        'text-[9px] font-bold border-0',
                        stock.verdict === 'undervalued' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
                        stock.verdict === 'fair' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
                        stock.verdict === 'overvalued' && 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
                      )}>{stock.verdict_ar}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center gap-1.5 justify-center">
                        <Progress value={stock.score} className={cn('h-1.5 w-16', getScoreBarColor(stock.score))} />
                        <span className={cn('text-xs font-bold min-w-[24px]', rec.color)}>{safeNum(stock.score).toFixed(0)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold', rec.bg, rec.color, rec.border)}>
                        {rec.icon}<span>{rec.label}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4 pt-3 border-t">
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground px-3">{page} / {totalPages}</span>
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OldBestOpportunities() {
  const { aiInsights, loadStockDetail } = useAppStore();
  if (!aiInsights) return null;

  const best = [...aiInsights.stock_statuses]
    .filter(s => s.upside_to_fair > 10 && s.current_price > 0)
    .sort((a, b) => b.upside_to_fair - a.upside_to_fair)
    .slice(0, 5);

  if (best.length === 0) return null;

  return (
    <Card className="border-2 border-emerald-300 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/80 to-white dark:from-emerald-950/30 dark:to-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-emerald-700 dark:text-emerald-400">🏆 أفضل الفرص الاستثمارية</CardTitle>
              <p className="text-[10px] text-muted-foreground">الأسهم الأكثر مقومة بأقل من قيمتها العادلة</p>
            </div>
          </div>
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 border-0 text-[10px]">{best.length} فرص</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1.5">
          {best.map((stock, i) => {
            const rec = getOldRecommendation(stock.score);
            const isDataOk = stock.data_quality_reliable !== false;
            return (
              <div key={stock.ticker} className="flex items-center gap-2 p-2 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 bg-white/60 dark:bg-emerald-950/10 cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                onClick={() => loadStockDetail(stock.ticker)}>
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-emerald-500 text-white font-bold text-[10px] flex-shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-bold text-xs text-foreground">{stock.ticker}</span>
                    <span className="text-[10px] text-muted-foreground truncate">{stock.name_ar}</span>
                    <div className={cn('ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold inline-flex items-center gap-0.5 border', rec.bg, rec.color, rec.border)}>
                      {rec.icon}{rec.label}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>السعر: <strong className="text-foreground tabular-nums" dir="ltr">{safeNum(stock.current_price).toFixed(2)}</strong></span>
                    <span>→</span>
                    <span>القيمة العادلة: <strong className={cn(isDataOk ? 'text-emerald-600' : 'text-amber-600', 'tabular-nums')} dir="ltr">{safeNum(stock.fair_value).toFixed(2)}</strong></span>
                    <Badge variant="outline" className={cn(
                      'border-0 text-[9px] font-bold',
                      stock.upside_to_fair > 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400' : 'bg-muted/50 text-muted-foreground'
                    )}>
                      {stock.upside_to_fair > 0 ? '+' : ''}{safeNum(stock.upside_to_fair).toFixed(1)}%
                    </Badge>
                    {!isDataOk && (
                      <Badge variant="outline" className="border-0 text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                        ⚠
                      </Badge>
                    )}
                    <ShareButton
                      stockData={{
                        ticker: stock.ticker,
                        name: stock.name,
                        nameAr: stock.name_ar,
                        price: stock.current_price,
                        change: stock.price_change,
                        recommendation: rec.label,
                        fairValue: stock.fair_value,
                        upsidePotential: stock.upside_to_fair,
                        sector: stock.sector,
                      }}
                      iconOnly
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 -ml-1"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function OldQuickSummary() {
  const { aiInsights } = useAppStore();
  if (!aiInsights) return null;

  const sentimentInfo = getSentimentInfo(aiInsights.market_sentiment);
  const riskInfo = getRiskLabel(aiInsights.risk_assessment);

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">ملخص سريع</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">نتيجة السوق</p>
              <p className={cn('text-2xl font-bold', sentimentInfo.color)}>{safeNum(aiInsights.market_score).toFixed(1)}</p>
            </div>
            <div className="rounded-xl border p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">مؤشر التقلبات</p>
              <p className="text-2xl font-bold text-foreground">{safeNum(aiInsights.volatility_index).toFixed(2)}</p>
            </div>
            <div className="rounded-xl border p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">متوسط التغير</p>
              <p className={cn('text-2xl font-bold', aiInsights.avg_change_percent >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                {aiInsights.avg_change_percent >= 0 ? '+' : ''}{safeNum(aiInsights.avg_change_percent).toFixed(2)}%
              </p>
            </div>
            <div className="rounded-xl border p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">مستوى المخاطر</p>
              <div className={cn('inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-bold', riskInfo.bg, riskInfo.color)}>{riskInfo.label}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            التحليل مبني على <span className="font-bold text-foreground">{aiInsights.stock_statuses.length}</span> سهم تم تحليلهم
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== LOADING SKELETON ====================

function V2LoadingSkeleton() {
  return (
    <div className="space-y-5" dir="rtl">
      <Card className="border-2">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <Skeleton className="h-6 w-40" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-4">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
            <Skeleton className="h-60 w-full rounded-xl" />
            <div className="space-y-4">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

export function AiRecommendations() {
  const { v2Data, v2Loading, v2Error, loadV2Recommendations, aiInsights } = useAppStore();
  const [exporting, setExporting] = useState(false);

  // ===== AUTO-REFRESH STATE =====
  const [liveData, setLiveData] = useState<{
    aiCommentary: string | null;
    changes: Array<{
      type: string; ticker: string; nameAr: string; current: string;
      severity: string; message: string; messageAr: string;
    }>;
    analyzedAt: string | null;
    processingTimeMs: number;
  } | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const REFRESH_INTERVAL_MINUTES = 15;

  // ===== LIVE ANALYSIS FETCH =====
  const fetchLiveAnalysis = useCallback(async () => {
    setLiveLoading(true);
    try {
      const res = await fetch('/api/v2/live-analysis');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Update V2 data in store (it uses the same endpoint internally)
      setLiveData({
        aiCommentary: data._live?.aiCommentary || null,
        changes: data._live?.changes || [],
        analyzedAt: data._live?.analyzedAt || data.generatedAt,
        processingTimeMs: data._live?.processingTimeMs || 0,
      });

      // Reset countdown
      setCountdown(REFRESH_INTERVAL_MINUTES * 60);
    } catch (err) {
      console.warn('[Live Analysis] Failed:', err);
    } finally {
      setLiveLoading(false);
    }
  }, []);

  // ===== AUTO-REFRESH EFFECT =====
  useEffect(() => {
    if (!autoRefreshEnabled) {
      // Cleanup
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      setCountdown(null);
      return;
    }

    // Initial fetch after 3 seconds (let page load first)
    const initialTimeout = setTimeout(() => {
      fetchLiveAnalysis();
    }, 3000);

    // Refresh every 15 minutes
    refreshIntervalRef.current = setInterval(() => {
      fetchLiveAnalysis();
    }, REFRESH_INTERVAL_MINUTES * 60 * 1000);

    // Countdown timer
    setCountdown(REFRESH_INTERVAL_MINUTES * 60);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          // Will trigger refresh on next cycle
          return REFRESH_INTERVAL_MINUTES * 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(initialTimeout);
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefreshEnabled, fetchLiveAnalysis]);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('recommendations-export');
      if (!element) {
        toast.error('لم يتم العثور على محتوى التحليلات');
        return;
      }
      await exportToPdf(element, {
        filename: `ai_recommendations_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  // Try loading V2 data if not yet loaded (stop retrying after error)
  useEffect(() => {
    if (!v2Data && !v2Loading && !v2Error) {
      loadV2Recommendations();
    }
  }, [v2Data, v2Loading, v2Error, loadV2Recommendations]);

  // Show loading for V2
  if (v2Loading && !v2Data && !aiInsights) {
    return <V2LoadingSkeleton />;
  }

  // Format countdown
  const countdownDisplay = countdown !== null
    ? `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`
    : null;

  // If V2 data is available, show V2 view
  if (v2Data) {
    return (
      <div id="recommendations-export" dir="rtl">
        {/* Legal Disclaimer Banner */}
        <div className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 p-3 print:hidden">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-amber-800 dark:text-amber-200 font-bold mb-0.5">إخلاء مسؤولية</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                هذه المنصة لأغراض تعليمية وتحليلية فقط. المحتوى لا يُعد توصية استثمارية أو نصيحة مالية.
                استشر متخصصًا ماليًا مرخصًا قبل اتخاذ أي قرار استثمار. جميع التحليلات مبينة على بيانات تاريخية وقد لا تعكس الأداء المستقبلي.
              </p>
            </div>
          </div>
        </div>

        {/* Live Analysis Bar */}
        <div className="print:hidden mb-4 space-y-3">
          {/* Top controls row */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {/* Live indicator */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">تحليل مباشر</span>
              </div>

              {/* Last updated */}
              {liveData?.analyzedAt && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  <span>آخر تحديث: {new Date(liveData.analyzedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                  {liveData.processingTimeMs > 0 && (
                    <span className="text-[10px] text-muted-foreground/60">({liveData.processingTimeMs}ms)</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Countdown */}
              {countdownDisplay && autoRefreshEnabled && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/50 border">
                  <Timer className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-mono text-muted-foreground">{countdownDisplay}</span>
                </div>
              )}

              {/* Manual refresh */}
              <Button
                size="sm"
                variant="outline"
                onClick={fetchLiveAnalysis}
                disabled={liveLoading}
                className="gap-1.5 h-8"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', liveLoading && 'animate-spin')} />
                <span className="text-xs">{liveLoading ? 'جارٍ التحليل...' : 'تحديث الآن'}</span>
              </Button>

              {/* Toggle auto-refresh */}
              <Button
                size="sm"
                variant={autoRefreshEnabled ? 'default' : 'outline'}
                onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
                className={cn('gap-1.5 h-8', autoRefreshEnabled && 'bg-emerald-600 hover:bg-emerald-700')}
              >
                <Radio className="w-3.5 h-3.5" />
                <span className="text-xs">{autoRefreshEnabled ? 'تحديث تلقائي' : 'يدوي'}</span>
              </Button>

              {/* PDF Export */}
              <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-1.5 h-8">
                <Download className="w-3.5 h-3.5" />
                <span className="text-xs">{exporting ? 'جارٍ...' : 'PDF'}</span>
              </Button>
            </div>
          </div>

          {/* AI Commentary */}
          {liveLoading && !liveData && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">جارٍ تحليل السوق بالذكاء الاصطناعي...</span>
            </div>
          )}

          {liveData?.aiCommentary && (
            <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold text-foreground">تحليل الذكاء الاصطناعي</span>
                {liveLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              </div>
              <div className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {liveData.aiCommentary}
              </div>
            </div>
          )}

          {/* Changes alerts */}
          {liveData?.changes && liveData.changes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {liveData.changes.map((change, idx) => (
                <div
                  key={`${change.ticker}-${idx}`}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] max-w-full',
                    change.severity === 'high' && 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400',
                    change.severity === 'medium' && 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400',
                    change.severity === 'low' && 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400',
                  )}
                >
                  {change.type === 'upgrade' || change.type === 'new_buy' ? (
                    <TrendingUp className="w-3 h-3 flex-shrink-0" />
                  ) : change.type === 'downgrade' || change.type === 'new_sell' ? (
                    <TrendingDown className="w-3 h-3 flex-shrink-0" />
                  ) : (
                    <Activity className="w-3 h-3 flex-shrink-0" />
                  )}
                  <span className="truncate">{change.messageAr}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
        {/* Section 1: Market Overview (Enhanced with cap distribution & diversification) */}
        <section aria-label="نظرة السوق">
          <V2MarketOverview />
        </section>

        {/* Section 2: Stock Recommendations Table (Enhanced with new columns) */}
        <section aria-label="تحليلات الأسهم">
          <V2StocksTable />
        </section>

        {/* Section 3: Recommendation Distribution */}
        <section aria-label="توزيع التحليلات">
          <V2RecommendationDistribution />
        </section>

        {/* Section 4: Best Opportunities (Complete Redesign) */}
        <section aria-label="أفضل الفرص">
          <V2BestOpportunities />
        </section>

        {/* Section 5 + 6: Quick Summary + Confidence Detail (side by side) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section aria-label="ملخص سريع">
            <V2QuickSummary />
          </section>
          <section aria-label="تفصيل الثقة">
            <V2ConfidenceDetail />
          </section>
        </div>

        {/* Section 7: Diversification Warning (if applicable) */}
        <section aria-label="تنبيهات التنويع">
          <V2DiversificationWarning />
        </section>
        </div>
      </div>
    );
  }

  // Fallback to old API data
  if (aiInsights) {
    return (
      <div id="recommendations-export" dir="rtl">
        {/* Legal Disclaimer Banner */}
        <div className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 p-3 print:hidden">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-amber-800 dark:text-amber-200 font-bold mb-0.5">إخلاء مسؤولية</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                هذه المنصة لأغراض تعليمية وتحليلية فقط. المحتوى لا يُعد توصية استثمارية أو نصيحة مالية.
                استشر متخصصًا ماليًا مرخصًا قبل اتخاذ أي قرار استثمار. جميع التحليلات مبينة على بيانات تاريخية وقد لا تعكس الأداء المستقبلي.
              </p>
            </div>
          </div>
        </div>

        <div className="print:hidden mb-3">
          <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-2">
            <Download className="w-4 h-4" />
            {exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}
          </Button>
        </div>
        <div className="space-y-5">
        <section aria-label="نظرة السوق">
          <OldMarketOutlookHeader />
        </section>
        <section aria-label="تحليلات الأسهم">
          <OldStockTable />
        </section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section aria-label="أفضل الفرص">
            <OldBestOpportunities />
          </section>
          <section aria-label="ملخص سريع">
            <OldQuickSummary />
          </section>
        </div>
        </div>
      </div>
    );
  }

  // Nothing available yet
  return (
    <V2LoadingSkeleton />
  );
}

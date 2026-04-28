'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Download,
  Search,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Shield,
  BarChart3,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { ShareButton } from '@/components/share/ShareButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import type { Stock } from '@/types';
import { toast } from 'sonner';

/* ========== Types ========== */
interface ProfessionalAnalysis {
  ticker: string;
  scores: {
    composite: number;
    technical: number;
    value: number;
    quality: number;
    momentum: number;
    risk: number;
  };
  indicators: {
    rsi: { value: number; signal: string };
    macd: { line: number; signal: number; histogram: number; signal_text: string };
    bollinger: { upper: number; middle: number; lower: number; position: number; signal_text: string };
    stochastic_rsi: { k: number; d: number; signal_text: string };
    atr: number;
    atr_percent: number;
    obv: number;
    obv_trend: string;
    vwap: number;
    roc: { roc_5: number; roc_10: number; roc_20: number; signal_text: string };
  };
  trend: {
    direction: string;
    direction_ar: string;
    strength: string;
    strength_ar: string;
  };
  recommendation: {
    action: string;
    action_ar: string;
    confidence: number;
    entry_price: number;
    target_price: number;
    stop_loss: number;
    risk_reward_ratio: number;
    time_horizon: string;
    time_horizon_ar: string;
    summary_ar: string;
  };
  price_levels: {
    support_1: number;
    support_2: number;
    resistance_1: number;
    resistance_2: number;
    pivot: number;
  };
  volume_analysis: {
    avg_volume_20: number;
    current_vs_avg: number;
    signal: string;
    signal_ar: string;
  };
  risk_metrics: {
    sharpe_ratio: number;
    max_drawdown: number;
    max_drawdown_percent: number;
    var_95: number;
    beta: number;
    volatility_annualized: number;
  };
  patterns: {
    detected: Array<{
      name: string;
      name_ar: string;
      type: string;
      reliability: string;
    }>;
    ma_cross: {
      signal: string;
      description: string;
    } | null;
  };
  data_quality: {
    history_points: number;
    quality: string;
  };
  fair_value?: {
    graham_number: number;
    lynch_value: number;
    dcf_simplified: number;
    pe_based: number;
    average_fair_value: number;
    upside_to_fair: number;
    verdict: string;
    verdict_ar: string;
  };
}

/* ========== Helper: Extract Professional Analysis from raw API response ========== */
function extractProfessional(raw: Record<string, unknown>): ProfessionalAnalysis | null {
  try {
    const prof = raw.professional as Record<string, unknown> | undefined;
    if (!prof) return null;

    const scores = prof.scores as Record<string, unknown> || {};
    const indicators = prof.indicators as Record<string, unknown> || {};
    const rsi = indicators.rsi as Record<string, unknown> || {};
    const macd = indicators.macd as Record<string, unknown> || {};
    const bb = indicators.bollinger as Record<string, unknown> || {};
    const stoch = indicators.stochastic_rsi as Record<string, unknown> || {};
    const roc = indicators.roc as Record<string, unknown> || {};
    const trend = prof.trend as Record<string, unknown> || {};
    const rec = prof.recommendation as Record<string, unknown> || {};
    const pl = prof.price_levels as Record<string, unknown> || {};
    const vol = prof.volume_analysis as Record<string, unknown> || {};
    const risk = prof.risk_metrics as Record<string, unknown> || {};
    const patternsObj = prof.patterns as Record<string, unknown> || {};
    const detected = (patternsObj.detected as Array<Record<string, unknown>>) || [];
    const maCross = patternsObj.ma_cross as Record<string, unknown> | null;
    const dataQuality = prof.data_quality as Record<string, unknown> || {};
    const fairValue = prof.fair_value as Record<string, unknown> | undefined;

    return {
      ticker: String(raw.ticker || ''),
      scores: {
        composite: Number(scores.composite || 50),
        technical: Number(scores.technical || 50),
        value: Number(scores.value || 50),
        quality: Number(scores.quality || 50),
        momentum: Number(scores.momentum || 50),
        risk: Number(scores.risk || 50),
      },
      indicators: {
        rsi: { value: Number(rsi.value || 50), signal: String(rsi.signal || 'neutral') },
        macd: {
          line: Number(macd.line || 0),
          signal: Number(macd.signal || 0),
          histogram: Number(macd.histogram || 0),
          signal_text: String(macd.signal_text || 'محايد'),
        },
        bollinger: {
          upper: Number(bb.upper || 0),
          middle: Number(bb.middle || 0),
          lower: Number(bb.lower || 0),
          position: Number(bb.position || 50),
          signal_text: String(bb.signal_text || 'محايد'),
        },
        stochastic_rsi: { k: Number(stoch.k || 50), d: Number(stoch.d || 50), signal_text: String(stoch.signal_text || 'محايد') },
        atr: Number(indicators.atr || 0),
        atr_percent: Number(indicators.atr_percent || 0),
        obv: Number(indicators.obv || 0),
        obv_trend: String(indicators.obv_trend || 'محايد'),
        vwap: Number(indicators.vwap || 0),
        roc: {
          roc_5: Number(roc.roc_5 || 0),
          roc_10: Number(roc.roc_10 || 0),
          roc_20: Number(roc.roc_20 || 0),
          signal_text: String(roc.signal_text || ''),
        },
      },
      trend: {
        direction: String(trend.direction || 'neutral'),
        direction_ar: String(trend.direction_ar || 'عرضي'),
        strength: String(trend.strength || 'moderate'),
        strength_ar: String(trend.strength_ar || 'متوسط'),
      },
      recommendation: {
        action: String(rec.action || 'hold'),
        action_ar: String(rec.action_ar || 'احتفاظ'),
        confidence: Number(rec.confidence || 50),
        entry_price: Number(rec.entry_price || 0),
        target_price: Number(rec.target_price || 0),
        stop_loss: Number(rec.stop_loss || 0),
        risk_reward_ratio: Number(rec.risk_reward_ratio || 0),
        time_horizon: String(rec.time_horizon || 'medium_term'),
        time_horizon_ar: String(rec.time_horizon_ar || 'متوسط الأجل'),
        summary_ar: String(rec.summary_ar || ''),
      },
      price_levels: {
        support_1: Number(pl.support_1 || 0),
        support_2: Number(pl.support_2 || 0),
        resistance_1: Number(pl.resistance_1 || 0),
        resistance_2: Number(pl.resistance_2 || 0),
        pivot: Number(pl.pivot || 0),
      },
      volume_analysis: {
        avg_volume_20: Number(vol.avg_volume_20 || 0),
        current_vs_avg: Number(vol.current_vs_avg || 1),
        signal: String(vol.signal || 'normal'),
        signal_ar: String(vol.signal_ar || 'عادي'),
      },
      risk_metrics: {
        sharpe_ratio: Number(risk.sharpe_ratio || 0),
        max_drawdown: Number(risk.max_drawdown || 0),
        max_drawdown_percent: Number(risk.max_drawdown_percent || 0),
        var_95: Number(risk.var_95 || 0),
        beta: Number(risk.beta || 1),
        volatility_annualized: Number(risk.volatility_annualized || 0),
      },
      patterns: {
        detected: detected.map((p) => ({
          name: String(p.name || ''),
          name_ar: String(p.name_ar || ''),
          type: String(p.type || ''),
          reliability: String(p.reliability || ''),
        })),
        ma_cross: maCross ? { signal: String(maCross.signal || ''), description: String(maCross.description || '') } : null,
      },
      data_quality: {
        history_points: Number(dataQuality.history_points || 0),
        quality: String(dataQuality.quality || 'low'),
      },
      fair_value: fairValue ? {
        graham_number: Number(fairValue.graham_number || 0),
        lynch_value: Number(fairValue.lynch_value || 0),
        dcf_simplified: Number(fairValue.dcf_simplified || 0),
        pe_based: Number(fairValue.pe_based || 0),
        average_fair_value: Number(fairValue.average_fair_value || 0),
        upside_to_fair: Number(fairValue.upside_to_fair || 0),
        verdict: String(fairValue.verdict || 'fair'),
        verdict_ar: String(fairValue.verdict_ar || 'عادل التقييم'),
      } : undefined,
    };
  } catch {
    return null;
  }
}

/* ========== Score Color Helper ========== */
function getScoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function getScoreBg(score: number): string {
  if (score >= 70) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (score >= 50) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
}

function getSignalColor(signal: string): string {
  const s = signal.toLowerCase();
  if (s.includes('buy') || s.includes('شراء') || s.includes('bullish') || s.includes('صاعد')) return 'text-emerald-600 dark:text-emerald-400';
  if (s.includes('sell') || s.includes('بيع') || s.includes('bearish') || s.includes('هابط')) return 'text-red-600 dark:text-red-400';
  return 'text-amber-600 dark:text-amber-400';
}

/* ========== Price Performance Card ========== */
function PricePerformanceCard({ stock }: { stock: Stock }) {
  const currentPrice = Number(stock.current_price) || 0;
  const prevClose = Number(stock.previous_close) || 0;
  const openPrice = Number(stock.open_price) || 0;
  const highPrice = Number(stock.high_price) || 0;
  const lowPrice = Number(stock.low_price) || 0;
  const volume = Number(stock.volume) || 0;
  const marketCap = Number(stock.market_cap) || 0;
  const peRatio = Number(stock.pe_ratio) || 0;
  const pbRatio = Number(stock.pb_ratio) || 0;
  const priceChange = currentPrice - prevClose;
  const priceChangePct = prevClose > 0 ? (priceChange / prevClose) * 100 : 0;
  const isUp = priceChange >= 0;

  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          أداء السعر
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-4">
          <div>
            <p className="text-3xl font-bold tabular-nums">{currentPrice.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">ج.م</p>
          </div>
          <div className={cn('px-3 py-1.5 rounded-lg', isUp ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-red-50 dark:bg-red-950/40')}>
            <span className={cn('text-sm font-bold', isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              {isUp ? '+' : ''}{priceChange.toFixed(2)} ({isUp ? '+' : ''}{priceChangePct.toFixed(2)}%)
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">الافتتاح</p>
            <p className="text-sm font-semibold tabular-nums">{openPrice.toFixed(2)}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">الأعلى</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-600">{highPrice.toFixed(2)}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">الأدنى</p>
            <p className="text-sm font-semibold tabular-nums text-red-600">{lowPrice.toFixed(2)}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">الحجم</p>
            <p className="text-sm font-semibold tabular-nums">{volume >= 1000000 ? `${(volume / 1000000).toFixed(2)}M` : volume.toLocaleString()}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">القيمة السوقية</p>
            <p className="text-sm font-semibold tabular-nums">{marketCap >= 1000000000 ? `${(marketCap / 1000000000).toFixed(2)}B` : marketCap >= 1000000 ? `${(marketCap / 1000000).toFixed(2)}M` : marketCap.toLocaleString()}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">P/E</p>
            <p className="text-sm font-semibold tabular-nums">{peRatio.toFixed(1)}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">P/B</p>
            <p className="text-sm font-semibold tabular-nums">{pbRatio.toFixed(2)}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">القطاع</p>
            <p className="text-sm font-semibold truncate">{stock.sector}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Technical Indicators Table ========== */
function TechnicalIndicatorsTable({ analysis }: { analysis: ProfessionalAnalysis }) {
  const ind = analysis.indicators;
  const bbRange = ind.bollinger.upper > ind.bollinger.lower ? ind.bollinger.upper - ind.bollinger.lower : 0;
  const bbBandwidth = bbRange > 0 && ind.bollinger.middle > 0 ? (bbRange / ind.bollinger.middle) * 100 : 0;

  const rows = [
    { name: 'RSI (14)', value: ind.rsi.value.toFixed(1), signal: ind.rsi.signal === 'overbought' ? 'تشبع شراء' : ind.rsi.signal === 'oversold' ? 'تشبع بيع' : 'محايد' },
    { name: 'MACD', value: ind.macd.line.toFixed(3), signal: ind.macd.signal_text },
    { name: 'MACD Signal', value: ind.macd.signal.toFixed(3), signal: ind.macd.histogram > 0 ? 'إيجابي' : 'سلبي' },
    { name: 'MACD Histogram', value: ind.macd.histogram.toFixed(3), signal: ind.macd.histogram > 0 ? 'صاعد' : 'هابط' },
    { name: 'Bollinger Upper', value: ind.bollinger.upper.toFixed(2), signal: '' },
    { name: 'Bollinger Middle', value: ind.bollinger.middle.toFixed(2), signal: '' },
    { name: 'Bollinger Lower', value: ind.bollinger.lower.toFixed(2), signal: '' },
    { name: 'BB Position', value: `${ind.bollinger.position.toFixed(0)}%`, signal: ind.bollinger.position > 80 ? 'قرب المقاومة' : ind.bollinger.position < 20 ? 'قرب الدعم' : 'محايد' },
    { name: 'BB Bandwidth', value: bbBandwidth.toFixed(2), signal: bbBandwidth > 10 ? 'متقلب' : 'مستقر' },
    { name: 'Stochastic %K', value: ind.stochastic_rsi.k.toFixed(1), signal: '' },
    { name: 'Stochastic %D', value: ind.stochastic_rsi.d.toFixed(1), signal: ind.stochastic_rsi.signal_text },
    { name: 'ATR', value: ind.atr.toFixed(3), signal: '' },
    { name: 'ATR %', value: `${ind.atr_percent.toFixed(2)}%`, signal: '' },
    { name: 'OBV', value: ind.obv >= 1000000 ? `${(ind.obv / 1000000).toFixed(2)}M` : ind.obv.toLocaleString(), signal: ind.obv_trend.includes('تصاعدي') ? 'صاعد' : ind.obv_trend.includes('تنازلي') ? 'هابط' : 'محايد' },
    { name: 'VWAP', value: ind.vwap.toFixed(2), signal: '' },
    { name: 'ROC (5)', value: `${ind.roc.roc_5.toFixed(2)}%`, signal: '' },
    { name: 'ROC (10)', value: `${ind.roc.roc_10.toFixed(2)}%`, signal: '' },
    { name: 'ROC (20)', value: `${ind.roc.roc_20.toFixed(2)}%`, signal: '' },
  ];

  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          المؤشرات الفنية
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent sticky top-0 bg-background">
                <TableHead className="text-xs font-semibold">المؤشر</TableHead>
                <TableHead className="text-xs font-semibold text-left">القيمة</TableHead>
                <TableHead className="text-xs font-semibold text-left">الإشارة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm font-medium">{row.name}</TableCell>
                  <TableCell className="text-left tabular-nums text-sm">{row.value || '—'}</TableCell>
                  <TableCell className="text-left">
                    {row.signal ? (
                      <Badge variant="secondary" className={cn('text-xs', getSignalColor(row.signal) && getScoreBg(row.signal.includes('شراء') || row.signal.includes('صاعد') || row.signal.includes('إيجابي') ? 80 : row.signal.includes('بيع') || row.signal.includes('هابط') || row.signal.includes('سلبي') ? 30 : 50))}>
                        {row.signal}
                      </Badge>
                    ) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Score Cards ========== */
function ScoreCards({ analysis }: { analysis: ProfessionalAnalysis }) {
  const scores = analysis.scores;

  const cards = [
    { label: 'الشامل', value: scores.composite, icon: BarChart3 },
    { label: 'الفني', value: scores.technical, icon: Activity },
    { label: 'القيمة', value: scores.value, icon: Target },
    { label: 'الجودة', value: scores.quality, icon: Shield },
    { label: 'الزخم', value: scores.momentum, icon: Zap },
    { label: 'المخاطر', value: scores.risk, icon: TrendingDown },
  ];

  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          تقييم النقاط
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="p-3 rounded-xl border bg-card">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-2xl font-bold tabular-nums', getScoreColor(card.value))}>
                    {card.value}
                  </span>
                  <span className="text-xs text-muted-foreground">/100</span>
                </div>
                <Progress
                  value={card.value}
                  className="mt-2 h-1.5"
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Price Levels Visualization ========== */
function PriceLevelsCard({ analysis, currentPrice }: { analysis: ProfessionalAnalysis; currentPrice: number }) {
  const pl = analysis.price_levels;

  const levels = [
    { label: 'مقاومة 2', value: pl.resistance_2, color: 'bg-red-500' },
    { label: 'مقاومة 1', value: pl.resistance_1, color: 'bg-red-400' },
    { label: 'السعر الحالي', value: currentPrice, color: 'bg-primary', isCurrent: true },
    { label: 'نقطة المحور', value: pl.pivot, color: 'bg-amber-500' },
    { label: 'دعم 1', value: pl.support_1, color: 'bg-emerald-400' },
    { label: 'دعم 2', value: pl.support_2, color: 'bg-emerald-500' },
  ];

  const allValues = levels.map((l) => l.value).filter(Boolean);
  const minVal = Math.min(...allValues, 0);
  const maxVal = Math.max(...allValues, 1);
  const range = maxVal - minVal || 1;

  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          مستويات الأسعار
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {levels.map((level) => {
            const position = ((level.value - minVal) / range) * 100;
            return (
              <div key={level.label} className="flex items-center gap-3">
                <span className={cn('text-xs font-medium w-20 text-left', level.isCurrent ? 'text-primary font-bold' : 'text-muted-foreground')}>
                  {level.label}
                </span>
                <div className="flex-1 relative h-6 bg-muted/30 rounded-full">
                  <div
                    className={cn('absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-sm', level.color)}
                    style={{ right: `${Math.max(0, Math.min(95, position))}%` }}
                  />
                </div>
                <span className={cn('text-xs font-bold tabular-nums w-16 text-left', level.isCurrent ? 'text-primary' : 'text-foreground')}>
                  {level.value.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Trend & Volume Analysis ========== */
function TrendVolumeCard({ analysis }: { analysis: ProfessionalAnalysis }) {
  const trend = analysis.trend;
  const vol = analysis.volume_analysis;
  const risk = analysis.risk_metrics;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Trend Analysis */}
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            تحليل الاتجاه
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <span className="text-sm font-medium">الاتجاه</span>
              <Badge variant="secondary" className={cn('font-bold', getScoreBg(trend.direction === 'bullish' || trend.direction === 'uptrend' ? 80 : trend.direction === 'bearish' || trend.direction === 'downtrend' ? 30 : 50))}>
                {trend.direction_ar}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <span className="text-sm font-medium">القوة</span>
              <Badge variant="secondary" className={cn('font-bold', getScoreBg(trend.strength === 'strong' ? 80 : trend.strength === 'weak' ? 30 : 50))}>
                {trend.strength_ar}
              </Badge>
            </div>
            {analysis.patterns.ma_cross && (
              <div className="p-3 rounded-lg border bg-muted/30">
                <p className="text-sm font-medium mb-1">تقاطع المتوسطات</p>
                <p className="text-xs text-muted-foreground">{analysis.patterns.ma_cross.description}</p>
              </div>
            )}
            {analysis.patterns.detected.length > 0 && (
              <div className="p-3 rounded-lg border bg-muted/30">
                <p className="text-sm font-medium mb-2">الأنماط المكتشفة</p>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.patterns.detected.map((p, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {p.name_ar}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Volume & Risk */}
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            التحليل و المخاطر
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <span className="text-sm font-medium">نسبة الحجم</span>
              <span className={cn('text-sm font-bold tabular-nums', vol.current_vs_avg >= 1.5 ? 'text-emerald-600' : vol.current_vs_avg <= 0.5 ? 'text-red-600' : 'text-muted-foreground')}>
                {vol.current_vs_avg.toFixed(2)}x
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <span className="text-sm font-medium">متوسط 20 يوم</span>
              <span className="text-sm tabular-nums">
                {vol.avg_volume_20 >= 1000000 ? `${(vol.avg_volume_20 / 1000000).toFixed(2)}M` : vol.avg_volume_20.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <span className="text-sm font-medium">Sharpe Ratio</span>
              <span className={cn('text-sm font-bold tabular-nums', risk.sharpe_ratio > 0 ? 'text-emerald-600' : 'text-red-600')}>
                {risk.sharpe_ratio.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <span className="text-sm font-medium">Beta</span>
              <span className="text-sm font-bold tabular-nums">{risk.beta.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <span className="text-sm font-medium">التقلب السنوي</span>
              <span className="text-sm font-bold tabular-nums">{risk.volatility_annualized.toFixed(1)}%</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ========== Recommendation Summary ========== */
function RecommendationCard({ analysis }: { analysis: ProfessionalAnalysis }) {
  const rec = analysis.recommendation;

  const actionColors: Record<string, string> = {
    strong_buy: 'bg-emerald-600 text-white',
    buy: 'bg-emerald-500 text-white',
    accumulate: 'bg-teal-500 text-white',
    hold: 'bg-amber-500 text-white',
    sell: 'bg-red-500 text-white',
    strong_sell: 'bg-red-600 text-white',
  };

  const bgColor = actionColors[rec.action] || 'bg-gray-500 text-white';

  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          التحليل
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 mb-4">
          <div className={cn('px-4 py-2 rounded-xl font-bold text-sm', bgColor)}>
            {rec.action_ar}
          </div>
          <div className="text-sm text-muted-foreground">
            <p>الثقة: <span className="font-bold text-foreground">{rec.confidence.toFixed(0)}%</span></p>
            <p>الأفق: <span className="font-bold text-foreground">{rec.time_horizon_ar}</span></p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50">
            <p className="text-[10px] text-muted-foreground mb-1">سعر الدخول</p>
            <p className="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums">{rec.entry_price.toFixed(2)}</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
            <p className="text-[10px] text-muted-foreground mb-1">الهدف</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{rec.target_price.toFixed(2)}</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
            <p className="text-[10px] text-muted-foreground mb-1">وقف الخسارة</p>
            <p className="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">{rec.stop_loss.toFixed(2)}</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 mb-4">
          <span className="text-sm font-medium">نسبة المخاطرة/العائد</span>
          <span className={cn('text-lg font-bold tabular-nums', rec.risk_reward_ratio >= 2 ? 'text-emerald-600' : rec.risk_reward_ratio >= 1 ? 'text-amber-600' : 'text-red-600')}>
            1 : {rec.risk_reward_ratio.toFixed(2)}
          </span>
        </div>

        {rec.summary_ar && (
          <div className="p-3 rounded-lg bg-muted/30 border">
            <p className="text-xs font-medium text-muted-foreground mb-1">ملخص التحليل</p>
            <p className="text-sm leading-relaxed">{rec.summary_ar}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ========== Loading Skeleton ========== */
function AnalysisSkeleton() {
  return (
    <div className="space-y-4" dir="rtl">
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

/* ========== Main Component ========== */
export function StockAnalysisReport() {
  const [searchQuery, setSearchQuery] = useState('');
  const [stockList, setStockList] = useState<Stock[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [analysis, setAnalysis] = useState<ProfessionalAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch stock list on mount
  useEffect(() => {
    setLoadingStocks(true);
    apiClient
      .getStocks({ page_size: 500 })
      .then((res) => {
        const stocks = Array.isArray(res?.stocks) ? res.stocks : [];
        setStockList(stocks);
      })
      .catch(() => {
        setStockList([]);
      })
      .finally(() => setLoadingStocks(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounce search input (300ms)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // Show dropdown when debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim()) {
      setShowDropdown(true);
    }
  }, [debouncedQuery]);

  const filteredStocks = useMemo(() => {
    if (!debouncedQuery.trim() || !Array.isArray(stockList)) return [];
    const q = debouncedQuery.toLowerCase();
    try {
      return stockList
        .filter((s) => {
          if (!s || typeof s !== 'object') return false;
          const ticker = (s.ticker || '').toLowerCase();
          const name = (s.name || '').toLowerCase();
          const nameAr = (s.name_ar || '').toLowerCase();
          return ticker.includes(q) || name.includes(q) || nameAr.includes(q);
        })
        .slice(0, 20);
    } catch {
      return [];
    }
  }, [debouncedQuery, stockList]);

  const handleSelectStock = useCallback(async (stock: Stock) => {
    setSelectedStock(stock);
    setAnalysis(null);
    setSearchQuery('');
    setShowDropdown(false);
    setLoadingAnalysis(true);

    try {
      const raw = await apiClient.getProfessionalAnalysis(stock.ticker);
      const prof = extractProfessional(raw as Record<string, unknown>);
      setAnalysis(prof);
    } catch {
      setAnalysis(null);
    } finally {
      setLoadingAnalysis(false);
    }
  }, []);

  const [exporting, setExporting] = useState(false);

  const handleExportPDF = async () => {
    if (!selectedStock) return;
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('stock-report-content');
      if (!element) {
        toast.error('لم يتم العثور على محتوى التقرير');
        return;
      }
      const ticker = selectedStock.ticker || 'report';
      await exportToPdf(element, {
        filename: `${ticker}_report_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div id="stock-report-content" className="space-y-6 print:space-y-4" dir="rtl">
      {/* Report Header */}
      <div className="border-b-2 border-primary pb-4 mb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Activity className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">منصة استثمار EGX</h1>
              <p className="text-xs text-muted-foreground">Egyptian Investment Platform</p>
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-lg font-bold">تقرير تحليل الأسهم</h2>
          </div>
        </div>
      </div>

      {/* Legal Disclaimer */}
      <p className="text-[11px] text-muted-foreground/80 italic text-center mb-2 print:mb-4">
        ⚠️ المنصة لأغراض تعليمية وتحليلية فقط. المحتوى لا يُعد توصية استثمارية أو نصيحة مالية. جميع التحليلات مبينة على بيانات تاريخية وقد لا تعكس الأداء المستقبلي.
      </p>

      {/* Stock Selector */}
      <div className="relative print:hidden" ref={dropdownRef}>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            onFocus={() => {
              if (searchQuery.trim()) setShowDropdown(true);
            }}
            placeholder="ابحث عن سهم (الرمز أو الاسم)..."
            className="pr-9 h-11 text-sm"
            dir="rtl"
          />
          {loadingStocks && (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {showDropdown && (
          <div className="absolute top-full mt-1 right-0 left-0 z-50 bg-card border rounded-lg shadow-lg max-h-72 overflow-y-auto">
            {filteredStocks.length > 0 ? (
              filteredStocks.map((stock) => (
                <button
                  key={stock.ticker || Math.random()}
                  onClick={() => handleSelectStock(stock)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-right border-b last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{stock.name_ar || stock.name || stock.ticker}</p>
                    <p className="text-xs text-muted-foreground">{stock.ticker} • {stock.sector || ''}</p>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{(Number(stock.current_price) || 0).toFixed(2)}</span>
                </button>
              ))
            ) : debouncedQuery.trim() ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                لا توجد نتائج لـ "{debouncedQuery}"
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Selected Stock Report */}
      {selectedStock && (
        <>
          {/* Print button */}
          {!loadingAnalysis && analysis && (
            <div className="flex justify-start gap-2 print:hidden">
              <Button onClick={handleExportPDF} disabled={exporting} variant="outline" className="gap-2">
                <Download className="w-4 h-4" />
                {exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}
              </Button>
              <ShareButton
                stockData={{
                  ticker: selectedStock.ticker,
                  name: selectedStock.name,
                  nameAr: selectedStock.name_ar,
                  price: selectedStock.current_price,
                  change: analysis.recommendation?.action === 'buy' || analysis.recommendation?.action === 'strong_buy' ? 1 : -1,
                  recommendation: analysis.recommendation?.action,
                  recommendationAr: analysis.recommendation?.action_ar,
                  confidence: analysis.recommendation?.confidence,
                  targetPrice: analysis.recommendation?.target_price,
                  stopLoss: analysis.recommendation?.stop_loss,
                  sector: selectedStock.sector,
                  riskLevel: analysis.trend?.strength === 'strong' ? 'Medium' : 'Low',
                }}
              />
            </div>
          )}

          {loadingAnalysis ? (
            <AnalysisSkeleton />
          ) : analysis ? (
            <div className="space-y-6 print:space-y-4">
              {/* Stock Name */}
              <div className="flex items-center gap-3 pb-3 border-b">
                <h3 className="text-xl font-bold">{selectedStock.name_ar}</h3>
                <Badge variant="secondary" className="text-xs">{selectedStock.ticker}</Badge>
                <Badge variant="outline" className="text-xs">{selectedStock.sector}</Badge>
              </div>

              {/* Price Performance */}
              <PricePerformanceCard stock={selectedStock} />

              {/* Score Cards */}
              <ScoreCards analysis={analysis} />

              {/* Technical Indicators */}
              <TechnicalIndicatorsTable analysis={analysis} />

              {/* Price Levels */}
              <PriceLevelsCard analysis={analysis} currentPrice={selectedStock.current_price} />

              {/* Trend & Volume */}
              <TrendVolumeCard analysis={analysis} />

              {/* Recommendation */}
              <RecommendationCard analysis={analysis} />

              {/* Footer */}
              <div className="text-center pt-4 border-t text-xs text-muted-foreground">
                <p>تم إنشاء هذا التقرير تلقائياً بواسطة منصة استثمار EGX</p>
                <p>البيانات لأغراض تعليمية ومعلوماتية فقط وليست نصيحة استثمارية</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Activity className="w-12 h-12 mb-3" />
              <p className="text-sm">لم يتم تحميل التحليل المهني لهذا السهم</p>
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!selectedStock && !loadingAnalysis && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Search className="w-16 h-16 mb-4 opacity-30" />
          <p className="text-lg font-medium mb-1">اختر سهم لعرض التقرير</p>
          <p className="text-sm">ابحث عن السهم في مربع البحث أعلاه</p>
        </div>
      )}
    </div>
  );
}

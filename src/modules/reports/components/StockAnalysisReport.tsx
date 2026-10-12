'use client';

// MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
// This component fetches from `/api/stocks/${ticker}/comprehensive` — the
// unified Python aggregator (Rule 67). It does NOT call `/api/maestro/*`.
// The `maestro?: Record<string, unknown>` field in `ComprehensiveData` and
// the inline comments mentioning "maestro" describe a sub-object returned
// by the comprehensive aggregator (Python brain → Node display only, Rule 20).
// These are response-shape property names / historical comments, NOT engine
// invocations. Left intact per Rule 4 (NO-DELETION) and the conservative
// clause of PHASE-2-MAESTRO-UI.

/**
 * StockAnalysisReport — تقرير تحليل السهم (Task 42 redesign)
 * =========================================================================
 *
 * Owner directive:
 *   "محتاجة رفع كفائة بلذات لما بتعمل التقارير بلطبعة او PDF لازم الشاشات
 *    الى فيها تكون احترافية وتقارير مالية محترفة جدا وبمظهر ممتاز."
 *
 * Rule 67 root cause (fix):
 *   Before: used `apiClient.getProfessionalAnalysis(ticker)` AND
 *   `apiClient.getStocks({page_size: 500})` (2 separate API calls,
 *   sometimes returning conflicting stock lists).
 *   Now: ONE source — `/api/stocks/${ticker}/comprehensive` (Python
 *   aggregator: basic + price + technical + maestro + professional +
 *   board + news + predictions, all from the Python brain).
 *
 *   Rule 20 (Python=Brain): The comprehensive endpoint is 100% Python-driven;
 *   Node.js is display-only.
 *
 * Professional design (Bloomberg cover-page style):
 *   - Cover page header: ticker + name + sector + price + recommendation
 *   - Technical analysis section (RSI, MACD, MA, Bollinger)
 *   - Fundamental section (PE, ROE, EPS, market cap, PB)
 *   - Risk section (drawdown, volatility, beta, Sharpe)
 *   - Conclusion + recommendation (entry / target / stop / R:R)
 *   - Export as PNG (html-to-image 2x retina) + Print (window.print → PDF)
 *
 * Rule 67 honesty:
 *   - safeNum / safeStr never fabricate missing values; show "—" instead.
 *   - Defensive accessors tolerate partial engine failures (Promise.allSettled
 *     upstream means some engines may fail and the UI still renders).
 */

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  Download,
  Printer,
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
  Loader2,
  DollarSign,
  Scale,
  Gauge,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  exportReportToPng,
  triggerPrint,
  safeFmtNum,
  safeFmtPct,
} from '../lib/proxy-client';

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

interface StockInfo {
  ticker: string;
  name?: string;
  name_ar?: string;
  sector?: string;
  current_price?: number;
  previous_close?: number;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  volume?: number;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  eps?: number;
  roe?: number;
  dividend_yield?: number;
}

interface ComprehensiveResponse {
  success?: boolean;
  ticker?: string;
  market?: string;
  timestamp?: string;
  basic?: StockInfo;
  price?: {
    current?: number;
    previous_close?: number;
    change?: number;
    change_percent?: number;
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
  };
  keyMetrics?: {
    pe_ratio?: number;
    pb_ratio?: number;
    eps?: number;
    roe?: number;
    market_cap?: number;
    dividend_yield?: number;
    [k: string]: unknown;
  };
  technical?: Record<string, unknown>;
  maestro?: Record<string, unknown>;
  hunter?: Record<string, unknown>;
  board?: Record<string, unknown>;
  news?: unknown;
  predictions?: unknown;
  professional?: Record<string, unknown>;
  errors?: Array<{ engine?: string; error?: string }>;
}

/* ========== Helper: Extract Professional Analysis from raw API response ========== */
function extractProfessional(raw: Record<string, unknown>): ProfessionalAnalysis | null {
  try {
    const prof = (raw.professional ?? raw) as Record<string, unknown>;
    const scores = (prof.scores ?? {}) as Record<string, unknown>;
    const indicators = (prof.indicators ?? {}) as Record<string, unknown>;
    const rsi = (indicators.rsi ?? {}) as Record<string, unknown>;
    const macd = (indicators.macd ?? {}) as Record<string, unknown>;
    const bb = (indicators.bollinger ?? {}) as Record<string, unknown>;
    const stoch = (indicators.stochastic_rsi ?? {}) as Record<string, unknown>;
    const roc = (indicators.roc ?? {}) as Record<string, unknown>;
    const trend = (prof.trend ?? {}) as Record<string, unknown>;
    const rec = (prof.recommendation ?? {}) as Record<string, unknown>;
    const pl = (prof.price_levels ?? {}) as Record<string, unknown>;
    const vol = (prof.volume_analysis ?? {}) as Record<string, unknown>;
    const risk = (prof.risk_metrics ?? {}) as Record<string, unknown>;
    const patternsObj = (prof.patterns ?? {}) as Record<string, unknown>;
    const detected = (patternsObj.detected ?? []) as Array<Record<string, unknown>>;
    const maCross = (patternsObj.ma_cross ?? null) as Record<string, unknown> | null;
    const dataQuality = (prof.data_quality ?? {}) as Record<string, unknown>;
    const fairValue = (prof.fair_value ?? undefined) as Record<string, unknown> | undefined;

    return {
      ticker: String(raw.ticker ?? ''),
      scores: {
        composite: Number(scores.composite ?? 50),
        technical: Number(scores.technical ?? 50),
        value: Number(scores.value ?? 50),
        quality: Number(scores.quality ?? 50),
        momentum: Number(scores.momentum ?? 50),
        risk: Number(scores.risk ?? 50),
      },
      indicators: {
        rsi: { value: Number(rsi.value ?? 50), signal: String(rsi.signal ?? 'neutral') },
        macd: {
          line: Number(macd.line ?? 0),
          signal: Number(macd.signal ?? 0),
          histogram: Number(macd.histogram ?? 0),
          signal_text: String(macd.signal_text ?? 'محايد'),
        },
        bollinger: {
          upper: Number(bb.upper ?? 0),
          middle: Number(bb.middle ?? 0),
          lower: Number(bb.lower ?? 0),
          position: Number(bb.position ?? 50),
          signal_text: String(bb.signal_text ?? 'محايد'),
        },
        stochastic_rsi: {
          k: Number(stoch.k ?? 50),
          d: Number(stoch.d ?? 50),
          signal_text: String(stoch.signal_text ?? 'محايد'),
        },
        atr: Number(indicators.atr ?? 0),
        atr_percent: Number(indicators.atr_percent ?? 0),
        obv: Number(indicators.obv ?? 0),
        obv_trend: String(indicators.obv_trend ?? 'محايد'),
        vwap: Number(indicators.vwap ?? 0),
        roc: {
          roc_5: Number(roc.roc_5 ?? 0),
          roc_10: Number(roc.roc_10 ?? 0),
          roc_20: Number(roc.roc_20 ?? 0),
          signal_text: String(roc.signal_text ?? ''),
        },
      },
      trend: {
        direction: String(trend.direction ?? 'neutral'),
        direction_ar: String(trend.direction_ar ?? 'عرضي'),
        strength: String(trend.strength ?? 'moderate'),
        strength_ar: String(trend.strength_ar ?? 'متوسط'),
      },
      recommendation: {
        action: String(rec.action ?? 'hold'),
        action_ar: String(rec.action_ar ?? 'احتفاظ'),
        confidence: Number(rec.confidence ?? 50),
        entry_price: Number(rec.entry_price ?? 0),
        target_price: Number(rec.target_price ?? 0),
        stop_loss: Number(rec.stop_loss ?? 0),
        risk_reward_ratio: Number(rec.risk_reward_ratio ?? 0),
        time_horizon: String(rec.time_horizon ?? 'medium_term'),
        time_horizon_ar: String(rec.time_horizon_ar ?? 'متوسط الأجل'),
        summary_ar: String(rec.summary_ar ?? ''),
      },
      price_levels: {
        support_1: Number(pl.support_1 ?? 0),
        support_2: Number(pl.support_2 ?? 0),
        resistance_1: Number(pl.resistance_1 ?? 0),
        resistance_2: Number(pl.resistance_2 ?? 0),
        pivot: Number(pl.pivot ?? 0),
      },
      volume_analysis: {
        avg_volume_20: Number(vol.avg_volume_20 ?? 0),
        current_vs_avg: Number(vol.current_vs_avg ?? 1),
        signal: String(vol.signal ?? 'normal'),
        signal_ar: String(vol.signal_ar ?? 'عادي'),
      },
      risk_metrics: {
        sharpe_ratio: Number(risk.sharpe_ratio ?? 0),
        max_drawdown: Number(risk.max_drawdown ?? 0),
        max_drawdown_percent: Number(risk.max_drawdown_percent ?? 0),
        var_95: Number(risk.var_95 ?? 0),
        beta: Number(risk.beta ?? 1),
        volatility_annualized: Number(risk.volatility_annualized ?? 0),
      },
      patterns: {
        detected: detected.map((p) => ({
          name: String(p.name ?? ''),
          name_ar: String(p.name_ar ?? ''),
          type: String(p.type ?? ''),
          reliability: String(p.reliability ?? ''),
        })),
        ma_cross: maCross
          ? {
              signal: String(maCross.signal ?? ''),
              description: String(maCross.description ?? ''),
            }
          : null,
      },
      data_quality: {
        history_points: Number(dataQuality.history_points ?? 0),
        quality: String(dataQuality.quality ?? 'low'),
      },
      fair_value: fairValue
        ? {
            graham_number: Number(fairValue.graham_number ?? 0),
            lynch_value: Number(fairValue.lynch_value ?? 0),
            dcf_simplified: Number(fairValue.dcf_simplified ?? 0),
            pe_based: Number(fairValue.pe_based ?? 0),
            average_fair_value: Number(fairValue.average_fair_value ?? 0),
            upside_to_fair: Number(fairValue.upside_to_fair ?? 0),
            verdict: String(fairValue.verdict ?? 'fair'),
            verdict_ar: String(fairValue.verdict_ar ?? 'عادل التقييم'),
          }
        : undefined,
    };
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

/* ========== Helpers ========== */
function getScoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function getScoreBg(score: number): string {
  if (score >= 70) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  if (score >= 50) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  return 'bg-red-500/20 text-red-300 border-red-500/40';
}

/* ========== Cover Page Header (Bloomberg-style) ========== */
function CoverPageHeader({
  stock,
  analysis,
  price,
  change,
  changePercent,
}: {
  stock: StockInfo;
  analysis: ProfessionalAnalysis | null;
  price: number;
  change: number;
  changePercent: number;
}) {
  const rec = analysis?.recommendation;
  const isUp = change >= 0;
  const actionColors: Record<string, string> = {
    strong_buy: 'from-emerald-600 to-emerald-500 text-white',
    buy: 'from-emerald-500 to-teal-500 text-white',
    accumulate: 'from-teal-500 to-emerald-500 text-white',
    hold: 'from-amber-500 to-amber-400 text-background',
    sell: 'from-red-500 to-rose-500 text-white',
    strong_sell: 'from-red-600 to-red-700 text-white',
  };
  const actionBg = actionColors[rec?.action ?? 'hold'] ?? 'from-slate-600 to-slate-500 text-white';
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-l from-background via-card to-muted p-5 print:break-inside-avoid"
      dir="rtl"
    >
      <div className="absolute top-0 right-0 left-0 h-[3px] bg-gradient-to-l from-amber-500 via-amber-400 to-amber-500" />
      {/* Big ticker + name */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight tabular-nums">
              {stock.ticker}
            </h1>
            <Badge
              variant="outline"
              className="text-[11px] font-bold border-amber-400/40 text-amber-300 bg-amber-500/10"
            >
              {stock.sector || '—'}
            </Badge>
          </div>
          <p className="text-base text-slate-300 truncate">
            {stock.name_ar || stock.name || stock.ticker}
          </p>
        </div>
        {rec && (
          <div
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-extrabold bg-gradient-to-l shadow-lg',
              actionBg,
            )}
          >
            {rec.action_ar}
          </div>
        )}
      </div>

      {/* Price block */}
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">السعر الحالي</p>
          <p className="text-3xl sm:text-4xl font-extrabold text-amber-300 tabular-nums">
            {safeFmtNum(price, 2, ' ج.م')}
          </p>
        </div>
        <div
          className={cn(
            'px-3 py-1.5 rounded-lg tabular-nums text-sm font-bold',
            isUp
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              : 'bg-red-500/15 text-red-300 border border-red-500/30',
          )}
        >
          {isUp ? <ArrowUpRight className="w-3.5 h-3.5 inline -mt-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 inline -mt-0.5" />}
          {' '}
          {isUp ? '+' : ''}{(change ?? 0).toFixed(2)} ({safeFmtPct(changePercent, 2)})
        </div>
      </div>

      {/* Mini-stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        <div className="rounded-lg bg-white/5 border border-slate-700/40 p-2">
          <p className="text-[10px] text-slate-400">الافتتاح</p>
          <p className="text-sm font-bold text-slate-100 tabular-nums">
            {safeFmtNum(stock.open_price ?? 0, 2)}
          </p>
        </div>
        <div className="rounded-lg bg-white/5 border border-slate-700/40 p-2">
          <p className="text-[10px] text-slate-400">الأعلى</p>
          <p className="text-sm font-bold text-emerald-300 tabular-nums">
            {safeFmtNum(stock.high_price ?? 0, 2)}
          </p>
        </div>
        <div className="rounded-lg bg-white/5 border border-slate-700/40 p-2">
          <p className="text-[10px] text-slate-400">الأدنى</p>
          <p className="text-sm font-bold text-red-300 tabular-nums">
            {safeFmtNum(stock.low_price ?? 0, 2)}
          </p>
        </div>
        <div className="rounded-lg bg-white/5 border border-slate-700/40 p-2">
          <p className="text-[10px] text-slate-400">الحجم</p>
          <p className="text-sm font-bold text-slate-100 tabular-nums">
            {Number(stock.volume ?? 0) >= 1_000_000
              ? `${(Number(stock.volume ?? 0) / 1_000_000).toFixed(2)}M`
              : safeFmtNum(Number(stock.volume ?? 0), 0, '')}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ========== Score Cards ========== */
function ScoreCards({ analysis }: { analysis: ProfessionalAnalysis }) {
  const cards = [
    { label: 'الشامل', value: analysis.scores.composite, icon: BarChart3 },
    { label: 'الفني', value: analysis.scores.technical, icon: Activity },
    { label: 'القيمة', value: analysis.scores.value, icon: Target },
    { label: 'الجودة', value: analysis.scores.quality, icon: Shield },
    { label: 'الزخم', value: analysis.scores.momentum, icon: Zap },
    { label: 'المخاطر', value: analysis.scores.risk, icon: TrendingDown },
  ];
  return (
    <Card className="overflow-hidden border-slate-700/50 bg-card print:break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-300">
          <BarChart3 className="w-5 h-5" />
          تقييم النقاط · Score Dashboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="p-3 rounded-xl border border-slate-700/40 bg-background/60"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-medium text-slate-300">{card.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn('text-2xl font-extrabold tabular-nums', getScoreColor(card.value))}
                  >
                    {card.value}
                  </span>
                  <span className="text-xs text-slate-500">/100</span>
                </div>
                <Progress
                  value={card.value}
                  className="mt-2 h-1.5 bg-slate-700/60"
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Technical Indicators Section ========== */
function TechnicalSection({ analysis }: { analysis: ProfessionalAnalysis }) {
  const ind = analysis.indicators;
  const rows = [
    { name: 'RSI (14)', value: (ind.rsi.value ?? 0).toFixed(1), signal: ind.rsi.signal === 'overbought' ? 'تشبع شراء' : ind.rsi.signal === 'oversold' ? 'تشبع بيع' : 'محايد' },
    { name: 'MACD', value: (ind.macd.line ?? 0).toFixed(3), signal: ind.macd.signal_text },
    { name: 'MACD Histogram', value: (ind.macd.histogram ?? 0).toFixed(3), signal: ind.macd.histogram > 0 ? 'صاعد' : 'هابط' },
    { name: 'Bollinger Upper', value: (ind.bollinger.upper ?? 0).toFixed(2), signal: '' },
    { name: 'Bollinger Middle', value: (ind.bollinger.middle ?? 0).toFixed(2), signal: '' },
    { name: 'Bollinger Lower', value: (ind.bollinger.lower ?? 0).toFixed(2), signal: '' },
    { name: 'BB Position', value: `${(ind.bollinger.position ?? 0).toFixed(0)}%`, signal: ind.bollinger.position > 80 ? 'قرب المقاومة' : ind.bollinger.position < 20 ? 'قرب الدعم' : 'محايد' },
    { name: 'Stochastic %K', value: (ind.stochastic_rsi.k ?? 0).toFixed(1), signal: ind.stochastic_rsi.signal_text },
    { name: 'ATR', value: (ind.atr ?? 0).toFixed(3), signal: '' },
    { name: 'ATR %', value: `${(ind.atr_percent ?? 0).toFixed(2)}%`, signal: '' },
    { name: 'OBV', value: ind.obv >= 1_000_000 ? `${(ind.obv / 1_000_000).toFixed(2)}M` : ind.obv.toLocaleString(), signal: ind.obv_trend },
    { name: 'VWAP', value: (ind.vwap ?? 0).toFixed(2), signal: '' },
    { name: 'ROC (5)', value: `${(ind.roc.roc_5 ?? 0).toFixed(2)}%`, signal: '' },
    { name: 'ROC (10)', value: `${(ind.roc.roc_10 ?? 0).toFixed(2)}%`, signal: '' },
    { name: 'ROC (20)', value: `${(ind.roc.roc_20 ?? 0).toFixed(2)}%`, signal: '' },
  ];

  return (
    <Card className="overflow-hidden border-slate-700/50 bg-card print:break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-300">
          <Activity className="w-5 h-5" />
          المؤشرات الفنية · Technical Indicators
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-x divide-x-reverse divide-slate-700/40">
          {rows.map((row, i) => (
            <div
              key={`${row.name}-${i}`}
              className="flex items-center justify-between px-4 py-2 border-b border-slate-700/30"
            >
              <span className="text-xs text-slate-400">{row.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-100 tabular-nums">
                  {row.value || '—'}
                </span>
                {row.signal && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] font-bold',
                      getScoreBg(
                        row.signal.includes('شراء') || row.signal.includes('صاعد')
                          ? 80
                          : row.signal.includes('بيع') || row.signal.includes('هابط')
                            ? 30
                            : 50,
                      ),
                    )}
                  >
                    {row.signal}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Fundamental Section ========== */
function FundamentalSection({
  stock,
  analysis,
}: {
  stock: StockInfo;
  analysis: ProfessionalAnalysis;
}) {
  const items = [
    {
      label: 'P/E',
      value: safeFmtNum(stock.pe_ratio ?? 0, 1),
      icon: DollarSign,
      hint: 'مكرر الربحية',
    },
    {
      label: 'P/B',
      value: safeFmtNum(stock.pb_ratio ?? 0, 2),
      icon: Scale,
      hint: 'مكرر القيمة الدفترية',
    },
    {
      label: 'EPS',
      value: safeFmtNum(stock.eps ?? 0, 2),
      icon: BarChart3,
      hint: 'ربحية السهم',
    },
    {
      label: 'ROE %',
      value: safeFmtNum(stock.roe ?? 0, 2),
      icon: Gauge,
      hint: 'العائد على حقوق الملكية',
    },
    {
      label: 'Market Cap',
      value:
        Number(stock.market_cap ?? 0) >= 1_000_000_000
          ? `${(Number(stock.market_cap ?? 0) / 1_000_000_000).toFixed(2)}B`
          : Number(stock.market_cap ?? 0) >= 1_000_000
            ? `${(Number(stock.market_cap ?? 0) / 1_000_000).toFixed(2)}M`
            : safeFmtNum(Number(stock.market_cap ?? 0), 0, ''),
      icon: BarChart3,
      hint: 'القيمة السوقية',
    },
    {
      label: 'Dividend Yield',
      value: safeFmtPct(stock.dividend_yield ?? 0, 2),
      icon: DollarSign,
      hint: 'عائد التوزيعات',
    },
  ];

  return (
    <Card className="overflow-hidden border-slate-700/50 bg-card print:break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-300">
          <Scale className="w-5 h-5" />
          القوائم الأساسية · Fundamental Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div
                key={it.label}
                className="p-3 rounded-lg border border-slate-700/40 bg-background/60"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[10px] text-slate-400">{it.label}</span>
                </div>
                <p className="text-lg font-extrabold text-amber-300 tabular-nums">
                  {it.value}
                </p>
                <p className="text-[10px] text-slate-500">{it.hint}</p>
              </div>
            );
          })}
        </div>
        {analysis.fair_value && (
          <div className="mt-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-amber-300">
                القيمة العادلة المقدّرة · Fair Value
              </span>
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                {analysis.fair_value.verdict_ar}
              </Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <span className="text-slate-400">Graham:</span>
                <p className="font-bold text-slate-100 tabular-nums">
                  {safeFmtNum(analysis.fair_value.graham_number, 2)}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Lynch:</span>
                <p className="font-bold text-slate-100 tabular-nums">
                  {safeFmtNum(analysis.fair_value.lynch_value, 2)}
                </p>
              </div>
              <div>
                <span className="text-slate-400">DCF:</span>
                <p className="font-bold text-slate-100 tabular-nums">
                  {safeFmtNum(analysis.fair_value.dcf_simplified, 2)}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Upside:</span>
                <p className={cn('font-bold tabular-nums', analysis.fair_value.upside_to_fair > 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {safeFmtPct(analysis.fair_value.upside_to_fair, 2)}
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ========== Risk Section ========== */
function RiskSection({ analysis }: { analysis: ProfessionalAnalysis }) {
  const risk = analysis.risk_metrics;
  const items = [
    {
      label: 'Max Drawdown',
      value: safeFmtPct(risk.max_drawdown_percent, 2),
      tone: risk.max_drawdown_percent < -15 ? 'negative' : 'neutral',
    },
    {
      label: 'Volatility (annualized)',
      value: safeFmtPct(risk.volatility_annualized, 1),
      tone: risk.volatility_annualized > 40 ? 'warning' : 'neutral',
    },
    {
      label: 'Beta',
      value: safeFmtNum(risk.beta, 2),
      tone: risk.beta > 1.3 ? 'negative' : risk.beta < 0.8 ? 'positive' : 'neutral',
    },
    {
      label: 'Sharpe Ratio',
      value: safeFmtNum(risk.sharpe_ratio, 2),
      tone: risk.sharpe_ratio > 1 ? 'positive' : risk.sharpe_ratio < 0 ? 'negative' : 'neutral',
    },
    {
      label: 'VaR (95%)',
      value: safeFmtNum(risk.var_95, 2),
      tone: 'neutral',
    },
    {
      label: 'Vol vs Avg',
      value: `${(analysis.volume_analysis.current_vs_avg ?? 0).toFixed(2)}x`,
      tone: analysis.volume_analysis.current_vs_avg >= 1.5 ? 'positive' : analysis.volume_analysis.current_vs_avg <= 0.5 ? 'warning' : 'neutral',
    },
  ];
  const toneClasses: Record<string, string> = {
    positive: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    negative: 'border-red-500/30 bg-red-500/10 text-red-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    neutral: 'border-slate-500/30 bg-slate-500/10 text-slate-200',
  };
  return (
    <Card className="overflow-hidden border-slate-700/50 bg-card print:break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-300">
          <AlertTriangle className="w-5 h-5" />
          تحليل المخاطر · Risk Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {items.map((it) => (
            <div
              key={it.label}
              className={cn(
                'p-3 rounded-lg border tabular-nums',
                toneClasses[it.tone],
              )}
            >
              <p className="text-[10px] text-slate-300 mb-0.5">{it.label}</p>
              <p className="text-lg font-extrabold">{it.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Recommendation Section ========== */
function RecommendationSection({ analysis }: { analysis: ProfessionalAnalysis }) {
  const rec = analysis.recommendation;
  return (
    <Card className="overflow-hidden border-amber-500/30 bg-gradient-to-br from-card to-muted print:break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-300">
          <Shield className="w-5 h-5" />
          الخلاصة والتوصية · Conclusion
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-3 rounded-lg bg-teal-500/10 border border-teal-500/30">
            <p className="text-[10px] text-slate-400 mb-1">سعر الدخول</p>
            <p className="text-lg font-bold text-teal-300 tabular-nums">
              {safeFmtNum(rec.entry_price, 2)}
            </p>
          </div>
          <div className="text-center p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <p className="text-[10px] text-slate-400 mb-1">الهدف</p>
            <p className="text-lg font-bold text-emerald-300 tabular-nums">
              {safeFmtNum(rec.target_price, 2)}
            </p>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <p className="text-[10px] text-slate-400 mb-1">وقف الخسارة</p>
            <p className="text-lg font-bold text-red-300 tabular-nums">
              {safeFmtNum(rec.stop_loss, 2)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="p-2 rounded-lg bg-white/5 border border-slate-700/40 text-center">
            <p className="text-[10px] text-slate-400">الثقة</p>
            <p className="text-sm font-bold text-amber-300 tabular-nums">
              {(rec.confidence ?? 0).toFixed(0)}%
            </p>
          </div>
          <div className="p-2 rounded-lg bg-white/5 border border-slate-700/40 text-center">
            <p className="text-[10px] text-slate-400">R:R</p>
            <p className="text-sm font-bold text-amber-300 tabular-nums">
              1 : {(rec.risk_reward_ratio ?? 0).toFixed(2)}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-white/5 border border-slate-700/40 text-center">
            <p className="text-[10px] text-slate-400">الأفق</p>
            <p className="text-sm font-bold text-amber-300">
              {rec.time_horizon_ar}
            </p>
          </div>
        </div>
        {rec.summary_ar && (
          <div className="p-3 rounded-lg bg-black/20 border border-slate-700/40">
            <p className="text-xs font-bold text-amber-300 mb-1">ملخص التحليل</p>
            <p className="text-sm leading-relaxed text-slate-200">{rec.summary_ar}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ========== Price Levels Visualization ========== */
function PriceLevelsCard({
  analysis,
  currentPrice,
}: {
  analysis: ProfessionalAnalysis;
  currentPrice: number;
}) {
  const pl = analysis.price_levels;
  const levels = [
    { label: 'مقاومة 2', value: pl.resistance_2, color: 'bg-red-500' },
    { label: 'مقاومة 1', value: pl.resistance_1, color: 'bg-red-400' },
    { label: 'السعر الحالي', value: currentPrice, color: 'bg-amber-400', isCurrent: true },
    { label: 'نقطة المحور', value: pl.pivot, color: 'bg-amber-500' },
    { label: 'دعم 1', value: pl.support_1, color: 'bg-emerald-400' },
    { label: 'دعم 2', value: pl.support_2, color: 'bg-emerald-500' },
  ];
  const allValues = levels.map((l) => l.value).filter(Boolean);
  const minVal = Math.min(...allValues, 0);
  const maxVal = Math.max(...allValues, 1);
  const range = maxVal - minVal || 1;
  return (
    <Card className="overflow-hidden border-slate-700/50 bg-card print:break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-300">
          <Target className="w-5 h-5" />
          مستويات الأسعار · Price Levels
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {levels.map((level) => {
            const position = ((level.value - minVal) / range) * 100;
            return (
              <div key={level.label} className="flex items-center gap-3">
                <span
                  className={cn(
                    'text-xs font-medium w-20 text-left',
                    level.isCurrent ? 'text-amber-300 font-bold' : 'text-slate-400',
                  )}
                >
                  {level.label}
                </span>
                <div className="flex-1 relative h-6 bg-slate-800/60 rounded-full">
                  <div
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-sm',
                      level.color,
                    )}
                    style={{ right: `${Math.max(0, Math.min(95, position))}%` }}
                  />
                </div>
                <span
                  className={cn(
                    'text-xs font-bold tabular-nums w-16 text-left',
                    level.isCurrent ? 'text-amber-300' : 'text-slate-200',
                  )}
                >
                  {(level.value ?? 0).toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Loading Skeleton ========== */
function AnalysisSkeleton() {
  return (
    <div className="space-y-4" dir="rtl">
      <Skeleton className="h-48 rounded-2xl" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
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
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockInfo | null>(null);
  const [analysis, setAnalysis] = useState<ProfessionalAnalysis | null>(null);
  const [comprehensive, setComprehensive] = useState<ComprehensiveResponse | null>(null);
  const [stockList, setStockList] = useState<Array<{ ticker: string; name?: string; name_ar?: string; sector?: string; current_price?: number }>>([]);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // Fetch stock list (search suggestions) — Python via /api/stocks.
  // NOTE: This is the Python stocks endpoint (Rule 20 — Python=Brain);
  // not a duplicate source like /api/market/overview.
  useEffect(() => {
    setLoadingStocks(true);
    fetch('/api/stocks?page_size=500', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { stocks: [] }))
      .then((res: { stocks?: Array<{ ticker: string; name?: string; name_ar?: string; sector?: string; current_price?: number }> }) => {
        setStockList(Array.isArray(res?.stocks) ? res.stocks : []);
      })
      .catch(() => setStockList([]))
      .finally(() => setLoadingStocks(false));
  }, []);

  // Close dropdown on outside click.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounce search input.
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (debouncedQuery.trim()) setShowDropdown(true);
  }, [debouncedQuery]);

  const filteredStocks = useMemo(() => {
    if (!debouncedQuery.trim() || !Array.isArray(stockList)) return [];
    const q = debouncedQuery.toLowerCase();
    return stockList
      .filter((s) => {
        const ticker = (s.ticker || '').toLowerCase();
        const name = (s.name || '').toLowerCase();
        const nameAr = (s.name_ar || '').toLowerCase();
        return ticker.includes(q) || name.includes(q) || nameAr.includes(q);
      })
      .slice(0, 20);
  }, [debouncedQuery, stockList]);

  // Fetch the comprehensive analysis when a stock is selected.
  // Rule 67: ONE source — /api/stocks/${ticker}/comprehensive
  // (Python aggregator: basic + price + technical + maestro + professional
  // + board + news + predictions, all from the Python brain).
  const handleSelectStock = useCallback(async (stock: StockInfo) => {
    setSelectedStock(stock);
    setAnalysis(null);
    setComprehensive(null);
    setSearchQuery('');
    setShowDropdown(false);
    setLoadingAnalysis(true);
    try {
      const res = await fetch(
        `/api/stocks/${encodeURIComponent(stock.ticker.toUpperCase())}/comprehensive`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
      );
      if (!res.ok) {
        throw new Error(`comprehensive fetch failed: ${res.status}`);
      }
      const raw = (await res.json()) as ComprehensiveResponse;
      setComprehensive(raw);
      const prof = extractProfessional((raw as unknown as Record<string, unknown>) as Record<string, unknown>);
      setAnalysis(prof);
    } catch { // silent fallback (safe-by-design)
      setAnalysis(null);
      setComprehensive(null);
    } finally {
      setLoadingAnalysis(false);
    }
  }, []);

  const handleExportPng = async () => {
    if (!reportRef.current) {
      toast.error('لم يتم العثور على محتوى التقرير');
      return;
    }
    setExportingPng(true);
    try {
      const ticker = selectedStock?.ticker || 'report';
      await exportReportToPng(reportRef.current, {
        filename: `${ticker}_report_${new Date().toISOString().split('T')[0]}`,
        pixelRatio: 2,
        // DEV-19: omit backgroundColor — exportReportToPng resolves
        // --background from the active theme at runtime (zero hardcoded).
        filter: (node) => {
          // Skip export-only buttons / search box.
          if (node instanceof HTMLElement) {
            if (node.dataset?.noExport === 'true') return false;
            if (node.classList?.contains('no-export')) return false;
          }
          return true;
        },
      });
      toast.success('تم تصدير صورة التقرير (دقة عالية)');
    } catch (err) {
      console.error('[StockReport] PNG export error:', err);
      toast.error('فشل تصدير الصورة — حاول مرة أخرى');
    } finally {
      setExportingPng(false);
    }
  };

  const handlePrint = () => triggerPrint();

  const currentPrice = Number(selectedStock?.current_price ?? comprehensive?.price?.current ?? 0);
  const change = Number(
    comprehensive?.price?.change ??
      ((selectedStock?.current_price ?? 0) - (selectedStock?.previous_close ?? 0)),
  );
  const changePercent = Number(comprehensive?.price?.change_percent ?? 0);

  return (
    <div
      id="stock-report-content"
      className="space-y-5 print:space-y-3 bg-background print:bg-white p-4 sm:p-5 rounded-2xl border border-slate-700/50 print:border-0"
      dir="rtl"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-700/40 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-emerald-500 flex items-center justify-center">
            <Activity className="w-5 h-5 text-background" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-amber-300">تقرير تحليل السهم</h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">
              تقرير تحليل السهم
            </p>
          </div>
        </div>
        {selectedStock && !loadingAnalysis && analysis && (
          <div className="flex justify-end gap-2 print:hidden flex-wrap no-export" data-no-export="true">
            <Button
              onClick={handleExportPng}
              disabled={exportingPng}
              variant="outline"
              className="gap-2 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
            >
              <Download className="w-4 h-4" />
              {exportingPng ? 'جارٍ التصدير...' : 'تصدير صورة (PNG)'}
            </Button>
            <Button
              onClick={handlePrint}
              variant="outline"
              className="gap-2 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
            >
              <Printer className="w-4 h-4" />
              طباعة / PDF
            </Button>
          </div>
        )}
      </div>

      {/* Legal Disclaimer */}
      <p className="text-[10px] text-amber-300/70 italic text-center leading-relaxed">
        ⚠️ إخلاء مسؤولية: هذا التقرير رأي آلي تعليمي تحليلي وليس نصيحة
        استثمارية مرخصة. القرار مسؤولية العميل. لا ضمان للنتائج.
      </p>

      {/* Stock Selector */}
      <div className="relative print:hidden no-export" data-no-export="true" ref={dropdownRef}>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              if (searchQuery.trim()) setShowDropdown(true);
            }}
            placeholder="ابحث عن سهم (الرمز أو الاسم)..."
            className="pr-9 h-11 text-sm bg-card border-slate-700/50 text-slate-100 placeholder:text-slate-500"
            dir="rtl"
          />
          {loadingStocks && (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />
          )}
        </div>
        {showDropdown && (
          <div className="absolute top-full mt-1 right-0 left-0 z-50 bg-card border border-slate-700/50 rounded-lg shadow-xl max-h-72 overflow-y-auto">
            {filteredStocks.length > 0 ? (
              filteredStocks.map((stock) => (
                <button
                  key={stock.ticker || Math.random()}
                  onClick={() => handleSelectStock(stock as StockInfo)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-500/10 transition-colors text-right border-b border-slate-700/30 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">
                      {stock.name_ar || stock.name || stock.ticker}
                    </p>
                    <p className="text-xs text-slate-500">
                      {stock.ticker} • {stock.sector || ''}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-amber-300 tabular-nums">
                    {(Number(stock.current_price ?? 0)).toFixed(2)}
                  </span>
                </button>
              ))
            ) : debouncedQuery.trim() ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                لا توجد نتائج لـ "{debouncedQuery}"
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Selected Stock Report */}
      {selectedStock && (
        <div ref={reportRef} className="space-y-5 print:space-y-3">
          {loadingAnalysis ? (
            <AnalysisSkeleton />
          ) : analysis ? (
            <>
              {/* Cover Page */}
              <CoverPageHeader
                stock={selectedStock}
                analysis={analysis}
                price={currentPrice}
                change={change}
                changePercent={changePercent}
              />

              {/* Score Dashboard */}
              <ScoreCards analysis={analysis} />

              {/* Technical + Fundamental */}
              <TechnicalSection analysis={analysis} />
              <FundamentalSection stock={selectedStock} analysis={analysis} />

              {/* Price Levels */}
              <PriceLevelsCard analysis={analysis} currentPrice={currentPrice} />

              {/* Risk */}
              <RiskSection analysis={analysis} />

              {/* Recommendation */}
              <RecommendationSection analysis={analysis} />

              {/* Footer */}

              <div className="text-center pt-3 border-t border-border/40 text-[11px] text-muted-foreground print:pt-2">
                <p className="mb-0.5 font-medium">
                  تم إعداد هذا التقرير آلياً عبر خوارزميات التحليل المالي والكمي المتقدمة
                </p>
                <p className="text-[10px]">
                  دليل الاستثمار — تحليلات كمية ومعالجة فورية للأسواق المالية © 2026

              <div className="text-center pt-3 border-t border-slate-700/40 text-[11px] text-slate-500 print:pt-2">
                <p className="mb-0.5">
                  تم إنشاء هذا التقرير بواسطة نظام التحليل المالي الشامل
                </p>
                <p className="text-[10px]">
                  نظام تحليل مالي موحد — جميع البيانات من مصدر معتمد

                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <AlertTriangle className="w-12 h-12 mb-3 text-amber-400" />
              <p className="text-base font-bold text-amber-300 mb-1">
                تعذّر تحميل التحليل المهني لهذا السهم
              </p>
              <p className="text-xs text-slate-400 max-w-md">
                جاري تجهيز بيانات التحليل — حاول مرة أخرى أو اختر سهماً آخر.
              </p>
              {comprehensive?.errors && comprehensive.errors.length > 0 && (
                <details className="mt-3 text-left max-w-md">
                  <summary className="text-[11px] text-slate-500 cursor-pointer">
                    تفاصيل أخطاء المحركات ({comprehensive.errors.length})
                  </summary>
                  <pre className="text-[10px] text-red-400 mt-1 overflow-auto">
{comprehensive.errors.map((e, i) => `${i + 1}. ${e.engine ?? '?'}: ${e.error ?? ''}`).join('\n')}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!selectedStock && !loadingAnalysis && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Search className="w-16 h-16 mb-4 opacity-30 text-amber-400" />
          <p className="text-lg font-bold text-amber-300 mb-1">
            اختر سهماً لعرض التقرير
          </p>
          <p className="text-sm text-slate-400 max-w-md">
            التقرير يجمع كل قوة المشروع (التحليل الفني + الأساسي + المخاطر + التوصية)
            من نظام تحليل مالي موحد — مصدر معتمد.
          </p>
        </div>
      )}
    </div>
  );
}

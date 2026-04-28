'use client';

import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  ArrowUpCircle,
  ArrowDownCircle,
  MinusCircle,
  Activity,
  BarChart3,
  Zap,
  Gauge,
  Target,
  Crosshair,
  Layers,
  Volume2,
  PieChart,
  CandlestickChart,
  Clock,
  Shield,
  ArrowLeftRight,
  Info,
  Eye,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn, safeToFixed } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ============ TYPES ============

interface ProfessionalAnalysisData {
  scores: {
    composite: number;
    technical: number;
    value: number;
    quality: number;
    momentum: number;
    risk: number;
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
  patterns: {
    detected: Array<{ name: string; name_ar: string; type: 'bullish' | 'bearish' | 'neutral'; reliability: string }>;
    ma_cross: string | null;
  };
  risk_metrics: {
    sharpe_ratio: number;
    max_drawdown: number;
    max_drawdown_percent: number;
    var_95: number;
    beta: number;
    volatility_annualized: number;
  };
  price_levels: {
    support_1: number;
    support_2: number;
    resistance_1: number;
    resistance_2: number;
    pivot: number;
  };
  trend: {
    direction: string;
    direction_ar: string;
    strength: string;
    strength_ar: string;
  };
  volume_analysis: {
    avg_volume_20: number;
    current_vs_avg: number;
    signal: string;
    signal_ar: string;
  };
  data_quality?: {
    history_points: number;
    quality: string;
  };
}

// ============ HELPERS ============

function getScoreColor(s: number): string {
  if (s >= 70) return '#10b981';
  if (s >= 55) return '#22c55e';
  if (s >= 40) return '#eab308';
  return '#ef4444';
}

function getScoreLabel(s: number): string {
  if (s >= 82) return 'ممتاز';
  if (s >= 68) return 'جيد جداً';
  if (s >= 52) return 'جيد';
  if (s >= 42) return 'متوسط';
  if (s >= 28) return 'ضعيف';
  return 'ضعيف جداً';
}

function getRiskLabel(s: number): string {
  if (s >= 70) return 'مرتفعة';
  if (s >= 45) return 'متوسطة';
  return 'منخفضة';
}

function getRiskColor(s: number): string {
  if (s >= 70) return '#ef4444';
  if (s >= 45) return '#eab308';
  return '#10b981';
}

function fmt(n: number, d = 2): string {
  return safeToFixed(n, d);
}

function fmtLarge(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return safeToFixed(n / 1_000_000_000, 1) + ' مليار';
  if (abs >= 1_000_000) return safeToFixed(n / 1_000_000, 1) + ' مليون';
  if (abs >= 1_000) return safeToFixed(n / 1_000, 1) + ' ألف';
  return safeToFixed(n, 0);
}

function getTimeHorizonAr(h: string): string {
  const map: Record<string, string> = {
    short_term: 'قصير الأجل',
    medium_term: 'متوسط الأجل',
    long_term: 'طويل الأجل',
  };
  return map[h] || h;
}

function signalClass(text: string): string {
  const t = text.toLowerCase();
  const bull = ['إيجابي', 'صعود', 'شراء', 'اشتري', 'تشبع بيعي', 'مرتفع', 'صاعد', 'bullish', 'buy', 'positive', 'oversold', 'rising'];
  const bear = ['سلبي', 'هبوط', 'بيع', 'بع', 'تشبع شرائي', 'هبوطي', 'هابط', 'bearish', 'sell', 'negative', 'overbought', 'falling'];
  for (const w of bull) { if (t.includes(w)) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'; }
  for (const w of bear) { if (t.includes(w)) return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'; }
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
}

function n(val: unknown, fb = 0): number {
  const v = Number(val);
  return Number.isFinite(v) ? v : fb;
}

function extractProfessional(data: Record<string, unknown>): ProfessionalAnalysisData | null {
  const prof = (data.professional_analysis || data.professional) as Record<string, unknown> | undefined;
  if (!prof) return null;

  const scores = (prof.scores || {}) as Record<string, unknown>;
  const recommendation = (prof.recommendation || {}) as Record<string, unknown>;
  const indicators = (prof.indicators || {}) as Record<string, unknown>;
  const patterns = (prof.patterns || {}) as Record<string, unknown>;
  const riskMetrics = (prof.risk_metrics || {}) as Record<string, unknown>;
  const priceLevels = (prof.price_levels || {}) as Record<string, unknown>;
  const trend = (prof.trend || {}) as Record<string, unknown>;
  const volumeAnalysis = (prof.volume_analysis || {}) as Record<string, unknown>;
  const macd = (indicators.macd || {}) as Record<string, unknown>;
  const bollinger = (indicators.bollinger || {}) as Record<string, unknown>;
  const stochRsi = (indicators.stochastic_rsi || {}) as Record<string, unknown>;
  const roc = (indicators.roc || {}) as Record<string, unknown>;

  return {
    scores: {
      composite: n(scores.composite, 50),
      technical: n(scores.technical, 50),
      value: n(scores.value, 50),
      quality: n(scores.quality, 50),
      momentum: n(scores.momentum, 50),
      risk: n(scores.risk, 50),
    },
    recommendation: {
      action: (recommendation.action as string) || 'hold',
      action_ar: (recommendation.action_ar as string) || 'احتفاظ',
      confidence: n(recommendation.confidence, 0.5),
      entry_price: n(recommendation.entry_price),
      target_price: n(recommendation.target_price),
      stop_loss: n(recommendation.stop_loss),
      risk_reward_ratio: n(recommendation.risk_reward_ratio),
      time_horizon: (recommendation.time_horizon as string) || 'medium_term',
      time_horizon_ar: (recommendation.time_horizon_ar as string) || 'متوسط الأجل',
      summary_ar: (recommendation.summary_ar as string) || '',
    },
    indicators: {
      rsi: { value: n((indicators.rsi as Record<string, unknown>)?.value, 50), signal: ((indicators.rsi as Record<string, unknown>)?.signal as string) || 'neutral' },
      macd: {
        line: n(macd.line),
        signal: n(macd.signal),
        histogram: n(macd.histogram),
        signal_text: (macd.signal_text as string) || '',
      },
      bollinger: {
        upper: n(bollinger.upper),
        middle: n(bollinger.middle),
        lower: n(bollinger.lower),
        position: n(bollinger.position),
        signal_text: (bollinger.signal_text as string) || '',
      },
      stochastic_rsi: {
        k: n(stochRsi.k),
        d: n(stochRsi.d),
        signal_text: (stochRsi.signal_text as string) || '',
      },
      atr: n(indicators.atr),
      atr_percent: n(indicators.atr_percent),
      obv: n(indicators.obv),
      obv_trend: (indicators.obv_trend as string) || 'neutral',
      vwap: n(indicators.vwap),
      roc: {
        roc_5: n(roc.roc_5),
        roc_10: n(roc.roc_10),
        roc_20: n(roc.roc_20),
        signal_text: (roc.signal_text as string) || '',
      },
    },
    patterns: {
      detected: ((patterns.detected || []) as Array<Record<string, unknown>>).map((p) => ({
        name: (p.name as string) || '',
        name_ar: (p.name_ar as string) || '',
        type: (p.type as 'bullish' | 'bearish' | 'neutral') || 'neutral',
        reliability: (p.reliability as string) || '',
      })),
      ma_cross: (patterns.ma_cross as string) || null,
    },
    risk_metrics: {
      sharpe_ratio: n(riskMetrics.sharpe_ratio),
      max_drawdown: n(riskMetrics.max_drawdown),
      max_drawdown_percent: n(riskMetrics.max_drawdown_percent),
      var_95: n(riskMetrics.var_95),
      beta: n(riskMetrics.beta),
      volatility_annualized: n(riskMetrics.volatility_annualized),
    },
    price_levels: {
      support_1: n(priceLevels.support_1),
      support_2: n(priceLevels.support_2),
      resistance_1: n(priceLevels.resistance_1),
      resistance_2: n(priceLevels.resistance_2),
      pivot: n(priceLevels.pivot),
    },
    trend: {
      direction: (trend.direction as string) || 'neutral',
      direction_ar: (trend.direction_ar as string) || 'عرضي',
      strength: (trend.strength as string) || 'moderate',
      strength_ar: (trend.strength_ar as string) || 'متوسطة',
    },
    volume_analysis: {
      avg_volume_20: n(volumeAnalysis.avg_volume_20),
      current_vs_avg: n(volumeAnalysis.current_vs_avg),
      signal: (volumeAnalysis.signal as string) || 'normal',
      signal_ar: (volumeAnalysis.signal_ar as string) || 'عادي',
    },
    data_quality: prof.data_quality as { history_points: number; quality: string } | undefined,
  };
}

// ============ STANDALONE UI COMPONENTS ============

function CircularGauge({ score, size = 140, label }: { score: number; size?: number; label?: string }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = getScoreColor(score);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="absolute inset-0 -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" opacity={0.3} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>{safeToFixed(score, 0)}</span>
        <span className="text-[10px] text-muted-foreground">{label || 'من 100'}</span>
      </div>
    </div>
  );
}

function MiniScoreCard({ label, score, isRisk = false }: { label: string; score: number; isRisk?: boolean }) {
  const color = isRisk ? getRiskColor(score) : getScoreColor(score);
  const desc = isRisk ? getRiskLabel(score) : getScoreLabel(score);

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-lg font-bold tabular-nums" style={{ color }}>{safeToFixed(score, 0)}</span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(score, 100)}%`, backgroundColor: color }} />
      </div>
      <p className="text-[10px] text-muted-foreground">{desc}</p>
    </div>
  );
}

function ActionBadge({ action, actionAr }: { action: string; actionAr: string }) {
  const config: Record<string, { bg: string; icon: React.ReactNode }> = {
    strong_buy: { bg: 'bg-emerald-600', icon: <ArrowUpCircle className="w-5 h-5" /> },
    buy: { bg: 'bg-emerald-500', icon: <ArrowUpCircle className="w-5 h-5" /> },
    accumulate: { bg: 'bg-teal-500', icon: <Layers className="w-5 h-5" /> },
    hold: { bg: 'bg-amber-500', icon: <MinusCircle className="w-5 h-5" /> },
    sell: { bg: 'bg-red-500', icon: <ArrowDownCircle className="w-5 h-5" /> },
    strong_sell: { bg: 'bg-red-600', icon: <ArrowDownCircle className="w-5 h-5" /> },
  };
  const c = config[action] || { bg: 'bg-muted', icon: <MinusCircle className="w-5 h-5" /> };

  return (
    <div className={cn('flex items-center gap-2 px-4 py-2.5 rounded-xl text-white', c.bg)}>
      {c.icon}
      <span className="font-bold text-lg">{actionAr}</span>
    </div>
  );
}

function RiskRewardDiagram({ entry, target, stopLoss }: { entry: number; target: number; stopLoss: number }) {
  const allPrices = [entry, target, stopLoss].filter((p) => p > 0);
  if (allPrices.length < 2) return null;

  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;
  const padding = range * 0.15;
  const chartMin = minP - padding;
  const chartMax = maxP + padding;
  const chartRange = chartMax - chartMin;

  const toY = (price: number) => 90 - ((price - chartMin) / chartRange) * 70;

  return (
    <div className="flex flex-col items-center justify-center py-2">
      <svg viewBox="0 0 120 110" className="w-full max-w-[160px]" dir="ltr">
        <line x1="60" y1="15" x2="60" y2="100" stroke="hsl(var(--muted))" strokeWidth="2" />
        <circle cx="60" cy={toY(target)} r="7" fill="#10b981" opacity={0.2} />
        <circle cx="60" cy={toY(target)} r="4" fill="#10b981" />
        <text x="75" y={toY(target) + 4} fill="#10b981" fontSize="9" fontWeight="bold">{fmt(target)}</text>
        <text x="-5" y={toY(target) + 4} fill="#10b981" fontSize="7" textAnchor="end">هدف</text>
        <circle cx="60" cy={toY(entry)} r="7" fill="#3b82f6" opacity={0.2} />
        <circle cx="60" cy={toY(entry)} r="4" fill="#3b82f6" />
        <text x="75" y={toY(entry) + 4} fill="#3b82f6" fontSize="9" fontWeight="bold">{fmt(entry)}</text>
        <text x="-5" y={toY(entry) + 4} fill="#3b82f6" fontSize="7" textAnchor="end">دخول</text>
        <circle cx="60" cy={toY(stopLoss)} r="7" fill="#ef4444" opacity={0.2} />
        <circle cx="60" cy={toY(stopLoss)} r="4" fill="#ef4444" />
        <text x="75" y={toY(stopLoss) + 4} fill="#ef4444" fontSize="9" fontWeight="bold">{fmt(stopLoss)}</text>
        <text x="-5" y={toY(stopLoss) + 4} fill="#ef4444" fontSize="7" textAnchor="end">وقف</text>
      </svg>
    </div>
  );
}

function PriceLevelsVisual({ levels, currentPrice }: { levels: ProfessionalAnalysisData['price_levels']; currentPrice: number }) {
  const allPrices = [levels.support_2, levels.support_1, currentPrice, levels.resistance_1, levels.resistance_2].filter((p) => p > 0);
  if (allPrices.length < 2) return null;

  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;
  const padding = range * 0.12;
  const chartMin = minP - padding;
  const chartRange = (maxP + padding) - chartMin;
  const toPercent = (price: number) => ((price - chartMin) / chartRange) * 100;

  const items = [
    { label: 'مقاومة 2', price: levels.resistance_2, color: '#ef4444', side: 'right' as const },
    { label: 'مقاومة 1', price: levels.resistance_1, color: '#f87171', side: 'right' as const },
    { label: 'السعر الحالي', price: currentPrice, color: '#3b82f6', side: 'center' as const, isCurrent: true },
    { label: 'دعم 1', price: levels.support_1, color: '#10b981', side: 'left' as const },
    { label: 'دعم 2', price: levels.support_2, color: '#059669', side: 'left' as const },
  ].filter((i) => i.price > 0);

  return (
    <div className="relative py-4 px-2">
      <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-l from-red-300 via-blue-400 to-emerald-300" />
      <div className="relative flex flex-col gap-3" style={{ minHeight: '120px' }}>
        {items.map((item) => {
          const topPercent = toPercent(item.price);
          return (
            <div key={item.label} className="flex items-center gap-2" style={{ position: 'absolute', top: `${topPercent}%`, transform: 'translateY(-50%)' }}>
              {item.side === 'right' && (
                <>
                  <div className="hidden sm:flex flex-col items-end flex-1 min-w-0">
                    <span className="text-[10px] text-muted-foreground">{item.label}</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: item.color }} dir="ltr">{fmt(item.price)}</span>
                  </div>
                  <div className={cn('w-3 h-3 rounded-full border-2 border-background shadow-sm flex-shrink-0', item.isCurrent && 'ring-2 ring-blue-400 ring-offset-1 w-4 h-4')} style={{ backgroundColor: item.color }} />
                </>
              )}
              {item.side === 'center' && (
                <div className="flex-1 flex items-center justify-center gap-2">
                  <div className="w-4 h-4 rounded-full border-2 border-background shadow-sm ring-2 ring-blue-400 ring-offset-1 flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">{item.label}</span>
                    <span className="text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400" dir="ltr">{fmt(item.price)}</span>
                  </div>
                </div>
              )}
              {item.side === 'left' && (
                <>
                  <div className="w-3 h-3 rounded-full border-2 border-background shadow-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <div className="hidden sm:flex flex-col items-start flex-1 min-w-0">
                    <span className="text-[10px] text-muted-foreground">{item.label}</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: item.color }} dir="ltr">{fmt(item.price)}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="sm:hidden mt-4 flex flex-wrap gap-2 justify-center">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-[10px]">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-muted-foreground">{item.label}:</span>
            <span className="font-bold tabular-nums" dir="ltr">{fmt(item.price)}</span>
          </div>
        ))}
      </div>
      {levels.pivot > 0 && (
        <div className="mt-4 text-center">
          <Badge variant="outline" className="text-[10px]">
            نقطة المحور: <span className="font-bold tabular-nums ml-1" dir="ltr">{fmt(levels.pivot)}</span>
          </Badge>
        </div>
      )}
    </div>
  );
}

function MiniRiskGauge({ label, value, unit = '', thresholds }: { label: string; value: number; unit?: string; thresholds: { good: number; bad: number; invert?: boolean } }) {
  const { good, bad, invert = false } = thresholds;
  let color = '#eab308';
  if (invert) {
    if (value <= good) color = '#10b981';
    else if (value >= bad) color = '#ef4444';
  } else {
    if (value >= good) color = '#10b981';
    else if (value <= bad) color = '#ef4444';
  }

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold tabular-nums" style={{ color }} dir="ltr">{fmt(value)}{unit}</span>
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      </div>
    </div>
  );
}

function IndicatorCard({ title, icon, children, signalText }: { title: string; icon: React.ReactNode; children: React.ReactNode; signalText?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-emerald-600 dark:text-emerald-400">{icon}</span>
          <span className="text-xs font-semibold">{title}</span>
        </div>
        {signalText && (
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', signalClass(signalText))}>{signalText}</span>
        )}
      </div>
      <div className="text-xs text-muted-foreground space-y-1">{children}</div>
    </div>
  );
}

// ============ SECTION COMPONENTS (standalone) ============

function HeaderCard({ prof, stock, currentPrice, deepAnalysis }: { prof: ProfessionalAnalysisData | null; stock: { ticker: string; name_ar: string; current_price: number; rsi: number } | null; currentPrice: number; deepAnalysis: { ticker: string; stock_name_ar: string; overall_score: number; trend: string; trend_ar: string; action: string; action_ar: string } }) {
  const trendDir = prof?.trend.direction || deepAnalysis.trend;
  const trendAr = prof?.trend.direction_ar || deepAnalysis.trend_ar;
  const isBull = trendDir === 'bullish' || trendDir === 'uptrend';
  const isBear = trendDir === 'bearish' || trendDir === 'downtrend';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="w-4 h-4 text-emerald-600" />
          التحليل الاحترافي
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row items-center gap-6">
          <CircularGauge score={prof?.scores.composite ?? deepAnalysis.overall_score} size={160} />
          <div className="flex-1 text-center md:text-right space-y-3">
            <div>
              <h3 className="text-lg font-bold">{stock?.name_ar || deepAnalysis.stock_name_ar}</h3>
              <span className="text-sm text-muted-foreground tabular-nums" dir="ltr">{stock?.ticker || deepAnalysis.ticker}</span>
              <span className="text-sm text-muted-foreground mr-2">— {fmt(currentPrice)} ج.م</span>
            </div>
            <div className="flex items-center gap-2 justify-center md:justify-start">
              {isBull ? <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                : isBear ? <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />
                : <Minus className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              <span className="text-sm font-semibold">{trendAr}</span>
              {prof?.trend.strength_ar && (
                <Badge variant="outline" className="text-[10px]">{prof.trend.strength_ar}</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 justify-center md:justify-start">
              <ActionBadge action={prof?.recommendation.action || deepAnalysis.action} actionAr={prof?.recommendation.action_ar || deepAnalysis.action_ar} />
              {prof?.recommendation.confidence && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="secondary" className="text-xs cursor-help">
                        <Eye className="w-3 h-3 ml-1" />
                        ثقة {Math.round(prof.recommendation.confidence * 100)}%
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>مستوى الثقة في التحليل: {Math.round(prof.recommendation.confidence * 100)}%</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreCards({ prof, deepAnalysis }: { prof: ProfessionalAnalysisData | null; deepAnalysis: { technical_score: number; fundamental_score: number; risk_score: number } }) {
  if (prof) {
    const s = prof.scores;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-600" />
            تصنيف النتائج
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MiniScoreCard label="الشامل" score={s.composite} />
            <MiniScoreCard label="الفني" score={s.technical} />
            <MiniScoreCard label="القيمة" score={s.value} />
            <MiniScoreCard label="الجودة" score={s.quality} />
            <MiniScoreCard label="الزخم" score={s.momentum} />
            <MiniScoreCard label="المخاطر" score={s.risk} isRisk />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-600" />
          تصنيف النتائج
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">التحليل الفني</span>
              <span className="text-xs font-semibold tabular-nums" dir="ltr">{safeToFixed(deepAnalysis.technical_score, 0)}</span>
            </div>
            <Progress value={deepAnalysis.technical_score} className="h-2" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">التحليل الأساسي</span>
              <span className="text-xs font-semibold tabular-nums" dir="ltr">{safeToFixed(deepAnalysis.fundamental_score, 0)}</span>
            </div>
            <Progress value={deepAnalysis.fundamental_score} className="h-2" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">مستوى المخاطر</span>
              <span className="text-xs font-semibold tabular-nums" dir="ltr">{safeToFixed(100 - (deepAnalysis.risk_score || 0), 0)}</span>
            </div>
            <Progress value={100 - deepAnalysis.risk_score} className="h-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendationCard({ prof, deepAnalysis }: { prof: ProfessionalAnalysisData | null; deepAnalysis: { price_targets: { support: number; resistance: number; upside_target: number } } }) {
  if (!prof) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-600" />
            الأهداف السعرية
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-900/20">
              <p className="text-[11px] text-red-600 dark:text-red-400 mb-1">مستوى الدعم</p>
              <p className="font-bold text-sm tabular-nums" dir="ltr">{safeToFixed(deepAnalysis.price_targets?.support)}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted">
              <p className="text-[11px] text-muted-foreground mb-1">المقاومة</p>
              <p className="font-bold text-sm tabular-nums" dir="ltr">{safeToFixed(deepAnalysis.price_targets?.resistance)}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-1">الهدف الصاعد</p>
              <p className="font-bold text-sm tabular-nums" dir="ltr">{safeToFixed(deepAnalysis.price_targets?.upside_target)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rec = prof.recommendation;
  const rrColor = rec.risk_reward_ratio >= 2 ? '#10b981' : rec.risk_reward_ratio >= 1 ? '#eab308' : '#ef4444';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-emerald-600" />
          تفاصيل التحليل
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="outline" className="text-xs">
            <Clock className="w-3 h-3 ml-1" />
            {rec.time_horizon_ar}
          </Badge>
          <Badge variant="outline" className="text-xs">
            <Activity className="w-3 h-3 ml-1" />
            عائد/مخاطر: <span className="font-bold ml-1" style={{ color: rrColor }} dir="ltr">{safeToFixed(rec.risk_reward_ratio, 1)}</span>
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <p className="text-[11px] text-blue-600 dark:text-blue-400 mb-1 flex items-center justify-center gap-1">
              <ArrowLeftRight className="w-3 h-3" />
              سعر الدخول
            </p>
            <p className="font-bold text-sm tabular-nums" dir="ltr">{fmt(rec.entry_price)}</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-1 flex items-center justify-center gap-1">
              <Target className="w-3 h-3" />
              الهدف
            </p>
            <p className="font-bold text-sm tabular-nums" dir="ltr">{fmt(rec.target_price)}</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-[11px] text-red-600 dark:text-red-400 mb-1 flex items-center justify-center gap-1">
              <Shield className="w-3 h-3" />
              وقف الخسارة
            </p>
            <p className="font-bold text-sm tabular-nums" dir="ltr">{fmt(rec.stop_loss)}</p>
          </div>
        </div>
        <RiskRewardDiagram entry={rec.entry_price} target={rec.target_price} stopLoss={rec.stop_loss} />
        {rec.summary_ar && (
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{rec.summary_ar}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IndicatorsCard({ prof, deepAnalysis, stock }: { prof: ProfessionalAnalysisData | null; deepAnalysis: { technical_indicators: { rsi_signal: string; ma_signal: string; volume_signal: string; momentum: string } }; stock: { rsi: number } | null }) {
  if (!prof) {
    const signalLabel = (key: string, signal: string) => {
      const map: Record<string, string> = {
        rsi_signal: 'RSI', ma_signal: 'المتوسطات المتحركة', volume_signal: 'حجم التداول', momentum: 'الزخم',
      };
      const labelMap: Record<string, string> = {
        overbought: 'تشبع شرائي', oversold: 'تشبع بيعي', golden_cross: 'تقاطع ذهبي', death_cross: 'تقاطع مميت',
        high: 'مرتفع', positive: 'إيجابي', negative: 'سلبي', normal: 'محايد', neutral: 'محايد',
      };
      return { label: map[key] || key, text: labelMap[signal] || signal };
    };

    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            الإشارات الفنية
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {Object.entries(deepAnalysis.technical_indicators).map(([key, signal]) => {
              const { label, text } = signalLabel(key, signal);
              return (
                <div key={key} className="flex items-center justify-between py-1.5">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium', signalClass(text))}>{text}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  const ind = prof.indicators;
  const rsi = stock?.rsi || 50;
  const rsiSignal = rsi > 65 ? 'تشبع شرائي' : rsi < 35 ? 'تشبع بيعي' : 'محايد';
  const obvTrendAr = ind.obv_trend === 'rising' ? 'صاعد' : ind.obv_trend === 'falling' ? 'هابط' : 'محايد';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-600" />
          المؤشرات الفنية
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <IndicatorCard title="MACD" icon={<BarChart3 className="w-3.5 h-3.5" />} signalText={ind.macd.signal_text}>
            <div className="flex justify-between tabular-nums" dir="ltr">
              <span>الخط: {fmt(ind.macd.line, 4)}</span>
              <span>الإشارة: {fmt(ind.macd.signal, 4)}</span>
            </div>
            <div className="flex justify-between">
              <span>الهيستوغرام:</span>
              <span className="font-bold tabular-nums" dir="ltr" style={{ color: ind.macd.histogram > 0 ? '#10b981' : '#ef4444' }}>
                {ind.macd.histogram > 0 ? '+' : ''}{fmt(ind.macd.histogram, 4)}
              </span>
            </div>
          </IndicatorCard>

          <IndicatorCard title="بولينجر باند" icon={<Layers className="w-3.5 h-3.5" />} signalText={ind.bollinger.signal_text}>
            <div className="flex justify-between tabular-nums" dir="ltr">
              <span>علوي: {fmt(ind.bollinger.upper)}</span>
              <span>سفلي: {fmt(ind.bollinger.lower)}</span>
            </div>
            <div className="flex justify-between">
              <span>الوسطي:</span>
              <span className="font-bold tabular-nums" dir="ltr">{fmt(ind.bollinger.middle)}</span>
            </div>
            <div className="flex justify-between">
              <span>الموضع:</span>
              <span className="font-bold tabular-nums" dir="ltr">{fmt(ind.bollinger.position * 100, 0)}%</span>
            </div>
          </IndicatorCard>

          <IndicatorCard title="Stochastic RSI" icon={<Zap className="w-3.5 h-3.5" />} signalText={ind.stochastic_rsi.signal_text}>
            <div className="flex justify-between tabular-nums" dir="ltr">
              <span>%K: {fmt(ind.stochastic_rsi.k)}</span>
              <span>%D: {fmt(ind.stochastic_rsi.d)}</span>
            </div>
          </IndicatorCard>

          <IndicatorCard title="RSI (14)" icon={<Activity className="w-3.5 h-3.5" />} signalText={rsiSignal}>
            <div className="flex justify-between">
              <span>القيمة:</span>
              <span className="font-bold tabular-nums" dir="ltr">{fmt(rsi)}</span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted mt-1">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(rsi, 100)}%`, backgroundColor: rsi > 65 ? '#ef4444' : rsi < 35 ? '#10b981' : '#eab308' }} />
            </div>
          </IndicatorCard>

          <IndicatorCard title="معدل التغير (ROC)" icon={<TrendingUp className="w-3.5 h-3.5" />} signalText={ind.roc.signal_text}>
            <div className="flex justify-between tabular-nums" dir="ltr">
              <span>5 أيام: {ind.roc.roc_5 > 0 ? '+' : ''}{fmt(ind.roc.roc_5)}%</span>
              <span>20 يوم: {ind.roc.roc_20 > 0 ? '+' : ''}{fmt(ind.roc.roc_20)}%</span>
            </div>
            <div className="flex justify-between">
              <span>10 أيام:</span>
              <span className="font-bold tabular-nums" dir="ltr" style={{ color: ind.roc.roc_10 > 0 ? '#10b981' : '#ef4444' }}>
                {ind.roc.roc_10 > 0 ? '+' : ''}{fmt(ind.roc.roc_10)}%
              </span>
            </div>
          </IndicatorCard>

          <IndicatorCard title="ATR / VWAP" icon={<CandlestickChart className="w-3.5 h-3.5" />}>
            <div className="flex justify-between">
              <span>ATR:</span>
              <span className="font-bold tabular-nums" dir="ltr">{fmt(ind.atr)}</span>
            </div>
            <div className="flex justify-between">
              <span>ATR%:</span>
              <span className="font-bold tabular-nums" dir="ltr">{fmt(ind.atr_percent)}%</span>
            </div>
            <div className="flex justify-between">
              <span>VWAP:</span>
              <span className="font-bold tabular-nums" dir="ltr">{fmt(ind.vwap)}</span>
            </div>
          </IndicatorCard>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-lg border p-2.5">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium">حجم التداول (OBV):</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums" dir="ltr">{fmtLarge(ind.obv)}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', signalClass(obvTrendAr))}>{obvTrendAr}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PriceLevelsCard({ prof, currentPrice }: { prof: ProfessionalAnalysisData | null; currentPrice: number }) {
  if (!prof) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-600" />
          مستويات الأسعار
        </CardTitle>
      </CardHeader>
      <CardContent>
        <PriceLevelsVisual levels={prof.price_levels} currentPrice={currentPrice} />
      </CardContent>
    </Card>
  );
}

function PatternCard({ prof }: { prof: ProfessionalAnalysisData | null }) {
  if (!prof) return null;
  if (prof.patterns.detected.length === 0 && !prof.patterns.ma_cross) return null;

  const patternBadge = (type: string) => {
    switch (type) {
      case 'bullish': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
      case 'bearish': return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
      default: return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
    }
  };
  const typeAr = (type: string) => {
    switch (type) { case 'bullish': return 'صعودي'; case 'bearish': return 'هبوطي'; default: return 'محايد'; }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CandlestickChart className="w-4 h-4 text-emerald-600" />
          أنماط الرسم البياني
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {prof.patterns.detected.map((p, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{p.name_ar}</span>
                <span className="text-[10px] text-muted-foreground" dir="ltr">({p.name})</span>
              </div>
              <div className="flex items-center gap-1.5">
                {p.reliability && <span className="text-[10px] text-muted-foreground">{p.reliability}</span>}
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', patternBadge(p.type))}>{typeAr(p.type)}</span>
              </div>
            </div>
          ))}
          {prof.patterns.ma_cross && (
            <div className="flex items-center justify-between rounded-lg border p-2.5 bg-muted/30">
              <span className="text-xs font-medium">تقاطع المتوسطات المتحركة</span>
              <span className={cn(
                'text-[10px] px-2 py-0.5 rounded-full font-medium',
                prof.patterns.ma_cross === 'golden_cross'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
              )}>
                {prof.patterns.ma_cross === 'golden_cross' ? 'تقاطع ذهبي ✦' : 'تقاطع مميت ✦'}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function VolumeCard({ prof }: { prof: ProfessionalAnalysisData | null }) {
  if (!prof) return null;
  const vol = prof.volume_analysis;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-emerald-600" />
          تحليل الحجم
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border p-3 text-center">
            <p className="text-[10px] text-muted-foreground mb-1">متوسط الحجم (20 يوم)</p>
            <p className="font-bold text-sm tabular-nums" dir="ltr">{fmtLarge(vol.avg_volume_20)}</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-[10px] text-muted-foreground mb-1">الحجم الحالي / المتوسط</p>
            <p className="font-bold text-sm tabular-nums" style={{ color: vol.current_vs_avg > 1 ? '#10b981' : vol.current_vs_avg < 0.8 ? '#ef4444' : '#eab308' }} dir="ltr">
              {fmt(vol.current_vs_avg)}x
            </p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-[10px] text-muted-foreground mb-1">إشارة الحجم</p>
            <span className={cn('text-xs px-2 py-1 rounded-full font-medium', signalClass(vol.signal_ar))}>{vol.signal_ar}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RiskMetricsCard({ prof }: { prof: ProfessionalAnalysisData | null }) {
  if (!prof) return null;
  const rm = prof.risk_metrics;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-600" />
          مقاييس المخاطر
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <MiniRiskGauge label="نسبة شارب (Sharpe)" value={rm.sharpe_ratio} thresholds={{ good: 1, bad: -0.5 }} />
          <MiniRiskGauge label="بيتا (Beta)" value={rm.beta} thresholds={{ good: 0.8, bad: 1.5 }} />
          <MiniRiskGauge label="أقصى انخفاض" value={rm.max_drawdown_percent} unit="%" thresholds={{ good: 10, bad: 30, invert: true }} />
          <MiniRiskGauge label="VaR 95%" value={rm.var_95} unit="%" thresholds={{ good: 2, bad: 5, invert: true }} />
          <MiniRiskGauge label="التقلب السنوي" value={rm.volatility_annualized * 100} unit="%" thresholds={{ good: 20, bad: 40, invert: true }} />
          <MiniRiskGauge label="قيمة أقصى انخفاض" value={rm.max_drawdown} unit=" ج.م" thresholds={{ good: 1, bad: 10, invert: true }} />
        </div>
      </CardContent>
    </Card>
  );
}

function StrengthsRisksCard({ prof, deepAnalysis }: { prof: ProfessionalAnalysisData | null; deepAnalysis: { strengths: string[]; risks: string[] } }) {
  let strengths = [...(deepAnalysis.strengths || [])];
  let risks = [...(deepAnalysis.risks || [])];

  if (prof) {
    const s = prof.scores;
    if (s.technical >= 70) strengths.push('قوة فنية متميزة مع إشارات إيجابية');
    if (s.value >= 70) strengths.push('تقييم جذاب من منظور القيمة');
    if (s.quality >= 70) strengths.push('جودة أعمال عالية مع عوائد ممتازة');
    if (s.momentum >= 70) strengths.push('زخم إيجابي قوي في حركة السعر');
    if (s.risk <= 30) strengths.push('مستوى مخاطر منخفض نسبياً');
    if (s.risk >= 65) risks.push('مستوى مخاطر مرتفع يتطلب حذراً');
    if (s.technical <= 30) risks.push('ضعف واضح في المؤشرات الفنية');
    if (s.value <= 30) risks.push('تقييم مرتفع مقارنة بالأقران');
    if (prof.risk_metrics.beta > 1.5) risks.push('حساسية عالية لتقلبات السوق (بيتا مرتفع)');
    if (prof.indicators.atr_percent > 4) risks.push('تقلب يومي مرتفع قد يؤثر على القرارات');
  }

  const dedup = <T,>(arr: T[]): T[] => { const seen = new Set(); return arr.filter((item) => { const k = String(item); if (seen.has(k)) return false; seen.add(k); return true; }); };
  strengths = dedup(strengths).slice(0, 5);
  risks = dedup(risks).slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <PieChart className="w-4 h-4 text-emerald-600" />
          نقاط القوة والمخاطر
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              نقاط القوة
            </h4>
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {strengths.map((str, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{str}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              المخاطر
            </h4>
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============ SKELETON ============

function AnalysisSkeleton() {
  return (
    <div className="space-y-6" dir="rtl">
      <Skeleton className="h-10 w-48 mx-auto" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-40" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-32" />
    </div>
  );
}

// ============ MAIN COMPONENT ============

export function DeepAnalysis() {
  const { deepAnalysis, professionalAnalysis, selectedStock, isLoading } = useAppStore();

  if (isLoading && !deepAnalysis) {
    return <AnalysisSkeleton />;
  }

  if (!deepAnalysis) {
    return null;
  }

  const prof = professionalAnalysis ? extractProfessional(professionalAnalysis) : null;
  const currentPrice = selectedStock?.current_price || deepAnalysis.current_price;

  return (
    <div className="space-y-4" dir="rtl">
      <HeaderCard prof={prof} stock={selectedStock} currentPrice={currentPrice} deepAnalysis={deepAnalysis} />
      <ScoreCards prof={prof} deepAnalysis={deepAnalysis} />
      <RecommendationCard prof={prof} deepAnalysis={deepAnalysis} />
      <IndicatorsCard prof={prof} deepAnalysis={deepAnalysis} stock={selectedStock} />
      <PriceLevelsCard prof={prof} currentPrice={currentPrice} />
      <PatternCard prof={prof} />
      <VolumeCard prof={prof} />
      <RiskMetricsCard prof={prof} />
      <StrengthsRisksCard prof={prof} deepAnalysis={deepAnalysis} />

      {prof?.data_quality && (
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">
            <Info className="w-3 h-3 inline-block ml-1" />
            جودة البيانات: {prof.data_quality.quality === 'high' ? 'عالية' : prof.data_quality.quality === 'medium' ? 'متوسطة' : 'منخفضة'} ({prof.data_quality.history_points} نقطة بيانات)
          </p>
        </div>
      )}
    </div>
  );
}

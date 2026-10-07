'use client';

// TASK 36-C — EntryTimingSimulator (محاكي توقيت الدخول)
// Owner directive: «محتاجين رفع كفائة التعليم... نزود فى المساعدات التعليمية
// من صور ومحاكيات ورسوم بيانية ورسوم توضيحية»
//
// Compares 3 entry-timing strategies vs Buy-and-Hold on a real EGX
// ticker (default: COMI). Tries to fetch real price history from
// /api/stocks/[ticker]/history. If unavailable, falls back to
// deterministic synthetic data CLEARLY LABELED as educational
// simulation (Rule 67 — no fabricated numbers pretending to be real).
//
// Teaches: timing matters, but strategy must fit market conditions.

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  Calendar,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Clock,
  AlertTriangle,
  Database,
  Sparkles,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { mulberry32 } from './LearningVisuals';
// CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing.
// TS canonical source: src/lib/unified-stock-data.ts::computeRSI.
import { computeRSI } from '@/lib/unified-stock-data';

/* ────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────── */
interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

type StrategyId = 'breakout' | 'pullback' | 'mean_reversion';

interface Trade {
  entryIdx: number;
  entryDate: string;
  entryPrice: number;
  exitIdx: number;
  exitDate: string;
  exitPrice: number;
  pnlPct: number; // (exit - entry) / entry
  rMultiple: number; // pnl / risk
  reason: string; // exit reason
}

interface BacktestResult {
  trades: Trade[];
  winRate: number; // 0..100
  avgR: number;
  totalReturn: number; // decimal (0.15 = +15%)
  buyHoldReturn: number;
  equityCurve: { idx: number; strategy: number; buyHold: number }[];
  entryMarkers: { idx: number; price: number; type: 'buy' | 'sell' }[];
  numTrades: number;
  avgHoldDays: number;
}

interface StrategyDef {
  id: StrategyId;
  name: string;
  nameEn: string;
  emoji: string;
  desc: string;
  fitMarket: string;
}

const STRATEGIES: StrategyDef[] = [
  {
    id: 'breakout',
    name: 'اختراق القمة',
    nameEn: 'Breakout',
    emoji: '🚀',
    desc: 'شراء عند كسر قمة آخر 20 يوم. وقف أسفل قمة الاختراق. خروج عند كسر قاع آخر 10 أيام.',
    fitMarket: 'المرحلة 2 (صاعد بزخم)',
  },
  {
    id: 'pullback',
    name: 'الارتداد للمتوسط',
    nameEn: 'Pullback',
    emoji: '🎯',
    desc: 'شراء عند ارتداد السعر لمتوسط 20 يوم في ترند صاعد (close > MA50). خروج عند كسر MA20.',
    fitMarket: 'المرحلة 2 (صاعد مستقر)',
  },
  {
    id: 'mean_reversion',
    name: 'العودة للمتوسط',
    nameEn: 'Mean Reversion',
    emoji: '🔄',
    desc: 'شراء عند RSI(2) < 10 وفوق MA200. خروج عند RSI(2) > 50.',
    fitMarket: 'المرحلة 1/3 (عرضي متذبذب)',
  },
];

/* ────────────────────────────────────────────────────────────
   Indicator helpers
   ──────────────────────────────────────────────────────────── */
function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing (Connors RSI-2).
// Math is Wilder's with period=2 (matching canonical formula).
// Kept as series form (returns number[]) for chart rendering.
// Single-value RSI calls must use computeRSI() from '@/lib/unified-stock-data'.
function rsi2(closes: number[]): number[] {
  // RSI with period=2 (Connors style)
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < 3) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= 2; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= 2;
  avgLoss /= 2;
  for (let i = 2; i < closes.length; i++) {
    if (i > 2) {
      const ch = closes[i] - closes[i - 1];
      const gain = ch > 0 ? ch : 0;
      const loss = ch < 0 ? -ch : 0;
      avgGain = (avgGain * 1 + gain) / 2;
      avgLoss = (avgLoss * 1 + loss) / 2;
    }
    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

function rollingHigh(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let mx = -Infinity;
    for (let j = i - period + 1; j <= i; j++) mx = Math.max(mx, values[j]);
    out[i] = mx;
  }
  return out;
}

function rollingLow(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let mn = Infinity;
    for (let j = i - period + 1; j <= i; j++) mn = Math.min(mn, values[j]);
    out[i] = mn;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────
   Strategy backtest engine
   ──────────────────────────────────────────────────────────── */
function backtest(
  prices: PricePoint[],
  strat: StrategyId,
): BacktestResult {
  const closes = prices.map((p) => p.close);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const r2 = rsi2(closes);
  const hh20 = rollingHigh(closes.slice(0, closes.length - 1), 20); // prior 20-day high (exclude today)
  const ll10 = rollingLow(closes, 10);
  const trades: Trade[] = [];
  const entryMarkers: { idx: number; price: number; type: 'buy' | 'sell' }[] = [];

  let inPos = false;
  let entryIdx = -1;
  let entryPrice = 0;
  let stop = 0;
  let holdDays = 0;

  // Strategy parameters
  const stratConfig: Record<StrategyId, { entryStart: number; riskPct: number }> = {
    breakout: { entryStart: 20, riskPct: 0.05 },
    pullback: { entryStart: 50, riskPct: 0.04 },
    mean_reversion: { entryStart: 200, riskPct: 0.05 },
  };
  const startIdx = stratConfig[strat].entryStart;
  const riskPct = stratConfig[strat].riskPct;

  function exitTrade(idx: number, reason: string) {
    if (!inPos) return;
    const exitPrice = closes[idx];
    const pnlPct = (exitPrice - entryPrice) / entryPrice;
    const risk = entryPrice * riskPct;
    const rMultiple = risk > 0 ? (exitPrice - entryPrice) / risk : 0;
    trades.push({
      entryIdx,
      entryDate: prices[entryIdx].date,
      entryPrice,
      exitIdx: idx,
      exitDate: prices[idx].date,
      exitPrice,
      pnlPct,
      rMultiple,
      reason,
    });
    entryMarkers.push({ idx, price: exitPrice, type: 'sell' });
    inPos = false;
    entryIdx = -1;
    entryPrice = 0;
    stop = 0;
    holdDays = 0;
  }

  for (let i = startIdx; i < prices.length; i++) {
    if (inPos) {
      holdDays++;
      // Exit conditions
      if (strat === 'breakout') {
        if (closes[i] < ll10[i - 1]) {
          exitTrade(i, 'كسر قاع 10 أيام');
          continue;
        }
        if (closes[i] < stop) {
          exitTrade(i, 'ضرب الوقف');
          continue;
        }
        // Trailing stop: update to recent low
        stop = Math.max(stop, ll10[i - 1] * 0.98);
      } else if (strat === 'pullback') {
        if (closes[i] < ma20[i]) {
          exitTrade(i, 'كسر MA20');
          continue;
        }
        if (closes[i] < stop) {
          exitTrade(i, 'ضرب الوقف');
          continue;
        }
      } else if (strat === 'mean_reversion') {
        if (r2[i] > 50) {
          exitTrade(i, 'RSI2 > 50');
          continue;
        }
        if (closes[i] < stop) {
          exitTrade(i, 'ضرب الوقف');
          continue;
        }
      }
      // Force exit on last day
      if (i === prices.length - 1) {
        exitTrade(i, 'إغلاق في آخر يوم');
      }
    } else {
      // Entry conditions
      if (strat === 'breakout') {
        // Buy when close breaks above prior 20-day high
        if (!isNaN(hh20[i - 1]) && closes[i] > hh20[i - 1]) {
          inPos = true;
          entryIdx = i;
          entryPrice = closes[i];
          stop = entryPrice * (1 - riskPct);
          entryMarkers.push({ idx: i, price: entryPrice, type: 'buy' });
        }
      } else if (strat === 'pullback') {
        // Buy when in uptrend (close > MA50) and price pulls back to MA20
        const trendUp = !isNaN(ma50[i]) && closes[i] > ma50[i];
        const pulledBack =
          !isNaN(ma20[i]) &&
          Math.abs(closes[i] - ma20[i]) / ma20[i] < 0.015 &&
          closes[i - 1] < closes[i];
        if (trendUp && pulledBack) {
          inPos = true;
          entryIdx = i;
          entryPrice = closes[i];
          stop = ma20[i] * 0.98;
          entryMarkers.push({ idx: i, price: entryPrice, type: 'buy' });
        }
      } else if (strat === 'mean_reversion') {
        // Buy when RSI2 < 10 and above MA200
        const aboveLongTrend = !isNaN(ma200[i]) && closes[i] > ma200[i];
        if (r2[i] < 10 && aboveLongTrend) {
          inPos = true;
          entryIdx = i;
          entryPrice = closes[i];
          stop = entryPrice * (1 - riskPct);
          entryMarkers.push({ idx: i, price: entryPrice, type: 'buy' });
        }
      }
    }
  }

  // Close any open trade at last price
  if (inPos) {
    exitTrade(prices.length - 1, 'إغلاق يدوي');
  }

  const numTrades = trades.length;
  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0;
  const avgR = numTrades > 0 ? trades.reduce((s, t) => s + t.rMultiple, 0) / numTrades : 0;
  const avgHoldDays = numTrades > 0 ? trades.reduce((s, t) => s + (t.exitIdx - t.entryIdx), 0) / numTrades : 0;

  // Equity curves: strategy (compounding per trade) vs buy & hold
  const equityCurve: { idx: number; strategy: number; buyHold: number }[] = [];
  let stratEquity = 1;
  let tradePtr = 0;
  for (let i = 0; i < prices.length; i++) {
    // Buy & hold
    const bh = closes[i] / closes[0];
    // Strategy: track between trades, jump at trade exits
    if (tradePtr < trades.length && i === trades[tradePtr].exitIdx) {
      stratEquity *= 1 + trades[tradePtr].pnlPct;
      tradePtr++;
    }
    equityCurve.push({ idx: i, strategy: stratEquity, buyHold: bh });
  }

  const totalReturn = stratEquity - 1;
  const buyHoldReturn = closes[closes.length - 1] / closes[0] - 1;

  return {
    trades,
    winRate,
    avgR,
    totalReturn,
    buyHoldReturn,
    equityCurve,
    entryMarkers,
    numTrades,
    avgHoldDays,
  };
}

/* ────────────────────────────────────────────────────────────
   Synthetic data fallback (deterministic seeded)
   Used when the real /api/stocks/[ticker]/history endpoint
   fails (e.g., sandbox without DB). CLEARLY labeled.
   ──────────────────────────────────────────────────────────── */
function generateSyntheticPrices(ticker: string, days: number = 252): PricePoint[] {
  // Seed from ticker name
  let h = 2166136261;
  for (let i = 0; i < ticker.length; i++) {
    h ^= ticker.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rng = mulberry32(h >>> 0);
  const out: PricePoint[] = [];
  let price = 30 + rng() * 70; // 30-100
  // Simulate regime: up → sideways → down → up
  const regimes = [
    { days: Math.floor(days * 0.35), drift: 0.0008, vol: 0.015 },
    { days: Math.floor(days * 0.20), drift: 0.0000, vol: 0.020 },
    { days: Math.floor(days * 0.25), drift: -0.0006, vol: 0.018 },
    { days: Math.floor(days * 0.20), drift: 0.0010, vol: 0.014 },
  ];
  let regimeIdx = 0;
  let regimeDay = 0;
  const start = new Date();
  start.setDate(start.getDate() - days);
  for (let i = 0; i < days; i++) {
    if (regimeIdx < regimes.length - 1 && regimeDay >= regimes[regimeIdx].days) {
      regimeIdx++;
      regimeDay = 0;
    }
    const r = regimes[regimeIdx];
    const ret = r.drift + r.vol * (rng() - 0.5) * 2;
    const open = price;
    const close = Math.max(0.5, price * (1 + ret));
    const high = Math.max(open, close) * (1 + rng() * 0.008);
    const low = Math.min(open, close) * (1 - rng() * 0.008);
    const volume = Math.floor(100000 + rng() * 900000);
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push({
      date: d.toISOString().slice(0, 10),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume,
    });
    price = close;
    regimeDay++;
  }
  return out;
}

/* ============================================================
   EntryTimingSimulator component
   ============================================================ */
export function EntryTimingSimulator() {
  const [ticker, setTicker] = React.useState<string>('COMI');
  const [activeStrat, setActiveStrat] = React.useState<StrategyId>('breakout');
  const [loading, setLoading] = React.useState<boolean>(true);
  const [prices, setPrices] = React.useState<PricePoint[]>([]);
  const [dataSource, setDataSource] = React.useState<'real' | 'synthetic'>('synthetic');
  const [error, setError] = React.useState<string | null>(null);

  const fetchPrices = React.useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stocks/${encodeURIComponent(t)}/history?days=365`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data) && data.data.length >= 50) {
          // Normalize: ensure each row has close, high, low, open, date
          const clean: PricePoint[] = data.data
            .map((row: any) => ({
              date: String(row.date ?? ''),
              open: Number(row.open ?? row.close ?? 0),
              high: Number(row.high ?? row.close ?? 0),
              low: Number(row.low ?? row.close ?? 0),
              close: Number(row.close ?? 0),
              volume: Number(row.volume ?? 0),
            }))
            .filter((r: PricePoint) => r.close > 0);
          if (clean.length >= 50) {
            setPrices(clean);
            setDataSource('real');
            setLoading(false);
            return;
          }
        }
      }
      // Fallback to synthetic
      setPrices(generateSyntheticPrices(t, 252));
      setDataSource('synthetic');
    } catch (e: any) {
      setPrices(generateSyntheticPrices(t, 252));
      setDataSource('synthetic');
      setError(e?.message ?? 'فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchPrices('COMI');
  }, [fetchPrices]);

  // Run backtest for all 3 strategies (so we can show comparison)
  const results: Record<StrategyId, BacktestResult> = React.useMemo(() => {
    if (prices.length < 50) {
      return {
        breakout: emptyResult(),
        pullback: emptyResult(),
        mean_reversion: emptyResult(),
      };
    }
    return {
      breakout: backtest(prices, 'breakout'),
      pullback: backtest(prices, 'pullback'),
      mean_reversion: backtest(prices, 'mean_reversion'),
    };
  }, [prices]);

  const active = results[activeStrat];
  const activeDef = STRATEGIES.find((s) => s.id === activeStrat)!;

  function handleRefresh() {
    fetchPrices(ticker);
  }

  function handleTickerSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = ticker.toUpperCase().trim().slice(0, 10);
    if (clean.length >= 2) {
      setTicker(clean);
      fetchPrices(clean);
    }
  }

  return (
    <Card className="border-amber-500/20" dir="rtl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          محاكي توقيت الدخول — مقارنة استراتيجيات
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          بيختبر 3 استراتيجيات دخول على بيانات حقيقية من EGX (افتراضي: COMI).
          بيوضح إن التوقيت بفرق — لكن مفيش استراتيجية واحدة بتفوز في كل ظروف السوق.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ticker input + data source badge */}
        <div className="flex flex-wrap items-center gap-2" dir="rtl">
          <form onSubmit={handleTickerSubmit} className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              السهم:
            </label>
            <Input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              maxLength={10}
              className="h-8 w-24 text-sm"
              placeholder="COMI"
            />
            <Button type="submit" size="sm" variant="outline">
              تحميل
            </Button>
          </form>
          <Button onClick={handleRefresh} variant="ghost" size="sm">
            <RefreshCw className="ml-1 h-3.5 w-3.5" />
            تحديث
          </Button>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px]',
              dataSource === 'real'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
            )}
          >
            {dataSource === 'real' ? (
              <>
                <Database className="ml-1 h-3 w-3" />
                بيانات حقيقية ({prices.length} يوم)
              </>
            ) : (
              <>
                <Sparkles className="ml-1 h-3 w-3" />
                بيانات تعليمية محاكاة ({prices.length} يوم)
              </>
            )}
          </Badge>
        </div>

        {dataSource === 'synthetic' && (
          <div
            className="rounded-md border border-amber-500/30 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-200"
            dir="rtl"
          >
            <span className="font-semibold">ملاحظة:</span> تعذّر تحميل البيانات الحقيقية
            {error ? ` (${error})` : ''} — يتم استخدام بيانات تعليمية محاكاة بشكل حتمي.
            النتائج تُظهر كيف تعمل الاستراتيجيات، لكنها ليست أداءً تاريخيًا فعليًا.
            على الإنتاج مع البيانات الحقيقية ستظهر الأرقام الفعلية تلقائيًا.
          </div>
        )}

        {/* Strategy selector */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" dir="rtl">
          {STRATEGIES.map((s) => {
            const isActive = s.id === activeStrat;
            const r = results[s.id];
            return (
              <button
                key={s.id}
                onClick={() => setActiveStrat(s.id)}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border p-3 text-right transition',
                  isActive
                    ? 'border-amber-500/60 bg-amber-500/10 shadow-sm'
                    : 'border-slate-200 bg-card hover:bg-muted/30 dark:border-slate-700',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg">{s.emoji}</span>
                  <span className="text-[10px] font-bold text-muted-foreground" dir="ltr">
                    {s.nameEn}
                  </span>
                </div>
                <div className="text-sm font-bold">{s.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  يناسب: {s.fitMarket}
                </div>
                {!loading && (
                  <div className="mt-1 flex items-center gap-2 text-[10px]">
                    <span className={cn('font-bold', r.totalReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {(r.totalReturn * 100).toFixed(1)}%
                    </span>
                    <span className="text-muted-foreground">
                      · {r.numTrades} صفقة
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Active strategy description */}
        <div className="rounded-lg border border-slate-200 bg-muted/30 p-3 dark:border-slate-700" dir="rtl">
          <div className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
            {activeDef.emoji} {activeDef.name} — {activeDef.nameEn}
          </div>
          <p className="text-[11px] leading-relaxed text-foreground">{activeDef.desc}</p>
        </div>

        {loading ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            <Activity className="ml-2 h-4 w-4 animate-pulse" />
            جاري تحميل البيانات وتشغيل الباكتست...
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-4"
          >
            {/* Performance comparison */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <MetricCard
                icon={TrendingUp}
                label="عائد الاستراتيجية"
                value={`${(active.totalReturn * 100).toFixed(1)}%`}
                color={active.totalReturn >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}
              />
              <MetricCard
                icon={TrendingDown}
                label="عائد Buy & Hold"
                value={`${(active.buyHoldReturn * 100).toFixed(1)}%`}
                color={active.buyHoldReturn >= 0 ? 'text-slate-700 dark:text-slate-300' : 'text-red-700 dark:text-red-400'}
              />
              <MetricCard
                icon={Target}
                label="معدل الربح"
                value={`${active.winRate.toFixed(0)}%`}
                color="text-amber-700 dark:text-amber-400"
              />
              <MetricCard
                icon={Activity}
                label="متوسط R"
                value={active.avgR.toFixed(2)}
                color={active.avgR >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}
              />
              <MetricCard
                icon={Calendar}
                label="عدد الصفقات"
                value={String(active.numTrades)}
                color="text-slate-700 dark:text-slate-300"
              />
            </div>

            {/* Equity curve chart */}
            <EquityCurveChart result={active} prices={prices} stratName={activeDef.name} />

            {/* Entry/exit markers chart */}
            <PriceChartWithMarkers prices={prices} result={active} />

            {/* Trade list */}
            {active.trades.length > 0 && (
              <TradeList result={active} />
            )}

            {/* Educational takeaway */}
            <div
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
              dir="rtl"
            >
              <div className="mb-1 font-bold">درس المحاكاة:</div>
              الاستراتيجية المثالية لا توجد — كل استراتيجية بتنجح في ظروف سوق معينة.
              <ul className="mt-1 space-y-0.5">
                <li>• <span className="font-semibold">Breakout</span> بتفوز في المرحلة 2 (صاعد بزخم) وتفشل في المرحلة 3 (توزيع).</li>
                <li>• <span className="font-semibold">Pullback</span> بتنجح في الترند المستقر وتفشل في الترند العنيف.</li>
                <li>• <span className="font-semibold">Mean Reversion</span> بتنجح في السوق العرضي وتفشل في الترند القوي.</li>
              </ul>
              الـ Buy & Hold أحيانًا بيكسب الاستراتيجية لأنه بتجنب الـ whipsaw
              (إشارات كاذبة). لكنه بيتحمّل كامل الخسارة في الـ bear market.
              الاختيار يعتمد على مرحلة السوق + قدرتك على تحمّل التذبذب.
            </div>

            <div className="rounded-md border border-amber-500/30 bg-amber-50/60 px-3 py-2 text-[10px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-200" dir="rtl">
              <span className="font-semibold">إخلاء مسؤولية:</span> الباكتست تعليمي.
              الأداء التاريخي لا يضمن المستقبلي. الرسوم والـ slippage غير محسوبة.
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Equity curve chart: strategy vs Buy & Hold ── */
function EquityCurveChart({
  result,
  prices,
  stratName,
}: {
  result: BacktestResult;
  prices: PricePoint[];
  stratName: string;
}) {
  const W = 800;
  const H = 240;
  const PAD_L = 50;
  const PAD_R = 20;
  const PAD_T = 20;
  const PAD_B = 30;
  const N = result.equityCurve.length;
  if (N < 2) return null;

  const allVals = result.equityCurve.flatMap((p) => [p.strategy, p.buyHold]);
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const yMin = Math.min(0.9, minV * 0.98);
  const yMax = Math.max(1.1, maxV * 1.02);

  const x = (i: number) => PAD_L + (i / (N - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);

  const stratPath = result.equityCurve
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.strategy).toFixed(1)}`)
    .join(' ');
  const bhPath = result.equityCurve
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.buyHold).toFixed(1)}`)
    .join(' ');

  return (
    <div className="rounded-lg border border-slate-200 bg-card p-3 dark:border-slate-700" dir="rtl">
      <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
        منحنى رأس المال — {stratName} مقابل Buy & Hold
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="منحنى رأس المال"
        style={{ maxWidth: '100%', height: 'auto' }}
      >
        {/* Y-axis gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const v = yMin + (yMax - yMin) * f;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={yy} x2={W - PAD_R} y2={yy} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="3,3" />
              <text x={PAD_L - 6} y={yy + 3} textAnchor="end" fontSize="9" fill="#64748b">
                {((v - 1) * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* Buy & Hold line (slate) */}
        <path d={bhPath} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4,3" />

        {/* Strategy line (emerald or red) */}
        <path
          d={stratPath}
          fill="none"
          stroke={result.totalReturn >= 0 ? '#10b981' : '#ef4444'}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Legend */}
        <g transform={`translate(${PAD_L + 6}, ${PAD_T + 6})`}>
          <rect x="0" y="0" width="170" height="34" fill="#fff" stroke="#e2e8f0" rx="3" opacity="0.95" />
          <line x1="8" y1="12" x2="22" y2="12" stroke={result.totalReturn >= 0 ? '#10b981' : '#ef4444'} strokeWidth="2.5" />
          <text x="26" y="15" fontSize="9" fill="#475569">الاستراتيجية ({(result.totalReturn * 100).toFixed(1)}%)</text>
          <line x1="8" y1="26" x2="22" y2="26" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4,3" />
          <text x="26" y="29" fontSize="9" fill="#64748b">Buy & Hold ({(result.buyHoldReturn * 100).toFixed(1)}%)</text>
        </g>
      </svg>
    </div>
  );
}

/* ── Price chart with entry/exit markers ── */
function PriceChartWithMarkers({
  prices,
  result,
}: {
  prices: PricePoint[];
  result: BacktestResult;
}) {
  const W = 800;
  const H = 260;
  const PAD_L = 50;
  const PAD_R = 20;
  const PAD_T = 20;
  const PAD_B = 30;
  const N = prices.length;
  if (N < 2) return null;

  const allVals = prices.flatMap((p) => [p.high, p.low]);
  const minV = Math.min(...allVals) * 0.98;
  const maxV = Math.max(...allVals) * 1.02;

  const x = (i: number) => PAD_L + (i / (N - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - minV) / (maxV - minV)) * (H - PAD_T - PAD_B);

  // Downsample closes for line chart if too many
  const step = Math.max(1, Math.floor(N / 200));
  const linePoints: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i += step) {
    linePoints.push({ x: x(i), y: y(prices[i].close) });
  }
  const linePath = linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Markers (max 20 to avoid clutter)
  const markers = result.entryMarkers.slice(0, 20);

  return (
    <div className="rounded-lg border border-slate-200 bg-card p-3 dark:border-slate-700" dir="rtl">
      <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
        رسم السعر + نقاط الدخول/الخروج
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="رسم السعر مع نقاط الدخول والخروج"
        style={{ maxWidth: '100%', height: 'auto' }}
      >
        {/* Y-axis gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const v = minV + (maxV - minV) * f;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={yy} x2={W - PAD_R} y2={yy} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="3,3" />
              <text x={PAD_L - 6} y={yy + 3} textAnchor="end" fontSize="9" fill="#64748b">
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Price line */}
        <path d={linePath} fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />

        {/* Markers */}
        {markers.map((m, i) => {
          const mx = x(m.idx);
          const my = y(m.price);
          return (
            <g key={i}>
              {m.type === 'buy' ? (
                <>
                  <circle cx={mx} cy={my} r="5" fill="#10b981" stroke="#fff" strokeWidth="1.5" />
                  <text x={mx} y={my - 8} textAnchor="middle" fontSize="9" fontWeight="700" fill="#10b981">شراء</text>
                </>
              ) : (
                <>
                  <circle cx={mx} cy={my} r="5" fill="#ef4444" stroke="#fff" strokeWidth="1.5" />
                  <text x={mx} y={my + 14} textAnchor="middle" fontSize="9" fontWeight="700" fill="#ef4444">بيع</text>
                </>
              )}
            </g>
          );
        })}

        {/* Legend */}
        <g transform={`translate(${PAD_L + 6}, ${PAD_T + 6})`}>
          <rect x="0" y="0" width="120" height="34" fill="#fff" stroke="#e2e8f0" rx="3" opacity="0.95" />
          <circle cx="12" cy="12" r="4" fill="#10b981" />
          <text x="22" y="15" fontSize="9" fill="#475569">دخول (شراء)</text>
          <circle cx="12" cy="26" r="4" fill="#ef4444" />
          <text x="22" y="29" fontSize="9" fill="#475569">خروج (بيع)</text>
        </g>
      </svg>
    </div>
  );
}

/* ── Trade list table (last 10 trades) ── */
function TradeList({ result }: { result: BacktestResult }) {
  const trades = result.trades.slice(-10).reverse(); // most recent 10
  return (
    <div className="rounded-lg border border-slate-200 bg-card dark:border-slate-700" dir="rtl">
      <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">
        آخر 10 صفقات
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] sm:text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-right">دخول</th>
              <th className="px-2 py-1 text-right">سعر الدخول</th>
              <th className="px-2 py-1 text-right">خروج</th>
              <th className="px-2 py-1 text-right">سعر الخروج</th>
              <th className="px-2 py-1 text-right">العائد</th>
              <th className="px-2 py-1 text-right">R</th>
              <th className="px-2 py-1 text-right">السبب</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-2 py-1 text-muted-foreground ltr:text-left" dir="ltr">{t.entryDate}</td>
                <td className="px-2 py-1 ltr:text-left" dir="ltr">{t.entryPrice.toFixed(2)}</td>
                <td className="px-2 py-1 text-muted-foreground ltr:text-left" dir="ltr">{t.exitDate}</td>
                <td className="px-2 py-1 ltr:text-left" dir="ltr">{t.exitPrice.toFixed(2)}</td>
                <td
                  className={cn(
                    'px-2 py-1 font-bold ltr:text-left',
                    t.pnlPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                  )}
                  dir="ltr"
                >
                  {(t.pnlPct * 100).toFixed(1)}%
                </td>
                <td
                  className={cn(
                    'px-2 py-1 font-bold ltr:text-left',
                    t.rMultiple >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                  )}
                  dir="ltr"
                >
                  {t.rMultiple.toFixed(2)}R
                </td>
                <td className="px-2 py-1 text-muted-foreground">{t.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Small metric card ── */
function MetricCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-muted/30 p-2 text-center dark:border-slate-700" dir="rtl">
      <Icon className="mx-auto mb-1 h-4 w-4 opacity-70" />
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-bold sm:text-base', color)}>{value}</div>
    </div>
  );
}

function emptyResult(): BacktestResult {
  return {
    trades: [],
    winRate: 0,
    avgR: 0,
    totalReturn: 0,
    buyHoldReturn: 0,
    equityCurve: [],
    entryMarkers: [],
    numTrades: 0,
    avgHoldDays: 0,
  };
}

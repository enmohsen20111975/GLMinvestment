'use client';

// TASK 36-C — PortfolioSimulator (محاكي توزيع المحفظة)
// Owner directive: «محتاجين رفع كفائة التعليم... نزود فى المساعدات التعليمية
// من صور ومحاكيات ورسوم بيانية ورسوم توضيحية»
//
// Self-contained Monte Carlo simulator. NO external API calls.
// Uses mulberry32 (deterministic seeded RNG) imported from LearningVisuals
// so output is reproducible: same inputs → same simulation results.
// Teaches: diversification + risk-adjusted returns (Sharpe) + drawdown.

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  PieChart,
  Play,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Shield,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mulberry32 } from './LearningVisuals';

/* ────────────────────────────────────────────────────────────
   Asset class definitions (educational estimates, deterministic)
   Annual expected return μ, annual volatility σ (stdev).
   Values calibrated to long-run historical averages from public
   sources (MSCI, S&P, Bloomberg, CoinMetrics). Educational only.
   ──────────────────────────────────────────────────────────── */
interface AssetClass {
  id: string;
  name: string;
  nameEn: string;
  mu: number; // annual expected return (decimal, e.g. 0.14 = 14%)
  sigma: number; // annual volatility (decimal, e.g. 0.24 = 24%)
  color: string;
  defaultPct: number;
}

const ASSET_CLASSES: AssetClass[] = [
  { id: 'egx', name: 'أسهم مصرية', nameEn: 'EGX', mu: 0.14, sigma: 0.24, color: '#10b981', defaultPct: 40 },
  { id: 'tadawul', name: 'أسهم سعودية', nameEn: 'TADAWUL', mu: 0.10, sigma: 0.18, color: '#059669', defaultPct: 15 },
  { id: 'us', name: 'أسهم أمريكية', nameEn: 'US Stocks', mu: 0.09, sigma: 0.15, color: '#f59e0b', defaultPct: 15 },
  { id: 'crypto', name: 'عملات رقمية', nameEn: 'Crypto', mu: 0.30, sigma: 0.70, color: '#64748b', defaultPct: 10 },
  { id: 'gold', name: 'ذهب', nameEn: 'Gold', mu: 0.06, sigma: 0.12, color: '#d97706', defaultPct: 15 },
  { id: 'cash', name: 'نقدية', nameEn: 'Cash', mu: 0.08, sigma: 0.00, color: '#94a3b8', defaultPct: 5 },
];

const TRADING_DAYS = 252; // 1 year of trading days
const ITERATIONS = 100; // 100 Monte Carlo paths
const RISK_FREE = 0.08; // 8% — EGX certificate deposit rate (risk-free proxy)

/* Box-Muller transform: convert 2 uniforms from mulberry32 → standard normal */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

interface SimResult {
  paths: number[][]; // [iteration][day] = portfolio value
  finalValues: number[]; // sorted ascending
  p5: number;
  p50: number;
  p95: number;
  medianPath: number[];
  p5Path: number[];
  p95Path: number[];
  maxDrawdown: number; // median-path max drawdown as decimal (negative)
  sharpe: number; // risk-adjusted return
  expectedReturn: number; // weighted avg mu
  portfolioSigma: number; // diversified sigma (sqrt of sum of weighted squares)
}

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor((p / 100) * sortedArr.length)));
  return sortedArr[idx];
}

function runSimulation(
  capital: number,
  weights: Record<string, number>,
  seed: number,
): SimResult {
  // Normalize weights
  const totalW = ASSET_CLASSES.reduce((s, a) => s + (weights[a.id] ?? 0), 0);
  const safeTotal = totalW > 0 ? totalW : 1;
  const w: Record<string, number> = {};
  ASSET_CLASSES.forEach((a) => {
    w[a.id] = (weights[a.id] ?? 0) / safeTotal;
  });

  // Daily portfolio drift & vol (sqrt-time scaling)
  const dailyDrift =
    ASSET_CLASSES.reduce((s, a) => s + w[a.id] * a.mu, 0) / TRADING_DAYS;
  // Diversified portfolio vol (assumes uncorrelated — educational approximation)
  const portfolioSigma = Math.sqrt(
    ASSET_CLASSES.reduce((s, a) => s + Math.pow(w[a.id] * a.sigma, 2), 0),
  );
  const dailyVol = portfolioSigma / Math.sqrt(TRADING_DAYS);

  const rng = mulberry32(seed);

  const paths: number[][] = [];
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const path: number[] = [capital];
    let value = capital;
    for (let d = 0; d < TRADING_DAYS; d++) {
      const shock = gaussian(rng);
      // GBM: V_t+1 = V_t * exp((μ - 0.5σ²) + σZ)
      const ret = dailyDrift - 0.5 * dailyVol * dailyVol + dailyVol * shock;
      value = Math.max(0.01, value * Math.exp(ret));
      path.push(value);
    }
    paths.push(path);
  }

  const finalValues = paths.map((p) => p[p.length - 1]).sort((a, b) => a - b);
  const p5 = percentile(finalValues, 5);
  const p50 = percentile(finalValues, 50);
  const p95 = percentile(finalValues, 95);

  // Median path: at each day, take median across iterations
  const medianPath: number[] = [];
  const p5Path: number[] = [];
  const p95Path: number[] = [];
  for (let d = 0; d <= TRADING_DAYS; d++) {
    const dayValues = paths.map((p) => p[d]).sort((a, b) => a - b);
    medianPath.push(percentile(dayValues, 50));
    p5Path.push(percentile(dayValues, 5));
    p95Path.push(percentile(dayValues, 95));
  }

  // Max drawdown on median path
  let peak = medianPath[0];
  let maxDD = 0;
  for (const v of medianPath) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  const expectedReturn = ASSET_CLASSES.reduce((s, a) => s + w[a.id] * a.mu, 0);
  const sharpe = portfolioSigma > 0 ? (expectedReturn - RISK_FREE) / portfolioSigma : 0;

  return {
    paths,
    finalValues,
    p5,
    p50,
    p95,
    medianPath,
    p5Path,
    p95Path,
    maxDrawdown: maxDD,
    sharpe,
    expectedReturn,
    portfolioSigma,
  };
}

/* ============================================================
   PortfolioSimulator component
   ============================================================ */
export function PortfolioSimulator() {
  const [capital, setCapital] = React.useState<number>(100000);
  const [weights, setWeights] = React.useState<Record<string, number>>(
    () => Object.fromEntries(ASSET_CLASSES.map((a) => [a.id, a.defaultPct])),
  );
  const [result, setResult] = React.useState<SimResult | null>(null);
  const [running, setRunning] = React.useState(false);

  const totalPct = ASSET_CLASSES.reduce((s, a) => s + (weights[a.id] ?? 0), 0);
  const isBalanced = Math.abs(totalPct - 100) < 0.01;

  function handleRun() {
    if (!isBalanced || capital <= 0) return;
    setRunning(true);
    // Deterministic seed from inputs (Rule 67 — reproducible, no Math.random)
    const seedStr = `${capital.toFixed(0)}|${ASSET_CLASSES.map((a) => `${a.id}:${weights[a.id] ?? 0}`).join(',')}`;
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const seed = h >>> 0;
    // Defer to next tick so the UI can show "running" state
    setTimeout(() => {
      const r = runSimulation(capital, weights, seed);
      setResult(r);
      setRunning(false);
    }, 50);
  }

  function handleReset() {
    setCapital(100000);
    setWeights(Object.fromEntries(ASSET_CLASSES.map((a) => [a.id, a.defaultPct])));
    setResult(null);
  }

  // Auto-run on mount with defaults
  React.useEffect(() => {
    handleRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="border-emerald-500/20" dir="rtl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <PieChart className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          محاكي توزيع المحفظة — Monte Carlo (100 مسار)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          أدخل رأس المال ونِسب التوزيع، ثم شغّل المحاكاة. بيتم توليد 100 مسار
          عشوائي بناءً على التقلبات التاريخية لكل فئة أصلية، ويظهر العائد المتوقع
          بعد سنة مع نطاق الثقة (5% / 50% / 95%).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inputs */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-muted/30 p-3 dark:border-slate-700" dir="rtl">
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              رأس المال (ج.م)
            </label>
            <Input
              type="number"
              min={1000}
              step={1000}
              value={capital}
              onChange={(e) => setCapital(Math.max(0, Number(e.target.value)))}
              className="text-sm"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              الحد الأدنى المقترح: 10,000 ج.م
            </p>
          </div>
          <div
            className={cn(
              'rounded-lg border p-3 text-center',
              isBalanced
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-amber-500/40 bg-amber-500/10',
            )}
          >
            <div className="text-[10px] font-semibold text-muted-foreground">إجمالي النِسب</div>
            <div
              className={cn(
                'text-2xl font-bold',
                isBalanced
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400',
              )}
            >
              {(totalPct ?? 0).toFixed(0)}%
            </div>
            <div className="mt-1 text-[10px]">
              {isBalanced
                ? '✅ متوازن'
                : `⚠️ ${totalPct > 100 ? 'زيادة' : 'نقص'} ${(Math.abs(totalPct - 100)).toFixed(0)}%`}
            </div>
          </div>
        </div>

        {/* Allocation sliders */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" dir="rtl">
          {ASSET_CLASSES.map((a) => (
            <div key={a.id} className="rounded-md border border-slate-200 bg-card p-2 dark:border-slate-700">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: a.color }} />
                  {a.name}
                </span>
                <span className="text-[11px] font-bold" style={{ color: a.color }}>
                  {weights[a.id] ?? 0}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={weights[a.id] ?? 0}
                onChange={(e) =>
                  setWeights((prev) => ({ ...prev, [a.id]: Number(e.target.value) }))
                }
                className="w-full"
                style={{ accentColor: a.color }}
              />
              <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground" dir="ltr">
                <span>μ {(a.mu * 100).toFixed(0)}%</span>
                <span>σ {(a.sigma * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2" dir="rtl">
          <Button onClick={handleRun} disabled={!isBalanced || capital <= 0 || running} size="sm">
            {running ? (
              <>
                <Activity className="ml-2 h-4 w-4 animate-pulse" />
                جاري المحاكاة...
              </>
            ) : (
              <>
                <Play className="ml-2 h-4 w-4" />
                شغّل المحاكاة (100 مسار)
              </>
            )}
          </Button>
          <Button onClick={handleReset} variant="outline" size="sm">
            <RotateCcw className="ml-2 h-4 w-4" />
            إعادة للوضع الافتراضي
          </Button>
        </div>

        {/* Results */}
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-4"
            dir="rtl"
          >
            {/* Outcome percentiles */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-[10px] font-semibold text-red-700 dark:text-red-300">
                  <TrendingDown className="h-3 w-3" /> سيناريو متشائم (P5)
                </div>
                <div className="text-base font-bold text-red-700 dark:text-red-300 sm:text-lg">
                  {result.p5.toLocaleString('ar-EG', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {(((result.p5 - capital) / capital) * 100).toFixed(1)}%
                </div>
              </div>
              <div className="rounded-lg border border-slate-400/40 bg-slate-500/10 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                  <Activity className="h-3 w-3" /> الوسيط (P50)
                </div>
                <div className="text-base font-bold text-slate-700 dark:text-slate-300 sm:text-lg">
                  {result.p50.toLocaleString('ar-EG', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {(((result.p50 - capital) / capital) * 100).toFixed(1)}%
                </div>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <TrendingUp className="h-3 w-3" /> سيناريو متفائل (P95)
                </div>
                <div className="text-base font-bold text-emerald-700 dark:text-emerald-300 sm:text-lg">
                  {result.p95.toLocaleString('ar-EG', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {(((result.p95 - capital) / capital) * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Equity curve chart */}
            <EquityCurve result={result} capital={capital} />

            {/* Risk metrics */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricCard
                icon={Target}
                label="العائد المتوقع"
                value={`+${(result.expectedReturn * 100).toFixed(1)}%`}
                color="text-emerald-700 dark:text-emerald-400"
              />
              <MetricCard
                icon={Activity}
                label="التقلب السنوي"
                value={`±${(result.portfolioSigma * 100).toFixed(1)}%`}
                color="text-amber-700 dark:text-amber-400"
              />
              <MetricCard
                icon={AlertTriangle}
                label="أقصى خسارة"
                value={`${(result.maxDrawdown * 100).toFixed(1)}%`}
                color="text-red-700 dark:text-red-400"
              />
              <MetricCard
                icon={Shield}
                label="Sharpe Ratio"
                value={(result.sharpe ?? 0).toFixed(2)}
                color="text-slate-700 dark:text-slate-300"
              />
            </div>

            {/* Educational takeaway */}
            <div
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-900 dark:text-emerald-200"
              dir="rtl"
            >
              <div className="mb-1 font-bold">درس المحاكاة:</div>
              لو {result.p50 > capital ? 'الوسيط' : 'المتشائم'} بيدي{' '}
              {(((result.p50 - capital) / capital) * 100).toFixed(0)}% وسطيًا، فهذا
              ليس ضمانة — هذا متوسط 100 مسار. السيناريو المتشائم (P5) يعني أن قد تخسر{' '}
              {(((result.p5 - capital) / capital) * 100).toFixed(0)}% من رأس مالك
              خلال سنة. كل ما زاد تقلب المحفظة (σ)، زادت احتمالية السيناريو السلبي.
              التنويع يخفض σ دون خفض μ كثيرًا → Sharpe أعلى.
            </div>

            <div className="rounded-md border border-amber-500/30 bg-amber-50/60 px-3 py-2 text-[10px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-200" dir="rtl">
              <span className="font-semibold">إخلاء مسؤولية:</span> المحاكاة
              تعليمية بحتة باستخدام تقلبات تاريخية تقديرية — ليست نصيحة استثمارية مرخصة.
              الأداء السابق لا يضمن المستقبلي.
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Equity Curve SVG with confidence band ── */
function EquityCurve({ result, capital }: { result: SimResult; capital: number }) {
  const W = 800;
  const H = 280;
  const PAD_L = 60;
  const PAD_R = 20;
  const PAD_T = 20;
  const PAD_B = 30;
  const N = result.medianPath.length; // 253

  const allValues = [...result.p5Path, ...result.p95Path, ...result.medianPath];
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const yMin = Math.floor(minV * 0.95 / 1000) * 1000;
  const yMax = Math.ceil(maxV * 1.05 / 1000) * 1000;

  const x = (i: number) => PAD_L + (i / (N - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) =>
    PAD_T + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * (H - PAD_T - PAD_B);

  // Build confidence band path
  const upperBand = result.p95Path.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const lowerBand = result.p5Path.slice().reverse().map((v, i) => {
    const idx = N - 1 - i;
    return `L ${x(idx).toFixed(1)} ${y(v).toFixed(1)}`;
  }).join(' ');
  const bandPath = `${upperBand} ${lowerBand} Z`;

  // Median line path
  const medianPathStr = result.medianPath
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');

  // Y-axis ticks
  const yTicks = 5;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTicks);

  return (
    <div className="rounded-lg border border-slate-200 bg-card p-3 dark:border-slate-700" dir="rtl">
      <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
        منحنى حقوق الملكية — الوسيط + نطاق ثقة 90%
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="منحنى حقوق الملكية عبر 252 يوم تداول"
        style={{ maxWidth: '100%', height: 'auto' }}
      >
        <defs>
          <linearGradient id="equityBand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Y-axis gridlines + labels */}
        {ticks.map((t, i) => {
          const yy = y(t);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={yy} x2={W - PAD_R} y2={yy} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="3,3" />
              <text x={PAD_L - 6} y={yy + 3} textAnchor="end" fontSize="9" fill="#64748b">
                {(t / 1000).toFixed(0)}k
              </text>
            </g>
          );
        })}

        {/* X-axis */}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#94a3b8" strokeWidth="1" />
        {[0, 63, 126, 189, 252].map((d, i) => (
          <g key={d}>
            <line x1={x(d)} y1={H - PAD_B} x2={x(d)} y2={H - PAD_B + 4} stroke="#94a3b8" strokeWidth="1" />
            <text x={x(d)} y={H - PAD_B + 16} textAnchor="middle" fontSize="9" fill="#64748b">
              {i === 0 ? 'اليوم 0' : `${d}ي`}
            </text>
          </g>
        ))}

        {/* Confidence band */}
        <path d={bandPath} fill="url(#equityBand)" stroke="none" />

        {/* P5 + P95 boundary lines */}
        <path d={result.p95Path.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} fill="none" stroke="#10b981" strokeWidth="1" strokeDasharray="3,2" opacity="0.6" />
        <path d={result.p5Path.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} fill="none" stroke="#ef4444" strokeWidth="1" strokeDasharray="3,2" opacity="0.6" />

        {/* Median line */}
        <path d={medianPathStr} fill="none" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Capital baseline */}
        <line x1={PAD_L} y1={y(capital)} x2={W - PAD_R} y2={y(capital)} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7" />
        <text x={W - PAD_R} y={y(capital) - 4} textAnchor="end" fontSize="9" fill="#f59e0b" fontWeight="700">رأس المال</text>

        {/* Legend */}
        <g transform={`translate(${PAD_L + 6}, ${PAD_T + 6})`}>
          <rect x="0" y="0" width="160" height="48" fill="#fff" stroke="#e2e8f0" rx="3" opacity="0.95" />
          <line x1="8" y1="12" x2="22" y2="12" stroke="#475569" strokeWidth="2.5" />
          <text x="26" y="15" fontSize="9" fill="#475569">الوسيط (P50)</text>
          <line x1="8" y1="26" x2="22" y2="26" stroke="#10b981" strokeWidth="1" strokeDasharray="3,2" />
          <text x="26" y="29" fontSize="9" fill="#10b981">P95 (متفائل)</text>
          <line x1="8" y1="40" x2="22" y2="40" stroke="#ef4444" strokeWidth="1" strokeDasharray="3,2" />
          <text x="26" y="43" fontSize="9" fill="#ef4444">P5 (متشائم)</text>
        </g>
      </svg>
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

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, TrendingUp, TrendingDown, Activity, AlertTriangle, Copy, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

/**
 * GateAnalysisView — P1-PARALLEL-ENGINES-FIX (2026-10-12)
 * ========================================================
 * Per Rule 20 (Python=Brain) + Rule 67 (CALCULATION-CANONICAL): the 5-gate
 * analysis logic is now served by the canonical Python endpoint
 * `/api/stocks/<ticker>/gate-analysis` (backed by
 * `vps-service/analyzers/gate_analysis_engine.py`). This component was
 * rewritten from importing the TS `analyzeGates` function to fetching the
 * Python proxy.
 *
 * The response shape (GateAnalysisOutput) is identical to what the TS engine
 * produced — callers don't need to change. We just removed the `import`
 * of the TS engine + the inline gate computation.
 *
 * The `cachedInput` is still built locally so the Pine Script "copy" button
 * keeps working — it's a pure display artifact, no analysis logic.
 */

interface GateResult {
  passed: boolean;
  name: string;
  nameAr: string;
  reason: string;
  reasonAr: string;
}

interface GateAnalysisInput {
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  avgVolume20: number;
  rsi: number;
  macdLine: number;
  signalLine: number;
  macdHist: number;
  sma20: number;
  sma50: number;
  sma200: number;
  atr: number;
  support1: number;
  support2: number;
  resistance1: number;
  resistance2: number;
}

interface GateAnalysisOutput {
  signal: string;
  signalAr: string;
  signalColor: string;
  marketStage: string;
  marketStageAr: string;
  trendBull: boolean;
  trendBear: boolean;
  trendRange: boolean;
  gates: GateResult[];
  gatesPassed: number;
  minGates: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  targetPct: number;
  stopPct: number;
  rrRatio: number;
  rsiBuyThreshold: number;
  rsiSellThreshold: number;
  minRrThreshold: number;
  atrPct: number;
  volumeRatio: number;
  stockStrength: number;
  marketProxy: string;
  marketProxyAr: string;
  narrative: string;
  persona: string;
  bbSqueeze?: {
    level: string;
    bbWidthPct: number;
    bbWidthTrend: string;
    squeezeScore: number;
    descriptionAr: string;
  } | null;
  squeezeBonusApplied: boolean;
}

interface GateAnalysisViewProps {
  ticker: string;
  currentPrice?: number;
  stockName?: string;
}

const signalColors: Record<string, string> = {
  BUY_STRONG: 'bg-lime-600', BUY: 'bg-green-600', BUY_CONTRARIAN: 'bg-teal-600',
  ACCUMULATE: 'bg-teal-600', SELL: 'bg-red-600', SELL_STRONG: 'bg-rose-800',
  WAIT: 'bg-amber-600', AVOID: 'bg-gray-600',
};
const signalBanners: Record<string, string> = {
  BUY_STRONG: 'شراء قوي ▲', BUY: 'شراء ▲', BUY_CONTRARIAN: 'شراء عكسي ▲',
  ACCUMULATE: 'تجميع ●', SELL: 'بيع ▼', SELL_STRONG: 'بيع قوي ▼',
  WAIT: 'انتظار ◆', AVOID: 'تجنب ✕',
};
const signalTextColors: Record<string, string> = {
  BUY_STRONG: '#65a30d', BUY: '#16a34a', BUY_CONTRARIAN: '#0d9488', ACCUMULATE: '#2563eb',
  SELL: '#dc2626', SELL_STRONG: '#9f1239', WAIT: '#d97706', AVOID: '#4b5563',
};

function buildPineScript(t: string, r: GateAnalysisOutput, i: GateAnalysisInput) {
  const gates = r.gates.map((g) => `// ${g.nameAr}: ${g.passed ? '✅' : '❌'} ${g.reasonAr}`).join('\n');
  return [
    `// Pine Script — ${t} | ${r.signalAr} | Gates ${r.gatesPassed}/5 (min ${r.minGates})`,
    `// R/R: ${(r.rrRatio ?? 0).toFixed(1)}:1 | ATR%: ${(r.atrPct ?? 0).toFixed(1)}% | ${r.marketStageAr}`,
    '', `close=${i.close} rsi=${i.rsi} atr=0`, `macd=${i.macdLine} sig=${i.signalLine} hist=${i.macdHist}`,
    `sma20=${i.sma20} sma50=${i.sma50} sma200=${i.sma200}`,
    `support1=${i.support1} resistance1=${i.resistance1}`,
    `target=${(r.targetPrice ?? 0).toFixed(2)} (+${(r.targetPct ?? 0).toFixed(1)}%)`,
    `stop=${(r.stopLoss ?? 0).toFixed(2)} (-${(r.stopPct ?? 0).toFixed(1)}%)`,
    `// Persona: ${r.persona === 'gambler' ? 'مضارب' : 'مستثمر'}`, gates,
  ].join('\n');
}

export default function GateAnalysisView({ ticker, currentPrice, stockName }: GateAnalysisViewProps) {
  const [persona, setPersona] = useState<'gambler' | 'investor'>('gambler');
  const [result, setResult] = useState<GateAnalysisOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cachedInput, setCachedInput] = useState<GateAnalysisInput | null>(null);

  const fetchAndAnalyze = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      // 1. Fetch the unified data to assemble the input shape (kept local —
      //    the Python endpoint receives the same shape we used to compute
      //    the gates from).
      const [uRes, vRes] = await Promise.allSettled([
        fetch(`/api/stocks/${ticker}/unified`),
        fetch(`/api/python/v2/cached-analysis/${ticker}`),
      ]);
      const unified = uRes.status === 'fulfilled' && uRes.value.ok
        ? (await uRes.value.json() as any)
        : null;
      const v2 = vRes.status === 'fulfilled' && vRes.value.ok ? (await vRes.value.json() as any) : null;

      let pd: any = null;
      if (unified?.success) {
        const tech = unified.technical ?? {};
        const stk = unified.stock ?? {};
        const pred = unified.prediction ?? null;
        pd = {
          stock: {
            close: stk.current_price ?? null,
            open: stk.previous_close ?? null,
            high: stk.current_price != null ? stk.current_price * 1.01 : null,
            low: stk.current_price != null ? stk.current_price * 0.99 : null,
            volume: stk.volume ?? null,
            avg_volume: tech.avg_volume ?? null,
          },
          indicators: {
            rsi: { value: tech.rsi ?? null },
            atr: { value: tech.atr ?? null },
            sma_20: null,
            sma_50: tech.ma_50 ?? null,
            sma_200: tech.ma_200 ?? null,
            macd: { macd_line: 0, signal_line: 0, histogram: 0 },
          },
          price_levels: {
            support_1: tech.support ?? null,
            resistance_1: tech.resistance ?? null,
            support_2: null,
            resistance_2: null,
          },
          volume_analysis: { avg_volume_20: tech.avg_volume ?? null },
          prediction: pred,
        };
      }

      if (!pd && !v2) { setError(true); setLoading(false); return; }

      const ind = pd?.indicators || {}, pl = pd?.price_levels || {}, vol = pd?.volume_analysis || {};
      const st = pd?.stock || v2?.stock || {};
      const price = currentPrice || st.close || st.price || v2?.close || 100;

      const input: GateAnalysisInput = {
        close: price, open: st.open || price, high: st.high || price * 1.01, low: st.low || price * 0.99,
        rsi: ind.rsi?.value || 50, macdLine: ind.macd?.macd_line || 0, signalLine: ind.macd?.signal_line || 0,
        macdHist: ind.macd?.histogram || 0, atr: ind.atr?.value || price * 0.02,
        support1: pl.support_1 || price * 0.95, support2: pl.support_2 || price * 0.90,
        resistance1: pl.resistance_1 || price * 1.05, resistance2: pl.resistance_2 || price * 1.10,
        sma20: ind.sma_20 || price, sma50: ind.sma_50 || price, sma200: ind.sma_200 || price * 1.05,
        volume: st.volume || v2?.volume || 50000, avgVolume20: vol?.avg_volume_20 || st.avg_volume || 50000,
      };
      setCachedInput(input);

      // 2. POST the input to the Python canonical endpoint — pure proxy
      //    pattern (no inline gate computation in the client).
      const upstream = await fetch(
        `/api/stocks/${encodeURIComponent(ticker)}/gate-analysis?persona=${persona}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      if (!upstream.ok) {
        setError(true);
        setLoading(false);
        return;
      }
      const body = await upstream.json() as any;
      if (!body?.success || !body?.result) {
        setError(true);
        setLoading(false);
        return;
      }
      setResult(body.result as GateAnalysisOutput);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [ticker, currentPrice, persona]);

  useEffect(() => { fetchAndAnalyze(); }, [fetchAndAnalyze]);

  const handleCopy = async () => {
    if (!result || !cachedInput) return;
    await navigator.clipboard.writeText(buildPineScript(ticker, result, cachedInput));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return (
    <Card className="py-4 gap-4">
      <CardHeader className="pb-0"><div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Skeleton className="size-5 rounded" /><Skeleton className="h-5 w-52" /></div>
        <Skeleton className="h-6 w-24" />
      </div></CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-10 w-full rounded" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        <Skeleton className="h-8 w-full rounded" />
      </CardContent>
    </Card>
  );

  if (error || !result) return (
    <Card className="py-6"><CardContent className="flex flex-col items-center gap-3 py-8 text-center">
      <AlertTriangle className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">التحليل غير متاح حالياً</p>
      <Button variant="outline" size="sm" onClick={fetchAndAnalyze}>إعادة المحاولة</Button>
    </CardContent></Card>
  );

  const r = result;
  const gc = 'text-green-600 dark:text-green-400';
  const rc = 'text-red-600 dark:text-red-400';
  const trendClr = r.trendBull ? gc : r.trendBear ? rc : 'text-amber-600 dark:text-amber-400';
  const gatesClr = r.gatesPassed >= r.minGates ? gc : rc;
  const atrClr = r.atrPct > 5 ? rc : r.atrPct < 2 ? gc : '';
  const rrClr = r.rrRatio >= r.minRrThreshold ? gc : rc;
  const BannerIcon = r.signal.includes('SELL') || r.signal === 'AVOID' ? TrendingDown : r.signal === 'WAIT' ? Activity : TrendingUp;

  return (
    <Card className="py-0 gap-0 overflow-hidden" dir="rtl">
      {/* Header */}
      <CardHeader className="px-4 py-3 sm:px-6 sm:py-4 gap-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            <CardTitle className="text-base sm:text-lg">دليل الاستثمار — تحليل البوابات</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{persona === 'gambler' ? 'مضارب' : 'مستثمر'}</span>
            <button type="button" role="switch" aria-checked={persona === 'investor'}
              onClick={() => setPersona(p => p === 'gambler' ? 'investor' : 'gambler')}
              className="peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              data-state={persona === 'investor' ? 'checked' : 'unchecked'}>
              <span className="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(-100%+2px)] data-[state=unchecked]:translate-x-0"
                data-state={persona === 'investor' ? 'checked' : 'unchecked'} />
            </button>
          </div>
        </div>
        {stockName && <p className="text-xs text-muted-foreground">{stockName} ({ticker})</p>}
      </CardHeader>

      {/* Signal Banner */}
      <div className={`${signalColors[r.signal] || 'bg-gray-600'} px-4 py-3 sm:px-6 sm:py-4 flex items-center gap-2`}>
        <BannerIcon className="size-5 text-white shrink-0" />
        <span className="text-lg sm:text-xl font-bold text-white">{signalBanners[r.signal] || r.signalAr}</span>
      </div>

      <CardContent className="px-4 py-4 sm:px-6 sm:py-6 space-y-4">
        {/* Info Table */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <IR label="الإشارة" value={r.signalAr} valueClass="font-semibold" signal={r.signal} />
          <IR label="السعر" value={(r.entryPrice ?? 0).toFixed(2)} />
          <IR label="الهدف" value={`${(r.targetPrice ?? 0).toFixed(2)} (+${(r.targetPct ?? 0).toFixed(1)}%)`} valueClass={`${gc} font-medium`} />
          <IR label="الوقف" value={`${(r.stopLoss ?? 0).toFixed(2)} (-${(r.stopPct ?? 0).toFixed(1)}%)`} valueClass={`${rc} font-medium`} />
          <IR label="R/R" value={`${(r.rrRatio ?? 0).toFixed(1)}:1`} valueClass={`${rrClr} font-medium`} />
          <IR label="RSI" value={(cachedInput?.rsi ?? 0).toFixed(1) || '—'} valueExtra={` (${r.rsiBuyThreshold}–${r.rsiSellThreshold})`} />
          <IR label="الاتجاه" value={r.marketStageAr} valueClass={`${trendClr} font-medium`} />
          <IR label="البوابات" value={`${r.gatesPassed}/5`} valueExtra={` (min: ${r.minGates})`} valueClass={`${gatesClr} font-medium`} />
          <IR label="ATR%" value={`${(r.atrPct ?? 0).toFixed(1)}%`} valueClass={`${atrClr} font-medium`} />
          <IR label="قوة السهم" value={`${r.stockStrength}/100 — ${r.marketProxyAr}`} />
          <IR label="الوصف" value={r.narrative} valueClass="text-xs text-muted-foreground leading-relaxed" full />
        </div>

        <Separator />

        {/* Gates Visual */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">البوابات الخمس</p>
          <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
            {r.gates.map((g, i) => (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className={`cursor-default text-xs gap-1 ${g.passed ? 'border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400' : 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400'}`}>
                    <span className="text-sm">{g.passed ? '🟢' : '🔴'}</span>{g.nameAr}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-60 text-center">
                  <p className="font-medium">{g.nameAr}</p>
                  <p className="text-xs opacity-80 mt-1">{g.reasonAr}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <Separator />

        {/* Footer */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[10px] text-muted-foreground leading-relaxed max-w-[70%]">الحساب من المحرك الموحد المعتمد</p>
          <Button variant="ghost" size="sm" className="text-xs gap-1.5" onClick={handleCopy}>
            {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
            نسخ TradingView
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IR({ label, value, valueClass = '', valueExtra, full, signal }: {
  label: string; value: string; valueClass?: string; valueExtra?: React.ReactNode; full?: boolean; signal?: string;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <span className="text-muted-foreground text-xs">{label}: </span>
      <span className={valueClass} style={signal ? { color: signalTextColors[signal] } : undefined}>{value}</span>
      {valueExtra}
    </div>
  );
}

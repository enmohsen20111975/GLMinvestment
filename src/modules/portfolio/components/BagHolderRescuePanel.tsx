'use client';

/* ============================================================
   ROBO-ADVISOR-P4: BagHolderRescuePanel — محرك إنقاذ الأسهم المزنوقة
   ============================================================
   - العميل يدخل السهم + سعر الشراء + الكمية
   - النظام بيحلل: القمة التاريخية + الأساسيات + التوقع
   - بيطلع: اصبر / اعمل متوسط / اقطع خسارة + سبب بأسلوب بشري
   ============================================================ */

// P39-PHASE-4: Dynamic Rescue & Debt Engine — persona-scaled rescue advice + debt paydown
// TASK 31-C: Deep rescue analysis — Loss Summary + 5 tabs (Technical / Fundamentals /
//   Scenarios / Rescue Plan / Decision Journal) + sparkline + breakeven calc + journal save.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import {
  LifeBuoy,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Activity,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Wallet,
  Target,
  Brain,
  Calculator,
  FileText,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { StockSearchDropdown } from '@/modules/portfolio/components/StockSearchDropdown';
import {
  computePersonaRescueAdvice,
  computeDebtPaydownRatio,
  getPersonaVector,
  personaLabelAr,
} from '@/lib/persona-dynamic';
import { DynamicRiskProfilerModal } from '@/components/persona/DynamicRiskProfilerModal';

interface RescueResult {
  success: boolean;
  ticker: string;
  buy_price: number;
  current_price: number;
  quantity: number;
  invested_egp: number;
  market_value_egp: number;
  loss_pct: number;
  loss_egp: number;
  recovery_needed_pct: number;
  all_time_high: number;
  all_time_low: number;
  buy_zone: string;
  buy_zone_ar: string;
  peak_ratio: number;
  is_profitable: boolean | null;
  fundamentals_note: string;
  recommendation: 'HOLD' | 'AVERAGE_DOWN' | 'CUT_LOSS';
  recommendation_ar: string;
  urgency: 'low' | 'medium' | 'high';
  reasoning: string;
}

const REC_COLORS: Record<string, string> = {
  CUT_LOSS: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-400',
  AVERAGE_DOWN: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-400',
  HOLD: 'bg-green-100 text-emerald-500 dark:bg-green-900/40 dark:text-green-300 border-green-400',
};

const URGENCY_LABEL: Record<string, string> = {
  high: '🔴 عاجل',
  medium: '🟡 متوسط',
  low: '🟢 هادي',
};

const AR_NUM = new Intl.NumberFormat('ar-EG');

interface BagHolderRescuePanelProps {
  /** Pre-fill ticker (e.g. from a clicked losing position) */
  ticker?: string;
  /** Pre-fill buy price */
  buyPrice?: number;
  /** Pre-fill quantity */
  quantity?: number;
  /** Auto-trigger analysis when props are provided */
  autoAnalyze?: boolean;
}

export function BagHolderRescuePanel({
  ticker: tickerProp,
  buyPrice: buyPriceProp,
  quantity: quantityProp,
  autoAnalyze: autoAnalyzeProp = false,
}: BagHolderRescuePanelProps) {
  const [ticker, setTicker] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [buyDate, setBuyDate] = useState(''); // TASK 31-C: added for deep analysis
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RescueResult | null>(null);
  // P37-PHASE-2B-4A Part B: apply-rescue flow (AVERAGE_DOWN only)
  const [applying, setApplying] = useState(false);
  const [extraQty, setExtraQty] = useState('');
  const updatePortfolioItem = useAppStore((s) => s.updatePortfolioItem);

  // P39-PHASE-4: persona-scaled rescue + debt state
  const persona = useAppStore((s) => s.persona);
  const riskProfilerCompleted = useAppStore((s) => s.riskProfilerCompleted);
    const [holdingDays, setHoldingDays] = useState('30');
  const [profilerOpen, setProfilerOpen] = useState(false);
  const [profitEGP, setProfitEGP] = useState('');
  const [portfolioNetWorth, setPortfolioNetWorth] = useState(0);
  // Guard so the auto-open profiler effect fires at most once per result.
  const lastAutoTriggeredResultRef = useRef<RescueResult | null>(null);

  // ── Task 7: Auto-fill from props when a losing position is clicked ──
  useEffect(() => {
    if (tickerProp) {
      setTicker(tickerProp);
      setBuyPrice(buyPriceProp ? String(buyPriceProp) : '');
      setQuantity(quantityProp ? String(quantityProp) : '');
      if (autoAnalyzeProp && buyPriceProp && buyPriceProp > 0) {
        // Auto-trigger analysis after state settles
        setTimeout(() => triggerAnalyze(tickerProp, buyPriceProp, quantityProp || 0), 100);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerProp, buyPriceProp, quantityProp, autoAnalyzeProp]);

  const triggerAnalyze = async (tOverride?: string, bpOverride?: number, qtyOverride?: number) => {
    const t = (tOverride || ticker).trim().toUpperCase();
    const bp = bpOverride ?? Number(buyPrice);
    const qty = qtyOverride ?? (Number(quantity) || 0);
    if (!t || bp <= 0) {
      toast.error('أدخل كود السهم وسعر الشراء');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/portfolio/bag-holder-rescue?ticker=${t}&buy_price=${bp}&quantity=${qty}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success) {
        // ── P31 TASK 3: Normalize response shape ──
        // The Flask endpoint returns flat fields (recommendation, loss_pct, ...).
        // The FastAPI endpoint returns them nested under `data`. Merge so the
        // frontend works regardless of which backend is live.
        const flat = data.data && typeof data.data === 'object'
          ? { ...data, ...data.data }
          : data;
        setResult(flat as RescueResult);
      } else {
        toast.error(data.error || 'فشل التحليل');
      }
    } catch {
      toast.error('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = () => triggerAnalyze();

  // ── P37-PHASE-2B-4A Part B: Apply AVERAGE_DOWN to the portfolio ──
  // The user enters how many extra shares to buy at the current price; we
  // compute the weighted-average new buy price + new quantity and patch the
  // matching holding. Asset lookup is via /api/finance/calculate-values
  // (same source EnhancedPortfolioView uses) so the IDs line up with the
  // /api/finance/assets/:id PUT endpoint (which accepts `quantity` and
  // `avg_buy_price` — see src/app/api/finance/assets/[id]/route.ts).
  //
  // We TRY the store's updatePortfolioItem first (per task B2/B3), but it
  // proxies to Python's /api/live-monitor which only implements GET — so we
  // fall back to the SQLite /api/finance/assets/:id PUT endpoint that the
  // rest of the portfolio editor already uses. This keeps the feature
  // functional regardless of which backend is live.
  const handleApplyRescue = async () => {
    if (!result) return;
    const extra = parseFloat(extraQty);
    if (!Number.isFinite(extra) || extra <= 0) {
      toast.error('أدخل كمية إضافية صحيحة');
      return;
    }
    const oldQty = Number(result.quantity) || 0;
    const oldBuy = Number(result.buy_price) || 0;
    const currentPrice = Number(result.current_price) || 0;
    if (oldQty <= 0 || oldBuy <= 0 || currentPrice <= 0) {
      toast.error('بيانات السهم غير مكتملة');
      return;
    }
    const newQty = oldQty + extra;
    const newAvg = (oldQty * oldBuy + extra * currentPrice) / newQty;
    setApplying(true);
    try {
      // Find the user's holding for this ticker via the same calc-values
      // endpoint EnhancedPortfolioView uses to render the assets tab.
      const calcRes = await fetch('/api/finance/calculate-values', { cache: 'no-store' });
      const calcData = await calcRes.json();
      const items = (calcData.items || calcData.assets || []) as Array<{
        id: number;
        type?: string;
        stock_ticker?: string;
      }>;
      const match = items.find(
        (a) =>
          String(a.type || '').toLowerCase() === 'stock' &&
          String(a.stock_ticker || '').toUpperCase() === result.ticker.toUpperCase()
      );
      if (!match) {
        toast.error('لم يتم العثور على السهم في محفظتك');
        return;
      }
      // Field names `quantity` + `avg_buy_price` match the SQLite assets table
      // schema and the allowedFields list in /api/finance/assets/[id]/route.ts.
      let out = await updatePortfolioItem(match.id, {
        quantity: newQty,
        avg_buy_price: newAvg,
      });
      // Fallback: store helper proxies to Python's /api/live-monitor (GET only)
      // — if it fails, retry directly against the SQLite endpoint.
      if (!out.success) {
        const res2 = await fetch(`/api/finance/assets/${match.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: newQty, avg_buy_price: newAvg }),
        });
        const data2 = await res2.json().catch(() => ({}));
        out = { success: !!data2.success, error: data2.error || null };
      }
      if (out.success) {
        toast.success('تم تحديث المحفظة: الكمية والسعر الجديد');
        setExtraQty('');
      } else {
        toast.error(out.error || 'فشل التحديث');
      }
    } catch {
      toast.error('فشل التحديث');
    } finally {
      setApplying(false);
    }
  };

  // ── TASK 31-C: Save the rescue decision to the trading journal ──
  // Pre-fills a journal entry from the rescue recommendation, lets the user
  // tweak the decision + add a custom reason, then POSTs to /api/trading-journal.
  const handleSaveJournal = async () => {
    if (!result) return;
    if (!journalDecision) {
      toast.error('اختر قرارك أولاً (اصبر / متوسط / اقطع)');
      return;
    }
    setJournalSaving(true);
    try {
      const todayISO = new Date().toISOString().split('T')[0];
      const body = {
        stock_symbol: result.ticker,
        stock_name: result.name || result.ticker,
        trade_type: journalDecision === 'CUT_LOSS' ? 'SELL' : 'BUY',
        quantity: Number(result.quantity) || 0,
        entry_price: Number(result.buy_price) || 0,
        exit_price: journalDecision === 'CUT_LOSS' ? Number(result.current_price) || 0 : null,
        entry_date: result.buy_date || todayISO,
        exit_date: journalDecision === 'CUT_LOSS' ? todayISO : null,
        strategy: `bagholder-rescue (${journalDecision})`,
        notes: journalReason || result.reasoning || result.journal_template || '',
      };
      const res = await fetch('/api/trading-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.trade || data.success !== false)) {
        setJournalSaved(true);
        toast.success('تم حفظ قرارك في يومية التداول');
      } else {
        toast.error(data.error || 'فشل حفظ اليومية (قد تكون غير مفعّلة)');
      }
    } catch {
      toast.error('فشل الاتصال بيومية التداول');
    } finally {
      setJournalSaving(false);
    }
  };

  // ── P39-PHASE-4: Fetch portfolio net worth once when a result loads ──
  // Used by the AVERAGE_DOWN ceiling warning. We read `net_worth_egp`
  // (debts-aware total, added in P34) and fall back to `total_current_value`
  // for older backends that don't expose net worth yet.
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    fetch('/api/finance/calculate-values', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const nw = Number(d.net_worth_egp ?? d.total_current_value ?? 0);
        if (Number.isFinite(nw)) setPortfolioNetWorth(nw);
      })
      .catch(() => { /* silent — ceiling warning simply stays hidden */ });
    return () => {
      cancelled = true;
    };
  }, [result]);

  // ── P39-PHASE-4: Auto-open the risk profiler on first result ──
  // Only fires if the user hasn't completed the questionnaire yet, and at
  // most once per `result` object (guarded by a ref so a re-render of the
  // same result won't re-trigger).
  useEffect(() => {
    if (!result) return;
    if (lastAutoTriggeredResultRef.current === result) return;
    lastAutoTriggeredResultRef.current = result;
    if (riskProfilerCompleted) return;
    const t = setTimeout(() => setProfilerOpen(true), 500);
    return () => clearTimeout(t);
  }, [result, riskProfilerCompleted]);

  // ── P39-PHASE-4: Persona-scaled rescue advice ──
  // Recomputes whenever the result, the holding-days input, or the active
  // persona changes. `loss_pct` is negative for a loss — the math library
  // handles the sign internally.
  const personaAdvice = useMemo(() => {
    if (!result) return null;
    const days = Math.max(0, Number(holdingDays) || 0);
    return computePersonaRescueAdvice(result.loss_pct, days, persona);
  }, [result, holdingDays, persona]);

  // ── P39-PHASE-4: Persona-scaled debt paydown advice ──
  const debtAdvice = useMemo(() => {
    const profit = Math.max(0, Number(profitEGP) || 0);
    return computeDebtPaydownRatio(profit, persona);
  }, [profitEGP, persona]);

  // ── P39-PHASE-4: AVERAGE_DOWN ceiling math ──
  // `averageDownMaxPct` is a percentage of portfolio net worth; if the extra
  // cost exceeds it, we warn the user and offer a clickable suggested qty.
  const personaAverageMax = getPersonaVector(persona).rescueBehavior.averageDownMaxPct;
  const extraQtyNum = parseFloat(extraQty) || 0;
  const currentPriceForCeiling = result?.current_price || 0;
  const extraCostEGP = extraQtyNum * currentPriceForCeiling;
  const ceilingEGP = portfolioNetWorth * personaAverageMax / 100;
  const overflowsCeiling =
    portfolioNetWorth > 0 &&
    currentPriceForCeiling > 0 &&
    extraQtyNum > 0 &&
    extraCostEGP > ceilingEGP;
  const suggestedQty =
    portfolioNetWorth > 0 && currentPriceForCeiling > 0
      ? Math.floor(portfolioNetWorth * personaAverageMax / 100 / currentPriceForCeiling)
      : 0;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-teal-500" />
            <h3 className="font-bold text-base">محرك إنقاذ الأسهم المزنوقة</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            عندك سهم لبسته بخسارة؟ ادخله والنظام هيقولك: اصبر، اعمل متوسط، ولا اقطع الخسارة — مع السبب.
          </p>

          {/* Input form — TASK 31-C: added buy_date input → 5 cols */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {/* P31 TASK 3: StockSearchDropdown replaces the plain ticker Input */}
            <div className="sm:col-span-1">
              <StockSearchDropdown
                value={ticker}
                onSelect={(tk, _name, currentPrice) => {
                  setTicker(tk);
                  // Auto-fill buy price with the live price as a sensible default
                  if (currentPrice > 0 && !buyPrice) {
                    setBuyPrice(String(currentPrice));
                  }
                }}
              />
            </div>
            <Input
              type="number"
              placeholder="سعر الشراء"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              dir="ltr"
            />
            <Input
              type="number"
              placeholder="الكمية"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              dir="ltr"
            />
            <Input
              type="date"
              placeholder="تاريخ الشراء"
              value={buyDate}
              onChange={(e) => setBuyDate(e.target.value)}
              dir="ltr"
              className="text-xs"
            />
            <Button onClick={handleAnalyze} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LifeBuoy className="h-4 w-4" />}
              حلّل
            </Button>
          </div>

          {/* Result */}
          {result && (
            <div className="space-y-3 animate-in fade-in duration-300">
              {/* Header: recommendation + urgency */}
              <div className="flex items-center justify-between flex-wrap gap-2 p-3 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">التوقع:</span>
                  <Badge className={cn('border', REC_COLORS[result.recommendation])}>
                    {result.recommendation_ar}
                  </Badge>
                </div>
                <Badge variant="outline">{URGENCY_LABEL[result.urgency]}</Badge>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="p-2 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground">سعر الشراء</div>
                  <div className="font-bold">{(result.buy_price ?? 0).toFixed(2)}</div>
                </div>
                <div className="p-2 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground">السعر الحالي</div>
                  <div className="font-bold">{(result.current_price ?? 0).toFixed(2)}</div>
                </div>
                <div className="p-2 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground">الخسارة/الربح</div>
                  <div className={cn('font-bold flex items-center gap-1', result.loss_pct < 0 ? 'text-red-600' : 'text-emerald-500')}>
                    {result.loss_pct < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                    {result.loss_pct >= 0 ? '+' : ''}{(result.loss_pct ?? 0).toFixed(1)}%
                  </div>
                </div>
                <div className="p-2 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground">الخسارة (ج.م)</div>
                  <div className={cn('font-bold', result.loss_egp < 0 ? 'text-red-600' : 'text-emerald-500')}>
                    {result.loss_egp >= 0 ? '+' : ''}{AR_NUM.format(Math.round(result.loss_egp))}
                  </div>
                </div>
              </div>

              {/* Buy zone + historical */}
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <Badge variant="outline" className="border-teal-300 text-teal-700 dark:text-teal-300">
                  📍 {result.buy_zone_ar}
                </Badge>
                {result.all_time_high > 0 && (
                  <span className="text-xs text-muted-foreground">
                    القمة التاريخية: {(result.all_time_high ?? 0).toFixed(2)} | القاع: {(result.all_time_low ?? 0).toFixed(2)}
                  </span>
                )}
                {result.recovery_needed_pct > 0 && (
                  <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                    يلزم +{result.recovery_needed_pct}% للتعادل
                  </Badge>
                )}
              </div>

              {/* Fundamentals */}
              {result.is_profitable !== null && (
                <div className="flex items-center gap-2 text-sm">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">الشركة:</span>
                  <Badge variant="outline" className={result.is_profitable ? 'border-green-300 text-emerald-500' : 'border-red-300 text-red-700'}>
                    {result.is_profitable ? '✅ ربحانية' : '❌ خاسرة'}
                  </Badge>
                  {result.fundamentals_note && (
                    <span className="text-xs text-muted-foreground">{result.fundamentals_note}</span>
                  )}
                </div>
              )}

              {/* Reasoning — التقرير المفصل */}
              <div className={cn(
                'p-3 rounded-lg border text-sm leading-relaxed',
                result.recommendation === 'CUT_LOSS' ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800' :
                result.recommendation === 'AVERAGE_DOWN' ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' :
                'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
              )}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                  <p className="text-foreground/90">{result.reasoning}</p>
                </div>
              </div>

              {/* TASK 31-C: Loss Summary card with sparkline (live mini-chart) */}
              <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Activity className="h-4 w-4 text-amber-600" />
                  <span className="font-semibold">ملخص الخسارة</span>
                  {result.name && (
                    <Badge variant="outline" className="border-border/60 text-muted-foreground ml-auto">
                      {result.ticker} — {result.name}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2 rounded-md bg-background/60">
                    <div className="text-muted-foreground">المستثمر</div>
                    <div className="font-bold">{AR_NUM.format(Math.round(result.invested_egp))} ج.م</div>
                  </div>
                  <div className="p-2 rounded-md bg-background/60">
                    <div className="text-muted-foreground">القيمة الحالية</div>
                    <div className="font-bold">{AR_NUM.format(Math.round(result.market_value_egp))} ج.م</div>
                  </div>
                  <div className="p-2 rounded-md bg-background/60">
                    <div className="text-muted-foreground">الخسارة</div>
                    <div className={cn('font-bold text-base', result.loss_egp < 0 ? 'text-red-600' : 'text-emerald-500')}>
                      {result.loss_egp >= 0 ? '+' : ''}{AR_NUM.format(Math.round(result.loss_egp))} ج.م
                    </div>
                  </div>
                  <div className="p-2 rounded-md bg-background/60">
                    <div className="text-muted-foreground">يلزم للتعادل</div>
                    <div className="font-bold text-amber-600">
                      {result.recovery_needed_pct > 0 ? `+${(result.recovery_needed_pct ?? 0).toFixed(1)}%` : '—'}
                    </div>
                  </div>
                </div>
                {result.sparkline_data && result.sparkline_data.length > 1 && (
                  <div className="pt-1">
                    <div className="text-[10px] text-muted-foreground mb-1">آخر {result.sparkline_data.length} جلسة</div>
                    <MiniSparkline
                      ticker={result.ticker}
                      data={result.sparkline_data}
                      days={30}
                      height={48}
                      curve="smooth"
                      showArea
                    />
                  </div>
                )}
              </div>

              {/* TASK 31-C: Deep Analysis Tabs (5 panels) */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid grid-cols-5 w-full h-auto text-[11px] sm:text-xs">
                  <TabsTrigger value="technical" className="px-1 sm:px-2 py-1.5">
                    <span className="hidden sm:inline">📊 الفني</span>
                    <span className="sm:hidden">📊</span>
                  </TabsTrigger>
                  <TabsTrigger value="fundamentals" className="px-1 sm:px-2 py-1.5">
                    <span className="hidden sm:inline">💰 الأساسيات</span>
                    <span className="sm:hidden">💰</span>
                  </TabsTrigger>
                  <TabsTrigger value="scenarios" className="px-1 sm:px-2 py-1.5">
                    <span className="hidden sm:inline">📈 السيناريوهات</span>
                    <span className="sm:hidden">📈</span>
                  </TabsTrigger>
                  <TabsTrigger value="plan" className="px-1 sm:px-2 py-1.5">
                    <span className="hidden sm:inline">🎯 الخطة</span>
                    <span className="sm:hidden">🎯</span>
                  </TabsTrigger>
                  <TabsTrigger value="journal" className="px-1 sm:px-2 py-1.5">
                    <span className="hidden sm:inline">📝 اليومية</span>
                    <span className="sm:hidden">📝</span>
                  </TabsTrigger>
                </TabsList>

                {/* Tab A: Technical */}
                <TabsContent value="technical" className="space-y-2 mt-2">
                  {result.technical ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">RSI(14)</div>
                          <div className={cn('font-bold', (result.technical.rsi < 30 || result.technical.rsi > 70) ? 'text-amber-600' : '')}>
                            {(result.technical.rsi ?? 0).toFixed(1)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{result.technical.rsi_state}</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">MA50</div>
                          <div className={cn('font-bold', result.technical.above_ma_50 ? 'text-emerald-500' : 'text-red-600')}>
                            {(result.technical.ma_50 ?? 0).toFixed(2)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{result.technical.above_ma_50 ? 'فوق' : 'تحت'}</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">MA200</div>
                          <div className={cn('font-bold', result.technical.above_ma_200 ? 'text-emerald-500' : 'text-red-600')}>
                            {(result.technical.ma_200 ?? 0).toFixed(2)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{result.technical.above_ma_200 ? 'فوق' : 'تحت'}</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">من القمة 52 أسبوع</div>
                          <div className={cn('font-bold', (result.dist_from_high_pct ?? 0) < -20 ? 'text-red-600' : '')}>
                            {(result.dist_from_high_pct ?? 0).toFixed(1)}%
                          </div>
                          <div className="text-[10px] text-muted-foreground">القمة: {(result.all_time_high ?? 0).toFixed(2)}</div>
                        </div>
                      </div>
                      <div className="p-3 rounded-md bg-muted/40 border border-border">
                        <div className="flex items-center gap-2 mb-1">
                          <Target className="h-4 w-4 text-primary" />
                          <span className="text-sm font-semibold">{result.technical.stage_ar}</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{result.technical.stage_hint}</p>
                      </div>
                      {(result.technical.support.length > 0 || result.technical.resistance.length > 0) && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                            <div className="text-muted-foreground mb-1">الدعوم القريبة</div>
                            <div className="flex flex-wrap gap-1">
                              {result.technical.support.length > 0
                                ? result.technical.support.map((s, i) => (
                                    <Badge key={i} variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300 text-[10px]">
                                      {(s ?? 0).toFixed(2)}
                                    </Badge>
                                  ))
                                : <span className="text-muted-foreground">—</span>}
                            </div>
                          </div>
                          <div className="p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                            <div className="text-muted-foreground mb-1">المقاومات القريبة</div>
                            <div className="flex flex-wrap gap-1">
                              {result.technical.resistance.length > 0
                                ? result.technical.resistance.map((r, i) => (
                                    <Badge key={i} variant="outline" className="border-red-300 text-red-700 dark:text-red-300 text-[10px]">
                                      {(r ?? 0).toFixed(2)}
                                    </Badge>
                                  ))
                                : <span className="text-muted-foreground">—</span>}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground p-3">
                      التحليل الفني العميق متاح عبر الـ API الجديد. لو مش ظاهر، استخدم زر "حلّل" تاني.
                    </p>
                  )}
                </TabsContent>

                {/* Tab B: Fundamentals */}
                <TabsContent value="fundamentals" className="space-y-2 mt-2">
                  {result.fundamentals ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">P/E</div>
                          <div className="font-bold">{(result.fundamentals.pe_ratio ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">P/B</div>
                          <div className="font-bold">{(result.fundamentals.pb_ratio ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">EPS</div>
                          <div className="font-bold">{(result.fundamentals.eps ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">ROE</div>
                          <div className="font-bold">{(result.fundamentals.roe ?? 0).toFixed(1)}%</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">هامش الربح</div>
                          <div className="font-bold">{(result.fundamentals.profit_margin_pct ?? 0).toFixed(1)}%</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/40">
                          <div className="text-muted-foreground">قطاع</div>
                          <div className="font-bold text-[11px] truncate" title={result.fundamentals.sector}>
                            {result.fundamentals.sector || '—'}
                          </div>
                        </div>
                      </div>
                      <div className="p-3 rounded-md bg-muted/40 border border-border flex items-center gap-2 text-sm">
                        <Brain className="h-4 w-4 text-primary flex-shrink-0" />
                        <span className="text-muted-foreground">تقييم الأساسيات:</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'ml-auto',
                            result.fundamentals.strength_verdict === 'قوية'
                              ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                              : result.fundamentals.strength_verdict === 'متوسطة'
                                ? 'border-amber-300 text-amber-700 dark:text-amber-300'
                                : 'border-red-300 text-red-700 dark:text-red-300',
                          )}
                        >
                          {result.fundamentals.strength_verdict}
                        </Badge>
                      </div>
                      {result.fundamentals.sharia_compliant !== null && (
                        <div className="p-2 rounded-md bg-muted/40 border border-border flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">التوافق الشرعي:</span>
                          <Badge
                            variant="outline"
                            className={
                              result.fundamentals.sharia_compliant
                                ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                                : 'border-red-300 text-red-700 dark:text-red-300'
                            }
                          >
                            {result.fundamentals.sharia_compliant ? '✅ متوافق' : '❌ غير متوافق'}
                          </Badge>
                          {result.fundamentals.sharia_sources > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              ({result.fundamentals.sharia_sources} مصدر موافق)
                            </span>
                          )}
                          {result.fundamentals.sharia_category && (
                            <span className="text-[10px] text-muted-foreground ml-auto truncate" title={result.fundamentals.sharia_category}>
                              {result.fundamentals.sharia_category}
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground p-3">
                      الأساسيات غير متاحة لهذا السهم في قاعدة البيانات.
                    </p>
                  )}
                </TabsContent>

                {/* Tab C: Scenarios */}
                <TabsContent value="scenarios" className="space-y-2 mt-2">
                  {result.scenarios ? (
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { key: 'best_case', label: 'أفضل حالة', color: 'emerald' as const },
                        { key: 'base_case', label: 'الحالة الأساسية', color: 'amber' as const },
                        { key: 'worst_case', label: 'أسوأ حالة', color: 'red' as const },
                      ].map((row) => {
                        const sc = result.scenarios![row.key as 'best_case' | 'base_case' | 'worst_case'];
                        const probColor =
                          sc.probability === 'high'
                            ? 'text-red-600'
                            : sc.probability === 'medium'
                              ? 'text-amber-600'
                              : 'text-muted-foreground';
                        const probAr = sc.probability === 'high' ? 'مرتفعة' : sc.probability === 'medium' ? 'متوسطة' : 'منخفضة';
                        return (
                          <div
                            key={row.key}
                            className={cn(
                              'p-3 rounded-md border text-sm',
                              row.color === 'emerald'
                                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                                : row.color === 'amber'
                                  ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                                  : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800',
                            )}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-semibold">{row.label}</span>
                              <Badge variant="outline" className={cn('text-[10px]', probColor)}>
                                احتمال: {probAr}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">{sc.label}</p>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div>
                                <div className="text-muted-foreground">السعر</div>
                                <div className="font-bold">{(sc.price ?? 0).toFixed(2)}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">الربح/الخسارة</div>
                                <div className={cn('font-bold', sc.profit_egp < 0 ? 'text-red-600' : 'text-emerald-500')}>
                                  {sc.profit_egp >= 0 ? '+' : ''}{AR_NUM.format(Math.round(sc.profit_egp))} ج.م
                                </div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">النسبة</div>
                                <div className={cn('font-bold', sc.profit_pct < 0 ? 'text-red-600' : 'text-emerald-500')}>
                                  {sc.profit_pct >= 0 ? '+' : ''}{(sc.profit_pct ?? 0).toFixed(1)}%
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground p-3">سيناريوهات التعافي متاحة عبر الـ API الجديد.</p>
                  )}
                </TabsContent>

                {/* Tab D: Rescue Plan — THE KEY DELIVERABLE */}
                <TabsContent value="plan" className="space-y-2 mt-2">
                  {(() => {
                    const action = result.recommendation;
                    const breakeven = result.recommendation_deep?.breakeven_calc;
                    const cards: Array<{
                      key: 'HOLD' | 'AVERAGE_DOWN' | 'CUT_LOSS';
                      title: string;
                      icon: React.ReactNode;
                      pros: string;
                      cons: string;
                      risk: string;
                      tone: 'emerald' | 'amber' | 'red';
                    }> = [
                      {
                        key: 'HOLD',
                        title: '⏸️ اصبر (HOLD)',
                        icon: <Activity className="h-4 w-4" />,
                        pros: 'لا خسارة محققة — رأس المال يفضل سائل على الورق.',
                        cons: 'لو السهم في Stage 4، الخسارة ممكن تكبر مع الوقت.',
                        risk: 'منخفض لو fundamentals قوية و السهم فوق الدعم.',
                        tone: 'emerald',
                      },
                      {
                        key: 'AVERAGE_DOWN',
                        title: '📉 اعمل متوسط (AVERAGE_DOWN)',
                        icon: <Calculator className="h-4 w-4" />,
                        pros: 'تقليل متوسط التكلفة → التعافي أسرع لو السهم ارتد.',
                        cons: 'زيادة التعرض لنفس السهم الخسران — مخاطرة تركيز.',
                        risk: 'متوسط — لا تستثمر أكثر من 10-15% من المحفظة.',
                        tone: 'amber',
                      },
                      {
                        key: 'CUT_LOSS',
                        title: '🚨 اقطع الخسارة (CUT_LOSS)',
                        icon: <AlertTriangle className="h-4 w-4" />,
                        pros: 'إيقاف النزيف فوراً + إعادة توجيه رأس المال لفرصة أفضل.',
                        cons: 'تحقيق الخسارة على أرض الواقع — صعب نفسياً.',
                        risk: 'منخفض على رأس المال المتبقي، عالي نفسياً.',
                        tone: 'red',
                      },
                    ];
                    return (
                      <>
                        <div className="grid grid-cols-1 gap-2">
                          {cards.map((c) => {
                            const isRecommended = c.key === action;
                            return (
                              <div
                                key={c.key}
                                className={cn(
                                  'p-3 rounded-md border text-sm transition-all',
                                  c.tone === 'emerald'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                                    : c.tone === 'amber'
                                      ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                                      : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800',
                                  isRecommended && 'ring-2 ring-primary/60 shadow-sm',
                                )}
                              >
                                <div className="flex items-center gap-2 mb-2">
                                  {c.icon}
                                  <span className="font-semibold">{c.title}</span>
                                  {isRecommended && (
                                    <Badge className="ml-auto text-[10px]" variant="default">
                                      ✅ موصى بيه
                                    </Badge>
                                  )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <div className="text-muted-foreground font-semibold mb-0.5">المميزات</div>
                                    <p className="leading-relaxed">{c.pros}</p>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground font-semibold mb-0.5">العيوب</div>
                                    <p className="leading-relaxed">{c.cons}</p>
                                  </div>
                                </div>
                                <div className="mt-2 text-[11px] text-muted-foreground">
                                  <span className="font-semibold">مستوى المخاطرة:</span> {c.risk}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {action === 'AVERAGE_DOWN' && breakeven && (
                          <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs space-y-1">
                            <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                              <Calculator className="h-4 w-4" />
                              حاسبة متوسط التكلفة
                            </div>
                            <p className="text-muted-foreground leading-relaxed">
                              لو أضفت <span className="font-bold text-amber-700 dark:text-amber-300">{AR_NUM.format(breakeven.extra_qty_to_breakeven)} سهم</span> عند السعر الحالي ({(result.current_price ?? 0).toFixed(2)})، متوسطك الجديد هيبقى <span className="font-bold">{(breakeven.new_avg_if_added ?? 0).toFixed(2)}</span>.
                            </p>
                            <p className="text-[10px] text-muted-foreground italic">{breakeven.formula}</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </TabsContent>

                {/* Tab E: Decision Journal */}
                <TabsContent value="journal" className="space-y-2 mt-2">
                  {result.journal_template && (
                    <div className="p-3 rounded-md bg-muted/40 border border-border text-xs leading-relaxed">
                      <div className="flex items-center gap-2 mb-1 font-semibold">
                        <FileText className="h-4 w-4 text-primary" />
                        قالب اليومية (مُعبّأ تلقائياً)
                      </div>
                      <p className="text-muted-foreground">{result.journal_template}</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">قرارك النهائي</label>
                      <div className="flex flex-wrap gap-2">
                        {(['HOLD', 'AVERAGE_DOWN', 'CUT_LOSS'] as const).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setJournalDecision(opt)}
                            className={cn(
                              'px-3 py-1.5 rounded-md border text-xs font-medium transition-colors',
                              journalDecision === opt
                                ? opt === 'HOLD'
                                  ? 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400 text-emerald-800 dark:text-emerald-300'
                                  : opt === 'AVERAGE_DOWN'
                                    ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 text-amber-800 dark:text-amber-300'
                                    : 'bg-red-100 dark:bg-red-900/40 border-red-400 text-red-800 dark:text-red-300'
                                : 'bg-background border-border text-muted-foreground hover:bg-accent',
                            )}
                          >
                            {opt === 'HOLD' ? '⏸️ اصبر' : opt === 'AVERAGE_DOWN' ? '📉 متوسط' : '🚨 اقطع'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">السبب</label>
                      <textarea
                        value={journalReason}
                        onChange={(e) => setJournalReason(e.target.value)}
                        placeholder="اكتب سبب قرارك..."
                        className="w-full min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <Button
                      onClick={handleSaveJournal}
                      disabled={journalSaving || !journalDecision || journalSaved}
                      className="gap-1.5 w-full sm:w-auto"
                    >
                      {journalSaving
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : journalSaved
                          ? <CheckCircle2 className="h-4 w-4" />
                          : <FileText className="h-4 w-4" />}
                      {journalSaved ? 'تم الحفظ في اليومية' : 'احفظ في يومية التداول'}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

              {/* P39-PHASE-4: Persona-scaled rescue advice section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">شخصيتك الاستثمارية:</span>
                    <Badge variant="outline" className="border-primary/30 text-primary">
                      {personaLabelAr(persona)}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setProfilerOpen(true)}
                    className="gap-1.5 h-8"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    إعادة الاختبار
                  </Button>
                </div>

                {personaAdvice && (
                  <div className={cn(
                    'p-3 rounded-lg border text-sm leading-relaxed flex items-start gap-2',
                    personaAdvice.recommendation === 'CUT_LOSS'
                      ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                      : personaAdvice.recommendation === 'AVERAGE_DOWN'
                        ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                        : 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 text-emerald-500 dark:text-green-300'
                  )}>
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <p>{personaAdvice.noteAr}</p>
                  </div>
                )}

                {/* Holding-days input (small, inline) */}
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">
                    منذ كم يوم تحتفظ بالسهم؟
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={holdingDays}
                    onChange={(e) => setHoldingDays(e.target.value)}
                    className="w-24 h-8 text-sm"
                    dir="ltr"
                  />
                  <span className="text-xs text-muted-foreground">يوم</span>
                </div>
              </div>

              {/* P37-PHASE-2B-4A Part B: Apply AVERAGE_DOWN to the portfolio */}
              {result.recommendation === 'AVERAGE_DOWN' && (
                <div className="pt-2 border-t border-border space-y-2">
                  {/* P39-PHASE-4: persona-aware AVERAGE_DOWN ceiling warning */}
                  {overflowsCeiling && (
                    <div className="p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-800 text-xs text-red-800 dark:text-red-300 space-y-1">
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                        <span>
                          🚨 هذه الكمية تتجاوز حدّك الشخصي ({personaAverageMax}% من المحفظة) — خفّض الكمية إلى {AR_NUM.format(suggestedQty)}
                        </span>
                      </div>
                      {suggestedQty > 0 && (
                        <button
                          type="button"
                          onClick={() => setExtraQty(String(suggestedQty))}
                          className="text-[11px] underline hover:no-underline text-red-700 dark:text-red-300"
                        >
                          استخدم الكمية المقترحة ({AR_NUM.format(suggestedQty)} سهم)
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      type="number"
                      placeholder="الكمية الإضافية للشراء بالسعر الحالي"
                      value={extraQty}
                      onChange={(e) => setExtraQty(e.target.value)}
                      className="flex-1 min-w-[180px]"
                      dir="ltr"
                      disabled={applying}
                    />
                    <Button onClick={handleApplyRescue} disabled={applying} className="gap-1.5">
                      {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      تطبيق التعديل على المحفظة
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    سيتم تحديث كمية وسعر الشراء للسهم {result.ticker}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* P39-PHASE-4: Dynamic Debt Paydown card — always visible at the bottom */}
      <Card className="border-emerald-300/50">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-500" />
            <h3 className="font-bold text-base">ديناميكية سداد الديون</h3>
            <Badge variant="outline" className="border-emerald-300 text-emerald-500 dark:text-emerald-300 ml-auto">
              {personaLabelAr(persona)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            أدخل أرباحك المحققة هذا الشهر، والنظام هيحدد نسبة ومبلغ سداد الدين حسب خطتك الاستثمارية.
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm text-muted-foreground whitespace-nowrap">
              أرباحك المحققة هذا الشهر (ج.م)
            </label>
            <Input
              type="number"
              min={0}
              placeholder="مثال: 5000"
              value={profitEGP}
              onChange={(e) => setProfitEGP(e.target.value)}
              className="flex-1 min-w-[160px]"
              dir="ltr"
            />
          </div>

          {profitEGP && Number(profitEGP) > 0 && (
            <div className="space-y-2 animate-in fade-in duration-300">
              <div className="p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-500 dark:text-emerald-300 text-sm leading-relaxed flex items-start gap-2">
                <Wallet className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>{debtAdvice.noteAr}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="p-2 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground">النسبة المخصصة</div>
                  <div className="font-bold">{AR_NUM.format(debtAdvice.ratio * 100)}%</div>
                </div>
                <div className="p-2 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground">المبلغ المقترح</div>
                  <div className="font-bold">{AR_NUM.format(Math.round(debtAdvice.amountEGP))} ج.م</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* P39-PHASE-4: Risk profiler modal — opened manually via RefreshCw
          button or automatically when a result loads and the user hasn't
          completed the questionnaire yet. */}
      <DynamicRiskProfilerModal open={profilerOpen} onOpenChange={setProfilerOpen} />
    </div>
  );
}

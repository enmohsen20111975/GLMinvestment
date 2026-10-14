'use client';

/* ============================================================================
   ALPHA-RESCUE-V1 — BagHolderRescuePanel
   ----------------------------------------------------------------------------
   عيادة إنقاذ الصفقات المتعثرة (#rescue)
   - العميل يدخل: السهم + سعر الشراء + الكمية + إجمالي التكلفة (اختياري)
   - الـ API: POST /api/rescue/analyze (يستدعي Python bag_holder_rescue.py)
   - العرض: 3 قرارات صارمة بلا مجاملة (CUT_LOSS / AVERAGE_DOWN / HOLD)
            + خطة استرداد رأس المال (زمنية + مالية)

   القواعد المُحترمة:
   - Rule 4  (NO FRONTEND COMPUTATION): كل القرارات من Python.
   - Rule 27 (NO-FAKE-DATA): حالة فارغة/خطأ صادقة بدون أرقام مختلقة.
   - Rule 30 (CLIENT-FACING-STYLE): emerald/teal/amber/red/gray فقط — NO blue/indigo.
   - 100% Arabic UI.
   ============================================================================ */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle,
  Activity,
  TrendingDown,
  Clock,
  HeartPulse,
  FileSearch,
  Lightbulb,
  Target,
  Loader2,
  ListChecks,
  ShieldAlert,
  Stethoscope,
  RefreshCw,
  Wallet,
  TrendingUp,
  StopCircle,
  RefreshCcwDot,
  Hourglass,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// Marathon Phase 2: dynamic currency based on stock's market
import { marketCurrencySymbol, type MarketCode } from '@/types/commercial-feed';

// ─── Types (matching Python API response) ────────────────────────────────

interface RecoveryOption {
  key: string;
  priority: number;
  title: string;
  reason: string;
  invalidation: string;
  level: string;
  level_price: number | null;
  applicable: boolean;
  active: boolean;
}

interface DecisionView {
  key: 'CUT_LOSS' | 'AVERAGE_DOWN' | 'HOLD';
  ar_title: string;
  ar_when: string;
  active: boolean;
  applicable_reason: string | null;
  invalidation: string | null;
  level: string | null;
  level_price: number | null;
}

interface DiagnosisQA {
  question: string;
  answer: string;
}

interface RescueResponse {
  success: boolean;
  ticker: string;
  decision: string | null;
  decision_ar: string | null;
  verdict_badge: string;
  current_price: number | null;
  buy_price: number | null;
  loss_amount: number | null;
  loss_pct: number | null;
  invested_egp?: number | null;
  market_value_egp?: number | null;
  recovery_needed_pct?: number | null;
  price_source?: string | null;
  price_timestamp?: string | null;
  historical_high?: number | null;
  historical_low?: number | null;
  range_estimated?: boolean;
  data_conflict?: boolean;
  conflict_reasons?: string[];
  price_candidates?: { price: number; source: string; timestamp: string | null }[];
  message?: string;
  diagnosis?: {
    trend_status: string;
    trend_broken: boolean;
    below_sma50: boolean | null;
    below_sma200: boolean | null;
    selling_pressure: string;
    loss_pct: number;
    nearby_support: number | null;
    support_distance_pct: number | null;
    summary: string;
    questions: DiagnosisQA[];
  } | null;
  autopsy?: {
    bought_near_peak: boolean;
    is_falling_knife: boolean;
    ignored_stop_loss: boolean;
    trend_status?: string;
    summary: string;
  } | null;
  asset_health?: {
    is_profitable: boolean | null;
    pe_ratio: number | null;
    institutional_flow: string;
    support_level: number | null;
    resistance_exit_level: number | null;
    dividend_yield: number;
    profitability_note?: string;
  } | null;
  action_plan?: {
    recommended_action: string;
    primary_option_key: string;
    options: RecoveryOption[];
    average_down_allowed: boolean;
    average_down_reason: string;
  } | null;
  lessons_learned: string[];
  decisions?: DecisionView[];
  input?: {
    ticker: string;
    purchase_price: number;
    quantity: number;
    total_cost: number;
  };
  error?: string;
  details?: string;
}

interface BagHolderRescuePanelProps {
  /** Pre-fill ticker (e.g. from a clicked losing position) */
  ticker?: string;
  /** Pre-fill buy/purchase price */
  buyPrice?: number;
  /** Pre-fill quantity */
  quantity?: number;
  /** Auto-trigger analysis when props are provided */
  autoAnalyze?: boolean;
  /** Optional total cost (defaults to purchase_price * quantity) */
  totalCost?: number;
  /** Compact mode (no header) — used when embedded in portfolio tabs */
  compact?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const fmtPrice = (n: number | null | undefined, digits = 2): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('ar-EG', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const fmtPct = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
};

const fmtMoney = (n: number | null | undefined, currency = 'ج.م'): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.abs(n).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ${currency}`;
};

// Rule 30 palette: emerald/teal/amber/red/gray only — NO blue/indigo
// SCR-STITCH-020-017: dark: variants use Stitch Sovereign Terminal tokens.
const DECISION_STYLE: Record<
  DecisionView['key'],
  {
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
    badge: string;
    ring: string;
    panelActive: string;
    panelIdle: string;
  }
> = {
  CUT_LOSS: {
    icon: StopCircle,
    accent: 'text-red-600 dark:text-red-400 dark:text-error',
    badge: 'bg-red-600 text-white dark:bg-error dark:text-on-error',
    ring: 'border-red-400 dark:border-red-700 dark:border-error',
    panelActive: 'border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/30 dark:border-error dark:bg-error-container/10',
    panelIdle: 'border-border/50 bg-muted/20 dark:border-outline-variant/30 dark:bg-surface-container-low',
  },
  AVERAGE_DOWN: {
    icon: RefreshCcwDot,
    accent: 'text-amber-600 dark:text-amber-400 dark:text-secondary',
    badge: 'bg-amber-600 text-white',
    ring: 'border-amber-400 dark:border-amber-700 dark:border-amber-500/40',
    panelActive: 'border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-500/40 dark:bg-amber-500/5',
    panelIdle: 'border-border/50 bg-muted/20 dark:border-outline-variant/30 dark:bg-surface-container-low',
  },
  HOLD: {
    icon: Hourglass,
    accent: 'text-teal-600 dark:text-teal-400 dark:text-secondary',
    badge: 'bg-teal-600 text-white dark:bg-secondary dark:text-on-secondary',
    ring: 'border-teal-400 dark:border-teal-700 dark:border-secondary',
    panelActive: 'border-teal-400 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/30 dark:border-secondary dark:bg-secondary/5',
    panelIdle: 'border-border/50 bg-muted/20 dark:border-outline-variant/30 dark:bg-surface-container-low',
  },
};

// ─── Component ────────────────────────────────────────────────────────────

export function BagHolderRescuePanel({
  ticker: tickerProp,
  buyPrice: buyPriceProp,
  quantity: quantityProp,
  autoAnalyze: autoAnalyzeProp = false,
  totalCost: totalCostProp,
  compact = false,
}: BagHolderRescuePanelProps) {
  const [ticker, setTicker] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [qty, setQty] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RescueResponse | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  // Marathon Phase 2: dynamic market currency (detected from stock's market)
  const [stockMarket, setStockMarket] = useState<MarketCode | null>(null);
  const currency = marketCurrencySymbol(stockMarket);

  // ── Pre-fill from props ──────────────────────────────────────────────
  useEffect(() => {
    if (tickerProp) {
      setTicker(tickerProp.toUpperCase());
      if (buyPriceProp && buyPriceProp > 0) setEntryPrice(String(buyPriceProp));
      if (quantityProp && quantityProp > 0) setQty(String(quantityProp));
      if (totalCostProp && totalCostProp > 0) setTotalCost(String(totalCostProp));
      if (autoAnalyzeProp && buyPriceProp && buyPriceProp > 0) {
        // Allow state to settle, then trigger
        setTimeout(() => {
          void runAnalyze({
            ticker: tickerProp.toUpperCase(),
            purchase_price: buyPriceProp,
            quantity: quantityProp || 0,
            total_cost: totalCostProp || buyPriceProp * (quantityProp || 0),
          });
        }, 120);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerProp, buyPriceProp, quantityProp, autoAnalyzeProp, totalCostProp]);

  // ── Live price fetch (display only — does NOT drive decisions) ───────
  const fetchLivePrice = useCallback(async (t: string) => {
    if (!t.trim()) { setLivePrice(null); return; }
    setFetchingPrice(true);
    try {
      const res = await fetch(`/api/stocks/${encodeURIComponent(t.trim())}/comprehensive`, { cache: 'no-store' });
      const json = await res.json();
      const price = Number(json?.stock?.current_price ?? json?.stats?.lastClose ?? json?.price?.current_price ?? 0);
      setLivePrice(price > 0 ? price : null);
      // Marathon Phase 2: detect market from stock.market field
      const marketRaw = String(json?.stock?.market ?? json?.market ?? '').toUpperCase();
      const validMarkets: MarketCode[] = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO'];
      const detected = validMarkets.includes(marketRaw as MarketCode) ? (marketRaw as MarketCode) : null;
      setStockMarket(detected);
    } catch {
      setLivePrice(null);
      setStockMarket(null);
    } finally {
      setFetchingPrice(false);
    }
  }, []);

  const handleTickerChange = (val: string) => {
    setTicker(val.toUpperCase());
    if (val.trim().length >= 2) fetchLivePrice(val);
  };

  // ── Main analyze call ────────────────────────────────────────────────
  const runAnalyze = useCallback(async (override?: {
    ticker: string;
    purchase_price: number;
    quantity: number;
    total_cost: number;
  }) => {
    const t = (override?.ticker || ticker).trim().toUpperCase();
    const bp = override?.purchase_price ?? Number(entryPrice);
    const q = override?.quantity || Number(qty);
    const tc = override?.total_cost || Number(totalCost) || bp * q;

    if (!t) { toast.error('أدخل رمز السهم'); return; }
    if (!Number.isFinite(bp) || bp <= 0) { toast.error('أدخل سعر الشراء الأصلي'); return; }
    if (!Number.isFinite(q) || q <= 0) { toast.error('أدخل الكمية المملوكة'); return; }

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/rescue/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          ticker: t,
          purchase_price: bp,
          quantity: q,
          total_cost: Number.isFinite(tc) && tc > 0 ? tc : bp * q,
        }),
      });
      const json: RescueResponse = await res.json();
      if (json.success) {
        setResult(json);
        if (json.current_price != null && json.current_price > 0) setLivePrice(json.current_price);
      } else {
        // Honest error (Rule 27) — no fabricated fallback
        setResult(json); // surface the error body so UI can show details
        toast.error(json.message || json.error || 'فشل التشخيص');
      }
    } catch {
      toast.error('فشل الاتصال بمحرك التحليل — حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  }, [ticker, entryPrice, qty, totalCost]);

  const handleDiagnose = () => runAnalyze();

  // Auto-fill total_cost when entry/qty change (UX helper, not a decision driver)
  useEffect(() => {
    const bp = Number(entryPrice);
    const q = Number(qty);
    if (Number.isFinite(bp) && bp > 0 && Number.isFinite(q) && q > 0) {
      // Only auto-fill if user hasn't manually entered total_cost
      if (!totalCost || Number(totalCost) === 0) {
        setTotalCost(String((bp * q).toFixed(2)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPrice, qty]);

  // ── Numeric consistency guard (display only) ─────────────────────────
  const clientLossPct = useMemo(() => {
    if (!result?.current_price || !result?.buy_price) return null;
    return ((result.current_price - result.buy_price) / result.buy_price) * 100;
  }, [result]);

  const numericMismatch =
    result != null &&
    clientLossPct != null &&
    result.loss_pct != null &&
    Math.abs(clientLossPct - result.loss_pct) > 0.5;

  const isConflict = !!(result?.data_conflict || numericMismatch) && !!result?.success;
  const conflictReasons = useMemo(() => {
    if (!result) return [] as string[];
    const reasons = [...(result.conflict_reasons || [])];
    if (numericMismatch && clientLossPct != null && result.loss_pct != null) {
      reasons.push(
        'تعارض داخلي: نسبة الخسارة المحسوبة من سعر الشراء والسعر الحالي '
        + `(${clientLossPct.toFixed(2)}%) لا تطابق النسبة المعلنة (${result.loss_pct.toFixed(2)}%).`,
      );
    }
    return reasons;
  }, [result, numericMismatch, clientLossPct]);

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" dir="rtl">
      {!compact && (
        <div className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-black flex items-center justify-center gap-2 text-emerald-700 dark:text-emerald-400 dark:text-primary dark:font-outfit">
            🚑 عيادة إنقاذ الصفقات المتعثرة
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto dark:text-on-surface-variant">
            تشخيص صارم بلا مجاملة — ثلاثة قرارات فقط: اقطع الخسارة / برّد بحساب دقيق / اصبر.
            كل الأرقام من بيانات حقيقية، وكل قرار من محرك Python.
          </p>
        </div>
      )}

      {/* ── Input Card ─────────────────────────────────────────────────── */}
      <Card className="border-2 border-emerald-200 dark:border-emerald-900 dark:bg-surface-container-low dark:border dark:border-primary/30">
        <CardContent className="p-4 md:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold dark:text-on-surface-variant">رمز السهم</Label>
              <Input
                value={ticker}
                onChange={(e) => handleTickerChange(e.target.value)}
                placeholder="مثال: COMI"
                className="h-10 font-mono dark:bg-surface-container dark:text-on-surface dark:border-outline-variant dark:font-financial tabular-nums"
                dir="ltr"
              />
              {fetchingPrice && <span className="text-[10px] text-muted-foreground dark:text-on-surface-variant">جاري جلب السعر...</span>}
              {livePrice !== null && !fetchingPrice && (
                <span className="text-[10px] text-muted-foreground dark:text-on-surface-variant">
                  السعر الحالي: <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums dark:font-financial dark:text-primary">{fmtPrice(livePrice)} {currency}</span>
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold dark:text-on-surface-variant">سعر الشراء الأصلي ({currency})</Label>
              <Input
                type="number"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="مثال: 25.50"
                className="h-10 font-mono dark:bg-surface-container dark:text-on-surface dark:border-outline-variant dark:font-financial tabular-nums"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold dark:text-on-surface-variant">الكمية المملوكة</Label>
              <Input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="مثال: 1000"
                className="h-10 font-mono dark:bg-surface-container dark:text-on-surface dark:border-outline-variant dark:font-financial tabular-nums"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold dark:text-on-surface-variant">إجمالي التكلفة ({currency}) — اختياري</Label>
              <Input
                type="number"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                placeholder="يُحسب تلقائياً"
                className="h-10 font-mono dark:bg-surface-container dark:text-on-surface dark:border-outline-variant dark:font-financial tabular-nums"
                dir="ltr"
              />
            </div>
          </div>
          <Button
            onClick={handleDiagnose}
            disabled={loading}
            className="w-full h-11 text-sm font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري التشخيص...
              </>
            ) : (
              <>
                <Stethoscope className="w-4 h-4" />
                تشخيص الصفقة
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Loading skeleton ───────────────────────────────────────────── */}
      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      )}

      {/* ── Honest empty state (Rule 27) ──────────────────────────────── */}
      {!loading && !result && (
        <Card className="border-dashed border-2 border-border/60 dark:bg-surface-container-low dark:border-outline-variant/30">
          <CardContent className="p-6 text-center space-y-2">
            <FileSearch className="w-8 h-8 text-muted-foreground/60 mx-auto dark:text-on-surface-variant/60" />
            <p className="text-sm font-semibold text-foreground dark:text-on-surface dark:font-outfit">لا يوجد تشخيص بعد</p>
            <p className="text-xs text-muted-foreground dark:text-on-surface-variant">
              أدخل بيانات الصفقة بالأعلى ثم اضغط «تشخيص الصفقة». كل النتائج تُحسب من بيانات السوق الحقيقية عبر Python.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Error / engine unavailable state (Rule 27 — honest) ────────── */}
      {!loading && result && !result.success && (
        <Card className="border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20 dark:bg-error-container/10 dark:border-error/30">
          <CardContent className="p-4 md:p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center shrink-0 dark:bg-error">
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-lg font-black text-red-700 dark:text-red-400 dark:text-error dark:font-outfit">
                  تعذّر تشخيص الصفقة
                </p>
                <p className="text-xs text-muted-foreground dark:text-on-surface-variant">
                  {result.message || result.error || 'خطأ غير معروف'}
                </p>
              </div>
            </div>
            {result.details && (
              <p className="text-[10px] text-muted-foreground font-mono leading-relaxed break-all dark:text-on-surface-variant dark:font-financial tabular-nums">
                التفاصيل: {result.details}
              </p>
            )}
            <p className="text-xs text-muted-foreground leading-relaxed dark:text-on-surface-variant">
              لم يتم اختلاق أي توصية. أعد المحاولة بعد التأكد من توفّر محرك Python وقواعد البيانات.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Data conflict state (Rule 27 — honest pause) ──────────────── */}
      {!loading && result && result.success && isConflict && (
        <Card className="border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-500/40 dark:bg-amber-500/5">
          <CardContent className="p-4 md:p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-lg font-black text-amber-700 dark:text-amber-400 dark:text-secondary dark:font-outfit">
                  تعارض في البيانات — التوصية متوقفة
                </p>
                <p className="text-xs text-muted-foreground dark:text-on-surface-variant">
                  {result.message || 'لا يمكن إصدار توصية موثوقة قبل حل التعارض.'}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              {conflictReasons.map((r, i) => (
                <p key={i} className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed flex gap-1.5 dark:text-secondary">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{r}</span>
                </p>
              ))}
            </div>
            {result.price_candidates && result.price_candidates.length > 1 && (
              <div className="p-3 rounded-lg bg-background/60 border border-amber-200 dark:border-amber-800 dark:bg-surface-container dark:border-amber-500/40">
                <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mb-1.5 dark:text-secondary">
                  أسعار مرشحة من المصادر:
                </p>
                <div className="space-y-1">
                  {result.price_candidates.map((c, i) => (
                    <div key={i} className="flex justify-between text-[11px] font-mono dark:font-financial tabular-nums">
                      <span className="text-muted-foreground dark:text-on-surface-variant">{c.source}</span>
                      <span className="font-bold dark:text-on-surface">
                        {fmtPrice(c.price)}
                        {c.timestamp ? <span className="text-muted-foreground font-sans dark:text-on-surface-variant"> — {c.timestamp}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground leading-relaxed dark:text-on-surface-variant">
              أعد المحاولة لاحقاً بعد تحديث البيانات، أو تحقق من السعر يدوياً من مصدر موثوق قبل اتخاذ أي قرار.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Result view (success + no conflict) ───────────────────────── */}
      {!loading && result && result.success && !isConflict && (
        <ResultView result={result} />
      )}
    </div>
  );
}

// ─── Result view: 3 decisions + diagnosis + recovery plan ────────────────

// Marathon Phase 2: shared hook to detect market currency from a ticker
function useMarketCurrency(ticker: string | null | undefined): string {
  const [currency, setCurrency] = useState('ج.م');
  useEffect(() => {
    if (!ticker || ticker.trim().length < 2) { setCurrency('ج.م'); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stocks/${encodeURIComponent(ticker.trim())}/comprehensive`, { cache: 'no-store' });
        const json = await res.json();
        if (cancelled) return;
        const marketRaw = String(json?.stock?.market ?? json?.market ?? '').toUpperCase();
        const validMarkets: MarketCode[] = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO'];
        const detected = validMarkets.includes(marketRaw as MarketCode) ? (marketRaw as MarketCode) : null;
        setCurrency(marketCurrencySymbol(detected));
      } catch {
        if (!cancelled) setCurrency('ج.م');
      }
    })();
    return () => { cancelled = true; };
  }, [ticker]);
  return currency;
}

function ResultView({ result }: { result: RescueResponse }) {
  // Marathon Phase 2: detect currency from the result's ticker
  const currency = useMarketCurrency(result?.ticker);
  const decisions: DecisionView[] = result.decisions && result.decisions.length === 3
    ? result.decisions
    : buildFallbackDecisions(result.decision);

  const trendBadgeStyle = (trend: string) => {
    if (trend.includes('كسر دعم') || trend.includes('هابط واضح')) {
      return 'border-red-300 text-red-600 dark:text-red-400 dark:border-error dark:text-error';
    }
    if (trend.includes('تصحيح حاد') || trend.includes('هبوط عميق')) {
      return 'border-amber-300 text-amber-600 dark:text-amber-400 dark:border-amber-500/40 dark:text-secondary';
    }
    return 'border-teal-300 text-teal-600 dark:text-teal-400 dark:border-secondary dark:text-secondary';
  };

  return (
    <div className="space-y-4">
      {/* Verdict banner */}
      <Card className={cn(
        'border-2',
        result.verdict_badge === 'danger'
          ? 'border-red-400 dark:border-red-800 bg-red-50 dark:bg-red-950/20 dark:border-error dark:bg-error-container/10'
          : result.verdict_badge === 'warning'
            ? 'border-amber-400 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-500/40 dark:bg-amber-500/5'
            : 'border-teal-400 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/20 dark:border-secondary dark:bg-secondary/5',
      )}>
        <CardContent className="p-4 md:p-5">
          <div className="flex items-start gap-4">
            <div className={cn(
              'w-12 h-12 rounded-full flex items-center justify-center shrink-0',
              result.verdict_badge === 'danger'
                ? 'bg-red-600 dark:bg-error'
                : result.verdict_badge === 'warning'
                  ? 'bg-amber-600'
                  : 'bg-teal-600 dark:bg-secondary',
            )}>
              {result.verdict_badge === 'danger' ? (
                <StopCircle className="w-6 h-6 text-white" />
              ) : result.verdict_badge === 'warning' ? (
                <RefreshCcwDot className="w-6 h-6 text-white" />
              ) : (
                <Hourglass className="w-6 h-6 text-white" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base md:text-lg font-black text-foreground dark:text-on-surface dark:font-outfit">
                {result.decision_ar || 'القرار غير متاح'}
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed dark:text-on-surface-variant">
                {result.action_plan?.recommended_action}
              </p>
              {result.market_value_egp != null && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground dark:text-on-surface-variant">
                  <Wallet className="w-3.5 h-3.5" />
                  <span>قيمة المركز الحالية:</span>
                  <span className="font-mono font-bold text-foreground tabular-nums dark:font-financial dark:text-on-surface">
                    {fmtMoney(result.market_value_egp, currency)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ THE 3 HARSH DECISIONS (always visible, active highlighted) ═══ */}
      <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5 dark:text-on-surface dark:font-outfit">
            <ListChecks className="w-4 h-4 text-emerald-600 dark:text-primary" />
            القرارات الثلاثة الصارمة — كل قرار بشرطه
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {decisions.map((d) => {
            const style = DECISION_STYLE[d.key];
            const Icon = style.icon;
            return (
              <div
                key={d.key}
                className={cn(
                  'p-3 md:p-4 rounded-xl border-2 space-y-2 transition-colors',
                  d.active ? style.panelActive : style.panelIdle,
                )}
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('w-5 h-5', style.accent)} />
                    <span className={cn('text-sm md:text-base font-black dark:font-outfit', style.accent)}>
                      {d.ar_title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {d.active && (
                      <Badge className={cn('text-[10px]', style.badge)}>القرار المُختار</Badge>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground dark:text-on-surface-variant">
                  <span className="font-semibold text-foreground dark:text-on-surface">متى يُلائم هذا القرار؟ </span>
                  {d.ar_when}
                </p>
                {d.applicable_reason && (
                  <p className="text-[11px] text-foreground leading-relaxed bg-background/60 border border-border/40 rounded-md p-2 dark:text-on-surface dark:bg-surface-container dark:border-outline-variant/30">
                    <span className="font-bold">السبب: </span>{d.applicable_reason}
                  </p>
                )}
                {d.invalidation && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed dark:text-on-surface-variant">
                    <span className="font-semibold text-foreground dark:text-on-surface">يُلغى عند: </span>{d.invalidation}
                  </p>
                )}
                {d.level && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed dark:text-on-surface-variant">
                    <span className="font-semibold text-foreground dark:text-on-surface">مستوى تراجع القرار: </span>{d.level}
                  </p>
                )}
              </div>
            );
          })}

          {/* AVERAGE_DOWN conditional cooling note (from Python — not fabricated) */}
          {result.action_plan?.average_down_reason && (
            <div className={cn(
              'p-3 rounded-lg border',
              result.action_plan.average_down_allowed
                ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-500/40 dark:bg-amber-500/5'
                : 'border-border/50 bg-muted/20 dark:border-outline-variant/30 dark:bg-surface-container-low',
            )}>
              <div className="flex items-center gap-1.5 mb-1">
                <Activity className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 dark:text-secondary" />
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300 dark:text-secondary">
                  {result.action_plan.average_down_allowed ? 'تبريد إضافي مشروط — مش التوصية الرئيسية' : 'حالة التبريد'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed dark:text-on-surface-variant">
                {result.action_plan.average_down_reason}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Capital Recovery Plan (timeline + financial) ═══ */}
      <CapitalRecoveryPlan result={result} />

      {/* Diagnosis + Trade Analysis + Asset Health grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Diagnosis */}
        {result.diagnosis && (
          <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5 dark:text-on-surface dark:font-outfit">
                <ListChecks className="w-4 h-4 text-emerald-600 dark:text-primary" />
                التشخيص — السبب قبل الحكم
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn('text-[10px]', trendBadgeStyle(result.diagnosis.trend_status))}>
                  {result.diagnosis.trend_status}
                </Badge>
                <Badge variant="outline" className="text-[10px] dark:border-outline-variant/30 dark:text-on-surface-variant">
                  السيولة: {result.diagnosis.selling_pressure}
                </Badge>
              </div>
              <p className="text-xs text-foreground leading-relaxed dark:text-on-surface">
                {result.diagnosis.summary}
              </p>
              <div className="space-y-2 pt-1 border-t border-border/30 dark:border-outline-variant/30">
                {result.diagnosis.questions.map((qa, i) => (
                  <div key={i} className="space-y-0.5">
                    <p className="text-[11px] font-bold text-foreground dark:text-on-surface">{qa.question}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed dark:text-on-surface-variant">{qa.answer}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Trade Analysis */}
        <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5 dark:text-on-surface dark:font-outfit">
              <FileSearch className="w-4 h-4 text-emerald-600 dark:text-primary" />
              تحليل الصفقة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground dark:text-on-surface-variant">نسبة الخسارة</span>
              <span className={cn('font-bold font-mono tabular-nums dark:font-financial', (result.loss_pct ?? 0) < 0 ? 'text-red-600 dark:text-red-400 dark:text-error' : 'text-emerald-600 dark:text-emerald-400 dark:text-primary')}>
                {fmtPct(result.loss_pct)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground dark:text-on-surface-variant">قيمة الخسارة</span>
              <span className={cn('font-bold font-mono tabular-nums dark:font-financial', (result.loss_pct ?? 0) < 0 ? 'text-red-600 dark:text-red-400 dark:text-error' : 'text-emerald-600 dark:text-emerald-400 dark:text-primary')}>
                {fmtMoney(result.loss_amount, currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground dark:text-on-surface-variant">سعر الشراء</span>
              <span className="font-mono font-semibold tabular-nums dark:font-financial dark:text-on-surface">{fmtPrice(result.buy_price)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground dark:text-on-surface-variant">السعر الحالي</span>
              <span className="font-mono font-semibold tabular-nums dark:font-financial dark:text-on-surface">{fmtPrice(result.current_price)}</span>
            </div>
            {result.recovery_needed_pct != null && result.recovery_needed_pct > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground dark:text-on-surface-variant">التعادل يحتاج ارتداداً</span>
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 tabular-nums dark:font-financial dark:text-secondary">{result.recovery_needed_pct.toFixed(1)}%</span>
              </div>
            )}
            {result.price_source && (
              <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/30 dark:text-on-surface-variant dark:border-outline-variant/30">
                مصدر السعر: {result.price_source}
                {result.price_timestamp ? ` — آخر تحديث ${result.price_timestamp}` : ''}
              </p>
            )}
            <div className="pt-1 space-y-1">
              {result.autopsy?.bought_near_peak && (
                <Badge variant="outline" className="text-[9px] border-red-300 text-red-600 mr-1 dark:border-error dark:text-error">شراء في قمة</Badge>
              )}
              {result.autopsy?.trend_status && (
                <Badge variant="outline" className={cn('text-[9px] mr-1', trendBadgeStyle(result.autopsy.trend_status))}>
                  {result.autopsy.trend_status}
                </Badge>
              )}
              {result.autopsy?.ignored_stop_loss && (
                <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-600 mr-1 dark:border-amber-500/40 dark:text-secondary">تجاهل الوقف</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed pt-1 dark:text-on-surface-variant">{result.autopsy?.summary}</p>
          </CardContent>
        </Card>

        {/* Asset Health */}
        {result.asset_health && (
          <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5 dark:text-on-surface dark:font-outfit">
                <HeartPulse className="w-4 h-4 text-emerald-500 dark:text-primary" />
                حيوية الأصل والسيولة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground dark:text-on-surface-variant">تدفق السيولة المؤسسية</span>
                <span className="font-semibold dark:text-on-surface">{result.asset_health.institutional_flow ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground dark:text-on-surface-variant">ربحية الشركة</span>
                <span className="font-semibold dark:text-on-surface">
                  {result.asset_health.is_profitable === true ? '✅ رابحة' : result.asset_health.is_profitable === false ? '❌ خاسرة' : '—'}
                </span>
              </div>
              {result.asset_health.pe_ratio != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground dark:text-on-surface-variant">مكرر الربحية (P/E)</span>
                  <span className="font-mono font-semibold tabular-nums dark:font-financial dark:text-on-surface">{result.asset_health.pe_ratio.toFixed(2)}</span>
                </div>
              )}
              {(result.asset_health.dividend_yield ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground dark:text-on-surface-variant">عائد التوزيعات</span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums dark:font-financial dark:text-primary">{(result.asset_health.dividend_yield ?? 0).toFixed(2)}%</span>
                </div>
              )}
              {result.asset_health.support_level != null && result.asset_health.support_level > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground dark:text-on-surface-variant">مستوى الدعم</span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums dark:font-financial dark:text-primary">{result.asset_health.support_level.toFixed(2)}</span>
                </div>
              )}
              {result.asset_health.resistance_exit_level != null && result.asset_health.resistance_exit_level > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground dark:text-on-surface-variant">مستوى الخروج (أقرب مقاومة)</span>
                  <span className="font-mono font-semibold text-red-600 dark:text-red-400 tabular-nums dark:font-financial dark:text-error">{result.asset_health.resistance_exit_level.toFixed(2)}</span>
                </div>
              )}
              {result.asset_health.profitability_note && (
                <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/30 dark:text-on-surface-variant dark:border-outline-variant/30">
                  دليل الربحية: {result.asset_health.profitability_note}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Lessons Learned */}
        {result.lessons_learned.length > 0 && (
          <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/10 dark:border-amber-500/40 dark:bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5 dark:text-on-surface dark:font-outfit">
                <Lightbulb className="w-4 h-4 text-amber-500 dark:text-secondary" />
                الدروس المستفادة من هذه الحالة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {result.lessons_learned.map((lesson, i) => (
                <p key={i} className="text-xs text-muted-foreground leading-relaxed dark:text-on-surface-variant">{lesson}</p>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Capital Recovery Plan (timeline + financial) ────────────────────────

function CapitalRecoveryPlan({ result }: { result: RescueResponse }) {
  // Marathon Phase 2: detect currency from the result's ticker
  const currency = useMarketCurrency(result?.ticker);
  // All numbers come from Python (Rule 4). We just present them clearly.
  const invested = result.invested_egp;
  const marketValue = result.market_value_egp;
  const lossAmount = result.loss_amount;
  const lossPct = result.loss_pct;
  const recoveryNeeded = result.recovery_needed_pct;
  const currentPrice = result.current_price;
  const buyPrice = result.buy_price;
  const exitLevel = result.asset_health?.resistance_exit_level ?? null;
  const supportLevel = result.asset_health?.support_level ?? null;
  const decision = result.decision;

  // Timeline phases — derived purely from Python's decision + levels (no fabrication)
  const phases: Array<{ label: string; value: string; tone: 'emerald' | 'amber' | 'red' | 'teal' | 'gray' }> = [];
  if (decision === 'CUT_LOSS') {
    phases.push({ label: 'الخطوة 1 — إغلاق المركز', value: 'الآن', tone: 'red' });
    phases.push({ label: 'الخطوة 2 — تحويل السيولة لنقد', value: 'فوري', tone: 'amber' });
    phases.push({ label: 'الخطوة 3 — إعادة التوجيه لأصل أفضل', value: 'خلال أيام', tone: 'teal' });
  } else if (decision === 'AVERAGE_DOWN') {
    phases.push({ label: 'الخطوة 1 — تخفيض جزئي 40-60%', value: 'الآن', tone: 'amber' });
    phases.push({ label: 'الخطوة 2 — مراقبة الارتداد فوق مقاومة الإغلاق', value: 'أيام/أسابيع', tone: 'teal' });
    phases.push({ label: 'الخطوة 3 — تبريد إضافي مشروط فقط بعد تأكيد القاع', value: 'حسب تأكيد الإغلاق', tone: 'emerald' });
  } else {
    phases.push({ label: 'الخطوة 1 — انتظار ومراقبة صارمة', value: 'مستمر', tone: 'teal' });
    phases.push({ label: 'الخطوة 2 — خروج فوري عند كسر وقف الخسارة', value: 'عند المستوى', tone: 'red' });
    phases.push({ label: 'الخطوة 3 — إعادة تقييم دوري للأصول', value: 'كل أسبوع', tone: 'emerald' });
  }

  const toneClass: Record<typeof phases[number]['tone'], string> = {
    emerald: 'border-emerald-300 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 dark:border-primary/30 dark:text-primary dark:bg-primary-container/10',
    amber: 'border-amber-300 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-500/40 dark:bg-amber-500/5',
    red: 'border-red-300 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 dark:border-error/30 dark:text-error dark:bg-error-container/10',
    teal: 'border-teal-300 text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/20 dark:border-secondary/30 dark:text-secondary dark:bg-secondary/10',
    gray: 'border-border text-muted-foreground bg-muted/20 dark:border-outline-variant/30 dark:text-on-surface-variant dark:bg-surface-container-low',
  };

  return (
    <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5 dark:text-on-surface dark:font-outfit">
          <Target className="w-4 h-4 text-emerald-600 dark:text-primary" />
          خطة استرداد رأس المال — timeline + أرقام مالية
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Financial summary grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <FinanceCell label="رأس المال المستثمر" value={fmtMoney(invested, currency)} tone="emerald" />
          <FinanceCell label="القيمة السوقية الحالية" value={fmtMoney(marketValue, currency)} tone="teal" />
          <FinanceCell
            label="قيمة الخسارة"
            value={fmtMoney(lossAmount, currency)}
            tone={(lossPct ?? 0) < 0 ? 'red' : 'emerald'}
          />
          <FinanceCell
            label="نسبة الخسارة"
            value={fmtPct(lossPct)}
            tone={(lossPct ?? 0) < 0 ? 'red' : 'emerald'}
          />
          <FinanceCell label="السعر الحالي" value={fmtPrice(currentPrice)} tone="teal" />
          <FinanceCell label="سعر الشراء الأصلي" value={fmtPrice(buyPrice)} tone="gray" />
          <FinanceCell
            label="الارتداد اللازم للتعادل"
            value={recoveryNeeded != null && recoveryNeeded > 0 ? `${recoveryNeeded.toFixed(1)}%` : '—'}
            tone="amber"
          />
          <FinanceCell
            label="مستوى الدعم"
            value={supportLevel != null && supportLevel > 0 ? fmtPrice(supportLevel) : '—'}
            tone="emerald"
          />
        </div>

        {/* Timeline phases */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-foreground dark:text-on-surface">الخطوات الزمنية:</p>
          {phases.map((p, i) => (
            <div key={i} className={cn('flex items-center justify-between gap-2 p-2 rounded-lg border text-xs', toneClass[p.tone])}>
              <span className="font-semibold dark:text-on-surface">{p.label}</span>
              <span className="font-mono tabular-nums dark:font-financial">{p.value}</span>
            </div>
          ))}
        </div>

        {/* Exit level (if any) */}
        {exitLevel != null && exitLevel > 0 && (
          <div className="flex items-center justify-between p-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/10 text-xs dark:border-amber-500/40 dark:bg-amber-500/5">
            <span className="text-muted-foreground flex items-center gap-1 dark:text-on-surface-variant">
              <TrendingUp className="w-3.5 h-3.5 text-amber-600 dark:text-secondary" />
              مستوى الخروج المالي (أقرب مقاومة)
            </span>
            <span className="font-mono font-bold text-amber-700 dark:text-amber-400 tabular-nums dark:font-financial dark:text-secondary">{fmtPrice(exitLevel)} {currency}</span>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-[10px] text-muted-foreground leading-relaxed pt-1 border-t border-border/30 dark:text-on-surface-variant dark:border-outline-variant/30">
          <ShieldAlert className="w-3 h-3 inline ml-1 text-amber-500 dark:text-secondary" />
          كل الأرقام مصدرها Python من قواعد البيانات الحقيقية — لا تقديرات ولا تخمينات. القرارات الاستثمارية النهائية مسؤولية المستخدم.
        </p>
      </CardContent>
    </Card>
  );
}

function FinanceCell({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'red' | 'teal' | 'gray' }) {
  const toneText: Record<typeof tone, string> = {
    emerald: 'text-emerald-700 dark:text-emerald-400 dark:text-primary',
    amber: 'text-amber-700 dark:text-amber-400 dark:text-secondary',
    red: 'text-red-700 dark:text-red-400 dark:text-error',
    teal: 'text-teal-700 dark:text-teal-400 dark:text-secondary',
    gray: 'text-foreground dark:text-on-surface',
  };
  return (
    <div className="p-2 rounded-lg border border-border/60 bg-muted/20 dark:bg-surface-container-low dark:border-outline-variant/30">
      <p className="text-[10px] text-muted-foreground mb-0.5 dark:text-on-surface-variant">{label}</p>
      <p className={cn('font-mono font-bold text-sm tabular-nums dark:font-financial', toneText[tone])}>{value}</p>
    </div>
  );
}

// ─── Fallback decisions builder (only if API didn't provide `decisions`) ──

function buildFallbackDecisions(decision: string | null): DecisionView[] {
  // Mirror the API shape — used only as a defensive fallback if the API
  // didn't decorate `decisions`. The active key still comes from Python.
  const active = (decision || 'HOLD') as DecisionView['key'];
  const base: DecisionView[] = [
    {
      key: 'CUT_LOSS',
      ar_title: '🛑 اقطع الخسارة فوراً',
      ar_when: 'شركة خاسرة + اتجاه هابط بلا قاع واضح',
      active: active === 'CUT_LOSS',
      applicable_reason: null,
      invalidation: null,
      level: null,
      level_price: null,
    },
    {
      key: 'AVERAGE_DOWN',
      ar_title: '🔄 برّد بحساب دقيق',
      ar_when: 'فقط لو ثبت قاع تجميعي مؤسسي فعلي',
      active: active === 'AVERAGE_DOWN',
      applicable_reason: null,
      invalidation: null,
      level: null,
      level_price: null,
    },
    {
      key: 'HOLD',
      ar_title: '⏳ اصبر',
      ar_when: 'عند دعم تاريخي + أساسيات ممتازة',
      active: active === 'HOLD',
      applicable_reason: null,
      invalidation: null,
      level: null,
      level_price: null,
    },
  ];
  return base;
}

// Default export for lazy-loading compat
export default BagHolderRescuePanel;

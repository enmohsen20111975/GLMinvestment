'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle, Activity, TrendingDown, Clock,
  HeartPulse, FileSearch, Lightbulb, Target, Loader2,
  ListChecks, ShieldAlert, Stethoscope,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'next/navigation';

// ─── Types (matching Python API response) ────────────────────────────

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
  loss_amount: number;
  loss_pct: number;
  invested_egp?: number;
  market_value_egp?: number;
  recovery_needed_pct?: number;
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
  error?: string;
}

// ─── Component ───────────────────────────────────────────────────────────

export default function RescuePage() {
  const searchParams = useSearchParams();
  const initialTicker = searchParams.get('ticker') || '';

  const [ticker, setTicker] = useState(initialTicker);
  const [entryPrice, setEntryPrice] = useState('');
  const [qty, setQty] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RescueResponse | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [fetchingPrice, setFetchingPrice] = useState(false);

  // Auto-fetch live price when ticker changes (or on mount from URL)
  const fetchLivePrice = useCallback(async (t: string) => {
    if (!t.trim()) { setLivePrice(null); return; }
    setFetchingPrice(true);
    try {
      const res = await fetch(`/api/stocks/${encodeURIComponent(t.trim())}/comprehensive`, { cache: 'no-store' });
      const json = await res.json();
      const price = Number(json?.stock?.current_price ?? json?.stats?.lastClose ?? json?.price?.current_price ?? 0);
      setLivePrice(price > 0 ? price : null);
    } catch {
      setLivePrice(null);
    } finally {
      setFetchingPrice(false);
    }
  }, []);

  useEffect(() => {
    if (initialTicker) {
      setTicker(initialTicker);
      fetchLivePrice(initialTicker);
    }
  }, [initialTicker, fetchLivePrice]);

  const handleTickerChange = (val: string) => {
    setTicker(val.toUpperCase());
    if (val.trim().length >= 2) {
      fetchLivePrice(val);
    }
  };

  const handleDiagnose = useCallback(async () => {
    if (!ticker.trim()) { toast.error('أدخل رمز السهم'); return; }
    if (!entryPrice || Number(entryPrice) <= 0) { toast.error('أدخل سعر الشراء الأصلي'); return; }
    if (!qty || Number(qty) <= 0) { toast.error('أدخل الكمية المملوكة'); return; }

    setLoading(true);
    setResult(null);

    try {
      // ALPHA-V2: Direct call to /api/rescue/analyze (Python brain — Rule 20 & 27)
      const params = new URLSearchParams({
        ticker: ticker.trim().toUpperCase(),
        buy_price: entryPrice,
        quantity: qty,
      });
      const res = await fetch(`/api/rescue/analyze?${params.toString()}`, { cache: 'no-store' });
      const json: RescueResponse = await res.json();

      if (json.success) {
        setResult(json);
        // Update live price from the API response
        if (json.current_price != null && json.current_price > 0) setLivePrice(json.current_price);
      } else {
        toast.error(json.message || json.error || 'فشل التشخيص');
      }
    } catch {
      toast.error('فشل الاتصال بمحرك التحليل — حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  }, [ticker, entryPrice, qty]);

  // ── Numeric consistency guard (client-side) ────────────────────────
  // نسبة الخسارة = (سعر الشراء – السعر الحالي) / سعر الشراء
  const clientLossPct = useMemo(() => {
    if (!result || result.current_price == null || !result.buy_price) return null;
    return ((result.current_price - result.buy_price) / result.buy_price) * 100;
  }, [result]);

  const numericMismatch =
    result !== null
    && clientLossPct !== null
    && result.loss_pct != null
    && Math.abs(clientLossPct - result.loss_pct) > 0.5;

  const isConflict = !!(result?.data_conflict || numericMismatch);
  const conflictReasons = useMemo(() => {
    if (!result) return [] as string[];
    const reasons = [...(result.conflict_reasons || [])];
    if (numericMismatch) {
      reasons.push(
        'تعارض داخلي: نسبة الخسارة المحسوبة من سعر الشراء والسعر الحالي '
        + `(${clientLossPct?.toFixed(2)}%) لا تطابق النسبة المعلنة (${result.loss_pct.toFixed(2)}%).`
      );
    }
    return reasons;
  }, [result, numericMismatch, clientLossPct]);

  // Verdict config
  const verdictConfig = result && result.decision ? (() => {
    const v = result.decision;
    if (v === 'CUT_LOSS') return {
      label: result.decision_ar || 'الوضع الحالي ضعيف — يُفضَّل التخفيض أو الخروج',
      icon: TrendingDown,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-950/30',
      border: 'border-red-300 dark:border-red-800',
      badge: 'bg-red-600 text-white',
      badgeLabel: 'خروج / تخفيض',
    };
    if (v === 'AVERAGE_DOWN') return {
      label: result.decision_ar || 'الوضع ضعيف لكن قابل للإدارة — يُفضَّل تخفيض جزئي (40-60%)',
      icon: Activity,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/30',
      border: 'border-blue-300 dark:border-blue-800',
      badge: 'bg-blue-600 text-white',
      badgeLabel: 'تخفيض جزئي',
    };
    return {
      label: result.decision_ar || 'الوضع تحت السيطرة — انتظار ومراقبة',
      icon: Clock,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      border: 'border-emerald-300 dark:border-emerald-800',
      badge: 'bg-emerald-600 text-white',
      badgeLabel: 'انتظار ومراقبة',
    };
  })() : null;

  // Trend badge color
  const trendBadgeStyle = (trend: string) => {
    if (trend.includes('كسر دعم') || trend.includes('هابط واضح')) {
      return 'border-red-300 text-red-600 dark:text-red-400';
    }
    if (trend.includes('تصحيح حاد') || trend.includes('هبوط عميق')) {
      return 'border-amber-300 text-amber-600 dark:text-amber-400';
    }
    return 'border-emerald-300 text-emerald-600 dark:text-emerald-400';
  };

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-black flex items-center justify-center gap-2">
            🚑 عيادة إنقاذ الصفقات المتعثرة
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            تشخيص موضوعي للمراكز الخاسرة — أسباب التعثر، قوة الأدلة، وخيارات الخروج أو التعافي بأرقام متسقة
          </p>
        </div>

        {/* Input Card */}
        <Card className="border-2 border-primary/20">
          <CardContent className="p-4 md:p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">رمز السهم</Label>
                <Input
                  value={ticker}
                  onChange={(e) => handleTickerChange(e.target.value)}
                  placeholder="مثال: COMI"
                  className="h-10 font-mono"
                  dir="ltr"
                />
                {fetchingPrice && <span className="text-[10px] text-muted-foreground">جاري جلب السعر...</span>}
                {livePrice !== null && !fetchingPrice && (
                  <span className="text-[10px] text-muted-foreground">
                    السعر الحالي: <span className="font-mono font-bold text-primary">{livePrice.toFixed(2)} ج.م</span>
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">سعر الشراء الأصلي (ج.م)</Label>
                <Input
                  type="number"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  placeholder="مثال: 25.50"
                  className="h-10 font-mono"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">الكمية المملوكة</Label>
                <Input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="مثال: 1000"
                  className="h-10 font-mono"
                  dir="ltr"
                />
              </div>
            </div>
            <Button
              onClick={handleDiagnose}
              disabled={loading}
              className="w-full h-11 text-sm font-bold gap-2"
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

        {/* Results */}
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        )}

        {result && !loading && isConflict && (
          /* ── تعارض البيانات — التوصية متوقفة ─────────────────── */
          <Card className="border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="p-4 md:p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-lg font-black text-amber-700 dark:text-amber-400">
                    تعارض في البيانات — التوصية متوقفة
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {result.message || 'لا يمكن إصدار توصية موثوقة قبل حل التعارض.'}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                {conflictReasons.map((r, i) => (
                  <p key={i} className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed flex gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{r}</span>
                  </p>
                ))}
              </div>

              {result.price_candidates && result.price_candidates.length > 1 && (
                <div className="p-3 rounded-lg bg-background/60 border border-amber-200 dark:border-amber-800">
                  <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mb-1.5">
                    أسعار مرشحة من المصادر:
                  </p>
                  <div className="space-y-1">
                    {result.price_candidates.map((c, i) => (
                      <div key={i} className="flex justify-between text-[11px] font-mono">
                        <span className="text-muted-foreground">{c.source}</span>
                        <span className="font-bold">
                          {c.price.toFixed(2)} ج.م
                          {c.timestamp ? <span className="text-muted-foreground font-sans"> — {c.timestamp}</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground leading-relaxed">
                أعد المحاولة لاحقاً بعد تحديث البيانات، أو تحقق من السعر يدوياً من مصدر موثوق قبل اتخاذ أي قرار.
              </p>
            </CardContent>
          </Card>
        )}

        {result && verdictConfig && !loading && !isConflict && (
          <div className="space-y-4">
            {/* Verdict Banner */}
            <Card className={cn('border-2', verdictConfig.border, verdictConfig.bg)}>
              <CardContent className="p-4 md:p-5">
                <div className="flex items-center gap-4">
                  <div className={cn('w-12 h-12 rounded-full flex items-center justify-center shrink-0', verdictConfig.badge)}>
                    <verdictConfig.icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={cn('text-lg md:text-xl font-black', verdictConfig.color)}>
                        {verdictConfig.label}
                      </p>
                      <Badge className={cn('text-[10px]', verdictConfig.badge)}>
                        {verdictConfig.badgeLabel}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {result.action_plan?.recommended_action}
                    </p>
                  </div>
                </div>
                {result.verdict_badge === 'danger' && result.market_value_egp != null && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>قيمة المركز الحالية لو خرجت الآن:</span>
                    <span className="font-mono font-bold text-foreground">
                      {result.market_value_egp.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Diagnosis — التشخيص */}
            {result.diagnosis && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <ListChecks className="w-4 h-4 text-primary" />
                    التشخيص — السبب قبل الحكم
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={cn('text-[10px]', trendBadgeStyle(result.diagnosis.trend_status))}>
                      {result.diagnosis.trend_status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      السيولة: {result.diagnosis.selling_pressure}
                    </Badge>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed">
                    {result.diagnosis.summary}
                  </p>
                  <div className="space-y-2 pt-1 border-t border-border/30">
                    {result.diagnosis.questions.map((qa, i) => (
                      <div key={i} className="space-y-0.5">
                        <p className="text-[11px] font-bold text-foreground">{qa.question}</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{qa.answer}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Trade Analysis + Asset Health */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Trade Analysis */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <FileSearch className="w-4 h-4 text-primary" />
                    تحليل الصفقة
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">نسبة الخسارة</span>
                    <span className={cn('font-bold font-mono', result.loss_pct < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                      {result.loss_pct < 0 ? '' : '+'}{Math.abs(result.loss_pct).toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">قيمة الخسارة</span>
                    <span className={cn('font-bold font-mono', result.loss_pct < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                      {Math.abs(result.loss_amount).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">سعر الشراء</span>
                    <span className="font-mono font-semibold">{result.buy_price?.toFixed(2) ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">السعر الحالي</span>
                    <span className="font-mono font-semibold">{result.current_price != null ? result.current_price.toFixed(2) : '—'}</span>
                  </div>
                  {result.recovery_needed_pct != null && result.recovery_needed_pct > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">التعادل يحتاج ارتداداً</span>
                      <span className="font-mono font-semibold">{result.recovery_needed_pct.toFixed(1)}%</span>
                    </div>
                  )}
                  {result.price_source && (
                    <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                      مصدر السعر: {result.price_source}
                      {result.price_timestamp ? ` — آخر تحديث ${result.price_timestamp}` : ''}
                    </p>
                  )}
                  <div className="pt-1 space-y-1">
                    {result.autopsy?.bought_near_peak && (
                      <Badge variant="outline" className="text-[9px] border-red-300 text-red-600 mr-1">شراء في قمة</Badge>
                    )}
                    {result.autopsy?.trend_status && (
                      <Badge variant="outline" className={cn('text-[9px] mr-1', trendBadgeStyle(result.autopsy.trend_status))}>
                        {result.autopsy.trend_status}
                      </Badge>
                    )}
                    {result.autopsy?.ignored_stop_loss && (
                      <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-600 mr-1">تجاهل الوقف</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">{result.autopsy?.summary}</p>
                </CardContent>
              </Card>

              {/* Asset Health */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <HeartPulse className="w-4 h-4 text-emerald-500" />
                    حيوية الأصل والسيولة
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">تدفق السيولة المؤسسية</span>
                    <span className="font-semibold">{result.asset_health?.institutional_flow ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ربحية الشركة</span>
                    <span className="font-semibold">
                      {result.asset_health?.is_profitable === true ? '✅ رابحة' : result.asset_health?.is_profitable === false ? '❌ خاسرة' : '—'}
                    </span>
                  </div>
                  {result.asset_health?.pe_ratio != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">مكرر الربحية (P/E)</span>
                      <span className="font-mono font-semibold">{result.asset_health.pe_ratio.toFixed(2)}</span>
                    </div>
                  )}
                  {(result.asset_health?.dividend_yield ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">عائد التوزيعات</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{(result.asset_health?.dividend_yield ?? 0).toFixed(2)}%</span>
                    </div>
                  )}
                  {result.asset_health?.support_level != null && result.asset_health.support_level > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">مستوى الدعم</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{result.asset_health.support_level.toFixed(2)}</span>
                    </div>
                  )}
                  {result.asset_health?.resistance_exit_level != null && result.asset_health.resistance_exit_level > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">مستوى الخروج (أقرب مقاومة)</span>
                      <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">{result.asset_health.resistance_exit_level.toFixed(2)}</span>
                    </div>
                  )}
                  {result.asset_health?.profitability_note && (
                    <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                      دليل الربحية: {result.asset_health.profitability_note}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Action Plan — خطة العمل والتعافي */}
            {result.action_plan && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-primary" />
                    خطة العمل والتعافي — خيارات مرتبة حسب قوة الأدلة
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {result.action_plan.options.map((opt) => (
                    <div
                      key={opt.key}
                      className={cn(
                        'p-3 rounded-lg border space-y-1.5',
                        opt.active
                          ? 'border-primary/50 bg-primary/5'
                          : opt.applicable
                            ? 'border-border bg-muted/20'
                            : 'border-border/40 bg-muted/10 opacity-60'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold">{opt.title}</span>
                        <div className="flex items-center gap-1">
                          {opt.active && (
                            <Badge className="text-[9px] bg-primary">الخيار الموصى به</Badge>
                          )}
                          {!opt.applicable && (
                            <Badge variant="outline" className="text-[9px]">غير ساري حالياً</Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground">السبب: </span>
                        {opt.reason}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground">يُلغى عند: </span>
                        {opt.invalidation}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground">مستوى تراجع القرار: </span>
                        {opt.level}
                      </p>
                    </div>
                  ))}

                  {/* التبريد الإضافي — بديل مشروط فقط */}
                  <div className={cn(
                    'p-3 rounded-lg border',
                    result.action_plan.average_down_allowed
                      ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20'
                      : 'border-border/40 bg-muted/10'
                  )}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Activity className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
                        {result.action_plan.average_down_allowed
                          ? 'تبريد إضافي مشروط — مش التوصية الرئيسية'
                          : 'حالة التبريد'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {result.action_plan.average_down_reason}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Lessons Learned */}
            {result.lessons_learned.length > 0 && (
              <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    الدروس المستفادة من هذه الحالة
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {result.lessons_learned.map((lesson, i) => (
                    <p key={i} className="text-xs text-muted-foreground leading-relaxed">{lesson}</p>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

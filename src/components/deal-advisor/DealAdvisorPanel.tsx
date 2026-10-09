'use client';

/**
 * DealAdvisorPanel.tsx — مستشار الصفقة (Trade Advisor / ملف السهم المتكلم)
 * ===================================================================
 * لوحة قرار للعميل عند اختيار سهم. تقرأ من /api/deal-advisor/[ticker]
 * (Node-side، بدون اعتماد على Python backend) وترجع تقرير بهيكل ثابت:
 *
 *   1. هوية السهم (identity)
 *   2. السوق والقطاع (market_context)
 *   3. الوضع الفني الآن (technical_state)
 *   4. تقييم سعر الدخول (entry_assessment) — إن وُجد entry_price
 *   5. أحداث جوهرية (events)
 *   6. سيناريوهات التصرف (action_scenarios) — الإلزامي
 *   7. مستويات مقترحة (suggested_levels)
 *   8. تحذير ثابت (disclaimer)
 *
 * READ-ONLY: لا يكتب على أي DB. لا يحفظ ملاحظات العميل.
 * Prefill: يقبل ticker + entryPrice + entryQty من store (لو فُتح من المحفظة/المتابعة).
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Shield,
  AlertTriangle,
  Info,
  Wallet,
  Sparkles,
  Scale,
  Newspaper,
  RefreshCw,
} from 'lucide-react';

// ============================================================================
// Types (تطابق ما يرجعه /api/deal-advisor/[ticker])
// ============================================================================

interface DealAdvisorData {
  success: boolean;
  ticker: string;
  generated_at: string;
  data_quality: 'complete' | 'partial' | 'minimal';
  persona: 'gambler' | 'balanced' | 'investor';
  identity: {
    ticker: string;
    name: string;
    name_ar: string | null;
    sector: string | null;
    market: string | null;
    classification: 'clean' | 'momentum' | 'high_risk' | 'unknown';
    classification_reason_ar: string;
    is_egx30: boolean;
    is_egx70: boolean;
    is_suspended: boolean;
  };
  market_context: {
    trend: 'up' | 'down' | 'flat' | 'unknown';
    trend_ar: string;
    sector_perform_ar: string | null;
    market_regime_ar: string;
    is_market_open: boolean;
  };
  technical_state: {
    trend: 'bullish' | 'bearish' | 'neutral' | 'unknown';
    trend_ar: string;
    rsi: number | null;
    rsi_state_ar: string;
    above_ma50: boolean | null;
    above_ma200: boolean | null;
    near_support: boolean;
    near_resistance: boolean;
    distance_to_support_pct: number | null;
    distance_to_resistance_pct: number | null;
    extension_from_ma50_pct: number | null;
    volume_vs_avg: number | null;
    volume_state_ar: string;
    volatility_note_ar: string;
  };
  entry_assessment: {
    entry_price: number | null;
    current_price: number;
    assessment: 'cheap' | 'fair' | 'expensive' | 'unknown';
    assessment_reason_ar: string;
    pnl_pct: number | null;
    pnl_value: number | null;
    pnl_state_ar: string | null;
    days_held: number | null;
  } | null;
  events: {
    dividend_yield: number | null;
    dps_ttm: number | null;
    ex_dividend_date: string | null;
    has_corporate_action: boolean;
    events_ar: string[];
  };
  action_scenarios: {
    scenarios: Array<{
      name: string;
      name_ar: string;
      trigger: string;
      trigger_ar: string;
      action: 'hold_conditional' | 'reduce' | 'take_profit' | 'exit' | 'add';
      action_ar: string;
      priority: 'high' | 'medium' | 'low';
    }>;
    current_recommendation: {
      action: 'hold_conditional' | 'reduce' | 'take_profit' | 'exit' | 'add' | 'wait';
      action_ar: string;
      reason_ar: string;
    };
  };
  suggested_levels: {
    support: number | null;
    resistance: number | null;
    suggested_stop: number | null;
    stop_reason_ar: string | null;
    reevaluation_level: number | null;
    near_target: number | null;
    rr_ratio: number | null;
    rr_state_ar: string | null;
  };
  disclaimer: {
    text_ar: string;
    is_automated: boolean;
    not_guaranteed: boolean;
    client_responsibility: boolean;
  };
  data_sources: string[];
  data_missing: string[];
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function formatPrice(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number | null): string {
  if (n === null || n === undefined) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + (n ?? 0).toFixed(2) + '%';
}

function classificationBadge(c: string) {
  switch (c) {
    case 'clean':
      return { variant: 'default' as const, label: 'أنظف نسبياً', className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' };
    case 'momentum':
      return { variant: 'default' as const, label: 'زخم', className: 'bg-amber-100 text-amber-800 hover:bg-amber-100' };
    case 'high_risk':
      return { variant: 'default' as const, label: 'عالي المخاطر', className: 'bg-red-100 text-red-800 hover:bg-red-100' };
    default:
      return { variant: 'secondary' as const, label: 'غير محدد', className: '' };
  }
}

function actionColor(action: string): string {
  switch (action) {
    case 'exit':
      return 'text-red-600 font-bold';
    case 'reduce':
      return 'text-orange-600 font-semibold';
    case 'take_profit':
      return 'text-emerald-600 font-semibold';
    case 'hold_conditional':
      return 'text-teal-600 font-semibold';
    case 'add':
      return 'text-emerald-600 font-medium';
    case 'wait':
      return 'text-zinc-600 font-medium';
    default:
      return '';
  }
}

function priorityBadge(p: string) {
  switch (p) {
    case 'high':
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">عالية</Badge>;
    case 'medium':
      return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">متوسطة</Badge>;
    case 'low':
      return <Badge variant="outline" className="bg-zinc-50 text-zinc-700 border-zinc-200 text-xs">منخفضة</Badge>;
    default:
      return null;
  }
}

// ============================================================================
// Main Component
// ============================================================================

interface DealAdvisorPanelProps {
  ticker: string;
  /** Prefill من المحفظة/المتابعة */
  initialEntryPrice?: number | null;
  initialEntryQty?: number | null;
  /** Callback عند تحديث الـ entry (للـ parent لو يريد تمريرها لـ chart) */
  onEntryChange?: (price: number | null, qty: number | null) => void;
  /** Compact mode (للموبايل) */
  compact?: boolean;
}

export function DealAdvisorPanel({
  ticker,
  initialEntryPrice,
  initialEntryQty,
  onEntryChange,
  compact = false,
}: DealAdvisorPanelProps) {
  const [entryPrice, setEntryPrice] = useState<string>(
    initialEntryPrice ? String(initialEntryPrice) : ''
  );
  const [entryQty, setEntryQty] = useState<string>(
    initialEntryQty ? String(initialEntryQty) : ''
  );
  const [persona, setPersona] = useState<'gambler' | 'balanced' | 'investor'>('balanced');
  const [entryDate, setEntryDate] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const [data, setData] = useState<DealAdvisorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // تحديث الـ entry price/qty لو الـ props تغيرت (prefill من المحفظة)
  useEffect(() => {
    if (initialEntryPrice !== undefined && initialEntryPrice !== null) {
      setEntryPrice(String(initialEntryPrice));
    }
    if (initialEntryQty !== undefined && initialEntryQty !== null) {
      setEntryQty(String(initialEntryQty));
    }
  }, [initialEntryPrice, initialEntryQty]);

  const analyze = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (entryPrice) params.set('entry_price', entryPrice);
      if (entryQty) params.set('entry_qty', entryQty);
      if (entryDate) params.set('entry_date', entryDate);
      params.set('persona', persona);
      if (note.trim()) params.set('note', note.trim());

      const res = await fetch(`/api/deal-advisor/${encodeURIComponent(ticker)}?${params}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `فشل التحليل (HTTP ${res.status})`);
      }
      setData(json);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker, entryPrice, entryQty, entryDate, persona, note]);

  // إشعار الـ parent بتغير الـ entry
  useEffect(() => {
    if (onEntryChange) {
      const p = entryPrice ? parseFloat(entryPrice) : null;
      const q = entryQty ? parseFloat(entryQty) : null;
      onEntryChange(p, q);
    }
  }, [entryPrice, entryQty, onEntryChange]);

  // تحليل تلقائي عند تغير الـ ticker (لو فيه prefill)
  useEffect(() => {
    if (ticker && (initialEntryPrice || initialEntryQty)) {
      analyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const cls = classificationBadge(data?.identity.classification ?? 'unknown');

  return (
    <Card className="w-full border-2 border-primary/20 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
              <span>مستشار الصفقة</span>
              {ticker && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {ticker}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm mt-1">
              مساعد قرار — يحلل وضع السهم ويقترح سيناريوهات تصرف
            </CardDescription>
          </div>
          {data && (
            <Badge className={cls.className} variant={cls.variant}>
              {cls.label}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* إدخال بيانات الصفقة (اختياري) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <div className="space-y-1">
            <Label htmlFor="da-entry-price" className="text-xs text-muted-foreground">
              سعر الدخول (اختياري)
            </Label>
            <Input
              id="da-entry-price"
              type="number"
              step="0.01"
              placeholder="مثال: 130"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              className="text-sm h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="da-entry-qty" className="text-xs text-muted-foreground">
              الكمية (اختياري)
            </Label>
            <Input
              id="da-entry-qty"
              type="number"
              step="1"
              placeholder="مثال: 100"
              value={entryQty}
              onChange={(e) => setEntryQty(e.target.value)}
              className="text-sm h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="da-entry-date" className="text-xs text-muted-foreground">
              تاريخ الدخول
            </Label>
            <Input
              id="da-entry-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="text-sm h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="da-persona" className="text-xs text-muted-foreground">
              الهدف
            </Label>
            <Select value={persona} onValueChange={(v) => setPersona(v as 'gambler' | 'balanced' | 'investor')}>
              <SelectTrigger id="da-persona" className="text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">متوازن</SelectItem>
                <SelectItem value="gambler">مضاربة</SelectItem>
                <SelectItem value="investor">استثمار</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={analyze} disabled={loading || !ticker} className="flex-1 h-10" size="sm">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
                جاري التحليل...
              </>
            ) : (
              <>
                <Activity className="h-4 w-4 ml-2" />
                حلّل وضعي
              </>
            )}
          </Button>
          {data && (
            <Button
              onClick={analyze}
              disabled={loading}
              variant="outline"
              size="sm"
              className="h-10"
              title="تحديث"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* خطأ */}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>تعذر التحليل</AlertTitle>
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {/* التقرير */}
        {data && !error && (
          <div className="space-y-4">
            {/* التوقع الحالي (أبرز جزء) */}
            <Alert
              className={
                data.action_scenarios.current_recommendation.action === 'exit'
                  ? 'border-red-300 bg-red-50'
                  : data.action_scenarios.current_recommendation.action === 'take_profit'
                    ? 'border-emerald-300 bg-emerald-50'
                    : data.action_scenarios.current_recommendation.action === 'reduce'
                      ? 'border-orange-300 bg-orange-50'
                      : 'border-teal-300 bg-blue-50'
              }
            >
              <Target className="h-4 w-4" />
              <AlertTitle className="text-base">
                التوقع الحالي:{' '}
                <span className={actionColor(data.action_scenarios.current_recommendation.action)}>
                  {data.action_scenarios.current_recommendation.action_ar}
                </span>
              </AlertTitle>
              <AlertDescription className="text-sm mt-1">
                {data.action_scenarios.current_recommendation.reason_ar}
              </AlertDescription>
            </Alert>

            {/* 1. هوية السهم */}
            <section>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold mb-2 text-muted-foreground">
                <Info className="h-4 w-4" />
                هوية السهم
              </h4>
              <div className="text-sm space-y-1 bg-muted/30 rounded-md p-3">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">الاسم:</span>
                  <span className="font-medium text-left">
                    {data.identity.name_ar || data.identity.name}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">القطاع:</span>
                  <span className="font-medium">{data.identity.sector || '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">السوق:</span>
                  <span className="font-medium">{data.identity.market || '—'}</span>
                </div>
                <div className="flex justify-between gap-2 flex-wrap">
                  <span className="text-muted-foreground">التصنيف:</span>
                  <span className="text-xs text-muted-foreground text-left max-w-[60%]">
                    {data.identity.classification_reason_ar}
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap pt-1">
                  {data.identity.is_egx30 && (
                    <Badge variant="outline" className="text-xs">EGX30</Badge>
                  )}
                  {data.identity.is_egx70 && (
                    <Badge variant="outline" className="text-xs">EGX70</Badge>
                  )}
                  {data.identity.is_suspended && (
                    <Badge variant="destructive" className="text-xs">موقوف</Badge>
                  )}
                </div>
              </div>
            </section>

            {/* 2. السوق والقطاع */}
            <section>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold mb-2 text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                السوق والقطاع
              </h4>
              <div className="text-sm space-y-1 bg-muted/30 rounded-md p-3">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">اتجاه السوق:</span>
                  <span className="font-medium">{data.market_context.trend_ar}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">النظام:</span>
                  <span className="font-medium">{data.market_context.market_regime_ar}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">حالة السوق:</span>
                  <span className="font-medium">
                    {data.market_context.is_market_open ? '🟢 مفتوح' : '🔴 مغلق'}
                  </span>
                </div>
              </div>
            </section>

            {/* 3. الوضع الفني الآن */}
            <section>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold mb-2 text-muted-foreground">
                <Activity className="h-4 w-4" />
                الوضع الفني الآن
              </h4>
              <div className="text-sm space-y-2 bg-muted/30 rounded-md p-3">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">الاتجاه:</span>
                  <span className="font-medium">{data.technical_state.trend_ar}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">RSI:</span>
                  <span className="font-medium">
                    {data.technical_state.rsi !== null
                      ? (data.technical_state.rsi ?? 0).toFixed(1)
                      : '—'}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({data.technical_state.rsi_state_ar})
                    </span>
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">فوق MA50:</span>
                  <span className="font-medium">
                    {data.technical_state.above_ma50 === null
                      ? '—'
                      : data.technical_state.above_ma50
                        ? 'نعم ✓'
                        : 'لا ✗'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">فوق MA200:</span>
                  <span className="font-medium">
                    {data.technical_state.above_ma200 === null
                      ? '—'
                      : data.technical_state.above_ma200
                        ? 'نعم ✓'
                        : 'لا ✗'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">قرب دعم:</span>
                  <span className="font-medium">
                    {data.technical_state.near_support ? 'نعم' : 'لا'}
                    {data.technical_state.distance_to_support_pct !== null && (
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        ({formatPct(-data.technical_state.distance_to_support_pct)})
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">قرب مقاومة:</span>
                  <span className="font-medium">
                    {data.technical_state.near_resistance ? 'نعم' : 'لا'}
                    {data.technical_state.distance_to_resistance_pct !== null && (
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        ({formatPct(data.technical_state.distance_to_resistance_pct)})
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">الحجم:</span>
                  <span className="text-xs text-muted-foreground text-left max-w-[60%]">
                    {data.technical_state.volume_state_ar}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">التذبذب:</span>
                  <span className="text-xs text-muted-foreground text-left max-w-[60%]">
                    {data.technical_state.volatility_note_ar}
                  </span>
                </div>
              </div>
            </section>

            {/* 4. تقييم سعر الدخول (إن وُجد) */}
            {data.entry_assessment && (
              <section>
                <h4 className="flex items-center gap-1.5 text-sm font-semibold mb-2 text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  تقييم سعر الدخول
                </h4>
                <div className="text-sm space-y-2 bg-muted/30 rounded-md p-3">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">سعر الدخول:</span>
                    <span className="font-medium">{formatPrice(data.entry_assessment.entry_price)} ج.م</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">السعر الحالي:</span>
                    <span className="font-medium">{formatPrice(data.entry_assessment.current_price)} ج.م</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">الربح/الخسارة:</span>
                    <span
                      className={
                        (data.entry_assessment.pnl_pct ?? 0) >= 0
                          ? 'font-bold text-emerald-600'
                          : 'font-bold text-red-600'
                      }
                    >
                      {formatPct(data.entry_assessment.pnl_pct)}
                      {data.entry_assessment.pnl_value !== null && (
                        <span className="text-xs text-muted-foreground">
                          {' '}
                          ({formatPrice(data.entry_assessment.pnl_value)} ج.م)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">التقييم:</span>
                    <span className="font-medium">{data.entry_assessment.assessment_reason_ar}</span>
                  </div>
                  {data.entry_assessment.pnl_state_ar && (
                    <div className="text-xs text-muted-foreground pt-1 border-t">
                      {data.entry_assessment.pnl_state_ar}
                    </div>
                  )}
                  {data.entry_assessment.days_held !== null && (
                    <div className="text-xs text-muted-foreground">
                      مدة الحيازة: {data.entry_assessment.days_held} يوم
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* 5. أحداث جوهرية */}
            <section>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold mb-2 text-muted-foreground">
                <Newspaper className="h-4 w-4" />
                أحداث جوهرية
              </h4>
              <div className="text-sm bg-muted/30 rounded-md p-3">
                {data.events.events_ar.length > 0 ? (
                  <ul className="space-y-1">
                    {data.events.events_ar.map((ev, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-muted-foreground text-xs mt-0.5">•</span>
                        <span className="text-xs">{ev}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    لا يوجد حدث مؤكد في المصادر المتاحة
                  </span>
                )}
                {data.events.dividend_yield !== null && data.events.dividend_yield > 0 && (
                  <div className="text-xs text-muted-foreground pt-2 mt-2 border-t">
                    توزيعات: {(data.events.dividend_yield ?? 0).toFixed(2)}% سنوياً
                  </div>
                )}
              </div>
            </section>

            {/* 6. سيناريوهات التصرف — الإلزامي */}
            <section>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold mb-2 text-muted-foreground">
                <Scale className="h-4 w-4" />
                سيناريوهات التصرف
                <Badge variant="secondary" className="text-xs ml-1">إلزامي</Badge>
              </h4>
              <div className="space-y-2">
                {data.action_scenarios.scenarios.length === 0 ? (
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-3">
                    لا توجد سيناريوهات متاحة — البيانات غير كافية
                  </div>
                ) : (
                  data.action_scenarios.scenarios.map((sc, i) => (
                    <div
                      key={i}
                      className="border rounded-md p-2.5 text-sm bg-muted/20 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="font-semibold text-sm">{sc.name_ar}</span>
                        {priorityBadge(sc.priority)}
                      </div>
                      <div className="text-xs text-muted-foreground mb-1">{sc.trigger_ar}</div>
                      <div className={'text-xs ' + actionColor(sc.action)}>
                        ← {sc.action_ar}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* 7. مستويات مقترحة */}
            <section>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold mb-2 text-muted-foreground">
                <Shield className="h-4 w-4" />
                مستويات مقترحة
              </h4>
              <div className="text-sm space-y-2 bg-muted/30 rounded-md p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">الدعم</div>
                    <div className="font-medium text-emerald-700">
                      {formatPrice(data.suggested_levels.support)} ج.م
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">المقاومة</div>
                    <div className="font-medium text-red-700">
                      {formatPrice(data.suggested_levels.resistance)} ج.م
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">وقف مقترح</div>
                    <div className="font-medium text-red-700">
                      {formatPrice(data.suggested_levels.suggested_stop)} ج.م
                    </div>
                    {data.suggested_levels.stop_reason_ar && (
                      <div className="text-xs text-muted-foreground">
                        {data.suggested_levels.stop_reason_ar}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">هدف قريب</div>
                    <div className="font-medium text-emerald-700">
                      {formatPrice(data.suggested_levels.near_target)} ج.م
                    </div>
                  </div>
                </div>
                {data.suggested_levels.rr_ratio !== null && (
                  <div className="pt-2 border-t">
                    <div className="flex justify-between gap-2">
                      <span className="text-xs text-muted-foreground">نسبة المخاطرة/المكافأة:</span>
                      <span className="text-xs font-medium">
                        {(data.suggested_levels.rr_ratio ?? 0).toFixed(2)} : 1
                      </span>
                    </div>
                    {data.suggested_levels.rr_state_ar && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {data.suggested_levels.rr_state_ar}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* 8. تحذير ثابت */}
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {data.disclaimer.text_ar}
              </AlertDescription>
            </Alert>

            {/* مصادر البيانات (للشفافية) */}
            {!compact && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  مصادر البيانات ({data.data_sources.length})
                </summary>
                <div className="mt-2 space-y-1">
                  <div className="flex flex-wrap gap-1">
                    {data.data_sources.map((s, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  {data.data_missing.length > 0 && (
                    <div className="mt-2">
                      <span className="text-amber-600">بيانات ناقصة:</span>{' '}
                      {data.data_missing.join('، ')}
                    </div>
                  )}
                  <div className="mt-1 text-muted-foreground">
                    جودة البيانات: <strong>{data.data_quality}</strong> · آخر تحديث:{' '}
                    {new Date(data.generated_at).toLocaleString('ar-EG')}
                  </div>
                </div>
              </details>
            )}
          </div>
        )}

        {/* حالة فارغة (قبل التحليل) */}
        {!data && !loading && !error && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <Activity className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>أدخل سعر الدخول والكمية (اختياري) ثم اضغط «حلّل وضعي»</p>
            <p className="text-xs mt-1">
              يعمل بدون اتصال بالـ Python backend — يقرأ من قواعد البيانات المحلية
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

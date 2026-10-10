'use client';

/**
 * PricingEditorTab
 * ================
 * Task 28-B (Fix 5 — Fix Battalion):
 *   Admin view for pricing tiers + paywall gates status.
 *
 *   Shows:
 *     - Current pricing from src/lib/plans.ts (free=0 / normal=199 /
 *       premium=299 / developer=599 EGP) — read-only display (editing
 *       prices requires editing plans.ts + redeploy per Rule 20)
 *     - The 7 paywall gates status (enabled/disabled) — currently all
 *       enabled and hardcoded in the API routes:
 *         Gate 1: fair_value_locked         (/api/stocks/[ticker])
 *         Gate 2: EXIT_RADAR_LOCKED         (/api/maker-radar/exit-radar)
 *         Gate 3: details_locked            (/api/radar/accuracy)
 *         Gate 4: trades_locked             (/api/predictions/historical-trades)
 *         Gate 5: _paywall.is_premium       (/api/v2/chart/full-analysis)
 *         Gate 6: applyPaywallToResults     (predictions list blurring)
 *         Gate 7: applyPaywallToChartAnalysis (chart narrative truncation)
 *
 *   Was P0 missing (Task 27-B audit): plans.ts was hardcoded with NO
 *   admin UI to view prices, and the 7 backend gates had NO toggle
 *   status indicator.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DollarSign, RefreshCw, Lock, Unlock, CheckCircle2, XCircle,
  Tag, ShieldCheck, AlertTriangle, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { plans, getAllPlans, type PlanData } from '@/lib/plans';

/* ------------------------------------------------------------------ */
/*  The 7 paywall gates — mirrored from the codebase                  */
/* ------------------------------------------------------------------ */

interface PaywallGate {
  id: number;
  key: string;
  label_ar: string;
  description_ar: string;
  api_route: string;
  enabled: boolean;
  hardcode_location: string;
  lock_field: string;
  upgrade_url: string;
}

const PAYWALL_GATES: PaywallGate[] = [
  {
    id: 1,
    key: 'fair_value_locked',
    label_ar: 'القيمة العادلة',
    description_ar: 'يُخفي fair_value لغير المميزين ويضع fair_value_locked=true على stocks/[ticker] API.',
    api_route: '/api/stocks/[ticker]',
    enabled: true,
    hardcode_location: 'src/app/api/stocks/[ticker]/route.ts:98',
    lock_field: 'fair_value_locked',
    upgrade_url: '/pricing',
  },
  {
    id: 2,
    key: 'EXIT_RADAR_LOCKED',
    label_ar: 'رادار الخروج',
    description_ar: 'يُرجع 403 EXIT_RADAR_LOCKED لغير المميزين منتهي الفترة التجريبية على /api/maker-radar/exit-radar.',
    api_route: '/api/maker-radar/exit-radar',
    enabled: true,
    hardcode_location: 'src/app/api/maker-radar/exit-radar/route.ts:161',
    lock_field: 'error: EXIT_RADAR_LOCKED',
    upgrade_url: '/pricing',
  },
  {
    id: 3,
    key: 'details_locked',
    label_ar: 'تفاصيل الدقة',
    description_ar: 'يُرجع details_locked=true على /api/radar/accuracy لغير المميزين.',
    api_route: '/api/radar/accuracy',
    enabled: true,
    hardcode_location: 'src/app/api/radar/accuracy/route.ts:281',
    lock_field: 'details_locked',
    upgrade_url: '/pricing',
  },
  {
    id: 4,
    key: 'trades_locked',
    label_ar: 'التداولات التاريخية',
    description_ar: 'يُرجع trades_locked=true على /api/predictions/historical-trades لغير المميزين.',
    api_route: '/api/predictions/historical-trades',
    enabled: true,
    hardcode_location: 'src/app/api/predictions/historical-trades/route.ts:153',
    lock_field: 'trades_locked',
    upgrade_url: '/pricing',
  },
  {
    id: 5,
    key: 'chart_paywall_is_premium',
    label_ar: 'تحليل الرسم البياني',
    description_ar: 'يضع _paywall.is_premium على /api/v2/chart/full-analysis لغير المميزين.',
    api_route: '/api/v2/chart/full-analysis',
    enabled: true,
    hardcode_location: 'src/app/api/v2/chart/full-analysis/route.ts:188',
    lock_field: '_paywall.is_premium',
    upgrade_url: '/pricing',
  },
  {
    id: 6,
    key: 'applyPaywallToResults',
    label_ar: 'تعتيم قائمة التوقعات',
    description_ar: 'يُعتّم ticker و name_ar لغير الـ Top 3 في قائمة التوقعات لغير المميزين (تذوق فقط).',
    api_route: 'src/lib/paywall.ts',
    enabled: true,
    hardcode_location: 'src/lib/paywall.ts:99',
    lock_field: 'ticker=🔒, name_ar=🔒 اشترك لمعرفة السهم',
    upgrade_url: '/pricing',
  },
  {
    id: 7,
    key: 'applyPaywallToChartAnalysis',
    label_ar: 'قص الـ narrative',
    description_ar: 'يقص humanized_reason عند 30 حرف + يضيف "🔒" لغير المميزين في تحليل الرسم البياني.',
    api_route: 'src/lib/paywall.ts',
    enabled: true,
    hardcode_location: 'src/lib/paywall.ts:155+',
    lock_field: 'narrative truncated to 30 chars + 🔒',
    upgrade_url: '/pricing',
  },
];

export function PricingEditorTab() {
  const [plansList, setPlansList] = useState<PlanData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const defaultPlans = getAllPlans();
      // Fetch from /api/subscription/plans to update live local prices
      const res = await fetch('/api/subscription/plans', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.plans && Array.isArray(json.plans) && json.plans.length > 0) {
          const merged = defaultPlans.map(basePlan => {
            const apiMatch = json.plans.find((p: any) => p.tier === basePlan.id || p.tier === basePlan.name.toLowerCase());
            if (apiMatch) {
              return {
                ...basePlan,
                price: Number(apiMatch.price_local || apiMatch.price_egp || basePlan.price),
                currency: apiMatch.currency || basePlan.currency,
                features: (apiMatch.features && apiMatch.features.length > 0) ? apiMatch.features : basePlan.features,
              };
            }
            return basePlan;
          });
          setPlansList(merged);
          return;
        }
      }
      setPlansList(defaultPlans);
    } catch { // silent fallback (safe-by-design)
      setPlansList(getAllPlans());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const enabledGates = PAYWALL_GATES.filter(g => g.enabled).length;
  const totalGates = PAYWALL_GATES.length;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <Card className="border-emerald-200 dark:border-emerald-900/40">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                التسعير + بوابات الاشتراك
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                الباقات الحالية (من src/lib/plans.ts) + حالة بوابات الـ paywall السبع.
              </CardDescription>
            </div>
            <Button onClick={fetchPlans} disabled={loading} variant="ghost" size="sm" className="gap-2">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox
          label="عدد الباقات"
          value={plansList.length}
          icon={<Tag className="w-4 h-4 text-sky-500" />}
        />
        <StatBox
          label="أعلى سعر"
          value={plansList.length > 0
            ? `${Math.max(...plansList.map(p => p.price))} EGP`
            : '—'}
          icon={<DollarSign className="w-4 h-4 text-emerald-500" />}
        />
        <StatBox
          label="بوابات مفعّلة"
          value={`${enabledGates}/${totalGates}`}
          icon={<Lock className="w-4 h-4 text-amber-500" />}
        />
        <StatBox
          label="بوابات متوقفة"
          value={totalGates - enabledGates}
          icon={<Unlock className="w-4 h-4 text-emerald-500" />}
        />
      </div>

      {/* Loading */}
      {loading && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pricing plans */}
      {!loading && plansList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="w-4 h-4 text-emerald-500" />
              الباقات الحالية
            </CardTitle>
            <CardDescription className="text-xs">
              التسعير الحالي من <code dir="ltr" className="text-[10px]">src/lib/plans.ts</code>.
              لتعديل الأسعار: عدّل الملف ثم أعد deployment (Rule 20 — Python=Brain، لكن الأسعار تكتب في TS).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {plansList.map((plan) => (
                <div
                  key={plan.id}
                  className={cn(
                    'p-4 rounded-lg border-2',
                    plan.id === 'premium'
                      ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/50'
                      : plan.id === 'developer'
                        ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/20 dark:border-sky-900/50'
                        : 'border-border bg-card',
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold">{plan.nameAr}</h3>
                    {plan.id === 'premium' && (
                      <Badge className="bg-emerald-600 text-[10px]">الأكثر شيوعاً</Badge>
                    )}
                    {plan.id === 'free' && (
                      <Badge variant="outline" className="text-[10px]">مجاني</Badge>
                    )}
                  </div>
                  <div className="mb-3">
                    <span className="text-2xl font-bold">{plan.price}</span>
                    <span className="text-sm text-muted-foreground mr-1">{plan.currency}</span>
                    <span className="text-xs text-muted-foreground block">شهرياً</span>
                    {plan.priceYearly > 0 && (
                      <span className="text-xs text-muted-foreground mt-1 block">
                        سنوياً: {plan.priceYearly} {plan.currency}
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1 text-xs">
                    {plan.features.slice(0, 5).map((f, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                    {plan.features.length > 5 && (
                      <li className="text-[10px] text-muted-foreground">
                        + {plan.features.length - 5} ميزة أخرى
                      </li>
                    )}
                  </ul>
                  <div className="mt-3 pt-3 border-t text-[10px] text-muted-foreground space-y-0.5">
                    <div>قائمة المراقبة: {plan.limits?.watchlist ?? '—'}</div>
                    <div>محفظة: {plan.limits?.portfolio ?? '—'}</div>
                    <div>API: {plan.limits?.apiAccess ? '✓' : '✗'}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Paywall gates */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-500" />
            بوابات الـ Paywall السبع
          </CardTitle>
          <CardDescription className="text-xs">
            البوابات السبع مفعّلة حالياً كلها (hardcoded في API routes). لإيقاف بوابة: علّق الكود في الموقع المحدد + أعد deployment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {PAYWALL_GATES.map((gate) => (
              <div
                key={gate.id}
                className={cn(
                  'p-3 rounded-lg border flex items-start gap-3',
                  gate.enabled
                    ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40'
                    : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/40',
                )}
              >
                <div className={cn(
                  'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
                  gate.enabled ? 'bg-amber-500' : 'bg-emerald-500',
                )}>
                  {gate.enabled
                    ? <Lock className="w-4 h-4 text-white" />
                    : <Unlock className="w-4 h-4 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">Gate {gate.id}</Badge>
                      <span className="font-bold text-sm">{gate.label_ar}</span>
                    </div>
                    <Badge
                      variant={gate.enabled ? 'default' : 'outline'}
                      className={cn(
                        'text-[10px]',
                        gate.enabled
                          ? 'bg-amber-600'
                          : 'border-emerald-500 text-emerald-700',
                      )}
                    >
                      {gate.enabled ? 'مفعّلة' : 'متوقفة'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">{gate.description_ar}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <code dir="ltr" className="bg-muted/50 px-1.5 py-0.5 rounded">{gate.api_route}</code>
                    <code dir="ltr" className="bg-muted/50 px-1.5 py-0.5 rounded">{gate.hardcode_location}</code>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    الحقل المقفل: <code dir="ltr">{gate.lock_field}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Info / constraints */}
      <Card className="border-sky-200 bg-sky-50 dark:bg-sky-950/20 dark:border-sky-900/40">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-sky-800 dark:text-sky-300 text-sm">
              قيود التعديل المباشر
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              الأسعار والبوابات مكتوبة في الكود (Rule 20 — Python=Brain، لكن الـ paywall gate
              flags في Node). لتعديلها بدون redeploy، تحتاج نقلها إلى جدول إعدادات في DB
              (مثلاً <code dir="ltr" className="text-[10px]">system_settings</code>) — مهمة مستقبلية.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helper                                       */
/* ------------------------------------------------------------------ */

function StatBox({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

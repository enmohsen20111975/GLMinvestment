'use client';

/**
 * PricingView — صفحة التسعير والباقات
 * ============================================================
 * بتتعرض لما المستخدم يفتح #pricing أو لما الـ trial ينتهي.
 *
 * - auto-detect للسوق من navigator.language
 * - تعرض الأسعار بعملة المستخدم المحلية
 * - comparison table (Premium vs Pro)
 * - زر "اشترك الآن" → /api/subscription/checkout
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Check, Loader2, Crown, Zap, Building2, Sparkles, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { InstapayModal } from './InstapayModal';

interface Plan {
  tier: string;
  name_ar: string;
  description: string;
  price_local: number;
  original_price_local?: number;
  discount_pct?: number;
  price_egp: number;
  currency: string;
  billing_cycle: string;
  features: string[];
  is_vip?: boolean;
}

interface PricingViewProps {
  /** هل ده modal overlay (trial expired) ولا صفحة عادية؟ */
  asModal?: boolean;
  /** السوق المختار (لو مش محدد، بيتـ auto-detected) */
  forcedMarket?: string;
  /** callback بعد نجاح الدفع */
  onCheckoutSuccess?: (iframeUrl: string) => void;
}

const MARKET_OPTIONS = [
  { value: 'egx', label: '🇪🇬 مصر (EGX)', currency: 'EGP' },
  { value: 'tadawul', label: '🇸🇦 السعودية (تداول)', currency: 'SAR' },
  { value: 'kse', label: '🇰🇼 الكويت (KSE)', currency: 'KWD' },
  { value: 'qse', label: '🇶🇦 قطر (QSE)', currency: 'QAR' },
  { value: 'us', label: '🇺🇸 أمريكا / عالمي (US)', currency: 'USD' },
  { value: 'crypto', label: '₿ كريبتو وذهب', currency: 'USD' },
  { value: 'all', label: '👑 الباقة الشاملة (كافة الأسواق VIP)', currency: 'USD' },
];

const TIER_ICONS: Record<string, React.ReactNode> = {
  premium: <Crown className="w-5 h-5 text-amber-500" />,
  pro: <Zap className="w-5 h-5 text-purple-500" />,
  vip_pass: <Crown className="w-5 h-5 text-amber-400 animate-bounce" />,
  b2b_starter: <Building2 className="w-5 h-5 text-sky-500" />,
  b2b_pro: <Building2 className="w-5 h-5 text-sky-600" />,
  b2b_enterprise: <Building2 className="w-5 h-5 text-emerald-600" />,
};

const TIER_ACCENT: Record<string, string> = {
  premium: 'border-amber-500/50 bg-gradient-to-br from-amber-500/5 to-orange-500/5 shadow-md shadow-amber-500/5',
  pro: 'border-purple-500/50 bg-gradient-to-br from-purple-500/5 to-fuchsia-500/5 shadow-md shadow-purple-500/5',
  vip_pass: 'border-amber-400/80 bg-gradient-to-br from-amber-500/15 via-yellow-500/10 to-orange-500/15 ring-2 ring-amber-400/60 shadow-xl shadow-amber-500/15',
  b2b_starter: 'border-sky-500/40 bg-gradient-to-br from-sky-500/5 to-primary/5',
  b2b_pro: 'border-sky-600/40 bg-gradient-to-br from-sky-600/5 to-emerald-500/5',
  b2b_enterprise: 'border-emerald-600/40 bg-gradient-to-br from-emerald-600/5 to-purple-600/5',
};

export function PricingView({ asModal = false, forcedMarket, onCheckoutSuccess }: PricingViewProps) {
  const [market, setMarket] = useState<string>(forcedMarket || 'egx');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [instapayPlan, setInstapayPlan] = useState<{
    tier: string;
    name_ar: string;
    price: number;
    currency: string;
    billingCycle: string;
    market: string;
  } | null>(null);

  // auto-detect السوق من navigator.language
  useEffect(() => {
    if (forcedMarket) {
      setMarket(forcedMarket);
      return;
    }
    try {
      const lang = navigator.language.toLowerCase();
      if (lang.startsWith('ar-sa')) setMarket('tadawul');
      else if (lang.startsWith('ar-kw')) setMarket('kse');
      else if (lang.startsWith('ar-qa')) setMarket('qse');
      else if (lang.startsWith('en-us')) setMarket('us');
      else setMarket('egx');
    } catch { // silent fallback (safe-by-design)
      setMarket('egx');
    }
  }, [forcedMarket]);

  // جلب الباقات من API
  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/subscription/plans?market=${market}`);
      const j = await res.json();
      if (j.success) {
        setPlans(j.plans || []);
      }
    } catch (err) {
      console.error('[pricing] fetch plans failed:', err);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  // checkout
  const handleCheckout = async (tier: string) => {
    setCheckoutLoading(tier);
    try {
      const res = await fetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, market, billingCycle }),
      });
      const j = await res.json();
      if (!j.success) {
        throw new Error(j.error || 'فشل بدء الدفع');
      }
      if (onCheckoutSuccess) {
        onCheckoutSuccess(j.iframeUrl);
      } else {
        window.location.href = j.iframeUrl;
      }
    } catch (err: any) {
      toast.error(err?.message || 'فشل الدفع');
    } finally {
      setCheckoutLoading(null);
    }
  };

  // فلترة الباقات حسب billing cycle
  const filteredPlans = plans.filter((p) => p.billing_cycle === billingCycle);

  const formatPrice = (price: number, currency: string) => {
    if (currency === 'EGP') return `${price} ج.م`;
    if (currency === 'SAR') return `${price} ريال`;
    if (currency === 'KWD') return `${price} د.ك`;
    if (currency === 'QAR') return `${price} ر.ق`;
    if (currency === 'USD') return `$${price}`;
    return `${price} ${currency}`;
  };

  const currentCurrency = MARKET_OPTIONS.find((m) => m.value === market)?.currency || 'EGP';

  return (
    <div className={cn('space-y-6 dark:bg-surface-container-lowest', asModal && 'p-6 max-w-5xl mx-auto')} dir="rtl">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium dark:bg-primary-container/10 dark:text-primary dark:border dark:border-primary/30">
          <Sparkles className="w-3.5 h-3.5" />
          باقات المنصة
        </div>
        <h2 className="text-2xl font-bold dark:text-on-surface dark:font-outfit">اختر الباقة المناسبة لك</h2>
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto dark:text-on-surface-variant">
          ابدأ بتجربة مجانية لمدة 7 أيام تشمل جميع مزايا Premium — بدون بطاقة ائتمان. بعد انتهائها، اختر الباقة المناسبة لك.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted-foreground dark:text-on-surface-variant" />
          <Select value={market} onValueChange={setMarket} disabled={!!forcedMarket}>
            <SelectTrigger className="w-[200px] dark:bg-surface-container dark:border-outline-variant dark:text-on-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="dark:bg-surface-container-high dark:border-outline-variant">
              {MARKET_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value} className="dark:text-on-surface dark:focus:bg-primary-container dark:focus:text-on-primary-container">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted dark:bg-surface-container-high dark:border dark:border-outline-variant/30">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              billingCycle === 'monthly' ? 'bg-background shadow-sm dark:bg-primary-container dark:text-on-primary-container' : 'text-muted-foreground dark:text-on-surface-variant',
            )}
          >
            شهري
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              billingCycle === 'yearly' ? 'bg-background shadow-sm dark:bg-primary-container dark:text-on-primary-container' : 'text-muted-foreground dark:text-on-surface-variant',
            )}
          >
            سنوي
            <Badge variant="secondary" className="ms-1 text-[10px] py-0 px-1.5 dark:bg-primary dark:text-on-primary">شهرين مجاناً</Badge>
          </button>
        </div>
      </div>

      {/* Plans grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardContent className="h-64" />
            </Card>
          ))}
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground dark:text-on-surface-variant">
          لا توجد باقات متاحة لهذا السوق حالياً. حاول مرة أخرى لاحقاً.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filteredPlans.map((plan) => {
            const isB2B = plan.tier.startsWith('b2b_');
            const popular = plan.tier === 'premium';
            return (
              <Card
                key={`${plan.tier}-${plan.billing_cycle}`}
                className={cn(
                  'relative flex flex-col dark:bg-surface-container-low dark:border dark:border-outline-variant/30',
                  TIER_ACCENT[plan.tier] || 'border-border',
                  popular && 'ring-2 ring-amber-500/50 dark:border-primary dark:bg-primary-container/10 dark:ring-1 dark:ring-primary/30',
                )}
              >
                {popular && !plan.is_vip && (
                  <Badge
                    variant="default"
                    className="absolute -top-2.5 right-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md text-xs py-0.5 dark:bg-primary dark:text-on-primary"
                  >
                    الأكثر شعبية ⭐
                  </Badge>
                )}
                {plan.is_vip && (
                  <Badge
                    variant="default"
                    className="absolute -top-2.5 right-4 bg-gradient-to-r from-amber-400 via-yellow-500 to-orange-500 text-black font-extrabold shadow-lg text-xs py-0.5 px-3 dark:bg-primary dark:text-on-primary"
                  >
                    👑 الباقة الشاملة VIP (توفير 65%)
                  </Badge>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    {TIER_ICONS[plan.tier]}
                    <CardTitle className="text-lg font-bold dark:text-on-surface dark:font-outfit">{plan.name_ar}</CardTitle>
                  </div>
                  <CardDescription className="text-xs dark:text-on-surface-variant">{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-4">
                  <div className="space-y-1.5">
                    {/* السعر الأصلي المشطوب ونسبة الخصم */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs line-through text-muted-foreground/80 font-medium tabular-nums dark:font-financial dark:text-on-surface-variant">
                        {formatPrice(plan.original_price_local || Math.round(plan.price_local * 2), plan.currency)}
                      </span>
                      <Badge variant="destructive" className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 dark:bg-error/15 dark:text-error dark:border-error/30 text-[10px] px-1.5 py-0 font-bold tabular-nums dark:font-financial">
                        وفر {plan.discount_pct || 50}% 🔥
                      </Badge>
                    </div>

                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-foreground tabular-nums dark:font-financial dark:text-primary">
                        {formatPrice(plan.price_local, plan.currency)}
                      </span>
                      <span className="text-xs text-muted-foreground dark:text-on-surface-variant">/ {plan.billing_cycle === 'monthly' ? 'شهر' : 'سنة'}</span>
                    </div>
                    {plan.currency !== 'EGP' && (
                      <p className="text-[11px] text-muted-foreground tabular-nums dark:font-financial dark:text-on-surface-variant">
                        (المعادل {plan.price_egp} ج.م وقت الدفع عبر Paymob)
                      </p>
                    )}
                  </div>

                  <ul className="space-y-2 flex-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-primary shrink-0 mt-0.5" />
                        <span className="text-muted-foreground dark:text-on-surface-variant">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="space-y-2 mt-auto">
                    <Button
                      onClick={() => handleCheckout(plan.tier)}
                      disabled={checkoutLoading === plan.tier}
                      className={cn(
                        'w-full gap-2 dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90 dark:border-primary',
                        popular && 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90',
                      )}
                      variant={popular ? 'default' : 'outline'}
                    >
                      {checkoutLoading === plan.tier ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Crown className="w-4 h-4" />
                      )}
                      {isB2B ? 'تواصل معنا' : 'الدفع بالبطاقة / كاش'}
                    </Button>

                    {!isB2B && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setInstapayPlan({
                            tier: plan.tier,
                            name_ar: plan.name_ar,
                            price: plan.price_local,
                            currency: plan.currency,
                            billingCycle: plan.billing_cycle,
                            market,
                          })
                        }
                        className="w-full gap-2 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 font-bold text-xs dark:border-primary/40 dark:text-primary dark:hover:bg-primary/10"
                      >
                        <span>⚡</span>
                        الدفع عبر إنستاباي (InstaPay)
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="text-center text-xs text-muted-foreground space-y-1 dark:bg-primary-container/10 dark:border dark:border-primary/30 dark:text-on-surface-variant dark:rounded-lg dark:p-4">
        <p>✓ تجربة مجانية لمدة 7 أيام بكل مزايا Premium — بدون بطاقة ائتمان</p>
        <p>✓ ادفع بالجنيه المصري عبر Paymob</p>
        <p>✓ ألغِ في أي وقت — بدون التزام</p>
        {currentCurrency !== 'EGP' && (
          <p className="text-[11px] opacity-75 dark:text-on-surface-variant">
            * السعر المعروض بعملتك المحلية ({currentCurrency}). الدفع يتم بالجنيه المصري بعد التحويل بسعر الصرف المعتمد.
          </p>
        )}
      </div>

      {instapayPlan && (
        <InstapayModal
          open={!!instapayPlan}
          onOpenChange={(open) => !open && setInstapayPlan(null)}
          plan={instapayPlan}
        />
      )}
    </div>
  );
}

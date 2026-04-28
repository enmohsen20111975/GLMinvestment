'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import {
  Check,
  X,
  Crown,
  Sparkles,
  Star,
  Loader2,
  Zap,
  Brain,
  TrendingUp,
  Eye,
  BarChart3,
  Bell,
  Headphones,
  Rocket,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/lib/store';

// ==================== TYPES ====================

interface PlanFeature {
  max_watchlist: number;
  max_portfolio: number;
  max_alerts: number;
  ai_analysis: boolean;
  deep_analysis: boolean;
  priority_support: boolean;
}

interface Plan {
  id: string;
  name: string;
  name_ar: string;
  price: number;
  price_yearly: number | null;
  trial_days: number;
  features: string[];
  plan?: PlanFeature;
}

interface CurrentSubscription {
  id: string;
  plan_name: string;
  plan_name_ar: string;
  status: string;
  expires_at: string | null;
  is_in_trial: boolean;
  trial_ends_at: string | null;
}

// ==================== ICONS MAP ====================

const featureIcons: Record<string, React.ReactNode> = {
  'الذكاء الاصطناعي': <Brain className="w-4 h-4" />,
  'تحليل شامل': <BarChart3 className="w-4 h-4" />,
  'قائمة المراقبة': <Eye className="w-4 h-4" />,
  'المحافظ': <BarChart3 className="w-4 h-4" />,
  'تنبيهات': <Bell className="w-4 h-4" />,
  'تقارير': <TrendingUp className="w-4 h-4" />,
  'دعم': <Headphones className="w-4 h-4" />,
  'مبكر': <Rocket className="w-4 h-4" />,
};

function getFeatureIcon(feature: string): React.ReactNode {
  for (const [key, icon] of Object.entries(featureIcons)) {
    if (feature.includes(key)) return icon;
  }
  return <Check className="w-4 h-4" />;
}

// ==================== COMPONENT ====================

export function SubscriptionView() {
  const { data: session } = useSession();
  const { user, setCurrentView } = useAppStore();
  const isLoggedIn = !!user || session?.status === 'authenticated';

  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentSub, setCurrentSub] = useState<CurrentSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');

  // Fetch plans
  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch('/api/subscription/plans');
        const data = await res.json();
        if (data.success) {
          setPlans(data.plans);
        }
      } catch {
        toast.error('فشل في جلب الباقات');
      } finally {
        setLoading(false);
      }
    }
    fetchPlans();
  }, []);

  // Fetch current subscription
  useEffect(() => {
    if (!isLoggedIn) return;
    async function fetchCurrent() {
      try {
        const res = await fetch('/api/subscription/current');
        const data = await res.json();
        if (data.success && data.subscription) {
          setCurrentSub(data.subscription);
        }
      } catch {
        // Silent fail
      }
    }
    fetchCurrent();
  }, [isLoggedIn]);

  // Start trial
  const handleStartTrial = async () => {
    if (!isLoggedIn) {
      setCurrentView('auth');
      return;
    }
    setActionLoading('trial');
    try {
      const res = await fetch('/api/subscription/start-trial', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        // Refresh subscription
        const subRes = await fetch('/api/subscription/current');
        const subData = await subRes.json();
        if (subData.success && subData.subscription) {
          setCurrentSub(subData.subscription);
        }
      } else {
        toast.error(data.error || 'فشل في تفعيل الفترة التجريبية');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setActionLoading(null);
    }
  };

  // Upgrade
  const handleUpgrade = async (plan: Plan) => {
    if (!isLoggedIn) {
      setCurrentView('auth');
      return;
    }
    setSelectedPlan(plan);
    setShowUpgradeModal(true);
  };

  const confirmUpgrade = async () => {
    if (!selectedPlan) return;
    setActionLoading('upgrade');
    try {
      const res = await fetch('/api/subscription/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: selectedPlan.id,
          billing_period: billingPeriod,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم الترقية بنجاح!');
        setShowUpgradeModal(false);
        // Refresh
        const subRes = await fetch('/api/subscription/current');
        const subData = await subRes.json();
        if (subData.success && subData.subscription) {
          setCurrentSub(subData.subscription);
        }
      } else {
        toast.error(data.message || data.error || 'فشل في الترقية');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setActionLoading(null);
    }
  };

  // Determine current tier
  const currentTier = currentSub?.plan_name || user?.subscription_tier || 'free';

  // Plan card colors and styles
  const planStyles: Record<string, { gradient: string; border: string; badgeBg: string; badgeText: string; iconBg: string }> = {
    free: {
      gradient: 'from-gray-500 to-gray-600',
      border: 'border-gray-200 dark:border-gray-800',
      badgeBg: 'bg-gray-100 dark:bg-gray-900/40 text-gray-700 dark:text-gray-300',
      badgeText: 'مجاني',
      iconBg: 'bg-gray-100 dark:bg-gray-900/30',
    },
    plus: {
      gradient: 'from-emerald-500 to-teal-600',
      border: 'border-emerald-300 dark:border-emerald-800',
      badgeBg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
      badgeText: 'الأكثر شعبية',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
    },
    premium: {
      gradient: 'from-amber-500 to-orange-600',
      border: 'border-amber-300 dark:border-amber-800',
      badgeBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
      badgeText: 'الأفضل قيمة',
      iconBg: 'bg-amber-100 dark:bg-amber-900/30',
    },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" dir="rtl">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 mb-4 shadow-lg">
          <Crown className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">اختر باقتك</h1>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          استثمر بذكاء مع خطط الاشتراك المرنة. ابدأ مجاناً وترقّى في أي وقت.
        </p>

        {/* Current subscription badge */}
        {currentSub && (
          <div className="mt-4">
            <Badge variant="outline" className="text-xs gap-1.5 px-3 py-1">
              <Zap className="w-3 h-3 text-emerald-500" />
              باقتك الحالية: <strong>{currentSub.plan_name_ar}</strong>
              {currentSub.is_in_trial && (
                <span className="text-amber-500 mr-1">(فترة تجريبية)</span>
              )}
            </Badge>
          </div>
        )}

        {/* Billing period toggle */}
        <div className="flex items-center justify-center gap-3 mt-4">
          <span className={`text-sm ${billingPeriod === 'monthly' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
            شهري
          </span>
          <button
            onClick={() => setBillingPeriod(billingPeriod === 'monthly' ? 'yearly' : 'monthly')}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              billingPeriod === 'yearly' ? 'bg-emerald-600' : 'bg-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                billingPeriod === 'yearly' ? 'translate-x-0.5' : 'translate-x-6.5'
              }`}
            />
          </button>
          <span className={`text-sm ${billingPeriod === 'yearly' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
            سنوي
          </span>
          {billingPeriod === 'yearly' && (
            <Badge className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-0 text-[10px]">
              وفّر حتى 16%
            </Badge>
          )}
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 max-w-5xl mx-auto">
        {plans.map((plan) => {
          const styles = planStyles[plan.name] || planStyles.free;
          const isCurrent = currentTier === plan.name;
          const isRecommended = plan.name === 'plus';
          const displayPrice = billingPeriod === 'yearly' && plan.price_yearly
            ? plan.price_yearly
            : plan.price;
          const monthlyPrice = billingPeriod === 'yearly' && plan.price_yearly
            ? Math.round(plan.price_yearly / 12)
            : plan.price;

          return (
            <Card
              key={plan.id}
              className={`relative overflow-hidden transition-all duration-300 hover:shadow-xl ${
                isRecommended ? 'md:-mt-4 md:mb-0 ring-2 ring-emerald-500 dark:ring-emerald-600' : ''
              } ${isCurrent ? 'ring-2 ring-primary' : ''}`}
            >
              {/* Recommended badge */}
              {isRecommended && (
                <div className="absolute top-0 left-0 right-0">
                  <div className="bg-gradient-to-l from-emerald-500 to-teal-600 text-white text-center py-1.5 text-xs font-semibold flex items-center justify-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    الأكثر شعبية
                  </div>
                </div>
              )}

              <CardHeader className={`${isRecommended ? 'pt-8' : ''} text-center pb-2`}>
                <div className={`mx-auto w-12 h-12 rounded-xl ${styles.iconBg} flex items-center justify-center mb-3`}>
                  {plan.name === 'premium' ? (
                    <Crown className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  ) : plan.name === 'plus' ? (
                    <Star className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Zap className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                  )}
                </div>
                <CardTitle className="text-xl">{plan.name_ar}</CardTitle>
                <CardDescription>{plan.trial_days > 0 ? `${plan.trial_days} أيام تجريبية مجانية` : 'اشتراك مدفوع'}</CardDescription>
              </CardHeader>

              <CardContent className="text-center space-y-4">
                {/* Price */}
                <div className="space-y-1">
                  {plan.price === 0 ? (
                    <div className="text-3xl font-bold text-foreground">مجاني</div>
                  ) : (
                    <>
                      <div className="text-3xl font-bold text-foreground" dir="ltr">
                        {displayPrice} <span className="text-base font-normal text-muted-foreground">ج.م</span>
                      </div>
                      {billingPeriod === 'yearly' && plan.price_yearly && (
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {monthlyPrice} ج.م/شهر · توفير {((plan.price - monthlyPrice) * 12).toFixed(0)} ج.م/سنة
                        </p>
                      )}
                      {billingPeriod === 'monthly' && (
                        <p className="text-xs text-muted-foreground">شهرياً</p>
                      )}
                    </>
                  )}
                </div>

                <Separator />

                {/* Features */}
                <ul className="space-y-2.5 text-right">
                  {plan.features.map((feature, idx) => {
                    const icon = getFeatureIcon(feature);
                    return (
                      <li key={idx} className="flex items-center gap-2.5 text-sm">
                        <span className="text-emerald-500 flex-shrink-0">{icon}</span>
                        <span className="text-foreground/80">{feature}</span>
                      </li>
                    );
                  })}
                </ul>

                <Separator />

                {/* CTA Button */}
                {isCurrent ? (
                  <Button className="w-full" variant="outline" disabled>
                    <Check className="w-4 h-4 ml-1" />
                    باقتك الحالية
                  </Button>
                ) : plan.price === 0 ? (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={handleStartTrial}
                    disabled={actionLoading === 'trial'}
                  >
                    {actionLoading === 'trial' ? (
                      <Loader2 className="w-4 h-4 animate-spin ml-1" />
                    ) : (
                      <Rocket className="w-4 h-4 ml-1" />
                    )}
                    ابدأ الفترة التجريبية
                  </Button>
                ) : (
                  <Button
                    className={`w-full ${
                      isRecommended
                        ? 'bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white'
                        : 'bg-foreground text-background'
                    }`}
                    onClick={() => handleUpgrade(plan)}
                    disabled={actionLoading === 'upgrade'}
                  >
                    {actionLoading === 'upgrade' ? (
                      <Loader2 className="w-4 h-4 animate-spin ml-1" />
                    ) : (
                      <TrendingUp className="w-4 h-4 ml-1" />
                    )}
                    ترقية الآن
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Feature Comparison Table */}
      <div className="max-w-5xl mx-auto mt-10">
        <Card>
          <CardHeader>
            <CardTitle className="text-center text-lg">مقارنة الباقات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-right py-3 px-2 font-semibold text-muted-foreground">الميزة</th>
                    {plans.map((p) => (
                      <th key={p.id} className="text-center py-3 px-2 font-semibold">
                        {p.name_ar}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2.5 px-2">السعر الشهري</td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center py-2.5 px-2 font-medium" dir="ltr">
                        {p.price === 0 ? 'مجاني' : `${p.price} ج.م`}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2.5 px-2">السعر السنوي</td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center py-2.5 px-2 font-medium" dir="ltr">
                        {p.price_yearly ? `${p.price_yearly} ج.م` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2.5 px-2">أيام تجريبية</td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center py-2.5 px-2">
                        {p.trial_days > 0 ? `${p.trial_days} أيام` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2.5 px-2">قائمة المراقبة</td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center py-2.5 px-2 font-medium" dir="ltr">
                        {p.max_watchlist >= 9999 ? 'غير محدود' : p.max_watchlist}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2.5 px-2">المحافظ الاستثمارية</td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center py-2.5 px-2 font-medium" dir="ltr">
                        {p.max_portfolio >= 9999 ? 'غير محدود' : p.max_portfolio}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2.5 px-2">تنبيهات الأسعار</td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center py-2.5 px-2 font-medium" dir="ltr">
                        {p.max_alerts >= 9999 ? 'غير محدود' : p.max_alerts}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2.5 px-2">تحليل بالذكاء الاصطناعي</td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center py-2.5 px-2">
                        {p.ai_analysis ? (
                          <Check className="w-5 h-5 text-emerald-500 mx-auto" />
                        ) : (
                          <X className="w-5 h-5 text-muted-foreground/30 mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2.5 px-2">تحليل شامل</td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center py-2.5 px-2">
                        {p.deep_analysis ? (
                          <Check className="w-5 h-5 text-emerald-500 mx-auto" />
                        ) : (
                          <X className="w-5 h-5 text-muted-foreground/30 mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 px-2">دعم أولوي</td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center py-2.5 px-2">
                        {p.priority_support ? (
                          <Check className="w-5 h-5 text-emerald-500 mx-auto" />
                        ) : (
                          <X className="w-5 h-5 text-muted-foreground/30 mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upgrade Modal */}
      <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              ترقية إلى {selectedPlan?.name_ar}
            </DialogTitle>
            <DialogDescription>
              نظام الدفع الإلكتروني قيد التطوير حالياً
            </DialogDescription>
          </DialogHeader>

          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              🚧 قريباً — طرق الدفع المتاحة
            </p>
            <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
              <li className="flex items-center gap-1.5">
                <span>💳</span> بطاقة فيزا / ماستركارد
              </li>
              <li className="flex items-center gap-1.5">
                <span>🏪</span> فوري (Fawry)
              </li>
              <li className="flex items-center gap-1.5">
                <span>📱</span> فودافون كاش
              </li>
            </ul>
          </div>

          {selectedPlan && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">الباقة المختارة</span>
              <div className="text-left">
                <span className="font-bold">{selectedPlan.name_ar}</span>
                <span className="text-muted-foreground text-xs mr-2" dir="ltr">
                  {billingPeriod === 'yearly' && selectedPlan.price_yearly
                    ? `${selectedPlan.price_yearly} ج.م/سنة`
                    : `${selectedPlan.price} ج.م/شهر`}
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="outline" className="flex-1">إلغاء</Button>
            </DialogClose>
            <Button
              onClick={confirmUpgrade}
              disabled={actionLoading === 'upgrade'}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {actionLoading === 'upgrade' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'محاولة الترقية'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

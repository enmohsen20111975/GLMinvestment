'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import {
  Check,
  Crown,
  Sparkles,
  Star,
  Zap,
  Brain,
  TrendingUp,
  Eye,
  BarChart3,
  Bell,
  Headphones,
  Rocket,
  Shield,
  Infinity,
  Gift,
  Clock,
  ChevronLeft,
  Building2,
  Users,
  Phone,
  Mail,
  MessageCircle,
  Loader2,
  CreditCard,
  Key,
  Wallet,
  Tag,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/lib/store';
import type { User as AppUser } from '@/types';

// ==================== HARDCODED PLANS ====================

interface PlanFeature {
  icon: React.ReactNode;
  text: string;
  highlighted?: boolean;
}

interface Plan {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  price: number;
  priceYearly: number;
  originalPrice?: number;
  popular?: boolean;
  premium?: boolean;
  developer?: boolean;
  cta: string;
  features: PlanFeature[];
  limits: {
    watchlist: number | string;
    portfolio: number | string;
    alerts: number | string;
    aiAnalysis: boolean;
    deepAnalysis: boolean;
    prioritySupport: boolean;
    advancedReports: boolean;
    apiAccess: boolean;
  };
}

const plans: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    nameAr: 'الأساسية',
    description: 'للمستثمر المبتدئ',
    price: 0,
    priceYearly: 0,
    cta: 'ابدأ مجاناً',
    features: [
      { icon: <Eye className="w-4 h-4" />, text: 'قائمة مراقبة حتى 5 أسهم' },
      { icon: <Building2 className="w-4 h-4" />, text: 'محفظة استثمارية واحدة' },
      { icon: <Bell className="w-4 h-4" />, text: '3 تنبيهات أسعار' },
      { icon: <BarChart3 className="w-4 h-4" />, text: 'تحليلات أساسية' },
      { icon: <Shield className="w-4 h-4" />, text: 'بيانات محمية' },
    ],
    limits: {
      watchlist: 5,
      portfolio: 1,
      alerts: 3,
      aiAnalysis: false,
      deepAnalysis: false,
      prioritySupport: false,
      advancedReports: false,
      apiAccess: false,
    },
  },
  {
    id: 'normal',
    name: 'Normal',
    nameAr: 'الاحترافية',
    description: 'للمستثمر الجاد',
    price: 199,
    priceYearly: 1990,
    originalPrice: 299,
    popular: true,
    cta: 'ابدأ الآن',
    features: [
      { icon: <Eye className="w-4 h-4" />, text: 'قائمة مراقبة حتى 25 سهم' },
      { icon: <Building2 className="w-4 h-4" />, text: '5 محافظ استثمارية' },
      { icon: <Bell className="w-4 h-4" />, text: '15 تنبيه أسعار' },
      { icon: <Brain className="w-4 h-4" />, text: 'تحليل متقدم', highlighted: true },
      { icon: <BarChart3 className="w-4 h-4" />, text: 'تقارير متقدمة' },
      { icon: <TrendingUp className="w-4 h-4" />, text: 'رؤى سوقية ذكية' },
      { icon: <Shield className="w-4 h-4" />, text: 'دعم بالبريد الإلكتروني' },
    ],
    limits: {
      watchlist: 25,
      portfolio: 5,
      alerts: 15,
      aiAnalysis: true,
      deepAnalysis: false,
      prioritySupport: false,
      advancedReports: true,
      apiAccess: false,
    },
  },
  {
    id: 'premium',
    name: 'Premium',
    nameAr: 'المتقدمة',
    description: 'للمستثمر المحترف',
    price: 299,
    priceYearly: 2990,
    originalPrice: 399,
    premium: true,
    cta: 'اشترك الآن',
    features: [
      { icon: <Infinity className="w-4 h-4" />, text: 'قائمة مراقبة غير محدودة' },
      { icon: <Infinity className="w-4 h-4" />, text: 'محافظ استثمارية غير محدودة' },
      { icon: <Infinity className="w-4 h-4" />, text: 'تنبيهات غير محدودة' },
      { icon: <Brain className="w-4 h-4" />, text: 'تحليل عميق متقدم', highlighted: true },
      { icon: <BarChart3 className="w-4 h-4" />, text: 'تقارير حصرية ومتقدمة' },
      { icon: <Users className="w-4 h-4" />, text: 'وصول مبكر للميزات' },
      { icon: <Headphones className="w-4 h-4" />, text: 'دعم أولوي 24/7' },
      { icon: <Zap className="w-4 h-4" />, text: 'وصول API' },
    ],
    limits: {
      watchlist: '∞',
      portfolio: '∞',
      alerts: '∞',
      aiAnalysis: true,
      deepAnalysis: true,
      prioritySupport: true,
      advancedReports: true,
      apiAccess: true,
    },
  },
  {
    id: 'developer',
    name: 'Developer',
    nameAr: 'المطورين',
    description: 'للمطورين والمؤسسات',
    price: 599,
    priceYearly: 5990,
    originalPrice: 699,
    developer: true,
    cta: 'تواصل معنا',
    features: [
      { icon: <Infinity className="w-4 h-4" />, text: 'كل ميزات الباقة المتقدمة' },
      { icon: <Zap className="w-4 h-4" />, text: 'وصول كامل لـ API', highlighted: true },
      { icon: <Bell className="w-4 h-4" />, text: 'Webhooks للتنبيهات' },
      { icon: <TrendingUp className="w-4 h-4" />, text: 'بيانات لحظية (Real-time)' },
      { icon: <BarChart3 className="w-4 h-4" />, text: 'تصدير البيانات (CSV/JSON)' },
      { icon: <Key className="w-4 h-4" />, text: 'API Keys متعددة' },
      { icon: <Shield className="w-4 h-4" />, text: 'Rate limit عالي' },
      { icon: <Headphones className="w-4 h-4" />, text: 'دعم فني مخصص' },
      { icon: <Brain className="w-4 h-4" />, text: 'توثيق API كامل + SDK' },
    ],
    limits: {
      watchlist: '∞',
      portfolio: '∞',
      alerts: '∞',
      aiAnalysis: true,
      deepAnalysis: true,
      prioritySupport: true,
      advancedReports: true,
      apiAccess: true,
    },
  },
];

// ==================== COMPONENT ====================

export function SubscriptionView() {
  const { data: session, status } = useSession();
  const { user, setCurrentView, setUser } = useAppStore();
  const searchParams = useSearchParams();
  const isLoggedIn = !!user || status === 'authenticated';
  
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletPaymentData, setWalletPaymentData] = useState<{
    paymentKey: string;
    orderId: number;
    amount: number;
    paymobUrl: string;
  } | null>(null);

  // ===== Promo Code State (P15-TASK-6) =====
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoSuccess, setPromoSuccess] = useState(false);

  // Handle payment callback
  useEffect(() => {
    const paymentStatus = searchParams.get('payment');
    if (paymentStatus === 'success') {
      toast.success('تم الدفع بنجاح! تم تفعيل اشتراكك.');
      setCurrentView('dashboard');
    } else if (paymentStatus === 'failed') {
      toast.error('فشلت عملية الدفع. يرجى المحاولة مرة أخرى.');
    }
  }, [searchParams, setCurrentView]);

  const handleStartFreeTrial = async () => {
    if (!isLoggedIn) {
      setCurrentView('auth');
      return;
    }

    try {
      setLoading('free-trial');
      
      // Activate free plan directly (no payment gateway)
      const response = await fetch('/api/subscription/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: 'free',
          payment_gateway: 'free',
          billing_period: 'monthly',
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast.success('تم تفعيل الباقة المجانية بنجاح!');
        setCurrentView('dashboard');
      } else {
        toast.error(data.error || 'فشل تفعيل الباقة المجانية');
      }
    } catch (error) {
      console.error('Free trial error:', error);
      toast.error('حدث خطأ في تفعيل الباقة المجانية');
    } finally {
      setLoading(null);
    }
  };

  // ===== Promo Code Redemption (P15-TASK-6) =====
  const handleRedeemPromo = async () => {
    if (!isLoggedIn) {
      setCurrentView('auth');
      return;
    }

    const code = promoCode.trim();
    if (!code) {
      toast.error('من فضلك أدخل كود الخصم');
      return;
    }

    try {
      setPromoLoading(true);
      setPromoSuccess(false);

      const response = await fetch('/api/redeem-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setPromoSuccess(true);
        toast.success(
          data.message || 'تم تفعيل الكود بنجاح! تمت ترقية حسابك إلى الباقة المتقدمة'
        );

        // Refresh the user's subscription status from /api/auth/me so the
        // new tier + trial_ends_at propagate to the rest of the app.
        try {
          const meRes = await fetch('/api/auth/me', {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          });
          if (meRes.ok) {
            const meData = await meRes.json();
            if (meData.success && meData.user) {
              const u = meData.user;
              const refreshedUser: AppUser = {
                id: u.id,
                email: u.email || '',
                username: u.username || u.name || '',
                is_active: u.is_active ?? true,
                is_admin: u.is_admin ?? false,
                subscription_tier: u.subscription_tier || 'free',
                default_risk_tolerance: u.default_risk_tolerance || 'medium',
                created_at: u.created_at || new Date().toISOString(),
                last_login: u.last_login || null,
              };
              setUser(refreshedUser);
            }
          }
        } catch (refreshErr) {
          console.error('[Promo] refresh /api/auth/me failed:', refreshErr);
          // Non-fatal: the redemption itself already succeeded.
        }

        // Clear the input so the user can't accidentally re-submit.
        setPromoCode('');
      } else {
        toast.error(data.error || 'فشل في تفعيل الكود');
      }
    } catch (error) {
      console.error('Promo redemption error:', error);
      toast.error('حدث خطأ أثناء تفعيل الكود. حاول مرة أخرى.');
    } finally {
      setPromoLoading(false);
    }
  };

  const handlePaidSubscription = async (plan: Plan, paymentType: 'card' | 'wallet') => {
    if (!isLoggedIn) {
      setCurrentView('auth');
      return;
    }

    try {
      setLoading(plan.id);

      // Create a Paymob payment session (works for both card & wallet).
      // Previously this hit /api/subscribe/[plan] which was wrongly proxying
      // to the Python /api/market-pulse endpoint, returning market overview
      // JSON instead of a payment URL. Fixed to call the real Paymob endpoint.
      const response = await fetch('/api/paymob/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: plan.id,
          billing_period: billingPeriod,
          payment_method: paymentType,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        toast.error(data.error || 'فشل في إنشاء عملية الدفع');
        return;
      }

      if (paymentType === 'card') {
        // Card payment: redirect to Paymob iframe
        window.location.href = data.payment_url;
      } else {
        // Wallet payment: show wallet modal (user enters wallet number, then POSTs to paymob_url)
        setWalletPaymentData({
          paymentKey: data.payment_key,
          orderId: data.order_id,
          amount: data.amount,
          paymobUrl: data.paymob_url,
        });
        setShowWalletModal(true);
        setShowPaymentOptions(false);
      }
    } catch (error) {
      console.error('Payment error:', error);
      toast.error('حدث خطأ في إنشاء عملية الدفع');
    } finally {
      setLoading(null);
    }
  };

  const handlePlanSelect = (plan: Plan) => {
    if (!isLoggedIn) {
      setCurrentView('auth');
      return;
    }
    
    if (plan.id === 'free') {
      toast.success('يمكنك البدء بالباقة المجانية الآن!');
      setCurrentView('dashboard');
    } else if (plan.id === 'developer') {
      // Developer plan - show contact modal with email
      setSelectedPlan(plan);
      setShowContactModal(true);
    } else {
      // For normal and premium plans - show payment options (card/wallet)
      setSelectedPlan(plan);
      setShowPaymentOptions(true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-emerald-950/20" dir="rtl">
      {/* Special Offer Banner */}
      <div className="bg-gradient-to-l from-emerald-600 via-teal-600 to-emerald-700 text-white">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex flex-col md:flex-row items-center justify-center gap-2 md:gap-4 text-center md:text-right">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 animate-pulse" />
              <span className="font-bold text-lg">عرض خاص!</span>
            </div>
            <span className="text-emerald-50">
              الموقع مجاني بالكامل لمدة شهر مع جميع الميزات الاحترافية
            </span>
            <div className="flex items-center gap-1 bg-white/20 rounded-full px-3 py-1">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-medium">عرض محدود</span>
            </div>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background Decoration */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-transparent to-transparent" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 right-20 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl" />
        
        <div className="relative max-w-6xl mx-auto px-4 pt-12 pb-8">
          <div className="text-center">
            {/* Logo Badge */}
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 mb-6 shadow-2xl shadow-emerald-500/30">
              <Crown className="w-10 h-10 text-white" />
            </div>
            
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
              اختر باقتك المناسبة
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
              استثمر بذكاء مع خطط اشتراك مرنة تناسب احتياجاتك. ابدأ مجاناً وترقّى في أي وقت.
            </p>
            
            {/* Trust Badges */}
            <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="w-4 h-4 text-emerald-500" />
                <span>بيانات محمية 100%</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4 text-emerald-500" />
                <span>إلغاء في أي وقت</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Headphones className="w-4 h-4 text-emerald-500" />
                <span>دعم فني متميز</span>
              </div>
            </div>

            {/* Billing Toggle */}
            <div className="inline-flex items-center gap-3 bg-muted/50 rounded-full p-1.5">
              <button
                onClick={() => setBillingPeriod('monthly')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  billingPeriod === 'monthly'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                شهري
              </button>
              <button
                onClick={() => setBillingPeriod('yearly')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                  billingPeriod === 'yearly'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                سنوي
                <Badge className="bg-emerald-500 text-white text-[10px] px-1.5 py-0.5">
                  وفّر 17%
                </Badge>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Promo Code Redemption (P15-TASK-6) */}
      <div className="max-w-3xl mx-auto px-4 pb-10 -mt-2">
        <Card className="overflow-hidden border-2 border-emerald-500/30 shadow-lg shadow-emerald-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/30">
                <Tag className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg flex items-center gap-2">
                  تفعيل كود الخصم
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] px-2 py-0.5">
                    Promo Code
                  </Badge>
                </CardTitle>
                <CardDescription className="mt-1">
                  عندك كود ترويجي؟ أدخله هنا لتفعيل الباقة المتقدمة مجاناً
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={promoCode}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  // Force uppercase + trim whitespace; LTR for the code itself.
                  setPromoCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
                  if (promoSuccess) setPromoSuccess(false);
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter' && !promoLoading && promoCode.trim()) {
                    handleRedeemPromo();
                  }
                }}
                placeholder="مثال: WELCOME90"
                dir="ltr"
                className="text-center font-mono tracking-widest text-base sm:text-lg uppercase h-11"
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                disabled={promoLoading}
                aria-label="كود الخصم"
              />
              <Button
                onClick={handleRedeemPromo}
                disabled={promoLoading || !promoCode.trim()}
                className="h-11 sm:min-w-[140px] bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
                type="button"
              >
                {promoLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري التفعيل...
                  </>
                ) : promoSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 ml-2" />
                    تم التفعيل
                  </>
                ) : (
                  <>
                    <Gift className="w-4 h-4 ml-2" />
                    تفعيل الكود
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center sm:text-right">
              الكود حساس لحالة الأحرف — سيتم تحويله تلقائياً إلى أحرف كبيرة.
              بعد التفعيل سيتم ترقية حسابك إلى الباقة المتقدمة فوراً.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Plans Grid */}
      <div className="max-w-7xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-6">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              billingPeriod={billingPeriod}
              onSelect={() => handlePlanSelect(plan)}
              loading={loading}
            />
          ))}
        </div>
      </div>

      {/* Features Comparison */}
      <div className="bg-muted/30 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-8">مقارنة الباقات</h2>
          <ComparisonTable plans={plans} billingPeriod={billingPeriod} />
        </div>
      </div>

      {/* FAQ Section */}
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-center mb-8">الأسئلة الشائعة</h2>
        <div className="space-y-4">
          <FAQItem
            question="هل يمكنني تغيير الباقة لاحقاً؟"
            answer="نعم، يمكنك الترقية أو تخفيض باقتك في أي وقت من إعدادات الحساب. في حالة الترقية، سيتم احتساب الفرق فقط."
          />
          <FAQItem
            question="ما هي طرق الدفع المتاحة؟"
            answer="نقبل بطاقات فيزا وماستركارد، فوري، فودافون كاش، ومحافظ إلكترونية أخرى. جميع المعاملات مشفرة وآمنة."
          />
          <FAQItem
            question="هل هناك فترة تجريبية؟"
            answer="نعم! حالياً نقدم الموقع مجاناً بالكامل لمدة شهر مع جميع الميزات. سجل الآن واستفد من هذا العرض المحدود."
          />
          <FAQItem
            question="هل يمكنني إلغاء الاشتراك؟"
            answer="بالتأكيد، يمكنك إلغاء اشتراكك في أي وقت من إعدادات الحساب. ستحتفظ بالوصول حتى نهاية الفترة المدفوعة."
          />
        </div>
      </div>

      {/* Payment Options Modal */}
      {showPaymentOptions && selectedPlan && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4">
                <CreditCard className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-xl">اختر طريقة الاشتراك</CardTitle>
              <CardDescription>
                باقة {selectedPlan.nameAr} - {billingPeriod === 'yearly' ? `${selectedPlan.priceYearly} ج.م/سنة` : `${selectedPlan.price} ج.م/شهر`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Free Trial Option */}
              <div className="p-4 rounded-lg border-2 border-emerald-500/50 bg-emerald-50 dark:bg-emerald-900/20">
                <div className="flex items-center gap-3 mb-2">
                  <Gift className="w-6 h-6 text-emerald-600" />
                  <span className="font-bold text-lg">الفترة التجريبية المجانية</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  استمتع بجميع الميزات الاحترافية مجاناً لمدة شهر كامل!
                </p>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleStartFreeTrial}
                  disabled={loading === 'free-trial'}
                >
                  {loading === 'free-trial' ? (
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  ) : (
                    <Gift className="w-4 h-4 ml-2" />
                  )}
                  {loading === 'free-trial' ? 'جاري التفعيل...' : 'ابدأ مجاناً لمدة شهر'}
                </Button>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">أو</span>
                </div>
              </div>

              {/* InstaPay Payment Option */}
              <div className="p-4 rounded-lg border-2 border-purple-500/50 bg-purple-50 dark:bg-purple-900/20">
                <div className="flex items-center gap-3 mb-2">
                  <svg className="w-6 h-6 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                  </svg>
                  <span className="font-bold text-lg">الدفع عبر InstaPay</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  احوال أموالك بسهولة عبر InstaPay - الطريقة الأسهل والأسرع للدفع!
                </p>
                <a
                  href="https://ipn.eg/S/enmohsen20111975qnb/instapay/36uC2o"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <Button
                    className="w-full bg-gradient-to-l from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700"
                    type="button"
                  >
                    <svg className="w-4 h-4 ml-2" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                    </svg>
                    ادفع عبر InstaPay
                  </Button>
                </a>
                <p className="text-xs text-center text-muted-foreground mt-2">
                  الحساب: enmohsen20111975qnb@instapay
                </p>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">أو بوابة الدفع</span>
                </div>
              </div>

              {/* Paid Subscription Option */}
              <div className="p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-3 mb-2">
                  <CreditCard className="w-6 h-6 text-foreground" />
                  <span className="font-bold text-lg">اشتراك مدفوع</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  اختر طريقة الدفع المناسبة لك
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {/* Card Payment */}
                  <Button
                    className="bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
                    onClick={() => handlePaidSubscription(selectedPlan, 'card')}
                    disabled={loading === selectedPlan.id}
                  >
                    {loading === selectedPlan.id ? (
                      <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4 ml-2" />
                    )}
                    بطاقة
                  </Button>
                  {/* Wallet Payment */}
                  <Button
                    className="bg-gradient-to-l from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700"
                    onClick={() => handlePaidSubscription(selectedPlan, 'wallet')}
                    disabled={loading === selectedPlan.id}
                  >
                    {loading === selectedPlan.id ? (
                      <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    ) : (
                      <Wallet className="w-4 h-4 ml-2" />
                    )}
                    محفظة
                  </Button>
                </div>
                <p className="text-xs text-center text-muted-foreground mt-2">
                  {billingPeriod === 'yearly' ? selectedPlan.priceYearly : selectedPlan.price} ج.م / {billingPeriod === 'yearly' ? 'سنوياً' : 'شهرياً'}
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowPaymentOptions(false)}
              >
                إلغاء
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Contact Modal - Developer Plan */}
      {showContactModal && selectedPlan && (
        <DeveloperContactModal
          plan={selectedPlan}
          billingPeriod={billingPeriod}
          onClose={() => setShowContactModal(false)}
        />
      )}

      {/* Wallet Payment Modal */}
      {showWalletModal && walletPaymentData && (
        <WalletPaymentModal
          paymentData={walletPaymentData}
          onClose={() => {
            setShowWalletModal(false);
            setWalletPaymentData(null);
          }}
        />
      )}
    </div>
  );
}

// ==================== PLAN CARD COMPONENT ====================

function PlanCard({ 
  plan, 
  billingPeriod, 
  onSelect,
  loading,
}: { 
  plan: Plan; 
  billingPeriod: 'monthly' | 'yearly';
  onSelect: () => void;
  loading: string | null;
}) {
  const displayPrice = billingPeriod === 'yearly' ? plan.priceYearly : plan.price;
  const monthlyPrice = billingPeriod === 'yearly' ? Math.round(plan.priceYearly / 12) : plan.price;
  const savings = billingPeriod === 'yearly' && plan.price > 0 
    ? (plan.price * 12) - plan.priceYearly 
    : 0;
  const isLoading = loading === plan.id;

  return (
    <Card
      className={`relative overflow-hidden transition-all duration-300 hover:shadow-2xl ${
        plan.popular 
          ? 'border-2 border-emerald-500 dark:border-emerald-600 shadow-xl shadow-emerald-500/10' 
          : plan.premium
          ? 'border-2 border-amber-500 dark:border-amber-600 shadow-xl shadow-amber-500/10'
          : plan.developer
          ? 'border-2 border-violet-500 dark:border-violet-600 shadow-xl shadow-violet-500/10'
          : 'border border-border hover:border-emerald-500/50'
      }`}
    >
      {/* Popular Badge */}
      {plan.popular && (
        <div className="absolute -top-px left-0 right-0">
          <div className="bg-gradient-to-l from-emerald-500 to-teal-600 text-white text-center py-2 text-sm font-semibold flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4" />
            الأكثر شعبية
          </div>
        </div>
      )}

      {/* Premium Badge */}
      {plan.premium && (
        <div className="absolute -top-px left-0 right-0">
          <div className="bg-gradient-to-l from-amber-500 to-orange-600 text-white text-center py-2 text-sm font-semibold flex items-center justify-center gap-2">
            <Crown className="w-4 h-4" />
            الأفضل للمحترفين
          </div>
        </div>
      )}

      {/* Developer Badge */}
      {plan.developer && (
        <div className="absolute -top-px left-0 right-0">
          <div className="bg-gradient-to-l from-violet-500 to-purple-600 text-white text-center py-2 text-sm font-semibold flex items-center justify-center gap-2">
            <Key className="w-4 h-4" />
            للمطورين
          </div>
        </div>
      )}

      <CardHeader className={`text-center ${plan.popular || plan.premium || plan.developer ? 'pt-14' : 'pt-6'}`}>
        {/* Icon */}
        <div
          className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-4 ${
            plan.premium
              ? 'bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30'
              : plan.developer
              ? 'bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30'
              : plan.popular
              ? 'bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/30 dark:to-teal-900/30'
              : 'bg-muted'
          }`}
        >
          {plan.premium ? (
            <Crown className="w-7 h-7 text-amber-600 dark:text-amber-400" />
          ) : plan.developer ? (
            <Key className="w-7 h-7 text-violet-600 dark:text-violet-400" />
          ) : plan.popular ? (
            <Star className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Zap className="w-7 h-7 text-muted-foreground" />
          )}
        </div>

        {/* Plan Name */}
        <CardTitle className="text-2xl mb-1">{plan.nameAr}</CardTitle>
        <CardDescription className="text-sm">{plan.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Price */}
        <div className="text-center">
          {plan.price === 0 ? (
            <div className="flex items-center justify-center gap-2">
              <span className="text-4xl font-bold">مجاني</span>
              <Badge className="bg-emerald-500 text-white">للأبد</Badge>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 mb-1">
                {plan.originalPrice && (
                  <span className="text-lg text-muted-foreground line-through">
                    {plan.originalPrice}
                  </span>
                )}
                <span className="text-4xl font-bold" dir="ltr">
                  {displayPrice}
                </span>
                <span className="text-muted-foreground">ج.م</span>
              </div>
              {billingPeriod === 'yearly' && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground" dir="ltr">
                    {monthlyPrice} ج.م / شهر
                  </p>
                  <Badge className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-0">
                    توفير {savings} ج.م سنوياً
                  </Badge>
                </div>
              )}
              {billingPeriod === 'monthly' && (
                <p className="text-sm text-muted-foreground">شهرياً</p>
              )}
            </>
          )}
        </div>

        <Separator />

        {/* Features */}
        <ul className="space-y-3">
          {plan.features.map((feature, idx) => (
            <li
              key={idx}
              className={`flex items-center gap-3 text-sm ${
                feature.highlighted ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''
              }`}
            >
              <span className={`flex-shrink-0 ${feature.highlighted ? 'text-emerald-500' : 'text-emerald-500'}`}>
                {feature.icon}
              </span>
              <span>{feature.text}</span>
            </li>
          ))}
        </ul>

        <Separator />

        {/* CTA Button */}
        <Button
          className={`w-full py-6 text-base font-semibold ${
            plan.popular
              ? 'bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25'
              : plan.premium
              ? 'bg-gradient-to-l from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-lg shadow-amber-500/25'
              : plan.developer
              ? 'bg-gradient-to-l from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shadow-lg shadow-violet-500/25'
              : 'bg-foreground text-background hover:bg-foreground/90'
          }`}
          onClick={onSelect}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 ml-2 animate-spin" />
          ) : (
            <>
              {plan.price === 0 && <Rocket className="w-5 h-5 ml-2" />}
              {plan.popular && <Zap className="w-5 h-5 ml-2" />}
              {plan.premium && <Crown className="w-5 h-5 ml-2" />}
              {plan.developer && <Key className="w-5 h-5 ml-2" />}
            </>
          )}
          {isLoading ? 'جاري التحميل...' : plan.cta}
        </Button>

        {/* Trial Note */}
        {plan.price > 0 && (
          <p className="text-xs text-center text-muted-foreground">
            بدون التزام · إلغاء في أي وقت
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== COMPARISON TABLE ====================

function ComparisonTable({ plans, billingPeriod }: { plans: Plan[]; billingPeriod: 'monthly' | 'yearly' }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-right py-4 px-4 font-semibold">الميزة</th>
                {plans.map((p) => (
                  <th
                    key={p.id}
                    className={`text-center py-4 px-4 font-semibold ${
                      p.popular ? 'text-emerald-600 dark:text-emerald-400' : ''
                    }`}
                  >
                    {p.nameAr}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <ComparisonRow label="السعر الشهري" plans={plans} getValue={(p) => 
                p.price === 0 ? 'مجاني' : `${p.price} ج.م`
              } />
              <ComparisonRow label="السعر السنوي" plans={plans} getValue={(p) => 
                p.priceYearly === 0 ? 'مجاني' : `${p.priceYearly} ج.م`
              } />
              <ComparisonRow label="قائمة المراقبة" plans={plans} getValue={(p) => 
                typeof p.limits.watchlist === 'string' ? 'غير محدود' : `${p.limits.watchlist} سهم`
              } highlight />
              <ComparisonRow label="المحافظ الاستثمارية" plans={plans} getValue={(p) => 
                typeof p.limits.portfolio === 'string' ? 'غير محدود' : `${p.limits.portfolio} محفظة`
              } />
              <ComparisonRow label="تنبيهات الأسعار" plans={plans} getValue={(p) => 
                typeof p.limits.alerts === 'string' ? 'غير محدود' : `${p.limits.alerts} تنبيه`
              } />
              <ComparisonRow 
                label="تحليل متقدم" 
                plans={plans} 
                getValue={(p) => p.limits.aiAnalysis} 
                isBoolean 
              />
              <ComparisonRow 
                label="تحليل عميق متقدم" 
                plans={plans} 
                getValue={(p) => p.limits.deepAnalysis} 
                isBoolean 
              />
              <ComparisonRow 
                label="تقارير متقدمة" 
                plans={plans} 
                getValue={(p) => p.limits.advancedReports} 
                isBoolean 
              />
              <ComparisonRow 
                label="دعم أولوي" 
                plans={plans} 
                getValue={(p) => p.limits.prioritySupport} 
                isBoolean 
              />
              <ComparisonRow 
                label="وصول API" 
                plans={plans} 
                getValue={(p) => p.limits.apiAccess} 
                isBoolean 
              />
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonRow({ 
  label, 
  plans, 
  getValue, 
  isBoolean = false,
  highlight = false,
}: { 
  label: string; 
  plans: Plan[]; 
  getValue: (p: Plan) => string | number | boolean;
  isBoolean?: boolean;
  highlight?: boolean;
}) {
  return (
    <tr className={`border-b last:border-0 ${highlight ? 'bg-muted/30' : ''}`}>
      <td className="py-3 px-4 font-medium">{label}</td>
      {plans.map((p) => {
        const value = getValue(p);
        return (
          <td key={p.id} className="text-center py-3 px-4">
            {isBoolean ? (
              value ? (
                <Check className="w-5 h-5 text-emerald-500 mx-auto" />
              ) : (
                <span className="w-5 h-5 text-muted-foreground/30 mx-auto block">—</span>
              )
            ) : (
              <span className={highlight ? 'font-semibold' : ''}>{value}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ==================== FAQ ITEM ====================

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-right hover:bg-muted/50 transition-colors"
      >
        <span className="font-semibold">{question}</span>
        <ChevronLeft className={`w-5 h-5 text-muted-foreground transition-transform ${isOpen ? '-rotate-90' : ''}`} />
      </button>
      {isOpen && (
        <div className="px-4 pb-4 text-muted-foreground">
          {answer}
        </div>
      )}
    </Card>
  );
}

// ==================== DEVELOPER CONTACT MODAL ====================

function DeveloperContactModal({
  plan,
  billingPeriod,
  onClose,
}: {
  plan: Plan;
  billingPeriod: 'monthly' | 'yearly';
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [useCase, setUseCase] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email) {
      toast.error('يرجى إدخال البريد الإلكتروني');
      return;
    }

    setSubmitting(true);
    try {
      // Save developer lead to database
      const response = await fetch('/api/subscription/developer-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name,
          company,
          useCase,
          plan: plan.id,
          billingPeriod,
          price: billingPeriod === 'yearly' ? plan.priceYearly : plan.price,
        }),
      });

      if (response.ok) {
        toast.success('تم استلام طلبك! سنتواصل معك قريباً 📧');
        onClose();
      } else {
        // Fallback: open mailto
        const subject = encodeURIComponent(`طلب اشتراك باقة المطورين - ${plan.nameAr}`);
        const body = encodeURIComponent(
          `الاسم: ${name}\n` +
          `البريد: ${email}\n` +
          `الشركة: ${company}\n` +
          `حالة الاستخدام: ${useCase}\n` +
          `الباقة: ${plan.nameAr}\n` +
          `الفترة: ${billingPeriod === 'yearly' ? 'سنوي' : 'شهري'}\n` +
          `السعر: ${billingPeriod === 'yearly' ? plan.priceYearly : plan.price} ج.م`
        );
        window.location.href = `mailto:support@glminvestment.com?subject=${subject}&body=${body}`;
      }
    } catch (error) {
      console.error('Developer request error:', error);
      toast.error('حدث خطأ، يرجى المحاولة مرة أخرى');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-4">
            <Key className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-xl">باقة المطورين</CardTitle>
          <CardDescription>
            {plan.nameAr} - {billingPeriod === 'yearly' ? `${plan.priceYearly} ج.م/سنة` : `${plan.price} ج.م/شهر`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/30 rounded-lg p-3 text-sm">
            <p className="font-semibold mb-2">✨ مميزات باقة المطورين:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>• وصول كامل لـ API</li>
              <li>• Webhooks للتنبيهات</li>
              <li>• بيانات لحظية (Real-time)</li>
              <li>• API Keys متعددة</li>
              <li>• Rate limit عالي</li>
              <li>• دعم فني مخصص</li>
            </ul>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">البريد الإلكتروني *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="developer@example.com"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">الاسم</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسمك"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">الشركة (اختياري)</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="اسم الشركة"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">حالة الاستخدام</label>
              <textarea
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                placeholder="كيف تخطط لاستخدام الـ API؟"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground min-h-[80px]"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={submitting}
            >
              إلغاء
            </Button>
            <Button
              className="flex-1 bg-gradient-to-l from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
              onClick={handleSubmit}
              disabled={submitting || !email}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <Mail className="w-4 h-4 ml-2" />
              )}
              {submitting ? 'جاري الإرسال...' : 'إرسال الطلب'}
            </Button>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            سنتواصل معك خلال 24 ساعة لإعداد حساب المطور الخاص بك
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== WALLET PAYMENT MODAL ====================

function WalletPaymentModal({
  paymentData,
  onClose,
}: {
  paymentData: {
    paymentKey: string;
    orderId: number;
    amount: number;
    paymobUrl: string;
  };
  onClose: () => void;
}) {
  const [walletNumber, setWalletNumber] = useState('');
  const [processing, setProcessing] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!walletNumber || walletNumber.length < 10) {
      toast.error('يرجى إدخال رقم محفظة صحيح');
      return;
    }

    setProcessing(true);
    try {
      // POST to server-side Paymob wallet endpoint to avoid CORS issues
      const response = await fetch('/api/paymob/process-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_number: walletNumber,
          payment_key: paymentData.paymentKey,
        }),
      });

      const data = await response.json();

      if (data.success) {
        if (data.redirect_url) {
          // Redirect to wallet approval page
          setRedirectUrl(data.redirect_url);
          setTimeout(() => {
            window.location.href = data.redirect_url;
          }, 1500);
        } else {
          toast.success(data.message || 'تم إرسال طلب الدفع إلى محفظتك بنجاح!');
        }
      } else {
        toast.error(data.error || 'فشل في عملية الدفع');
        console.error('[Wallet Payment] Error:', data);
      }
    } catch (error) {
      console.error('[Wallet Payment] Error:', error);
      toast.error('حدث خطأ في الاتصال بـ Paymob');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center mb-4">
            <Wallet className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-xl">الدفع بالمحفظة الإلكترونية</CardTitle>
          <CardDescription>
            أدخل رقم محفظتك لإتمام عملية الدفع
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {redirectUrl ? (
            <div className="text-center space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
              </div>
              <p className="font-semibold text-emerald-600">جاري تحويلك لصفحة الدفع...</p>
              <p className="text-xs text-muted-foreground">
                سيتم تحويلك تلقائياً خلال لحظات
              </p>
              <a
                href={redirectUrl}
                className="text-sm text-teal-500 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                إذا لم يتم تحويلك، اضغط هنا
              </a>
            </div>
          ) : (
            <>
              <div className="bg-muted/30 rounded-lg p-3 text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-muted-foreground">المبلغ:</span>
                  <span className="font-bold">{(paymentData.amount / 100).toFixed(2)} ج.م</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">رقم الطلب:</span>
                  <span className="font-mono text-xs">{paymentData.orderId}</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">رقم المحفظة</label>
                <input
                  type="tel"
                  value={walletNumber}
                  onChange={(e) => setWalletNumber(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full px-3 py-2 rounded-lg border bg-background text-foreground"
                  dir="ltr"
                  maxLength={11}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  أدخل رقم المحفظة (فودافون كاش، أورانج كاش، إلخ)
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={onClose}
                  disabled={processing}
                >
                  إلغاء
                </Button>
                <Button
                  className="flex-1 bg-gradient-to-l from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700"
                  onClick={handleSubmit}
                  disabled={processing || !walletNumber}
                >
                  {processing ? (
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  ) : (
                    <Wallet className="w-4 h-4 ml-2" />
                  )}
                  {processing ? 'جاري المعالجة...' : 'ادفع الآن'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

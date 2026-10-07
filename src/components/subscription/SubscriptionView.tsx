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
  Globe,
  X,
  FileSpreadsheet,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/lib/store';
import type { User as AppUser } from '@/types';

// ==================== REGIONAL MARKETS CONFIG ====================

interface MarketPricingConfig {
  id: string;
  name: string;
  shortName: string;
  flag: string;
  currency: string;
  currencyAr: string;
  prices: {
    premium: { monthly: number; yearly: number; originalMonthly: number; discount: number };
    pro: { monthly: number; yearly: number; originalMonthly: number; discount: number };
    vip_pass: { monthly: number; yearly: number; originalMonthly: number; discount: number };
    developer: { monthly: number; yearly: number };
  };
}

const REGIONAL_MARKETS: MarketPricingConfig[] = [
  {
    id: 'egx',
    name: 'بورصة مصر (EGX)',
    shortName: 'مصر',
    flag: '🇪🇬',
    currency: 'EGP',
    currencyAr: 'ج.م',
    prices: {
      premium: { monthly: 99, yearly: 990, originalMonthly: 199, discount: 50 },
      pro: { monthly: 199, yearly: 1990, originalMonthly: 399, discount: 50 },
      vip_pass: { monthly: 249, yearly: 2490, originalMonthly: 699, discount: 65 },
      developer: { monthly: 599, yearly: 5990 },
    },
  },
  {
    id: 'tadawul',
    name: 'السوق السعودي (تداول)',
    shortName: 'السعودية',
    flag: '🇸🇦',
    currency: 'SAR',
    currencyAr: 'ر.س',
    prices: {
      premium: { monthly: 49, yearly: 490, originalMonthly: 99, discount: 50 },
      pro: { monthly: 89, yearly: 890, originalMonthly: 179, discount: 50 },
      vip_pass: { monthly: 99, yearly: 990, originalMonthly: 279, discount: 65 },
      developer: { monthly: 399, yearly: 3990 },
    },
  },
  {
    id: 'kse',
    name: 'بورصة الكويت (KSE)',
    shortName: 'الكويت',
    flag: '🇰🇼',
    currency: 'KWD',
    currencyAr: 'د.ك',
    prices: {
      premium: { monthly: 3.9, yearly: 39, originalMonthly: 7.9, discount: 50 },
      pro: { monthly: 7.5, yearly: 75, originalMonthly: 14.9, discount: 50 },
      vip_pass: { monthly: 7.9, yearly: 79, originalMonthly: 22.9, discount: 65 },
      developer: { monthly: 30, yearly: 300 },
    },
  },
  {
    id: 'qse',
    name: 'بورصة قطر (QSE)',
    shortName: 'قطر',
    flag: '🇶🇦',
    currency: 'QAR',
    currencyAr: 'ر.ق',
    prices: {
      premium: { monthly: 49, yearly: 490, originalMonthly: 99, discount: 50 },
      pro: { monthly: 89, yearly: 890, originalMonthly: 179, discount: 50 },
      vip_pass: { monthly: 99, yearly: 990, originalMonthly: 279, discount: 65 },
      developer: { monthly: 399, yearly: 3990 },
    },
  },
  {
    id: 'us',
    name: 'السوق الأمريكي (US Wall St)',
    shortName: 'أمريكا',
    flag: '🇺🇸',
    currency: 'USD',
    currencyAr: '$',
    prices: {
      premium: { monthly: 12.99, yearly: 129.99, originalMonthly: 24.99, discount: 50 },
      pro: { monthly: 24.99, yearly: 249.99, originalMonthly: 49.99, discount: 50 },
      vip_pass: { monthly: 24.99, yearly: 249.99, originalMonthly: 69.99, discount: 65 },
      developer: { monthly: 99, yearly: 990 },
    },
  },
  {
    id: 'crypto',
    name: 'العملات الرقمية والذهب',
    shortName: 'كريبتو وذهب',
    flag: '₿',
    currency: 'USD',
    currencyAr: '$',
    prices: {
      premium: { monthly: 12.99, yearly: 129.99, originalMonthly: 24.99, discount: 50 },
      pro: { monthly: 24.99, yearly: 249.99, originalMonthly: 49.99, discount: 50 },
      vip_pass: { monthly: 24.99, yearly: 249.99, originalMonthly: 69.99, discount: 65 },
      developer: { monthly: 99, yearly: 990 },
    },
  },
  {
    id: 'all',
    name: 'الباقة الشاملة VIP (كافة الأسواق الـ 6)',
    shortName: 'الباقة الشاملة VIP',
    flag: '👑',
    currency: 'USD',
    currencyAr: '$',
    prices: {
      premium: { monthly: 12.99, yearly: 129.99, originalMonthly: 24.99, discount: 50 },
      pro: { monthly: 24.99, yearly: 249.99, originalMonthly: 49.99, discount: 50 },
      vip_pass: { monthly: 24.99, yearly: 249.99, originalMonthly: 69.99, discount: 65 },
      developer: { monthly: 99, yearly: 990 },
    },
  },
];

// ==================== PLAN TYPES ====================

interface PlanFeature {
  icon: React.ReactNode;
  text: string;
  highlighted?: boolean;
  disabled?: boolean;
}

interface Plan {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  price: number;
  priceYearly: number;
  originalPrice?: number;
  discountPct?: number;
  popular?: boolean;
  premium?: boolean;
  pro?: boolean;
  vip?: boolean;
  developer?: boolean;
  cta: string;
  features: PlanFeature[];
  limits: {
    marketCount: string;
    watchlist: number | string;
    portfolio: number | string;
    alerts: number | string;
    makerRadar: boolean;
    predictions: boolean;
    exitPolicy: boolean;
    sharia: boolean;
    screener: boolean;
    bagholderRescue: boolean;
    exportData: boolean;
    telegram: boolean;
    prioritySupport: string;
    apiAccess: boolean;
  };
}

function buildPlans(marketConfig: MarketPricingConfig): Plan[] {
  const p = marketConfig.prices;

  return [
    {
      id: 'free',
      name: 'Free',
      nameAr: 'الأساسية',
      description: 'للمستثمر المبتدئ لتجربة المنصة واستكشاف الأساسيات',
      price: 0,
      priceYearly: 0,
      cta: 'ابدأ مجاناً',
      features: [
        { icon: <Eye className="w-4 h-4" />, text: 'قائمة مراقبة حتى 3 أسهم' },
        { icon: <Building2 className="w-4 h-4" />, text: 'محفظة واحدة (3 أسهم كحد أقصى)' },
        { icon: <Bell className="w-4 h-4" />, text: 'تنبيه سعر واحد فقط' },
        { icon: <BarChart3 className="w-4 h-4" />, text: 'بيانات وإغلاقات الجلسة السابقة (EOD)' },
        { icon: <Shield className="w-4 h-4" />, text: 'الفاحص الشرعي (محدود لـ 3 أسهم يومياً)' },
        { icon: <X className="w-4 h-4 text-muted-foreground/60" />, text: 'رادار صانع السوق والسيولة (مغلق)', disabled: true },
        { icon: <X className="w-4 h-4 text-muted-foreground/60" />, text: 'أهداف التوقعات ونقاط الدخول والوقف (مغلقة)', disabled: true },
        { icon: <X className="w-4 h-4 text-muted-foreground/60" />, text: 'محرك إنقاذ الأسهم الخاسرة (مغلق)', disabled: true },
      ],
      limits: {
        marketCount: '1 سوق',
        watchlist: 3,
        portfolio: 1,
        alerts: 1,
        makerRadar: false,
        predictions: false,
        exitPolicy: false,
        sharia: true,
        screener: false,
        bagholderRescue: false,
        exportData: false,
        telegram: false,
        prioritySupport: 'عادي (مجتمعي)',
        apiAccess: false,
      },
    },
    {
      id: 'premium',
      name: 'Premium',
      nameAr: 'بريميوم',
      description: 'للمستثمر الجاد — رادار صانع السوق وتدفق السيولة وأهداف التوقعات',
      price: p.premium.monthly,
      priceYearly: p.premium.yearly,
      originalPrice: p.premium.originalMonthly,
      discountPct: p.premium.discount,
      popular: true,
      premium: true,
      cta: 'اشترك الآن',
      features: [
        { icon: <Zap className="w-4 h-4" />, text: 'رادار صانع السوق وتدفق السيولة الذكية (تحديثات دورية)', highlighted: true },
        { icon: <TrendingUp className="w-4 h-4" />, text: 'أهداف التوقعات ونقاط الدخول ووقف الخسارة (TP1/TP2/SL)', highlighted: true },
        { icon: <Shield className="w-4 h-4" />, text: 'رادار وسياسة الخروج الاحترافية وجني الأرباح' },
        { icon: <Sparkles className="w-4 h-4" />, text: 'الفاحص الشرعي وحساب الزكاة والتطهير المالي كامل' },
        { icon: <BarChart3 className="w-4 h-4" />, text: 'فلاتر وتصفيات الأسهم المتقدمة (Stock Screener)' },
        { icon: <Bell className="w-4 h-4" />, text: 'إشعارات وتنبيهات تيليجرام الآلية للفرص' },
        { icon: <Infinity className="w-4 h-4" />, text: 'محافظ وقوائم مراقبة غير محدودة' },
        { icon: <Headphones className="w-4 h-4" />, text: 'دعم فني ذو أولوية خلال 24 ساعة' },
      ],
      limits: {
        marketCount: '1 سوق',
        watchlist: '∞',
        portfolio: '∞',
        alerts: '∞',
        makerRadar: true,
        predictions: true,
        exitPolicy: true,
        sharia: true,
        screener: true,
        bagholderRescue: false,
        exportData: false,
        telegram: true,
        prioritySupport: 'أولوية 24 ساعة',
        apiAccess: false,
      },
    },
    {
      id: 'pro',
      name: 'Pro',
      nameAr: 'برو',
      description: 'للمضارب المحترف — إنقاذ الأسهم الخاسرة وتصدير التقارير',
      price: p.pro.monthly,
      priceYearly: p.pro.yearly,
      originalPrice: p.pro.originalMonthly,
      discountPct: p.pro.discount,
      pro: true,
      cta: 'اشترك في برو',
      features: [
        { icon: <Crown className="w-4 h-4" />, text: 'كل مزايا باقة بريميوم بدون أي حدود' },
        { icon: <Rocket className="w-4 h-4" />, text: 'محرك إنقاذ الأسهم الخاسرة الذكي (Bagholder Rescue)', highlighted: true },
        { icon: <Eye className="w-4 h-4" />, text: 'فلاتر واستراتيجيات مخصصة متقدمة (Custom Screeners)' },
        { icon: <FileSpreadsheet className="w-4 h-4" />, text: 'تصدير كامل للبيانات والتقارير المالية (Excel / CSV)' },
        { icon: <Bell className="w-4 h-4" />, text: 'تنبيهات فورية متعددة القنوات غير محدودة' },
        { icon: <Brain className="w-4 h-4" />, text: 'ذاكرة التداول وسجل تحليل سلوك المحفظة' },
        { icon: <Key className="w-4 h-4" />, text: 'وصول API للاستعلامات المباشرة (1000 طلب/يوم)' },
        { icon: <Headphones className="w-4 h-4" />, text: 'دعم فني فائق السرعة خلال 4 ساعات' },
      ],
      limits: {
        marketCount: '1 سوق',
        watchlist: '∞',
        portfolio: '∞',
        alerts: '∞',
        makerRadar: true,
        predictions: true,
        exitPolicy: true,
        sharia: true,
        screener: true,
        bagholderRescue: true,
        exportData: true,
        telegram: true,
        prioritySupport: 'فائق السرعة 4 ساعات',
        apiAccess: true,
      },
    },
    {
      id: 'vip_pass',
      name: 'VIP Pass',
      nameAr: 'الباقة الشاملة VIP',
      description: 'جميع أسواق المال الـ 6 في اشتراك واحد — أعلى عائد وأشمل تغطية',
      price: p.vip_pass.monthly,
      priceYearly: p.vip_pass.yearly,
      originalPrice: p.vip_pass.originalMonthly,
      discountPct: p.vip_pass.discount,
      vip: true,
      cta: 'اشترك في VIP الشاملة',
      features: [
        { icon: <Crown className="w-4 h-4 text-amber-500" />, text: 'فتح جميع أسواق المنصة الـ 6 في اشتراك موحد', highlighted: true },
        { icon: <Globe className="w-4 h-4" />, text: '🇪🇬 مصر + 🇸🇦 السعودية + 🇰🇼 الكويت + 🇶🇦 قطر + 🇺🇸 أمريكا + ₿ كريبتو وذهب', highlighted: true },
        { icon: <Zap className="w-4 h-4" />, text: 'رادار صانع السوق وتدفق السيولة لجميع البورصات معاً' },
        { icon: <TrendingUp className="w-4 h-4" />, text: 'أهداف التوقعات ورادار الخروج لكافة الأسواق' },
        { icon: <Rocket className="w-4 h-4" />, text: 'محرك إنقاذ الأسهم الخاسرة لجميع الأسواق' },
        { icon: <Bell className="w-4 h-4" />, text: 'قنوات تيليجرام مخصصة لكل سوق بدون قيود' },
        { icon: <Infinity className="w-4 h-4" />, text: 'جميع مزايا باقة برو لكل الأسواق معاً' },
        { icon: <MessageCircle className="w-4 h-4" />, text: 'خط دعم مباشر VIP عبر واتساب على مدار الساعة', highlighted: true },
      ],
      limits: {
        marketCount: 'جميع الأسواق (6)',
        watchlist: '∞',
        portfolio: '∞',
        alerts: '∞',
        makerRadar: true,
        predictions: true,
        exitPolicy: true,
        sharia: true,
        screener: true,
        bagholderRescue: true,
        exportData: true,
        telegram: true,
        prioritySupport: 'واتساب VIP مباشر 24/7',
        apiAccess: true,
      },
    },
  ];
}

// ==================== COMPONENT ====================

export function SubscriptionView() {
  const { data: session, status } = useSession();
  const { user, setCurrentView, setUser } = useAppStore();
  const searchParams = useSearchParams();
  const isLoggedIn = !!user || status === 'authenticated';

  const [selectedMarketId, setSelectedMarketId] = useState<string>('egx');
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

  // Auto-detect user market on initial load
  useEffect(() => {
    try {
      const lang = navigator.language.toLowerCase();
      if (lang.startsWith('ar-sa')) setSelectedMarketId('tadawul');
      else if (lang.startsWith('ar-kw')) setSelectedMarketId('kse');
      else if (lang.startsWith('ar-qa')) setSelectedMarketId('qse');
      else if (lang.startsWith('en-us') || lang.startsWith('en')) setSelectedMarketId('us');
      else setSelectedMarketId('egx');
    } catch {
      setSelectedMarketId('egx');
    }
  }, []);

  // Promo Code State
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

  const currentMarket =
    REGIONAL_MARKETS.find((m) => m.id === selectedMarketId) || REGIONAL_MARKETS[0];
  const plans = buildPlans(currentMarket);

  const handleStartFreeTrial = async () => {
    if (!isLoggedIn) {
      setCurrentView('auth');
      return;
    }

    try {
      setLoading('free-trial');
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
        }

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

      const response = await fetch('/api/paymob/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: plan.id,
          market: selectedMarketId,
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
        window.location.href = data.payment_url;
      } else {
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
      setSelectedPlan(plan);
      setShowContactModal(true);
    } else {
      setSelectedPlan(plan);
      setShowPaymentOptions(true);
    }
  };

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dismissed_subscription_view', 'true');
      window.dispatchEvent(new CustomEvent('dismiss_subscription_view'));
    }
    setCurrentView('dashboard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-emerald-950/20 pb-20" dir="rtl">
      {/* Sticky Top Dismiss & Action Bar */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border/80 px-4 py-2.5 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDismiss}
              className="gap-2 border-emerald-600/30 hover:bg-emerald-500/10 text-foreground font-bold transition-all shadow-sm"
              title="إغلاق والعودة للشاشة السابقة"
            >
              <X className="w-4 h-4 text-emerald-500" />
              <span>إغلاق والعودة للمنصة</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                handleDismiss();
                toast.info('يمكنك تصفح المنصة وتجربة التحليلات والأسهم مجاناً');
              }}
              className="text-xs text-muted-foreground hover:text-foreground hidden sm:flex"
            >
              تخطي وتجربة المنصة
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {!isLoggedIn ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => setCurrentView('auth')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-xs font-bold shadow-md shadow-emerald-600/20"
              >
                <span>تسجيل الدخول / إنشاء حساب</span>
              </Button>
            ) : (
              <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                مرحباً {user?.username || user?.email?.split('@')[0]}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Special Offer Banner */}
      <div className="bg-gradient-to-l from-emerald-600 via-teal-600 to-emerald-700 text-white shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex flex-col md:flex-row items-center justify-center gap-2 md:gap-4 text-center md:text-right">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 animate-pulse text-amber-300" />
              <span className="font-bold text-lg">عرض إطلاق الأسواق الجديد!</span>
            </div>
            <span className="text-emerald-50 text-sm md:text-base font-medium">
              خصم فوري يصل إلى <span className="text-amber-300 font-bold underline">65%</span> على جميع الباقات لجميع الأسواق العربية والعالمية
            </span>
            <div className="flex items-center gap-1 bg-white/20 rounded-full px-3 py-1">
              <Clock className="w-4 h-4 text-amber-200" />
              <span className="text-xs font-semibold">لفترة محدودة</span>
            </div>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-transparent to-transparent" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-20 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 pt-12 pb-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 mb-6 shadow-2xl shadow-emerald-500/30">
              <Crown className="w-10 h-10 text-white" />
            </div>

            <h1 className="text-4xl md:text-5xl font-extrabold text-foreground mb-4 tracking-tight">
              اختر باقتك وسوقك المفضل
            </h1>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
              تحليلات حقيقية تعتمد على رادار صانع السوق والسيولة وأهداف التوقعات المحسوبة، مدعومة بالفاحص الشرعي ومحرك إنقاذ الأسهم.
            </p>

            {/* Trust Badges */}
            <div className="flex flex-wrap items-center justify-center gap-6 mb-10 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-500" />
                <span>دفع مشفر وآمن 100%</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-500" />
                <span>إلغاء الاشتراك في أي وقت</span>
              </div>
              <div className="flex items-center gap-2">
                <Headphones className="w-4 h-4 text-emerald-500" />
                <span>دعم فني متخصص ومباشر</span>
              </div>
            </div>

            {/* Regional Markets Switcher Tabs */}
            <div className="max-w-4xl mx-auto mb-8">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 text-center">
                اختر البورصة أو السوق المالي
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 bg-muted/60 backdrop-blur-sm rounded-2xl border border-border/60 shadow-inner">
                {REGIONAL_MARKETS.map((m) => {
                  const isSelected = selectedMarketId === m.id;
                  const isVipTab = m.id === 'all';
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMarketId(m.id)}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold transition-all duration-200 ${
                        isSelected
                          ? isVipTab
                            ? 'bg-gradient-to-l from-amber-500 to-yellow-600 text-white shadow-lg shadow-amber-500/30 ring-2 ring-amber-400'
                            : 'bg-gradient-to-l from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/30'
                          : 'text-muted-foreground hover:text-foreground hover:bg-background/70'
                      }`}
                    >
                      <span className="text-base">{m.flag}</span>
                      <span>{m.shortName}</span>
                      {isVipTab && (
                        <Badge className="bg-amber-300 text-amber-950 text-[10px] px-1.5 py-0 border-0 font-extrabold animate-pulse">
                          الأقوى
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Billing Toggle */}
            <div className="inline-flex items-center gap-3 bg-muted/70 rounded-full p-1.5 border border-border/50">
              <button
                onClick={() => setBillingPeriod('monthly')}
                className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${
                  billingPeriod === 'monthly'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                اشتراك شهري
              </button>
              <button
                onClick={() => setBillingPeriod('yearly')}
                className={`px-5 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${
                  billingPeriod === 'yearly'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                اشتراك سنوي
                <Badge className="bg-emerald-500 text-white text-[10px] px-2 py-0.5 font-bold">
                  وفر شهرين مجاناً 🎁
                </Badge>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Promo Code Card */}
      <div className="max-w-3xl mx-auto px-4 pb-10">
        <Card className="overflow-hidden border-2 border-emerald-500/30 shadow-lg shadow-emerald-500/5 bg-background/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/30">
                <Tag className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  هل لديك كود خصم أو ترقية؟
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] px-2 py-0.5">
                    Promo Code
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  أدخل كود الترقية الخاص بك لتفعيل باقتك المتقدمة فوراً
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={promoCode}
                onChange={(e) => {
                  setPromoCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
                  if (promoSuccess) setPromoSuccess(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !promoLoading && promoCode.trim()) {
                    handleRedeemPromo();
                  }
                }}
                placeholder="مثال: WELCOME90"
                dir="ltr"
                className="text-center font-mono tracking-widest text-base uppercase h-11"
                maxLength={64}
                disabled={promoLoading}
                aria-label="كود الخصم"
              />
              <Button
                onClick={handleRedeemPromo}
                disabled={promoLoading || !promoCode.trim()}
                className="h-11 sm:min-w-[140px] bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold"
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
          </CardContent>
        </Card>
      </div>

      {/* Plans Grid */}
      <div className="max-w-7xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              market={currentMarket}
              billingPeriod={billingPeriod}
              onSelect={() => handlePlanSelect(plan)}
              loading={loading}
            />
          ))}
        </div>

        {/* Enterprise & Developer B2B Section */}
        <div className="mt-12 max-w-5xl mx-auto">
          <Card className="border-2 border-violet-500/30 bg-gradient-to-br from-violet-500/5 via-background to-purple-500/5 shadow-xl">
            <CardContent className="p-6 md:p-8">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4 text-center md:text-right">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/30">
                    <Key className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center justify-center md:justify-start gap-2 mb-1">
                      <h3 className="text-xl font-bold">باقة الشركات والمطورين (Enterprise & API)</h3>
                      <Badge className="bg-violet-500/20 text-violet-600 dark:text-violet-300 border border-violet-500/30 text-xs">
                        B2B Solutions
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      وصول كامل لواجهة برمجة التطبيقات (API) + Webhooks للتنبيهات اللحظية + معدل استعلامات عالي + لوحة تحكم مخصصة.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-4 flex-shrink-0">
                  <div className="text-center sm:text-right">
                    <div className="text-sm text-muted-foreground">تبدأ من</div>
                    <div className="text-2xl font-black text-foreground" dir="ltr">$99 <span className="text-xs text-muted-foreground font-normal">/شهر</span></div>
                  </div>
                  <Button
                    onClick={() => {
                      setSelectedPlan({
                        id: 'developer',
                        name: 'Developer',
                        nameAr: 'الشركات والمطورين',
                        description: 'للشركات والمؤسسات (B2B)',
                        price: currentMarket.prices.developer.monthly,
                        priceYearly: currentMarket.prices.developer.yearly,
                        cta: 'تواصل معنا',
                        features: [],
                        limits: {
                          marketCount: 'كل الأسواق',
                          watchlist: '∞',
                          portfolio: '∞',
                          alerts: '∞',
                          makerRadar: true,
                          predictions: true,
                          exitPolicy: true,
                          sharia: true,
                          screener: true,
                          bagholderRescue: true,
                          exportData: true,
                          telegram: true,
                          prioritySupport: 'مخصص',
                          apiAccess: true,
                        },
                      });
                      setShowContactModal(true);
                    }}
                    className="bg-gradient-to-l from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-bold px-6 py-5 shadow-lg shadow-violet-500/20"
                  >
                    <Mail className="w-4 h-4 ml-2" />
                    طلب حساب مطور B2B
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Features Comparison */}
      <div className="bg-muted/40 py-16 border-y border-border/60">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-extrabold mb-3">مقارنة شاملة بين الباقات</h2>
            <p className="text-muted-foreground text-sm max-w-xl mx-auto">
              تفاصيل دقيقة لكل ما تقدمه المنصة بدون أي وعود وهمية أو خصائص غير موجودة
            </p>
          </div>
          <ComparisonTable plans={plans} market={currentMarket} billingPeriod={billingPeriod} />
        </div>
      </div>

      {/* FAQ Section */}
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold mb-2">الأسئلة الشائعة</h2>
          <p className="text-sm text-muted-foreground">كل ما تريد معرفته عن الاشتراكات وتفعيل الحسابات</p>
        </div>
        <div className="space-y-4">
          <FAQItem
            question="ما هو الفرق بين الباقة الفردية والباقة الشاملة VIP؟"
            answer="الباقة الفردية (بريميوم أو برو) تفتح لك سوقاً واحداً تختاره (مثل السوق المصري أو السعودي أو الأمريكي). بينما الباقة الشاملة VIP تفتح لك جميع الأسواق الـ 6 معاً (مصر + السعودية + الكويت + قطر + أمريكا + كريبتو وذهب) مع كامل مزايا برو وقنوات التليجرام لكل الأسواق وخط دعم واتساب VIP مباشر."
          />
          <FAQItem
            question="كيف يعمل الفاحص الشرعي وهل يغطي جميع الأسواق؟"
            answer="الفاحص الشرعي في المنصة يفحص نسب الديون والفوائد والتوافق المالي وفق المعايير الشرعية المعتمدة (AAOIFI)، ويحسب نسب التطهير المالي ومقدار الزكاة الواجبة على الأسهم. وهو متاح بالكامل لمشتركي بريميوم وبرو والـ VIP."
          />
          <FAQItem
            question="ما هو محرك إنقاذ الأسهم الخاسرة (Bagholder Rescue)؟"
            answer="أداة حسابية متقدمة في باقتي برو و VIP مخصصة للأسهم المتعلقة أو المحافظ الخاسرة؛ حيث تحسب بدقة أفضل نقاط تعديل متوسط السعر (Average Down) أو التخفيف عند الارتدادات لتقليل الخسائر والتعافي بأقل مخاطرة ممكنة."
          />
          <FAQItem
            question="ما هي طرق الدفع المتاحة داخل وخارج مصر؟"
            answer="في مصر: نقبل بطاقات فيزا وماستركارد، ومحافظ إلكترونية (فودافون كاش، أورانج، وي، اتصالات)، وكذلك الدفع الفوري عبر InstaPay. ومن دول الخليج وباقي العالم: نقبل جميع البطاقات الائتمانية الدولية بجميع العملات بأمان تام."
          />
          <FAQItem
            question="هل يتم تجديد الاشتراك تلقائياً؟ وهل يمكنني الإلغاء في أي وقت؟"
            answer="نعم، يمكنك إلغاء التجديد التلقائي في أي وقت بضغطة زر واحدة من إعدادات حسابك دون أي رسوم إضافية، وستحتفظ بكامل المزايا حتى آخر دقيقة في مدة اشتراكك المدفوعة."
          />
        </div>
      </div>

      {/* Payment Options Modal */}
      {showPaymentOptions && selectedPlan && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-2xl border-2 border-emerald-500/40">
            <CardHeader className="text-center pb-3">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-3 shadow-lg shadow-emerald-500/30">
                <CreditCard className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-xl font-bold">إتمام الاشتراك في {selectedPlan.nameAr}</CardTitle>
              <CardDescription className="text-sm">
                سوق: {currentMarket.name} — السعر:{' '}
                <span className="font-bold text-foreground" dir="ltr">
                  {billingPeriod === 'yearly'
                    ? `${selectedPlan.priceYearly} ${currentMarket.currencyAr} / سنة`
                    : `${selectedPlan.price} ${currentMarket.currencyAr} / شهر`}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Free Trial Button */}
              <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5">
                <div className="flex items-center gap-3 mb-1">
                  <Gift className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-bold text-sm">تجربة مجانية</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  ابدأ فوراً بالتجربة المجانية لمدة شهر مع المزايا الأساسية
                </p>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9"
                  onClick={handleStartFreeTrial}
                  disabled={loading === 'free-trial'}
                >
                  {loading === 'free-trial' ? (
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  ) : (
                    <Gift className="w-4 h-4 ml-2" />
                  )}
                  {loading === 'free-trial' ? 'جاري التفعيل...' : 'ابدأ مجاناً الآن'}
                </Button>
              </div>

              {/* InstaPay Option for Egypt */}
              {selectedMarketId === 'egx' && (
                <div className="p-4 rounded-xl border border-purple-500/40 bg-purple-500/5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Zap className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      <span className="font-bold text-sm">الدفع السريع عبر InstaPay</span>
                    </div>
                    <Badge className="bg-purple-600 text-white text-[10px] px-2 py-0">فوري</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    حول المبلغ مباشرة لحساب إنستاباي ويتم التفعيل الفوري
                  </p>
                  <a
                    href="https://ipn.eg/S/enmohsen20111975qnb/instapay/36uC2o"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button
                      className="w-full bg-gradient-to-l from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white font-bold text-xs h-9"
                      type="button"
                    >
                      ادفع عبر InstaPay
                    </Button>
                  </a>
                  <p className="text-[11px] text-center text-muted-foreground mt-2 font-mono" dir="ltr">
                    enmohsen20111975qnb@instapay
                  </p>
                </div>
              )}

              {/* Paymob Gateway Options */}
              <div className="p-4 rounded-xl border bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard className="w-5 h-5 text-foreground" />
                  <span className="font-bold text-sm">بوابة الدفع الإلكتروني (Paymob)</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  دفع آمن بالبطاقات الائتمانية الدولية أو المحافظ الإلكترونية
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    className="bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs h-10"
                    onClick={() => handlePaidSubscription(selectedPlan, 'card')}
                    disabled={loading === selectedPlan.id}
                  >
                    {loading === selectedPlan.id ? (
                      <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4 ml-1" />
                    )}
                    بطاقة بنكية
                  </Button>
                  <Button
                    className="bg-gradient-to-l from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white font-bold text-xs h-10"
                    onClick={() => handlePaidSubscription(selectedPlan, 'wallet')}
                    disabled={loading === selectedPlan.id}
                  >
                    {loading === selectedPlan.id ? (
                      <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                    ) : (
                      <Wallet className="w-4 h-4 ml-1" />
                    )}
                    محفظة إلكترونية
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full text-xs h-9"
                onClick={() => setShowPaymentOptions(false)}
              >
                إلغاء
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Developer Contact Modal */}
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
  market,
  billingPeriod,
  onSelect,
  loading,
}: {
  plan: Plan;
  market: MarketPricingConfig;
  billingPeriod: 'monthly' | 'yearly';
  onSelect: () => void;
  loading: string | null;
}) {
  const displayPrice = billingPeriod === 'yearly' ? plan.priceYearly : plan.price;
  const monthlyPrice = billingPeriod === 'yearly' ? Math.round(plan.priceYearly / 12) : plan.price;
  const isLoading = loading === plan.id;

  return (
    <Card
      className={`relative flex flex-col justify-between overflow-hidden transition-all duration-300 hover:shadow-2xl ${
        plan.vip
          ? 'border-2 border-amber-400 bg-gradient-to-b from-amber-500/10 via-background to-amber-500/5 shadow-xl shadow-amber-500/10 ring-2 ring-amber-400/50'
          : plan.popular
          ? 'border-2 border-emerald-500 dark:border-emerald-600 shadow-xl shadow-emerald-500/10'
          : plan.pro
          ? 'border-2 border-purple-500 dark:border-purple-600 shadow-xl shadow-purple-500/10'
          : 'border border-border/80 hover:border-emerald-500/50'
      }`}
    >
      {/* Top Badges */}
      {plan.popular && !plan.vip && (
        <div className="absolute -top-px left-0 right-0">
          <div className="bg-gradient-to-l from-emerald-500 to-teal-600 text-white text-center py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
            الأكثر طلباً 🔥
          </div>
        </div>
      )}

      {plan.vip && (
        <div className="absolute -top-px left-0 right-0">
          <div className="bg-gradient-to-l from-amber-500 via-yellow-500 to-amber-600 text-amber-950 text-center py-1.5 text-xs font-black flex items-center justify-center gap-1.5 shadow-md">
            <Crown className="w-4 h-4 fill-amber-950" />
            الباقة الأقوى قيمة (كافة الأسواق 👑)
          </div>
        </div>
      )}

      {plan.pro && (
        <div className="absolute -top-px left-0 right-0">
          <div className="bg-gradient-to-l from-purple-600 to-fuchsia-600 text-white text-center py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm">
            <Rocket className="w-3.5 h-3.5" />
            للمضارب المحترف ⚡
          </div>
        </div>
      )}

      <div>
        <CardHeader className={`text-center ${plan.popular || plan.pro || plan.vip ? 'pt-11' : 'pt-6'}`}>
          <div
            className={`mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${
              plan.vip
                ? 'bg-gradient-to-br from-amber-400 to-yellow-500 text-amber-950 shadow-lg shadow-amber-500/30'
                : plan.pro
                ? 'bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white shadow-md shadow-purple-500/20'
                : plan.popular
                ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {plan.vip ? (
              <Crown className="w-6 h-6" />
            ) : plan.pro ? (
              <Zap className="w-6 h-6" />
            ) : plan.popular ? (
              <Star className="w-6 h-6" />
            ) : (
              <Shield className="w-6 h-6" />
            )}
          </div>

          <CardTitle className="text-xl font-bold mb-1">{plan.nameAr}</CardTitle>
          <CardDescription className="text-xs min-h-[32px]">{plan.description}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Price Tag with Strikethrough & Discount Badge */}
          <div className="text-center py-2 bg-muted/40 rounded-xl border border-border/40">
            {plan.price === 0 ? (
              <div className="flex items-center justify-center gap-2">
                <span className="text-3xl font-extrabold text-foreground">مجاني</span>
                <Badge className="bg-emerald-500 text-white text-xs">للأبد</Badge>
              </div>
            ) : (
              <>
                {plan.originalPrice && (
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-sm text-muted-foreground line-through font-mono">
                      {billingPeriod === 'yearly' ? plan.originalPrice * 10 : plan.originalPrice} {market.currencyAr}
                    </span>
                    <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 text-[10px] font-black px-1.5 py-0">
                      وفر {plan.discountPct}% 🔥
                    </Badge>
                  </div>
                )}
                <div className="flex items-baseline justify-center gap-1.5">
                  <span className="text-3xl md:text-4xl font-black text-foreground font-mono" dir="ltr">
                    {displayPrice}
                  </span>
                  <span className="text-sm font-bold text-muted-foreground">{market.currencyAr}</span>
                  <span className="text-xs text-muted-foreground">
                    / {billingPeriod === 'yearly' ? 'سنة' : 'شهر'}
                  </span>
                </div>
                {billingPeriod === 'yearly' && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
                    يعادل {monthlyPrice} {market.currencyAr} شهرياً
                  </p>
                )}
              </>
            )}
          </div>

          <Separator />

          {/* Features List */}
          <ul className="space-y-2.5 text-xs">
            {plan.features.map((feature, idx) => (
              <li
                key={idx}
                className={`flex items-start gap-2.5 ${
                  feature.disabled
                    ? 'text-muted-foreground/60 line-through'
                    : feature.highlighted
                    ? 'text-emerald-700 dark:text-emerald-300 font-bold'
                    : 'text-foreground'
                }`}
              >
                <span className="flex-shrink-0 mt-0.5">
                  {feature.disabled ? (
                    <X className="w-3.5 h-3.5 text-muted-foreground/50" />
                  ) : (
                    <Check className={`w-3.5 h-3.5 ${feature.highlighted ? 'text-emerald-500' : 'text-emerald-500'}`} />
                  )}
                </span>
                <span className="leading-snug">{feature.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </div>

      <div className="p-6 pt-0 mt-4">
        <Button
          className={`w-full py-5 text-sm font-bold shadow-md transition-all ${
            plan.vip
              ? 'bg-gradient-to-l from-amber-500 via-yellow-500 to-amber-600 hover:from-amber-600 hover:to-yellow-700 text-amber-950 font-black shadow-amber-500/25 ring-2 ring-amber-400'
              : plan.popular
              ? 'bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-emerald-500/25'
              : plan.pro
              ? 'bg-gradient-to-l from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 text-white shadow-purple-500/25'
              : 'bg-muted-foreground/20 text-foreground hover:bg-muted-foreground/30'
          }`}
          onClick={onSelect}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 ml-2 animate-spin" />
          ) : (
            <>
              {plan.price === 0 && <Rocket className="w-4 h-4 ml-2" />}
              {plan.popular && !plan.vip && <Zap className="w-4 h-4 ml-2" />}
              {plan.pro && <Rocket className="w-4 h-4 ml-2" />}
              {plan.vip && <Crown className="w-4 h-4 ml-2 fill-amber-950" />}
            </>
          )}
          {isLoading ? 'جاري التحميل...' : plan.cta}
        </Button>
        {plan.price > 0 && (
          <p className="text-[10px] text-center text-muted-foreground mt-2">
            بدون التزام · إلغاء في أي وقت
          </p>
        )}
      </div>
    </Card>
  );
}

// ==================== COMPARISON TABLE ====================

function ComparisonTable({
  plans,
  market,
  billingPeriod,
}: {
  plans: Plan[];
  market: MarketPricingConfig;
  billingPeriod: 'monthly' | 'yearly';
}) {
  return (
    <Card className="overflow-hidden border border-border/80 shadow-md">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs md:text-sm">
            <thead>
              <tr className="border-b bg-muted/60">
                <th className="text-right py-4 px-4 font-bold">الميزة / الأداة</th>
                {plans.map((p) => (
                  <th
                    key={p.id}
                    className={`text-center py-4 px-3 font-bold ${
                      p.vip
                        ? 'text-amber-500 bg-amber-500/5'
                        : p.popular
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : ''
                    }`}
                  >
                    {p.nameAr}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <ComparisonRow
                label="السعر"
                plans={plans}
                getValue={(p) =>
                  p.price === 0
                    ? 'مجاني'
                    : `${billingPeriod === 'yearly' ? p.priceYearly : p.price} ${market.currencyAr}`
                }
                highlight
              />
              <ComparisonRow
                label="تغطية الأسواق المتاحة"
                plans={plans}
                getValue={(p) => p.limits.marketCount}
                highlight
              />
              <ComparisonRow
                label="قوائم المراقبة (Watchlists)"
                plans={plans}
                getValue={(p) =>
                  typeof p.limits.watchlist === 'string' ? 'غير محدود' : `${p.limits.watchlist} أسهم`
                }
              />
              <ComparisonRow
                label="المحافظ الاستثمارية"
                plans={plans}
                getValue={(p) =>
                  typeof p.limits.portfolio === 'string' ? 'غير محدود' : `${p.limits.portfolio} محفظة`
                }
              />
              <ComparisonRow
                label="تنبيهات الأسعار"
                plans={plans}
                getValue={(p) =>
                  typeof p.limits.alerts === 'string' ? 'غير محدود' : `${p.limits.alerts} تنبيه`
                }
              />
              <ComparisonRow
                label="رادار صانع السوق والسيولة الذكية"
                plans={plans}
                getValue={(p) => p.limits.makerRadar}
                isBoolean
                highlight
              />
              <ComparisonRow
                label="أهداف التوقعات ونقاط الدخول والوقف (TP1/TP2/SL)"
                plans={plans}
                getValue={(p) => p.limits.predictions}
                isBoolean
                highlight
              />
              <ComparisonRow
                label="رادار وسياسة الخروج الاحترافية"
                plans={plans}
                getValue={(p) => p.limits.exitPolicy}
                isBoolean
              />
              <ComparisonRow
                label="الفاحص الشرعي وحساب الزكاة والتطهير"
                plans={plans}
                getValue={(p) => (p.id === 'free' ? 'محدود (3 يومياً)' : true)}
                isBoolean
              />
              <ComparisonRow
                label="فلاتر وتصفيات الأسهم المتقدمة (Stock Screener)"
                plans={plans}
                getValue={(p) => p.limits.screener}
                isBoolean
              />
              <ComparisonRow
                label="محرك إنقاذ الأسهم الخاسرة (Bagholder Rescue)"
                plans={plans}
                getValue={(p) => p.limits.bagholderRescue}
                isBoolean
                highlight
              />
              <ComparisonRow
                label="تصدير التقارير والبيانات (Excel / CSV)"
                plans={plans}
                getValue={(p) => p.limits.exportData}
                isBoolean
              />
              <ComparisonRow
                label="إشعارات وقنوات التليجرام الآلية"
                plans={plans}
                getValue={(p) => (p.vip ? 'جميع قنوات الـ 6 أسواق' : p.limits.telegram ? 'قناة السوق المختار' : false)}
                isBoolean
              />
              <ComparisonRow
                label="مستوى الدعم الفني"
                plans={plans}
                getValue={(p) => p.limits.prioritySupport}
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
    <tr className={`border-b last:border-0 ${highlight ? 'bg-muted/30 font-semibold' : ''}`}>
      <td className="py-3 px-4 text-xs md:text-sm">{label}</td>
      {plans.map((p) => {
        const value = getValue(p);
        return (
          <td
            key={p.id}
            className={`text-center py-3 px-3 text-xs md:text-sm ${p.vip ? 'bg-amber-500/5' : ''}`}
          >
            {isBoolean ? (
              typeof value === 'string' ? (
                <span className="text-xs">{value}</span>
              ) : value ? (
                <Check className="w-4 h-4 text-emerald-500 mx-auto" />
              ) : (
                <span className="text-muted-foreground/30 mx-auto block">—</span>
              )
            ) : (
              <span>{value}</span>
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
    <Card className="overflow-hidden border border-border/70 shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-right hover:bg-muted/40 transition-colors"
      >
        <span className="font-bold text-sm md:text-base">{question}</span>
        <ChevronLeft
          className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${
            isOpen ? '-rotate-90 text-primary' : ''
          }`}
        />
      </button>
      {isOpen && (
        <div className="px-4 pb-4 text-xs md:text-sm text-muted-foreground leading-relaxed border-t bg-muted/20 pt-3">
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
        const subject = encodeURIComponent(`طلب اشتراك باقة المطورين - ${plan.nameAr}`);
        const body = encodeURIComponent(
          `الاسم: ${name}\n` +
            `البريد: ${email}\n` +
            `الشركة: ${company}\n` +
            `حالة الاستخدام: ${useCase}\n` +
            `الباقة: ${plan.nameAr}\n` +
            `الفترة: ${billingPeriod === 'yearly' ? 'سنوي' : 'شهري'}`
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto border-2 border-violet-500/40">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg shadow-violet-500/30">
            <Key className="w-7 h-7 text-white" />
          </div>
          <CardTitle className="text-xl font-bold">باقة الشركات والمطورين (Enterprise & API)</CardTitle>
          <CardDescription className="text-xs">
            حلول مخصصة للشركات والوسطاء الماليين مع وصول API فائق السرعة
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/40 rounded-xl p-3 text-xs space-y-1.5 border">
            <p className="font-bold">مميزات باقة المطورين:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>• وصول كامل لـ API لجميع الأسواق (مصر، تداول، كويت، قطر، أمريكا، كريبتو)</li>
              <li>• Webhooks فورية لإشارات السيولة والتنبيهات</li>
              <li>• Rate Limit عالي مع مفاتيح متعددة (API Keys)</li>
              <li>• تصدير قواعد البيانات والتقارير المالية</li>
              <li>• مدير حساب مخصص ودعم فني مباشر للمؤسسات</li>
            </ul>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold mb-1 block">البريد الإلكتروني *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="developer@company.com"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-xs"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">الاسم</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسمك الكريم"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">اسم الشركة / المؤسسة</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="اسم شركتك"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">طبيعة الاستخدام ونطاق العمل</label>
              <textarea
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                placeholder="كيف تخطط لاستخدام الـ API والخدمات المالية؟"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground min-h-[70px] text-xs"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 text-xs" onClick={onClose} disabled={submitting}>
              إلغاء
            </Button>
            <Button
              className="flex-1 bg-gradient-to-l from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-bold text-xs"
              onClick={handleSubmit}
              disabled={submitting || !email}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <Mail className="w-4 h-4 ml-2" />
              )}
              {submitting ? 'جاري الإرسال...' : 'إرسال طلب الانضمام'}
            </Button>
          </div>
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-2 border-purple-500/40">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center mb-3 shadow-lg shadow-purple-500/30">
            <Wallet className="w-7 h-7 text-white" />
          </div>
          <CardTitle className="text-lg font-bold">الدفع بالمحفظة الإلكترونية</CardTitle>
          <CardDescription className="text-xs">
            أدخل رقم محفظتك لإتمام عملية الدفع عبر Paymob
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {redirectUrl ? (
            <div className="text-center space-y-3 py-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Loader2 className="w-7 h-7 text-emerald-600 animate-spin" />
              </div>
              <p className="font-bold text-sm text-emerald-600">جاري تحويلك لصفحة الدفع...</p>
              <p className="text-xs text-muted-foreground">سيتم تحويلك تلقائياً خلال لحظات</p>
              <a
                href={redirectUrl}
                className="text-xs text-teal-500 underline font-semibold"
                target="_blank"
                rel="noopener noreferrer"
              >
                إذا لم يتم تحويلك اضغط هنا
              </a>
            </div>
          ) : (
            <>
              <div className="bg-muted/40 rounded-xl p-3 text-xs space-y-1 border">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">المبلغ المطلوب:</span>
                  <span className="font-bold text-foreground font-mono">
                    {(paymentData.amount / 100).toFixed(2)} ج.م
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">رقم الطلب:</span>
                  <span className="font-mono text-[11px]">{paymentData.orderId}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 block">رقم المحفظة</label>
                <input
                  type="tel"
                  value={walletNumber}
                  onChange={(e) => setWalletNumber(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-xs"
                  dir="ltr"
                  maxLength={11}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  أدخل رقم المحفظة (فودافون كاش، أورانج كاش، وي باي، اتصالات كاش)
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 text-xs" onClick={onClose} disabled={processing}>
                  إلغاء
                </Button>
                <Button
                  className="flex-1 bg-gradient-to-l from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white font-bold text-xs"
                  onClick={handleSubmit}
                  disabled={processing}
                >
                  {processing ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Wallet className="w-4 h-4 ml-1" />}
                  {processing ? 'جاري التأكيد...' : 'تأكيد الدفع'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

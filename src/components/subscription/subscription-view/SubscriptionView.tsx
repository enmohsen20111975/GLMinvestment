/**
 * subscription-view/SubscriptionView.tsx (container, < 500 LOC)
 * ============================================================
 * The main container for the SubscriptionView — owns only:
 * - UI state (selectedMarketId, billingPeriod, selectedPlan, show*Modal flags,
 *   loading, promoCode, promoLoading, promoSuccess, walletPaymentData).
 * - Side-effects: auto-detect user market from navigator.language, listen for
 *   the `payment` search-param callback (success / failed).
 * - Action handlers: handleStartFreeTrial, handleRedeemPromo, handlePaidSubscription,
 *   handlePlanSelect, handleDismiss.
 * - Composition: TopBar + hero banner + HeroSection + PromoCodeCard + plans grid +
 *   EnterpriseSection + ComparisonTable + FAQ section + PaymentOptionsModal +
 *   DeveloperContactModal + WalletPaymentModal.
 *
 * All heavy presentational sub-components live in surrounding files:
 * - constants.ts (REGIONAL_MARKETS, 7 markets)
 * - types.ts (MarketPricingConfig, Plan, PlanFeature, WalletPaymentData)
 * - buildPlans.tsx (buildPlans(marketConfig) → Plan[4])
 * - TopBar.tsx + HeroSection.tsx + PromoCodeCard.tsx + EnterpriseSection.tsx
 * - PlanCard.tsx + ComparisonTable.tsx + FAQItem.tsx (+ FAQ_ENTRIES static array)
 * - PaymentOptionsModal.tsx + DeveloperContactModal.tsx + WalletPaymentModal.tsx
 *
 * z-ai-web-dev-sdk NOT used.
 */
'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Gift, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import type { User as AppUser } from '@/types';

import { REGIONAL_MARKETS } from './constants';
import { buildPlans } from './buildPlans';
import type { Plan, WalletPaymentData } from './types';
import { TopBar } from './TopBar';
import { HeroSection } from './HeroSection';
import { PromoCodeCard } from './PromoCodeCard';
import { EnterpriseSection } from './EnterpriseSection';
import { PlanCard } from './PlanCard';
import { ComparisonTable } from './ComparisonTable';
import { FAQItem, FAQ_ENTRIES } from './FAQItem';
import { PaymentOptionsModal } from './PaymentOptionsModal';
import { DeveloperContactModal } from './DeveloperContactModal';
import { WalletPaymentModal } from './WalletPaymentModal';

export function SubscriptionView() {
  const { status } = useSession();
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
  const [walletPaymentData, setWalletPaymentData] = useState<WalletPaymentData | null>(null);

  // Promo Code State
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoSuccess, setPromoSuccess] = useState(false);

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
    <div className="min-h-screen from-background via-background pb-20" dir="rtl">
      <TopBar
        isLoggedIn={isLoggedIn}
        user={user}
        onDismiss={handleDismiss}
        onGoAuth={() => setCurrentView('auth')}
      />

      {/* Special Offer Banner */}
      <div className="from-profit via-whale to-profit text-foreground shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex flex-col md:flex-row items-center justify-center gap-2 md:gap-4 text-center md:text-right">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 animate-pulse text-warning" />
              <span className="font-bold text-lg">عرض إطلاق الأسواق الجديد!</span>
            </div>
            <span className="text-profit text-sm md:text-base font-medium">
              خصم فوري يصل إلى <span className="text-warning font-bold underline">65%</span> على جميع الباقات لجميع الأسواق العربية والعالمية
            </span>
            <div className="flex items-center gap-1 bg-white/20 rounded-full px-3 py-1">
              <Clock className="w-4 h-4 text-warning" />
              <span className="text-xs font-semibold">لفترة محدودة</span>
            </div>
          </div>
        </div>
      </div>

      <HeroSection
        selectedMarketId={selectedMarketId}
        setSelectedMarketId={setSelectedMarketId}
        billingPeriod={billingPeriod}
        setBillingPeriod={setBillingPeriod}
      />

      <PromoCodeCard
        promoCode={promoCode}
        setPromoCode={setPromoCode}
        promoLoading={promoLoading}
        promoSuccess={promoSuccess}
        onRedeem={handleRedeemPromo}
      />

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

        <EnterpriseSection
          currentMarket={currentMarket}
          onRequestDeveloper={(plan) => {
            setSelectedPlan(plan);
            setShowContactModal(true);
          }}
        />
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
          {FAQ_ENTRIES.map((faq, idx) => (
            <FAQItem key={idx} question={faq.question} answer={faq.answer} />
          ))}
        </div>
      </div>

      {/* Payment Options Modal */}
      {showPaymentOptions && selectedPlan && (
        <PaymentOptionsModal
          selectedPlan={selectedPlan}
          currentMarket={currentMarket}
          billingPeriod={billingPeriod}
          selectedMarketId={selectedMarketId}
          loading={loading}
          onStartFreeTrial={handleStartFreeTrial}
          onPaidSubscription={handlePaidSubscription}
          onClose={() => setShowPaymentOptions(false)}
        />
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

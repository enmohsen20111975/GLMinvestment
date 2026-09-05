'use client';

export const dynamic = "force-dynamic";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { useAppStore } from '@/lib/store';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function PaymentSuccess() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const plan = searchParams.get('plan');
  const billing_period = searchParams.get('billing_period') || 'monthly';

  const [pageStatus, setPageStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const setUser = useAppStore((s) => s.setUser);

  useEffect(() => {
    async function activateSubscription() {
      // Wait for session to load
      if (status === 'loading') return;

      // Check if user is authenticated
      if (!session?.user?.id) {
        toast.error('يجب تسجيل الدخول أولاً');
        router.push('/');
        return;
      }

      if (!plan) {
        toast.error('الباقة غير محددة');
        setPageStatus('error');
        return;
      }

      try {
        // Call our activation endpoint to update subscription in database
        const response = await fetch('/api/subscription/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: plan,
            payment_gateway: 'paymob',
            billing_period: billing_period,
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          console.log('[PaymentSuccess] Subscription activated:', data);

          // Update the zustand store with new subscription tier
          if (data.data?.user) {
            setUser({
              id: data.data.user.id,
              email: data.data.user.email,
              name: data.data.user.name,
              username: data.data.user.username,
              subscription_tier: data.data.user.subscription_tier,
              default_risk_tolerance: data.data.user.default_risk_tolerance,
              is_active: data.data.user.is_active,
              image: session.user.image,
            });
          }

          toast.success('تم تفعيل اشتراكك بنجاح!');
          setPageStatus('success');

          // Redirect to dashboard after short delay
          setTimeout(() => {
            router.push('/dashboard');
          }, 2000);
        } else {
          console.error('[PaymentSuccess] Activation failed:', data);
          toast.error(data.error || 'فشل تفعيل الاشتراك');
          setPageStatus('error');
        }
      } catch (error) {
        console.error('[PaymentSuccess] Error:', error);
        toast.error('حدث خطأ أثناء تفعيل الاشتراك');
        setPageStatus('error');
      }
    }

    if (plan && status !== 'loading') {
      activateSubscription();
    }
  }, [plan, session, status, router, setUser, billing_period]);

  if (pageStatus === 'verifying') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-emerald-600 mx-auto" />
          <p className="mt-4 text-gray-600">جاري تفعيل اشتراكك...</p>
        </div>
      </div>
    );
  }

  if (pageStatus === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            تم الاشتراك بنجاح!
          </h1>
          <p className="text-gray-600 mb-6">
            مرحباً بك في <strong>{plan}</strong>.
            تم تفعيل اشتراكك بنجاح.
          </p>
          <div className="space-y-3">
            <a
              href="/dashboard"
              className="block w-full bg-emerald-600 text-white py-3 rounded-lg hover:bg-emerald-700 transition"
            >
              اذهب إلى لوحة التحكم
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          حدث خطأ
        </h1>
        <p className="text-gray-600 mb-6">
          لم نتمكن من تفعيل اشتراكك. يرجى المحاولة مرة أخرى أو التواصل مع الدعم.
        </p>
        <div className="space-y-3">
          <button
            onClick={() => router.back()}
            className="block w-full bg-emerald-600 text-white py-3 rounded-lg hover:bg-emerald-700 transition"
          >
            حاول مرة أخرى
          </button>
          <a
            href="/contact"
            className="block w-full bg-gray-200 text-gray-800 py-3 rounded-lg hover:bg-gray-300 transition"
          >
            تواصل مع الدعم
          </a>
        </div>
      </div>
    </div>
  );
}

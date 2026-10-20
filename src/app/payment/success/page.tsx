'use client';

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { PAID_TIERS } from '@/lib/subscription-gate';

/**
 * Payment Success Page
 * ====================
 * FIX-P1-SECURITY (CRIT-15): This page NO LONGER triggers activation by itself.
 *
 * The previous version POSTed `{plan}` from the URL to /api/subscription/activate,
 * which let anyone open `/payment/success?plan=premium` without paying and get
 * their tier upgraded. That endpoint now requires Paymob verification, and this
 * page now simply polls `/api/subscription/status` until the Paymob callback
 * (server-to-server webhook at `/api/paymob/callback`) activates the tier.
 *
 * Behavior:
 * 1. Show a "processing" message immediately on mount.
 * 2. Poll `/api/subscription/status` every 2s up to 30s (15 attempts).
 * 3. If `tier` switches to a paid tier (premium/pro/b2b_*) within the
 * polling window → show success UI.
 * 4. If the polling window expires without activation → show a "still
 * processing" notice that instructs the user to refresh / check back
 * later (the webhook may be delayed). Do NOT call activate.
 */
// P0-5: PAID_TIERS imported from @/lib/subscription-gate (canonical source).
// Previously this client component had a local Set that could drift from
// the canonical list. subscription-gate.ts has no top-level Prisma imports
// so importing PAID_TIERS into a client component is safe.

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15; // 30 seconds total

export default function PaymentSuccess() {
 const router = useRouter();
 const searchParams = useSearchParams();
 const { status: sessionStatus } = useSession();
 const plan = searchParams.get('plan');

 const [pageStatus, setPageStatus] = useState<'processing' | 'success' | 'timeout'>('processing');
 const pollRef = useRef<number | null>(null);
 const attemptsRef = useRef(0);

 useEffect(() => {
 if (sessionStatus === 'loading') return;

 if (sessionStatus === 'unauthenticated') {
 toast.error('يجب تسجيل الدخول أولاً');
 router.push('/');
 return;
 }

 if (!plan) {
 // No plan in URL — nothing to wait for. Treat as already-done / no-op.
 setPageStatus('success');
 return;
 }

 let cancelled = false;

 async function checkOnce() {
 if (cancelled) return;
 attemptsRef.current += 1;

 try {
 const response = await fetch('/api/subscription/status', {
 method: 'GET',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 });
 if (!response.ok) {
 // Not authenticated or server error — keep polling.
 return;
 }
 const data = await response.json();
 const tier = String(data?.tier || '').toLowerCase();
 if (PAID_TIERS.has(tier)) {
 if (!cancelled) {
 toast.success('تم تفعيل اشتراكك بنجاح!');
 setPageStatus('success');
 if (pollRef.current) {
 window.clearInterval(pollRef.current);
 pollRef.current = null;
 }
 }
 return;
 }
 } catch {
 // Network errors are non-fatal during polling — try again.
 }

 if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
 if (!cancelled) {
 setPageStatus('timeout');
 if (pollRef.current) {
 window.clearInterval(pollRef.current);
 pollRef.current = null;
 }
 }
 }
 }

 // Kick off the first check immediately, then poll.
 checkOnce();
 pollRef.current = window.setInterval(checkOnce, POLL_INTERVAL_MS);

 return () => {
 cancelled = true;
 if (pollRef.current) {
 window.clearInterval(pollRef.current);
 pollRef.current = null;
 }
 };
 }, [plan, sessionStatus, router]);

 if (pageStatus === 'processing') {
 return (
 <div className="min-h-screen flex items-center justify-center bg-gray-50">
 <div className="text-center">
 <Loader2 className="h-12 w-12 animate-spin text-profit mx-auto" />
 <p className="mt-4 text-gray-600">جاري معالجة الدفع وتفعيل اشتراكك...</p>
 <p className="mt-2 text-sm text-gray-500">
 سيتم تفعيل اشتراكك تلقائياً عبر Paymob. لا تغلق الصفحة.
 </p>
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
 {plan ? (
 <>
 مرحباً بك في <strong>{plan}</strong>.
 تم تفعيل اشتراكك بنجاح.
 </>
 ) : (
 'تم تفعيل اشتراكك بنجاح.'
 )}
 </p>
 <div className="space-y-3">
 <a
 href="/dashboard"
 className="block w-full bg-profit text-white py-3 rounded-lg hover:bg-profit/90 transition"
 >
 اذهب إلى لوحة التحكم
 </a>
 </div>
 </div>
 </div>
 );
 }

 // pageStatus === 'timeout'
 return (
 <div className="min-h-screen flex items-center justify-center bg-gray-50">
 <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
 <Loader2 className="h-12 w-12 animate-spin text-warning mx-auto mb-4" />
 <h1 className="text-2xl font-bold text-gray-800 mb-2">
 جاري معالجة الدفع
 </h1>
 <p className="text-gray-600 mb-6">
 قد يستغرق تفعيل اشتراكك بضع دقائق إضافية بينما نتأكد من عملية الدفع.
 يمكنك تحديث الصفحة بعد قليل أو المتابعة لاحقاً.
 </p>
 <div className="space-y-3">
 <button
 onClick={() => router.refresh()}
 className="block w-full bg-profit text-white py-3 rounded-lg hover:bg-profit/90 transition"
 >
 تحديث الصفحة
 </button>
 <a
 href="/dashboard"
 className="block w-full bg-gray-200 text-gray-800 py-3 rounded-lg hover:bg-gray-300 transition"
 >
 الذهاب إلى لوحة التحكم
 </a>
 <a
 href="/contact"
 className="block w-full bg-gray-100 text-gray-700 py-3 rounded-lg hover:bg-gray-200 transition"
 >
 تواصل مع الدعم
 </a>
 </div>
 </div>
 </div>
 );
}

'use client';

/**
 * GuestSignupBanner — ALPHA-UX-FIX-2
 * ====================================================================
 * بانر استباقي للـ guest (مش مسجّل) على الـ Dashboard.
 *
 * جون لاحظ: "الـ guest مش بيشوف أي value → مفيش سبب يسجّل".
 * ده بيـ address النقطة: بعد FIX-1 (الـ dashboard بقى بـ show data حقيقية
 * للـ guest)، البانر ده بيـ remind الـ guest إن في value أكتر لو سجّل.
 *
 * - بيـ show بس لو !isAuthenticated (guest).
 * - dismissible (sessionStorage — ميرجعش يـ pop في نفس الـ session).
 * - بيـ route لـ #auth لما يضغط "إنشاء حساب".
 * - tokens بس (مفيش ad-hoc colors) — primary/profit/muted-foreground.
 * - محتوى صادق: "توقعات وتحليلات أكتر" — مش ادعاءات وهمية.
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, X, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';

const DISMISS_KEY = 'guest_signup_banner_dismissed';

export function GuestSignupBanner() {
 const isAuthenticated = useAppStore((s) => s.isAuthenticated);
 const setCurrentView = useAppStore((s) => s.setCurrentView);
 const [show, setShow] = useState(false);

 useEffect(() => {
  if (typeof window === 'undefined') return;
  if (isAuthenticated) return; // مسجّل — مفيش لازمة للبانر
  try {
   if (sessionStorage.getItem(DISMISS_KEY)) return; // اتعمله dismiss هذا الـ session
   setShow(true);
  } catch { /* ignore */ }
 }, [isAuthenticated]);

 // لو المستخدم سجّل أثناء الـ session، اقفل البانر
 useEffect(() => {
  if (isAuthenticated) setShow(false);
 }, [isAuthenticated]);

 if (!show) return null;

 const handleSignup = () => {
  setCurrentView('auth');
  if (typeof window !== 'undefined') window.location.hash = 'auth';
 };

 const handleDismiss = () => {
  setShow(false);
  try {
   sessionStorage.setItem(DISMISS_KEY, '1');
  } catch { /* ignore */ }
 };

 return (
  <div
   dir="rtl"
   className="mx-3 md:mx-4 mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300"
   role="region"
   aria-label="دعوة للتسجيل المجاني"
  >
   <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary flex-shrink-0">
    <Sparkles className="h-5 w-5" />
   </div>

   <div className="flex-1 min-w-0">
    <p className="text-sm font-semibold text-foreground">
     سجّل مجاناً للمزيد من التوقعات والتحليلات المتقدمة
    </p>
    <p className="text-xs text-muted-foreground leading-snug">
      توقعات يومية، تحليل متخصص لكل سهم، ومحفظة تفاعلية — كل ده مجاني.
    </p>
   </div>

   <div className="flex items-center gap-2 flex-shrink-0">
    <Button size="sm" onClick={handleSignup} className="bg-primary hover:bg-primary text-primary-foreground font-bold text-xs h-8 px-3 gap-1.5">
     <UserPlus className="h-3.5 w-3.5" />
     <span className="hidden sm:inline">إنشاء حساب مجاني</span>
     <span className="sm:hidden">سجّل</span>
    </Button>
    <button
     onClick={handleDismiss}
     className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
     aria-label="إغلاق"
    >
     <X className="h-4 w-4" />
    </button>
   </div>
  </div>
 );
}

export default GuestSignupBanner;

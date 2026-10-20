'use client';

/**
 * LoginPromptModal
 * --------------------------
 * شاشة تسجيل/دخول مصغرة ومريحة (Compact & Minimal).
 * تم تصغيرها بالكامل وحذف الحوارات المزعجة لتسهيل التصفح وعدم حجب الشاشة.
 */

import React from 'react';
import { AnimatePresence } from 'framer-motion';
import {
 X,
 Sparkles,
 CheckCircle2,
 UserPlus,
 LogIn,
} from 'lucide-react';
import {
 Dialog,
 DialogContent,
 DialogTitle,
 DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';

export function LoginPromptModal() {
 const showLoginPrompt = useAppStore((s) => s.showLoginPrompt);
 const setShowLoginPrompt = useAppStore((s) => s.setShowLoginPrompt);
 const setCurrentView = useAppStore((s) => s.setCurrentView);

 const goRegister = () => {
 setShowLoginPrompt(false);
 setCurrentView('auth');
 if (typeof window !== 'undefined') {
 try {
 sessionStorage.setItem('auth_initial_tab', 'register');
 } catch {
 /* ignore */
 }
 }
 };

 const goLogin = () => {
 setShowLoginPrompt(false);
 setCurrentView('auth');
 if (typeof window !== 'undefined') {
 try {
 sessionStorage.setItem('auth_initial_tab', 'login');
 } catch {
 /* ignore */
 }
 }
 };

 const handleClose = () => {
 setShowLoginPrompt(false);
 };

 return (
 <>
 <Dialog
 open={showLoginPrompt}
 onOpenChange={(open) => {
 if (!open) handleClose();
 else setShowLoginPrompt(true);
 }}
 >
 <DialogContent
 showCloseButton={false}
 className="w-[92vw] max-w-[340px] sm:max-w-[360px] p-0 overflow-hidden rounded-2xl border border-border/80 shadow-2xl gap-0"
 >
 <DialogTitle className="sr-only">سجّل مجاناً للوصول الكامل</DialogTitle>
 <DialogDescription className="sr-only">
 أنشئ حساباً مجانياً للوصول إلى كل المميزات
 </DialogDescription>

 {/* Compact Gradient Header */}
 <div className="relative from-warning via-warning to-profit px-4 py-3 text-foreground flex items-center justify-between">
 <div className="flex items-center gap-2.5 min-w-0">
 <div className="size-9 rounded-xl bg-white/20 ring-1 ring-white/30 backdrop-blur flex items-center justify-center shrink-0 overflow-hidden">
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img
 src="/logo-square.png"
 alt="دليل الاستثمار"
 className="size-7 object-contain"
 />
 </div>
 <div className="min-w-0">
 <p className="text-sm font-bold tracking-tight leading-tight truncate">
 سجّل مجاناً للوصول الكامل
 </p>
 <p className="text-xs text-foreground/90 truncate flex items-center gap-1 mt-0.5">
 <Sparkles className="size-3 shrink-0" />
 بدون بطاقة ائتمان — مجاني للأبد
 </p>
 </div>
 </div>

 {/* Direct Close Button */}
 <button
 type="button"
 onClick={handleClose}
 aria-label="إغلاق"
 className="size-7 rounded-full bg-black/20 hover:bg-black/35 text-foreground/90 hover:text-foreground transition-colors flex items-center justify-center shrink-0 mr-1"
 >
 <X className="size-3.5" />
 </button>
 </div>

 {/* Compact Feature Pills */}
 <div className="px-4 py-2.5 bg-background border-b border-border/40">
 <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs text-muted-foreground font-medium">
 <div className="flex items-center gap-1.5 truncate">
 <CheckCircle2 className="size-3 text-profit shrink-0" />
 <span className="truncate">توقعات ورادار يومي</span>
 </div>
 <div className="flex items-center gap-1.5 truncate">
 <CheckCircle2 className="size-3 text-warning shrink-0" />
 <span className="truncate">تحليلات فنية متقدمة</span>
 </div>
 <div className="flex items-center gap-1.5 truncate">
 <CheckCircle2 className="size-3 text-profit shrink-0" />
 <span className="truncate">إدارة المحفظة</span>
 </div>
 <div className="flex items-center gap-1.5 truncate">
 <CheckCircle2 className="size-3 text-warning shrink-0" />
 <span className="truncate">تنبيهات الأسعار</span>
 </div>
 </div>
 </div>

 {/* Compact CTA Footer */}
 <div className="px-4 py-2.5 bg-background flex items-center gap-2">
 <Button
 onClick={goRegister}
 size="sm"
 className="flex-1 h-8 text-xs font-bold from-warning to-profit hover:from-warning hover:to-profit text-foreground shadow-sm"
 >
 <UserPlus className="size-3.5 ml-1" />
 سجّل مجاناً
 </Button>
 <Button
 onClick={goLogin}
 size="sm"
 variant="outline"
 className="h-8 px-3 text-xs font-semibold border-warning/20 text-warning hover:bg-warning hover:text-warning dark:hover:bg-warning/10"
 >
 <LogIn className="size-3.5 ml-1" />
 دخول
 </Button>
 </div>
 </DialogContent>
 </Dialog>

 <AnimatePresence />
 </>
 );
}

'use client';

/**
 * GuestLimitCta — ALPHA-UX-FIX-5 (guest freemium preview)
 * ====================================================================
 * بانر CTA بيـ show لما الـ guest يوصل لـ limit الـ preview.
 *
 * المبدأ (محسن): "ماينفعش يخش ويلاقى كل حاجة مغلقة — لازم نسبة حاجات يشوفها".
 * الـ guest بيشوف preview (50 سهم / 3 توقعات / ...) + الباقي مقفول خلف الـ CTA.
 *
 * Props:
 * - shown: عدد العناصر المعروضة فعلاً (preview count)
 * - total: إجمالي العناصر المتاحة (اللي الـ API رجّعها)
 * - itemLabel: "سهًما" / "توقع" / ... (مفرد)
 * - itemLabelPlural: "أسهم" / "توقعات" / ... (جمع)
 *
 * - بـ route لـ #auth لما يضغط "سجّل مجاناً".
 * - tokens بس (primary/muted-foreground — متوازن light/dark).
 * - نص صادق: بيقول بالظبط "بتشوف X من Y" — مش ادعاءات.
 */
import React from 'react';
import { Lock, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';

interface GuestLimitCtaProps {
  shown: number;
  total: number;
  itemLabel: string;       // مفرد: "سهًما" / "توقع"
  itemLabelPlural: string;  // جمع: "أسهم" / "توقعات"
  className?: string;
}

export function GuestLimitCta({
  shown,
  total,
  itemLabel,
  itemLabelPlural,
  className = '',
}: GuestLimitCtaProps) {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  // مسجّل → مفيش CTA (يشوف كل حاجة)
  if (isAuthenticated) return null;
  // لو الـ total أقل من الـ shown → مفيش حاجة مقفولة → مفيش CTA
  if (total <= shown) return null;

  const handleSignup = () => {
    setCurrentView('auth');
    if (typeof window !== 'undefined') window.location.hash = 'auth';
  };

  return (
    <div
      dir="rtl"
      className={`rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 flex flex-col sm:flex-row items-center gap-3 text-center sm:text-right ${className}`}
      role="region"
      aria-label="دعوة للتسجيل لرؤية المزيد"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary flex-shrink-0">
        <Lock className="h-5 w-5" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          بتشوف {shown} {shown === 1 ? itemLabel : itemLabelPlural} من أصل {total}
        </p>
        <p className="text-xs text-muted-foreground leading-snug">
          سجّل مجاناً للوصول إلى كل الـ{itemLabelPlural} ({total - shown} {itemLabelPlural} إضافية) + التحليلات المتقدمة + المحفظة التفاعلية.
        </p>
      </div>

      <Button
        size="sm"
        onClick={handleSignup}
        className="bg-primary hover:bg-primary text-primary-foreground font-bold text-xs h-9 px-4 gap-1.5 flex-shrink-0"
      >
        <UserPlus className="h-4 w-4" />
        سجّل مجاناً للمزيد
      </Button>
    </div>
  );
}

export default GuestLimitCta;

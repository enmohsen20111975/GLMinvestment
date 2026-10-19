'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  HelpCircle,
  X,
  BarChart3,
  TrendingUp,
  Bell,
  Wallet,
  ShoppingCart,
  Lightbulb,
  ArrowLeft,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ============================================================
   ONBOARDING-033: Interactive Help Center (Platform Guide)
   ============================================================
   Slide-in panel with 5 interactive sections explaining how to
   use the platform's advanced features in formal Modern
   Standard Arabic (Rule 30 — CLIENT-FACING-STYLE).

   Sections:
   1. قراءة الشارت اللحظي (Live Chart)
   2. فهم الإشارات الذكية (Pine Script Flags)
   3. وضع المضارب والمستثمر (User State Toggle)
   4. إدارة المحافظ المتعددة (Multi-Portfolio)
   5. التنبيهات (Alerts)

   Features:
   - Persists "seen" state to localStorage (don't auto-open again)
   - First-visit auto-open (after 3s delay)
   - Progress indicator (X / 5 sections)
   - "بدء الاستخدام" CTA at the end
   ============================================================ */

const SECTIONS = [
  {
    id: 'live-chart',
    icon: BarChart3,
    title: 'قراءة الشارت اللحظي',
    titleEn: 'الشارت اللحظي',
    color: 'text-cyan-400',
    bg: 'bg-cyan-950/40',
    border: 'border-cyan-800',
    content: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          يتحدّث الرسم البياني كل <strong className="text-cyan-400">5 ثوانٍ</strong> تقريباً.
          عند ظهور شارة <Badge className="bg-loss text-white animate-pulse">LIVE</Badge>
          يكون السعر المعروض هو سعر تداول اليوم الفعلي، لا سعراً تاريخياً.
        </p>
        <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
          <p className="font-semibold mb-1">كيفية قراءة الأطر الزمنية:</p>
          <ul className="space-y-1.5 text-xs">
            <li>
              <strong className="text-cyan-400">شهري</strong> — يُنظر إليه من منظور أوسع
              لاستيعاب الاتجاه العام (هل يغلق السهم على صعود شهرياً أم على هبوط).
            </li>
            <li>
              <strong className="text-cyan-400">أسبوعي</strong> — يوضح الاتجاه المتوسط.
              إذا كان الإطار الشهري صاعداً والأسبوعي في مرحلة تصحيح، فهذه فرصة
              محتملة.
            </li>
            <li>
              <strong className="text-cyan-400">يومي</strong> — يُستخدم لتحديد نقطة
              الدخول بدقة.
            </li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">
          هذا ما يُعرف بـ <strong>Multi-Timeframe Analysis</strong> — يقرأ المحلل
          المحترف من الإطار الأكبر إلى الأصغر.
        </p>
      </div>
    ),
  },
  {
    id: 'pine-script',
    icon: Sparkles,
    title: 'الإشارات الذكية',
    titleEn: 'Pine Script Flags',
    color: 'text-profit',
    bg: 'bg-profit/40',
    border: 'border-profit',
    content: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>ترصد المنصة ثلاثة أنماط على الرسم البياني، يُعدّل كلٌّ منها الإشارة تلقائياً:</p>
        <div className="space-y-2">
          <div className="p-3 rounded-lg bg-lime-950/30 border border-lime-800/50">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-lime-900 text-lime-300 border border-lime-700">تصحيح ذهبي</Badge>
              <span className="text-xs text-muted-foreground">Boost +10 نقاط</span>
            </div>
            <p className="text-xs">
              السهم في اتجاه صاعد وانخفض قليلاً ليأخذ نفَساً عند بولينجر. هذه
              <strong className="text-lime-400"> فرصة شراء بخصم</strong>.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-loss/30 border border-loss/50">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-loss text-loss border border-loss animate-pulse">فخ ارتداد</Badge>
              <span className="text-xs text-muted-foreground">Veto -15 نقطة</span>
            </div>
            <p className="text-xs">
              السهم في هبوط وارتفع قليلاً. <strong className="text-loss">يُنصح بالابتعاد</strong> —
              غالباً ما يستمر السهم في هبوطه بعد الارتداد الوهمي.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-whale/30 border border-whale/50">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-whale text-whale border border-whale">تباعد إيجابي</Badge>
              <span className="text-xs text-muted-foreground">Boost +5 نقاط</span>
            </div>
            <p className="text-xs">
              انخفض السعر لكن مؤشر RSI ارتفع. ذلك يعني أن
              <strong className="text-whale"> قوة البيع استُنزفت</strong>، وقد
              ينعكس السهم إلى صعود قريب.
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'user-state',
    icon: ShoppingCart,
    title: 'وضع المضارب والمستثمر',
    titleEn: 'User State Toggle',
    color: 'text-warning',
    bg: 'bg-warning/40',
    border: 'border-warning',
    content: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>هناك زرّان أعلى الرسم البياني؛ اختر وضعك:</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg bg-profit/30 border border-profit/50">
            <div className="flex items-center gap-1.5 mb-1">
              <ShoppingCart className="h-4 w-4 text-profit" />
              <strong className="text-profit">أبحث عن شراء</strong>
            </div>
            <p className="text-xs">
              إذا تجاوز مؤشر RSI مستوى 75، ستشير المنصة إلى
              <strong className="text-loss"> تشبّع شرائي — يُنصح بالابتعاد</strong>
              وانتظار التصحيح.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-warning/30 border border-warning/50">
            <div className="flex items-center gap-1.5 mb-1">
              <Wallet className="h-4 w-4 text-warning" />
              <strong className="text-warning">أملك السهم</strong>
            </div>
            <p className="text-xs">
              إذا تجاوز مؤشر RSI مستوى 75 أثناء صعود، ستشير المنصة إلى
              <strong className="text-warning"> تحقيق ربح</strong> — يُنصح ببيع
              جزء من المركز.
            </p>
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50">
          <p className="text-xs">
            <strong>من يحتفظ بالسهم عند انخفاضه ويغلق على نفسه</strong> —
            سيُشار إليه بالاحتفاظ. ومن يدخل عند القمة — سيُشار إليه بالابتعاد.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'multi-portfolio',
    icon: Wallet,
    title: 'المحافظ المتعددة',
    titleEn: 'Multi-Portfolio',
    color: 'text-primary',
    bg: 'bg-primary/40',
    border: 'border-purple-800',
    content: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          يمكن تسجيل <strong className="text-primary">محفظة ثاندر منفصلة</strong>،
          و<strong className="text-primary">محفظة مباشر منفصلة</strong>، وحتى
          <strong className="text-primary"> محفظة بينانس</strong> — لكل وسيط
          حساب منفصل.
        </p>
        <div className="p-3 rounded-lg bg-muted/40 border border-border/50 space-y-2">
          <p className="font-semibold">طريقة الاستخدام:</p>
          <ol className="space-y-1.5 text-xs list-decimal list-inside">
            <li>افتح صفحة المحفظة، ثم اضغط <strong>«محفظة جديدة»</strong>.</li>
            <li>اختر اسم المحفظة والوسيط (ثاندر/مباشر/بينانس).</li>
            <li>سجّل صفقاتك تحت كل محفظة.</li>
            <li>ستجمعها المنصة ضمن <strong>«المحفظة الأم»</strong> وتعرض إجمالي
              ربحك.</li>
          </ol>
        </div>
        <div className="p-3 rounded-lg bg-primary/30 border border-purple-800/50">
          <p className="text-xs">
            <strong>الفائدة:</strong> ستتمكن من معرفة مصدر الربح بدقة — مثلاً
            «ربح 5% على ثاندر، خسارة 2% على مباشر» — لتركّز على ما يحقق ربحاً.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'alerts',
    icon: Bell,
    title: 'التنبيهات اللحظية',
    titleEn: 'Real-time Alerts',
    color: 'text-pink-400',
    bg: 'bg-pink-950/40',
    border: 'border-pink-800',
    content: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          أنشئ تنبيهاً على <strong className="text-pink-400">السعر</strong> أو
          <strong className="text-pink-400"> درجة التقييم</strong> أو
          <strong className="text-pink-400"> الإشارات</strong>، ثم يمكنك مغادرة
          الشاشة.
        </p>
        <div className="p-3 rounded-lg bg-muted/40 border border-border/50 space-y-2">
          <p className="font-semibold">أنواع التنبيهات (7 أنواع):</p>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="flex items-center gap-1">السعر فوق</div>
            <div className="flex items-center gap-1">السعر تحت</div>
            <div className="flex items-center gap-1">درجة التقييم فوق</div>
            <div className="flex items-center gap-1">درجة التقييم تحت</div>
            <div className="flex items-center gap-1">تصحيح ذهبي</div>
            <div className="flex items-center gap-1">فخ ارتداد</div>
            <div className="flex items-center gap-1 col-span-2">تباعد إيجابي</div>
          </div>
        </div>
        <div className="p-3 rounded-lg bg-pink-950/30 border border-pink-800/50">
          <p className="text-xs">
            عندما تتوفر فرصة، ستُنبّهك المنصة فوراً عبر
            <strong className="text-pink-400"> تنبيه صوتي وإشعار وتنبيه بصري على
            الشاشة</strong> — دون الحاجة إلى مراقبة الشاشة باستمرار.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          افتح زر الجرس أعلى الرسم البياني لإضافة التنبيهات.
        </p>
      </div>
    ),
  },
];

const STORAGE_KEY = 'glminvestment-guide-seen';

interface PlatformGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlatformGuide({ open, onOpenChange }: PlatformGuideProps) {
  const [activeSection, setActiveSection] = useState(0);

  // Reset to first section when opened
  useEffect(() => {
    if (open) setActiveSection(0);
  }, [open]);

  // Mark as seen when opened
  useEffect(() => {
    if (open && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    }
  }, [open]);

  const handleNext = () => {
    if (activeSection < SECTIONS.length - 1) {
      setActiveSection(activeSection + 1);
    }
  };

  const handlePrev = () => {
    if (activeSection > 0) {
      setActiveSection(activeSection - 1);
    }
  };

  const handleFinish = () => {
    onOpenChange(false);
  };

  const current = SECTIONS[activeSection];
  const Icon = current.icon;
  const isLast = activeSection === SECTIONS.length - 1;
  const progress = ((activeSection + 1) / SECTIONS.length) * 100;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg p-0 bg-background border-l border-border flex flex-col inset-y-[15vh] h-auto max-h-[70vh] rounded-t-2xl sm:rounded-l-2xl sm:rounded-tr-none overflow-hidden"
      >
        {/* Sticky header — stays visible even when content is scrolled */}
        <SheetHeader className="p-4 border-b border-border shrink-0 space-y-0 sticky top-0 bg-background z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-profit/20 flex items-center justify-center">
                <HelpCircle className="h-5 w-5 text-profit" />
              </div>
              <div>
                <SheetTitle className="text-base font-bold">
                  مركز المساعدة التفاعلي
                </SheetTitle>
                <p className="text-xs text-muted-foreground">
                  كيفية استخدام المنصة في 5 خطوات
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 p-0 shrink-0"
              aria-label="إغلاق"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Progress bar */}
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                الخطوة {activeSection + 1} من {SECTIONS.length}
              </span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-profit transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </SheetHeader>

        {/* Section tabs (clickable) */}
        <div className="px-4 py-2 border-b border-border shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1.5 min-w-max">
            {SECTIONS.map((s, i) => {
              const SectionIcon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(i)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap border',
                    i === activeSection
                      ? cn(s.bg, s.color, s.border)
                      : 'text-muted-foreground bg-muted/30 border-transparent hover:bg-muted/60',
                    i < activeSection && 'opacity-60',
                  )}
                >
                  {i < activeSection && <CheckCircle2 className="h-3 w-3" />}
                  <SectionIcon className="h-3 w-3" />
                  <span>{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', current.bg)}>
                <Icon className={cn('h-5 w-5', current.color)} />
              </div>
              <div>
                <h3 className="text-base font-bold">{current.title}</h3>
                <p className="text-[10px] text-muted-foreground">{current.titleEn}</p>
              </div>
            </div>
            <div className="pt-1">{current.content}</div>
          </div>
        </div>

        {/* Sticky footer navigation — always visible */}
        <div className="p-4 border-t border-border shrink-0 space-y-2 sticky bottom-0 bg-background z-10">
          {isLast && (
            <div className="p-3 rounded-lg bg-profit/30 border border-profit/50 flex items-start gap-2">
              <Lightbulb className="h-4 w-4 text-profit shrink-0 mt-0.5" />
              <p className="text-xs text-profit">
                لقد استعرضت الآن جميع أدوات المنصة. تذكّر:
                <strong> التحليل أداة لاتخاذ القرار، لا للمخاطرة العشوائية.</strong>
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={activeSection === 0}
              className="h-9"
            >
              <ArrowLeft className="h-4 w-4 ml-1" />
              السابق
            </Button>
            {isLast ? (
              <Button
                size="sm"
                onClick={handleFinish}
                className="h-9 bg-profit hover:bg-profit text-white"
              >
                <TrendingUp className="h-4 w-4 ml-1" />
                بدء الاستخدام
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleNext}
                className="h-9 bg-profit hover:bg-profit text-white"
              >
                التالي
                <ArrowLeft className="h-4 w-4 mr-1 rotate-180" />
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ============================================================
   usePlatformGuide Hook
   ============================================================
   - First-visit auto-open (after 3s delay)
   - Manual open/close control
   - Persists "seen" state to localStorage
   ============================================================ */

export function usePlatformGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Check if user has seen the guide before (within last 30 days)
    const seen = localStorage.getItem(STORAGE_KEY);
    if (seen) {
      // Check if the seen timestamp is still valid (30 days)
      const seenDate = new Date(seen);
      const daysSinceSeen = (Date.now() - seenDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceSeen < 30) {
        // Recently seen — don't auto-open
        return;
      }
      // Otherwise: re-show after 30 days (long-time-no-see → remind user)
    }
    // Auto-open after 3s delay (let the page load first)
    const timer = setTimeout(() => setOpen(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  return { open, setOpen };
}

/* ============================================================
   PlatformGuideButton — standalone button to open the guide
   ============================================================ */

interface PlatformGuideButtonProps {
  onOpen: () => void;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

export function PlatformGuideButton({
  onOpen,
  variant = 'ghost',
  size = 'sm',
  className,
}: PlatformGuideButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onOpen}
      className={cn('gap-1.5', className)}
      title="كيف أستخدم المنصة؟"
    >
      <HelpCircle className="h-4 w-4" />
      <span className="hidden sm:inline">كيف أستخدم المنصة؟</span>
    </Button>
  );
}

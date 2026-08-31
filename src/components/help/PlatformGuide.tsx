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
   use the platform's advanced features in simple Egyptian Arabic.

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
   - "ابدأ التداول الآن" CTA at the end
   ============================================================ */

const SECTIONS = [
  {
    id: 'live-chart',
    icon: BarChart3,
    title: 'قراءة الشارت اللحظي',
    titleEn: 'Live Chart',
    color: 'text-cyan-400',
    bg: 'bg-cyan-950/40',
    border: 'border-cyan-800',
    content: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          الشارت بيتحدث كل <strong className="text-cyan-400">5 ثواني</strong> تقريباً.
          لما تلاقي شارة <Badge className="bg-red-600 text-white animate-pulse">LIVE</Badge>
          معناها إن السعر ده بتداول اليوم بالظبط، مش تاريخي.
        </p>
        <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
          <p className="font-semibold mb-1">💡 إزاي تقرأ الفرايمات:</p>
          <ul className="space-y-1.5 text-xs">
            <li>
              <strong className="text-cyan-400">📅 شهري</strong> — بص عليه من فوق عشان تشوف
              الاتجاه العام (السهم بيقفل شهر ورا شهر في صعود ولا هبوط).
            </li>
            <li>
              <strong className="text-cyan-400">📅 أسبوعي</strong> — بيشوفلك الاتجاه المتوسط،
              لو الشهري صاعد والأسبوعي بيصحح، دي فرصة.
            </li>
            <li>
              <strong className="text-cyan-400">📅 يومي</strong> — بتنزل تحت تدخل الصفقة
              بالنقطة الصحية.
            </li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">
          ده اسمه <strong>Multi-Timeframe Analysis</strong> — المحلل المحترف بيبص من الكبير للصغير.
        </p>
      </div>
    ),
  },
  {
    id: 'pine-script',
    icon: Sparkles,
    title: 'الإشارات الذكية',
    titleEn: 'Pine Script Flags',
    color: 'text-emerald-400',
    bg: 'bg-emerald-950/40',
    border: 'border-emerald-800',
    content: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>المنصة بترصد 3 أنماط ذكية على الشارت، كل واحد بيغير الإشارة تلقائياً:</p>
        <div className="space-y-2">
          <div className="p-3 rounded-lg bg-lime-950/30 border border-lime-800/50">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-lime-900 text-lime-300 border border-lime-700">🟢 تصحيح ذهبي</Badge>
              <span className="text-xs text-muted-foreground">Boost +10 نقاط</span>
            </div>
            <p className="text-xs">
              السهم في اتجاه صاعد ونزل شوية ياخد نفّس عند بولينجر. دي
              <strong className="text-lime-400"> فرصة شراء بخصم</strong> — اشتري والسعر رخيص!
            </p>
          </div>
          <div className="p-3 rounded-lg bg-red-950/30 border border-red-800/50">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-red-900 text-red-300 border border-red-700 animate-pulse">⚠️ فخ ارتداد</Badge>
              <span className="text-xs text-muted-foreground">Veto -15 نقطة</span>
            </div>
            <p className="text-xs">
              السهم في هبوط وطلع شوية. <strong className="text-red-400">متدخلش، ده فم الفأر!</strong>
              السهم غالباً هيكمل هبوط بعد الارتداد الوهمي ده.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-blue-950/30 border border-teal-800/50">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-teal-900 text-teal-300 border border-teal-700">📊 تباعد إيجابي</Badge>
              <span className="text-xs text-muted-foreground">Boost +5 نقاط</span>
            </div>
            <p className="text-xs">
              السعر نزل بس الـ RSI طلع. معناها <strong className="text-teal-400">البائعين خلصوا</strong>
              والسهم ممكن يقلب لصعود قريب.
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
    color: 'text-amber-400',
    bg: 'bg-amber-950/40',
    border: 'border-amber-800',
    content: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>فيه زرين فوق الشارت، اختار وضعك:</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/50">
            <div className="flex items-center gap-1.5 mb-1">
              <ShoppingCart className="h-4 w-4 text-emerald-400" />
              <strong className="text-emerald-400">أبحث عن شراء</strong>
            </div>
            <p className="text-xs">
              لو الـ RSI فوق 75، المنصة هتقولك
              <strong className="text-red-400"> ابتعد / تشبع شرائي</strong> — انتظر تصحيح.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/50">
            <div className="flex items-center gap-1.5 mb-1">
              <Wallet className="h-4 w-4 text-amber-400" />
              <strong className="text-amber-400">أملك السهم</strong>
            </div>
            <p className="text-xs">
              لو الـ RSI فوق 75 في صعود، المنصة هتقولك
              <strong className="text-amber-400"> حقق ربح</strong> — بيع جزء من المركز.
            </p>
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50">
          <p className="text-xs">
            💡 <strong>اللي بيمسك السهم لما ينزل ويقفل على نفسه</strong> — الوضع ده هيقولّه امسك.
            واللي بيدخل في القمة — هيقولّه ابتعد.
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
    color: 'text-purple-400',
    bg: 'bg-purple-950/40',
    border: 'border-purple-800',
    content: (
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          تقدر تسجل <strong className="text-purple-400">محفظة ثاندر لوحدها</strong>،
          و<strong className="text-purple-400">محفظة مباشر لوحدها</strong>، وحتى
          <strong className="text-purple-400"> بينانس</strong> — كل وسيط في حساب منفصل.
        </p>
        <div className="p-3 rounded-lg bg-muted/40 border border-border/50 space-y-2">
          <p className="font-semibold">إزاي تشتغل:</p>
          <ol className="space-y-1.5 text-xs list-decimal list-inside">
            <li>افتح صفحة المحفظة، واضغط <strong>"محفظة جديدة"</strong>.</li>
            <li>اختار اسم المحفظة والوسيط (ثاندر/مباشر/بينانس).</li>
            <li>سجّل صفقاتك تحت كل محفظة.</li>
            <li>المنصة هتجمعهم في <strong>"المحفظة الأم"</strong> وتقولك إجمالي ربحك.</li>
          </ol>
        </div>
        <div className="p-3 rounded-lg bg-purple-950/30 border border-purple-800/50">
          <p className="text-xs">
            🎯 <strong>الفايدة الحقيقية:</strong> هتعرف أنت بيربح فين بالظبط —
            "ربحت 5% على ثاندر، خسرت 2% على مباشر". ركّز على اللي بيربح فيه!
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
          اعمل تنبيه على <strong className="text-pink-400">السعر</strong> أو
          <strong className="text-pink-400"> الـ Score</strong> أو
          <strong className="text-pink-400"> الإشارات الذكية</strong>، واطلع من الشاشة.
        </p>
        <div className="p-3 rounded-lg bg-muted/40 border border-border/50 space-y-2">
          <p className="font-semibold">أنواع التنبيهات (7 أنواع):</p>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="flex items-center gap-1">📈 السعر فوق</div>
            <div className="flex items-center gap-1">📉 السعر تحت</div>
            <div className="flex items-center gap-1">🎯 Score فوق</div>
            <div className="flex items-center gap-1">⚠️ Score تحت</div>
            <div className="flex items-center gap-1">🟢 تصحيح ذهبي</div>
            <div className="flex items-center gap-1">⚠️ فخ ارتداد</div>
            <div className="flex items-center gap-1 col-span-2">📊 تباعد إيجابي</div>
          </div>
        </div>
        <div className="p-3 rounded-lg bg-pink-950/30 border border-pink-800/50">
          <p className="text-xs">
            🔔 أول ما الفرصة تجي، المنصة هتصفرّح وتقولك —
            <strong className="text-pink-400"> مش لازم تبص في الشاشة كل شوية!</strong>
            تنبيه صوتي + إشعار + توست بصري.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          افتح زر الجرس 🔔 فوق الشارت عشان تضيف تنبيهات.
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
              <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <HelpCircle className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <SheetTitle className="text-base font-bold">
                  مركز المساعدة التفاعلي
                </SheetTitle>
                <p className="text-xs text-muted-foreground">
                  إزاي تستخدم المنصة في 5 خطوات
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
                className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
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
            <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/50 flex items-start gap-2">
              <Lightbulb className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-200">
                كده أنت فهمت كل أدوات المنصة! ابدأ التداول بثقة، وافتكر:
                <strong> التحليل لإتخاذ القرار، مش للقمار.</strong>
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
                className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <TrendingUp className="h-4 w-4 ml-1" />
                ابدأ التداول الآن
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleNext}
                className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
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
    // Check if user has seen the guide before
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      // Auto-open after 3s delay (let the page load first)
      const timer = setTimeout(() => setOpen(true), 3000);
      return () => clearTimeout(timer);
    }
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

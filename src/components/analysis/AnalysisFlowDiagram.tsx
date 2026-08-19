'use client';

/**
 * AnalysisFlowDiagram — مخطط هندسي/logic diagram يوضح خطوات التحليل العامة
 * يُعرض تحت شاشة المستثمر والمضارب بأسلوب إعلاني هندسي (engineering blueprint).
 *
 * الخطوات المعروضة (5 مراحل):
 *  1) Data Agent      — جلب البيانات (الأسعار، الحجم، الأساسيات)
 *  2) Analysis Agent  — 13 مؤشر فني (SMFI, Blood Filter, Monte Carlo, Sniper, ...)
 *  3) Strategy Agent  — تصويت موزون + توليد الإشارة (entry/target/stop)
 *  4) Risk Agent      — إدارة المخاطر (Kelly, R/R, position sizing)
 *  5) Expert Memory   — توصيات الخبراء تعدّل درجة الثقة (تغيير طريقة التفكير)
 *  → Final Signal
 *
 * الألوان: emerald للمستثمر، fuchsia للمضارب (لا أزرول/indigo).
 */

import React from 'react';
import { cn } from '@/lib/utils';
import {
  Database, Cpu, GitBranch, ShieldCheck, Brain, Target,
  ArrowLeft, Activity, TrendingUp, Gauge, Layers, Zap,
} from 'lucide-react';

type Persona = 'investor' | 'gambler';

interface Stage {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  items: string[];
  accent: string; // tailwind text color
  ring: string;   // tailwind ring/border color
  bg: string;     // tailwind bg tint
  badge: string;  // stage number badge bg
}

const INVESTOR_STAGES: Stage[] = [
  {
    id: 'data',
    icon: Database,
    title: 'وكيل البيانات',
    subtitle: 'Data Agent',
    items: ['الأسعار التاريخية', 'الحجم والسيولة', 'الأساسيات (P/E, ROE)', 'بيانات السوق الكلي'],
    accent: 'text-emerald-700 dark:text-emerald-300',
    ring: 'border-emerald-300 dark:border-emerald-700',
    bg: 'bg-emerald-50/70 dark:bg-emerald-950/30',
    badge: 'bg-emerald-600',
  },
  {
    id: 'analysis',
    icon: Cpu,
    title: 'وكيل التحليل',
    subtitle: 'Analysis Agent — 13 مؤشر',
    items: [
      'SMFI — تدفق الأموال الذكية (25%)',
      'Blood Filter — فلتر الدماء (20%)',
      'Monte Carlo — 500 مسار (15%)',
      'Sniper Scan — التصطاد (20%)',
      'RSI + MACD + Bollinger (20%)',
      'Fibonacci + ATR + S/R + 200 EMA',
    ],
    accent: 'text-emerald-700 dark:text-emerald-300',
    ring: 'border-emerald-300 dark:border-emerald-700',
    bg: 'bg-emerald-50/70 dark:bg-emerald-950/30',
    badge: 'bg-emerald-600',
  },
  {
    id: 'strategy',
    icon: GitBranch,
    title: 'وكيل الاستراتيجية',
    subtitle: 'Strategy Agent — تصويت موزون',
    items: ['تجميع أوزان المؤشرات', 'عتبة الإشارة > 65 شراء', 'عتبة الإشارة < 35 بيع', 'حساب الدخول/الهدف/الوقف'],
    accent: 'text-emerald-700 dark:text-emerald-300',
    ring: 'border-emerald-300 dark:border-emerald-700',
    bg: 'bg-emerald-50/70 dark:bg-emerald-950/30',
    badge: 'bg-emerald-600',
  },
  {
    id: 'risk',
    icon: ShieldCheck,
    title: 'وكيل المخاطر',
    subtitle: 'Risk Agent',
    items: ['حد المخاطر 5% للمحفظة', 'وقف ATR الديناميكي', 'R/R ≥ 1:2 إلزامي', 'Quarter Kelly لحجم الصفقة'],
    accent: 'text-emerald-700 dark:text-emerald-300',
    ring: 'border-emerald-300 dark:border-emerald-700',
    bg: 'bg-emerald-50/70 dark:bg-emerald-950/30',
    badge: 'bg-emerald-600',
  },
  {
    id: 'expert',
    icon: Brain,
    title: 'ذاكرة الخبراء',
    subtitle: 'Expert Memory — تعديل الثقة',
    items: ['قراءة توصيات الخبراء', 'توافق ← +ثقة', 'تعارض ← −ثقة + تحذير', 'تغيير طريقة التفكير'],
    accent: 'text-emerald-700 dark:text-emerald-300',
    ring: 'border-emerald-300 dark:border-emerald-700',
    bg: 'bg-emerald-50/70 dark:bg-emerald-950/30',
    badge: 'bg-emerald-600',
  },
];

const GAMBLER_STAGES: Stage[] = [
  {
    id: 'data',
    icon: Database,
    title: 'وكيل البيانات',
    subtitle: 'Data Agent — لحظي',
    items: ['الأسعار اللحظية', 'زخم الحجم (Volume Ratio)', 'Sniper Scan للسوق كله', 'ذيل الـ T+1'],
    accent: 'text-fuchsia-700 dark:text-fuchsia-300',
    ring: 'border-fuchsia-300 dark:border-fuchsia-700',
    bg: 'bg-fuchsia-50/70 dark:bg-fuchsia-950/30',
    badge: 'bg-fuchsia-600',
  },
  {
    id: 'analysis',
    icon: Cpu,
    title: 'وكيل التحليل',
    subtitle: 'Analysis Agent — زخم انفجاري',
    items: [
      'Sniper Scan — التصطاد (20%)',
      'SMFI — تدفق الحيتان (25%)',
      'Blood Filter — فلتر السيولة (20%)',
      'Monte Carlo — 5 أيام (15%)',
      'RSI + MACD + Bollinger Squeeze',
      'ATR + S/R + Volume Spike',
    ],
    accent: 'text-fuchsia-700 dark:text-fuchsia-300',
    ring: 'border-fuchsia-300 dark:border-fuchsia-700',
    bg: 'bg-fuchsia-50/70 dark:bg-fuchsia-950/30',
    badge: 'bg-fuchsia-600',
  },
  {
    id: 'strategy',
    icon: Zap,
    title: 'وكيل الاستراتيجية',
    subtitle: 'Strategy Agent — زخم سريع',
    items: ['تصويت موزون للزخم', 'كشف الانفجار الحجمي (+15)', 'BB Squeeze ← إشارة اختراق', 'دخول/هدف/وقف سريع'],
    accent: 'text-fuchsia-700 dark:text-fuchsia-300',
    ring: 'border-fuchsia-300 dark:border-fuchsia-700',
    bg: 'bg-fuchsia-50/70 dark:bg-fuchsia-950/30',
    badge: 'bg-fuchsia-600',
  },
  {
    id: 'risk',
    icon: ShieldCheck,
    title: 'وكيل المخاطر',
    subtitle: 'Risk Agent — مضاربة',
    items: ['وقف ATR مضغوط', 'R/R ≥ 1.5 للمضارب', 'حد المخاطر 5%', 'حجم أصغر للزخم المرتفع'],
    accent: 'text-fuchsia-700 dark:text-fuchsia-300',
    ring: 'border-fuchsia-300 dark:border-fuchsia-700',
    bg: 'bg-fuchsia-50/70 dark:bg-fuchsia-950/30',
    badge: 'bg-fuchsia-600',
  },
  {
    id: 'expert',
    icon: Brain,
    title: 'ذاكرة الخبراء',
    subtitle: 'Expert Memory — تعديل الثقة',
    items: ['قراءة توصيات الخبراء', 'توافق ← +ثقة', 'تعارض ← −ثقة + تحذير', 'تغيير طريقة التفكير'],
    accent: 'text-fuchsia-700 dark:text-fuchsia-300',
    ring: 'border-fuchsia-300 dark:border-fuchsia-700',
    bg: 'bg-fuchsia-50/70 dark:bg-fuchsia-950/30',
    badge: 'bg-fuchsia-600',
  },
];

interface Props {
  persona: Persona;
  className?: string;
}

export function AnalysisFlowDiagram({ persona, className }: Props) {
  const isInvestor = persona === 'investor';
  const stages = isInvestor ? INVESTOR_STAGES : GAMBLER_STAGES;
  const themeAccent = isInvestor ? 'text-emerald-700 dark:text-emerald-300' : 'text-fuchsia-700 dark:text-fuchsia-300';
  const themeBorder = isInvestor ? 'border-emerald-200 dark:border-emerald-900' : 'border-fuchsia-200 dark:border-fuchsia-900';
  const themeHeaderBg = isInvestor ? 'from-emerald-50 to-teal-50/50 dark:from-emerald-950/40 dark:to-teal-950/20' : 'from-fuchsia-50 to-pink-50/50 dark:from-fuchsia-950/40 dark:to-pink-950/20';
  const gridColor = isInvestor ? 'rgba(16,185,129,0.08)' : 'rgba(217,70,239,0.08)';
  const arrowColor = isInvestor ? '#10b981' : '#d946ef';
  const finalBg = isInvestor ? 'bg-emerald-600' : 'bg-fuchsia-600';
  const personaLabel = isInvestor ? 'المستثمر 🏦' : 'المضارب 🎯';

  return (
    <div
      className={cn(
        'relative rounded-xl border-2 border-dashed overflow-hidden',
        themeBorder,
        'bg-gradient-to-br', themeHeaderBg,
        className,
      )}
      dir="rtl"
    >
      {/* خلفية شبكة هندسية (engineering blueprint grid) */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
        }}
      />

      {/* رأس المخطط */}
      <div className={cn('relative px-4 sm:px-6 pt-4 pb-3 border-b border-dashed', themeBorder)}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Activity className={cn('h-5 w-5', themeAccent)} />
            <h4 className={cn('text-sm font-bold tracking-wide', themeAccent)}>
              مخطط خطوات التحليل — {personaLabel}
            </h4>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" />
            <span>PIPELINE v2 · 5 STAGES · 13 INDICATORS</span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
          من البيانات الخام إلى الإشارة النهائية — يمر كل سهم بخمس مراحل. ذاكرة الخبراء (المرحلة 5) تعدّل طريقة تفكير الآلة بناءً على توصياتك.
        </p>
      </div>

      {/* جسم المخطط — خط الإنتاج */}
      <div className="relative px-3 sm:px-5 py-5">
        <div className="flex flex-col lg:flex-row items-stretch gap-3 lg:gap-1">
          {stages.map((stage, idx) => {
            const Icon = stage.icon;
            return (
              <React.Fragment key={stage.id}>
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      'relative h-full rounded-lg border bg-card/80 backdrop-blur-sm p-3 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5',
                      stage.ring,
                    )}
                  >
                    {/* رقم المرحلة */}
                    <div className={cn('absolute -top-2 -right-2 h-6 w-6 rounded-full text-white text-[11px] font-bold flex items-center justify-center shadow', stage.badge)}>
                      {idx + 1}
                    </div>

                    {/* رأس المرحلة */}
                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-dashed border-border/60">
                      <Icon className={cn('h-4 w-4 flex-shrink-0', stage.accent)} />
                      <div className="min-w-0">
                        <div className={cn('text-xs font-bold truncate', stage.accent)}>{stage.title}</div>
                        <div className="text-[9px] font-mono text-muted-foreground truncate">{stage.subtitle}</div>
                      </div>
                    </div>

                    {/* عناصر المرحلة */}
                    <ul className="space-y-1">
                      {stage.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-1 text-[10px] leading-tight text-foreground/80">
                          <span className={cn('mt-0.5 flex-shrink-0', stage.accent)}>▸</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* سهم بين المراحل (يظهر في المنتصف على الديسكتوب، وأسفل على الموبايل) */}
                {idx < stages.length - 1 && (
                  <div className="flex items-center justify-center lg:px-0.5 py-1 lg:py-0">
                    <div
                      aria-hidden
                      className="hidden lg:block"
                      style={{ color: arrowColor }}
                    >
                      {/* سهم أفقي للديسكتوب (RTL: يشير لليسار) */}
                      <svg width="22" height="14" viewBox="0 0 22 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 7H2M2 7L8 1M2 7L8 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div
                      aria-hidden
                      className="lg:hidden"
                      style={{ color: arrowColor }}
                    >
                      {/* سهم رأسي للجوال (لأسفل) */}
                      <svg width="14" height="22" viewBox="0 0 14 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 1V20M7 20L1 14M7 20L13 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* الإشارة النهائية */}
        <div className="mt-4 flex items-center justify-center">
          <div className="flex items-center gap-2">
            <div className={cn('h-px w-12', isInvestor ? 'bg-emerald-400' : 'bg-fuchsia-400')} />
            <div className={cn('inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-white text-xs font-bold shadow-md', finalBg)}>
              <Target className="h-4 w-4" />
              الإشارة النهائية + مستوى الثقة
            </div>
            <div className={cn('h-px w-12', isInvestor ? 'bg-emerald-400' : 'bg-fuchsia-400')} />
          </div>
        </div>

        {/* تذييل توضيحي — الأوزان */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
          <div className="flex items-center gap-1.5 rounded-md bg-card/60 border border-border/50 px-2 py-1.5">
            <TrendingUp className={cn('h-3.5 w-3.5 flex-shrink-0', themeAccent)} />
            <span className="text-muted-foreground">تصويت موزون: SMFI 25% · Blood 20% · Monte Carlo 15% · Sniper 20%</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md bg-card/60 border border-border/50 px-2 py-1.5">
            <Layers className={cn('h-3.5 w-3.5 flex-shrink-0', themeAccent)} />
            <span className="text-muted-foreground">Cascading Fallback: Strict ← Moderate ← Survival ← Last-Resort</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md bg-card/60 border border-border/50 px-2 py-1.5 col-span-2 sm:col-span-1">
            <Brain className={cn('h-3.5 w-3.5 flex-shrink-0', themeAccent)} />
            <span className="text-muted-foreground">ذاكرة الخبراء: توافق +ثقة · تعارض −ثقة + تحذير</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnalysisFlowDiagram;

'use client';

import React from 'react';
import { Brain, Activity, Shield, Target, Zap, TrendingUp, Database, Cpu, BarChart3, Globe, Timer, Lock, Network, BookOpen, ExternalLink, ArrowRight, Layers } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';

/**
 * AboutView — شاشة "من نحن"
 * ========================
 * تعرض الرؤية الترويجية للمنصة وكيفية تفكيرها الداخلي.
 * النص مُقتبس من المفهوم الإعلاني المقترح من المؤسس.
 */

const SECTIONS = [
  {
    icon: Brain,
    color: 'emerald',
    title: 'منظومة تحليل متكاملة.. بتراقب السوق باستمرار',
    subtitle: 'The Core Brain',
    body: 'المنصة مبنية على الفصل الصارم بين العقل والعرض؛ الباك-إند شغال بلغة Python كمحرك تحليلي عملاق يراقب ويحلل ويدير البيانات الضخمة. المنصة بتعمل سكرابينج وتحديث دائم للأسعار كل 5 دقائق من حركات التداول اللحظية، يعني مفيش شمعة بتتحرك ولا مليم بيدخل السوق إلا والسيستم لقطه وسجله في داتابيز حية.',
    points: [
      'منظومة تحليل متكاملة بتراقب السوق وتعرض النتائج بوضوح',
      'تحديث الأسعار كل 5 دقائق من حركات التداول اللحظية',
      'تسجيل كل شمعة في قاعدة بيانات حية',
    ],
  },
  {
    icon: Activity,
    color: 'cyan',
    title: 'الفلترة بمنطق الصايع و 4 طبقات من السيولة',
    subtitle: 'Flow System Engine + Explosive Scanner',
    body: 'المنظومة مش بتبص على السهم لوحده، تفكيرها بيمر عبر شبكة فلاتر ذكية ومحركات أوتوماتيكية بالكامل. محرك التدفقات بيحلل السهم عبر 4 طبقات متتالية: اتجاه السوق العام (المؤشر)، سيولة القطاع، زخم السهم نفسه، ثم مطابقة كل دول معاً للتأكد إنك داخل مع الموجة مش عكسها.',
    points: [
      'محرك التدفقات: 4 طبقات (مؤشر → قطاع → سهم → مطابقة)',
      'ماسح القنابل: كشف التجميع الخفي للمؤسسات قبل الانفجار',
      'حماية من فخ التصريف: حجم عالي + سعر نازل = خطر',
    ],
  },
  {
    icon: Database,
    color: 'amber',
    title: 'حائط الصد المالي والتقييم الحقيقي',
    subtitle: 'Fundamental Guard — 9 جداول مالية',
    body: 'المنصة بتمتلك كنز حقيقي مدفون جوه قواعد بياناتها؛ بتشرح ميزانيات الشركات أوتوماتيكياً عبر 9 جداول مالية كاملة. المنظومة بتدخل تقرأ: إجمالي أصول الشركة مقابل التزاماتها لتقييم أمانها المالي، وتحسب مضاعفات الربحية (P/E) والـ (P/B)، وتقيس العائد على حقوق الملكية (ROE) وعائد التوزيعات النقدي.',
    points: [
      '9 جداول مالية: الميزانية، قائمة الدخل، التدفقات النقدية، إلخ',
      'حساب القيمة العادلة بمعادلات الاستثمار المؤسسي',
      'مضاعفات P/E، P/B، ROE، عائد التوزيعات',
    ],
  },
  {
    icon: Shield,
    color: 'rose',
    title: 'محرك الحماية الفورية',
    subtitle: 'Dynamic Risk Engine',
    body: 'مفيش توصية شراء بتطلع في المنصة بالبركة. المنظومة بتحسب ديناميكياً سعر الدخول المثالي في مناطق الخصم الفنية القريبة من الدعوم، ووقف الخسارة والهدف بناءً على مدى تذبذب السهم اليومي (ATR) وامتدادات فيبوناتشي. ومستحيل الإشارة تتفعل إلا لو كانت نسبة العائد إلى المخاطرة (R/R) عادلة ومربحة حسابياً.',
    points: [
      'سعر الدخول: مناطق الخصم الفنية قرب الدعوم',
      'وقف + هدف: مبنية على ATR + فيبوناتشي',
      'فلتر R/R: لا توصية بدون نسبة عائد/مخاطرة مربحة',
    ],
  },
  {
    icon: Zap,
    color: 'purple',
    title: 'الخلاصة بالبلدي في شاشة واحدة',
    subtitle: '75% شارت + 25% لوحة تحليلية',
    body: 'كل التعقيد الرياضي، والـ 9 جداول مالية، ومؤشرات الماكد والبولنجر، بيتدفقوا جوه معمارية هندسية بتلخص لك الشاشة لـ 75% شارت تفاعلي نقي ونظيف، ومعه 25% لوحة جانبية فيها التقرير والخلاصة بالعامية المصرية كأنك قاعد مع خبير بورصة محنك على القهوة.',
    points: [
      '75% شارت تفاعلي (lightweight-charts) نقي ونظيف',
      '25% لوحة جانبية: الخلاصة + البيانات المالية + التوافق',
      'نص تحليلي بالعامية المصرية يفهمه أي مستثمر',
    ],
  },
  {
    icon: Globe,
    color: 'indigo',
    title: 'محرك الاقتصاد الكلي (Macro Veto)',
    subtitle: 'The Macro Veto Engine — Behind The Chart',
    body: 'إنت مبقاش بتبيع السهم بناءً على الشارت بس، إنت بتبص وراء الشارت. ربط البنوك (COMI) بارتفاع الفائدة (+10 Boost)، وربط العقارات (ORHD) بارتفاع الفائدة (Veto)، وربط الاستيراد (AUTO) بالدولار، ده منطق "صندوق التحوط" (Hedge Fund) مش منطق برنامج تداول عادي. إنت بقيت بتلعب مع السوق مش ضده.',
    points: [
      'ربط قطاعي ذكي: CS = +Boost، العقارات = Veto عند ارتفاع الفائدة',
      'COMI +10 نقاط عند رفع الفائدة، ORHD = Veto مباشر',
      'AUTO مرتبط بالدولار لحظة بلحظة — منطق صناديق التحوط',
    ],
  },
  {
    icon: Timer,
    color: 'orange',
    title: 'تسوية T+2 وإدارة المخاطر (Position Sizing)',
    subtitle: 'Settlement Safety + Position Sizing',
    body: 'دي أكبر نقطة قوة في النظام دلوقتي. إنت حلّيت مشكلة "السيولة الوهمية". البرنامج بقى بيعرف إن فلوس البيع مش متاحة قبل يومين، وبالتالي مش هتدخل في صفقة جديدة بفلوس مش موجودة. حدود الـ 5% للسهم والـ 30% للتعرض الكلي، دي قواعد بتمنع "الانفجار" (Margin Call) في الـ EGX.',
    points: [
      'T+2 Hunters: فحص السيولة الفعلية قبل فتح الصفقة بغض النظر عن السعر',
      'حد أقصى 5% لرأس المال في سهم واحد + 30% تعرض كلي',
      'حساب حجم الصفقة ديناميكياً بناءً على ATR والوقف',
    ],
  },
  {
    icon: Lock,
    color: 'sky',
    title: 'فلتر الأسهم الحرة (Free Float Filter)',
    subtitle: 'Free Float Gate — Safe Liquidity Only',
    body: 'إنت قفلت باب "اللزوق" في الأسهم المحبوسة. النظام بقى بيعمل Veto لأي سهم الـ Free Float بتاعه أقل من 15% (زي SWDY و EKHO). ده معناه إن النظام بقى بيحمي المستخدم من صانع السهم اللي ممكن يمسك السهم كله ويقفله على إسفل.',
    points: [
      'Veto تلقائي لأي سهم Free Float < 15%',
      'حماية من التلاعب بالسهم وصانع السوق المحبوس',
      'سيولة حقيقية مضمونة — مش سيولة وهمية على الـ Board',
    ],
  },
  {
    icon: Network,
    color: 'fuchsia',
    title: 'طبقة التحليلات المالية الحية',
    subtitle: 'نظام تعلم ذاتي — بيحسّن قراراته باستمرار',
    body: 'النظام بيراقب السوق بشكل مستمر أثناء الجلسة. مش بس بيحلل كل فترة، ده بيكتشف الأسهم النشطة وبيحللها، وبعدين بيسجل النتائج عشان يتعلم منها ويسيب قراراته. ده نظام بيحسّن أداءه باستمرار.',
    points: [
      'Background Analyzer يعمل كل 15 دقيقة لاكتشاف الفرص الساخنة',
      'المحرك بيبحث في التاريخ لأفضل القياسات المشابهة لكل سهم',
      'Learning Loop: كل صفقة مغلقة → tweak params → quick backtest 30d → كتابة فوراً',
    ],
  },
];

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; gradient: string; dot: string }> = {
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800', gradient: 'from-emerald-500 to-teal-600', dot: 'bg-emerald-500' },
  cyan: { bg: 'bg-cyan-50 dark:bg-cyan-950/30', text: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-200 dark:border-cyan-800', gradient: 'from-cyan-500 to-blue-600', dot: 'bg-cyan-500' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', gradient: 'from-amber-500 to-orange-600', dot: 'bg-amber-500' },
  rose: { bg: 'bg-rose-50 dark:bg-rose-950/30', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-200 dark:border-rose-800', gradient: 'from-rose-500 to-pink-600', dot: 'bg-rose-500' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-800', gradient: 'from-purple-500 to-fuchsia-600', dot: 'bg-purple-500' },
  indigo: { bg: 'bg-indigo-50 dark:bg-indigo-950/30', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-200 dark:border-indigo-800', gradient: 'from-indigo-500 to-purple-600', dot: 'bg-indigo-500' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800', gradient: 'from-orange-500 to-red-600', dot: 'bg-orange-500' },
  sky: { bg: 'bg-sky-50 dark:bg-sky-950/30', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-200 dark:border-sky-800', gradient: 'from-sky-500 to-cyan-600', dot: 'bg-sky-500' },
  fuchsia: { bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/30', text: 'text-fuchsia-600 dark:text-fuchsia-400', border: 'border-fuchsia-200 dark:border-fuchsia-800', gradient: 'from-fuchsia-500 to-pink-600', dot: 'bg-fuchsia-500' },
};

export function AboutView() {
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-emerald-950/10" dir="rtl">
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">

        {/* ─── Hero Section ─── */}
        <div className="text-center mb-12 md:mb-16">
          <div className="inline-flex items-center justify-center w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30 mb-6">
            <TrendingUp className="w-10 h-10 md:w-12 md:h-12 text-white" />
          </div>
          <Badge variant="outline" className="mb-4 border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30">
            منصة الاستثمار الذكية
          </Badge>
          <h1 className="text-3xl md:text-5xl font-extrabold mb-4 bg-gradient-to-l from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent leading-tight">
            🚀 ورا كل شمعة على الشارت..<br />
            فيه ميزانيات وملايين بتتحسب!
          </h1>
          <p className="text-base md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            إزاي أداة «دليل الاستثمار» بتفكر وتصطاد الفرص في البورصة؟
          </p>
          <p className="text-sm md:text-base text-muted-foreground/80 mt-3 max-w-2xl mx-auto">
            المستثمر العادي عينيه بتزغلل من كتر الخطوط على الشارت، وبيضيع وسط جداول الأرباح والميزانيات المعقدة. هنا بييجي دور <strong className="text-foreground">«دليل الاستثمار»</strong> — المنصة مش مجرد رسومات بتتحرك، دي منظومة تحليل مالي متكاملة، بتفكر بعقلية أكبر المؤسسات، وبتترجم لك الأرقام دي لـ <strong className="text-foreground">&quot;الخلاصة بالبلدي&quot;</strong> جوه شاشة واحدة ملمومة.
          </p>
        </div>

        {/* ─── Stats Bar ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-12 md:mb-16">
          {[
            { icon: Cpu, label: 'محرك التحليل', value: 'الأساسي', color: 'emerald' },
            { icon: Database, label: 'جداول مالية', value: '9 جداول', color: 'amber' },
            { icon: Activity, label: 'طبقات الفلترة', value: '4 طبقات', color: 'cyan' },
            { icon: BarChart3, label: 'أسهم مصرية', value: '1039+', color: 'purple' },
          ].map((stat, i) => {
            const c = COLOR_MAP[stat.color];
            const Icon = stat.icon;
            return (
              <Card key={i} className={`${c.bg} ${c.border} border`}>
                <CardContent className="p-4 flex flex-col items-center text-center gap-1">
                  <Icon className={`w-6 h-6 ${c.text}`} />
                  <span className={`text-lg md:text-xl font-bold ${c.text}`}>{stat.value}</span>
                  <span className="text-[10px] md:text-xs text-muted-foreground">{stat.label}</span>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ─── Sections ─── */}
        <div className="space-y-6 md:space-y-8">
          {SECTIONS.map((section, idx) => {
            const c = COLOR_MAP[section.color];
            const Icon = section.icon;
            return (
              <Card key={idx} className="overflow-hidden border-border/60 shadow-sm hover:shadow-md transition-shadow">
                <div className={`h-1 bg-gradient-to-l ${c.gradient}`} />
                <CardContent className="p-5 md:p-7">
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-xl bg-gradient-to-br ${c.gradient} flex items-center justify-center shadow-md`}>
                      <Icon className="w-6 h-6 md:w-7 md:h-7 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[10px] md:text-xs font-mono ${c.text} ${c.bg} px-2 py-0.5 rounded`}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="text-[10px] md:text-xs text-muted-foreground font-mono">{section.subtitle}</span>
                      </div>
                      <h2 className="text-lg md:text-2xl font-bold text-foreground leading-tight">
                        {section.title}
                      </h2>
                    </div>
                  </div>

                  <p className="text-sm md:text-base text-muted-foreground leading-relaxed mb-4 pr-1">
                    {section.body}
                  </p>

                  <div className="grid gap-2 pr-1">
                    {section.points.map((point, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs md:text-sm">
                        <div className={`shrink-0 w-1.5 h-1.5 rounded-full ${c.dot} mt-1.5`} />
                        <span className="text-foreground/80">{point}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ─── System Architecture Diagram ─── */}
        <Card className="mt-8 md:mt-12 border-border/60 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="bg-gradient-to-l from-slate-800 to-slate-900 dark:from-slate-900 dark:to-black px-6 py-5 md:px-8 md:py-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base md:text-lg font-bold text-white">🏗️ البنية المعمارية للنظام</h3>
                  <p className="text-xs text-slate-400 font-mono">System Architecture — 4-Layer Pipeline</p>
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-0">
                {[
                  { title: 'مصادر البيانات', sub: 'Data Sources', icon: Database, color: 'emerald', bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-400' },
                  { title: 'المحرك المركزي', sub: 'Core Engine', icon: Cpu, color: 'indigo', bg: 'bg-indigo-500/10 border-indigo-500/30', text: 'text-indigo-400' },
                  { title: 'طبقات التحليل', sub: 'Analysis Layers', icon: Layers, color: 'cyan', bg: 'bg-cyan-500/10 border-cyan-500/30', text: 'text-cyan-400' },
                  { title: 'النتيجة النهائية', sub: 'Final Output', icon: Target, color: 'amber', bg: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-400' },
                ].map((node, i) => {
                  const Icon = node.icon;
                  return (
                    <React.Fragment key={i}>
                      <div className={`flex-1 rounded-xl border ${node.bg} p-4 text-center`}>
                        <Icon className={`w-8 h-8 mx-auto mb-2 ${node.text}`} />
                        <h4 className={`font-bold text-sm ${node.text}`}>{node.title}</h4>
                        <p className="text-[10px] text-slate-400 font-mono mt-1">{node.sub}</p>
                        <div className="mt-3 space-y-1">
                          {i === 0 && (
                            <>
                              <span className="inline-block text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">EGX Macro</span>
                              <span className="inline-block text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">T+2</span>
                              <span className="inline-block text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">Free Float</span>
                            </>
                          )}
                          {i === 1 && (
                            <>
                              <span className="inline-block text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">Python</span>
                              <span className="inline-block text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">Flask</span>
                              <span className="inline-block text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">Background</span>
                            </>
                          )}
                          {i === 2 && (
                            <>
                              <span className="inline-block text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">8 Layers</span>
                              <span className="inline-block text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">MACD</span>
                              <span className="inline-block text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">RSI+Vol</span>
                            </>
                          )}
                          {i === 3 && (
                            <>
                              <span className="inline-block text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">R/R</span>
                              <span className="inline-block text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">Position</span>
                              <span className="inline-block text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">Telegram</span>
                            </>
                          )}
                        </div>
                      </div>
                      {i < 3 && (
                        <div className="hidden md:flex items-center justify-center px-1">
                          <ArrowRight className="w-5 h-5 text-slate-500" />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Decorative bottom line */}
              <div className="mt-6 h-px bg-gradient-to-l from-slate-600 via-slate-700 to-transparent" />
              <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>LIVE PIPELINE</span>
                <span>Python → Next.js → SQLite WAL</span>
                <span>15 MIN CYCLE</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Publish Feature Callout ─── */}
        <Card className="mt-8 md:mt-12 border-amber-500/40 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row items-start gap-4">
              <div className="shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                <Zap className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-mono text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 rounded">
                    ميزة النشر الفوري
                  </span>
                  <span className="text-xs text-muted-foreground">🔥</span>
                </div>
                <h3 className="text-lg md:text-xl font-bold mb-2">انشر التوصيات على تليجرام بضغطة زر</h3>
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                  بضغطة زرار واحدة من شاشة الشارت التفاعلي، المنصة بتلقط Screenshot ذكية للشارت مع بياناته المالية، وتنشر التقرير فوراً كصورة مرفقة بنص التحليل على قنوات التليجرام والجروبات، علشان تشارك النجاح والفرص مع عملائك في ثانية واحدة!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Closing ─── */}
        <div className="text-center mt-12 md:mt-16 mb-8">
          <div className="inline-block">
            <h2 className="text-2xl md:text-4xl font-extrabold bg-gradient-to-l from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent mb-3">
              📈 دليل الاستثمار
            </h2>
            <p className="text-base md:text-lg text-foreground font-semibold mb-1">
              علم الاستثمار المؤسسي.. بلغة تفهمها.
            </p>
            <p className="text-xs md:text-sm text-muted-foreground font-mono">
              invist.m2y.net
            </p>
          </div>
        </div>

        {/* ─── Sources Section ─── */}
        <Card className="mt-8 md:mt-12 border-border/60 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="bg-gradient-to-l from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-6 py-5 md:px-8 md:py-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base md:text-lg font-bold text-foreground">📚 المصادر والمراجع التقنية</h3>
                  <p className="text-xs text-muted-foreground font-mono">Technical Sources & Data Feeds</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Data Sources */}
                <div className="rounded-xl border border-border/60 bg-background/50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="w-4 h-4 text-emerald-600" />
                    <h4 className="font-bold text-sm">مصادر البيانات</h4>
                  </div>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" />
                      <span>البيانات التاريخية من EGX عبر egksco (المصدر الرسمي)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" />
                      <span>البيانات المالية من قواعد البيانات الداخلية (9 جداول)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" />
                      <span>البيانات اللحظية من TradingView Screen API</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" />
                      <span>أسعار الصرف من البنك المركزي المصري CBE</span>
                    </div>
                  </div>
                </div>

                {/* Calculation Logic */}
                <div className="rounded-xl border border-border/60 bg-background/50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Cpu className="w-4 h-4 text-indigo-600" />
                    <h4 className="font-bold text-sm">منطق الحسابات</h4>
                  </div>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-indigo-500" />
                      <span>MACD: 12/26/9 EMA seeded (Wilder smoothing)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-indigo-500" />
                      <span>RSI: Wilder smoothing على 14 فترة</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-indigo-500" />
                      <span>ATR: فترة 14 — Wilder smoothing لاحتساب الوقف</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-indigo-500" />
                      <span>Position Sizing: Risk Formula × T+2 Settlement</span>
                    </div>
                  </div>
                </div>

                {/* منهجية التحليل */}
                <div className="rounded-xl border border-border/60 bg-background/50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-4 h-4 text-fuchsia-600" />
                    <h4 className="font-bold text-sm">المنهجية الذكية</h4>
                  </div>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-fuchsia-500" />
                      <span>محرك بحث تاريخي في الصفقات السابقة لأفضل القياسات</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-fuchsia-500" />
                      <span>Learning Loop: immediate feedback per closed trade</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-fuchsia-500" />
                      <span>Confluence Engine: 8 Layers max 138 pts فحص</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-fuchsia-500" />
                      <span>Sector Gate: فحص 4 أسس قبل أي حساب (P1)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Disclaimer + CTA ─── */}
        <Card className="border-border/40 bg-muted/30">
          <CardContent className="p-5 md:p-6 text-center">
            <p className="text-xs md:text-sm text-muted-foreground mb-4 leading-relaxed">
              ⚠️ هذه المنصة للأغراض التعليمية والتحليلية فقط. المحتوى لا يُعد تحليلاً استثمارياً أو نصيحة مالية.
              استشر متخصصاً مالياً قبل اتخاذ أي قرار استثمار.
            </p>
            <button
              onClick={() => setCurrentView('dashboard')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-l from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:from-emerald-700 hover:to-teal-700 transition-colors shadow-md"
            >
              <TrendingUp className="w-4 h-4" />
              ابدأ الاستكشاف الآن
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

'use client';

/**
 * AboutView — صفحة «من نحن»
 * ============================
 * يعرض تعريفاً مهنياً وقوراً بالمنصة، الأسواق التي يغطيها، ومنهجيتها
 * في تحليل البيانات المالية وإدارة المخاطر.
 *
 * تمت إعادة كتابته (PHASE1-CRITICAL-FIXES) وفقاً للقواعد التالية:
 *  - قاعدة 30 (CLIENT-FACING-STYLE): أسلوب مهني وقور، بدون عامية مصرية.
 *  - قاعدة 31 (NO-HYPE-LANGUAGE): بدون عبارات ترويجية مبالغ فيها.
 *  - بدون مصطلحات تقنية مكشوفة للعميل (Python، سكرابينج، إلخ).
 *  - عربية خالصة في كل العناوين والمحتوى الموجه للعميل.
 */

import React from 'react';
import {
  TrendingUp,
  BarChart3,
  Wallet,
  Bell,
  Eye,
  ShieldCheck,
  Target,
  Globe,
  BookOpen,
  Building2,
  Bitcoin,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';

const MARKETS = [
  {
    icon: Building2,
    label: 'البورصة المصرية',
    sub: 'EGX',
    color: 'emerald',
  },
  {
    icon: Globe,
    label: 'السوق السعودي',
    sub: 'تداول',
    color: 'teal',
  },
  {
    icon: Globe,
    label: 'بورصة الكويت',
    sub: 'KSE',
    color: 'cyan',
  },
  {
    icon: Globe,
    label: 'بورصة قطر',
    sub: 'QSE',
    color: 'amber',
  },
  {
    icon: Bitcoin,
    label: 'العملات الرقمية',
    sub: 'Crypto',
    color: 'orange',
  },
] as const;

const FEATURES = [
  {
    icon: TrendingUp,
    title: 'توقعات يومية قائمة على الأدلة',
    body: 'يصدر نظام التحليل توقعات يومية لكل سهم بناءً على بيانات السوق والقوائم المالية، مع تحديد سعر الدخول والهدف وحد الخسارة لكل توقّع.',
    color: 'emerald',
  },
  {
    icon: BarChart3,
    title: 'تحليل فني شامل',
    body: 'تقييم الاتجاه، مؤشرات الزخم، أحجام التداول، والمستويات الداعمة والمقاومة، عبر منظومة مؤشرات قياسية معتمدة في الأسواق المالية.',
    color: 'teal',
  },
  {
    icon: Wallet,
    title: 'متابعة المحفظة',
    body: 'متابعة مركز موحد لجميع أصولك — أسهم، ذهب، شهادات، وعملات رقمية — مع حساب الأرباح والخسائر والتعرض القطاعي تلقائياً.',
    color: 'amber',
  },
  {
    icon: ShieldCheck,
    title: 'إدارة المخاطر',
    body: 'يضع النظام حدوداً واضحة لحجم المركز في كل صفقة، ويأخذ في الاعتبار قواعد التسوية ونسبة الأسهم الحرة المتداولة، بهدف الحد من المخاطر غير المحسوبة.',
    color: 'rose',
  },
  {
    icon: Bell,
    title: 'تنبيهات الأسعار',
    body: 'تنبيهات فورية عند وصول السعر إلى المستويات المحددة مسبقاً، مع إمكانية تخصيص قواعد التنبيه لكل سهم على حدة.',
    color: 'orange',
  },
  {
    icon: Eye,
    title: 'قوائم المراقبة',
    body: 'إمكانية متابعة الأسهم المفضلة في مكان واحد، مع عرض ملخص الأداء والتحليلات المرتبطة بكل سهم.',
    color: 'cyan',
  },
] as const;

const COLOR_CLASSES: Record<
  string,
  { bg: string; text: string; border: string; gradient: string; dot: string }
> = {
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
    gradient: 'from-emerald-500 to-teal-600',
    dot: 'bg-emerald-500',
  },
  teal: {
    bg: 'bg-teal-50 dark:bg-teal-950/30',
    text: 'text-teal-600 dark:text-teal-400',
    border: 'border-teal-200 dark:border-teal-800',
    gradient: 'from-teal-500 to-emerald-600',
    dot: 'bg-teal-500',
  },
  cyan: {
    bg: 'bg-cyan-50 dark:bg-cyan-950/30',
    text: 'text-cyan-600 dark:text-cyan-400',
    border: 'border-cyan-200 dark:border-cyan-800',
    gradient: 'from-cyan-500 to-teal-600',
    dot: 'bg-cyan-500',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    gradient: 'from-amber-500 to-orange-600',
    dot: 'bg-amber-500',
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    text: 'text-orange-600 dark:text-orange-400',
    border: 'border-orange-200 dark:border-orange-800',
    gradient: 'from-orange-500 to-red-600',
    dot: 'bg-orange-500',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    text: 'text-rose-600 dark:text-rose-400',
    border: 'border-rose-200 dark:border-rose-800',
    gradient: 'from-rose-500 to-pink-600',
    dot: 'bg-rose-500',
  },
};

export function AboutView() {
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-background via-background to-emerald-950/5"
      dir="rtl"
    >
      <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        {/* ─── مقدمة ─── */}
        <div className="text-center mb-10 md:mb-14">
          <div className="inline-flex items-center justify-center w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30 mb-5">
            <TrendingUp className="w-8 h-8 md:w-10 md:h-10 text-white" />
          </div>
          <Badge
            variant="outline"
            className="mb-4 border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
          >
            منصة تحليل مالي متخصصة
          </Badge>
          <h1 className="text-2xl md:text-4xl font-extrabold mb-3 text-foreground leading-tight">
            منصة «دليل الاستثمار»
          </h1>
          <p className="text-sm md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            منصة تحليل مالي تخدم المستثمر العربي عبر توفير تحليلات يومية للأسواق
            المالية، وتوقعات قائمة على الأدلة، وأدوات متابعة المحفظة وإدارة
            المخاطر — في واجهة عربية واحدة متكاملة.
          </p>
        </div>

        {/* ─── الأسواق المغطاة ─── */}
        <Card className="mb-8 md:mb-10 border-border/60 shadow-sm overflow-hidden">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Globe className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg md:text-xl font-bold text-foreground">
                  الأسواق المغطاة
                </h2>
                <p className="text-xs md:text-sm text-muted-foreground">
                  تتبع المنصة عدة أسواق مالية إقليمية وعالمية
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {MARKETS.map((m) => {
                const c = COLOR_CLASSES[m.color];
                const Icon = m.icon;
                return (
                  <div
                    key={m.sub}
                    className={`rounded-xl border ${c.border} ${c.bg} p-3 text-center`}
                  >
                    <Icon className={`w-6 h-6 mx-auto mb-2 ${c.text}`} />
                    <div className={`text-sm font-bold ${c.text}`}>{m.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {m.sub}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ─── منهجية التحليل ─── */}
        <Card className="mb-8 md:mb-10 border-border/60 shadow-sm overflow-hidden">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
                <Target className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg md:text-xl font-bold text-foreground">
                  منهجية التحليل
                </h2>
                <p className="text-xs md:text-sm text-muted-foreground">
                  يقوم نظام التحليل على معايير مهنية في قراءة البيانات المالية
                </p>
              </div>
            </div>
            <div className="space-y-3 text-sm md:text-base text-muted-foreground leading-relaxed">
              <p>
                يعتمد النظام على تحليل البيانات المالية الموثقة من مصادر معتمدة،
                ويوظّف مؤشرات قياسية معروفة في الأسواق المالية لتقييم اتجاهات
                الأسعار، ومقارنة القيمة السوقية بالقيمة العادلة، وقياس سيولة السهم
                والتعرض القطاعي.
              </p>
              <p>
                تُمرّر جميع التوقعات عبر منظومة فلاتر تهدف إلى الحد من المخاطر غير
                المحسوبة، وتشمل مراجعة ملاءته المالية للشركات، والتأكد من أن نسبة
                العائد المتوقع إلى المخاطرة مناسبة قبل طرح أي توقّع.
              </p>
              <p>
                تقوم المنصة بمتابعة أداء التوقعات السابقة وقياس مدى تطابقها مع
                النتائج الفعلية، بغرض التحسين المستمر للمنهجية.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ─── المزايا الرئيسية ─── */}
        <div className="mb-8 md:mb-10">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-bold text-foreground">
                المزايا الرئيسية
              </h2>
              <p className="text-xs md:text-sm text-muted-foreground">
                أدوات متكاملة لاتخاذ قرارات استثمارية أكثر اطّلاعاً
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FEATURES.map((f) => {
              const c = COLOR_CLASSES[f.color];
              const Icon = f.icon;
              return (
                <Card
                  key={f.title}
                  className="overflow-hidden border-border/60 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className={`h-0.5 bg-gradient-to-l ${c.gradient}`} />
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3 mb-2">
                      <div
                        className={`shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${c.gradient} flex items-center justify-center`}
                      >
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <h3 className="text-base font-bold text-foreground pt-1">
                        {f.title}
                      </h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed pr-1">
                      {f.body}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* ─── إخلاء المسؤولية ─── */}
        <Card className="mb-8 md:mb-10 border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 overflow-hidden">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-foreground mb-1.5">
                  إخلاء المسؤولية
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  تقدّم منصة «دليل الاستثمار» محتوى تحليلياً وأدوات لقراءة الأسواق
                  لأغراض تعليمية وإعلامية فقط، ولا يُعدّ أي من المحتوى المعروض
                  استشارة مالية أو دعوة لشراء أو بيع أي ورقة مالية. القرار
                  الاستثماري النهائي مسؤولية المستخدم وحده. يُنصح بالرجوع إلى
                  مستشار مالي مرخّص قبل اتخاذ أي قرار استثماري. الأداء السابق لا
                  يضمن النتائج المستقبلية.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── مصادر البيانات ─── */}
        <Card className="mb-8 md:mb-10 border-border/60 shadow-sm overflow-hidden">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-lg md:text-xl font-bold text-foreground">
                مصادر البيانات
              </h2>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5" />
                <span>
                  بيانات الأسعار التاريخية واللحظية من مصادر معتمدة لكل سوق.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5" />
                <span>
                  القوائم المالية للشركات المدرجة من التقارير الرسمية الصادرة عن
                  كل شركة.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5" />
                <span>
                  مؤشرات الاقتصاد الكلي وأسعار العملات والمعادن من البنوك المركزية
                  والأسواق المعتمدة.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5" />
                <span>الأخبار المالية من مصادر إخبارية متخصصة.</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* ─── الخاتمة ─── */}
        <div className="text-center mt-10 md:mt-12 mb-8">
          <button
            onClick={() => setCurrentView('dashboard')}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-l from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:from-emerald-700 hover:to-teal-700 transition-colors shadow-md"
          >
            <TrendingUp className="w-4 h-4" />
            الانتقال إلى لوحة التحكم
          </button>
          <p className="text-xs text-muted-foreground mt-4">
            منصة «دليل الاستثمار» — تحليل مهني لخدمة المستثمر العربي.
          </p>
        </div>
      </div>
    </div>
  );
}

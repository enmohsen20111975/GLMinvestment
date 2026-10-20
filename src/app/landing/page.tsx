'use client';

import { NextResponse } from 'next/server';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Waves, TrendingUp, ShieldCheck, Globe, BarChart3, Activity,
  ArrowLeft, Sparkles, CheckCircle2, Zap, Target, Eye, Award
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background page-transition" dir="rtl">
      {/* ─── Hero Section ─── */}
      <section className="relative overflow-hidden gradient-border mx-4 mt-6 rounded-2xl">
        <div className="absolute inset-0 via-transparent " />
        <div className="relative px-6 py-16 md:py-24 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Sparkles className="w-4 h-4" />
              المنصة العربية الأذكى لتحليل الأسواق
            </span>
            <h1 className="text-4xl md:text-6xl font-extrabold text-foreground mb-6 leading-tight">
              دليل الاستثمار
              <span className="block text-2xl md:text-3xl text-primary mt-2 glow-primary">
                مش بس بنقولك اشتري... بنقولك ليه ومين بيحرّك السعر
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
              المنصة الوحيدة اللي فيها رادار سيولة صانع السوق + توقعات مثبتة إحصائياً + 6 أسواق في مكان واحد
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-primary text-primary-foreground font-bold hover:shadow-lg transition-all focus-ring"
              >
                ابدأ مجاناً
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <Link
                href="/#dashboard"
                className="inline-flex items-center gap-2 px-8 py-3 rounded-lg border border-border bg-card text-foreground font-bold hover:border-primary/40 transition-all focus-ring"
              >
                <Eye className="w-4 h-4" />
                شوف العرض التوضيحي
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── USP Cards (4 ميزات قاتلة) ─── */}
      <section className="px-4 py-16 max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          ليه دليل الاستثمار مش زي أي منصة تانية؟
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <USPCard
            icon={<Waves className="w-8 h-8" />}
            title="رادار الحيتان"
            subtitle="شوف مين بيحرّك السعر"
            description="رادار سيولة صانع السوق بيكشف: تدفق الحيتان، التجميع الهادئ، التصريف الصريح، وتجميع القيعان. مفيش حد تاني عندو."
            badge="حصري"
            color="profit"
          />
          <USPCard
            icon={<ShieldCheck className="w-8 h-8" />}
            title="توقعات موثقة"
            subtitle="مثبتة بالأرقام"
            description="استراتيجية event-driven مثبتة إحصائياً (p<1% في 3 من 4 سنين) + Sharpe Ratio 1.45-3.84. بنثبت كلامنا بالأرقام."
            badge="موثق"
            color="primary"
          />
          <USPCard
            icon={<Globe className="w-8 h-8" />}
            title="6 أسواق في مكان واحد"
            subtitle="مش EGX بس"
            description="البورصة المصرية + السعودية + الكويت + قطر + الأسواق الأمريكية + العملات الرقمية + الذهب. ليه تدفع لـ 6 منصات؟"
            badge="توفير"
            color="whale"
          />
          <USPCard
            icon={<Award className="w-8 h-8" />}
            title="audit شفاف للإشارات"
            subtitle="testing → proven → closed"
            description="بناكل عيش من المصداقية. بنقولك 'ده تحت الاختبار' قبل ما نقولك 'اشتري'. مفيش حد بيعمل كده غيرنا."
            badge="شفافية"
            color="warning"
          />
        </div>
      </section>

      {/* ─── Live Stats (social proof) ─── */}
      <section className="px-4 py-16 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">أرقام تتكلم</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatCard number="324+" label="سهم مصري بنحللهم" />
            <StatCard number="454" label="API endpoint متاح" />
            <StatCard number="6" label="أسواق مالية" />
            <StatCard number="50+" label="شاشة تحليل متكاملة" />
          </div>
        </div>
      </section>

      {/* ─── Comparison Section (vs FoudaLens) ─── */}
      <section className="px-4 py-16 max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">
          مقارنة صريحة مع المنافسين
        </h2>
        <p className="text-center text-muted-foreground mb-12">
          مش بنخاف من المقارنة — بنفتخر بيه
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border border-border rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-muted">
                <th className="p-4 text-right font-bold">الميزة</th>
                <th className="p-4 text-center font-bold text-primary">دليل الاستثمار</th>
                <th className="p-4 text-center font-bold text-muted-foreground">المنافس</th>
              </tr>
            </thead>
            <tbody>
              <ComparisonRow feature="رادار سيولة صانع السوق" us={true} competitor={false} />
              <ComparisonRow feature="توقعات event-driven موثقة" us={true} competitor={false} />
              <ComparisonRow feature="audit lifecycle (testing/proven/closed)" us={true} competitor={false} />
              <ComparisonRow feature="6 أسواق مالية" us={true} competitor={false} />
              <ComparisonRow feature="حسابات إسلامية (زكاة/ذهب/شهادات)" us={true} competitor={false} />
              <ComparisonRow feature="إنقاذ الأسهم المزنوقة" us={true} competitor={false} />
              <ComparisonRow feature="محرك القرار المؤسسي V82" us={true} competitor={false} />
              <ComparisonRow feature="Smart Confluence (تجميع كل التحليلات)" us={true} competitor={false} />
              <ComparisonRow feature="توقعات يومية" us={true} competitor={true} />
              <ComparisonRow feature="باك تست" us={true} competitor={true} />
              <ComparisonRow feature="أكاديمية تعليمية" us={true} competitor={true} />
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── Pricing Teaser ─── */}
      <section className="px-4 py-16 bg-muted/30">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">ابدأ مجاناً — وادفع أقل من المنافس</h2>
          <p className="text-muted-foreground mb-12">
            باقات تبدأ من 200 جنيه/شهر — أرخص من أي منصة تانية
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <PricingCard
              name="Free"
              price="0"
              period="مجاناً للأبد"
              features={['3 توقعات يومياً', 'رادار محدود', 'dashboard أساسي']}
              cta="ابدأ مجاناً"
            />
            <PricingCard
              name="Pro"
              price="200"
              period="جنيه/شهر"
              features={['كل التوقعات', 'رادار كامل', 'باك تست', '6 أسواق']}
              cta="اشترك دلوقتي"
              highlighted
            />
            <PricingCard
              name="Premium"
              price="350"
              period="جنيه/شهر"
              features={['كل ميزات Pro', 'محرك V82', 'API access', 'تنبيهات لا محدودة']}
              cta="اطلب Premium"
            />
          </div>
        </div>
      </section>

      {/* ─── CTA Section ─── */}
      <section className="px-4 py-16">
        <div className="max-w-4xl mx-auto text-center gradient-border rounded-2xl p-12">
          <h2 className="text-3xl font-bold mb-4">جاهز تبدأ؟</h2>
          <p className="text-muted-foreground mb-8">
            انضم لآلاف المستثمرين اللي بيـ trustوا دليل الاستثمار
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-lg bg-primary text-primary-foreground font-bold text-lg hover:shadow-lg transition-all focus-ring"
          >
            ابدأ مجاناً دلوقتي
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="px-4 py-8 border-t border-border text-center text-sm text-muted-foreground">
        <p>© 2026 دليل الاستثمار — invist.m2y.net</p>
        <p className="mt-2">تحليل تلقائي — ليس نصيحة استثمارية</p>
      </footer>
    </div>
  );
}

// ─── USP Card Component ───────────────────────────────────────────────────
function USPCard({
  icon, title, subtitle, description, badge, color
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  badge: string;
  color: 'profit' | 'primary' | 'whale' | 'warning';
}) {
  const colorClasses = {
    profit: 'bg-profit/10 text-profit border-profit/20',
    primary: 'bg-primary/10 text-primary border-primary/20',
    whale: 'bg-whale/10 text-whale border-whale/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className={`card-premium rounded-xl p-6 border ${colorClasses[color]}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${colorClasses[color]}`}>
          {badge}
        </span>
      </div>
      <h3 className="text-2xl font-bold text-foreground mb-1">{title}</h3>
      <p className={`text-sm font-medium mb-3 text-${color === 'profit' ? 'profit' : color === 'whale' ? 'whale' : color === 'warning' ? 'warning' : 'primary'}`}>
        {subtitle}
      </p>
      <p className="text-muted-foreground leading-relaxed">{description}</p>
    </motion.div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────
function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-4xl md:text-5xl font-extrabold text-primary font-mono tabular-nums glow-primary mb-2">
        {number}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── Comparison Row ───────────────────────────────────────────────────────
function ComparisonRow({
  feature, us, competitor
}: {
  feature: string;
  us: boolean;
  competitor: boolean;
}) {
  return (
    <tr className="border-t border-border">
      <td className="p-4 text-right text-foreground font-medium">{feature}</td>
      <td className="p-4 text-center">
        {us ? (
          <CheckCircle2 className="w-6 h-6 text-profit mx-auto" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-4 text-center">
        {competitor ? (
          <CheckCircle2 className="w-6 h-6 text-muted-foreground mx-auto" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── Pricing Card ─────────────────────────────────────────────────────────
function PricingCard({
  name, price, period, features, cta, highlighted
}: {
  name: string;
  price: string;
  period: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`card-premium rounded-xl p-6 border ${
        highlighted ? 'border-primary shadow-lg scale-105' : 'border-border'
      }`}
    >
      {highlighted && (
        <span className="block text-center mb-4">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
            <Zap className="w-3 h-3" />
            الأكثر شيوعاً
          </span>
        </span>
      )}
      <h3 className="text-2xl font-bold text-center mb-2">{name}</h3>
      <div className="text-center mb-6">
        <span className="text-4xl font-extrabold font-mono tabular-nums glow-primary">{price}</span>
        <div className="text-sm text-muted-foreground mt-1">{period}</div>
      </div>
      <ul className="space-y-3 mb-6">
        {features.map((f, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-profit flex-shrink-0" />
            <span className="text-foreground">{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/"
        className={`block text-center py-3 rounded-lg font-bold transition-all focus-ring ${
          highlighted
            ? 'bg-primary text-primary-foreground hover:shadow-lg'
            : 'border border-border text-foreground hover:border-primary/40'
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}

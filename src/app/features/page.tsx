'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Layers, Activity, BarChart3, Target, Clock, Calendar,
  TrendingUp, Shield, Award, Zap, Eye, Search,
  Sparkles, Waves, Globe, BookOpen, Calculator,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background page-transition" dir="rtl">
      <section className="relative overflow-hidden gradient-border mx-4 mt-6 rounded-2xl">
        <div className="absolute inset-0 via-transparent " />
        <div className="relative px-6 py-16 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Sparkles className="w-4 h-4" />
            كنوز المنصة — 50+ ميزة متكاملة
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold text-foreground mb-4">
            كل اللي محتاجه في مكان واحد
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
            مش بس رادار حيتان وتوقعات موثقة — عندنا كمان: عمق السوق، أثر الحيتان، توقيت الدخول، الموسمية، إنقاذ الأسهم المزنوقة، وأكتر
          </p>
        </div>
      </section>

      <section className="px-4 py-16 max-w-6xl mx-auto">
        <FeatureCategory
          title="🌊 رادار وتدفق السيولة"
          subtitle="ميزات مفيش عند أي منافس"
          features={[
            {
              icon: <Waves className="w-6 h-6" />,
              title: "رادار صانع السوق",
              description: "بيكشف: تدفق حيتان قوي، تجميع هادئ، تصريف صريح، تجميع قيعان، انفجار، اختراق مبكر. بيتحدث كل جلسة.",
              badge: "حصري",
              link: "/#liquidity-radar",
            },
            {
              icon: <Activity className="w-6 h-6" />,
              title: "عمق السوق (Level-2)",
              description: "MarketDepthLiquidityWidget بيعرض دفتر الأوامر من بيانات intraday حقيقية. Asks/Bids + Imbalance + Spread. مش fake data.",
              badge: "شغال",
              link: "/#market-depth",
            },
            {
              icon: <Layers className="w-6 h-6" />,
              title: "أثر الحيتان (Footprint)",
              description: "/api/flow/[ticker] — حساب CLV-5d + CMF-20d + vol_confirmation. سيولة حقيقية مش 70/30 وهمي.",
              badge: "متقدم",
              link: "/#whale-flow",
            },
            {
              icon: <Target className="w-6 h-6" />,
              title: "توقيت الدخول",
              description: "/api/maker-radar/entry-timing بيحسب أفضل توقيت للدخول من 30 يوم تاريخي. buyDays + volume pattern + breakout.",
              badge: "متقدم",
              link: "/#entry-timing",
            },
          ]}
        />

        <FeatureCategory
          title="🔮 التوقعات والقرارات"
          subtitle="بناكل عيش من المصداقية"
          features={[
            {
              icon: <Shield className="w-6 h-6" />,
              title: "توقعات بـ lifecycle audit",
              description: "testing (تحت الاختبار) → proven (متأكدة) → closed (انتهت). مفيش حد بيعمل audit شفاف كده غيرنا.",
              badge: "حصري",
              link: "/#recommendations",
            },
            {
              icon: <Award className="w-6 h-6" />,
              title: "event-driven strategy",
              description: "استراتيجية مثبتة إحصائياً (p<1% في 3 من 4 سنين) + Sharpe Ratio 1.45-3.84. موثقة بالكامل.",
              badge: "موثق",
              link: "/#backtesting",
            },
            {
              icon: <Sparkles className="w-6 h-6" />,
              title: "Smart Confluence",
              description: "/api/smart-confluence — بيجمّع كل التحليلات (فني + أساسي + سيولة + sentiment) في قرار واحد. ميزة قاتلة.",
              badge: "متقدم",
              link: "/#smart-confluence",
            },
          ]}
        />

        <FeatureCategory
          title="💼 إدارة المحفظة"
          subtitle="مش بس تحليل — إدارة كاملة"
          features={[
            {
              icon: <TrendingUp className="w-6 h-6" />,
              title: "إنقاذ الأسهم المزنوقة",
              description: "bagholder-rescue — محرك ذكي بيحلل السهم المزنوق ويقولك: تحدد، تتوسط، تطلع؟ قرار مدروس مش عاطفي.",
              badge: "حصري",
              link: "/#bagholder-rescue",
            },
            {
              icon: <BarChart3 className="w-6 h-6" />,
              title: "إدارة الثروة",
              description: "/api/money/wealth + /api/money/smart-monitor — tracking كامل للثروة + تنبيهات ذكية. من بياناتك الفعلية.",
              badge: "متقدم",
              link: "/#wealth",
            },
            {
              icon: <Calculator className="w-6 h-6" />,
              title: "المحفظة المتقدمة",
              description: "EnhancedPortfolioView — تحليل عميق للمحفظة: P&L + exposure + correlation + rebalancing.",
              badge: "شغال",
              link: "/#advanced-portfolio",
            },
            {
              icon: <Clock className="w-6 h-6" />,
              title: "سجل التداول",
              description: "trading-journal — سجل كل صفقاتك + تعلم منها. مهم للنمو كمستثمر.",
              badge: "شغال",
              link: "/#trading-journal",
            },
          ]}
        />

        <FeatureCategory
          title="📊 تحليلات متقدمة"
          subtitle="تحليل زي المحترفين"
          features={[
            {
              icon: <Search className="w-6 h-6" />,
              title: "فلتر الأسهم المتقدم",
              description: "StockScreenerAdvanced — 20+ فلتر (فني + أساسي + سيولة + RSI + volume). أوصل للسهم اللي عاوزه في ثواني.",
              badge: "شغال",
              link: "/#screener",
            },
            {
              icon: <Eye className="w-6 h-6" />,
              title: "التحليل الموحد",
              description: "unified-analysis + specialist-analysis — كل تحليلات السهم في شاشة واحدة (شارت + DNA + SMC + احتمال الشمعة).",
              badge: "شغال",
              link: "/#unified-analysis",
            },
            {
              icon: <Activity className="w-6 h-6" />,
              title: "Live Monitor",
              description: "live-monitor — رصد لحظي للسوق + تنبيهات فورية + whale alerts. شاشة البورصة الكاملة.",
              badge: "شغال",
              link: "/#live-monitor",
            },
          ]}
        />

        <FeatureCategory
          title="📚 تعليم + أدوات"
          subtitle="تتعلم وانت بتتداول"
          features={[
            {
              icon: <BookOpen className="w-6 h-6" />,
              title: "الأكاديمية",
              description: "AcademyView + LearningVisuals — دروس شاملة بالعربي. من الأساسيات للمتقدم. مع رسوم توضيحية.",
              badge: "شغال",
              link: "/#academy",
            },
            {
              icon: <Calculator className="w-6 h-6" />,
              title: "حسابات إسلامية",
              description: "zakat (زكاة الأسهم) + tithes (العشور) + sharia (فلاتر شرعية). المنصة الوحيدة اللي بتهتم بـ دينك.",
              badge: "حصري",
              link: "/#zakat",
            },
            {
              icon: <Globe className="w-6 h-6" />,
              title: "6 أسواق في مكان واحد",
              description: "EGX + TADAWUL + KSE + QSE + US + Crypto + Gold. ليه تدفع لـ 6 منصات؟",
              badge: "حصري",
              link: "/#multi-market",
            },
            {
              icon: <BarChart3 className="w-6 h-6" />,
              title: "باك تست + محاكاة",
              description: "simulation + backtesting — جرب استراتيجيتك قبل ما تخاطر بفلوسك. مع walk-forward-test.",
              badge: "شغال",
              link: "/#simulation",
            },
          ]}
        />
      </section>

      <section className="px-4 py-16">
        <div className="max-w-4xl mx-auto text-center gradient-border rounded-2xl p-12">
          <h2 className="text-3xl font-bold mb-4">جاهز تكتشف كل الكنوز؟</h2>
          <p className="text-muted-foreground mb-8">
            50+ شاشة + 454 API + 155 component — كل ده في منصة واحدة
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-lg bg-primary text-primary-foreground font-bold text-lg hover:shadow-lg transition-all focus-ring"
          >
            ابدأ الاستكشاف
          </Link>
        </div>
      </section>

      <footer className="px-4 py-8 border-t border-border text-center text-sm text-muted-foreground">
        <p>© 2026 دليل الاستثمار — invist.m2y.net</p>
        <p className="mt-2">تحليل تلقائي — ليس نصيحة استثمارية</p>
      </footer>
    </div>
  );
}

function FeatureCategory({
  title, subtitle, features
}: {
  title: string;
  subtitle: string;
  features: Array<{
    icon: React.ReactNode;
    title: string;
    description: string;
    badge: string;
    link: string;
  }>;
}) {
  return (
    <div className="mb-16">
      <div className="mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">{title}</h2>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((f, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
          >
            <Link href={f.link} className="block h-full">
              <div className="card-premium rounded-xl p-6 border border-border hover:border-primary/40 transition-all h-full">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-lg bg-primary/10 text-primary">
                    {f.icon}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                    f.badge === 'حصري' ? 'bg-profit/10 text-profit border border-profit/20' :
                    f.badge === 'موثق' ? 'bg-primary/10 text-primary border border-primary/20' :
                    f.badge === 'متقدم' ? 'bg-whale/10 text-whale border border-whale/20' :
                    'bg-muted text-muted-foreground border border-border'
                  }`}>
                    {f.badge}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">{f.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{f.description}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

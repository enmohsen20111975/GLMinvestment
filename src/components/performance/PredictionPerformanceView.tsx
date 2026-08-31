'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Target, Shield, Award, Zap,
  BarChart3, Activity, RefreshCw, CheckCircle, XCircle,
  Building2, Globe, Coins, Star, ArrowUpRight, ArrowDownRight,
  Calendar, PieChart, Copy, Share2, Download
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { toast } from 'sonner';
import {
  AreaChart, Area, PieChart as RechartsPie, Pie, Cell,
  ResponsiveContainer, RadialBarChart, RadialBar, Legend,
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TopTradesImageCard } from '@/components/market/TopTradesImageCard';

// ============================================================================
// TYPES
// ============================================================================

interface PerformanceData {
  performance: {
    total_predictions: number;
    active_predictions: number;
    closed_predictions: number;
    successful: number;
    stopped: number;
    success_rate: number;
    avg_return: number;
    best_return: number;
    high_confidence_rate: number;
    medium_confidence_rate: number;
    low_confidence_rate: number;
    // HEDGE-FUND-036: Hedge Fund-grade metrics
    total_trades?: number;
    winning_trades?: number;
    losing_trades?: number;
    gross_profit?: number;
    gross_loss?: number;
    profit_factor?: number;
    avg_rr?: number;
    sample_size_small?: boolean;
  };
  // TOP-TRADES-037: أفضل صفقات الشهر
  top_monthly_trades?: Array<{
    ticker: string;
    name_ar: string;
    entry_price: number;
    exit_price: number;
    profit_pct: number;
    holding_days: number;
    signal?: string;
    outcome_date?: string;
  }>;
  stats: {
    today: number;
    weekly: number;
    monthly: number;
    totalProfitLoss: string;
  };
  closedPredictions: Array<{
    id: string;
    ticker: string;
    stock_name_ar?: string;
    prediction_type: string;
    confidence: number;
    final_pl_percent?: number;
    hit_target: boolean;
    hit_stop_loss: boolean;
    market?: string;
    prediction_date: string;
    days_to_result?: number;
  }>;
  byMarket?: Record<string, {
    total: number;
    targets_hit: number;
    stops_hit: number;
    avg_return: number;
  }>;
}

// ============================================================================
// TRACKING TYPES (from /api/python/predictions/tracking/history)
// ============================================================================

interface TrackingPrediction {
  id: string;
  symbol: string;
  name?: string;
  signal_type?: string;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  prediction_date: string;
  status: string;
  final_price?: number;
  profit_loss_percent?: number;
  hit_target?: boolean;
  hit_stop_loss?: boolean;
  target_hit_date?: string;
  stop_hit_date?: string;
  evaluation_date?: string;
  actual_return?: number;
  holding_days?: number;
  market?: string;
  maestro_score?: number;
  confidence?: number;
}

// ============================================================================
// CONSTANTS - Arabic months + market colors for gains charts
// ============================================================================

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const MARKET_LABELS_AR: Record<string, string> = {
  EGX: 'مصر',
  TADAWUL: 'السعودية',
  KSE: 'الكويت',
  QSE: 'قطر',
  CRYPTO: 'عملات رقمية',
};

// لون القطاع حسب نسبة النجاح: أخضر للممتاز، أصفر للمتوسط، أحمر للضعيف
function getWinRateColor(rate: number): string {
  if (rate >= 70) return '#22c55e'; // green-500
  if (rate >= 50) return '#eab308'; // yellow-500
  return '#ef4444'; // red-500
}

function getMarketLabelAr(market: string): string {
  return MARKET_LABELS_AR[market] || market;
}

// ============================================================================
// ANIMATIONS
// ============================================================================

const fadeIn = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.1 } }
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: 'easeOut' } }
};

const slideInRight = {
  hidden: { opacity: 0, x: 50 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: 'easeOut' } }
};

// ============================================================================
// COMPONENTS
// ============================================================================

// Animated Number Counter
const AnimatedNumber = ({ value, duration = 2000, suffix = '', prefix = '', decimals = 0 }: {
  value: number;
  duration?: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
}) => {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplay(value * easeProgress);
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [value, duration]);

  return (
    <span className="tabular-nums">
      {prefix}{display.toFixed(decimals)}{suffix}
    </span>
  );
};

// Progress Ring
const ProgressRing = ({ value, size = 140, strokeWidth = 8, color = '#10b981', label, subtitle }: {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label: string;
  subtitle?: string;
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="transform -rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.5, ease: 'easeOut', delay: 0.5 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-white">
            <AnimatedNumber value={value} decimals={1} suffix="%" />
          </span>
        </div>
      </div>
      <p className="text-white font-medium mt-3">{label}</p>
      {subtitle && <p className="text-slate-400 text-sm mt-1">{subtitle}</p>}
    </div>
  );
};

// Stat Card
const StatCard = ({ icon, label, value, change, positive, color }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  change?: string;
  positive?: boolean;
  color: string;
}) => (
  <motion.div
    variants={scaleIn}
    className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-6 backdrop-blur-sm"
  >
    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-white/5 to-transparent rounded-bl-full" />
    <div className="relative z-10">
      <div className="flex items-center gap-3 mb-4">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", color)}>
          {icon}
        </div>
        <span className="text-slate-400 text-sm">{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-white">{value}</span>
        {change && (
          <span className={cn(
            "text-sm font-medium flex items-center gap-1 mb-1",
            positive ? "text-emerald-400" : "text-red-400"
          )}>
            {positive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            {change}
          </span>
        )}
      </div>
    </div>
  </motion.div>
);

// Market Card
const MarketCard = ({ name, nameAr, predictions, successRate, icon, color }: {
  name: string;
  nameAr: string;
  predictions: number;
  successRate: number;
  icon: React.ReactNode;
  color: string;
}) => (
  <motion.div
    variants={fadeIn}
    className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/60 border border-white/5 p-5 backdrop-blur-sm group hover:border-white/10 transition-all duration-300"
  >
    <div className={cn("absolute top-0 left-0 w-full h-1", color)} />
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", color.replace('h-', 'bg-').replace('-600', '-500/20'))}>
          {icon}
        </div>
        <div>
          <p className="text-white font-medium">{nameAr}</p>
          <p className="text-slate-500 text-xs">{name}</p>
        </div>
      </div>
      <span className="text-slate-400 text-sm">{predictions} توقع</span>
    </div>
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-slate-400 text-sm">نسبة النجاح</span>
        <span className={cn("font-bold", successRate >= 50 ? "text-emerald-400" : "text-amber-400")}>
          {successRate.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full", successRate >= 50 ? "bg-emerald-500" : "bg-amber-500")}
          initial={{ width: 0 }}
          animate={{ width: `${successRate}%` }}
          transition={{ duration: 1, ease: 'easeOut', delay: 0.5 }}
        />
      </div>
    </div>
  </motion.div>
);

// Prediction Row
const PredictionRow = ({ prediction, index }: { prediction: any; index: number }) => {
  const isBuy = prediction.prediction_type === 'BUY';
  const profit = prediction.final_pl_percent || 0;

  const shareText = `📊 توقع منصة دليل الاستثمار:
- السهم: ${prediction.ticker} ${prediction.stock_name_ar ? `(${prediction.stock_name_ar})` : ''}
- الإشارة: ${prediction.prediction_type === 'BUY' ? 'شراء 📈' : 'بيع 📉'}
- النتيجة: ${prediction.hit_target ? '🎯 حقق الهدف بنجاح' : '🛑 ضرب وقف الخسارة'}
- العائد الفعلي: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}%

📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈

🔗 روابطنا الرسمية:
🌐 الموقع الإلكتروني: https://invist.m2y.net
📱 تطبيق أندرويد: https://play.google.com/store/apps/details?id=com.egx.investment
📘 فيسبوك: https://www.facebook.com/profile.php?id=61590600300048
✈️ تليجرام: https://t.me/Arabian_investment_guide`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText);
    toast.success('تم نسخ بيانات التوقع ✓');
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `توقع سهم ${prediction.ticker}`,
          text: shareText
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
      handleCopy();
    }
  };

  return (
    <motion.tr
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="border-b border-white/5 hover:bg-white/5 transition-colors"
    >
      <td className="py-4 px-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
            isBuy ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
          )}>
            {prediction.ticker?.substring(0, 2)}
          </div>
          <div>
            <p className="text-white font-medium">{prediction.ticker}</p>
            {prediction.stock_name_ar && (
              <p className="text-slate-500 text-xs">{prediction.stock_name_ar}</p>
            )}
          </div>
        </div>
      </td>
      <td className="py-4 px-4">
        <span className={cn(
          "px-3 py-1 rounded-full text-xs font-medium",
          isBuy ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
        )}>
          {isBuy ? 'شراء' : 'بيع'}
        </span>
      </td>
      <td className="py-4 px-4">
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full", prediction.confidence >= 70 ? "bg-emerald-500" : prediction.confidence >= 50 ? "bg-amber-500" : "bg-red-500")}
              style={{ width: `${prediction.confidence}%` }}
            />
          </div>
          <span className="text-slate-400 text-sm">{prediction.confidence}%</span>
        </div>
      </td>
      <td className="py-4 px-4">
        <span className={cn(
          "px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 w-fit",
          prediction.hit_target ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
        )}>
          {prediction.hit_target ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          {prediction.hit_target ? 'نجح' : 'توقف'}
        </span>
      </td>
      <td className="py-4 px-4">
        <span className={cn(
          "font-medium",
          profit >= 0 ? "text-emerald-400" : "text-red-400"
        )}>
          {profit >= 0 ? '+' : ''}{profit.toFixed(2)}%
        </span>
      </td>
      <td className="py-4 px-4 text-center">
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
            onClick={handleCopy}
            title="نسخ"
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
            onClick={handleShare}
            title="مشاركة"
          >
            <Share2 className="w-4 h-4" />
          </Button>
        </div>
      </td>
    </motion.tr>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PredictionPerformanceView({ isAdmin = false }: { isAdmin?: boolean }) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<number>(30);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Tracking predictions state (for gains charts - fetched from Python backend)
  const [trackingPredictions, setTrackingPredictions] = useState<TrackingPrediction[]>([]);
  const [trackingLoading, setTrackingLoading] = useState<boolean>(true);

  const fetchData = async (targetDays: number = days) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prediction-performance?days=${targetDays}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch tracking history (with actual_return) for gains charts
  // نطلب 365 يوم وحد أقصى كبير لجمع بيانات السنة كاملة
  const fetchTrackingData = useCallback(async () => {
    setTrackingLoading(true);
    try {
      const res = await fetch('/api/python/predictions/tracking/history?days=365&limit=5000');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setTrackingPredictions(json.data as TrackingPrediction[]);
      }
    } catch (error) {
      console.error('Error fetching tracking data:', error);
    } finally {
      setTrackingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(days);
  }, [days]);

  useEffect(() => {
    fetchTrackingData();
  }, [fetchTrackingData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">جاري تحميل البيانات...</p>
        </div>
      </div>
    );
  }

  if (!data || !data.performance || data.performance.total_predictions === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-500/20 flex items-center justify-center">
            <BarChart3 className="w-10 h-10 text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">لا توجد بيانات توقعات</h2>
          <p className="text-slate-400 mb-6">
            لم يتم توليد أي توقعات بعد. ستظهر البيانات هنا بمجرد توفر التوقعات.
          </p>
          <Button
            onClick={fetchData}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
          >
            <RefreshCw className="w-4 h-4 ml-2" />
            إعادة التحميل
          </Button>
        </motion.div>
      </div>
    );
  }

  const { performance, stats, closedPredictions } = data;

  // Date range labels (used in share/report text)
  const endDateLabel = new Date().toLocaleDateString('ar-EG');
  const startDateLabel = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toLocaleDateString('ar-EG');

  const handleShareReportText = (perf: typeof performance) => {
    const shareText = `📊 أداء منصة دليل الاستثمار للتحليلات والتوقعات الذكية:
- نسبة النجاح الكلية: ${perf.success_rate.toFixed(1)}%
- دقة الثقة العالية (≥70%): ${perf.high_confidence_rate.toFixed(1)}%
- إجمالي التوقعات: ${perf.total_predictions}
- الفترة: من ${startDateLabel} إلى ${endDateLabel}
توقعات ذكية بدقة متناهية لمساعدتك في اتخاذ قراراتك الاستثمارية!

📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈

🔗 روابطنا الرسمية:
🌐 الموقع الإلكتروني: https://invist.m2y.net
📱 تطبيق أندرويد: https://play.google.com/store/apps/details?id=com.egx.investment
📘 فيسبوك: https://www.facebook.com/profile.php?id=61590600300048
✈️ تليجرام: https://t.me/Arabian_investment_guide`;

    navigator.clipboard.writeText(shareText);
    toast.success('تم نسخ نص التقرير للمشاركة ✓');
  };

  const handleShareReport = async () => {
    if (!performance) return;
    const shareText = `📊 أداء منصة دليل الاستثمار للتحليلات والتوقعات الذكية:
- نسبة النجاح الكلية: ${performance.success_rate.toFixed(1)}%
- دقة الثقة العالية (≥70%): ${performance.high_confidence_rate.toFixed(1)}%
- إجمالي التوقعات: ${performance.total_predictions}
- الفترة: من ${startDateLabel} إلى ${endDateLabel}
توقعات ذكية بدقة متناهية لمساعدتك في اتخاذ قراراتك الاستثمارية!

📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈

🔗 روابطنا الرسمية:
🌐 الموقع الإلكتروني: https://invist.m2y.net
📱 تطبيق أندرويد: https://play.google.com/store/apps/details?id=com.egx.investment
📘 فيسبوك: https://www.facebook.com/profile.php?id=61590600300048
✈️ تليجرام: https://t.me/Arabian_investment_guide`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'تقرير أداء دليل الاستثمار',
          text: shareText,
          url: 'https://invist.m2y.net'
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
      handleShareReportText(performance);
    }
  };

  /**
   * تصدير الصفحة كاملةً كصورة PNG عالية الجودة
   * يشمل: الإحصائيات + الرسوم البيانية + الجدول
   * اسم الملف: تقرير-تقييم-التحليلات-YYYY-MM-DD.png
   */
  const handleExportFullReportImage = async () => {
    if (isExporting) return;
    const el = document.getElementById('prediction-performance-report');
    if (!el) {
      toast.error('تعذّر العثور على محتوى التقرير للتصدير');
      return;
    }

    setIsExporting(true);
    const toastId = toast.loading('جاري التقاط صورة التقرير الكامل...');
    try {
      // مهلة قصيرة لضمان استقرار الرسوم البيانية (recharts) قبل الالتقاط
      await new Promise((resolve) => setTimeout(resolve, 500));

      // التاريخ بصيغة YYYY-MM-DD لاسم الملف
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      // حساب الأبعاد الكاملة لمنع قطع الجزء اليمين
      // نستخدم scrollWidth/scrollHeight لضمان التقاط كل المحتوى (حتى لو فيه overflow)
      const rect = el.getBoundingClientRect();
      const fullWidth = Math.max(el.scrollWidth, el.offsetWidth, rect.width, document.documentElement.clientWidth);
      const fullHeight = Math.max(el.scrollHeight, el.offsetHeight, rect.height);

      const dataUrl = await toPng(el, {
        cacheBust: true,
        pixelRatio: 2, // جودة عالية (scale: 2)
        backgroundColor: '#020617', // لون خلفية الصفحة الأصلي
        width: fullWidth,           // عرض كامل = منع قطع اليمين
        height: fullHeight,         // ارتفاع كامل = منع قطع الأسفل
        style: {
          // نضمن إن العنصر يبقى بعرضه الكامل أثناء الالتقاط
          width: `${fullWidth}px`,
          maxWidth: 'none',
          margin: '0',
          padding: '0',
          transform: 'none',
          // الحفاظ على RTL
          direction: 'rtl',
        },
        // معالجة المحتوى اللي بره الـ viewport
        filter: (node) => {
          // نتجاهل أي عناصر ثابتة (sticky/fixed) عشان متتكررش
          if (node && node.nodeType === 1) {
            const style = window.getComputedStyle(node as HTMLElement);
            if (style.position === 'fixed' || style.position === 'sticky') {
              return false;
            }
          }
          return true;
        },
      });

      const link = document.createElement('a');
      link.download = `تقرير-تقييم-التحليلات-${dateStr}.png`;
      link.href = dataUrl;
      link.click();

      toast.success('تم تحميل صورة التقرير بنجاح ✓', { id: toastId });
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('فشل في تصدير صورة التقرير', { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  // Prepare pie chart data
  const pieData = [
    { name: 'ناجحة', value: performance.successful, color: '#10b981' },
    { name: 'موقوفة', value: performance.stopped, color: '#ef4444' },
  ].filter(d => d.value > 0);

  const byMarket = data.byMarket || {};
  const getMarketStats = (key: string, aliasKey?: string) => {
    const main = byMarket[key] || { total: 0, targets_hit: 0 };
    const alias = aliasKey ? (byMarket[aliasKey] || { total: 0, targets_hit: 0 }) : { total: 0, targets_hit: 0 };
    const total = main.total + alias.total;
    const hit = main.targets_hit + alias.targets_hit;
    const rate = total > 0 ? (hit / total) * 100 : 0;
    return { total, rate };
  };

  const egxStats = getMarketStats('EGX');
  const tadawulStats = getMarketStats('TADAWUL', 'السعودية');
  const kseStats = getMarketStats('KSE', 'الكويت');
  const qseStats = getMarketStats('QSE', 'قطر');

  // Group by market - All 4 markets
  const marketData = [
    { name: 'EGX', nameAr: 'البورصة المصرية', predictions: egxStats.total, successRate: egxStats.rate, icon: <Building2 className="w-5 h-5" />, color: 'h-emerald-600' },
    { name: 'TADAWUL', nameAr: 'السوق السعودي', predictions: tadawulStats.total, successRate: tadawulStats.rate, icon: <Globe className="w-5 h-5" />, color: 'h-green-600' },
    { name: 'KSE', nameAr: 'بورصة الكويت', predictions: kseStats.total, successRate: kseStats.rate, icon: <Coins className="w-5 h-5" />, color: 'h-blue-600' },
    { name: 'QSE', nameAr: 'بورصة قطر', predictions: qseStats.total, successRate: qseStats.rate, icon: <Star className="w-5 h-5" />, color: 'h-purple-600' },
  ];

  // ============================================================================
  // GAINS CHARTS DATA (from /api/python/predictions/tracking/history)
  // ============================================================================

  const currentYear = new Date().getFullYear();

  // (أ) المكاسب الشهرية - مجموع actual_return لكل شهر في السنة الحالية
  const monthlyGainsData = ARABIC_MONTHS.map((month, idx) => {
    const total = trackingPredictions
      .filter((p) => {
        if (!p.prediction_date) return false;
        const d = new Date(p.prediction_date);
        return d.getFullYear() === currentYear && d.getMonth() === idx;
      })
      .reduce((sum, p) => sum + (typeof p.actual_return === 'number' ? p.actual_return : 0), 0);
    const rounded = Number(total.toFixed(2));
    return {
      month,
      gain: rounded,
      color: rounded >= 0 ? '#22c55e' : '#ef4444', // green-500 / red-500
    };
  });

  // (ب) النمو التراكمي - مجموع تراكمي لكل الشهور بالترتيب الزمني
  const cumulativeGainsData = monthlyGainsData.reduce(
    (acc, item, idx) => {
      const prev = idx > 0 ? acc[idx - 1].cumulative : 0;
      acc.push({
        month: item.month,
        cumulative: Number((prev + item.gain).toFixed(2)),
      });
      return acc;
    },
    [] as Array<{ month: string; cumulative: number }>,
  );

  // (ج) توزيع التوقعات حسب السوق - حجم القطاع = عدد التوقعات، اللون = نسبة النجاح
  const marketDistributionData = (['EGX', 'TADAWUL', 'KSE', 'QSE', 'CRYPTO'] as const)
    .map((marketKey) => {
      const preds = trackingPredictions.filter((p) => (p.market || '').toUpperCase() === marketKey);
      const total = preds.length;
      const wins = preds.filter(
        (p) => p.status === 'TARGET_HIT' || p.hit_target === true,
      ).length;
      const winRate = total > 0 ? (wins / total) * 100 : 0;
      return {
        name: getMarketLabelAr(marketKey),
        market: marketKey,
        value: total,
        wins,
        winRate: Number(winRate.toFixed(1)),
        color: getWinRateColor(winRate),
      };
    })
    .filter((d) => d.value > 0);

  const hasTrackingData = trackingPredictions.length > 0;
  const hasMonthlyGains = monthlyGainsData.some((d) => d.gain !== 0);
  const hasMarketDistribution = marketDistributionData.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
      </div>

      {/*
        الحاوية الرئيسية المُصدَّرة كصورة (PNG) — تشمل:
        - الهيدر + الإحصائيات العامة
        - بطاقات الإحصائيات (Stats Cards)
        - الرسوم البيانية (Charts)
        - جدول آخر التوقعات المغلقة
      */}
      <div
        id="prediction-performance-report"
        className="relative z-10 max-w-7xl mx-auto px-4 py-8"
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-12 border-b border-white/5 pb-8"
        >
          <div className="text-right">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-2 mb-3">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400 text-sm font-medium">منصة التوقعات الذكية</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-2">
              <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent">
                تقييم أداء التوقعات
              </span>
            </h1>
            <p className="text-slate-400 text-sm max-w-2xl">
              تتبع أداء توقعاتنا بالبيانات الحقيقية والشفافية الكاملة
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-4 justify-start lg:justify-end" dir="rtl">
            {/* Timeframe Selector Pill Group */}
            <div className="bg-slate-800/60 p-1 rounded-full border border-white/5 flex gap-1 items-center backdrop-blur-md">
              {[
                { label: 'أسبوعي', value: 7 },
                { label: 'شهري', value: 30 },
                { label: 'ربع سنوي', value: 90 },
                { label: 'سنوي', value: 365 },
                { label: 'الكل', value: 3650 },
              ].map((item) => (
                <button
                  key={item.value}
                  onClick={() => setDays(item.value)}
                  className={cn(
                    "px-4 py-1.5 text-xs rounded-full transition-all duration-300 font-medium cursor-pointer",
                    days === item.value
                      ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)] font-bold"
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleExportFullReportImage}
                disabled={isExporting}
                className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white border-0 shadow-lg flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                تصدير التقرير كصورة
              </Button>
              <Button
                onClick={handleShareReport}
                variant="outline"
                className="border-white/10 hover:bg-white/5 text-xs rounded-full px-5 py-2 text-slate-300 flex items-center gap-2 cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                مشاركة التقرير
              </Button>
            </div>
          </div>
        </motion.div>

        {/* TOP-TRADES-037: Top Monthly Trades Image Card (للنشر الإعلاني) */}
        {data?.top_monthly_trades && (
          <motion.div
            variants={fadeIn}
            className="mb-10 flex justify-center"
          >
            <TopTradesImageCard trades={data.top_monthly_trades} />
          </motion.div>
        )}

        {/* Main Stats Grid */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10"
        >
          <StatCard
            icon={<Target className="w-5 h-5 text-emerald-400" />}
            label="إجمالي التوقعات"
            value={<AnimatedNumber value={performance.total_predictions} />}
            color="bg-emerald-500/20"
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5 text-green-400" />}
            label="نسبة النجاح"
            value={
              <div className="flex items-center gap-2">
                <AnimatedNumber value={performance.success_rate} decimals={1} suffix="%" />
                {performance.sample_size_small && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-medium whitespace-nowrap">
                    عينة صغيرة
                  </span>
                )}
              </div>
            }
            change={`من ${performance.closed_predictions || performance.total_trades || 0} صفقة مغلقة`}
            positive={true}
            color="bg-green-500/20"
          />
          <StatCard
            icon={<Activity className="w-5 h-5 text-teal-400" />}
            label="توقعات نشطة"
            value={<AnimatedNumber value={performance.active_predictions} />}
            color="bg-teal-500/20"
          />
          <StatCard
            icon={<Shield className="w-5 h-5 text-amber-400" />}
            label="وقف خسارة"
            value={<AnimatedNumber value={performance.stopped} />}
            change="حماية رأس المال"
            positive={false}
            color="bg-amber-500/20"
          />
        </motion.div>

        {/* HEDGE-FUND-036: Hedge Fund-grade Metrics Row */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10"
        >
          {/* Profit Factor */}
          <motion.div
            variants={fadeIn}
            className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-5 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-violet-400" />
              </div>
              <span className="text-[10px] text-slate-400 font-medium">Profit Factor</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${
                (performance.profit_factor ?? 0) > 1.5 ? 'text-emerald-400' :
                (performance.profit_factor ?? 0) < 1.0 ? 'text-red-400' : 'text-amber-400'
              }`}>
                {(performance.profit_factor ?? 0) >= 99 ? '∞' : (performance.profit_factor ?? 0).toFixed(2)}
              </span>
              <span className="text-xs text-slate-400">:1</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              الربح / الخسارة — {(performance.gross_profit ?? 0).toFixed(1)}% / {(performance.gross_loss ?? 0).toFixed(1)}%
            </p>
          </motion.div>

          {/* Avg R/R */}
          <motion.div
            variants={fadeIn}
            className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-5 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                <Activity className="w-5 h-5 text-cyan-400" />
              </div>
              <span className="text-[10px] text-slate-400 font-medium">Avg R/R</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${
                (performance.avg_rr ?? 0) >= 1.5 ? 'text-emerald-400' :
                (performance.avg_rr ?? 0) >= 1.0 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {(performance.avg_rr ?? 0).toFixed(2)}
              </span>
              <span className="text-xs text-slate-400">:1</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              متوسط المخاطرة/العائد — {performance.closed_predictions || 0} صفقة
            </p>
          </motion.div>

          {/* Winning Trades */}
          <motion.div
            variants={fadeIn}
            className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-5 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              </div>
              <span className="text-[10px] text-slate-400 font-medium">صفقات رابحة</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-400">
                {performance.winning_trades ?? performance.successful ?? 0}
              </span>
              <span className="text-xs text-slate-400">
                من {performance.total_trades ?? performance.closed_predictions ?? 0}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              {performance.losing_trades ?? performance.stopped ?? 0} صفقة خاسرة
            </p>
          </motion.div>

          {/* Sample Size */}
          <motion.div
            variants={fadeIn}
            className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-5 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-amber-400" />
              </div>
              <span className="text-[10px] text-slate-400 font-medium">حجم العينة</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${
                (performance.total_trades ?? performance.closed_predictions ?? 0) >= 30 ? 'text-emerald-400' :
                (performance.total_trades ?? performance.closed_predictions ?? 0) >= 10 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {performance.total_trades ?? performance.closed_predictions ?? 0}
              </span>
              <span className="text-xs text-slate-400">صفقة مغلقة</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              {(performance.total_trades ?? performance.closed_predictions ?? 0) >= 30 ? 'عينة كافية للثقة' :
               (performance.total_trades ?? performance.closed_predictions ?? 0) >= 10 ? 'عينة متوسطة' : 'عينة صغيرة — بحذر'}
            </p>
          </motion.div>
        </motion.div>

        {/* Charts Section */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10"
        >
          {/* Success Rate Ring */}
          <motion.div
            variants={fadeIn}
            className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-8 backdrop-blur-sm"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl" />
            <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
              <ProgressRing
                value={performance.success_rate}
                size={160}
                strokeWidth={10}
                color="#10b981"
                label="نسبة النجاح الكلي"
                subtitle={`${performance.successful} من ${performance.closed_predictions} توقع`}
              />
              <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-slate-300">توقعات ناجحة</span>
                  </div>
                  <span className="font-bold text-emerald-400">{performance.successful}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-slate-300">وقف خسارة</span>
                  </div>
                  <span className="font-bold text-red-400">{performance.stopped}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3 h-3 text-teal-400" />
                    <span className="text-slate-300">تحت المتابعة</span>
                  </div>
                  <span className="font-bold text-teal-400">{performance.active_predictions}</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Confidence Distribution */}
          <motion.div
            variants={fadeIn}
            className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-8 backdrop-blur-sm"
          >
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Award className="w-5 h-5 text-cyan-400" />
              دقة مستويات الثقة
            </h3>
            <div className="space-y-5">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4 text-emerald-400" />
                    <span className="text-slate-300">ثقة عالية (≥70%)</span>
                  </div>
                  <span className="text-emerald-400 font-bold">
                    {performance.high_confidence_rate.toFixed(1)}%
                  </span>
                </div>
                <div className="h-3 bg-slate-700/50 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${performance.high_confidence_rate}%` }}
                    transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span className="text-slate-300">ثقة متوسطة</span>
                  </div>
                  <span className="text-amber-400 font-bold">
                    {performance.medium_confidence_rate.toFixed(1)}%
                  </span>
                </div>
                <div className="h-3 bg-slate-700/50 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${performance.medium_confidence_rate}%` }}
                    transition={{ duration: 1.2, ease: 'easeOut', delay: 0.5 }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-300">ثقة منخفضة</span>
                  </div>
                  <span className="text-slate-400 font-bold">
                    {performance.low_confidence_rate.toFixed(1)}%
                  </span>
                </div>
                <div className="h-3 bg-slate-700/50 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-slate-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${performance.low_confidence_rate}%` }}
                    transition={{ duration: 1.2, ease: 'easeOut', delay: 0.7 }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Quick Stats Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-wrap justify-center gap-6 mb-10"
        >
          {[
            { label: 'اليوم', value: stats.today, icon: Calendar },
            { label: 'هذا الأسبوع', value: stats.weekly, icon: BarChart3 },
            { label: 'هذا الشهر', value: stats.monthly, icon: PieChart },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/5 border border-white/5">
              <item.icon className="w-5 h-5 text-slate-400" />
              <div>
                <p className="text-slate-400 text-xs">{item.label}</p>
                <p className="text-white font-bold text-lg">{item.value}</p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Markets Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mb-10"
        >
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
            <Globe className="w-6 h-6 text-cyan-400" />
            الأداء حسب السوق
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {marketData.map((market, i) => (
              <MarketCard key={i} {...market} />
            ))}
          </div>
        </motion.div>

        {/* 📈 تحليل الأداء - Gains Analysis Charts Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          className="mb-10"
          dir="rtl"
        >
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
            <TrendingUp className="w-6 h-6 text-emerald-400" />
            📈 تحليل الأداء
          </h2>

          {trackingLoading ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5">
              <div className="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-4" />
              <span className="text-slate-400">جاري تحميل بيانات الأداء...</span>
            </div>
          ) : !hasTrackingData ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 text-center">
              <BarChart3 className="w-12 h-12 text-amber-400 mb-4" />
              <p className="text-slate-300 text-lg font-medium mb-2">لا توجد بيانات كافية بعد</p>
              <p className="text-slate-500 text-sm max-w-md">
                ستظهر المكاسب الشهرية والنمو التراكمي وتوزيع الأسواق هنا بمجرد توفّر نتائج التوقعات المغلقة.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* (أ) المكاسب الشهرية - Bar Chart */}
              <div className="lg:col-span-3 relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-6 backdrop-blur-sm">
                <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
                <div className="relative z-10">
                  <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-emerald-400" />
                    المكاسب الشهرية - {currentYear}
                  </h3>
                  <p className="text-slate-400 text-sm mb-4">
                    مجموع العائد الفعلي (actual_return) لكل شهر — أخضر للمكاسب، أحمر للخسائر
                  </p>
                  {hasMonthlyGains ? (
                    <div className="h-[280px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyGainsData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'rgba(15, 23, 42, 0.95)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '0.75rem',
                              color: 'white',
                            }}
                            labelStyle={{ color: '#94a3b8' }}
                            formatter={(value: number) => [
                              `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`,
                              'العائد الشهري',
                            ]}
                          />
                          <Legend wrapperStyle={{ color: '#cbd5e1', fontSize: 12 }} />
                          <Bar dataKey="gain" name="العائد الشهري" radius={[4, 4, 0, 0]}>
                            {monthlyGainsData.map((entry, idx) => (
                              <Cell key={`cell-gain-${idx}`} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[280px] flex flex-col items-center justify-center text-center">
                      <BarChart3 className="w-10 h-10 text-amber-400 mb-3" />
                      <p className="text-slate-300 font-medium mb-1">لا توجد بيانات كافية بعد</p>
                      <p className="text-slate-500 text-sm">ستظهر المكاسب الشهرية هنا عند توفّر نتائج التوقعات لهذه السنة</p>
                    </div>
                  )}
                </div>
              </div>

              {/* (ب) النمو التراكمي للاستثمار - Area Chart */}
              <div className="lg:col-span-2 relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-6 backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/5 rounded-full blur-3xl pointer-events-none" />
                <div className="relative z-10">
                  <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-400" />
                    النمو التراكمي للاستثمار
                  </h3>
                  <p className="text-slate-400 text-sm mb-4">
                    العائد التراكمي عبر أشهر السنة (يبدأ من 0 ويتجمع كل شهر)
                  </p>
                  {hasMonthlyGains ? (
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={cumulativeGainsData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                          <defs>
                            <linearGradient id="cumulativeGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.7} />
                              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'rgba(15, 23, 42, 0.95)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '0.75rem',
                              color: 'white',
                            }}
                            labelStyle={{ color: '#94a3b8' }}
                            formatter={(value: number) => [
                              `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`,
                              'العائد التراكمي',
                            ]}
                          />
                          <Legend wrapperStyle={{ color: '#cbd5e1', fontSize: 12 }} />
                          <Area
                            type="monotone"
                            dataKey="cumulative"
                            name="العائد التراكمي"
                            stroke="#22c55e"
                            strokeWidth={2.5}
                            fill="url(#cumulativeGradient)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[260px] flex flex-col items-center justify-center text-center">
                      <TrendingUp className="w-10 h-10 text-amber-400 mb-3" />
                      <p className="text-slate-300 font-medium mb-1">لا توجد بيانات كافية بعد</p>
                      <p className="text-slate-500 text-sm">سيظهر النمو التراكمي هنا عند توفّر نتائج التوقعات</p>
                    </div>
                  )}
                </div>
              </div>

              {/* (ج) توزيع التوقعات حسب السوق - Donut Chart */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 p-6 backdrop-blur-sm">
                <div className="absolute top-0 left-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
                <div className="relative z-10">
                  <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                    <PieChart className="w-5 h-5 text-amber-400" />
                    توزيع التوقعات حسب السوق
                  </h3>
                  <p className="text-slate-400 text-sm mb-4">
                    حجم القطاع = عدد التوقعات • اللون = نسبة النجاح
                  </p>
                  {hasMarketDistribution ? (
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsPie>
                          <Pie
                            data={marketDistributionData}
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={80}
                            paddingAngle={3}
                            dataKey="value"
                            nameKey="name"
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            label={(entry: any) =>
                              `${entry.name || ''} ${((entry.percent || 0) * 100).toFixed(0)}%`
                            }
                            labelLine={false}
                          >
                            {marketDistributionData.map((entry, idx) => (
                              <Cell key={`cell-pie-${idx}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'rgba(15, 23, 42, 0.95)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '0.75rem',
                              color: 'white',
                            }}
                            labelStyle={{ color: '#94a3b8' }}
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={(value: any, name: any, item: any) => {
                              const wr = item?.payload?.winRate ?? 0;
                              return [`${value} توقع • ${wr}% نجاح`, item?.payload?.name || name];
                            }}
                          />
                          <Legend
                            wrapperStyle={{ color: '#cbd5e1', fontSize: 11 }}
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={(value: any) => (
                              <span style={{ color: '#cbd5e1' }}>{value}</span>
                            )}
                          />
                        </RechartsPie>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[260px] flex flex-col items-center justify-center text-center">
                      <PieChart className="w-10 h-10 text-amber-400 mb-3" />
                      <p className="text-slate-300 font-medium mb-1">لا توجد بيانات كافية بعد</p>
                      <p className="text-slate-500 text-sm">سيظهر توزيع الأسواق هنا عند توفّر بيانات</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* Recent Predictions Table */}
        {closedPredictions && closedPredictions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
          >
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <Activity className="w-6 h-6 text-purple-400" />
              آخر التوقعات المغلقة
            </h2>
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/5 backdrop-blur-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-right py-4 px-4 text-slate-400 font-medium">السهم</th>
                      <th className="text-right py-4 px-4 text-slate-400 font-medium">الإشارة</th>
                      <th className="text-right py-4 px-4 text-slate-400 font-medium">الثقة</th>
                      <th className="text-right py-4 px-4 text-slate-400 font-medium">النتيجة</th>
                      <th className="text-right py-4 px-4 text-slate-400 font-medium">العائد</th>
                      <th className="text-center py-4 px-4 text-slate-400 font-medium w-24">مشاركة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedPredictions.slice(0, 8).map((pred, i) => (
                      <PredictionRow key={pred.id} prediction={pred} index={i} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-12 text-center"
        >
          <p className="text-slate-500 text-sm">
            آخر تحديث: {new Date().toLocaleString('ar-EG')}
          </p>
          <Button
            onClick={() => fetchData(days)}
            variant="ghost"
            className="mt-4 text-slate-400 hover:text-white"
          >
            <RefreshCw className="w-4 h-4 ml-2" />
            تحديث البيانات
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

export default PredictionPerformanceView;

'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, Target, Shield, Award, Zap,
  BarChart3, Activity, RefreshCw, CheckCircle, XCircle,
  Building2, Globe, Coins, Star, ArrowUpRight, ArrowDownRight,
  Calendar, PieChart, Copy, Share2, Download
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

export interface PerformanceData {
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
  };
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
// ANIMATIONS
// ============================================================================

export const fadeIn = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' } }
};

export const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.1 } }
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: 'easeOut' } }
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Animated Number Counter
export const AnimatedNumber = ({ value, duration = 2000, suffix = '', prefix = '', decimals = 0 }: {
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
      const easeProgress = 1 - Math.pow(1 - progress, 3);
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
export const ProgressRing = ({ value, size = 140, strokeWidth = 8, color = '#10b981', label, subtitle }: {
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
// PROPS
// ============================================================================

interface PerformanceStatsProps {
  data: PerformanceData;
  days: number;
  setDays: (days: number) => void;
  onRefresh: () => void;
  onExport: () => void;
  onShare: () => void;
  isExporting: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PerformanceStats({
  data,
  days,
  setDays,
  onRefresh,
  onExport,
  onShare,
  isExporting,
}: PerformanceStatsProps) {

  const { performance, stats, closedPredictions } = data;
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

  const marketData = [
    { name: 'EGX', nameAr: 'البورصة المصرية', predictions: egxStats.total, successRate: egxStats.rate, icon: <Building2 className="w-5 h-5" />, color: 'h-emerald-600' },
    { name: 'TADAWUL', nameAr: 'السوق السعودي', predictions: tadawulStats.total, successRate: tadawulStats.rate, icon: <Globe className="w-5 h-5" />, color: 'h-green-600' },
    { name: 'KSE', nameAr: 'بورصة الكويت', predictions: kseStats.total, successRate: kseStats.rate, icon: <Coins className="w-5 h-5" />, color: 'h-blue-600' },
    { name: 'QSE', nameAr: 'بورصة قطر', predictions: qseStats.total, successRate: qseStats.rate, icon: <Star className="w-5 h-5" />, color: 'h-purple-600' },
  ];

  return (
    <>
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
              onClick={onExport}
              disabled={isExporting}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white border-0 shadow-lg flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              تصدير التقرير كصورة
            </Button>
            <Button
              onClick={onShare}
              variant="outline"
              className="border-white/10 hover:bg-white/5 text-xs rounded-full px-5 py-2 text-slate-300 flex items-center gap-2 cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              مشاركة التقرير
            </Button>
          </div>
        </div>
      </motion.div>

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
          value={<AnimatedNumber value={performance.success_rate} decimals={1} suffix="%" />}
          change={`${performance.successful} ناجح`}
          positive={true}
          color="bg-green-500/20"
        />
        <StatCard
          icon={<Activity className="w-5 h-5 text-blue-400" />}
          label="توقعات نشطة"
          value={<AnimatedNumber value={performance.active_predictions} />}
          color="bg-blue-500/20"
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
                  <Activity className="w-3 h-3 text-blue-400" />
                  <span className="text-slate-300">تحت المتابعة</span>
                </div>
                <span className="font-bold text-blue-400">{performance.active_predictions}</span>
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
          onClick={onRefresh}
          variant="ghost"
          className="mt-4 text-slate-400 hover:text-white"
        >
          <RefreshCw className="w-4 h-4 ml-2" />
          تحديث البيانات
        </Button>
      </motion.div>
    </>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, Shield, Target, Award, Zap,
  BarChart3, PieChart, Activity, Calendar, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Database, Clock, AlertCircle, Copy, Share2
} from 'lucide-react';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, PieChart as RechartsPie, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface Prediction {
  id: string;
  ticker: string;
  stock_name_ar?: string;
  prediction_type: string;
  confidence: number;
  entry_price: number;
  target_price?: number;
  stop_loss?: number;
  final_pl_percent?: number;
  status: string;
  hit_target: boolean;
  hit_stop_loss: boolean;
  prediction_date: string;
  market?: string;
  max_profit?: number;
  days_to_result?: number;
}

interface Performance {
  total_predictions: number;
  active_predictions: number;
  closed_predictions: number;
  successful: number;
  stopped: number;
  expired: number;
  success_rate: number;
  avg_return: number;
  best_return?: number;
  worst_return?: number;
  high_confidence_rate: number;
  medium_confidence_rate: number;
  low_confidence_rate: number;
}

interface ApiStats {
  today: number;
  weekly: number;
  monthly: number;
  totalProfitLoss: string;
}

interface ApiResponse {
  success: boolean;
  error?: string;
  performance: Performance;
  activePredictions: Prediction[];
  closedPredictions: Prediction[];
  stats: ApiStats;
  byMarket?: Record<string, {
    total: number;
    targets_hit: number;
    stops_hit: number;
    avg_return: number;
  }>;
}

// ============================================================================
// ANIMATION VARIANTS
// ============================================================================

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

// ============================================================================
// NO DATA COMPONENT
// ============================================================================

const NoDataView = ({ onRetry }: { onRetry: () => void }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    className="w-full"
  >
    <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
      <CardContent className="pt-8 pb-8 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring' }}
          className="w-20 h-20 mx-auto mb-5 rounded-full bg-amber-500/20 flex items-center justify-center"
        >
          <Database className="w-10 h-10 text-amber-400" />
        </motion.div>

        <h3 className="text-xl font-bold text-white mb-2">
          لا توجد بيانات توقعات
        </h3>
        
        <p className="text-slate-400 mb-5">
          لم يتم العثور على أي توقعات في النظام.
          <br />
          قم بتشغيل نظام التوقعات لإنشاء تحليلات.
        </p>

        <div className="bg-slate-700/30 rounded-lg p-3 mb-5">
          <div className="flex items-center justify-center gap-2 text-slate-300 text-sm">
            <Clock className="w-4 h-4" />
            <span>آخر تحديث: {new Date().toLocaleDateString('ar-EG')}</span>
          </div>
        </div>

        <Button
          onClick={onRetry}
          className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
        >
          <RefreshCw className="w-4 h-4 ml-2" />
          إعادة التحميل
        </Button>
      </CardContent>
    </Card>
  </motion.div>
);

// Loading View
const LoadingView = () => (
  <div className="w-full flex items-center justify-center py-20">
    <div className="text-center">
      <div className="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
      <p className="text-slate-400">جاري تحميل البيانات...</p>
    </div>
  </div>
);

// ============================================================================
// ANIMATED COUNTER
// ============================================================================

const AnimatedCounter = ({ value, duration = 2000, suffix = '' }: {
  value: number;
  duration?: number;
  suffix?: string;
}) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * value));
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [value, duration]);

  return <span>{count}{suffix}</span>;
};

// ============================================================================
// GAUGE CHART
// ============================================================================

const GaugeChart = ({ value, label, color = '#10b981', size = 120 }: {
  value: number;
  label: string;
  color?: string;
  size?: number;
}) => {
  const normalizedValue = Math.min(100, Math.max(0, value));
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (normalizedValue / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="transform -rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={45}
            stroke="currentColor"
            strokeWidth={10}
            fill="none"
            className="text-muted/20"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={45}
            stroke={color}
            strokeWidth={10}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>
            {normalizedValue.toFixed(1)}%
          </span>
        </div>
      </div>
      <span className="text-sm text-muted-foreground text-center">{label}</span>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AdminPredictionPerformancePage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/prediction-performance');
      const result = await response.json();
      
      if (result.success) {
        setData(result);
      } else {
        setData(result);
      }
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Loading state
  if (loading) {
    return <LoadingView />;
  }

  // Error state
  if (error) {
    return (
      <div className="w-full">
        <Card className="bg-slate-800/50 border-red-500/30 backdrop-blur-xl">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">خطأ في تحميل البيانات</h3>
            <p className="text-slate-400 mb-6 text-sm">{error}</p>
            <Button onClick={fetchData} variant="outline" className="border-slate-600">
              <RefreshCw className="w-4 h-4 ml-2" />
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No data state
  if (!data || !data.success || data.performance.total_predictions === 0) {
    return <NoDataView onRetry={fetchData} />;
  }

  const { performance, activePredictions, closedPredictions, stats } = data;

  // Prepare chart data
  const successPieData = [
    { name: 'ناجحة', value: performance.successful, color: '#10b981' },
    { name: 'مُوقوفة', value: performance.stopped, color: '#ef4444' },
    { name: 'منتهية', value: performance.expired, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  // Group predictions by market
  const predictionsByMarket: Record<string, { total: number; successful: number; stopped: number }> = {};
  
  if (data.byMarket) {
    Object.entries(data.byMarket).forEach(([market, stats]) => {
      let normalizedMarket = market;
      if (market === 'السعودية') normalizedMarket = 'TADAWUL';
      else if (market === 'الكويت') normalizedMarket = 'KSE';
      else if (market === 'قطر') normalizedMarket = 'QSE';
      
      if (!predictionsByMarket[normalizedMarket]) {
        predictionsByMarket[normalizedMarket] = { total: 0, successful: 0, stopped: 0 };
      }
      predictionsByMarket[normalizedMarket].total += stats.total || 0;
      predictionsByMarket[normalizedMarket].successful += stats.targets_hit || 0;
      predictionsByMarket[normalizedMarket].stopped += stats.stops_hit || 0;
    });
  } else {
    [...activePredictions, ...closedPredictions].forEach(p => {
      const market = p.market || 'EGX';
      if (!predictionsByMarket[market]) {
        predictionsByMarket[market] = { total: 0, successful: 0, stopped: 0 };
      }
      predictionsByMarket[market].total++;
      if (p.hit_target) predictionsByMarket[market].successful++;
      if (p.hit_stop_loss) predictionsByMarket[market].stopped++;
    });
  }

  const marketNames: Record<string, string> = {
    EGX: 'البورصة المصرية',
    TADAWUL: 'البورصة السعودية',
    KSE: 'البورصة الكويتية',
    CRYPTO: 'العملات الرقمية',
  };

  const marketColors: Record<string, string> = {
    EGX: '#10b981',
    TADAWUL: '#3b82f6',
    KSE: '#f59e0b',
    CRYPTO: '#8b5cf6',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            تقييم التحليلات - Admin
          </h1>
          <p className="text-slate-400 mt-1">بيانات حقيقية من توقعات المنصة</p>
        </div>
        <Button
          onClick={fetchData}
          variant="outline"
          className="border-slate-600 hover:bg-slate-700"
        >
          <RefreshCw className="w-4 h-4 ml-2" />
          تحديث
        </Button>
      </div>

      {/* Stats Cards */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"
      >
        <motion.div variants={fadeInUp}>
          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">إجمالي التوقعات</p>
                  <p className="text-3xl font-bold text-white mt-1">
                    <AnimatedCounter value={performance.total_predictions} />
                  </p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <Target className="w-6 h-6 text-emerald-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeInUp}>
          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">نسبة النجاح</p>
                  <p className="text-3xl font-bold text-emerald-400 mt-1">
                    <AnimatedCounter value={performance.success_rate} suffix="%" />
                  </p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeInUp}>
          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">توقعات نشطة</p>
                  <p className="text-3xl font-bold text-blue-400 mt-1">
                    <AnimatedCounter value={performance.active_predictions} />
                  </p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <Activity className="w-6 h-6 text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeInUp}>
          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">توقعات مغلقة</p>
                  <p className="text-3xl font-bold text-purple-400 mt-1">
                    <AnimatedCounter value={performance.closed_predictions} />
                  </p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-emerald-400" />
                نسبة النجاح
              </CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center">
              <GaugeChart
                value={performance.success_rate}
                label="نسبة التوقعات الناجحة"
                color="#10b981"
                size={150}
              />
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-400" />
                دقة الثقة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">ثقة عالية (≥70%)</span>
                  <span className="text-emerald-400">{performance.high_confidence_rate.toFixed(1)}%</span>
                </div>
                <Progress value={performance.high_confidence_rate} className="h-2 bg-slate-700 [&>div]:bg-emerald-500" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">ثقة متوسطة</span>
                  <span className="text-yellow-400">{performance.medium_confidence_rate.toFixed(1)}%</span>
                </div>
                <Progress value={performance.medium_confidence_rate} className="h-2 bg-slate-700 [&>div]:bg-yellow-500" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">ثقة منخفضة</span>
                  <span className="text-red-400">{performance.low_confidence_rate.toFixed(1)}%</span>
                </div>
                <Progress value={performance.low_confidence_rate} className="h-2 bg-slate-700 [&>div]:bg-red-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Middle Column */}
        <div className="space-y-6">
          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <PieChart className="w-5 h-5 text-cyan-400" />
                توزيع النتائج
              </CardTitle>
            </CardHeader>
            <CardContent>
              {successPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <RechartsPie>
                    <Pie
                      data={successPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {successPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px'
                      }}
                    />
                  </RechartsPie>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-slate-400">
                  لا توجد بيانات كافية
                </div>
              )}
              
              <div className="flex justify-center gap-4 mt-4">
                {successPieData.map((item) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-sm text-slate-400">{item.name}: {item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-purple-400" />
                إحصائيات سريعة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="text-slate-400">اليوم</span>
                <span className="text-white font-medium">{stats.today}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="text-slate-400">هذا الأسبوع</span>
                <span className="text-white font-medium">{stats.weekly}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="text-slate-400">هذا الشهر</span>
                <span className="text-white font-medium">{stats.monthly}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400">إجمالي الأرباح/الخسائر</span>
                <span className={cn(
                  'font-medium',
                  parseFloat(stats.totalProfitLoss) >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {parseFloat(stats.totalProfitLoss) >= 0 ? '+' : ''}{stats.totalProfitLoss}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-teal-400" />
                الأداء حسب السوق
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(predictionsByMarket).length > 0 ? (
                Object.entries(predictionsByMarket).map(([market, mData]) => {
                  const successRate = mData.total > 0 
                    ? ((mData.successful / mData.total) * 100).toFixed(1)
                    : 0;
                  
                  return (
                    <div
                      key={market}
                      className="p-3 rounded-lg bg-slate-700/30 hover:bg-slate-700/50 transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: marketColors[market] || '#6b7280' }}
                          />
                          <span className="text-white font-medium">
                            {marketNames[market] || market}
                          </span>
                        </div>
                        <span className="text-sm text-slate-400">{mData.total} توقع</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-emerald-400">✓ {mData.successful}</span>
                        <span className="text-red-400">✗ {mData.stopped}</span>
                        <span className="text-slate-400">({successRate}%)</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center text-slate-400 py-4">
                  لا توجد بيانات أسواق
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-400" />
                العوائد
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">متوسط العائد</span>
                <span className={cn(
                  'font-bold',
                  performance.avg_return >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {performance.avg_return >= 0 ? '+' : ''}{performance.avg_return.toFixed(2)}%
                </span>
              </div>
              {performance.best_return !== undefined && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">أفضل عائد</span>
                  <span className="text-emerald-400 font-bold">
                    +{performance.best_return.toFixed(2)}%
                  </span>
                </div>
              )}
              {performance.worst_return !== undefined && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">أسوأ عائد</span>
                  <span className="text-red-400 font-bold">
                    {performance.worst_return.toFixed(2)}%
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Closed Predictions Table */}
      {closedPredictions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8"
        >
          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                آخر التوقعات المغلقة
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-right py-3 px-4 text-slate-400 font-medium">السهم</th>
                      <th className="text-right py-3 px-4 text-slate-400 font-medium">النوع</th>
                      <th className="text-right py-3 px-4 text-slate-400 font-medium">الثقة</th>
                      <th className="text-right py-3 px-4 text-slate-400 font-medium">النتيجة</th>
                      <th className="text-right py-3 px-4 text-slate-400 font-medium">العائد</th>
                      <th className="text-right py-3 px-4 text-slate-400 font-medium">الأيام</th>
                      <th className="text-center py-3 px-4 text-slate-400 font-medium w-24">مشاركة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedPredictions.slice(0, 10).map((pred) => {
                      const isBuy = pred.prediction_type === 'BUY';
                      const profit = pred.final_pl_percent || 0;
                      const shareText = `📊 توقع منصة دليل الاستثمار:
- السهم: ${pred.ticker} ${pred.stock_name_ar ? `(${pred.stock_name_ar})` : ''}
- الإشارة: ${isBuy ? 'شراء 📈' : 'بيع 📉'}
- النتيجة: ${pred.hit_target ? '🎯 حقق الهدف بنجاح' : '🛑 ضرب وقف الخسارة'}
- العائد الفعلي: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}%
${OFFICIAL_LINKS_BLOCK}`;

                      const handleCopy = () => {
                        navigator.clipboard.writeText(shareText);
                        toast.success('تم نسخ بيانات التوقع ✓');
                      };

                      const handleShare = async () => {
                        if (navigator.share) {
                          try {
                            await navigator.share({
                              title: `توقع سهم ${pred.ticker}`,
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
                        <tr key={pred.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                          <td className="py-3 px-4">
                            <span className="text-white font-medium">{pred.ticker}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={cn(
                              'px-2 py-1 rounded-full text-xs font-medium',
                              pred.prediction_type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' :
                              pred.prediction_type === 'SELL' ? 'bg-red-500/20 text-red-400' :
                              'bg-slate-500/20 text-slate-400'
                            )}>
                              {pred.prediction_type === 'BUY' ? 'شراء' :
                               pred.prediction_type === 'SELL' ? 'بيع' : pred.prediction_type}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <Progress value={pred.confidence} className="w-16 h-2 bg-slate-700" />
                              <span className="text-slate-300 text-sm">{pred.confidence}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className={cn(
                              'px-2 py-1 rounded-full text-xs font-medium',
                              pred.hit_target ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                            )}>
                              {pred.hit_target ? 'نجح' : 'توقف'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={cn(
                              'font-medium',
                              pred.final_pl_percent && pred.final_pl_percent >= 0 ? 'text-emerald-400' : 'text-red-400'
                            )}>
                              {pred.final_pl_percent ? 
                                `${pred.final_pl_percent >= 0 ? '+' : ''}${pred.final_pl_percent.toFixed(2)}%` :
                                '-'
                              }
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-300">
                            {pred.days_to_result || '-'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1">
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Footer */}
      <div className="mt-8 text-center text-slate-500 text-sm">
        <p>آخر تحديث: {new Date().toLocaleString('ar-EG')}</p>
      </div>
    </div>
  );
}

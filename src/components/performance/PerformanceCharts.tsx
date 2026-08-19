'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  BarChart3,
  PieChart as PieChartIcon,
} from 'lucide-react';
import {
  AreaChart, Area, PieChart as RechartsPie, Pie, Cell,
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';

// ============================================================================
// TRACKING TYPES
// ============================================================================

export interface TrackingPrediction {
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
// CONSTANTS
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

function getWinRateColor(rate: number): string {
  if (rate >= 70) return '#22c55e';
  if (rate >= 50) return '#eab308';
  return '#ef4444';
}

function getMarketLabelAr(market: string): string {
  return MARKET_LABELS_AR[market] || market;
}

// ============================================================================
// PROPS
// ============================================================================

interface PerformanceChartsProps {
  trackingPredictions: TrackingPrediction[];
  trackingLoading: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PerformanceCharts({
  trackingPredictions,
  trackingLoading,
}: PerformanceChartsProps) {

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
      color: rounded >= 0 ? '#22c55e' : '#ef4444',
    };
  });

  // (ب) النمو التراكمي
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

  // (ج) توزيع التوقعات حسب السوق
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
                <PieChartIcon className="w-5 h-5 text-amber-400" />
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
                  <PieChartIcon className="w-10 h-10 text-amber-400 mb-3" />
                  <p className="text-slate-300 font-medium mb-1">لا توجد بيانات كافية بعد</p>
                  <p className="text-slate-500 text-sm">سيظهر توزيع الأسواق هنا عند توفّر بيانات</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

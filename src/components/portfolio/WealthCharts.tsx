'use client';

import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, PieChart as PieIcon, ArrowUpRight, ArrowDownRight, Wallet, DollarSign } from 'lucide-react';

interface EquitySnapshot {
  date: string;
  total_value: number;
  cash?: number;
  stocks_value?: number;
  real_value?: number;
}

interface AssetAlloc {
  name: string;
  value: number;
  percentage: number;
  color: string;
}

interface CashflowItem {
  month: string;
  deposits: number;
  withdrawals: number;
}

export const WealthCharts: React.FC = () => {
  const [equityData, setEquityData] = useState<EquitySnapshot[]>([]);
  const [allocation, setAllocation] = useState<AssetAlloc[]>([]);
  const [cashflow, setCashflow] = useState<CashflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendColor, setTrendColor] = useState('#16a34a');
  const [totalChangePct, setTotalChangePct] = useState(0);
  const [inflationRate, setInflationRate] = useState(30);

  useEffect(() => {
    let isMounted = true;

    async function fetchChartsData() {
      try {
        const [eqRes, allocRes, cfRes, inflRes] = await Promise.allSettled([
          fetch('/api/portfolio/equity/curve?days=90').then((r) => r.json()),
          fetch('/api/portfolio/state').then((r) => r.json()),
          fetch('/api/portfolio/cashflow').then((r) => r.json()),
          fetch('/api/finance/inflation').then((r) => r.json()),
        ]);

        if (isMounted) {
          // Inflation rate — fallback to 30 if missing/invalid
          if (inflRes.status === 'fulfilled' && typeof inflRes.value?.rate === 'number' && inflRes.value.rate > 0) {
            setInflationRate(inflRes.value.rate);
          } else {
            setInflationRate(30);
          }

          if (eqRes.status === 'fulfilled' && eqRes.value?.success) {
            const snapshots: EquitySnapshot[] = eqRes.value.equity_snapshots || [];
            // Compute inflation-adjusted real_value for each snapshot
            const inflRate = inflRes.status === 'fulfilled' && typeof inflRes.value?.rate === 'number' && inflRes.value.rate > 0
              ? inflRes.value.rate
              : 30;
            const firstDateMs = snapshots.length > 0 ? new Date(snapshots[0].date).getTime() : 0;
            const enriched = snapshots.map((s) => {
              const yearsElapsed = firstDateMs > 0
                ? (new Date(s.date).getTime() - firstDateMs) / (365.25 * 24 * 3600 * 1000)
                : 0;
              const real = yearsElapsed <= 0
                ? s.total_value
                : s.total_value / Math.pow(1 + inflRate / 100, yearsElapsed);
              return { ...s, real_value: real };
            });
            setEquityData(enriched);
            setTrendColor(eqRes.value.trend_color || '#16a34a');
            setTotalChangePct(eqRes.value.total_change_pct || 0);
          }

          if (allocRes.status === 'fulfilled' && allocRes.value?.success) {
            setAllocation(allocRes.value.allocation || []);
          }

          if (cfRes.status === 'fulfilled' && cfRes.value?.success) {
            setCashflow(cfRes.value.cashflow || []);
          }
        }
      } catch (err) {
        console.error('Error loading wealth charts:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchChartsData();
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="sm:col-span-2 lg:col-span-2 h-[40vh] sm:h-72 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse flex items-center justify-center text-slate-500 text-sm">
          جارٍ تحميل رسم الثروة...
        </div>
        <div className="h-[40vh] sm:h-72 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse flex items-center justify-center text-slate-500 text-sm">
          جارٍ تحميل توزيع الأصول...
        </div>
      </div>
    );
  }

  const isPositive = totalChangePct >= 0;

  return (
    <div className="space-y-6 mb-6 dir-rtl">
      {/* Upper Charts Row: Equity Curve (Line) + Allocation (Pie) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Equity Curve (LineChart 90 Days) */}
        <div className="sm:col-span-2 lg:col-span-2 p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">منحنى رأس المال (Equity Curve)</h3>
                <p className="text-xs text-slate-400">إجمالي قيمة المحفظة يوم بيوم خلال 90 يوماً</p>
              </div>
            </div>
            <div
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border ${
                isPositive
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
            >
              {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              <span>{isPositive ? `+${totalChangePct}%` : `${totalChangePct}%`}</span>
            </div>
          </div>

          {equityData.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
              <Wallet className="w-8 h-8 text-slate-600 mb-2" />
              <p className="text-sm font-medium">لا توجد بيانات تاريخية للثروة بعد</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-orange-500/10 border border-orange-500/30 text-orange-400 text-[11px] font-semibold">
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  المنحنى البرتقالي = القيمة الحقيقية مخصومة بمعدل التضخم ({inflationRate}%)
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-700/40 border border-slate-700 text-slate-300 text-[11px] font-semibold">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: trendColor }} />
                  إجمالي القيمة الاسمية
                </span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.6} />
                    <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickLine={false} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '12px',
                        color: '#f8fafc',
                        fontSize: '12px',
                        direction: 'rtl',
                      }}
                      formatter={(value: any, name: any) => {
                        const v = Number(value).toLocaleString();
                        if (name === 'real_value' || name === 'القوة الشرائية الحقيقية') {
                          return [`${v} ج.م`, 'القوة الشرائية الحقيقية'];
                        }
                        return [`${v} ج.م`, 'إجمالي القيمة الاسمية'];
                      }}
                      labelFormatter={(label) => `التاريخ: ${label}`}
                    />
                    <Legend
                      verticalAlign="top"
                      height={28}
                      iconType="line"
                      wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total_value"
                      name="إجمالي القيمة الاسمية"
                      stroke={trendColor}
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 6, stroke: trendColor, strokeWidth: 2, fill: '#0f172a' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="real_value"
                      stroke="#f97316"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      name="القوة الشرائية الحقيقية"
                      activeDot={{ r: 5, stroke: '#f97316', strokeWidth: 2, fill: '#0f172a' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* Asset Allocation (PieChart) */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl backdrop-blur-md flex flex-col justify-between">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400">
              <PieIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">توزيع الأصول (Allocation)</h3>
              <p className="text-xs text-slate-400">نسبة الأسهم، الكاش، الذهب، الكريبتو</p>
            </div>
          </div>

          {allocation.length === 0 ? (
            <div className="h-56 flex flex-col items-center justify-center text-slate-400 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
              <p className="text-sm font-medium">لا توجد أصول مضافة بعد</p>
            </div>
          ) : (
            <div className="h-56 w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocation}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {allocation.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="#0f172a" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      color: '#f8fafc',
                      fontSize: '12px',
                    }}
                    formatter={(val: any, name: any) => [`${Number(val).toLocaleString()} ج.م`, name]}
                  />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Lower Row: Cash Flow Bar Chart */}
      <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">تدفق السيولة (Cash Flow)</h3>
              <p className="text-xs text-slate-400">مقارنة الإيداعات السحب الشهرية</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> الإيداعات
            </span>
            <span className="flex items-center gap-1.5 text-red-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> السحوبات
            </span>
          </div>
        </div>

        {cashflow.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
            لا توجد بيانات تدفق سيولة
          </div>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashflow} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.6} />
                <XAxis dataKey="month" stroke="#64748b" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                  formatter={(val: any, name: any) => [
                    `${Number(val).toLocaleString()} ج.م`,
                    name === 'deposits' ? 'إيداع' : 'سحب',
                  ]}
                />
                <Bar dataKey="deposits" fill="#16a34a" radius={[6, 6, 0, 0]} maxBarSize={30} />
                <Bar dataKey="withdrawals" fill="#ef4444" radius={[6, 6, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

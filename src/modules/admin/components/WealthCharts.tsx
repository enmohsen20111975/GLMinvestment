'use client';

/**
 * WealthCharts — الرسوم البيانية لإدارة الأموال
 * =============================================
 * يعرض:
 * 1. خط زمني لتطور الثروة (Line Chart)
 * 2. توزيع الأصول (Pie/Donut Chart)
 * 3. الربح/الخسارة اليومي (Area Chart)
 * 4. المصاريف حسب الفئة (Bar Chart)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
 LineChart, Line, AreaChart, Area, BarChart, Bar,
 PieChart, Pie, Cell,
 XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
 Legend,
} from 'recharts';
import {
 TrendingUp, TrendingDown, Wallet, PieChart as PieIcon,
 DollarSign, AlertCircle, Loader2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const COLORS = {
 emerald: '#10b981',
 red: '#ef4444',
 amber: '#f59e0b',
 cyan: '#06b6d4',
 purple: '#8b5cf6',
 blue: '#3b82f6',
 pink: '#ec4899',
 gray: '#6b7280',
};

const ASSET_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];

const ASSET_LABELS: Record<string, string> = {
 stocks: 'أسهم',
 gold: 'ذهب',
 bank: 'بنك',
 cash: 'كاش',
 crypto: 'كريبتو',
 other: 'أخرى',
};

export function WealthCharts() {
 const [data, setData] = useState<any>(null);
 const [smartData, setSmartData] = useState<any>(null);
 const [loading, setLoading] = useState(true);
 const [period, setPeriod] = useState(90);

 const fetchData = useCallback(async () => {
 try {
 // MONEY-TIER1.3: replaced broken /api/money/wealth (Python :8010 down → empty)
 // with /api/portfolio/equity-curve which reads the REAL wealth_tracking
 // table directly from stocks.db. Also replaced /api/money/smart-monitor
 // with /api/portfolio/holdings (REAL holdings) + /api/portfolio/risk-summary.
 const [equityRes, holdingsRes, riskRes] = await Promise.all([
 fetch(`/api/portfolio/equity-curve?days=${period}`),
 fetch(`/api/portfolio/holdings`),
 fetch(`/api/portfolio/risk-summary`),
 ]);
 const equity = await equityRes.json();
 const holdings = await holdingsRes.json();
 const risk = await riskRes.json();
 if (equity.success) {
 const snapshots = equity.snapshots || [];
 setData({
 history: snapshots.map((s: any) => ({
 date: s.snapshot_date,
 invested: s.total_invested || 0,
 current_value: s.total_current_value || 0,
 pnl: s.total_pnl || 0,
 pnl_pct: s.total_pnl_pct || 0,
 net_wealth: (s.total_current_value || 0),
 stocks_value: s.stocks_value || 0,
 gold_value: s.gold_value || 0,
 crypto_value: s.crypto_value || 0,
 bank_value: s.bank_value || 0,
 cash_value: s.cash_value || 0,
 })),
 stats: {
 latest_invested: equity.current?.total_invested || equity.last_val || 0,
 latest_current: equity.current?.total_current_value || equity.last_val || 0,
 latest_pnl: equity.current?.total_pnl || 0,
 latest_pnl_pct: equity.current?.total_pnl_pct || equity.total_change_pct || 0,
 allocation: {
 stocks: equity.current?.stocks_value || 0,
 gold: equity.current?.gold_value || 0,
 crypto: equity.current?.crypto_value || 0,
 bank: equity.current?.bank_value || 0,
 cash: equity.current?.cash_value || 0,
 other: equity.current?.other_value || 0,
 },
 first_val: equity.first_val || 0,
 last_val: equity.last_val || 0,
 total_change_pct: equity.total_change_pct || 0,
 trend_color: equity.trend_color || '#10b981',
 },
 });
 }
 if (holdings.success) {
 const realHoldings = holdings.holdings || [];
 const stockSignals = realHoldings
 .filter((h: any) => h.asset_type === 'stock')
 .map((h: any) => {
 let action = 'HOLD';
 let action_ar = '⏸️ احتفاظ';
 if (h.pnl_percent <= -10) {
 action = 'STOP_LOSS';
 action_ar = '🚨 إيقاف خسارة';
 } else if (h.pnl_percent <= -5) {
 action = 'SELL';
 action_ar = '⚠️ فكّر في البيع';
 } else if (h.pnl_percent >= 15) {
 action = 'TAKE_PROFIT';
 action_ar = '✅ حقّق ربح';
 } else if (h.pnl_percent >= 5) {
 action = 'BUY_MORE';
 action_ar = '💰 فرصة زيادة';
 }
 return {
 ticker: h.ticker,
 name: h.name,
 buy_price: h.buy_price,
 current_price: h.current_price,
 pnl: h.pnl_amount,
 pnl_pct: h.pnl_percent,
 action,
 action_ar,
 };
 });
 const summary = holdings.summary || {};
 setSmartData({
 stock_signals: stockSignals,
 alerts: stockSignals
 .filter((s: any) => s.action === 'STOP_LOSS' || s.action === 'SELL')
 .map((s: any) =>
 `${s.ticker}: ${s.action_ar} (${s.pnl_pct >= 0 ? '+' : ''}${s.pnl_pct}%)`
 ),
 summary: {
 total_invested: summary.total_invested || 0,
 total_current_value: summary.total_current_value || 0,
 total_pnl: summary.total_pnl || 0,
 total_pnl_pct: summary.total_pnl_pct || 0,
 sell_count: stockSignals.filter((s: any) => s.action === 'SELL' || s.action === 'STOP_LOSS').length,
 },
 wealth_plan: {
 recommendations: (risk.sector_exposure || [])
 .filter((s: any) => (s.percentage ?? 0) > 30)
 .map((s: any) =>
 `⚠️ تركيز عالي في قطاع ${s.sector_ar || s.sector || 'غير معروف'} (${(s.percentage ?? 0).toFixed(1)}%) — فكّر في تنويع المحفظة`
 ),
 },
 });
 }
 } catch (e) {
 console.error('[WealthCharts] fetch error:', e);
 } finally {
 setLoading(false);
 }
 }, [period]);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 if (loading) {
 return (
 <div className="flex items-center justify-center py-20">
 <Loader2 className="w-6 h-6 animate-spin text-whale" />
 </div>
 );
 }

 const history = data?.history || [];
 const stats = data?.stats || {};
 const stockSignals = smartData?.stock_signals || [];
 const wealthPlan = smartData?.wealth_plan || {};
 const summary = smartData?.summary || {};

 // Prepare chart data
 const wealthLineData = history.map((h: any) => ({
 date: h.date?.substring(5) || '',
 'الاستثمار': h.invested || 0,
 'القيمة الحالية': h.current_value || 0,
 'صافي الثروة': h.net_wealth || 0,
 }));

 const pnlAreaData = history.map((h: any) => ({
 date: h.date?.substring(5) || '',
 'الربح/الخسارة': h.pnl || 0,
 }));

 const allocationData = Object.entries(stats.allocation || {}).map(([key, value]: any) => ({
 name: ASSET_LABELS[key] || key,
 value: value || 0,
 })).filter(a => a.value > 0);

 const stockPnlData = stockSignals.map((s: any) => ({
 name: s.ticker,
 'الربح/الخسارة': s.pnl || 0,
 'النسبة': s.pnl_pct || 0,
 }));

 return (
 <div className="space-y-4 pb-20" dir="rtl">
 {/* Period selector */}
 <div className="flex gap-2">
 {[30, 90, 180, 365].map(p => (
 <button
 key={p}
 onClick={() => setPeriod(p)}
 className={cn(
 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all min-h-[36px]',
 period === p
 ? 'bg-whale/10 text-whale border border-whale/20'
 : 'text-muted-foreground hover:text-foreground border border-white/10'
 )}
 >
 {p === 30 ? 'شهر' : p === 90 ? '3 شهور' : p === 180 ? '6 شهور' : 'سنة'}
 </button>
 ))}
 </div>

 {/* Summary Cards */}
 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
 <SummaryCard
 icon={Wallet}
 label="إجمالي الاستثمار"
 value={`${(summary.total_invested || stats.latest_invested || 0).toLocaleString()} ج`}
 color="cyan"
 />
 <SummaryCard
 icon={TrendingUp}
 label="القيمة الحالية"
 value={`${(summary.total_current_value || stats.latest_current || 0).toLocaleString()} ج`}
 color="emerald"
 />
 <SummaryCard
 icon={summary.total_pnl >= 0 ? TrendingUp : TrendingDown}
 label="الربح/الخسارة"
 value={`${(summary.total_pnl || stats.latest_pnl || 0).toLocaleString()} ج`}
 subValue={`${summary.total_pnl_pct || stats.latest_pnl_pct || 0}%`}
 color={summary.total_pnl >= 0 ? 'emerald' : 'red'}
 />
 <SummaryCard
 icon={AlertCircle}
 label="تنبيهات"
 value={`${smartData?.alerts?.length || 0}`}
 subValue={summary.sell_count > 0 ? `${summary.sell_count} بيع` : 'آمن'}
 color={summary.sell_count > 0 ? 'red' : 'emerald'}
 />
 </div>

 {/* Chart 1: Wealth Over Time (Line) */}
 {wealthLineData.length > 0 && (
 <ChartCard title="📈 تطور الثروة عبر الزمن" icon={TrendingUp}>
 <ResponsiveContainer width="100%" height={250}>
 <LineChart data={wealthLineData}>
 <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
 <XAxis dataKey="date" stroke="#888" fontSize={10} />
 <YAxis stroke="#888" fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
 <Tooltip
 contentStyle={{ background: '#0a0e17', border: '1px solid #ffffff20', borderRadius: '8px', fontSize: '12px' }}
 formatter={(v: any) => `${Number(v).toLocaleString()} ج`}
 />
 <Legend wrapperStyle={{ fontSize: '11px' }} />
 <Line type="monotone" dataKey="الاستثمار" stroke={COLORS.cyan} strokeWidth={2} dot={false} />
 <Line type="monotone" dataKey="القيمة الحالية" stroke={COLORS.emerald} strokeWidth={2} dot={false} />
 <Line type="monotone" dataKey="صافي الثروة" stroke={COLORS.purple} strokeWidth={2} dot={false} />
 </LineChart>
 </ResponsiveContainer>
 </ChartCard>
 )}

 {/* Chart 2: Asset Allocation (Donut) */}
 {allocationData.length > 0 && (
 <ChartCard title="🥧 توزيع الأصول" icon={PieIcon}>
 <ResponsiveContainer width="100%" height={250}>
 <PieChart>
 <Pie
 data={allocationData}
 cx="50%"
 cy="50%"
 innerRadius={60}
 outerRadius={90}
 paddingAngle={3}
 dataKey="value"
 >
 {allocationData.map((_: any, i: number) => (
 <Cell key={i} fill={ASSET_COLORS[i % ASSET_COLORS.length]} />
 ))}
 </Pie>
 <Tooltip
 contentStyle={{ background: '#0a0e17', border: '1px solid #ffffff20', borderRadius: '8px', fontSize: '12px' }}
 formatter={(v: any) => `${Number(v).toLocaleString()} ج`}
 />
 <Legend wrapperStyle={{ fontSize: '11px' }} />
 </PieChart>
 </ResponsiveContainer>
 </ChartCard>
 )}

 {/* Chart 3: PnL Area */}
 {pnlAreaData.length > 0 && (
 <ChartCard title="📊 الربح/الخسارة اليومي" icon={DollarSign}>
 <ResponsiveContainer width="100%" height={200}>
 <AreaChart data={pnlAreaData}>
 <defs>
 <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor={COLORS.emerald} stopOpacity={0.5} />
 <stop offset="100%" stopColor={COLORS.emerald} stopOpacity={0} />
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
 <XAxis dataKey="date" stroke="#888" fontSize={10} />
 <YAxis stroke="#888" fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
 <Tooltip
 contentStyle={{ background: '#0a0e17', border: '1px solid #ffffff20', borderRadius: '8px', fontSize: '12px' }}
 formatter={(v: any) => `${Number(v).toLocaleString()} ج`}
 />
 <Area
 type="monotone"
 dataKey="الربح/الخسارة"
 stroke={COLORS.emerald}
 fill="url(#pnlGradient)"
 strokeWidth={2}
 />
 </AreaChart>
 </ResponsiveContainer>
 </ChartCard>
 )}

 {/* Chart 4: Stock PnL Bar */}
 {stockPnlData.length > 0 && (
 <ChartCard title="📊 أداء أسهم المحفظة" icon={TrendingUp}>
 <ResponsiveContainer width="100%" height={Math.max(200, stockPnlData.length * 35)}>
 <BarChart data={stockPnlData} layout="vertical">
 <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
 <XAxis type="number" stroke="#888" fontSize={10} tickFormatter={(v) => `${v}%`} />
 <YAxis dataKey="name" type="category" stroke="#888" fontSize={10} width={60} />
 <Tooltip
 contentStyle={{ background: '#0a0e17', border: '1px solid #ffffff20', borderRadius: '8px', fontSize: '12px' }}
 formatter={(v: any, name: any) => name === 'النسبة' ? `${v}%` : `${Number(v).toLocaleString()} ج`}
 />
 <Bar dataKey="النسبة" radius={[0, 4, 4, 0]}>
 {stockPnlData.map((d: any, i: number) => (
 <Cell key={i} fill={d['النسبة'] >= 0 ? COLORS.emerald : COLORS.red} />
 ))}
 </Bar>
 </BarChart>
 </ResponsiveContainer>
 </ChartCard>
 )}

 {/* Smart Monitor Signals */}
 {stockSignals.length > 0 && (
 <ChartCard title="🎯 إشارات المحفظة الذكية" icon={AlertCircle}>
 <div className="space-y-2">
 {stockSignals.map((s: any, i: number) => (
 <div
 key={i}
 className={cn(
 'flex items-center justify-between p-2.5 rounded-lg border',
 s.action === 'STOP_LOSS' ? 'bg-loss/5 border-loss/20' :
 s.action === 'TAKE_PROFIT' ? 'bg-profit/5 border-profit/20' :
 s.action === 'SELL' ? 'bg-warning/5 border-warning/20' :
 s.action === 'BUY_MORE' ? 'bg-whale/5 border-whale/20' :
 'bg-white/5 border-white/10'
 )}
 >
 <div className="flex items-center gap-2 min-w-0">
 <span className="text-xs font-bold text-foreground shrink-0">{s.ticker}</span>
 <span className="text-xs text-muted-foreground truncate">{s.name}</span>
 </div>
 <div className="flex items-center gap-2 shrink-0">
 <span className={cn(
 'text-xs font-bold',
 s.pnl_pct >= 0 ? 'text-profit' : 'text-loss'
 )}>
 {s.pnl_pct >= 0 ? '+' : ''}{s.pnl_pct}%
 </span>
 <span className="text-xs text-muted-foreground">{s.current_price} ج</span>
 <span className="text-xs font-medium" style={{
 color: s.action === 'STOP_LOSS' ? COLORS.red :
 s.action === 'TAKE_PROFIT' ? COLORS.emerald :
 s.action === 'SELL' ? COLORS.amber :
 s.action === 'BUY_MORE' ? COLORS.cyan : COLORS.gray
 }}>
 {s.action_ar}
 </span>
 </div>
 </div>
 ))}
 </div>
 </ChartCard>
 )}

 {/* Wealth Plan */}
 {wealthPlan.recommendations?.length > 0 && (
 <ChartCard title="💰 خطة توزيع الثروة" icon={Wallet}>
 <div className="space-y-2">
 {wealthPlan.recommendations?.map((r: string, i: number) => (
 <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-white/5">
 <span className="text-xs text-muted-foreground">{r}</span>
 </div>
 ))}
 </div>
 </ChartCard>
 )}

 {/* Alerts */}
 {smartData?.alerts?.length > 0 && (
 <Card className="bg-loss/5 border-loss/20 p-3">
 <div className="flex items-center gap-2 mb-2">
 <AlertCircle className="w-4 h-4 text-loss" />
 <span className="text-xs font-bold text-loss">التنبيهات ({smartData.alerts.length})</span>
 </div>
 <div className="space-y-1">
 {smartData.alerts.map((a: string, i: number) => (
 <div key={i} className="text-xs text-loss p-1.5 rounded bg-loss/5">{a}</div>
 ))}
 </div>
 </Card>
 )}
 </div>
 );
}

function ChartCard({ title, icon: Icon, children }: any) {
 return (
 <Card className="bg-white/5 border-white/10 p-3">
 <div className="flex items-center gap-2 mb-3">
 <Icon className="w-4 h-4 text-whale" />
 <span className="text-xs font-semibold text-foreground">{title}</span>
 </div>
 {children}
 </Card>
 );
}

function SummaryCard({ icon: Icon, label, value, subValue, color }: any) {
 const colors: Record<string, string> = {
 cyan: 'text-whale bg-whale/5 border-whale/20',
 emerald: 'text-profit bg-profit/5 border-profit/20',
 red: 'text-loss bg-loss/5 border-loss/20',
 amber: 'text-warning bg-warning/5 border-warning/20',
 purple: 'text-primary bg-primary/5 border-purple-500/20',
 };
 return (
 <Card className={cn('border p-3', colors[color])}>
 <div className="flex items-center gap-1.5 mb-1">
 <Icon className="w-3.5 h-3.5" />
 <span className="text-xs text-muted-foreground">{label}</span>
 </div>
 <div className="text-sm font-bold text-foreground truncate">{value}</div>
 {subValue && <div className="text-xs text-muted-foreground mt-0.5">{subValue}</div>}
 </Card>
 );
}

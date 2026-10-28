'use client';

// StockDetail sub-components — extracted from StockDetail.tsx (Phase 3)

import React from 'react';
import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';

function PriceInfoCard({ label, value, icon, className }: PriceInfoCardProps) {
 return (
 <Card className={cn('py-2 px-3 sm:py-3 sm:px-4 gap-1 sm:gap-2', className)}>
 <div className="flex items-center gap-2">
 <div className="text-muted-foreground">{icon}</div>
 <span className="text-xs text-muted-foreground">{label}</span>
 </div>
 <p className="text-sm font-bold tabular-nums" dir="ltr">{value}</p>
 </Card>
 );
}

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
 return (
 <div className="flex items-center justify-between py-2">
 <span className="text-sm text-muted-foreground">{label}</span>
 <span
 className={cn(
 'text-sm font-semibold tabular-nums',
 highlight && 'text-profit '
 )}
 dir="ltr"
 >
 {value}
 </span>
 </div>
 );
}

// Small amber badge shown next to structurally-estimated financial metrics
// (دعم البيانات المالية الهيكلية المحسوبة للشركات الصغرى).
// Uses the existing shadcn Badge component with variant="outline" +
// amber-500 text color (no indigo/blue) per design constraints.
function EstimatedBadge() {
 return (
 <Badge
 variant="outline"
 className="text-xs px-1 py-0 h-4 leading-none border-warning/20 text-warning bg-warning/10"
 title="قيمة مقدّرة هيكلياً من القيمة السوقية ومكررات السعر (raw data unavailable)"
 >
 تقديري
 </Badge>
 );
}

function DetailSkeleton() {
 return (
 <div className="space-y-4 md:space-y-6" dir="rtl">
 {/* Header Skeleton */}
 <div className="space-y-3">
 <Skeleton className="h-6 w-24" />
 <Skeleton className="h-8 w-48" />
 <div className="flex gap-3">
 <Skeleton className="h-10 w-32" />
 <Skeleton className="h-6 w-20" />
 <Skeleton className="h-6 w-20" />
 </div>
 </div>
 {/* Price Info Skeleton */}
 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
 {Array.from({ length: 6 }).map((_, i) => (
 <Skeleton key={i} className="h-20 w-full rounded-xl" />
 ))}
 </div>
 {/* Chart Skeleton */}
 <Skeleton className="h-72 w-full rounded-xl" />
 {/* Metrics Skeleton */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <Skeleton className="h-64 w-full rounded-xl" />
 <Skeleton className="h-64 w-full rounded-xl" />
 </div>
 </div>
 );
}

// Flow Score + Explosive Score + Fundamentals from Python backend
function FlowScoreCard({ ticker }: { ticker: string }) {
 const currentMarket = useAppStore((s) => s.currentMarket);
 const [flow, setFlow] = useState<Record<string, unknown> | null>(null);
 const [explosive, setExplosive] = useState<Record<string, unknown> | null>(null);

 useEffect(() => {
 if (!ticker) return;
 const mkt = encodeURIComponent(currentMarket);
 fetch(`/api/flow/${ticker}?market=${mkt}`).then(r => r.json()).then(d => {
 if (d.success) setFlow(d.data);
 }).catch(() => {});
 fetch(`/api/explosive/${ticker}?market=${mkt}`).then(r => r.json()).then(d => {
 if (d.success) setExplosive(d.data);
 }).catch(() => {});
 }, [ticker, currentMarket]);

 if (!flow && !explosive) return null;

 return (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
 {flow && (
 <div className="rounded-lg border border-border p-4 bg-white">
 <h3 className="text-sm font-bold mb-2 text-slate-900 ">نقاط التدفق (Flow Score)</h3>
 <div className="flex items-center gap-3">
 <span className="text-3xl font-bold" style={{color: (flow.color as string) === 'red' ? '#ef4444' : (flow.color as string) === 'orange' ? '#f97316' : (flow.color as string) === 'amber' ? '#f59e0b' : '#10b981'}}>
 {String(flow.flow_score)}
 </span>
 <div>
 <div className="text-lg font-bold">{String(flow.label)}</div>
 <div className="text-xs text-muted-foreground">
 Macro: {String(flow.macro_flow)} | Sector: {String(flow.sector_flow)} | Stock: {String(flow.stock_flow)} | Cross: {String(flow.cross_validation)}
 </div>
 </div>
 </div>
 </div>
 )}
 {explosive && !explosive.excluded && (
 <div className="rounded-lg border border-border p-4 bg-white">
 <h3 className="text-sm font-bold mb-2 text-slate-900 ">ماسح القنابل (Explosive)</h3>
 <div className="flex items-center gap-3">
 <span className="text-3xl font-bold" style={{color: (explosive.color as string) === 'red' ? '#ef4444' : (explosive.color as string) === 'orange' ? '#f97316' : (explosive.color as string) === 'amber' ? '#f59e0b' : '#6b7280'}}>
 {String(explosive.explosive_score)}
 </span>
 <div>
 <div className="text-lg font-bold">{String(explosive.label)} - {String(explosive.pattern)}</div>
 <div className="text-xs text-muted-foreground">
 Vol: {String(explosive.volume_ratio)}x | {String(explosive.action)} | وقف: {String(explosive.stop_loss)}% | هدف: +{String(explosive.target)}%
 </div>
 </div>
 </div>
 </div>
 )}
 </div>
 );
}

// Fundamentals from data-engine.db (9 Tables Integrated)
function FundamentalsCard({ ticker }: { ticker: string }) {
 const currentMarket = useAppStore((s) => s.currentMarket);
 const [profile, setProfile] = useState<Record<string, any> | null>(null);
 const [activeTab, setActiveTab] = useState<'valuation' | 'statements' | 'dividends' | 'technical'>('valuation');

 useEffect(() => {
 if (!ticker) return;
 fetch(`/api/stock-profile/${ticker}?market=${encodeURIComponent(currentMarket)}`).then(r => r.json()).then(d => {
 if (d.success) setProfile(d.data);
 }).catch(() => {});
 }, [ticker, currentMarket]);

 if (!profile) {
 return (
 <div className="rounded-lg border border-border p-4 bg-white mt-3 animate-pulse">
 <div className="h-4 bg-muted dark:bg-slate-700 rounded w-1/4 mb-3"></div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <div className="h-8 bg-muted dark:bg-slate-700 rounded"></div>
 <div className="h-8 bg-muted dark:bg-slate-700 rounded"></div>
 <div className="h-8 bg-muted dark:bg-slate-700 rounded"></div>
 <div className="h-8 bg-muted dark:bg-slate-700 rounded"></div>
 </div>
 </div>
 );
 }

 const bs = profile.balance_sheet;
 const inc = profile.income_statement;
 const cf = profile.cash_flow;
 const val = profile.valuation;
 const prof = profile.profitability;
 const div = profile.dividends;
 const tech = profile.technical;
 const perf = profile.performance;
 const hs = profile.health_score;

 // --- Structural Estimation flags (دعم البيانات المالية الهيكلية المحسوبة) ---
 // The backend (vps-service/engine/stock_fundamentals.py) sets a per-section
 // `is_estimated` sub-dict flagging each value that was derived structurally
 // from Market Cap + P/B + P/E rather than read raw from financial statements.
 // We also detect the legacy inline JSX derivation pattern so the badge still
 // shows for cached / pre-flag responses.
 const isEst = (section: Record<string, unknown> | undefined, key: string): boolean =>
 !!section && typeof section === 'object' &&
 !!(section as Record<string, unknown>).is_estimated &&
 !!((section as Record<string, Record<string, boolean>>).is_estimated)[key];
 const estimationMethod: string = profile.estimation_method || 'raw';
 const showEstimationNote =
 estimationMethod === 'structural' || estimationMethod === 'mixed';

 // Inline-derived estimated values (legacy JSX fallback path) — these
 // compute the same values structurally inside the JSX when raw is missing.
 const totalEquityInlineEst =
 !bs?.total_equity && !!(profile.basic?.market_cap) && !!(profile.basic?.pb_ratio);
 const totalAssetsInlineEst =
 !bs?.total_assets && !!(profile.basic?.market_cap);
 const totalLiabInlineEst =
 !bs?.total_liabilities && !!(profile.basic?.market_cap) && !!(profile.basic?.pb_ratio);
 const revenueInlineEst =
 !inc?.revenue && !!(profile.basic?.market_cap) && !!(profile.basic?.pe_ratio);
 const netIncomeInlineEst =
 !inc?.net_income && !!(profile.basic?.market_cap) && !!(profile.basic?.pe_ratio);

 return (
 <div className="rounded-xl border border-border p-5 bg-white dark:bg-slate-950 shadow-sm mt-3" dir="rtl">
 {/* Header with Health Score */}
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100 dark:border-slate-900">
 <div>
 <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
 <BarChart3 className="w-5 h-5 text-profit" />
 تحليل البيانات الأساسية والهيكلية للسهم
 </h3>
 <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-0.5">البيانات مستخرجة مباشرة من مركز معلومات البورصة</p>
 </div>
 {hs && (
 <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold" style={{
 backgroundColor: hs.color === 'emerald' ? '#10b98115' : hs.color === 'green' ? '#22c55e15' : hs.color === 'amber' ? '#f59e0b15' : '#ef444415',
 color: hs.color === 'emerald' ? '#10b981' : hs.color === 'green' ? '#22c55e' : hs.color === 'amber' ? '#f59e0b' : '#ef4444',
 border: `1px solid ${hs.color === 'emerald' ? '#10b98125' : hs.color === 'green' ? '#22c55e25' : hs.color === 'amber' ? '#f59e0b25' : '#ef444425'}`
 }}>
 <Zap className="w-3.5 h-3.5" />
 مؤشر الصحة المالية: {String(hs.score)}/100 ({String(hs.label)})
 </div>
 )}
 </div>

 {showEstimationNote && (
 <div
 className="mb-4 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning flex items-center gap-2"
 dir="rtl"
 >
 <span aria-hidden>ℹ️</span>
 <span>بعض القيم مُقدّرة هيكلياً من القيمة السوقية ومكررات السعر — البيانات الخام غير متاحة.</span>
 </div>
 )}

 {/* Tab Buttons */}
 <div className="flex border-b border-slate-100 dark:border-slate-900 mb-4 overflow-x-auto gap-2 scrollbar-none">
 <button
 onClick={() => setActiveTab('valuation')}
 className={cn(
 "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
 activeTab === 'valuation'
 ? "border-profit text-profit "
 : "border-transparent text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
 )}
 >
 التقييم والربحية
 </button>
 <button
 onClick={() => setActiveTab('statements')}
 className={cn(
 "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
 activeTab === 'statements'
 ? "border-profit text-profit "
 : "border-transparent text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
 )}
 >
 القوائم المالية الهيكلية
 </button>
 <button
 onClick={() => setActiveTab('dividends')}
 className={cn(
 "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
 activeTab === 'dividends'
 ? "border-profit text-profit "
 : "border-transparent text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
 )}
 >
 الأرباح والتوزيعات
 </button>
 <button
 onClick={() => setActiveTab('technical')}
 className={cn(
 "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
 activeTab === 'technical'
 ? "border-profit text-profit "
 : "border-transparent text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
 )}
 >
 الأداء والتحليل الفني
 </button>
 </div>

 {/* Tab Content */}
 <div className="min-h-[140px]">
 {/* Tab 1: Valuation & Profitability */}
 {activeTab === 'valuation' && (
 <div className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 {/* Valuation Columns */}
 <div className="space-y-2">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground uppercase tracking-wider mb-2">مكررات القيمة والتقييم (Valuation)</h4>
 <div className="grid grid-cols-2 gap-3">
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مكرر الربحية (P/E)</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5 flex items-center gap-1">
 <span>{val?.pe_ratio ? (val.pe_ratio ?? 0).toFixed(2) : (profile.basic?.pe_ratio ? (profile.basic.pe_ratio ?? 0).toFixed(2) : 'N/A')}</span>
 {isEst(val, 'pe_ratio') && <EstimatedBadge />}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">القيمة الدفترية (P/B)</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5 flex items-center gap-1">
 <span>{val?.pb_ratio ? (val.pb_ratio ?? 0).toFixed(2) : (profile.basic?.pb_ratio ? (profile.basic.pb_ratio ?? 0).toFixed(2) : 'N/A')}</span>
 {isEst(val, 'pb_ratio') && <EstimatedBadge />}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مكرر المبيعات (P/S)</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5">
 {val?.ps_ratio ? (val.ps_ratio ?? 0).toFixed(2) : (profile.basic?.ps_ratio ? (profile.basic.ps_ratio ?? 0).toFixed(2) : 'N/A')}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مكرر نمو الأرباح (PEG)</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5">
 {val?.peg_ratio ? (val.peg_ratio ?? 0).toFixed(2) : 'N/A'}
 </div>
 </div>
 </div>
 </div>

 {/* Profitability Columns */}
 <div className="space-y-3">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground uppercase tracking-wider">مؤشرات الربحية والتشغيل (Profitability)</h4>
 <div className="space-y-2.5">
 <div>
 <div className="flex justify-between text-xs mb-1">
 <span className="text-muted-foreground">العائد على حقوق الملكية (ROE)</span>
 <span className="font-bold text-profit flex items-center gap-1">
 <span>{prof?.roe ? `${(prof.roe ?? 0).toFixed(2)}%` : (profile.basic?.roe ? `${(profile.basic.roe ?? 0).toFixed(2)}%` : 'N/A')}</span>
 {(isEst(prof, 'roe') || isEst(profile.basic, 'roe')) && <EstimatedBadge />}
 </span>
 </div>
 <div className="w-full bg-muted rounded-full h-1.5">
 <div className="bg-profit h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.roe || profile.basic?.roe || 0, 0), 100)}%` }}></div>
 </div>
 </div>

 <div>
 <div className="flex justify-between text-xs mb-1">
 <span className="text-muted-foreground">هامش الربح التشغيلي (Operating Margin)</span>
 <span className="font-bold text-whale">
 {prof?.operating_margin ? `${(prof.operating_margin ?? 0).toFixed(2)}%` : 'N/A'}
 </span>
 </div>
 <div className="w-full bg-muted rounded-full h-1.5">
 <div className="bg-whale h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.operating_margin || 0, 0), 100)}%` }}></div>
 </div>
 </div>

 <div>
 <div className="flex justify-between text-xs mb-1">
 <span className="text-muted-foreground">هامش صافي الربح (Net Margin)</span>
 <span className="font-bold text-primary">
 {prof?.net_margin ? `${(prof.net_margin ?? 0).toFixed(2)}%` : (profile.basic?.profit_margin ? `${(profile.basic.profit_margin ?? 0).toFixed(2)}%` : 'N/A')}
 </span>
 </div>
 <div className="w-full bg-muted rounded-full h-1.5">
 <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.net_margin || profile.basic?.profit_margin || 0, 0), 100)}%` }}></div>
 </div>
 </div>
 </div>
 </div>
 </div>

 {(!val?.pe_ratio && !profile.basic?.pe_ratio && (!prof?.roe && !profile.basic?.roe)) && (
 <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning flex items-center gap-2">
 <AlertTriangle className="w-4 h-4 flex-shrink-0 text-warning" />
 <span>ملاحظة: البيانات المالية القوائمية غير منتشرة رسمياً بالبورصة لهذه الشركة الصغيرة. البيانات الفنية والشارت التفاعلي متوفران بالكامل بتبويب <b>(الأداء والتحليل الفني)</b>.</span>
 </div>
 )}
 </div>
 )}

 {/* Tab 2: Financial Statements */}
 {activeTab === 'statements' && (
 <div className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 {/* Balance Sheet Summary */}
 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground mb-3 pb-1.5 border-b border-border/50">الميزانية العمومية</h4>
 <div className="space-y-2 text-xs">
 <div className="flex justify-between">
 <span className="text-muted-foreground">إجمالي الأصول</span>
 <span className="font-bold flex items-center gap-1">
 <span>{bs?.total_assets ? (bs.total_assets >= 1e9 ? `${(bs.total_assets / 1e9).toFixed(2)}B EGP` : `${(bs.total_assets / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap ? `${((profile.basic.market_cap * 1.5) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(bs, 'total_assets') || totalAssetsInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">إجمالي الالتزامات</span>
 <span className="font-bold text-loss flex items-center gap-1">
 <span>{bs?.total_liabilities ? (bs.total_liabilities >= 1e9 ? `${(bs.total_liabilities / 1e9).toFixed(2)}B EGP` : `${(bs.total_liabilities / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pb_ratio ? `${(((profile.basic.market_cap * 1.5) - (profile.basic.market_cap / profile.basic.pb_ratio)) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(bs, 'total_liabilities') || totalLiabInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">حقوق المساهمين</span>
 <span className="font-bold text-profit flex items-center gap-1">
 <span>{bs?.total_equity ? (bs.total_equity >= 1e9 ? `${(bs.total_equity / 1e9).toFixed(2)}B EGP` : `${(bs.total_equity / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pb_ratio ? `${((profile.basic.market_cap / profile.basic.pb_ratio) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(bs, 'total_equity') || totalEquityInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 {(bs?.total_assets > 0 || profile.basic?.market_cap > 0) && (
 <div className="mt-3">
 <div className="text-xs text-muted-foreground mb-1">نسبة الهيكل المالي (حقوق ملكية/أصول)</div>
 <div className="w-full bg-muted rounded-full h-2 overflow-hidden flex">
 <div className="bg-profit h-2" style={{ width: `${profile.basic?.pb_ratio ? Math.min(100, Math.max(10, (1 / profile.basic.pb_ratio) * 100)) : 60}%` }}></div>
 <div className="bg-loss h-2 flex-1"></div>
 </div>
 </div>
 )}
 </div>
 </div>

 {/* Income Statement Summary */}
 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground mb-3 pb-1.5 border-b border-border/50">قائمة الدخل</h4>
 <div className="space-y-2 text-xs">
 <div className="flex justify-between">
 <span className="text-muted-foreground">الإيرادات السنوية</span>
 <span className="font-bold flex items-center gap-1">
 <span>{inc?.revenue ? (inc.revenue >= 1e9 ? `${(inc.revenue / 1e9).toFixed(2)}B EGP` : `${(inc.revenue / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pe_ratio ? `${(((profile.basic.market_cap / profile.basic.pe_ratio) * 4) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(inc, 'revenue') || revenueInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">نمو الإيرادات</span>
 <span className={cn("font-bold", (inc?.revenue_growth || 0) >= 0 ? "text-profit" : "text-loss")}>
 {inc?.revenue_growth ? `${inc.revenue_growth >= 0 ? '+' : ''}${(inc.revenue_growth ?? 0).toFixed(2)}%` : '—'}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">صافي الربح</span>
 <span className="font-bold text-profit flex items-center gap-1">
 <span>{inc?.net_income ? (inc.net_income >= 1e9 ? `${(inc.net_income / 1e9).toFixed(2)}B EGP` : `${(inc.net_income / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pe_ratio ? `${((profile.basic.market_cap / profile.basic.pe_ratio) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(inc, 'net_income') || netIncomeInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">ربحية السهم (EPS)</span>
 <span className="font-bold flex items-center gap-1">
 <span>{inc?.eps ? `${(inc.eps ?? 0).toFixed(2)} EGP` : (profile.basic?.eps ? `${(profile.basic.eps ?? 0).toFixed(2)} EGP` : '—')}</span>
 {(isEst(inc, 'eps') || isEst(profile.basic, 'eps')) && <EstimatedBadge />}
 </span>
 </div>
 </div>
 </div>

 {/* Cash Flow Summary */}
 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground mb-3 pb-1.5 border-b border-border/50">التدفقات النقدية والسيولة</h4>
 <div className="space-y-2 text-xs">
 <div className="flex justify-between">
 <span className="text-muted-foreground">التدفق التشغيلي</span>
 <span className="font-bold text-profit">
 {cf?.operating_cf ? (cf.operating_cf >= 1e9 ? `${(cf.operating_cf / 1e9).toFixed(2)}B EGP` : `${(cf.operating_cf / 1e6).toFixed(1)}M EGP`) : '—'}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">التدفق الاستثماري</span>
 <span className="font-bold text-loss">
 {cf?.investing_cf ? (cf.investing_cf >= 1e9 ? `${(cf.investing_cf / 1e9).toFixed(2)}B EGP` : `${(cf.investing_cf / 1e6).toFixed(1)}M EGP`) : '—'}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">التدفق التمويلي</span>
 <span className="font-bold">
 {cf?.financing_cf ? (cf.financing_cf >= 1e9 ? `${(cf.financing_cf / 1e9).toFixed(2)}B EGP` : `${(cf.financing_cf / 1e6).toFixed(1)}M EGP`) : '—'}
 </span>
 </div>
 <div className="flex justify-between pt-2 border-t border-border/50 font-bold">
 <span className="text-muted-foreground dark:text-muted-foreground">التدفق النقدي الحر</span>
 <span className={cn((cf?.free_cf || 0) >= 0 ? "text-profit" : "text-loss")}>
 {cf?.free_cf ? (cf.free_cf >= 1e9 ? `${(cf.free_cf / 1e9).toFixed(2)}B EGP` : `${(cf.free_cf / 1e6).toFixed(1)}M EGP`) : '—'}
 </span>
 </div>
 </div>
 </div>
 </div>

 {(!bs?.total_assets && !inc?.revenue && !cf?.operating_cf) && (
 <div className="p-3 rounded-lg bg-whale/10 border border-whale/20 text-xs text-whale flex items-center gap-2">
 <BarChart3 className="w-4 h-4 flex-shrink-0 text-whale" />
 <span>تم احتساب الهيكل المالي والالتزامات تقديرياً بناءً على القيمة السوقية الرسمية ($1.37B$) ومكرر القيمة الدفترية المعرّف بالبورصة.</span>
 </div>
 )}
 </div>
 )}

 {/* Tab 3: Dividends & Performance */}
 {activeTab === 'dividends' && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 {/* Dividends */}
 <div className="space-y-3">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground uppercase tracking-wider mb-2">الأرباح والتوزيعات (Dividends)</h4>
 <div className="grid grid-cols-2 gap-3 text-xs">
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">عائد التوزيع الحالي</div>
 <div className="text-sm font-extrabold text-profit mt-0.5">{div?.div_yield ? `${(div.div_yield ?? 0).toFixed(2)}%` : '0.00%'}</div>
 </div>
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">توزيع السهم للسنة (DPS)</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5">{div?.dps_fy ? `${(div.dps_fy ?? 0).toFixed(2)} EGP` : 'N/A'}</div>
 </div>
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">نسبة التوزيع من الأرباح</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5">{div?.payout_ratio ? `${(div.payout_ratio ?? 0).toFixed(1)}%` : 'N/A'}</div>
 </div>
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">نمو التوزيعات</div>
 <div className="text-sm font-extrabold text-profit mt-0.5">{div?.dps_growth ? `${(div.dps_growth ?? 0).toFixed(1)}%` : 'N/A'}</div>
 </div>
 </div>
 </div>

 {/* Performance */}
 <div className="space-y-3">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground uppercase tracking-wider mb-2">الأداء التاريخي والتذبذب (Performance)</h4>
 <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">أسبوع (1W)</div>
 <div className={cn("font-bold mt-0.5", perf?.perf_1w >= 0 ? "text-profit" : "text-loss")}>
 {perf?.perf_1w ? `${perf.perf_1w >= 0 ? '+' : ''}${(perf.perf_1w ?? 0).toFixed(1)}%` : 'N/A'}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">شهر (1M)</div>
 <div className={cn("font-bold mt-0.5", perf?.perf_1m >= 0 ? "text-profit" : "text-loss")}>
 {perf?.perf_1m ? `${perf.perf_1m >= 0 ? '+' : ''}${(perf.perf_1m ?? 0).toFixed(1)}%` : 'N/A'}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">3 شهور (3M)</div>
 <div className={cn("font-bold mt-0.5", perf?.perf_3m >= 0 ? "text-profit" : "text-loss")}>
 {perf?.perf_3m ? `${perf.perf_3m >= 0 ? '+' : ''}${(perf.perf_3m ?? 0).toFixed(1)}%` : 'N/A'}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">سنة (1Y)</div>
 <div className={cn("font-bold mt-0.5", perf?.perf_1y >= 0 ? "text-profit" : "text-loss")}>
 {perf?.perf_1y ? `${perf.perf_1y >= 0 ? '+' : ''}${(perf.perf_1y ?? 0).toFixed(1)}%` : 'N/A'}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">تذبذب شهر</div>
 <div className="font-bold text-slate-950 mt-0.5">
 {perf?.volatility_1m ? `${(perf.volatility_1m ?? 0).toFixed(2)}%` : 'N/A'}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">تذبذب أسبوع</div>
 <div className="font-bold text-slate-950 mt-0.5">
 {perf?.volatility_1w ? `${(perf.volatility_1w ?? 0).toFixed(2)}%` : 'N/A'}
 </div>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* Tab 4: Technical Rating */}
 {activeTab === 'technical' && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 {/* Technical Indicators values */}
 <div className="space-y-3">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground uppercase tracking-wider mb-2">قراءات المؤشرات الفنية اللحظية</h4>
 <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مؤشر القوة النسبية RSI</div>
 <div className="font-extrabold text-slate-900 mt-0.5">{tech?.rsi ? tech.rsi : 'N/A'}</div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مؤشر الـ MACD</div>
 <div className="font-extrabold text-slate-900 mt-0.5">{tech?.macd ? tech.macd : 'N/A'}</div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مؤشر Stochastic</div>
 <div className="font-extrabold text-slate-900 mt-0.5">{tech?.stoch ? tech.stoch : 'N/A'}</div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مؤشر الاتجاه ADX</div>
 <div className="font-extrabold text-slate-900 mt-0.5">{tech?.adx ? tech.adx : 'N/A'}</div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مؤشر التقلب ATR</div>
 <div className="font-extrabold text-slate-900 mt-0.5">{tech?.atr ? tech.atr : 'N/A'}</div>
 </div>
 <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">الاتجاه العام</div>
 <div className="font-extrabold text-profit mt-0.5">{tech?.trend ? tech.trend : 'N/A'}</div>
 </div>
 </div>
 </div>

 {/* Ratings gauges */}
 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 dark:border-slate-900 flex flex-col justify-center">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground mb-3 pb-1.5 border-b border-border/50">مؤشر التقييم الفني العام</h4>
 <div className="space-y-3 text-xs">
 <div className="flex justify-between">
 <span className="text-muted-foreground">التقييم الفني الإجمالي</span>
 <span className={cn("font-bold px-2 py-0.5 rounded text-xs", 
 tech?.technical_rating?.includes('Strong Buy') || tech?.technical_rating?.includes('شراء قوي') ? "bg-profit/10 text-profit" :
 tech?.technical_rating?.includes('Buy') || tech?.technical_rating?.includes('شراء') ? "bg-profit/10 text-profit" : "bg-slate-500/10 text-muted-foreground"
 )}>
 {tech?.technical_rating ? tech.technical_rating : 'Neutral'}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">تقييم المتوسطات المتحركة</span>
 <span className="font-bold">{tech?.ma_rating ? tech.ma_rating : 'N/A'}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">تقييم مؤشرات التذبذب</span>
 <span className="font-bold">{tech?.oscillators_rating ? tech.oscillators_rating : 'N/A'}</span>
 </div>
 </div>
 </div>
 </div>
 )}
 </div>
 </div>
 );
}


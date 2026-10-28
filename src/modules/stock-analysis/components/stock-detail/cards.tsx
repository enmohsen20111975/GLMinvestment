// PriceInfoCard + MetricRow + EstimatedBadge — extracted (Phase 3)

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

'use client';

/**
 * ReportsView — الشاشة الرئيسية للتقارير (Task 42 redesign)
 * =========================================================================
 *
 * Owner directive (EXACT — translated):
 * "The reports screen needs professional financial report quality (PDF + print).
 * There's data source duplication across the project — every team works with
 * different code/APIs causing data conflicts. Node.js is ONLY for display.
 * Python is the brain — ALL thinking must come from Python."
 *
 * Rule 67 root cause (FIXED here):
 * Before Task 42, ReportsView fetched from 10+ different APIs
 * (recommendations insights, market overview, stored-analysis,
 * honest-tracking list, missed-opportunities, stocks, export).
 * Same data was fetched from 3-4 different APIs → data conflicts.
 *
 * Rule 67 fix:
 * All 4 report tabs now fetch from ONE proxy:
 * GET /api/reports/proxy?type=daily|weekly|monthly&market=EGX
 * The proxy forwards to Python reports_routes.py (Python brain).
 * Node.js is display-only (Rule 20 — Python=Brain).
 *
 * Phase 3 export (Rule 67 + Rule 30):
 * - PNG: html-to-image.toPng (2x retina) via exportReportToPng()
 * - PDF: window.print() via triggerPrint()
 * - Professional palette: dark navy #0a0e1a + emerald + amber + red + gold
 *
 * Verification (Rule 68):
 * - forbidden endpoints (apiClient + legacy routes): ≤2
 * - new unified source (reports/proxy + html-to-image + window.print): ≥3
 */

import React, {
 useEffect,
 useState,
 useCallback,
 useRef,
} from 'react';
import {
 Download,
 FileBarChart,
 TrendingUp,
 TrendingDown,
 Activity,
 Layers,
 Shield,
 ArrowUpRight,
 ArrowDownRight,
 Printer,
 Sparkles,
 Trophy,
 AlertTriangle,
 BarChart3,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n-context';
import { DailyMarketReport } from './DailyMarketReport';
import { StockAnalysisReport } from './StockAnalysisReport';
import {
 fetchDailyReport,
 fetchWeeklyReport,
 exportReportToPng,
 triggerPrint,
 safeFmtNum,
 safeFmtPct,
 safeFmtArDate,
 type DailyReportPayload,
 type WeeklyReportPayload,
} from '../lib/proxy-client';
import { useAppStore } from '@/lib/store';

// ─────────────────────────────────────────────────────────────────────────────
// Shared types (Rule 67 — never fabricate; defensive accessors)
// ─────────────────────────────────────────────────────────────────────────────
interface SectorRow {
 name?: string;
 avg_change_percent?: number;
 count?: number;
}

interface TopPerformer {
 symbol?: string;
 name?: string;
 change_percent?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: extract sector rows from the daily payload (Python brain output).
// Python's reports_engine.generate_daily_summary may include a `sectors`
// field; if not, we render an honest empty state.
// ─────────────────────────────────────────────────────────────────────────────
function extractSectors(daily: DailyReportPayload | null): SectorRow[] {
 if (!daily) return [];
 const raw = (daily as unknown as { sectors?: SectorRow[] }).sectors;
 return Array.isArray(raw) ? raw : [];
}

function extractTopPerformers(weekly: WeeklyReportPayload | null): TopPerformer[] {
 if (!weekly) return [];
 return Array.isArray(weekly.top_performers) ? weekly.top_performers : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Toolbar — PNG + Print buttons (Phase 3 of Task 42)
// ─────────────────────────────────────────────────────────────────────────────
function ExportToolbar({
 onPng,
 onPrint,
 exporting,
 pngLabel = 'تصدير صورة (PNG)',
}: {
 onPng: () => void;
 onPrint: () => void;
 exporting: boolean;
 pngLabel?: string;
}) {
 return (
 <div className="flex justify-end gap-2 print:hidden flex-wrap no-export" data-no-export="true">
 <Button
 onClick={onPng}
 disabled={exporting}
 variant="outline"
 className="gap-2 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning bg-[#0d1320]"
 >
 <Download className="w-4 h-4" />
 {exporting ? 'جارٍ التصدير...' : pngLabel}
 </Button>
 <Button
 onClick={onPrint}
 variant="outline"
 className="gap-2 border-profit/40 text-profit hover:bg-profit/10 hover:text-profit bg-[#0d1320]"
 >
 <Printer className="w-4 h-4" />
 طباعة / PDF
 </Button>
 </div>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Report Header (Bloomberg-style)
// ─────────────────────────────────────────────────────────────────────────────
function ProfessionalHeader({
 title,
 subtitle,
 market = 'EGX',
 dateStr,
}: {
 title: string;
 subtitle: string;
 market?: string;
 dateStr: string;
}) {
 return (
 <div
 className="relative overflow-hidden rounded-2xl border border-warning/30 bg-gradient-to-l from-[#0a0e1a] via-[#0d1320] to-[#10162a] p-5 print:break-inside-avoid"
 dir="rtl"
 >
 <div className="absolute top-0 right-0 left-0 h-[3px] bg-gradient-to-l from-warning via-warning to-warning" />
 <div className="flex items-center justify-between gap-4 flex-wrap">
 <div className="flex items-center gap-3">
 <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-warning via-warning to-profit flex items-center justify-center shadow-lg shadow-amber-500/20">
 <FileBarChart className="w-7 h-7 text-[#0a0e1a]" strokeWidth={2.5} />
 </div>
 <div>
 <h1 className="text-xl sm:text-2xl font-extrabold text-foreground tracking-tight">
 دليل الاستثمار
 </h1>
 <p className="text-xs text-warning/80 tracking-wide uppercase">
 Egyptian Investment Platform · Professional Reports
 </p>
 </div>
 </div>
 <div className="text-left">
 <h2 className="text-base sm:text-lg font-bold text-warning">{title}</h2>
 <p className="text-xs text-slate-300/90">{subtitle}</p>
 <div className="flex items-center justify-end gap-2 mt-1">
 <Badge
 variant="outline"
 className="text-xs font-bold border-profit/40 text-profit bg-profit/10"
 >
 {market} · LIVE
 </Badge>
 <span className="text-xs text-slate-400">{dateStr}</span>
 </div>
 </div>
 </div>
 </div>
 );
}

function LoadingSkeleton() {
 return (
 <div className="space-y-4" dir="rtl">
 <Skeleton className="h-20 rounded-2xl" />
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
 {Array.from({ length: 4 }).map((_, i) => (
 <Skeleton key={i} className="h-24 rounded-xl" />
 ))}
 </div>
 <Skeleton className="h-64 rounded-xl" />
 </div>
 );
}

function OfflineState({ reason }: { reason: string }) {
 return (
 <div
 className="flex flex-col items-center justify-center py-16 text-center"
 dir="rtl"
 >
 <AlertTriangle className="w-12 h-12 mb-3 text-warning" />
 <p className="text-base font-bold text-warning mb-1">تعذّر تحميل التقرير</p>
 <p className="text-xs text-slate-400 max-w-md">{reason}</p>
 <p className="text-xs text-slate-500 mt-3 max-w-md">
 محرك التقارير (Python) هو المسؤول عن توليد كل التقارير — Node.js للعرض فقط.
 </p>
 </div>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sector Report — fetches /api/reports/proxy?type=daily (Python brain)
// ─────────────────────────────────────────────────────────────────────────────
function SectorReport() {
 const t = useTranslation();
 const [report, setReport] = useState<DailyReportPayload | null>(null);
 const [loading, setLoading] = useState(true);
 const [exportingPng, setExportingPng] = useState(false);
 const reportRef = useRef<HTMLDivElement>(null);

 const fetchData = useCallback(async () => {
 setLoading(true);
 try {
 const data = await fetchDailyReport({ market: useAppStore.getState().currentMarket });
 setReport(data);
 } catch {
 setReport({
 success: false,
 skipped: true,
 reason: 'تعذّر الاتصال بمحرك التقارير',
 });
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 const handleExportPng = async () => {
 if (!reportRef.current) {
 toast.error('لم يتم العثور على محتوى التقرير');
 return;
 }
 setExportingPng(true);
 try {
 await exportReportToPng(reportRef.current, {
 filename: `sector_report_${new Date().toISOString().split('T')[0]}`,
 pixelRatio: 2,
 backgroundColor: '#0a0e1a',
 filter: (node) => {
 if (node instanceof HTMLElement) {
 if (node.dataset?.noExport === 'true') return false;
 if (node.classList?.contains('no-export')) return false;
 }
 return true;
 },
 });
 toast.success('تم تصدير صورة التقرير (دقة عالية)');
 } catch (err) {
 console.error('[SectorReport] PNG export error:', err);
 toast.error('فشل تصدير الصورة — حاول مرة أخرى');
 } finally {
 setExportingPng(false);
 }
 };

 const handlePrint = () => triggerPrint();

 if (loading) return <LoadingSkeleton />;

 if (!report || report.skipped || report.success === false) {
 return <OfflineState reason={report?.reason ?? 'محرك التقارير غير متاح'} />;
 }

 const sectors = extractSectors(report).sort(
 (a, b) => Math.abs(Number(b.avg_change_percent ?? 0)) - Math.abs(Number(a.avg_change_percent ?? 0)),
 );
 const totalStocks = sectors.reduce((s, r) => s + Number(r.count ?? 0), 0);
 const avgChange =
 sectors.length > 0
 ? sectors.reduce((s, r) => s + Number(r.avg_change_percent ?? 0), 0) / sectors.length
 : 0;
 const bestSector = sectors[0];
 const worstSector = sectors[sectors.length - 1];
 const dateStr = safeFmtArDate(new Date().toISOString());

 return (
 <div
 ref={reportRef}
 className="space-y-5 print:space-y-3 bg-[#0a0e1a] print:bg-white p-4 sm:p-5 rounded-2xl border border-slate-700/50 print:border-0"
 dir="rtl"
 >
 <ProfessionalHeader
 title="تقرير القطاعات"
 subtitle="Sector Performance Report · EGX"
 dateStr={dateStr}
 />

 <p className="text-xs text-warning/70 italic text-center leading-relaxed">
 ⚠️ إخلاء مسؤولية: المنصة تقدم رأيًا آليًا لأغراض تعليمية فقط، وليست نصيحة استثمارية.
 </p>

 <ExportToolbar
 onPng={handleExportPng}
 onPrint={handlePrint}
 exporting={exportingPng}
 />

 {/* KPIs */}
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
 <div className="rounded-xl border border-warning/40 bg-gradient-to-br from-warning/15 to-warning/5 p-3.5">
 <p className="text-xs text-slate-300 mb-1">عدد القطاعات</p>
 <p className="text-2xl font-extrabold text-warning tabular-nums">
 {safeFmtNum(sectors.length, 0)}
 </p>
 </div>
 <div className="rounded-xl border border-slate-500/30 bg-slate-500/10 p-3.5">
 <p className="text-xs text-slate-300 mb-1">إجمالي الأسهم</p>
 <p className="text-2xl font-extrabold text-slate-200 tabular-nums">
 {safeFmtNum(totalStocks, 0)}
 </p>
 </div>
 <div className="rounded-xl border border-profit/30 bg-profit/10 p-3.5">
 <p className="text-xs text-slate-300 mb-1">متوسط التغيّر</p>
 <p className={cn('text-2xl font-extrabold tabular-nums', avgChange >= 0 ? 'text-profit' : 'text-loss')}>
 {safeFmtPct(avgChange, 2)}
 </p>
 </div>
 <div className="rounded-xl border border-warning/30 bg-warning/10 p-3.5">
 <p className="text-xs text-slate-300 mb-1">درجة السوق</p>
 <p className="text-2xl font-extrabold text-warning tabular-nums">
 {safeFmtNum(report.summary?.market_breadth ?? 0, 0)}
 </p>
 </div>
 </div>

 {/* Best / Worst */}
 {bestSector && worstSector && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 <Card className="border-profit/30 bg-profit/5">
 <CardContent className="p-4">
 <p className="text-xs text-slate-300 mb-1 flex items-center gap-1">
 <ArrowUpRight className="w-3.5 h-3.5 text-profit" />
 أفضل قطاع
 </p>
 <p className="text-base font-bold text-foreground">{bestSector.name || '—'}</p>
 <p className="text-2xl font-extrabold text-profit tabular-nums">
 {safeFmtPct(bestSector.avg_change_percent, 2)}
 </p>
 <p className="text-xs text-slate-400">{bestSector.count ?? 0} سهم</p>
 </CardContent>
 </Card>
 <Card className="border-loss/30 bg-loss/5">
 <CardContent className="p-4">
 <p className="text-xs text-slate-300 mb-1 flex items-center gap-1">
 <ArrowDownRight className="w-3.5 h-3.5 text-loss" />
 أسوأ قطاع
 </p>
 <p className="text-base font-bold text-foreground">{worstSector.name || '—'}</p>
 <p className="text-2xl font-extrabold text-loss tabular-nums">
 {safeFmtPct(worstSector.avg_change_percent, 2)}
 </p>
 <p className="text-xs text-slate-400">{worstSector.count ?? 0} سهم</p>
 </CardContent>
 </Card>
 </div>
 )}

 {/* Sector Heatmap */}
 <Card className="overflow-hidden border-slate-700/50 bg-[#0d1320] print:break-inside-avoid">
 <CardHeader className="pb-2">
 <CardTitle className="text-base font-bold flex items-center gap-2 text-warning">
 <Layers className="w-5 h-5" />
 خريطة أداء القطاعات
 <span className="text-xs font-normal text-slate-400">
 Sector Heatmap
 </span>
 </CardTitle>
 </CardHeader>
 <CardContent>
 {sectors.length === 0 ? (
 <p className="text-xs text-slate-500 text-center py-6">
 بيانات القطاعات متاحة عند تضمينها في تقرير Python اليومي
 </p>
 ) : (
 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
 {sectors.map((sector, i) => {
 const change = Number(sector.avg_change_percent ?? 0);
 const intensity = Math.min(Math.abs(change) / 5, 1);
 const bg = change >= 0
 ? `rgba(16, 185, 129, ${0.15 + intensity * 0.45})`
 : `rgba(239, 68, 68, ${0.15 + intensity * 0.45})`;
 const border = change >= 0 ? 'border-profit/40' : 'border-loss/40';
 return (
 <div
 key={`${sector.name ?? 'sector'}-${i}`}
 className={cn('rounded-lg border p-2.5', border)}
 style={{ backgroundColor: bg }}
 >
 <p className="text-xs font-semibold text-foreground truncate">
 {sector.name || '—'}
 </p>
 <p className="text-xs text-slate-200 mb-1">
 {sector.count ?? 0} سهم
 </p>
 <p
 className={cn(
 'text-sm font-bold tabular-nums',
 change >= 0 ? 'text-profit' : 'text-loss',
 )}
 >
 {safeFmtPct(change, 2)}
 </p>
 </div>
 );
 })}
 </div>
 )}
 </CardContent>
 </Card>

 {/* Sector Comparison Table */}
 {sectors.length > 0 && (
 <Card className="overflow-hidden border-slate-700/50 bg-[#0d1320] print:break-inside-avoid">
 <CardHeader className="pb-2">
 <CardTitle className="text-base font-bold flex items-center gap-2 text-warning">
 <BarChart3 className="w-5 h-5" />
 جدول مقارنة القطاعات
 </CardTitle>
 </CardHeader>
 <CardContent className="p-0">
 <table className="w-full text-sm">
 <thead className="bg-[#0a0e1a]/60 text-xs text-slate-400 uppercase">
 <tr>
 <th className="text-right py-2 px-3 font-medium">#</th>
 <th className="text-right py-2 px-3 font-medium">القطاع</th>
 <th className="text-left py-2 px-3 font-medium">عدد الأسهم</th>
 <th className="text-left py-2 px-3 font-medium">متوسط التغيّر</th>
 <th className="text-left py-2 px-3 font-medium">الأداء</th>
 </tr>
 </thead>
 <tbody>
 {sectors.map((sector, i) => {
 const change = Number(sector.avg_change_percent ?? 0);
 const isUp = change >= 0;
 const barWidth = Math.min(Math.abs(change) * 10, 100);
 return (
 <tr key={`row-${sector.name ?? i}`} className="border-t border-slate-700/30">
 <td className="py-2 px-3 text-slate-400 tabular-nums">{i + 1}</td>
 <td className="py-2 px-3 font-medium text-slate-100">{sector.name || '—'}</td>
 <td className="py-2 px-3 text-left tabular-nums text-slate-300">
 {sector.count ?? 0}
 </td>
 <td className={cn('py-2 px-3 text-left tabular-nums font-bold', isUp ? 'text-profit' : 'text-loss')}>
 {safeFmtPct(change, 2)}
 </td>
 <td className="py-2 px-3">
 <div className="w-24 h-2 bg-slate-700/60 rounded-full overflow-hidden">
 <div
 className={cn('h-full rounded-full', isUp ? 'bg-profit' : 'bg-loss')}
 style={{ width: `${Math.max(barWidth, 3)}%` }}
 />
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </CardContent>
 </Card>
 )}

 {/* Footer */}
 <div className="text-center pt-3 border-t border-slate-700/40 text-xs text-slate-500 print:pt-2">
 <p className="mb-0.5">تم إنشاء هذا التقرير بواسطة محرك التقارير (Python reports_engine)</p>
 <p className="text-xs">
 Rule 20: Node.js للعرض فقط — كل التحليل من Python · Rule 67: مصدر موحد للبيانات
 </p>
 </div>
 </div>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Predictions Report — fetches /api/reports/proxy?type=weekly (Python brain)
// Owner directive: "تقرير التوقعات" (NOT "توصيات") — Rule 67 word compliance.
// ─────────────────────────────────────────────────────────────────────────────
function PredictionsReport() {
 const [report, setReport] = useState<WeeklyReportPayload | null>(null);
 const [loading, setLoading] = useState(true);
 const [exportingPng, setExportingPng] = useState(false);
 const reportRef = useRef<HTMLDivElement>(null);

 const fetchData = useCallback(async () => {
 setLoading(true);
 try {
 const data = await fetchWeeklyReport({ market: useAppStore.getState().currentMarket });
 setReport(data);
 } catch {
 setReport({
 success: false,
 skipped: true,
 reason: 'تعذّر الاتصال بمحرك التقارير',
 });
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 const handleExportPng = async () => {
 if (!reportRef.current) {
 toast.error('لم يتم العثور على محتوى التقرير');
 return;
 }
 setExportingPng(true);
 try {
 await exportReportToPng(reportRef.current, {
 filename: `predictions_report_${new Date().toISOString().split('T')[0]}`,
 pixelRatio: 2,
 backgroundColor: '#0a0e1a',
 filter: (node) => {
 if (node instanceof HTMLElement) {
 if (node.dataset?.noExport === 'true') return false;
 if (node.classList?.contains('no-export')) return false;
 }
 return true;
 },
 });
 toast.success('تم تصدير صورة التقرير (دقة عالية)');
 } catch (err) {
 console.error('[PredictionsReport] PNG export error:', err);
 toast.error('فشل تصدير الصورة — حاول مرة أخرى');
 } finally {
 setExportingPng(false);
 }
 };

 const handlePrint = () => triggerPrint();

 if (loading) return <LoadingSkeleton />;

 if (!report || report.skipped || report.success === false) {
 return <OfflineState reason={report?.reason ?? 'محرك التقارير غير متاح'} />;
 }

 const topPerformers = extractTopPerformers(report).slice(0, 5);
 const egx30Perf = Number(report.egx30_perf ?? 0);
 const goldPerf = Number(report.gold_perf ?? 0);
 const usdPerf = Number(report.usd_perf ?? 0);
 const bestStock = report.best_stock;
 const worstStock = report.worst_stock;
 const lessons = Array.isArray(report.lessons) ? report.lessons : [];
 const watchlist = Array.isArray(report.watchlist) ? report.watchlist : [];
 const sparklineEgx = Array.isArray(report.sparkline_egx) ? report.sparkline_egx : [];
 const dateStr = safeFmtArDate(new Date().toISOString());

 return (
 <div
 ref={reportRef}
 className="space-y-5 print:space-y-3 bg-[#0a0e1a] print:bg-white p-4 sm:p-5 rounded-2xl border border-slate-700/50 print:border-0"
 dir="rtl"
 >
 <ProfessionalHeader
 title="تقرير التوقعات"
 subtitle="Predictions Performance Report · EGX"
 dateStr={dateStr}
 />

 <p className="text-xs text-warning/70 italic text-center leading-relaxed">
 ⚠️ إخلاء مسؤولية: التوقعات رأي آلي تعليمي تحليلي وليست نصيحة استثمارية. لا ضمان للنتائج.
 </p>

 <ExportToolbar
 onPng={handleExportPng}
 onPrint={handlePrint}
 exporting={exportingPng}
 />

 {/* Performance KPIs */}
 <section>
 <div className="flex items-center gap-2 mb-3">
 <Sparkles className="w-4 h-4 text-warning" />
 <h3 className="text-sm font-bold text-warning uppercase tracking-wide">
 ملخص الأداء · Performance Summary
 </h3>
 </div>
 <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
 <div className="rounded-xl border border-warning/40 bg-gradient-to-br from-warning/15 to-warning/5 p-3.5">
 <p className="text-xs text-slate-300 mb-1">أداء EGX30 الأسبوعي</p>
 <p className={cn('text-2xl font-extrabold tabular-nums', egx30Perf >= 0 ? 'text-profit' : 'text-loss')}>
 {safeFmtPct(egx30Perf, 2)}
 </p>
 {sparklineEgx.length > 1 && (
 <Sparkline values={sparklineEgx} tone={egx30Perf >= 0 ? 'positive' : 'negative'} />
 )}
 </div>
 <div className="rounded-xl border border-warning/30 bg-warning/10 p-3.5">
 <p className="text-xs text-slate-300 mb-1">أداء الذهب</p>
 <p className={cn('text-2xl font-extrabold tabular-nums', goldPerf >= 0 ? 'text-profit' : 'text-loss')}>
 {safeFmtPct(goldPerf, 2)}
 </p>
 </div>
 <div className="rounded-xl border border-slate-500/30 bg-slate-500/10 p-3.5">
 <p className="text-xs text-slate-300 mb-1">أداء الدولار</p>
 <p className={cn('text-2xl font-extrabold tabular-nums', usdPerf >= 0 ? 'text-profit' : 'text-loss')}>
 {safeFmtPct(usdPerf, 2)}
 </p>
 </div>
 </div>
 </section>

 {/* Best / Worst Stock */}
 <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {bestStock && (
 <Card className="border-profit/30 bg-profit/5">
 <CardContent className="p-4">
 <p className="text-xs text-slate-300 mb-1 flex items-center gap-1">
 <Trophy className="w-3.5 h-3.5 text-warning" />
 أفضل سهم متوقع
 </p>
 <p className="text-base font-bold text-foreground">
 {bestStock.symbol || '—'} ({bestStock.name || '—'})
 </p>
 <p className="text-2xl font-extrabold text-profit tabular-nums">
 {safeFmtPct(bestStock.change_percent, 2)}
 </p>
 </CardContent>
 </Card>
 )}
 {worstStock && (
 <Card className="border-loss/30 bg-loss/5">
 <CardContent className="p-4">
 <p className="text-xs text-slate-300 mb-1 flex items-center gap-1">
 <AlertTriangle className="w-3.5 h-3.5 text-loss" />
 أسوأ سهم متوقع (خسارة صريحة)
 </p>
 <p className="text-base font-bold text-foreground">
 {worstStock.symbol || '—'} ({worstStock.name || '—'})
 </p>
 <p className="text-2xl font-extrabold text-loss tabular-nums">
 {safeFmtPct(worstStock.change_percent, 2)}
 </p>
 </CardContent>
 </Card>
 )}
 </section>

 {/* Top 5 Successful Predictions */}
 {topPerformers.length > 0 && (
 <Card className="overflow-hidden border-profit/30 bg-[#0d1320] print:break-inside-avoid">
 <CardHeader className="pb-2">
 <CardTitle className="text-base font-bold flex items-center gap-2 text-profit">
 <TrendingUp className="w-5 h-5" />
 أعلى 5 توقعات ناجحة
 <span className="text-xs font-normal text-profit/70">
 Top 5 Successful Predictions
 </span>
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-2">
 {topPerformers.map((p, i) => {
 const change = Number(p.change_percent ?? 0);
 return (
 <div
 key={`p-${i}-${p.symbol ?? i}`}
 className="flex items-center gap-3 p-2.5 rounded-lg border border-profit/20 bg-profit/5"
 >
 <div className="flex items-center justify-center w-6 h-6 rounded-md bg-profit/20 text-xs font-bold text-profit">
 {i + 1}
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-bold text-foreground">{p.symbol || '—'}</p>
 <p className="text-xs text-slate-400 truncate">{p.name || ''}</p>
 </div>
 <span className="text-sm font-bold text-profit tabular-nums">
 <ArrowUpRight className="w-3.5 h-3.5 inline -mt-0.5" />{' '}
 {safeFmtPct(change, 2)}
 </span>
 </div>
 );
 })}
 </CardContent>
 </Card>
 )}

 {/* Honest Failure Display (Rule 67 — never hide losses) */}
 {worstStock && (
 <Card className="overflow-hidden border-loss/30 bg-[#0d1320] print:break-inside-avoid">
 <CardHeader className="pb-2">
 <CardTitle className="text-base font-bold flex items-center gap-2 text-loss">
 <TrendingDown className="w-5 h-5" />
 توقعات فشلت (عرض صريح للخسائر)
 <span className="text-xs font-normal text-loss/70">
 Failed Predictions — Honest
 </span>
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-2">
 <div className="flex items-center gap-3 p-2.5 rounded-lg border border-loss/20 bg-loss/5">
 <div className="flex items-center justify-center w-6 h-6 rounded-md bg-loss/20 text-xs font-bold text-loss">
 1
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-bold text-foreground">{worstStock.symbol || '—'}</p>
 <p className="text-xs text-slate-400 truncate">{worstStock.name || ''}</p>
 </div>
 <span className="text-sm font-bold text-loss tabular-nums">
 <ArrowDownRight className="w-3.5 h-3.5 inline -mt-0.5" />{' '}
 {safeFmtPct(worstStock.change_percent, 2)}
 </span>
 </div>
 <p className="text-xs text-slate-500 text-center mt-2">
 Rule 67: عرض الخسائر بصراحة — لا إخفاء للنتائج السلبية.
 </p>
 </CardContent>
 </Card>
 )}

 {/* Lessons + Watchlist (Python-generated text) */}
 {(lessons.length > 0 || watchlist.length > 0) && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {lessons.length > 0 && (
 <Card className="overflow-hidden border-warning/30 bg-[#0d1320]">
 <CardHeader className="pb-2">
 <CardTitle className="text-sm font-bold flex items-center gap-2 text-warning">
 <Sparkles className="w-4 h-4" />
 دروس للأسبوع القادم
 </CardTitle>
 </CardHeader>
 <CardContent>
 <ol className="space-y-2 list-decimal list-inside text-xs text-slate-200">
 {lessons.map((l, i) => (
 <li key={`lesson-${i}`}>{l}</li>
 ))}
 </ol>
 </CardContent>
 </Card>
 )}
 {watchlist.length > 0 && (
 <Card className="overflow-hidden border-profit/30 bg-[#0d1320]">
 <CardHeader className="pb-2">
 <CardTitle className="text-sm font-bold flex items-center gap-2 text-profit">
 <Shield className="w-4 h-4" />
 أسهم للمتابعة
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex flex-wrap gap-1.5">
 {watchlist.map((s, i) => (
 <Badge
 key={`wl-${i}`}
 variant="outline"
 className="text-xs border-profit/40 text-profit bg-profit/10"
 >
 {s}
 </Badge>
 ))}
 </div>
 </CardContent>
 </Card>
 )}
 </div>
 )}

 {/* AI Summary text (Python-generated) */}
 {report.content && (
 <Card className="overflow-hidden border-warning/30 bg-gradient-to-br from-[#0d1320] to-[#10162a]">
 <CardHeader className="pb-2">
 <CardTitle className="text-base font-bold flex items-center gap-2 text-warning">
 <Activity className="w-5 h-5" />
 الملخص الذكي لتوقعات الأسبوع
 <span className="text-xs font-normal text-warning/70">
 AI Summary · Python
 </span>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <pre
 className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200 font-sans bg-black/20 rounded-lg p-3 border border-slate-700/40"
 dir="rtl"
 >
{report.content}
 </pre>
 </CardContent>
 </Card>
 )}

 {/* Footer */}
 <div className="text-center pt-3 border-t border-slate-700/40 text-xs text-slate-500 print:pt-2">
 <p className="mb-0.5">تم إنشاء هذا التقرير بواسطة محرك التقارير (Python reports_engine)</p>
 <p className="text-xs">
 Rule 20: Node.js للعرض فقط — كل التحليل من Python · Rule 67: مصدر موحد للبيانات
 </p>
 </div>
 </div>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline — minimal SVG (no library). Rule 30 colors.
// ─────────────────────────────────────────────────────────────────────────────
function Sparkline({
 values,
 tone = 'positive',
}: {
 values: number[];
 tone?: 'positive' | 'negative' | 'neutral';
}) {
 if (values.length < 2) return null;
 const w = 100;
 const h = 28;
 const min = Math.min(...values);
 const max = Math.max(...values);
 const range = max - min || 1;
 const step = w / (values.length - 1);
 const points = values
 .map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / range) * h).toFixed(2)}`)
 .join(' ');
 const color = tone === 'positive' ? '#10b981' : tone === 'negative' ? '#ef4444' : '#f59e0b';
 return (
 <svg
 viewBox={`0 0 ${w} ${h}`}
 className="w-full h-7 mt-2"
 preserveAspectRatio="none"
 aria-hidden="true"
 >
 <polyline
 points={points}
 fill="none"
 stroke={color}
 strokeWidth="1.5"
 strokeLinecap="round"
 strokeLinejoin="round"
 />
 <circle
 cx={((values.length - 1) * step).toFixed(2)}
 cy={(h - ((values[values.length - 1] - min) / range) * h).toFixed(2)}
 r="2"
 fill={color}
 />
 </svg>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ReportsView
// ─────────────────────────────────────────────────────────────────────────────
export function ReportsView() {
 const t = useTranslation();
 return (
 <div className="min-h-screen flex flex-col bg-[#0a0e1a] text-slate-100">
 <header className="sticky top-0 z-30 bg-[#0a0e1a]/95 backdrop-blur-sm border-b border-slate-700/50 print:hidden">
 <div className="flex items-center gap-3 px-4 py-3">
 <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-warning to-profit flex items-center justify-center">
 <FileBarChart className="w-5 h-5 text-[#0a0e1a]" strokeWidth={2.5} />
 </div>
 <div className="min-w-0 mr-auto">
 <h1 className="text-lg font-extrabold text-warning flex items-center gap-2">
 {t('reports.view.title')}
 </h1>
 <p className="text-xs text-slate-400">
 Professional Financial Reports · Python Brain · Rule 67 Unified Source
 </p>
 <p className="text-xs text-warning/60 italic mt-0.5">
 {t('reports.view.disclaimer')}
 </p>
 </div>
 </div>
 </header>

 <main className="flex-1 print:p-0">
 <div className="p-4 md:p-6">
 <Tabs defaultValue="daily" dir="rtl" className="w-full">
 <TabsList className="mb-6 w-full flex h-auto flex-wrap gap-1 bg-[#0d1320] border border-slate-700/40 p-1 rounded-xl print:hidden">
 <TabsTrigger
 value="daily"
 className="flex items-center gap-1.5 text-xs sm:text-sm flex-1 min-w-[100px] data-[state=active]:bg-warning data-[state=active]:text-[#0a0e1a] rounded-lg py-2 font-bold"
 >
 <BarChart3 className="w-3.5 h-3.5" />
 التقرير اليومي
 </TabsTrigger>
 <TabsTrigger
 value="stock"
 className="flex items-center gap-1.5 text-xs sm:text-sm flex-1 min-w-[100px] data-[state=active]:bg-warning data-[state=active]:text-[#0a0e1a] rounded-lg py-2 font-bold"
 >
 <Activity className="w-3.5 h-3.5" />
 تقرير السهم
 </TabsTrigger>
 <TabsTrigger
 value="sector"
 className="flex items-center gap-1.5 text-xs sm:text-sm flex-1 min-w-[100px] data-[state=active]:bg-warning data-[state=active]:text-[#0a0e1a] rounded-lg py-2 font-bold"
 >
 <Layers className="w-3.5 h-3.5" />
 تقرير القطاعات
 </TabsTrigger>
 <TabsTrigger
 value="predictions"
 className="flex items-center gap-1.5 text-xs sm:text-sm flex-1 min-w-[100px] data-[state=active]:bg-warning data-[state=active]:text-[#0a0e1a] rounded-lg py-2 font-bold"
 >
 <Shield className="w-3.5 h-3.5" />
 تقرير التوقعات
 </TabsTrigger>
 </TabsList>

 <TabsContent value="daily">
 <DailyMarketReport />
 </TabsContent>

 <TabsContent value="stock">
 <StockAnalysisReport />
 </TabsContent>

 <TabsContent value="sector">
 <SectorReport />
 </TabsContent>

 <TabsContent value="predictions">
 <PredictionsReport />
 </TabsContent>
 </Tabs>
 </div>
 </main>
 </div>
 );
}

/**
 * End of ReportsView — see header comment for Rule 67/68 verification.
 */

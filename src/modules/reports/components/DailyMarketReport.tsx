'use client';

/**
 * DailyMarketReport — التقرير اليومي للسوق (Task 42 redesign)
 * =========================================================================
 *
 * Owner directive:
 *   "المرحلة الى بعدها الشاشة دى http://localhost:3000/#reports محتاجة رفع
 *    كفائة بلذات لما بتعمل التقارير بلطبعة او PDF لازم الشاشات الى فيها
 *    تكون احترافية وتقارير مالية محترفة جدا وبمظهر ممتاز."
 *
 * Rule 67 root cause (fix):
 *   Before: fetched from apiClient.getMarketOverview() + apiClient.getAiInsights()
 *   (2 different endpoints, often returning conflicting market data).
 *   Now: ONE source — /api/reports/proxy?type=daily → Python reports_routes.py
 *   (generate_daily_summary). Node.js is display-only (Rule 20 — Python=Brain).
 *
 * Professional design (Bloomberg / Reuters style):
 *   - Dark navy background (#0a0e1a) for screen + print
 *   - Emerald for gains, red for losses, amber for warnings, gold for highlights
 *   - RTL Arabic throughout
 *   - KPI tiles for market summary (advancers/decliners/unchanged/volume)
 *   - Top 5 gainers + Top 5 losers (with sparkline-like change bars)
 *   - Sector heatmap (color-coded)
 *   - AI summary text (from Python — never fabricated in Node)
 *   - Export as PNG (html-to-image, 2x retina) + Print (window.print → PDF)
 *
 * Rule 67 honesty:
 *   When Python is offline (proxy returns 502/504), we render a typed
 *   "skipped" state showing the reason — never fake numbers.
 *
 * Phase 3 export:
 *   - PNG: exportReportToPng() → html-to-image.toPng (retina 2x)
 *   - PDF: triggerPrint() → window.print() with print stylesheet
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Download,
  Printer,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Minus,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  fetchDailyReport,
  exportReportToPng,
  triggerPrint,
  safeFmtNum,
  safeFmtPct,
  safeFmtArDate,
  type DailyReportPayload,
  type ReportStockMini,
} from '../lib/proxy-client';

interface DailyMarketReportProps {
  printMode?: boolean;
}

/* ========== Loading Skeleton ========== */
function ReportSkeleton() {
  return (
    <div className="space-y-6" dir="rtl">
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

/* ========== Professional Report Header (Bloomberg-style) ========== */
function ReportHeader({
  title,
  subtitle,
  dateStr,
  market = 'EGX',
}: {
  title: string;
  subtitle: string;
  dateStr: string;
  market?: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-l from-[#0a0e1a] via-[#0d1320] to-[#10162a] p-5 print:border-amber-500/40"
      dir="rtl"
    >
      {/* Top gold accent line */}
      <div className="absolute top-0 right-0 left-0 h-[3px] bg-gradient-to-l from-amber-500 via-amber-400 to-amber-500" />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 via-amber-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <BarChart3 className="w-7 h-7 text-[#0a0e1a]" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              دليل الاستثمار
            </h1>
            <p className="text-[11px] text-amber-300/80 tracking-wide uppercase">
              Egyptian Investment Platform · Professional Reports
            </p>
          </div>
        </div>
        <div className="text-left">
          <h2 className="text-base sm:text-lg font-bold text-amber-300">{title}</h2>
          <p className="text-xs text-slate-300/90">{subtitle}</p>
          <div className="flex items-center justify-end gap-2 mt-1">
            <Badge
              variant="outline"
              className="text-[10px] font-bold border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
            >
              {market} · LIVE
            </Badge>
            <span className="text-[11px] text-slate-400">{dateStr}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========== KPI Tile ========== */
function KpiTile({
  label,
  value,
  icon,
  tone = 'neutral',
  subtext,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: 'positive' | 'negative' | 'warning' | 'neutral' | 'gold';
  subtext?: string;
}) {
  const toneClasses: Record<string, string> = {
    positive: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    negative: 'border-red-500/30 bg-red-500/10 text-red-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    gold: 'border-amber-400/40 bg-gradient-to-br from-amber-500/15 to-amber-400/5 text-amber-200',
    neutral: 'border-slate-500/30 bg-slate-500/10 text-slate-200',
  };
  return (
    <div
      className={cn(
        'rounded-xl border p-3.5 transition-colors print:break-inside-avoid',
        toneClasses[tone],
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-slate-300">{label}</span>
        <span className="opacity-70">{icon}</span>
      </div>
      <p className="text-2xl font-extrabold tabular-nums tracking-tight">{value}</p>
      {subtext && (
        <p className="text-[10px] text-slate-400 mt-0.5">{subtext}</p>
      )}
    </div>
  );
}

/* ========== Stock Mini Card (Top Gainer / Loser) ========== */
function StockMiniCard({
  rank,
  stock,
  kind,
}: {
  rank: number;
  stock: ReportStockMini;
  kind: 'gainer' | 'loser';
}) {
  const isGainer = kind === 'gainer';
  const change = Number(stock.change_percent ?? 0);
  const symbol = String(stock.symbol || stock.name || '—');
  const name = String(stock.name_ar || stock.name || symbol);
  const price = Number(stock.current_price ?? 0);
  const barWidth = Math.min(Math.abs(change) * 4, 100);
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl border print:break-inside-avoid',
        isGainer
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : 'border-red-500/20 bg-red-500/5',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold tabular-nums shrink-0',
          isGainer
            ? 'bg-emerald-500/20 text-emerald-300'
            : 'bg-red-500/20 text-red-300',
        )}
      >
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-bold text-white truncate">{symbol}</p>
          <span className="text-[10px] text-slate-400 truncate">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-slate-700/60 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full',
                isGainer ? 'bg-emerald-500' : 'bg-red-500',
              )}
              style={{ width: `${Math.max(barWidth, 5)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 tabular-nums">
            {safeFmtNum(price, 2, '')}
          </span>
        </div>
      </div>
      <div
        className={cn(
          'flex items-center gap-1 text-sm font-bold tabular-nums',
          isGainer ? 'text-emerald-400' : 'text-red-400',
        )}
      >
        {isGainer ? (
          <ArrowUpRight className="w-3.5 h-3.5" />
        ) : (
          <ArrowDownRight className="w-3.5 h-3.5" />
        )}
        {safeFmtPct(change, 2)}
      </div>
    </div>
  );
}

/* ========== Sector Heatmap Cell ========== */
interface SectorRow {
  name?: string;
  avg_change_percent?: number;
  count?: number;
}

function extractSectors(payload: DailyReportPayload): SectorRow[] {
  const raw = (payload as unknown as { sectors?: SectorRow[] }).sectors;
  if (Array.isArray(raw)) return raw;
  // Python daily_summary doesn't always include sectors; try
  // the top_performers shape or fall back to empty.
  return [];
}

function SectorHeatmap({ sectors }: { sectors: SectorRow[] }) {
  if (sectors.length === 0) {
    return (
      <div className="text-center text-xs text-slate-500 py-6">
        بيانات القطاعات متاحة في التقرير الأسبوعي والشهري
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {sectors.map((s, i) => {
        const change = Number(s.avg_change_percent ?? 0);
        const intensity = Math.min(Math.abs(change) / 5, 1);
        const bg = change >= 0
          ? `rgba(16, 185, 129, ${0.15 + intensity * 0.45})`
          : `rgba(239, 68, 68, ${0.15 + intensity * 0.45})`;
        const border = change >= 0 ? 'border-emerald-500/40' : 'border-red-500/40';
        return (
          <div
            key={`${s.name ?? 'sector'}-${i}`}
            className={cn(
              'rounded-lg border p-2.5 print:break-inside-avoid',
              border,
            )}
            style={{ backgroundColor: bg }}
          >
            <p className="text-xs font-semibold text-white truncate">
              {s.name || '—'}
            </p>
            <p className="text-[10px] text-slate-200 mb-1">
              {s.count ?? 0} سهم
            </p>
            <p
              className={cn(
                'text-sm font-bold tabular-nums',
                change >= 0 ? 'text-emerald-100' : 'text-red-100',
              )}
            >
              {safeFmtPct(change, 2)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ========== Offline / Skipped State ========== */
function OfflineState({ reason }: { reason: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      dir="rtl"
    >
      <AlertTriangle className="w-12 h-12 mb-3 text-amber-400" />
      <p className="text-base font-bold text-amber-300 mb-1">
        تعذّر تحميل التقرير اليومي
      </p>
      <p className="text-xs text-slate-400 max-w-md">{reason}</p>
      <p className="text-[11px] text-slate-500 mt-3 max-w-md">
        محرك التقارير (Python) هو المسؤول عن توليد كل التقارير —
        Node.js للعرض فقط. أعد المحاولة بعد التأكد من تشغيل محرك التقارير.
      </p>
    </div>
  );
}

/* ========== Main Component ========== */
export function DailyMarketReport({ printMode = false }: DailyMarketReportProps) {
  const [report, setReport] = useState<DailyReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingPng, setExportingPng] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDailyReport({ market: 'EGX' });
      setReport(data);
    } catch {
      setReport({
        success: false,
        skipped: true,
        reason: 'حدث خطأ غير متوقع أثناء الاتصال بمحرك التقارير',
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
        filename: `daily_market_report_${new Date().toISOString().split('T')[0]}`,
        pixelRatio: 2,
        backgroundColor: '#0a0e1a',
      });
      toast.success('تم تصدير صورة التقرير (دقة عالية)');
    } catch (err) {
      console.error('[DailyReport] PNG export error:', err);
      toast.error('فشل تصدير الصورة — حاول مرة أخرى');
    } finally {
      setExportingPng(false);
    }
  };

  const handlePrint = () => {
    triggerPrint();
  };

  if (loading) return <ReportSkeleton />;

  if (!report || report.skipped || report.success === false) {
    return (
      <OfflineState reason={report?.reason ?? 'محرك التقارير غير متاح'} />
    );
  }

  const summary = report.summary ?? {};
  const gainers = (report.top_gainers ?? []).slice(0, 5);
  const losers = (report.top_losers ?? []).slice(0, 5);
  const sectors = extractSectors(report);
  const goldPrice = report.gold?.price_21;
  const usdRate = report.usd_rate;
  const totalStocks = Number(summary.total_stocks ?? 0);
  const advancers = Number(summary.gainers ?? 0);
  const decliners = Number(summary.losers ?? 0);
  const unchanged = Number(summary.unchanged ?? 0);
  const breadth = Number(summary.market_breadth ?? 0);
  const dateStr = safeFmtArDate(new Date().toISOString());

  return (
    <div
      id="daily-market-report-content"
      ref={reportRef}
      className="space-y-5 print:space-y-3 bg-[#0a0e1a] print:bg-white p-4 sm:p-5 rounded-2xl border border-slate-700/50 print:border-0"
      dir="rtl"
    >
      {/* Header */}
      <ReportHeader
        title="التقرير اليومي للسوق"
        subtitle="Daily Market Summary — EGX"
        dateStr={dateStr}
      />

      {/* Legal Disclaimer */}
      <p className="text-[10px] text-amber-300/70 italic text-center leading-relaxed print:mb-2">
        ⚠️ إخلاء مسؤولية: المنصة تقدم رأيًا شخصيًا آليًا لأغراض تعليمية
        وتحليلية فقط، وليست نصيحة استثمارية مرخصة. القرار مسؤولية العميل
        وحده. لا ضمان للنتائج. استشر مستشارًا ماليًا مرخصًا.
      </p>

      {/* Export Toolbar — hidden in print */}
      {!printMode && (
        <div className="flex justify-end gap-2 print:hidden flex-wrap">
          <Button
            onClick={handleExportPng}
            disabled={exportingPng}
            variant="outline"
            className="gap-2 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
          >
            <Download className="w-4 h-4" />
            {exportingPng ? 'جارٍ التصدير...' : 'تصدير صورة (PNG)'}
          </Button>
          <Button
            onClick={handlePrint}
            variant="outline"
            className="gap-2 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
          >
            <Printer className="w-4 h-4" />
            طباعة / PDF
          </Button>
        </div>
      )}

      {/* Market Summary KPIs */}
      <section aria-label="ملخص السوق">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wide">
            ملخص السوق · Market Summary
          </h3>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile
            label="إجمالي الأسهم"
            value={safeFmtNum(totalStocks, 0)}
            subtext="إجمالي الأسهم المتداولة"
            icon={<BarChart3 className="w-4 h-4" />}
            tone="gold"
          />
          <KpiTile
            label="المرتفعة"
            value={safeFmtNum(advancers, 0)}
            subtext={`${
              totalStocks > 0 ? ((advancers / totalStocks) * 100).toFixed(1) : 0
            }% من السوق`}
            icon={<TrendingUp className="w-4 h-4" />}
            tone="positive"
          />
          <KpiTile
            label="المنخفضة"
            value={safeFmtNum(decliners, 0)}
            subtext={`${
              totalStocks > 0 ? ((decliners / totalStocks) * 100).toFixed(1) : 0
            }% من السوق`}
            icon={<TrendingDown className="w-4 h-4" />}
            tone="negative"
          />
          <KpiTile
            label="بدون تغيير"
            value={safeFmtNum(unchanged, 0)}
            subtext={`${
              totalStocks > 0 ? ((unchanged / totalStocks) * 100).toFixed(1) : 0
            }% من السوق`}
            icon={<Minus className="w-4 h-4" />}
            tone="warning"
          />
        </div>

        {/* Breadth + macro rates row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-[11px] text-slate-300 mb-1">اتساع السوق</p>
            <p className="text-lg font-bold text-emerald-300 tabular-nums">
              {safeFmtNum(breadth, 2, '%')}
            </p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-[11px] text-slate-300 mb-1">ذهب عيار 21</p>
            <p className="text-lg font-bold text-amber-300 tabular-nums">
              {safeFmtNum(goldPrice, 0, ' ج.م')}
            </p>
          </div>
          <div className="rounded-xl border border-slate-500/20 bg-slate-500/5 p-3">
            <p className="text-[11px] text-slate-300 mb-1">الدولار الأمريكي</p>
            <p className="text-lg font-bold text-slate-200 tabular-nums">
              {safeFmtNum(usdRate, 2, ' ج.م')}
            </p>
          </div>
        </div>
      </section>

      {/* Top Gainers + Top Losers */}
      <section aria-label="أكثر الأسهم تحركاً">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Gainers */}
          <Card className="overflow-hidden border-emerald-500/30 bg-[#0d1320]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-emerald-400">
                <TrendingUp className="w-5 h-5" />
                أكثر الأسهم ارتفاعاً
                <span className="text-[10px] font-normal text-emerald-300/70">
                  Top 5 Gainers
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {gainers.length > 0 ? (
                gainers.map((s, i) => (
                  <StockMiniCard
                    key={`g-${i}-${s.symbol ?? i}`}
                    rank={i + 1}
                    stock={s}
                    kind="gainer"
                  />
                ))
              ) : (
                <p className="text-xs text-slate-500 text-center py-4">
                  لا توجد بيانات للصاعدات في هذا التقرير
                </p>
              )}
            </CardContent>
          </Card>

          {/* Losers */}
          <Card className="overflow-hidden border-red-500/30 bg-[#0d1320]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-red-400">
                <TrendingDown className="w-5 h-5" />
                أكثر الأسهم انخفاضاً
                <span className="text-[10px] font-normal text-red-300/70">
                  Top 5 Losers
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {losers.length > 0 ? (
                losers.map((s, i) => (
                  <StockMiniCard
                    key={`l-${i}-${s.symbol ?? i}`}
                    rank={i + 1}
                    stock={s}
                    kind="loser"
                  />
                ))
              ) : (
                <p className="text-xs text-slate-500 text-center py-4">
                  لا توجد بيانات للهابطات في هذا التقرير
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Sector Heatmap */}
      <section aria-label="خريطة القطاعات">
        <Card className="overflow-hidden border-slate-700/50 bg-[#0d1320]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-300">
              <Layers className="w-5 h-5" />
              خريطة أداء القطاعات
              <span className="text-[10px] font-normal text-slate-400">
                Sector Heatmap
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SectorHeatmap sectors={sectors} />
          </CardContent>
        </Card>
      </section>

      {/* AI Summary (Python-generated text) */}
      {report.content && (
        <section aria-label="الملخص الذكي">
          <Card className="overflow-hidden border-amber-500/30 bg-gradient-to-br from-[#0d1320] to-[#10162a]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-300">
                <Activity className="w-5 h-5" />
                الملخص الذكي للسوق
                <span className="text-[10px] font-normal text-amber-300/70">
                  AI Summary · generated by Python
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
        </section>
      )}

      {/* Footer */}
      <div className="text-center pt-3 border-t border-slate-700/40 text-[11px] text-slate-500 print:pt-2">
        <p className="mb-0.5">تم إنشاء هذا التقرير تلقائياً بواسطة محرك التقارير (Python reports_engine)</p>
        <p className="text-[10px]">
          Rule 20: Node.js للعرض فقط — كل التحليل من Python · Rule 67: مصدر موحد للمبيانات
        </p>
      </div>
    </div>
  );
}


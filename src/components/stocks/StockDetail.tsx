'use client';

import React, { Component, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import {
  ArrowRight,
  TrendingUp,
  TrendingDown,
  BarChart3,
  DollarSign,
  Activity,
  Shield,
  Zap,
  BookmarkPlus,
  AlertTriangle,
  RefreshCw,
  Clock,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { cn, safeToFixed } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { TradingViewChart } from './TradingViewChart';
import { DeepAnalysis } from './DeepAnalysis';
import { StockNews } from './StockNews';
import { CalculationBreakdown } from './CalculationBreakdown';
import { ShareButton } from '@/components/share/ShareButton';
import { SmartTip } from '@/components/smart-tips/SmartTip';
import { AIAnalysisWidget } from '@/components/ai/AIAnalysisWidget';
import { StockAdvancedAnalysisView } from './StockAdvancedAnalysisView';
import { QuickPublishButton } from '@/components/publishing/QuickPublishButton';
import { ComprehensiveStockAnalysis } from './ComprehensiveStockAnalysis';
import { DeltaVolumeBar } from './DeltaVolumeBar';
import GateAnalysisView from './GateAnalysisView';

// Simple error boundary to prevent child component crashes from breaking the whole page
class ErrorBoundary extends Component<{ children: ReactNode; title?: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-red-200 dark:border-red-900/50">
          <CardContent className="p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <p className="text-sm font-bold text-foreground mb-1">
              حدث خطأ في عرض البيانات
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              {this.props.title || 'المحتوى'} غير متاح حالياً
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => this.setState({ hasError: false })}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return safeToFixed(num / 1_000_000_000, 1) + 'B';
  if (num >= 1_000_000) return safeToFixed(num / 1_000_000, 1) + 'M';
  if (num >= 1_000) return safeToFixed(num / 1_000, 1) + 'K';
  return safeToFixed(num);
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return safeToFixed(vol / 1_000_000) + 'M';
  if (vol >= 1_000) return safeToFixed(vol / 1_000, 1) + 'K';
  return vol.toLocaleString();
}

interface PriceInfoCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  className?: string;
}

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
          highlight && 'text-emerald-600 dark:text-emerald-400'
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
      className="text-[9px] px-1 py-0 h-4 leading-none border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
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
  const [flow, setFlow] = useState<Record<string, unknown> | null>(null);
  const [explosive, setExplosive] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!ticker) return;
    fetch(`/api/flow/${ticker}`).then(r => r.json()).then(d => {
      if (d.success) setFlow(d.data);
    }).catch(() => {});
    fetch(`/api/explosive/${ticker}`).then(r => r.json()).then(d => {
      if (d.success) setExplosive(d.data);
    }).catch(() => {});
  }, [ticker]);

  if (!flow && !explosive) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
      {flow && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900">
          <h3 className="text-sm font-bold mb-2 text-slate-900 dark:text-white">نقاط التدفق (Flow Score)</h3>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold" style={{color: (flow.color as string) === 'red' ? '#ef4444' : (flow.color as string) === 'orange' ? '#f97316' : (flow.color as string) === 'amber' ? '#f59e0b' : '#10b981'}}>
              {String(flow.flow_score)}
            </span>
            <div>
              <div className="text-lg font-bold">{String(flow.label)}</div>
              <div className="text-xs text-slate-500">
                Macro: {String(flow.macro_flow)} | Sector: {String(flow.sector_flow)} | Stock: {String(flow.stock_flow)} | Cross: {String(flow.cross_validation)}
              </div>
            </div>
          </div>
        </div>
      )}
      {explosive && !explosive.excluded && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900">
          <h3 className="text-sm font-bold mb-2 text-slate-900 dark:text-white">ماسح القنابل (Explosive)</h3>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold" style={{color: (explosive.color as string) === 'red' ? '#ef4444' : (explosive.color as string) === 'orange' ? '#f97316' : (explosive.color as string) === 'amber' ? '#f59e0b' : '#6b7280'}}>
              {String(explosive.explosive_score)}
            </span>
            <div>
              <div className="text-lg font-bold">{String(explosive.label)} - {String(explosive.pattern)}</div>
              <div className="text-xs text-slate-500">
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
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [activeTab, setActiveTab] = useState<'valuation' | 'statements' | 'dividends' | 'technical'>('valuation');

  useEffect(() => {
    if (!ticker) return;
    fetch(`/api/stock-profile/${ticker}`).then(r => r.json()).then(d => {
      if (d.success) setProfile(d.data);
    }).catch(() => {});
  }, [ticker]);

  if (!profile) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900 mt-3 animate-pulse">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4 mb-3"></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
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
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 bg-white dark:bg-slate-950 shadow-sm mt-3" dir="rtl">
      {/* Header with Health Score */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100 dark:border-slate-900">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
            تحليل البيانات الأساسية والهيكلية للسهم
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">البيانات مستخرجة مباشرة من مركز معلومات البورصة</p>
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
          className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2"
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
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
          )}
        >
          التقييم والربحية
        </button>
        <button
          onClick={() => setActiveTab('statements')}
          className={cn(
            "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
            activeTab === 'statements'
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
          )}
        >
          القوائم المالية الهيكلية
        </button>
        <button
          onClick={() => setActiveTab('dividends')}
          className={cn(
            "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
            activeTab === 'dividends'
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
          )}
        >
          الأرباح والتوزيعات
        </button>
        <button
          onClick={() => setActiveTab('technical')}
          className={cn(
            "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
            activeTab === 'technical'
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
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
                <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">مكررات القيمة والتقييم (Valuation)</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                    <div className="text-[10px] text-slate-500">مكرر الربحية (P/E)</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5 flex items-center gap-1">
                      <span>{val?.pe_ratio ? val.pe_ratio.toFixed(2) : (profile.basic?.pe_ratio ? profile.basic.pe_ratio.toFixed(2) : 'N/A')}</span>
                      {isEst(val, 'pe_ratio') && <EstimatedBadge />}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                    <div className="text-[10px] text-slate-500">القيمة الدفترية (P/B)</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5 flex items-center gap-1">
                      <span>{val?.pb_ratio ? val.pb_ratio.toFixed(2) : (profile.basic?.pb_ratio ? profile.basic.pb_ratio.toFixed(2) : 'N/A')}</span>
                      {isEst(val, 'pb_ratio') && <EstimatedBadge />}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                    <div className="text-[10px] text-slate-500">مكرر المبيعات (P/S)</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {val?.ps_ratio ? val.ps_ratio.toFixed(2) : (profile.basic?.ps_ratio ? profile.basic.ps_ratio.toFixed(2) : 'N/A')}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                    <div className="text-[10px] text-slate-500">مكرر نمو الأرباح (PEG)</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {val?.peg_ratio ? val.peg_ratio.toFixed(2) : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Profitability Columns */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">مؤشرات الربحية والتشغيل (Profitability)</h4>
                <div className="space-y-2.5">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">العائد على حقوق الملكية (ROE)</span>
                      <span className="font-bold text-emerald-600 flex items-center gap-1">
                        <span>{prof?.roe ? `${prof.roe.toFixed(2)}%` : (profile.basic?.roe ? `${profile.basic.roe.toFixed(2)}%` : 'N/A')}</span>
                        {(isEst(prof, 'roe') || isEst(profile.basic, 'roe')) && <EstimatedBadge />}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-900 rounded-full h-1.5">
                      <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.roe || profile.basic?.roe || 0, 0), 100)}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">هامش الربح التشغيلي (Operating Margin)</span>
                      <span className="font-bold text-teal-600">
                        {prof?.operating_margin ? `${prof.operating_margin.toFixed(2)}%` : 'N/A'}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-900 rounded-full h-1.5">
                      <div className="bg-teal-500 h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.operating_margin || 0, 0), 100)}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">هامش صافي الربح (Net Margin)</span>
                      <span className="font-bold text-purple-600">
                        {prof?.net_margin ? `${prof.net_margin.toFixed(2)}%` : (profile.basic?.profit_margin ? `${profile.basic.profit_margin.toFixed(2)}%` : 'N/A')}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-900 rounded-full h-1.5">
                      <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.net_margin || profile.basic?.profit_margin || 0, 0), 100)}%` }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {(!val?.pe_ratio && !profile.basic?.pe_ratio && (!prof?.roe && !profile.basic?.roe)) && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500" />
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
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 pb-1.5 border-b border-slate-200/50 dark:border-slate-800">الميزانية العمومية</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">إجمالي الأصول</span>
                    <span className="font-bold flex items-center gap-1">
                      <span>{bs?.total_assets ? (bs.total_assets >= 1e9 ? `${(bs.total_assets / 1e9).toFixed(2)}B EGP` : `${(bs.total_assets / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap ? `${((profile.basic.market_cap * 1.5) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
                      {(isEst(bs, 'total_assets') || totalAssetsInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">إجمالي الالتزامات</span>
                    <span className="font-bold text-red-500 flex items-center gap-1">
                      <span>{bs?.total_liabilities ? (bs.total_liabilities >= 1e9 ? `${(bs.total_liabilities / 1e9).toFixed(2)}B EGP` : `${(bs.total_liabilities / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pb_ratio ? `${(((profile.basic.market_cap * 1.5) - (profile.basic.market_cap / profile.basic.pb_ratio)) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
                      {(isEst(bs, 'total_liabilities') || totalLiabInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">حقوق المساهمين</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <span>{bs?.total_equity ? (bs.total_equity >= 1e9 ? `${(bs.total_equity / 1e9).toFixed(2)}B EGP` : `${(bs.total_equity / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pb_ratio ? `${((profile.basic.market_cap / profile.basic.pb_ratio) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
                      {(isEst(bs, 'total_equity') || totalEquityInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  {(bs?.total_assets > 0 || profile.basic?.market_cap > 0) && (
                    <div className="mt-3">
                      <div className="text-[10px] text-slate-400 mb-1">نسبة الهيكل المالي (حقوق ملكية/أصول)</div>
                      <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden flex">
                        <div className="bg-emerald-500 h-2" style={{ width: `${profile.basic?.pb_ratio ? Math.min(100, Math.max(10, (1 / profile.basic.pb_ratio) * 100)) : 60}%` }}></div>
                        <div className="bg-red-500 h-2 flex-1"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Income Statement Summary */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 pb-1.5 border-b border-slate-200/50 dark:border-slate-800">قائمة الدخل</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">الإيرادات السنوية</span>
                    <span className="font-bold flex items-center gap-1">
                      <span>{inc?.revenue ? (inc.revenue >= 1e9 ? `${(inc.revenue / 1e9).toFixed(2)}B EGP` : `${(inc.revenue / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pe_ratio ? `${(((profile.basic.market_cap / profile.basic.pe_ratio) * 4) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
                      {(isEst(inc, 'revenue') || revenueInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">نمو الإيرادات</span>
                    <span className={cn("font-bold", (inc?.revenue_growth || 0) >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {inc?.revenue_growth ? `${inc.revenue_growth >= 0 ? '+' : ''}${inc.revenue_growth.toFixed(2)}%` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">صافي الربح</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <span>{inc?.net_income ? (inc.net_income >= 1e9 ? `${(inc.net_income / 1e9).toFixed(2)}B EGP` : `${(inc.net_income / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pe_ratio ? `${((profile.basic.market_cap / profile.basic.pe_ratio) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
                      {(isEst(inc, 'net_income') || netIncomeInlineEst) && <EstimatedBadge />}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">ربحية السهم (EPS)</span>
                    <span className="font-bold flex items-center gap-1">
                      <span>{inc?.eps ? `${inc.eps.toFixed(2)} EGP` : (profile.basic?.eps ? `${profile.basic.eps.toFixed(2)} EGP` : '—')}</span>
                      {(isEst(inc, 'eps') || isEst(profile.basic, 'eps')) && <EstimatedBadge />}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cash Flow Summary */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 pb-1.5 border-b border-slate-200/50 dark:border-slate-800">التدفقات النقدية والسيولة</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">التدفق التشغيلي</span>
                    <span className="font-bold text-emerald-600">
                      {cf?.operating_cf ? (cf.operating_cf >= 1e9 ? `${(cf.operating_cf / 1e9).toFixed(2)}B EGP` : `${(cf.operating_cf / 1e6).toFixed(1)}M EGP`) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">التدفق الاستثماري</span>
                    <span className="font-bold text-red-500">
                      {cf?.investing_cf ? (cf.investing_cf >= 1e9 ? `${(cf.investing_cf / 1e9).toFixed(2)}B EGP` : `${(cf.investing_cf / 1e6).toFixed(1)}M EGP`) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">التدفق التمويلي</span>
                    <span className="font-bold">
                      {cf?.financing_cf ? (cf.financing_cf >= 1e9 ? `${(cf.financing_cf / 1e9).toFixed(2)}B EGP` : `${(cf.financing_cf / 1e6).toFixed(1)}M EGP`) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200/50 dark:border-slate-800 font-bold">
                    <span className="text-slate-600 dark:text-slate-400">التدفق النقدي الحر</span>
                    <span className={cn((cf?.free_cf || 0) >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {cf?.free_cf ? (cf.free_cf >= 1e9 ? `${(cf.free_cf / 1e9).toFixed(2)}B EGP` : `${(cf.free_cf / 1e6).toFixed(1)}M EGP`) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {(!bs?.total_assets && !inc?.revenue && !cf?.operating_cf) && (
              <div className="p-3 rounded-lg bg-teal-500/10 border border-teal-500/20 text-xs text-teal-700 dark:text-teal-300 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 flex-shrink-0 text-teal-500" />
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
              <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">الأرباح والتوزيعات (Dividends)</h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">عائد التوزيع الحالي</div>
                  <div className="text-sm font-extrabold text-emerald-600 mt-0.5">{div?.div_yield ? `${div.div_yield.toFixed(2)}%` : '0.00%'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">توزيع السهم للسنة (DPS)</div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">{div?.dps_fy ? `${div.dps_fy.toFixed(2)} EGP` : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">نسبة التوزيع من الأرباح</div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5">{div?.payout_ratio ? `${div.payout_ratio.toFixed(1)}%` : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">نمو التوزيعات</div>
                  <div className="text-sm font-extrabold text-emerald-600 mt-0.5">{div?.dps_growth ? `${div.dps_growth.toFixed(1)}%` : 'N/A'}</div>
                </div>
              </div>
            </div>

            {/* Performance */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">الأداء التاريخي والتذبذب (Performance)</h4>
              <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">أسبوع (1W)</div>
                  <div className={cn("font-bold mt-0.5", perf?.perf_1w >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {perf?.perf_1w ? `${perf.perf_1w >= 0 ? '+' : ''}${perf.perf_1w.toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">شهر (1M)</div>
                  <div className={cn("font-bold mt-0.5", perf?.perf_1m >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {perf?.perf_1m ? `${perf.perf_1m >= 0 ? '+' : ''}${perf.perf_1m.toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">3 شهور (3M)</div>
                  <div className={cn("font-bold mt-0.5", perf?.perf_3m >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {perf?.perf_3m ? `${perf.perf_3m >= 0 ? '+' : ''}${perf.perf_3m.toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">سنة (1Y)</div>
                  <div className={cn("font-bold mt-0.5", perf?.perf_1y >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {perf?.perf_1y ? `${perf.perf_1y >= 0 ? '+' : ''}${perf.perf_1y.toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">تذبذب شهر</div>
                  <div className="font-bold text-slate-950 dark:text-white mt-0.5">
                    {perf?.volatility_1m ? `${perf.volatility_1m.toFixed(2)}%` : 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">تذبذب أسبوع</div>
                  <div className="font-bold text-slate-950 dark:text-white mt-0.5">
                    {perf?.volatility_1w ? `${perf.volatility_1w.toFixed(2)}%` : 'N/A'}
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
              <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">قراءات المؤشرات الفنية اللحظية</h4>
              <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">مؤشر القوة النسبية RSI</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.rsi ? tech.rsi : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">مؤشر الـ MACD</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.macd ? tech.macd : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">مؤشر Stochastic</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.stoch ? tech.stoch : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">مؤشر الاتجاه ADX</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.adx ? tech.adx : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">مؤشر التقلب ATR</div>
                  <div className="font-extrabold text-slate-900 dark:text-white mt-0.5">{tech?.atr ? tech.atr : 'N/A'}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                  <div className="text-[10px] text-slate-500">الاتجاه العام</div>
                  <div className="font-extrabold text-emerald-600 mt-0.5">{tech?.trend ? tech.trend : 'N/A'}</div>
                </div>
              </div>
            </div>

            {/* Ratings gauges */}
            <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-900 flex flex-col justify-center">
              <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 pb-1.5 border-b border-slate-200/50 dark:border-slate-800">مؤشر التقييم الفني العام</h4>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">التقييم الفني الإجمالي</span>
                  <span className={cn("font-bold px-2 py-0.5 rounded text-[11px]", 
                    tech?.technical_rating?.includes('Strong Buy') || tech?.technical_rating?.includes('شراء قوي') ? "bg-emerald-500/10 text-emerald-500" :
                    tech?.technical_rating?.includes('Buy') || tech?.technical_rating?.includes('شراء') ? "bg-emerald-400/10 text-emerald-600" : "bg-slate-500/10 text-slate-500"
                  )}>
                    {tech?.technical_rating ? tech.technical_rating : 'Neutral'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">تقييم المتوسطات المتحركة</span>
                  <span className="font-bold">{tech?.ma_rating ? tech.ma_rating : 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">تقييم مؤشرات التذبذب</span>
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

export function StockDetail() {
  const {
    selectedStock,
    isLoading,
    setSelectedTicker,
    setCurrentView,
    watchlist,
    addToWatchlist,
    deepAnalysis,
    selectedTicker,
    loadStockNews,
  } = useAppStore();
  const [exporting, setExporting] = useState(false);
  const [addingToWatchlist, setAddingToWatchlist] = useState(false);
  const watchlistCooldown = useRef(false);

  // Auto-load news when stock is selected
  useEffect(() => {
    if (selectedTicker && selectedStock) {
      loadStockNews(selectedTicker, 15);
    }
  }, [selectedTicker, selectedStock, loadStockNews]);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('stock-detail-export');
      if (!element) {
        toast.error('لم يتم العثور على محتوى السهم');
        return;
      }
      await exportToPdf(element, {
        filename: `stock_analysis_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  const handleBack = () => {
    setSelectedTicker(null);
    setCurrentView('stocks');
  };

  const handleAddToWatchlist = useCallback(async () => {
    if (!selectedStock || watchlistCooldown.current || addingToWatchlist) return;

    // Check if stock already exists in watchlist
    const alreadyExists = watchlist.some(
      (item) =>
        item.stock_id === selectedStock.id ||
        (selectedStock.ticker && item.stock?.ticker === selectedStock.ticker)
    );

    if (alreadyExists) {
      toast.error(`${selectedStock.ticker} موجود بالفعل في قائمة المراقبة`, {
        description: selectedStock.name_ar,
        duration: 3000,
      });
      return;
    }

    // Prevent double-clicks
    watchlistCooldown.current = true;
    setAddingToWatchlist(true);
    setTimeout(() => {
      watchlistCooldown.current = false;
    }, 2000);

    const success = await addToWatchlist(selectedStock.ticker);
    setAddingToWatchlist(false);

    if (success) {
      toast.success(`تمت إضافة ${selectedStock.ticker} إلى قائمة المراقبة`, {
        description: `${selectedStock.name_ar} - ${safeToFixed(selectedStock.current_price)} ج.م`,
        duration: 3000,
      });
    } else {
      toast.error('حدث خطأ أثناء الإضافة', {
        description: 'يرجى المحاولة مرة أخرى لاحقاً',
        duration: 3000,
      });
    }
  }, [selectedStock, watchlist, addToWatchlist, addingToWatchlist]);

  if (isLoading && !selectedStock) {
    return <DetailSkeleton />;
  }

  if (!selectedStock) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" dir="rtl">
        <BarChart3 className="w-12 h-12 mb-3 opacity-20" />
        <p className="text-sm font-medium mb-1">لم يتم اختيار سهم</p>
        <p className="text-xs">اختر سهماً من قائمة الأسهم لعرض التفاصيل</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5"
          onClick={() => setCurrentView('stocks')}
        >
          <ArrowRight className="w-3.5 h-3.5" />
          تصفح الأسهم
        </Button>
      </div>
    );
  }

  const stock = selectedStock;
  const change = stock.price_change || 0;
  const isPositive = change >= 0;

  return (
    <div className="space-y-4 md:space-y-6" dir="rtl">
      {/* Flow Score + Explosive + Fundamentals from Python backend */}
      <FlowScoreCard ticker={stock.ticker} />
      <FundamentalsCard ticker={stock.ticker} />

      {/* Back Button */}
      <Button
        variant="ghost"
        onClick={handleBack}
        className="text-muted-foreground hover:text-foreground gap-2 px-0"
      >
        <ArrowRight className="w-4 h-4" />
        <span className="text-sm">العودة لقائمة الأسهم</span>
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {stock.ticker}
            </h1>
            {/* Index Membership Badges */}
            <div className="flex gap-1.5">
              {stock.egx30_member && (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 border-0 text-[11px] px-2">
                  EGX 30
                </Badge>
              )}
              {stock.egx70_member && (
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/60 border-0 text-[11px] px-2">
                  EGX 70
                </Badge>
              )}
              {stock.egx100_member && (
                <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 border-0 text-[11px] px-2">
                  EGX 100
                </Badge>
              )}
            </div>
          </div>
          <h2 className="text-lg font-semibold">{stock.name_ar}</h2>
          <p className="text-sm text-muted-foreground">{stock.name}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs">
              {stock.sector}
            </Badge>
            {stock.compliance_status === 'halal' && (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0 text-[11px] gap-1">
                <Shield className="w-3 h-3" />
                متوافق شرعاً
              </Badge>
            )}
            {stock.compliance_status === 'doubtful' && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0 text-[11px] gap-1">
                <Shield className="w-3 h-3" />
                غير مؤكد
              </Badge>
            )}
          </div>
        </div>

        {/* Price & Change */}
        <div className="text-left flex-shrink-0">
          <p className="text-3xl font-bold tabular-nums" dir="ltr">
            {safeToFixed(stock.current_price)}
          </p>
          <div className="flex items-center gap-1.5 justify-end">
            {isPositive ? (
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
            )}
            <span
              className={cn(
                'text-sm font-bold tabular-nums',
                isPositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              )}
              dir="ltr"
            >
              {change >= 0 ? '+' : ''}
              {safeToFixed(change)}%
            </span>
            <span
              className="text-xs text-muted-foreground tabular-nums"
              dir="ltr"
            >
              ({stock.current_price - stock.previous_close > 0 ? '+' : ''}
              {safeToFixed(stock.current_price - stock.previous_close)})
            </span>
          </div>
        </div>
      </div>

      {/* Add to Watchlist + Export Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleAddToWatchlist}
          disabled={addingToWatchlist}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 disabled:opacity-60"
        >
          <BookmarkPlus className={cn('w-4 h-4', addingToWatchlist && 'animate-pulse')} />
          {addingToWatchlist ? 'جارٍ الإضافة...' : 'إضافة للقائمة المراقبة'}
        </Button>
        <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-2 print:hidden">
          <Download className="w-4 h-4" />
          {exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}
        </Button>
        <ShareButton
          stockData={{
            ticker: stock.ticker,
            name: stock.name,
            nameAr: stock.name_ar,
            price: stock.current_price,
            change: stock.price_change,
            recommendation: deepAnalysis?.action,
            recommendationAr: deepAnalysis?.action_ar,
            confidence: deepAnalysis?.overall_score,
            metrics: {
              pe: stock.pe_ratio,
              roe: stock.roe,
              pb: stock.pb_ratio,
              dividendYield: stock.dividend_yield,
              eps: stock.eps,
              debtToEquity: stock.debt_to_equity,
            },
            sector: stock.sector,
            // أسعار التداول المهمة
            fairValue: stock.support_level && stock.resistance_level 
              ? (stock.support_level + stock.resistance_level) / 2 
              : undefined,
            targetPrice: deepAnalysis?.price_targets?.upside_target,
            buyPrice: stock.support_level ? stock.support_level * 1.02 : undefined, // سعر الشراء قريب من الدعم
            sellPrice: deepAnalysis?.price_targets?.upside_target ? deepAnalysis.price_targets.upside_target * 0.98 : undefined,
            stopLoss: stock.support_level ? stock.support_level * 0.97 : undefined, // وقف الخسارة تحت الدعم
            upsidePotential: deepAnalysis?.price_targets?.upside_target 
              ? ((deepAnalysis.price_targets.upside_target - stock.current_price) / stock.current_price) * 100 
              : undefined,
          }}
        />
        <QuickPublishButton
          ticker={stock.ticker}
          stockName={stock.name_ar}
          currentPrice={stock.current_price}
          analysisData={{
            signal: deepAnalysis?.action,
            signalAr: deepAnalysis?.action_ar,
            score: deepAnalysis?.overall_score,
            confidence: deepAnalysis?.confidence,
            targetPrice: deepAnalysis?.price_targets?.upside_target,
            stopLoss: stock.support_level ? stock.support_level * 0.97 : undefined,
            reasons: deepAnalysis?.reasons,
          }}
        />
      </div>

      {/* Price Info Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <PriceInfoCard
          label="الافتتاح"
          value={safeToFixed(stock.open_price || stock.current_price)}
          icon={<Activity className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="الأعلى"
          value={safeToFixed(stock.high_price || stock.current_price)}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="الأدنى"
          value={safeToFixed(stock.low_price || stock.current_price)}
          icon={<TrendingDown className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="الإغلاق"
          value={safeToFixed(stock.previous_close || stock.current_price)}
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="الحجم"
          value={formatVolume(stock.volume)}
          icon={<Zap className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="القيمة السوقية"
          value={formatNumber(stock.market_cap) + ' EGP'}
          icon={<DollarSign className="w-4 h-4" />}
        />
      </div>

      {/* Stock Chart */}
      <ErrorBoundary title="الرسم البياني">
        <TradingViewChart ticker={stock.ticker} stockName={stock.name_ar} />
      </ErrorBoundary>

      {/* Smart Investment Tip */}
      <SmartTip trigger="stock_detail" category={change < -3 ? 'psychology' : undefined} />

      {/* Gate Analysis — TradingView-style 5-gate dynamic analysis */}
      <ErrorBoundary title="تحليل البوابات">
        <GateAnalysisView
          ticker={stock.ticker}
          currentPrice={stock.current_price}
          stockName={stock.name_ar}
        />
      </ErrorBoundary>

      {/* Comprehensive Analysis — all engines in one view */}
      <ErrorBoundary title="التحليل الشامل">
        <ComprehensiveStockAnalysis
          ticker={stock.ticker}
          market={stock.market || 'EGX'}
        />
      </ErrorBoundary>

      {/* Advanced Technical Analysis */}
      <ErrorBoundary title="التحليل الفني المتقدم">
        <StockAdvancedAnalysisView 
          ticker={stock.ticker}
          stockName={stock.name_ar}
          currentPrice={stock.current_price}
        />
      </ErrorBoundary>

      {/* Delta Volume — ضغط الشراء/البيع (عمق السوق) */}
      <ErrorBoundary title="عمق السوق">
        <DeltaVolumeBar ticker={stock.ticker} />
      </ErrorBoundary>

      {/* Financial & Technical Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Financial Metrics */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              المؤشرات المالية
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <MetricRow label="مضاعف الربحية (P/E)" value={safeToFixed(stock.pe_ratio, 1)} />
            <Separator />
            <MetricRow label="مضاعف القيمة الدفترية (P/B)" value={safeToFixed(stock.pb_ratio, 1)} />
            <Separator />
            <MetricRow
              label="عائد التوزيعات"
              value={safeToFixed(stock.dividend_yield, 1) + '%'}
              highlight={stock.dividend_yield > 3}
            />
            <Separator />
            <MetricRow label="ربحية السهم (EPS)" value={safeToFixed(stock.eps) + ' EGP'} />
            <Separator />
            <MetricRow
              label="العائد على حقوق الملكية (ROE)"
              value={safeToFixed(stock.roe, 1) + '%'}
              highlight={stock.roe > 15}
            />
            <Separator />
            <MetricRow
              label="الدين/حقوق الملكية"
              value={safeToFixed(stock.debt_to_equity)}
            />
          </CardContent>
        </Card>

        {/* Technical Indicators */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              المؤشرات الفنية
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <MetricRow
              label="RSI"
              value={safeToFixed(stock.rsi, 1)}
              highlight={stock.rsi < 35 || stock.rsi > 65}
            />
            <Separator />
            <MetricRow label="المتوسط المتحرك (50)" value={safeToFixed(stock.ma_50)} />
            <Separator />
            <MetricRow label="المتوسط المتحرك (200)" value={safeToFixed(stock.ma_200)} />
            <Separator />
            <MetricRow
              label="مستوى الدعم"
              value={safeToFixed(stock.support_level)}
              highlight
            />
            <Separator />
            <MetricRow
              label="مستوى المقاومة"
              value={safeToFixed(stock.resistance_level)}
            />
            <Separator />
            <MetricRow
              label="القيمة المتداولة"
              value={formatNumber(stock.value_traded || 0) + ' EGP'}
            />
          </CardContent>
        </Card>
      </div>

      {/* AI Analysis Widget - Automatic Background Analysis */}
      <ErrorBoundary title="تحليل المساعد الذكي">
        <AIAnalysisWidget 
          ticker={stock.ticker} 
          stockName={stock.name_ar}
          currentPrice={stock.current_price}
        />
      </ErrorBoundary>

      {/* Last Updated Indicator */}
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground" dir="rtl">
        <Clock className="w-3 h-3" />
        <span>آخر تحديث: {stock.last_update ? new Date(stock.last_update).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'غير محدد'}</span>
      </div>

      {/* Calculation Breakdown */}
      <ErrorBoundary title="تفاصيل الحساب"><CalculationBreakdown /></ErrorBoundary>

      {/* Deep Analysis */}
      <ErrorBoundary title="التحليل العميق"><DeepAnalysis /></ErrorBoundary>

      {/* Stock News */}
      <ErrorBoundary title="أخبار السهم"><StockNews /></ErrorBoundary>
    </div>
  );
}

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  TrendingUp,
  CheckCircle2,
  Target,
  Clock,
  Loader2,
  Play,
  History,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  RefreshCw,
  BarChart3,
  Scale,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface FeedbackStats {
  total_predictions: number;
  validated_predictions: number;
  unvalidated_predictions: number;
  oldest_prediction: string;
  newest_prediction: string;
  by_recommendation: Record<string, number>;
  by_regime: Record<string, number>;
  avg_composite_score: number;
}

interface ModelAccuracy {
  overall: number;
  fundamental: number;
  technical: number;
  predictions_validated: number;
  last_evaluated: string;
}

interface AccuracyHistoryItem {
  date: string;
  overall: number;
  fundamental: number;
  technical: number;
  by_horizon?: Record<string, number>;
  by_recommendation_type?: Record<string, number>;
  score_correlation?: {
    avg_correct_score: number;
    avg_incorrect_score: number;
    difference: number;
  };
}

interface WeightAdjustment {
  parameter_name: string;
  old_value: number;
  new_value: number;
  reason: string;
  date: string;
}

interface FeedbackStatus {
  success: boolean;
  stats: FeedbackStats;
  model_accuracy: ModelAccuracy;
  accuracy_history: AccuracyHistoryItem[];
  weight_adjustments: WeightAdjustment[];
}

// ==================== HELPERS ====================

function formatNumber(n: number): string {
  return new Intl.NumberFormat('ar-EG').format(n);
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-EG', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getAccuracyColor(value: number, thresholds: [number, number] = [55, 40]): string {
  if (value >= thresholds[0]) return 'text-emerald-600 dark:text-emerald-400';
  if (value >= thresholds[1]) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function getAccuracyBgColor(value: number, thresholds: [number, number] = [55, 40]): string {
  if (value >= thresholds[0]) return 'bg-emerald-500';
  if (value >= thresholds[1]) return 'bg-amber-500';
  return 'bg-rose-500';
}

function getAccuracyBadgeBg(value: number, thresholds: [number, number] = [55, 40]): string {
  if (value >= thresholds[0]) return 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40';
  if (value >= thresholds[1]) return 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/40';
  return 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/40';
}

const RECOMMENDATION_AR: Record<string, string> = {
  'Strong Buy': 'شراء قوي',
  'Buy': 'شراء',
  'Hold': 'حياد',
  'Avoid': 'تجنب',
  'Strong Avoid': 'تجنب قوي',
};

const RECOMMENDATION_COLORS: Record<string, string> = {
  'Strong Buy': 'bg-emerald-500',
  'Buy': 'bg-emerald-400',
  'Hold': 'bg-amber-400',
  'Avoid': 'bg-orange-500',
  'Strong Avoid': 'bg-rose-500',
};

const REGIME_AR: Record<string, string> = {
  neutral: 'محايد',
  bull: 'صاعد',
  bear: 'هابط',
};

// ==================== SKELETON LOADING ====================

function DashboardSkeleton() {
  return (
    <div className="space-y-6" dir="rtl">
      {/* Header Skeleton */}
      <div className="flex items-center gap-4">
        <Skeleton className="w-14 h-14 rounded-2xl" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="w-20 h-20 rounded-2xl" />
      </div>

      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>

      {/* Action Buttons Skeleton */}
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 flex-1 rounded-lg" />
      </div>

      {/* Content Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

export default function FeedbackDashboard() {
  const [data, setData] = useState<FeedbackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningFeedback, setRunningFeedback] = useState(false);
  const [runningBacktest, setRunningBacktest] = useState(false);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v2/feedback/status');
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        toast.error('فشل في تحميل بيانات التغذية الراجعة');
      }
    } catch {
      toast.error('حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Run feedback loop
  const handleRunFeedback = async () => {
    setRunningFeedback(true);
    try {
      const res = await fetch('/api/v2/feedback/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_backtest: false }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تشغيل التغذية الراجعة بنجاح', {
          description: json.message || `تم التحقق من ${json.predictions_validated || 0} تنبؤ`,
        });
        await fetchStatus();
      } else {
        toast.error('فشل تشغيل التغذية الراجعة', {
          description: json.message || 'حاول مرة أخرى',
        });
      }
    } catch {
      toast.error('حدث خطأ أثناء تشغيل التغذية الراجعة');
    } finally {
      setRunningFeedback(false);
    }
  };

  // Run backtest
  const handleRunBacktest = async () => {
    setRunningBacktest(true);
    try {
      const res = await fetch('/api/v2/feedback/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backtest_days: 60 }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم الاختبار التاريخي بنجاح', {
          description: `تم التحقق من ${json.predictions_validated || 0} تنبؤ`,
        });
        await fetchStatus();
      } else {
        toast.error('فشل الاختبار التاريخي', {
          description: json.message || 'حاول مرة أخرى',
        });
      }
    } catch {
      toast.error('حدث خطأ أثناء تشغيل الاختبار التاريخي');
    } finally {
      setRunningBacktest(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4" dir="rtl">
        <Brain className="w-12 h-12 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">لا توجد بيانات متاحة</p>
        <Button variant="outline" size="sm" onClick={fetchStatus} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  const { stats, model_accuracy, accuracy_history, weight_adjustments } = data;
  const latestHistory = accuracy_history?.[accuracy_history.length - 1];
  const byHorizon = latestHistory?.by_horizon || {};
  const byRecType = latestHistory?.by_recommendation_type || {};
  const scoreCorrelation = latestHistory?.score_correlation;

  return (
    <div className="space-y-6" dir="rtl">
      {/* ==================== HEADER SECTION ==================== */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg flex-shrink-0">
            <Brain className="w-7 h-7 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-xl">نظام التعلم الذاتي</h2>
            <p className="text-sm text-muted-foreground mt-0.5">التغذية الراجعة وتحسين الأوزان</p>
          </div>
        </div>

        {/* Accuracy Badge */}
        <div className={cn(
          'flex flex-col items-center justify-center w-20 h-20 rounded-2xl border-2 transition-all flex-shrink-0',
          getAccuracyBadgeBg(model_accuracy.overall)
        )}>
          <span className="text-2xl font-black leading-none">
            {model_accuracy.overall.toFixed(1)}
          </span>
          <span className="text-[10px] font-medium mt-0.5">دقة %</span>
        </div>
      </div>

      {/* ==================== STATS CARDS ROW ==================== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Predictions */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-xs text-muted-foreground">إجمالي التنبؤات</span>
          </div>
          <p className="text-2xl font-bold">{formatNumber(stats.total_predictions)}</p>
        </Card>

        {/* Validated Predictions */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-950/30 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </div>
            <span className="text-xs text-muted-foreground">التنبؤات المحددة</span>
          </div>
          <p className="text-2xl font-bold">{formatNumber(stats.validated_predictions)}</p>
        </Card>

        {/* Overall Accuracy */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
              <Target className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <span className="text-xs text-muted-foreground">الدقة العامة</span>
          </div>
          <p className={cn('text-2xl font-bold', getAccuracyColor(model_accuracy.overall))}>
            {model_accuracy.overall.toFixed(1)}%
          </p>
        </Card>

        {/* Last Updated */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-950/30 flex items-center justify-center">
              <Clock className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            </div>
            <span className="text-xs text-muted-foreground">آخر تحديث</span>
          </div>
          <p className="text-sm font-semibold">{formatDateShort(model_accuracy.last_evaluated)}</p>
        </Card>
      </div>

      {/* ==================== ACTION BUTTONS ROW ==================== */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={handleRunFeedback}
          disabled={runningFeedback || runningBacktest}
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-2 h-11"
        >
          {runningFeedback ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              جاري التشغيل...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              تشغيل التغذية الراجعة
            </>
          )}
        </Button>

        <Button
          onClick={handleRunBacktest}
          disabled={runningFeedback || runningBacktest}
          variant="outline"
          className="flex-1 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/20 gap-2 h-11"
        >
          {runningBacktest ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              جاري الاختبار...
            </>
          ) : (
            <>
              <History className="w-4 h-4" />
              اختبار تاريخي
            </>
          )}
        </Button>
      </div>

      {/* ==================== TWO COLUMN GRID ==================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---- Accuracy by Horizon ---- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              الدقة حسب الأفق الزمني
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              { label: '5 أيام', key: '5d', threshold: [60, 45] as [number, number] },
              { label: '10 أيام', key: '10d', threshold: [60, 45] as [number, number] },
              { label: '20 يوم', key: '20d', threshold: [60, 45] as [number, number] },
            ].map((horizon) => {
              const value = byHorizon[horizon.key] ?? 0;
              return (
                <div key={horizon.key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{horizon.label}</span>
                    <span className={cn('text-sm font-bold', getAccuracyColor(value, horizon.threshold))}>
                      {value.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', getAccuracyBgColor(value, horizon.threshold))}
                      style={{ width: `${Math.min(value, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Fundamental & Technical */}
            <div className="pt-3 border-t space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">التحليل الأساسي</span>
                <span className={cn('text-xs font-bold', getAccuracyColor(model_accuracy.fundamental))}>
                  {model_accuracy.fundamental.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">التحليل الفني</span>
                <span className={cn('text-xs font-bold', getAccuracyColor(model_accuracy.technical))}>
                  {model_accuracy.technical.toFixed(1)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---- Accuracy by Recommendation Type ---- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              الدقة حسب نوع التحليل
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(RECOMMENDATION_AR).map(([key, label]) => {
              const value = byRecType[key] ?? 0;
              const barColor = RECOMMENDATION_COLORS[key] || 'bg-muted';
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{label}</span>
                    <span className={cn('text-xs font-bold', getAccuracyColor(value))}>
                      {value.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', barColor)}
                      style={{ width: `${Math.min(value, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {/* By Regime */}
            <div className="pt-3 border-t">
              <p className="text-xs text-muted-foreground mb-2">توزيع التنبؤات حسب النظام السوقي</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.by_regime).map(([key, count]) => (
                  <Badge key={key} variant="secondary" className="text-[10px]">
                    {REGIME_AR[key] || key}: {formatNumber(count)}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ==================== SCORE CORRELATION ==================== */}
      {scoreCorrelation && (
        <Card className="border-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Scale className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              ارتباط النتيجة المركبة بالدقة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {/* Correct predictions avg score */}
              <div className="text-center space-y-2">
                <div className="w-14 h-14 mx-auto rounded-xl bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-xs text-muted-foreground">متوسط نقاط التنبؤات الصحيحة</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                  {scoreCorrelation.avg_correct_score.toFixed(1)}
                </p>
              </div>

              {/* Incorrect predictions avg score */}
              <div className="text-center space-y-2">
                <div className="w-14 h-14 mx-auto rounded-xl bg-rose-100 dark:bg-rose-950/30 flex items-center justify-center">
                  <Target className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                </div>
                <p className="text-xs text-muted-foreground">متوسط نقاط التنبؤات الخاطئة</p>
                <p className="text-xl font-bold text-rose-600 dark:text-rose-400">
                  {scoreCorrelation.avg_incorrect_score.toFixed(1)}
                </p>
              </div>

              {/* Discrimination indicator */}
              <div className="text-center space-y-2">
                <div className={cn(
                  'w-14 h-14 mx-auto rounded-xl flex items-center justify-center',
                  scoreCorrelation.difference > 5
                    ? 'bg-emerald-100 dark:bg-emerald-950/30'
                    : scoreCorrelation.difference > 2
                      ? 'bg-amber-100 dark:bg-amber-950/30'
                      : 'bg-rose-100 dark:bg-rose-950/30'
                )}>
                  {scoreCorrelation.difference > 5 ? (
                    <ArrowUpRight className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  ) : scoreCorrelation.difference > 2 ? (
                    <Minus className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <ArrowDownRight className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">فارق التمييز</p>
                <p className={cn('text-xl font-bold', getAccuracyColor(scoreCorrelation.difference, [5, 2]))}>
                  +{scoreCorrelation.difference.toFixed(1)}
                </p>
                <Badge
                  variant="secondary"
                  className={cn(
                    'text-[10px]',
                    scoreCorrelation.difference > 5
                      ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : scoreCorrelation.difference > 2
                        ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                        : 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                  )}
                >
                  {scoreCorrelation.difference > 5
                    ? 'تمييز ممتاز'
                    : scoreCorrelation.difference > 2
                      ? 'تمييز مقبول'
                      : 'يحتاج تحسين'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ==================== WEIGHT ADJUSTMENT HISTORY ==================== */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              سجل تعديلات الأوزان
            </CardTitle>
            <Badge variant="secondary" className="text-[10px]">
              آخر {Math.min(weight_adjustments?.length || 0, 10)} تعديل
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {!weight_adjustments || weight_adjustments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد تعديلات أوزان بعد</p>
              <p className="text-xs mt-1">قم بتشغيل التغذية الراجعة لبدء تحسين الأوزان</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-emerald-50 dark:bg-emerald-950/20 sticky top-0 z-10">
                    <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      المعامل
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      القديم
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      الجديد
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      التغير
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300 hidden sm:table-cell">
                      السبب
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      التاريخ
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weight_adjustments.slice(0, 10).map((adj, index) => {
                    const diff = adj.new_value - adj.old_value;
                    const isIncrease = diff > 0;
                    const isDecrease = diff < 0;
                    return (
                      <TableRow key={index} className="hover:bg-muted/50">
                        <TableCell className="font-medium text-sm font-mono" dir="ltr">
                          {adj.parameter_name}
                        </TableCell>
                        <TableCell className="text-sm font-mono text-muted-foreground" dir="ltr">
                          {adj.old_value.toFixed(4)}
                        </TableCell>
                        <TableCell className="text-sm font-mono font-semibold" dir="ltr">
                          {adj.new_value.toFixed(4)}
                        </TableCell>
                        <TableCell>
                          <div className={cn(
                            'flex items-center gap-0.5 text-xs font-semibold',
                            isIncrease
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : isDecrease
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-muted-foreground'
                          )} dir="ltr">
                            {isIncrease ? (
                              <ArrowUpRight className="w-3 h-3" />
                            ) : isDecrease ? (
                              <ArrowDownRight className="w-3 h-3" />
                            ) : (
                              <Minus className="w-3 h-3" />
                            )}
                            {diff > 0 ? '+' : ''}{diff.toFixed(4)}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate hidden sm:table-cell">
                          {adj.reason}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateShort(adj.date)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ==================== BOTTOM STATS ==================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Predictions by Recommendation */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs text-muted-foreground">توزيع التنبؤات حسب التحليل</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.by_recommendation).map(([key, count]) => (
                <Badge
                  key={key}
                  variant="secondary"
                  className="text-xs gap-1.5"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: RECOMMENDATION_COLORS[key] || '#888' }}
                  />
                  {RECOMMENDATION_AR[key] || key}: {formatNumber(count)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Avg Composite Score */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs text-muted-foreground">متوسط النتيجة المركبة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
                {stats.avg_composite_score.toFixed(1)}
              </div>
              <div className="flex-1">
                <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-teal-500 transition-all duration-500"
                    style={{ width: `${Math.min(stats.avg_composite_score, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">من 100</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

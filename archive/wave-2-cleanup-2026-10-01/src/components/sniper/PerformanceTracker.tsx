'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Award,
  BarChart3,
  Brain,
  Lightbulb,
  Minus,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface PerformanceMetrics {
  win_rate: number;
  profit_factor: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  total_predictions: number;
  total_wins: number;
  total_losses: number;
  total_breakeven: number;
  best_trade_pct: number;
  worst_trade_pct: number;
  avg_hold_days: number;
}

interface ClosedPrediction {
  id: string;
  ticker: string;
  market: string;
  signal: string;
  signal_ar: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  actual_exit_price: number | null;
  result: 'win' | 'loss' | 'breakeven' | 'open';
  pnl_pct: number | null;
  opened_at: string;
  closed_at: string | null;
  hold_days: number | null;
}

interface LearnedLesson {
  id: string;
  lesson: string;
  category: string;
  frequency: number;
  last_seen: string;
}

interface PerformanceData {
  success: boolean;
  metrics: PerformanceMetrics;
  recent_closed: ClosedPrediction[];
  lessons: LearnedLesson[];
}

// ============================================================================
// Helpers
// ============================================================================

function getWinRateColor(rate: number): string {
  if (rate >= 60) return 'text-green-600 dark:text-green-400';
  if (rate >= 40) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function getWinRateBarColor(rate: number): string {
  if (rate >= 60) return 'bg-green-500';
  if (rate >= 40) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getResultBadge(result: string) {
  switch (result) {
    case 'win':
      return (
        <Badge className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800 text-[10px]">
          <TrendingUp className="h-3 w-3 ml-0.5" />
          ربح
        </Badge>
      );
    case 'loss':
      return (
        <Badge className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800 text-[10px]">
          <TrendingDown className="h-3 w-3 ml-0.5" />
          خسارة
        </Badge>
      );
    case 'breakeven':
      return (
        <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800 text-[10px]">
          <Minus className="h-3 w-3 ml-0.5" />
          تعادل
        </Badge>
      );
    default:
      return <Badge variant="outline" className="text-[10px]">مفتوح</Badge>;
  }
}

function formatPnl(pnl: number | null): string {
  if (pnl === null) return '—';
  const sign = pnl > 0 ? '+' : '';
  return `${sign}${pnl.toFixed(2)}%`;
}

function getPnlColor(pnl: number | null): string {
  if (pnl === null) return 'text-muted-foreground';
  if (pnl > 0) return 'text-green-600 dark:text-green-400';
  if (pnl < 0) return 'text-red-600 dark:text-red-400';
  return 'text-yellow-600 dark:text-yellow-400';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getLessonCategoryIcon(category: string) {
  switch (category.toLowerCase()) {
    case 'technical':
      return <BarChart3 className="h-3.5 w-3.5" />;
    case 'risk':
      return <Target className="h-3.5 w-3.5" />;
    case 'behavioral':
      return <Brain className="h-3.5 w-3.5" />;
    default:
      return <Lightbulb className="h-3.5 w-3.5" />;
  }
}

// ============================================================================
// Component
// ============================================================================

// UnifiedTable columns for closed predictions (Rule 52)
const closedPredictionColumns: Column<ClosedPrediction>[] = [
  {
    key: 'ticker',
    header: 'السهم',
    align: 'right',
    sortable: true,
    render: (p) => <span className="text-xs font-medium">{p.ticker}</span>,
  },
  {
    key: 'signal_ar',
    header: 'الإشارة',
    align: 'right',
    render: (p) => <span className="text-xs">{p.signal_ar}</span>,
  },
  {
    key: 'result',
    header: 'النتيجة',
    align: 'right',
    render: (p) => getResultBadge(p.result),
  },
  {
    key: 'pnl_pct',
    header: 'الربح%',
    align: 'right',
    sortable: true,
    render: (p) => (
      <span className={cn('text-xs font-semibold', getPnlColor(p.pnl_pct))}>
        {formatPnl(p.pnl_pct)}
      </span>
    ),
  },
  {
    key: 'hold_days',
    header: 'المدة',
    align: 'right',
    sortable: true,
    render: (p) => (
      <span className="text-xs text-muted-foreground">
        {p.hold_days !== null ? `${p.hold_days} يوم` : '—'}
      </span>
    ),
  },
  {
    key: 'closed_at',
    header: 'تاريخ الإغلاق',
    align: 'right',
    sortable: true,
    render: (p) => (
      <span className="text-xs text-muted-foreground">{formatDate(p.closed_at)}</span>
    ),
  },
];

export function PerformanceTracker() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPerformance = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sniper/learning/performance?XTransformPort=8010');
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || 'فشل في تحميل البيانات');
      }
    } catch (err) {
      console.error('Error fetching performance:', err);
      setError('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPerformance();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="mr-3 text-muted-foreground">جاري تحميل بيانات الأداء...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <p className="text-red-500 mb-2">{error}</p>
          <button
            onClick={fetchPerformance}
            className="text-sm text-primary hover:underline"
          >
            إعادة المحاولة
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const metrics = data.metrics || {
    win_rate: 0,
    profit_factor: 0,
    avg_win_pct: 0,
    avg_loss_pct: 0,
    total_predictions: 0,
    total_wins: 0,
    total_losses: 0,
    total_breakeven: 0,
    best_trade_pct: 0,
    worst_trade_pct: 0,
    avg_hold_days: 0,
  };

  const recentClosed = data.recent_closed || [];
  const lessons = data.lessons || [];

  return (
    <div className="space-y-6">
      {/* Win Rate Gauge */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            معدل الربح
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <span className={cn('text-4xl font-bold', getWinRateColor(metrics.win_rate))}>
              {metrics.win_rate.toFixed(1)}%
            </span>
            <span className="text-sm text-muted-foreground mb-1">
              من {metrics.total_predictions} توقع
            </span>
          </div>
          <div className="relative w-full h-4 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', getWinRateBarColor(metrics.win_rate))}
              style={{ width: `${Math.min(metrics.win_rate, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="text-green-600 dark:text-green-400">
              {metrics.total_wins} ربح
            </span>
            <span className="text-yellow-600 dark:text-yellow-400">
              {metrics.total_breakeven} تعادل
            </span>
            <span className="text-red-600 dark:text-red-400">
              {metrics.total_losses} خسارة
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Profit Factor */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground mb-1">معامل الربح</div>
            <div className={cn(
              'text-2xl font-bold',
              metrics.profit_factor >= 1.5 ? 'text-green-600 dark:text-green-400' :
              metrics.profit_factor >= 1.0 ? 'text-yellow-600 dark:text-yellow-400' :
              'text-red-600 dark:text-red-400'
            )}>
              {metrics.profit_factor.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        {/* Avg Win */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground mb-1">متوسط الربح</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              +{metrics.avg_win_pct.toFixed(2)}%
            </div>
          </CardContent>
        </Card>

        {/* Avg Loss */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground mb-1">متوسط الخسارة</div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {metrics.avg_loss_pct.toFixed(2)}%
            </div>
          </CardContent>
        </Card>

        {/* Avg Hold Days */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground mb-1">متوسط فترة الاحتفاظ</div>
            <div className="text-2xl font-bold">
              {metrics.avg_hold_days.toFixed(0)}
              <span className="text-sm font-normal text-muted-foreground mr-1">يوم</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Best / Worst */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground mb-1">أفضل صفقة</div>
            <div className="text-xl font-bold text-green-600 dark:text-green-400">
              +{metrics.best_trade_pct.toFixed(2)}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground mb-1">أسوأ صفقة</div>
            <div className="text-xl font-bold text-red-600 dark:text-red-400">
              {metrics.worst_trade_pct.toFixed(2)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Closed Predictions Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            التوقعات المغلقة مؤخراً
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentClosed.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              لا توجد توقعات مغلقة بعد
            </div>
          ) : (
            <UnifiedTable<ClosedPrediction>
              columns={closedPredictionColumns}
              data={recentClosed}
              keyField="id"
              maxHeight="max-h-96"
              dense
              emptyTextAr="لا توجد توقعات مغلقة بعد"
            />
          )}
        </CardContent>
      </Card>

      {/* Learned Lessons */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-yellow-500" />
            الدروس المستفادة
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lessons.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              لم يتم تسجيل دروس بعد — ابدأ بالتداول!
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-2">
              {lessons.map((lesson) => (
                <div
                  key={lesson.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors"
                >
                  <div className="mt-0.5 text-muted-foreground">
                    {getLessonCategoryIcon(lesson.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{lesson.lesson}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                        {lesson.category}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        تكرار: {lesson.frequency}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        آخر ظهور: {formatDate(lesson.last_seen)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

/**
 * PredictionsBacktestTable — جدول الباك تست للتوقعات
 * ===================================================
 * يعرض:
 *  - صف KPI (4 بطاقات): إجمالي التوقعات، نسبة النجاح، متوسط العائد، إجمالي P&L
 *  - تفصيل حسب نوع الإشارة (BUY vs SELL) مع النسب
 *  - الجدول الرئيسي لكل توقّع (آخر 100): التاريخ، السهم، الإشارة، الدخول، الهدف،
 *    وقف الخسارة، الخروج، العائد%، الحالة، أيام التقييم — مع تلوين الصفوف
 *
 * يستهلك:
 *   1. /api/predictions/performance-dashboard?market=X&days=Y (للـ KPIs)
 *   2. /api/predictions/backtest-list?market=X                (للقائمة الخام)
 *
 * NO mock data — كل الأرقام من predictions.db عبر APIs حقيقية.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { History, Target, TrendingUp, TrendingDown, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { cn } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';

interface DashboardStats {
  total: number;
  resolved: number;
  wins: number;
  losses: number;
  expired: number;
  pending: number;
  win_rate: number;
  avg_return: number;
  avg_holding_days: number;
}

interface BySignalItem {
  signal: string;
  total: number;
  wins: number;
  losses: number;
  expired: number;
  win_rate: number;
  avg_return: number;
}

interface DashboardResponse {
  success: boolean;
  market: string;
  days: number;
  stats: DashboardStats;
  by_signal: BySignalItem[];
  error?: string;
}

interface BacktestRow {
  id: number;
  ticker: string;
  signal: string;
  status: string;
  market: string;
  prediction_date: string;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  exit_price: number | null;
  actual_return: number | null;
  holding_days: number;
  risk_reward: number | null;
  is_correct: boolean | null;
}

interface BacklistResponse {
  success: boolean;
  market: string;
  count: number;
  predictions: BacktestRow[];
  error?: string;
}

type PeriodKey = '7' | '30' | '90' | 'all';
const PERIOD_LABEL: Record<PeriodKey, string> = {
  '7': '7 أيام',
  '30': '30 يوم',
  '90': '90 يوم',
  all: 'الكل',
};

const WIN_STATUSES = new Set(['TARGET_HIT', 'closed_win', 'WIN', 'win']);
const LOSS_STATUSES = new Set(['closed_stop', 'STOPPED', 'LOSS', 'loss']);
const EXPIRED_STATUSES = new Set(['EXPIRED', 'expired', 'CLOSED']);
const ACTIVE_STATUSES = new Set(['ACTIVE', 'active', 'PENDING', 'pending']);

function StatusBadge({ status }: { status: string }) {
  const s = status || 'unknown';
  if (WIN_STATUSES.has(s)) {
    return (
      <Badge className="text-[9px] bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">
        <CheckCircle2 className="w-2.5 h-2.5 ml-0.5" />نجح
      </Badge>
    );
  }
  if (LOSS_STATUSES.has(s)) {
    return (
      <Badge className="text-[9px] bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30 hover:bg-red-500/20">
        <XCircle className="w-2.5 h-2.5 ml-0.5" />توقّف
      </Badge>
    );
  }
  if (ACTIVE_STATUSES.has(s)) {
    return (
      <Badge className="text-[9px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20">
        <Clock className="w-2.5 h-2.5 ml-0.5" />نشط
      </Badge>
    );
  }
  if (EXPIRED_STATUSES.has(s)) {
    return (
      <Badge variant="outline" className="text-[9px]">مغلق</Badge>
    );
  }
  return <Badge variant="outline" className="text-[9px]">{s}</Badge>;
}

function SignalBadge({ signal }: { signal: string }) {
  const s = (signal || '').toUpperCase();
  if (s.includes('BUY') && !s.includes('STRONG')) {
    return <Badge className="text-[9px] bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/30">شراء</Badge>;
  }
  if (s.includes('STRONG_BUY')) {
    return <Badge className="text-[9px] bg-emerald-600/20 text-emerald-500 dark:text-emerald-400 border-emerald-500/40 font-semibold">شراء قوي</Badge>;
  }
  if (s.includes('SELL')) {
    return <Badge className="text-[9px] bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30">بيع</Badge>;
  }
  if (s.includes('HOLD')) {
    return <Badge variant="outline" className="text-[9px]">انتظار</Badge>;
  }
  return <Badge variant="outline" className="text-[9px]">{signal || '—'}</Badge>;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = String(s).slice(0, 10);
  return d;
}

// ─── Columns definition for UnifiedTable ────────────────────────────────────
const backtestColumns: Column<BacktestRow>[] = [
  {
    key: 'prediction_date',
    header: 'التاريخ',
    align: 'right',
    sortable: true,
    className: 'text-muted-foreground',
    render: (r) => fmtDate(r.prediction_date),
  },
  {
    key: 'ticker',
    header: 'السهم',
    align: 'right',
    sortable: true,
    className: 'font-semibold',
  },
  {
    key: 'signal',
    header: 'الإشارة',
    align: 'center',
    render: (r) => <SignalBadge signal={r.signal} />,
  },
  {
    key: 'entry_price',
    header: 'الدخول',
    align: 'left',
    sortable: true,
    className: 'font-mono',
    render: (r) => fmtNum(r.entry_price),
  },
  {
    key: 'target_price',
    header: 'الهدف',
    align: 'left',
    sortable: true,
    className: 'font-mono text-emerald-500 dark:text-emerald-400',
    render: (r) => fmtNum(r.target_price),
  },
  {
    key: 'stop_loss',
    header: 'وقف الخسارة',
    align: 'left',
    sortable: true,
    className: 'font-mono text-red-700 dark:text-red-400',
    render: (r) => fmtNum(r.stop_loss),
  },
  {
    key: 'exit_price',
    header: 'الخروج',
    align: 'left',
    className: 'font-mono',
    render: (r) => fmtNum(r.exit_price),
  },
  {
    key: 'actual_return',
    header: 'العائد%',
    align: 'center',
    sortable: true,
    className: 'font-bold font-mono',
    render: (r) => {
      const ret = r.actual_return;
      if (ret == null) return <span className="text-muted-foreground">—</span>;
      const cls = ret > 0
        ? 'text-emerald-500 dark:text-emerald-400'
        : ret < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-muted-foreground';
      return <span className={cn(cls, 'font-bold')}>{`${ret > 0 ? '+' : ''}${ret.toFixed(2)}%`}</span>;
    },
  },
  {
    key: 'status',
    header: 'الحالة',
    align: 'center',
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'holding_days',
    header: 'أيام التقييم',
    align: 'center',
    sortable: true,
    className: 'text-muted-foreground',
    render: (r) => r.holding_days || 0,
  },
];

// ─── Share text builder ────────────────────────────────────────────────────
function buildBacktestShareText(
  dashboard: DashboardResponse | null,
  rows: BacktestRow[],
  marketNameAr: string,
): string {
  if (!dashboard) return `جدول الباك تست — ${marketNameAr}`;
  const stats = dashboard.stats;
  const totalPnl = rows.reduce((sum, r) => sum + (r.actual_return || 0), 0);
  const lines: string[] = [
    `📊 جدول الباك تست — ${marketNameAr}`,
    '',
    `إجمالي التوقعات: ${stats.total}`,
    `نسبة النجاح: ${stats.win_rate.toFixed(1)}%`,
    `متوسط العائد: ${stats.avg_return >= 0 ? '+' : ''}${stats.avg_return.toFixed(2)}%`,
    `إجمالي P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`,
    '',
    `آخر ${Math.min(rows.length, 5)} توقّع:`,
  ];
  rows.slice(0, 5).forEach((r) => {
    const ret = r.actual_return == null ? '—' : `${r.actual_return >= 0 ? '+' : ''}${r.actual_return.toFixed(2)}%`;
    lines.push(`  • ${r.ticker} — ${r.signal} — ${ret}`);
  });
  lines.push('', '⚠️ لأغراض إعلامية فقط وليست نصيحة استثمارية.');
  return lines.join('\n');
}

export function PredictionsBacktestTable() {
  const currentMarket = useAppStore((s) => s.currentMarket);
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [backlist, setBacklist] = useState<BacklistResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tableCardRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // دائماً نجلب إحصائيات الباك تست الكامل (365 يوم) عشان نعرض نسبة النجاح الحقيقية
      // بصرف النظر عن الفترة المختارة — الفترة بتفلتر الجدول بس، مش الإحصائيات الإجمالية.
      const [dashRes, listRes] = await Promise.all([
        fetch(`/api/predictions/performance-dashboard?market=${currentMarket}&days=365`, { cache: 'no-store' }),
        fetch(`/api/predictions/backtest-list?market=${currentMarket}`, { cache: 'no-store' }),
      ]);

      let dashJson: DashboardResponse | null = null;
      if (dashRes.ok) {
        dashJson = (await dashRes.json()) as DashboardResponse;
        if (!dashJson.success) {
          setError(dashJson.error || 'تعذّر جلب إحصائيات الأداء');
        }
      } else {
        setError('تعذّر جلب إحصائيات الأداء. يرجى المحاولة مرة أخرى.');
      }

      let listJson: BacklistResponse | null = null;
      if (listRes.ok) {
        listJson = (await listRes.json()) as BacklistResponse;
        if (!listJson.success && !listJson.error) {
          // list returns success=true with empty array if no data — fine
        }
      }

      setDashboard(dashJson);
      setBacklist(listJson);
    } catch (e) {
      setError('تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
      setDashboard(null);
      setBacklist(null);
    } finally {
      setLoading(false);
    }
  }, [currentMarket]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const marketNameAr = MARKET_NAMES_AR[currentMarket];

  if (loading) {
    return (
      <Card dir="rtl" className="w-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="w-4 h-4 text-purple-500" />
            جدول الباك تست
            <Badge variant="outline" className="text-[10px]">{marketNameAr}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !dashboard) {
    return (
      <Card dir="rtl" className="w-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="w-4 h-4 text-purple-500" />
            جدول الباك تست
            <Badge variant="outline" className="text-[10px]">{marketNameAr}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-xs text-muted-foreground py-6">
            {error ? (
              <span className="text-red-600 dark:text-red-400">خطأ: {error}</span>
            ) : (
              'لا توجد توقعات مسجّلة'
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats = dashboard.stats;
  const rows = backlist?.predictions || [];
  // فلترة الصفوف حسب النافذة الزمنية المختارة
  const cutoffDate =
    period === 'all'
      ? null
      : new Date(Date.now() - parseInt(period, 10) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const filteredRows = cutoffDate
    ? rows.filter((r) => (r.prediction_date || '').slice(0, 10) >= cutoffDate!)
    : rows;

  // KPIs
  const totalPnl = filteredRows.reduce((sum, r) => sum + (r.actual_return || 0), 0);
  const winRate = stats.win_rate || 0;
  const winRateTone = winRate >= 50 ? 'pos' : winRate > 0 ? 'neg' : 'neutral';
  const avgReturn = stats.avg_return || 0;
  const avgTone = avgReturn >= 0 ? 'pos' : 'neg';

  return (
    <Card dir="rtl" className="w-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="w-4 h-4 text-purple-500" />
            جدول الباك تست
            <Badge variant="outline" className="text-[10px] text-purple-700 dark:text-purple-400 border-purple-500/30">
              {marketNameAr}
            </Badge>
          </CardTitle>
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="h-7 w-[100px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{PERIOD_LABEL['7']}</SelectItem>
              <SelectItem value="30">{PERIOD_LABEL['30']}</SelectItem>
              <SelectItem value="90">{PERIOD_LABEL['90']}</SelectItem>
              <SelectItem value="all">{PERIOD_LABEL['all']}</SelectItem>
            </SelectContent>
          </Select>
          <UnifiedPublishButton
            content={buildBacktestShareText(dashboard, filteredRows, marketNameAr)}
            title={`جدول الباك تست — ${marketNameAr}`}
            image={tableCardRef}
            filename={`backtest_${currentMarket}_${new Date().toISOString().slice(0, 10)}`}
            hashtags={['EGX', 'بورصة', 'توقعات']}
            variant="outline"
            size="sm"
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
          <KpiCard
            label="إجمالي التوقعات"
            value={String(stats.total || 0)}
            icon={<Target className="w-3.5 h-3.5" />}
          />
          <KpiCard
            label="نسبة النجاح"
            value={`${winRate.toFixed(1)}%`}
            tone={winRateTone}
            icon={winRateTone === 'pos' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          />
          <KpiCard
            label="متوسط العائد"
            value={`${avgReturn > 0 ? '+' : ''}${avgReturn.toFixed(2)}%`}
            tone={avgTone}
            icon={avgTone === 'pos' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          />
          <KpiCard
            label="إجمالي P&L"
            value={`${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}%`}
            tone={totalPnl >= 0 ? 'pos' : 'neg'}
            icon={totalPnl >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          />
        </div>

        {/* By-signal breakdown */}
        {dashboard.by_signal && dashboard.by_signal.length > 0 && (
          <div className="rounded-md border border-border/30 bg-muted/10 p-2">
            <div className="text-[10px] text-muted-foreground mb-1.5">حسب نوع الإشارة</div>
            <div className="grid grid-cols-2 gap-2">
              {dashboard.by_signal.map((b) => (
                <div key={b.signal} className="flex items-center justify-between text-[11px] py-0.5">
                  <SignalBadge signal={b.signal} />
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{b.total} توقّع</span>
                    <span className={cn(
                      'font-semibold',
                      b.win_rate >= 50 ? 'text-emerald-500 dark:text-emerald-400' :
                      b.win_rate > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
                    )}>
                      {b.win_rate.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-prediction table (UnifiedTable) */}
        <div ref={tableCardRef} className="rounded-md border border-border/30 overflow-hidden">
          <UnifiedTable<BacktestRow>
            columns={backtestColumns}
            data={filteredRows}
            keyField="id"
            maxHeight="max-h-96"
            dense
            emptyTextAr="لا توجد توقعات مسجّلة في النافذة المحددة"
            rowClassName={(r) => {
              const isWin = WIN_STATUSES.has(r.status);
              const isLoss = LOSS_STATUSES.has(r.status);
              const isActive = ACTIVE_STATUSES.has(r.status);
              if (isWin) return 'bg-emerald-500/5 hover:bg-emerald-500/10';
              if (isLoss) return 'bg-red-500/5 hover:bg-red-500/10';
              if (isActive) return 'bg-amber-500/5 hover:bg-amber-500/10';
              return '';
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCard({
  label,
  value,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'neutral';
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-md bg-muted/40 p-2.5 flex items-center justify-between gap-2">
      <div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div
          className={cn(
            'text-base sm:text-lg font-bold',
            tone === 'pos' ? 'text-emerald-500 dark:text-emerald-400' :
            tone === 'neg' ? 'text-red-600 dark:text-red-400' : ''
          )}
        >
          {value}
        </div>
      </div>
      {icon && (
        <div className={cn(
          'opacity-70',
          tone === 'pos' ? 'text-emerald-500 dark:text-emerald-400' :
          tone === 'neg' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
        )}>
          {icon}
        </div>
      )}
    </div>
  );
}

'use client';
import { StatCard } from '@/components/ui/stat-card';

/**
 * PredictionTrackingView — تتبع التوقعات (Feature 3)
 * =========================================================
 * بيعرض:
 * - كروت إحصائية: إجمالي التوقعات، المعلقة، نسبة النجاح، نسبة الفشل
 * - جدول قابل للفلترة بالسوق والحالة
 * - زرار "تحقق الآن" للتحقق اليدوي من التوقعات المعلقة
 *
 * مصدر البيانات: /api/predictions/tracking/{stats,list,verify}
 * (Python Backend على المنفذ 8010 — Node.js للعرض فقط)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/components/shared/UnifiedPublishButton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Trophy,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Target,
  Shield,
  Gauge,
  ListChecks,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, MarketType } from '@/lib/store';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { toast } from 'sonner';

// ============================================================
// Types
// ============================================================

type PickStatus = 'pending' | 'target_hit' | 'stop_hit' | 'expired';

interface TrackedPick {
  id: number;
  ticker: string;
  market: string;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  risk_reward: number;
  pick_date: string;
  status: PickStatus;
  current_price: number | null;
  verification_date: string | null;
  profit_loss_pct: number | null;
  narrative: string[];
  personas: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

interface TrackingStats {
  total: number;
  pending: number;
  target_hit: number;
  stop_hit: number;
  expired: number;
  resolved: number;
  success_rate: number;
  failure_rate: number;
  avg_return: number;
  days: number;
  market: string;
  by_market?: Record<string, Record<string, number>>;
}

// ============================================================
// Helpers
// ============================================================

const STATUS_LABEL_AR: Record<PickStatus, string> = {
  pending: 'قيد الانتظار',
  target_hit: 'تم الوصول للهدف',
  stop_hit: 'تم ضرب الوقف',
  expired: 'منتهي الصلاحية',
};

const STATUS_BADGE_CLASS: Record<PickStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  target_hit: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  stop_hit: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
  expired: 'bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-900/50 dark:text-zinc-400 dark:border-zinc-700',
};

function formatNumber(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPct(v: number | null | undefined, withSign = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sign = withSign && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function shortDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s.slice(0, 10);
    return d.toLocaleDateString('en-GB');
  } catch {
    return s.slice(0, 10);
  }
}

// ============================================================
// Stat Card Component
// ============================================================

interface StatCardProps {
  title: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  iconBg: string;
  valueColor?: string;
}


// ============================================================
// UnifiedTable Columns Definition
// ============================================================

const predictionColumns: Column<TrackedPick>[] = [
  {
    key: 'ticker',
    header: 'السهم',
    sortable: true,
    filterable: true,
    className: 'font-bold',
    render: (p) => (
      <div className="flex flex-col">
        <span className="text-sm">{p.ticker}</span>
        <span className="text-[10px] text-muted-foreground">
          {p.market}
        </span>
      </div>
    ),
  },
  {
    key: 'pick_date',
    header: 'تاريخ التوقع',
    sortable: true,
    className: 'text-xs text-muted-foreground',
    render: (p) => shortDate(p.pick_date),
  },
  {
    key: 'entry_price',
    header: 'الدخول',
    align: 'right',
    sortable: true,
    className: 'font-mono text-xs',
    render: (p) => formatNumber(p.entry_price),
  },
  {
    key: 'stop_loss',
    header: 'الوقف',
    align: 'right',
    sortable: true,
    className: 'font-mono text-xs text-rose-600 dark:text-rose-400',
    render: (p) => formatNumber(p.stop_loss),
  },
  {
    key: 'target_price',
    header: 'الهدف',
    align: 'right',
    sortable: true,
    className: 'font-mono text-xs text-emerald-600 dark:text-emerald-400',
    render: (p) => formatNumber(p.target_price),
  },
  {
    key: 'risk_reward',
    header: 'R/R',
    align: 'right',
    sortable: true,
    render: (p) => (
      <Badge
        variant="outline"
        className="font-mono text-[11px] border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
      >
        {formatNumber(p.risk_reward, 1)}
      </Badge>
    ),
  },
  {
    key: 'current_price',
    header: 'السعر الحالي',
    align: 'right',
    sortable: true,
    className: 'font-mono text-xs',
    render: (p) => (p.current_price !== null ? formatNumber(p.current_price) : '—'),
  },
  {
    key: 'change_vs_entry',
    header: 'الفرق',
    align: 'right',
    sortable: true,
    render: (p) => {
      if (p.current_price === null) return '—';
      const diff = p.current_price - p.entry_price;
      const cls = p.current_price > p.entry_price
        ? 'text-emerald-600 dark:text-emerald-400'
        : p.current_price < p.entry_price
          ? 'text-rose-600 dark:text-rose-400'
          : '';
      return (
        <span className={cn('font-mono text-xs font-bold', cls)}>
          {diff > 0 ? '+' : ''}
          {formatNumber(diff)}
          <span className="text-[9px] text-muted-foreground ml-0.5">
            ({formatPct((diff / p.entry_price) * 100, true)})
          </span>
        </span>
      );
    },
  },
  {
    key: 'profit_loss_pct',
    header: 'العائد %',
    align: 'right',
    sortable: true,
    render: (p) => {
      const pnl = p.profit_loss_pct;
      const pnlColor =
        pnl === null
          ? 'text-muted-foreground'
          : pnl >= 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400';
      return (
        <span className={cn('font-mono text-xs font-bold', pnlColor)}>
          {formatPct(pnl, true)}
        </span>
      );
    },
  },
  {
    key: 'status',
    header: 'الحالة',
    align: 'center',
    sortable: true,
    filterable: true,
    render: (p) => (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Badge
                variant="outline"
                className={cn(
                  'text-[11px] whitespace-nowrap',
                  STATUS_BADGE_CLASS[p.status]
                )}
              >
                {p.status === 'target_hit' && (
                  <TrendingUp className="h-3 w-3 ml-1" />
                )}
                {p.status === 'stop_hit' && (
                  <TrendingDown className="h-3 w-3 ml-1" />
                )}
                {p.status === 'pending' && (
                  <Clock className="h-3 w-3 ml-1" />
                )}
                {p.status === 'expired' && (
                  <Clock className="h-3 w-3 ml-1" />
                )}
                {STATUS_LABEL_AR[p.status]}
              </Badge>
            </span>
          </TooltipTrigger>
          {p.verification_date && (
            <TooltipContent side="top">
              <p className="text-xs">
                آخر تحقق: {shortDate(p.verification_date)}
              </p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    ),
  },
];

// ============================================================
// Main Component
// ============================================================

export function PredictionTrackingView() {
  const currentMarket = useAppStore((s) => s.currentMarket);

  const [stats, setStats] = useState<TrackingStats | null>(null);
  const [picks, setPicks] = useState<TrackedPick[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | PickStatus>('all');
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [generatingV40, setGeneratingV40] = useState(false);

  // fetch stats
  const fetchStats = useCallback(async (market: MarketType) => {
    setLoadingStats(true);
    try {
      const res = await fetch(
        `/api/predictions/tracking/stats?market=${market}&days=30`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (json.success && json.data) {
        setStats(json.data as TrackingStats);
      } else {
        setStats(null);
      }
    } catch {
      setStats(null);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  // fetch list
  const fetchList = useCallback(async (market: MarketType, status: 'all' | PickStatus) => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams({ market, limit: '200' });
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/predictions/tracking/list?${params.toString()}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setPicks(json.data as TrackedPick[]);
      } else {
        setPicks([]);
      }
    } catch {
      setPicks([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchStats(currentMarket);
  }, [currentMarket, fetchStats]);

  useEffect(() => {
    fetchList(currentMarket, statusFilter);
  }, [currentMarket, statusFilter, fetchList]);

  // verify handler
  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/predictions/tracking/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: currentMarket }),
      });
      const json = await res.json();
      if (json.success) {
        const d = json.data || {};
        toast.success(
          `تم التحقق: ${d.target_hit || 0} وصلت للهدف، ${d.stop_hit || 0} ضربت الوقف، ${d.expired || 0} منتهية`
        );
        // refresh
        await Promise.all([fetchStats(currentMarket), fetchList(currentMarket, statusFilter)]);
      } else {
        toast.error(json.error || 'فشل التحقق من التوقعات');
      }
    } catch (e: any) {
      toast.error(e?.message || 'فشل الاتصال بالخادم');
    } finally {
      setVerifying(false);
    }
  };

  const handleGenerateV40 = async () => {
    setGeneratingV40(true);
    toast.info('جاري تشغيل محرك التوقعات V40.2 وفحص السيولة اللحظية...');
    try {
      const res = await fetch('/api/admin/generate-predictions?type=intraday', {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم توليد التوقعات بنجاح!', {
          description: data.message || 'تم تحديث الفرص وحفظها في النظام',
        });
        refreshAll();
      } else {
        toast.error(data.error || 'فشل توليد التوقعات');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setGeneratingV40(false);
    }
  };

  const refreshAll = () => {
    fetchStats(currentMarket);
    fetchList(currentMarket, statusFilter);
  };

  // derived display values
  const display = useMemo(() => {
    const s = stats;
    if (!s) {
      return {
        total: '—',
        pending: '—',
        successRate: '—',
        failureRate: '—',
      };
    }
    return {
      total: String(s.total ?? 0),
      pending: String(s.pending ?? 0),
      successRate: `${(s.success_rate ?? 0).toFixed(1)}%`,
      failureRate: `${(s.failure_rate ?? 0).toFixed(1)}%`,
    };
  }, [stats]);

  return (
    <div className="space-y-4 p-3 sm:p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-emerald-100 dark:bg-emerald-950/50 p-2.5">
            <Trophy className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">تتبع التوقعات</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              متابعة نسبة نجاح التوقعات عبر الزمن
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MarketSelector size="sm" />
          {/* تم إزالة زرار "توليد توقعات V40.2" + "تحقق الآن" — كانوا بـ يسببوا نتائج عشوائية */}
          {/* التوقعات بـ تتولّد تلقائياً من V40.2 (cron job) — مش محتاجين تدخل يدوي */}
          <UnifiedPublishButton
            variant="outline"
            size="sm"
            title="تتبع التوقعات"
            content={`تتبع التوقعات — ${MARKET_NAMES_AR[currentMarket]}
إجمالي: ${display.total} · قيد الانتظار: ${display.pending}
نسبة النجاح: ${display.successRate} · نسبة الفشل: ${display.failureRate}

أحدث التوقعات:
${picks.slice(0, 10).map((p, i) => `${i + 1}. ${p.ticker} — دخول ${formatNumber(p.entry_price)} — هدف ${formatNumber(p.target_price)} — وقف ${formatNumber(p.stop_loss)} — R/R ${formatNumber(p.risk_reward, 1)} — ${STATUS_LABEL_AR[p.status]}`).join('\n')}`}
            filename={`prediction-tracking-${currentMarket}-${Date.now()}`}
            hashtags={['توقعات', 'EGX', 'بورصة']}
            triggerLabel="نشر"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={refreshAll}
          >
            <RefreshCw className="h-4 w-4 ml-1" />
            <span>تحديث</span>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {loadingStats ? (
          <>
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </>
        ) : (
          <>
            <StatCard
              title="إجمالي التوقعات"
              value={display.total}
              hint={`آخر ${stats?.days ?? 30} يوم — ${MARKET_NAMES_AR[currentMarket]}`}
              icon={<ListChecks className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
              iconBg="bg-emerald-100 dark:bg-emerald-950/50"
            />
            <StatCard
              title="قيد الانتظار"
              value={display.pending}
              hint="توقعات لم تُحل بعد"
              icon={<Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
              iconBg="bg-amber-100 dark:bg-amber-950/50"
              valueColor="text-amber-600 dark:text-amber-400"
            />
            <StatCard
              title="نسبة النجاح"
              value={display.successRate}
              hint={`وصلت للهدف: ${stats?.target_hit ?? 0}`}
              icon={<CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
              iconBg="bg-emerald-100 dark:bg-emerald-950/50"
              valueColor="text-emerald-600 dark:text-emerald-400"
            />
            <StatCard
              title="نسبة الفشل"
              value={display.failureRate}
              hint={`ضربت الوقف: ${stats?.stop_hit ?? 0}`}
              icon={<XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />}
              iconBg="bg-rose-100 dark:bg-rose-950/50"
              valueColor="text-rose-600 dark:text-rose-400"
            />
          </>
        )}
      </div>

      {/* Summary strip */}
      {!loadingStats && stats && (
        <Card className="bg-muted/40">
          <CardContent className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-emerald-600" />
                  <span className="text-muted-foreground">وصلت للهدف:</span>
                  <span className="font-bold text-emerald-600">{stats.target_hit ?? 0}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-rose-600" />
                  <span className="text-muted-foreground">ضربت الوقف:</span>
                  <span className="font-bold text-rose-600">{stats.stop_hit ?? 0}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-zinc-500" />
                  <span className="text-muted-foreground">منتهية:</span>
                  <span className="font-bold text-zinc-600 dark:text-zinc-300">{stats.expired ?? 0}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Gauge className="h-4 w-4 text-amber-600" />
                  <span className="text-muted-foreground">متوسط العائد:</span>
                  <span
                    className={cn(
                      'font-bold',
                      (stats.avg_return ?? 0) >= 0
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    )}
                  >
                    {formatPct(stats.avg_return, true)}
                  </span>
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                التوقعات المحلولة: {stats.resolved ?? 0} من {stats.total ?? 0}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter + Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-emerald-600" />
                سجل التوقعات
              </CardTitle>
              <CardDescription className="mt-1">
                {picks.length} توقع — {MARKET_NAMES_AR[currentMarket]}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">الحالة:</span>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as 'all' | PickStatus)}
              >
                <SelectTrigger className="h-9 w-[160px]" aria-label="فلتر الحالة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="pending">قيد الانتظار</SelectItem>
                  <SelectItem value="target_hit">وصلت للهدف</SelectItem>
                  <SelectItem value="stop_hit">ضربت الوقف</SelectItem>
                  <SelectItem value="expired">منتهية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-2">
          <UnifiedTable<TrackedPick>
            columns={predictionColumns}
            data={picks}
            loading={loadingList}
            loadingRows={8}
            emptyTextAr="لا توجد توقعات متتبعة بعد — ستظهر التوقعات هنا تلقائياً عند توليدها."
            keyField="id"
            dense
            columnToggle
            filterable
            maxHeight="h-[60vh] sm:h-[65vh]"
            rowClassName={() => 'hover:bg-muted/40'}
          />
        </CardContent>
      </Card>

      {/* Info note */}
      <Card className="bg-muted/30">
        <CardContent className="p-3 text-xs text-muted-foreground text-center">
          <p>
            💡 يتم حفظ كل توقع تلقائياً عند توليدها،
            ويتم التحقق منها يومياً مقابل السعر الحالي لمعرفة ما إذا كانت وصلت للهدف أو ضربت الوقف.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default PredictionTrackingView;

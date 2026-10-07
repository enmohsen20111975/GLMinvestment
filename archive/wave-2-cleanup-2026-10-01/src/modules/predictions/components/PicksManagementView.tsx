'use client';
import { StatCard } from '@/components/ui/stat-card';

/**
 * PicksManagementView — فن إدارة التوقعات
 * ===========================================
 * تبويب جديد يجمع:
 *  1. توقعات اليوم (Top 5) — أعلى 5 توقعات بناءً على نسبة الثقة
 *  2. إدارة المراكز المفتوحة — HOLD/TRAILING/EXIT/ADD/REDUCE لكل مركز
 *
 * فلسفة المكون:
 *  - المستثمر الذكي لا يشتري 10 أسهم في اليوم — يختار أعلى 5 فقط
 *  - كل توقع له نسبة ثقة (50-95%) تحدد جودتها
 *  - كل مركز مفتوح له إشارة إدارة واضحة (انتظر/زود/بيع/خفّض)
 *
 * Backend: /api/predictions/daily-picks + /api/predictions/active-management
 * Author: GLMinvestment v3.4.43
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Target, Trophy, RefreshCw, Activity, TrendingUp, TrendingDown,
  Shield, AlertTriangle, Clock, CheckCircle2, XCircle, Flame,
  Plus, Minus, DollarSign, ArrowUpCircle, ArrowDownCircle,
  Zap, Eye, Sparkles, Crown, Award, Calendar, ArrowUp, ArrowDown,
  Globe,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PredictionCard } from '@/components/shared/PredictionCard';

// ============================================================
// Types
// ============================================================
interface DailyPick {
  id: number;
  ticker: string;
  signal: string;
  signal_ar?: string;
  signal_type?: string;
  entry_price: number;
  target_price: number;
  target_price_2?: number;
  stop_loss: number;
  confidence: number;
  tier?: string;
  tier_ar?: string;
  risk_reward?: number;
  persona?: string;
  explosive_score?: number;
  explosive_label?: string;
  technical_score?: number;
  market?: string;
  prediction_date: string;
}

interface DailyStats {
  total_for_day: number;
  avg_confidence: number;
  buy_count: number;
  sell_count: number;
  hold_count: number;
}

interface ManagementAdvice {
  prediction_id: number;
  ticker: string;
  signal: string;
  action: string;
  action_ar: string;
  reason_ar: string;
  new_stop: number | null;
  new_target: number | null;
  current_return_pct: number;
  target_progress_pct: number;
  holding_days: number;
  urgency: 'low' | 'medium' | 'high';
  suggested_size_pct: number;
  emoji: string;
  current_price?: number;
  entry_price?: number;
  target_price?: number;
  target_price_2?: number;
  stop_loss?: number;
  prediction_date?: string;
  highest_price_reached?: number;
  lowest_price_reached?: number;
  market?: string;
  persona?: string;
  confidence?: number;
  master_score?: number;
}

interface ManagementSummary {
  total: number;
  high_urgency: number;
  medium_urgency: number;
  low_urgency: number;
  avg_progress: number;
  avg_return: number;
  actions: Record<string, number>;
}

// ============================================================
// Helpers
// ============================================================
const TIER_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  TOP_PICK: {
    bg: 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-300 dark:border-amber-700',
    icon: <Crown className="h-4 w-4" />,
  },
  STRONG: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-300 dark:border-emerald-700',
    icon: <Star className="h-4 w-4" />,
  },
  WATCH: {
    bg: 'bg-teal-50 dark:bg-teal-950/30',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-300 dark:border-teal-700',
    icon: <Eye className="h-4 w-4" />,
  },
  SKIP: {
    bg: 'bg-zinc-50 dark:bg-zinc-900/30',
    text: 'text-zinc-600 dark:text-zinc-400',
    border: 'border-zinc-300 dark:border-zinc-700',
    icon: <XCircle className="h-4 w-4" />,
  },
};

const ACTION_STYLES: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  HOLD: { color: 'text-zinc-700 dark:text-zinc-300', bg: 'bg-zinc-100 dark:bg-zinc-800', icon: <Clock className="h-4 w-4" /> },
  TRAILING_STOP: { color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950/50', icon: <TrendingUp className="h-4 w-4" /> },
  TAKE_PROFIT_T1: { color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950/50', icon: <DollarSign className="h-4 w-4" /> },
  TAKE_PROFIT_T2: { color: 'text-emerald-800 dark:text-emerald-200', bg: 'bg-emerald-200 dark:bg-emerald-900/50', icon: <Trophy className="h-4 w-4" /> },
  ADD: { color: 'text-teal-700 dark:text-teal-300', bg: 'bg-teal-100 dark:bg-teal-950/50', icon: <Plus className="h-4 w-4" /> },
  REDUCE: { color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-950/50', icon: <Minus className="h-4 w-4" /> },
  EXIT: { color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-100 dark:bg-rose-950/50', icon: <AlertTriangle className="h-4 w-4" /> },
};

const URGENCY_STYLES: Record<string, string> = {
  high: 'border-r-rose-500 bg-rose-50/50 dark:bg-rose-950/20',
  medium: 'border-r-amber-500 bg-amber-50/50 dark:bg-amber-950/20',
  low: 'border-r-zinc-300 dark:border-r-zinc-700',
};

function Star({ className }: { className?: string }) {
  return <Sparkles className={className} />;
}

function formatPct(v: number | undefined | null, withSign = false): string {
  if (v === undefined || v === null || isNaN(v)) return '—';
  const s = withSign && v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

function formatPrice(v: number | undefined | null): string {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return v.toFixed(2);
}

// ============================================================
// Sub-Components
// ============================================================
// UI-STABILITY fix (2026-09-28): wrap DailyPickCard + ManagementRow in
// React.memo so background data refreshes don't needlessly re-render every
// card/row that hasn't changed.
const DailyPickCard = memo(function DailyPickCard({ pick, rank }: { pick: DailyPick; rank: number }) {
  const tier = pick.tier || 'WATCH';
  const style = TIER_STYLES[tier] || TIER_STYLES.WATCH;
  const isBuy = pick.signal_type === 'BUY' || pick.signal === 'BUY' || pick.signal === 'STRONG_BUY' || pick.signal === 'ACCUMULATE';
  const potential = pick.entry_price > 0 && pick.target_price > 0
    ? ((pick.target_price - pick.entry_price) / pick.entry_price) * 100 * (isBuy ? 1 : -1)
    : 0;
  const risk = pick.entry_price > 0 && pick.stop_loss > 0
    ? Math.abs(((pick.stop_loss - pick.entry_price) / pick.entry_price) * 100)
    : 0;

  const signalKind: 'buy' | 'strong_buy' | 'hold' | 'sell' =
    pick.signal === 'STRONG_BUY' ? 'strong_buy' :
    pick.signal === 'BUY' || pick.signal === 'ACCUMULATE' ? 'buy' :
    pick.signal === 'HOLD' ? 'hold' : 'sell';

  return (
    <PredictionCard
      ticker={pick.ticker}
      signal={pick.signal}
      signalAr={pick.signal_ar || pick.signal}
      signalKind={signalKind}
      entryPrice={pick.entry_price}
      targetPrice={pick.target_price}
      stopLoss={pick.stop_loss}
      riskReward={pick.risk_reward}
      confidence={pick.confidence}
      masterScore={pick.technical_score}
      compact
      showTechnical={false}
      rankBadge={`#${rank}`}
      className={cn('border-2', style.border, style.bg)}
      actionSlot={
        <Badge variant="outline" className={cn('text-xs', style.text, style.border, style.bg)}>
          {style.icon}
          <span className="mr-1">{pick.tier_ar || tier}</span>
        </Badge>
      }
      footer={
        <div className="space-y-2">
          {/* Persona + signal line */}
          <p className="text-xs text-muted-foreground">
            {(pick.signal_ar || pick.signal)} • {pick.persona || 'balanced'}
          </p>

          {/* Footer: Potential vs Risk + R/R + Explosive badge */}
          <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <ArrowUpCircle className="h-3.5 w-3.5" />
                <span className="font-semibold">{formatPct(potential, true)}</span>
                <span className="text-muted-foreground">العائد المتوقع</span>
              </span>
              <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                <ArrowDownCircle className="h-3.5 w-3.5" />
                <span className="font-semibold">-{risk.toFixed(1)}%</span>
                <span className="text-muted-foreground">المخاطرة</span>
              </span>
            </div>
          </div>

          {/* Target price 2 if present */}
          {pick.target_price_2 ? (
            <div className="text-xs text-muted-foreground">
              الهدف الثاني:{' '}
              <span className="font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums" dir="ltr">
                {formatPrice(pick.target_price_2)}
              </span>
            </div>
          ) : null}

          {/* Explosive badge */}
          {pick.explosive_label && (pick.explosive_score || 0) > 0 && (
            <div className="flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                {pick.explosive_label} — زخم انفجاري
              </span>
            </div>
          )}
        </div>
      }
    />
  );
});

const ManagementRow = memo(function ManagementRow({ advice }: { advice: ManagementAdvice }) {
  const actionStyle = ACTION_STYLES[advice.action] || ACTION_STYLES.HOLD;
  const isProfit = (advice.current_return_pct || 0) > 0;
  const urgencyClass = URGENCY_STYLES[advice.urgency] || URGENCY_STYLES.low;

  // تنسيق تاريخ التوقع
  const predDate = advice.prediction_date
    ? new Date(advice.prediction_date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  // حساب أعلى/أقل سعر من بداية التوقع
  const highest = advice.highest_price_reached && advice.highest_price_reached > 0 ? advice.highest_price_reached : null;
  const lowest = advice.lowest_price_reached && advice.lowest_price_reached > 0 ? advice.lowest_price_reached : null;

  return (
    <div className={cn('rounded-lg border-r-4 p-3 transition-all hover:shadow-sm', urgencyClass)}>
      <div className="flex items-start justify-between gap-3">
        {/* Left: Ticker + signal + date */}
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="text-2xl">{advice.emoji}</div>
          <div>
            <div className="font-bold text-base">{advice.ticker}</div>
            <div className="text-xs text-muted-foreground">
              {advice.signal === 'BUY' || advice.signal === 'STRONG_BUY' || advice.signal === 'ACCUMULATE' ? 'شراء' : advice.signal === 'SELL' ? 'بيع' : advice.signal}
              {' • '}
              {advice.holding_days} يوم
            </div>
            {predDate && (
              <div className="text-xs text-muted-foreground flex items-center gap-0.5">
                <Calendar className="h-3 w-3" />
                {predDate}
              </div>
            )}
          </div>
        </div>

        {/* Middle: Prices + progress + high/low */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">الدخول</div>
            <div className="font-semibold">{formatPrice(advice.entry_price)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">الحالي</div>
            <div className="font-semibold">{formatPrice(advice.current_price)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">العائد</div>
            <div className={cn('font-bold', isProfit ? 'text-emerald-600' : 'text-rose-600')}>
              {formatPct(advice.current_return_pct, true)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">التقدم للهدف</div>
            <div className="font-semibold">{advice.target_progress_pct.toFixed(0)}%</div>
          </div>
          {/* أعلى/أقل سعر من بداية التوقع */}
          <div className="hidden sm:block">
            <div className="text-muted-foreground">أعلى/أقل</div>
            <div className="flex items-center gap-1">
              {highest ? (
                <span className="text-emerald-600 font-semibold flex items-center gap-0.5">
                  <ArrowUp className="h-3 w-3" />{formatPrice(highest)}
                </span>
              ) : '—'}
              {' / '}
              {lowest ? (
                <span className="text-rose-600 font-semibold flex items-center gap-0.5">
                  <ArrowDown className="h-3 w-3" />{formatPrice(lowest)}
                </span>
              ) : '—'}
            </div>
          </div>
        </div>

        {/* Right: Action badge */}
        <div className="flex flex-col items-end gap-1 min-w-[140px]">
          <Badge className={cn('text-xs font-bold', actionStyle.bg, actionStyle.color)}>
            {actionStyle.icon}
            <span className="mr-1">{advice.action_ar}</span>
          </Badge>
          {advice.new_stop && (
            <div className="text-xs text-emerald-700 dark:text-emerald-300">
              وقف جديد: {formatPrice(advice.new_stop)}
            </div>
          )}
          {advice.suggested_size_pct !== 100 && (
            <div className="text-xs text-muted-foreground">
              حجم مقترح: {advice.suggested_size_pct}%
            </div>
          )}
        </div>
      </div>

      {/* Reason */}
      <div className="mt-2 text-xs text-muted-foreground bg-background/50 rounded p-2">
        💡 {advice.reason_ar}
      </div>

      {/* Progress bar */}
      <div className="mt-2">
        <Progress
          value={Math.min(100, advice.target_progress_pct)}
          className="h-1"
          indicatorClassName={
            advice.target_progress_pct >= 100 ? 'bg-emerald-500' :
            advice.target_progress_pct >= 50 ? 'bg-amber-500' : 'bg-teal-500'
          }
        />
      </div>
    </div>
  );
});

// ============================================================
// Main Component
// ============================================================
export function PicksManagementView() {
  const [picks, setPicks] = useState<DailyPick[]>([]);
  const [picksStats, setPicksStats] = useState<DailyStats | null>(null);
  const [loadingPicks, setLoadingPicks] = useState(true);
  const [picksError, setPicksError] = useState<string | null>(null);

  const [management, setManagement] = useState<ManagementAdvice[]>([]);
  const [mgmtSummary, setMgmtSummary] = useState<ManagementSummary | null>(null);
  const [loadingMgmt, setLoadingMgmt] = useState(true);
  const [mgmtError, setMgmtError] = useState<string | null>(null);

  const [picksDate, setPicksDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [persona, setPersona] = useState<string>('all');
  const [market, setMarket] = useState<string>('EGX');
  const [mgmtFilter, setMgmtFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [refreshing, setRefreshing] = useState(false);

  // ---- Fetch Daily Picks ----
  // UI-STABILITY fix (2026-09-28): silent=true → setRefreshingPicks(true) instead
  // of setLoadingPicks(true). Skeleton only shows on very first load when picks
  // is still empty. Background refresh keeps existing cards visible.
  const fetchPicks = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoadingPicks(true);
      setPicksError(null);
    }
    try {
      const params = new URLSearchParams({
        date: picksDate,
        limit: '5',
        min_confidence: '50',
        market: market,
      });
      if (persona !== 'all') params.set('persona', persona);
      const res = await fetch(`/api/predictions/daily-picks?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('تعذّر جلب التوقعات. يرجى المحاولة مرة أخرى.');
      }
      const json = await res.json();
      if (json.success) {
        setPicks(json.picks || []);
        setPicksStats(json.stats || null);
      } else {
        setPicks([]);
        setPicksStats(null);
        setPicksError(json.error || 'تعذّر جلب التوقعات. يرجى المحاولة مرة أخرى.');
      }
    } catch (e) {
      console.error('fetch picks error:', e);
      if (!silent) {
        setPicks([]);
        setPicksError('تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
      }
    } finally {
      setLoadingPicks(false);
      setRefreshing(false);
    }
  }, [picksDate, persona, market]);

  // ---- Fetch Active Management ----
  // UI-STABILITY fix (2026-09-28): silent=true → setRefreshing(true) instead
  // of setLoadingMgmt(true). Skeleton only shows on very first load.
  const fetchManagement = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoadingMgmt(true);
      setMgmtError(null);
    }
    try {
      const params = new URLSearchParams({ limit: '100', market: market });
      if (persona !== 'all') params.set('persona', persona);
      const res = await fetch(`/api/predictions/active-management?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('تعذّر جلب إدارة المراكز. يرجى المحاولة مرة أخرى.');
      }
      const json = await res.json();
      if (json.success) {
        setManagement(json.management || []);
        setMgmtSummary(json.summary || null);
      } else {
        setManagement([]);
        setMgmtSummary(null);
        setMgmtError(json.error || 'تعذّر جلب إدارة المراكز. يرجى المحاولة مرة أخرى.');
      }
    } catch (e) {
      console.error('fetch management error:', e);
      if (!silent) {
        setManagement([]);
        setMgmtError('تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
      }
    } finally {
      setLoadingMgmt(false);
      setRefreshing(false);
    }
  }, [persona, market]);

  useEffect(() => {
    fetchPicks();
  }, [fetchPicks]);

  useEffect(() => {
    fetchManagement();
  }, [fetchManagement]);

  const handleRefresh = async () => {
    setRefreshing(true);
    // UI-STABILITY fix (2026-09-28): pass silent=true to keep cards/rows visible
    await Promise.all([fetchPicks(true), fetchManagement(true)]);
    setRefreshing(false);
    toast.success('تم تحديث التوقعات والإدارة');
  };

  // Filter management by urgency + استبعاد المراكز بدون بيانات
  const filteredManagement = useMemo(() => {
    let filtered = management;
    // استبعاد المراكز بدون سعر دخول أو سعر حالي
    filtered = filtered.filter((m) => (m.entry_price || 0) > 0);
    if (mgmtFilter !== 'all') {
      filtered = filtered.filter((m) => m.urgency === mgmtFilter);
    }
    return filtered;
  }, [management, mgmtFilter]);

  return (
    <div className="space-y-4 p-3 sm:p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-purple-100 dark:bg-purple-950/50 p-2.5">
            <Crown className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">إدارة التوقعات</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              فن اختيار ومراقبة التوقعات — أعلى 5 توقعات/يوم + إدارة المراكز المفتوحة
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={market} onValueChange={setMarket}>
            <SelectTrigger className="h-9 w-[140px]" aria-label="السوق">
              <Globe className="h-4 w-4 ml-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EGX">🇪🇬 البورصة المصرية</SelectItem>
              <SelectItem value="KSA">🇸🇦 تداول السعودية</SelectItem>
              <SelectItem value="KSE">🇰🇼 بورصة الكويت</SelectItem>
              <SelectItem value="QSE">🇶🇦 بورصة قطر</SelectItem>
              <SelectItem value="DFM">🇦🇪 سوق دبي</SelectItem>
              <SelectItem value="all">🌍 كل الأسواق</SelectItem>
            </SelectContent>
          </Select>
          <Select value={persona} onValueChange={setPersona}>
            <SelectTrigger className="h-9 w-[140px]" aria-label="الشخصية">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل التوقعات</SelectItem>
              <SelectItem value="balanced">⚖️ المتوازن</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="default"
            onClick={handleRefresh}
            disabled={refreshing}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <RefreshCw className={cn('h-4 w-4 ml-1', refreshing && 'animate-spin')} />
            <span>{refreshing ? 'جارٍ التحديث...' : 'تحديث'}</span>
          </Button>
        </div>
      </div>

      {/* Management Summary Cards */}
      {/* UI-STABILITY fix (2026-09-28): show summary whenever available — don't
          hide on silent refresh. Stable key prevents unmount/remount. */}
      {mgmtSummary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" key="picks-mgmt-summary-cards">
          <StatCard
            title="مراكز مفتوحة"
            value={mgmtSummary.total}
            hint="إجمالي التوقعات النشطة"
            icon={<Activity className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
            iconBg="bg-purple-100 dark:bg-purple-950/50"
          />
          <StatCard
            title="إلحاح عالي"
            value={mgmtSummary.high_urgency}
            hint="تحتاج إجراء فوري"
            icon={<AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />}
            iconBg="bg-rose-100 dark:bg-rose-950/50"
            valueColor="text-rose-600 dark:text-rose-400"
          />
          <StatCard
            title="متوسط التقدم"
            value={`${mgmtSummary.avg_progress}%`}
            hint={`متوسط العائد: ${formatPct(mgmtSummary.avg_return, true)}`}
            icon={<Target className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
            iconBg="bg-amber-100 dark:bg-amber-950/50"
            valueColor="text-amber-600 dark:text-amber-400"
          />
          <StatCard
            title="إجراءات HOLD"
            value={mgmtSummary.actions.HOLD || 0}
            hint={`EXIT: ${mgmtSummary.actions.EXIT || 0} • REDUCE: ${mgmtSummary.actions.REDUCE || 0}`}
            icon={<Clock className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />}
            iconBg="bg-zinc-100 dark:bg-zinc-800"
          />
        </div>
      )}

      {/* Section 1: Daily Picks (Top 5) */}
      {/* UI-STABILITY fix (2026-09-28): stable key on the picks section card so
          React doesn't unmount/remount it during silent refreshes. */}
      <Card key="picks-section-daily-picks">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Crown className="h-5 w-5 text-amber-600" />
                توقعات اليوم — أعلى 5
              </CardTitle>
              <CardDescription className="mt-1">
                التوقعات الأعلى ثقةً لهذا اليوم — منطق واقعي: لا تشتري أكثر من 5 أسهم/يوم
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={picksDate}
                onChange={(e) => setPicksDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* UI-STABILITY fix (2026-09-28): skeleton only on very first load (no picks yet). */}
          {(loadingPicks && picks.length === 0) ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full rounded-xl" />
              ))}
            </div>
          ) : picksError ? (
            <div className="p-8 text-center text-muted-foreground">
              <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-amber-500" />
              <p className="font-medium text-foreground">{picksError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => fetchPicks(true)}
              >
                <RefreshCw className="h-4 w-4 ml-2" />
                إعادة المحاولة
              </Button>
            </div>
          ) : picks.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">لا توجد توقعات عالية الثقة لهذا اليوم</p>
              <p className="text-sm mt-1">
                جرب تاريخاً آخر أو اختر شخصية مختلفة. التوقعات تُفلتر عند confidence ≥ 50%.
              </p>
              {picksStats && picksStats.total_for_day > 0 && (
                <p className="text-xs mt-2 text-amber-600 dark:text-amber-400">
                  يوجد {picksStats.total_for_day} توقع لهذا اليوم لكن كلها تحت 50% ثقة
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Stats strip */}
              {picksStats && (
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>إجمالي اليوم: <strong className="text-foreground">{picksStats.total_for_day}</strong></span>
                  <span>متوسط الثقة: <strong className="text-foreground">{picksStats.avg_confidence}%</strong></span>
                  <span className="text-emerald-600">شراء: {picksStats.buy_count}</span>
                  <span className="text-rose-600">بيع: {picksStats.sell_count}</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {picks.map((p, i) => (
                  <DailyPickCard key={p.id} pick={p} rank={i + 1} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Active Positions Management */}
      {/* UI-STABILITY fix (2026-09-28): stable key on the mgmt section card so
          React doesn't unmount/remount it during silent refreshes. */}
      <Card key="picks-section-active-management">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-purple-600" />
                إدارة المراكز المفتوحة
              </CardTitle>
              <CardDescription className="mt-1">
                توقعات إدارة لكل مركز نشط — انتظر / زود / بيع / خفّض — فن إدارة المحفظة
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">فلترة:</span>
              <Select value={mgmtFilter} onValueChange={(v) => setMgmtFilter(v as 'all' | 'high' | 'medium' | 'low')}>
                <SelectTrigger className="h-9 w-[140px]" aria-label="فلتر الإلحاح">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل ({management.length})</SelectItem>
                  <SelectItem value="high">🚨 عالي ({management.filter((m) => m.urgency === 'high').length})</SelectItem>
                  <SelectItem value="medium">⚠️ متوسط ({management.filter((m) => m.urgency === 'medium').length})</SelectItem>
                  <SelectItem value="low">⏳ منخفض ({management.filter((m) => m.urgency === 'low').length})</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* UI-STABILITY fix (2026-09-28): skeleton only on very first load (no data yet). */}
          {(loadingMgmt && management.length === 0) ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : mgmtError ? (
            <div className="p-8 text-center text-muted-foreground">
              <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-amber-500" />
              <p className="font-medium text-foreground">{mgmtError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => fetchManagement(true)}
              >
                <RefreshCw className="h-4 w-4 ml-2" />
                إعادة المحاولة
              </Button>
            </div>
          ) : filteredManagement.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">لا توجد مراكز مفتوحة</p>
              <p className="text-sm mt-1">
                ستظهر المراكز هنا عند توليد توقعات جديدة.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[60vh] w-full" dir="rtl">
              <div className="space-y-2 pr-1">
                {filteredManagement.map((m) => (
                  <ManagementRow key={`${m.prediction_id}-${m.ticker}`} advice={m} />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Educational note */}
      <Card className="bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800" key="picks-educational-note">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Award className="h-5 w-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-purple-900 dark:text-purple-100 space-y-1">
              <p className="font-semibold">فلسفة الإدارة الذكية</p>
              <ul className="text-xs space-y-1 text-purple-800 dark:text-purple-200 list-disc list-inside">
                <li>المستثمر الذكي لا يشتري 10 أسهم في اليوم — يختار أعلى 5 فقط بناءً على الثقة</li>
                <li>كل توقع له نسبة ثقة (50-95%): ≥80% اختيار مميز، 65-79% قوي، 50-64% متابعة</li>
                <li>كل مركز مفتوح له إشارة إدارة واضحة: انتظر، ارفع الوقف، بع جزء، زود، خفّض، أو اخرج</li>
                <li>الإجراءات الحمراء (🛑 EXIT) عاجلة — نفّذها فوراً لحماية رأس المال</li>
                <li>الإجراءات الصفراء (💰 TAKE_PROFIT) — بع جزءاً وارفع الوقف إلى نقطة الدخول</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default PicksManagementView;

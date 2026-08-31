'use client';
import { StatCard } from '@/components/ui/stat-card';

/**
 * PicksManagementView — فن إدارة التوصيات
 * ===========================================
 * تبويب جديد يجمع:
 *  1. توصيات اليوم (Top 5) — أعلى 5 توصيات بناءً على نسبة الثقة
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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
function DailyPickCard({ pick, rank }: { pick: DailyPick; rank: number }) {
  const tier = pick.tier || 'WATCH';
  const style = TIER_STYLES[tier] || TIER_STYLES.WATCH;
  const isBuy = pick.signal_type === 'BUY' || pick.signal === 'BUY' || pick.signal === 'STRONG_BUY' || pick.signal === 'ACCUMULATE';
  const potential = pick.entry_price > 0 && pick.target_price > 0
    ? ((pick.target_price - pick.entry_price) / pick.entry_price) * 100 * (isBuy ? 1 : -1)
    : 0;
  const risk = pick.entry_price > 0 && pick.stop_loss > 0
    ? Math.abs(((pick.stop_loss - pick.entry_price) / pick.entry_price) * 100)
    : 0;

  return (
    <Card className={cn('relative overflow-hidden border-2 transition-all hover:shadow-lg', style.border, style.bg)}>
      {/* Rank badge */}
      <div className="absolute top-3 left-3 z-10">
        <div className={cn('flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm', style.bg, style.text)}>
          #{rank}
        </div>
      </div>

      <CardContent className="p-4 pt-4">
        {/* Header: Ticker + Signal */}
        <div className="flex items-start justify-between mb-3 pr-10">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-bold">{pick.ticker}</h3>
              <Badge variant="outline" className={cn('text-xs', style.text, style.border)}>
                {style.icon}
                <span className="mr-1">{pick.tier_ar || tier}</span>
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {pick.signal_ar || pick.signal} • {pick.persona || 'balanced'}
            </p>
          </div>
          <Badge
            className={cn(
              'text-sm font-bold',
              isBuy ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
            )}
          >
            {isBuy ? <TrendingUp className="h-3 w-3 ml-1" /> : <TrendingDown className="h-3 w-3 ml-1" />}
            {(pick.signal_ar || pick.signal)?.replace('STRONG_', '')}
          </Badge>
        </div>

        {/* Confidence bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">نسبة الثقة</span>
            <span className={cn('font-bold', style.text)}>{pick.confidence.toFixed(1)}%</span>
          </div>
          <Progress
            value={pick.confidence}
            className="h-2"
            indicatorClassName={cn(
              pick.confidence >= 80 ? 'bg-amber-500' :
              pick.confidence >= 65 ? 'bg-emerald-500' :
              pick.confidence >= 50 ? 'bg-teal-500' : 'bg-zinc-400'
            )}
          />
        </div>

        {/* Price grid */}
        <div className="grid grid-cols-3 gap-2 text-center mb-3">
          <div className="rounded-lg bg-background/50 p-2">
            <div className="text-xs text-muted-foreground">الدخول</div>
            <div className="font-bold text-sm">{formatPrice(pick.entry_price)}</div>
          </div>
          <div className="rounded-lg bg-emerald-50/50 dark:bg-emerald-950/30 p-2">
            <div className="text-xs text-emerald-700 dark:text-emerald-300">الهدف</div>
            <div className="font-bold text-sm text-emerald-700 dark:text-emerald-300">{formatPrice(pick.target_price)}</div>
          </div>
          <div className="rounded-lg bg-rose-50/50 dark:bg-rose-950/30 p-2">
            <div className="text-xs text-rose-700 dark:text-rose-300">الوقف</div>
            <div className="font-bold text-sm text-rose-700 dark:text-rose-300">{formatPrice(pick.stop_loss)}</div>
          </div>
        </div>

        {/* Footer: Potential vs Risk */}
        <div className="flex items-center justify-between text-xs">
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
          {pick.risk_reward ? (
            <Badge variant="outline" className="text-xs">
              R/R {pick.risk_reward.toFixed(2)}
            </Badge>
          ) : null}
        </div>

        {/* Explosive badge */}
        {pick.explosive_label && pick.explosive_score > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 text-orange-500" />
            <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
              {pick.explosive_label} — زخم انفجاري
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ManagementRow({ advice }: { advice: ManagementAdvice }) {
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
}

// ============================================================
// Main Component
// ============================================================
export function PicksManagementView() {
  const [picks, setPicks] = useState<DailyPick[]>([]);
  const [picksStats, setPicksStats] = useState<DailyStats | null>(null);
  const [loadingPicks, setLoadingPicks] = useState(true);

  const [management, setManagement] = useState<ManagementAdvice[]>([]);
  const [mgmtSummary, setMgmtSummary] = useState<ManagementSummary | null>(null);
  const [loadingMgmt, setLoadingMgmt] = useState(true);

  const [picksDate, setPicksDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [persona, setPersona] = useState<string>('all');
  const [market, setMarket] = useState<string>('EGX');
  const [mgmtFilter, setMgmtFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [refreshing, setRefreshing] = useState(false);

  // ---- Fetch Daily Picks ----
  const fetchPicks = useCallback(async () => {
    setLoadingPicks(true);
    try {
      const params = new URLSearchParams({
        date: picksDate,
        limit: '5',
        min_confidence: '50',
        market: market,
      });
      if (persona !== 'all') params.set('persona', persona);
      const res = await fetch(`/api/predictions/daily-picks?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setPicks(json.picks || []);
        setPicksStats(json.stats || null);
      } else {
        setPicks([]);
        setPicksStats(null);
      }
    } catch (e) {
      console.error('fetch picks error:', e);
      setPicks([]);
    } finally {
      setLoadingPicks(false);
    }
  }, [picksDate, persona, market]);

  // ---- Fetch Active Management ----
  const fetchManagement = useCallback(async () => {
    setLoadingMgmt(true);
    try {
      const params = new URLSearchParams({ limit: '100', market: market });
      if (persona !== 'all') params.set('persona', persona);
      const res = await fetch(`/api/predictions/active-management?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setManagement(json.management || []);
        setMgmtSummary(json.summary || null);
      } else {
        setManagement([]);
        setMgmtSummary(null);
      }
    } catch (e) {
      console.error('fetch management error:', e);
      setManagement([]);
    } finally {
      setLoadingMgmt(false);
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
    await Promise.all([fetchPicks(), fetchManagement()]);
    setRefreshing(false);
    toast.success('تم تحديث التوصيات والإدارة');
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
            <h2 className="text-xl sm:text-2xl font-bold">إدارة التوصيات</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              فن اختيار ومراقبة التوصيات — أعلى 5 توصيات/يوم + إدارة المراكز المفتوحة
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
              <SelectItem value="all">كل التوصيات</SelectItem>
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
      {!loadingMgmt && mgmtSummary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            title="مراكز مفتوحة"
            value={mgmtSummary.total}
            hint="إجمالي التوصيات النشطة"
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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Crown className="h-5 w-5 text-amber-600" />
                توصيات اليوم — أعلى 5
              </CardTitle>
              <CardDescription className="mt-1">
                التوصيات الأعلى ثقةً لهذا اليوم — منطق واقعي: لا تشتري أكثر من 5 أسهم/يوم
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
          {loadingPicks ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full rounded-xl" />
              ))}
            </div>
          ) : picks.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">لا توجد توصيات عالية الثقة لهذا اليوم</p>
              <p className="text-sm mt-1">
                جرب تاريخاً آخر أو اختر شخصية مختلفة. التوصيات تُفلتر عند confidence ≥ 50%.
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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-purple-600" />
                إدارة المراكز المفتوحة
              </CardTitle>
              <CardDescription className="mt-1">
                توصيات إدارة لكل مركز نشط — انتظر / زود / بيع / خفّض — فن إدارة المحفظة
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
          {loadingMgmt ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : filteredManagement.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">لا توجد مراكز مفتوحة</p>
              <p className="text-sm mt-1">
                ستظهر المراكز هنا عند توليد توصيات جديدة.
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
      <Card className="bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
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

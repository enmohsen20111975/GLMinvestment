'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Target,
  Eye,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Flame,
  Zap,
  Bitcoin,
  Calendar,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { LegalDisclaimerFooter } from '@/components/legal/DisclaimerBanner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TomorrowPrediction {
  id: number;
  ticker: string;
  name: string;
  market: string;
  signal: string;
  signal_type: string;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  master_score: number | null;
  technical_score: number | null;
  confidence: number | null;
  r_multiple: number | null;
  risk_reward_ratio: number | null;
  prediction_date: string;
  target_date: string | null;
  session_date: string;
  status: string;
  reason: string | null;
  indicators_json: string | null;
}

interface WatchlistItem {
  id: number;
  ticker: string;
  name: string;
  market: string;
  watch_type: string;
  watch_reason: string;
  current_price: number;
  change_percent: number;
  volume: number;
  volume_surge: number;
  rsi: number | null;
  ma_50: number | null;
  distance_from_ma50: number | null;
  near_52w_high: number | null;
  near_52w_low: number | null;
  session_date: string;
  priority: string;
}

interface ActiveStatus {
  id: number;
  ticker: string;
  name: string;
  market: string;
  original_signal: string;
  original_entry_price: number;
  original_target_price: number | null;
  original_stop_loss: number | null;
  original_prediction_date: string;
  current_price: number;
  current_change_percent: number;
  highest_price_reached: number | null;
  lowest_price_reached: number | null;
  progress_percent: number;
  distance_to_target: number;
  distance_to_stop: number;
  status: string;
  expected_action: string;
  session_date: string;
}

interface ApiResponse {
  success: boolean;
  session_date: string;
  stats: {
    predictions_count: number;
    buy_signals: number;
    sell_signals: number;
    active_status_count: number;
    target_hit: number;
    near_target: number;
    danger: number;
    watchlist_count: number;
    high_priority: number;
  };
  predictions: TomorrowPrediction[];
  active_status: ActiveStatus[];
  watchlist: WatchlistItem[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPrice(n: number | null, market?: string): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const prefix = market === 'CRYPTO' ? '$' : '';
  if (market === 'CRYPTO') {
    if (n >= 1000) return prefix + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1) return prefix + n.toFixed(2);
    return prefix + n.toFixed(4);
  }
  return prefix + n.toFixed(2);
}

function formatNumber(n: number | null, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(digits) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(digits) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(digits) + 'K';
  return n.toFixed(digits);
}

function formatPercent(n: number | null): { text: string; positive: boolean } {
  if (n === null || n === undefined || Number.isNaN(n))
    return { text: '—', positive: false };
  return { text: (n >= 0 ? '+' : '') + n.toFixed(2) + '%', positive: n >= 0 };
}

const SIGNAL_COLORS: Record<string, string> = {
  BUY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200',
  STRONG_BUY: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200 border-emerald-300 font-bold',
  SELL: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200',
  STRONG_SELL: 'bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200 border-red-300 font-bold',
  NEUTRAL: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200',
};

const STATUS_COLORS: Record<string, string> = {
  TARGET_HIT: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  NEAR_TARGET: 'bg-amber-100 text-amber-800 border-amber-200',
  PROGRESSING: 'bg-blue-100 text-blue-800 border-blue-200',
  FLAT: 'bg-gray-100 text-gray-700 border-gray-200',
  PULLBACK: 'bg-orange-100 text-orange-800 border-orange-200',
  DANGER: 'bg-red-100 text-red-800 border-red-200',
  STOP_HIT: 'bg-rose-100 text-rose-800 border-rose-200',
};

const STATUS_AR: Record<string, string> = {
  TARGET_HIT: '🎯 تحقق الهدف',
  NEAR_TARGET: '📈 قرب الهدف',
  PROGRESSING: '✅ سير طبيعي',
  FLAT: '➡️ ثابت',
  PULLBACK: '⚠️ ارتداد',
  DANGER: '🔴 خطر',
  STOP_HIT: '🛑 ضرب الوقف',
};

const WATCH_TYPE_AR: Record<string, string> = {
  VOLUME_SURGE: 'انفجار سيولة',
  OVERSOLD: 'تشبع بيعي',
  OVERBOUGHT: 'تشبع شرائي',
  NEAR_52W_HIGH: 'قرب القمة',
  NEAR_52W_LOW: 'قرب القاع',
  TOP_MOVER: 'حركة قوية',
  NEAR_BREAKOUT: 'قرب كسر',
};

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: 'bg-red-100 text-red-800 border-red-200',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-200',
  LOW: 'bg-gray-100 text-gray-700 border-gray-200',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function TomorrowPredictionsView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [generating, setGenerating] = useState(false);

  // ─── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `/api/tomorrow-predictions?market=${marketFilter}`,
        { cache: 'no-store' }
      );
      const json: ApiResponse = await res.json();
      if (json.success) {
        setData(json);
      } else {
        toast.error('فشل تحميل توقعات الغد');
      }
    } catch (e) {
      console.error(e);
      toast.error('خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [marketFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Manual generation (admin) ─────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      toast.info('جاري توليد توقعات الغد... ده بياخد وقت');
      const res = await fetch('/api/tomorrow-predictions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: marketFilter === 'CRYPTO' ? 'CRYPTO' : 'EGX' }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(
          `تم توليد ${json.predictions_count} توقع + ${json.watchlist_count} تحت المراقبة`
        );
        fetchData(); // reload
      } else {
        toast.error(json.error || 'فشل التوليد');
      }
    } catch (e) {
      toast.error('خطأ في التوليد');
    } finally {
      setGenerating(false);
    }
  }, [marketFilter, fetchData]);

  // ─── Stats cards ───────────────────────────────────────────────────────────
  const stats = data?.stats;

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              توقعات الغد
            </h1>
            <p className="text-sm text-muted-foreground">
              جلسة {data?.session_date || '—'} •{' '}
              <span className="font-mono text-xs">
                آخر تحديث: {new Date().toLocaleTimeString('ar-EG')}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={marketFilter} onValueChange={setMarketFilter}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأسواق</SelectItem>
              <SelectItem value="EGX">الأسهم (EGX)</SelectItem>
              <SelectItem value="CRYPTO">العملات</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4 ml-2', loading && 'animate-spin')} />
            تحديث
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
          >
            <Zap className={cn('h-4 w-4 ml-2', generating && 'animate-pulse')} />
            {generating ? 'جاري التوليد...' : 'توليد يدوي'}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard
            icon={<Target className="h-4 w-4" />}
            label="توقعات الغد"
            value={stats.predictions_count.toString()}
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="شراء"
            value={stats.buy_signals.toString()}
            tone="positive"
          />
          <StatCard
            icon={<TrendingDown className="h-4 w-4" />}
            label="بيع"
            value={stats.sell_signals.toString()}
            tone="negative"
          />
          <StatCard
            icon={<Activity className="h-4 w-4" />}
            label="أسهم نشطة"
            value={stats.active_status_count.toString()}
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="حققت الهدف"
            value={stats.target_hit.toString()}
            tone="positive"
          />
          <StatCard
            icon={<Eye className="h-4 w-4" />}
            label="تحت المراقبة"
            value={stats.watchlist_count.toString()}
            tone="warning"
          />
        </div>
      )}

      {/* Main Content — 3 Tabs */}
      <Tabs defaultValue="predictions" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="predictions">
            <Target className="h-4 w-4 ml-1" />
            التوقعات ({data?.predictions.length || 0})
          </TabsTrigger>
          <TabsTrigger value="active">
            <Activity className="h-4 w-4 ml-1" />
            الأسهم النشطة ({data?.active_status.length || 0})
          </TabsTrigger>
          <TabsTrigger value="watchlist">
            <Eye className="h-4 w-4 ml-1" />
            تحت المراقبة ({data?.watchlist.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* ─── الجزء 1: التوقعات ─────────────────────────────────────────── */}
        <TabsContent value="predictions" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" />
                توقعات الغد — شراء/بيع
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                توقعات لجلسة {data?.session_date} — مرتبة حسب الثقة
              </p>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingState />
              ) : !data || data.predictions.length === 0 ? (
                <EmptyState
                  icon={<Target className="h-8 w-8" />}
                  message="مفيش توقعات متاحة لجلسة الغد"
                  hint="اضغط 'توليد يدوي' عشان تولد التوقعات الآن"
                />
              ) : (
                <div className="max-h-[600px] overflow-auto -mx-2">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>السهم</TableHead>
                        <TableHead className="text-center">الإشارة</TableHead>
                        <TableHead className="text-right">سعر الدخول</TableHead>
                        <TableHead className="text-right">الهدف</TableHead>
                        <TableHead className="text-right">الوقف</TableHead>
                        <TableHead className="text-center">R/R</TableHead>
                        <TableHead className="text-center">الثقة</TableHead>
                        <TableHead className="text-right">السبب</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.predictions.map((p) => (
                        <TableRow key={p.id} className="hover:bg-muted/50">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div
                                className={cn(
                                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
                                  p.market === 'CRYPTO'
                                    ? 'bg-amber-500/10 text-amber-600'
                                    : 'bg-emerald-500/10 text-emerald-600'
                                )}
                              >
                                {p.market === 'CRYPTO' ? (
                                  <Bitcoin className="h-4 w-4" />
                                ) : (
                                  p.ticker.slice(0, 2)
                                )}
                              </div>
                              <div>
                                <div className="font-semibold text-sm">
                                  {p.ticker}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {p.name}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-xs',
                                SIGNAL_COLORS[p.signal] || SIGNAL_COLORS.NEUTRAL
                              )}
                            >
                              {p.signal === 'STRONG_BUY'
                                ? 'شراء قوي'
                                : p.signal === 'BUY'
                                  ? 'شراء'
                                  : p.signal === 'STRONG_SELL'
                                    ? 'بيع قوي'
                                    : p.signal === 'SELL'
                                      ? 'بيع'
                                      : p.signal}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatPrice(p.entry_price, p.market)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-emerald-600">
                            {formatPrice(p.target_price, p.market)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-red-600">
                            {formatPrice(p.stop_loss, p.market)}
                          </TableCell>
                          <TableCell className="text-center font-mono text-sm">
                            {p.r_multiple?.toFixed(2) || '—'}
                          </TableCell>
                          <TableCell className="text-center">
                            {p.confidence !== null && (
                              <Badge variant="secondary" className="text-xs">
                                {p.confidence.toFixed(0)}%
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground max-w-xs">
                            {p.reason?.slice(0, 80) || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── الجزء 2: حالة الأسهم النشطة ──────────────────────────────── */}
        <TabsContent value="active" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" />
                حالة الأسهم النشطة — وصلت لفين؟
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                التوقعات اللي كانت معانا + حالتها الحالية + الإجراء المتوقع
              </p>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingState />
              ) : !data || data.active_status.length === 0 ? (
                <EmptyState
                  icon={<Activity className="h-8 w-8" />}
                  message="مفيش توقعات نشطة حالياً"
                />
              ) : (
                <div className="max-h-[600px] overflow-auto -mx-2">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>السهم</TableHead>
                        <TableHead className="text-center">الإشارة الأصلية</TableHead>
                        <TableHead className="text-right">دخول</TableHead>
                        <TableHead className="text-right">السعر الحالي</TableHead>
                        <TableHead className="text-center">التقدم</TableHead>
                        <TableHead className="text-center">للهدف</TableHead>
                        <TableHead className="text-center">للوقف</TableHead>
                        <TableHead className="text-center">الحالة</TableHead>
                        <TableHead className="text-right">الإجراء المتوقع</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.active_status.map((s) => {
                        const change = formatPercent(s.current_change_percent);
                        return (
                          <TableRow key={s.id} className="hover:bg-muted/50">
                            <TableCell>
                              <div className="font-semibold text-sm">{s.ticker}</div>
                              <div className="text-xs text-muted-foreground">{s.name}</div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-xs',
                                  SIGNAL_COLORS[s.original_signal] || SIGNAL_COLORS.NEUTRAL
                                )}
                              >
                                {s.original_signal === 'BUY'
                                  ? 'شراء'
                                  : s.original_signal === 'SELL'
                                    ? 'بيع'
                                    : s.original_signal}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatPrice(s.original_entry_price, s.market)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="font-mono text-sm">
                                {formatPrice(s.current_price, s.market)}
                              </div>
                              <div
                                className={cn(
                                  'text-xs font-mono',
                                  change.positive ? 'text-emerald-600' : 'text-red-600'
                                )}
                              >
                                {change.text}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex flex-col items-center">
                                <span
                                  className={cn(
                                    'font-mono text-sm font-bold',
                                    s.progress_percent >= 70
                                      ? 'text-emerald-600'
                                      : s.progress_percent >= 30
                                        ? 'text-amber-600'
                                        : s.progress_percent < 0
                                          ? 'text-red-600'
                                          : 'text-muted-foreground'
                                  )}
                                >
                                  {s.progress_percent > 0 ? '+' : ''}
                                  {s.progress_percent.toFixed(1)}%
                                </span>
                                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={cn(
                                      'h-full transition-all',
                                      s.progress_percent >= 70
                                        ? 'bg-emerald-500'
                                        : s.progress_percent >= 30
                                          ? 'bg-amber-500'
                                          : s.progress_percent < 0
                                            ? 'bg-red-500'
                                            : 'bg-blue-500'
                                    )}
                                    style={{
                                      width: `${Math.max(0, Math.min(100, s.progress_percent))}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs text-emerald-600">
                              {s.distance_to_target > 0 ? '+' : ''}
                              {s.distance_to_target.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs text-red-600">
                              {s.distance_to_stop > 0 ? '+' : ''}
                              {s.distance_to_stop.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-xs',
                                  STATUS_COLORS[s.status] || STATUS_COLORS.FLAT
                                )}
                              >
                                {STATUS_AR[s.status] || s.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs font-medium">
                              {s.expected_action}
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
        </TabsContent>

        {/* ─── الجزء 3: تحت المراقبة ────────────────────────────────────── */}
        <TabsContent value="watchlist" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="h-4 w-4" />
                أسهم تحت المراقبة — التغيرات
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                أسهم ممكن تعمل شغل حلو في بيع أو شراء — مرتبة حسب الأولوية
              </p>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingState />
              ) : !data || data.watchlist.length === 0 ? (
                <EmptyState
                  icon={<Eye className="h-8 w-8" />}
                  message="مفيش أسهم تحت المراقبة حالياً"
                />
              ) : (
                <div className="max-h-[600px] overflow-auto -mx-2">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>السهم</TableHead>
                        <TableHead className="text-center">النوع</TableHead>
                        <TableHead className="text-center">الأولوية</TableHead>
                        <TableHead className="text-right">السعر</TableHead>
                        <TableHead className="text-right">التغير</TableHead>
                        <TableHead className="text-center">RSI</TableHead>
                        <TableHead className="text-center">حجم</TableHead>
                        <TableHead className="text-right">السبب</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.watchlist.map((w) => {
                        const change = formatPercent(w.change_percent);
                        return (
                          <TableRow key={w.id} className="hover:bg-muted/50">
                            <TableCell>
                              <div className="font-semibold text-sm">{w.ticker}</div>
                              <div className="text-xs text-muted-foreground">{w.name}</div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="text-xs">
                                {WATCH_TYPE_AR[w.watch_type] || w.watch_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-xs',
                                  PRIORITY_COLORS[w.priority] || PRIORITY_COLORS.LOW
                                )}
                              >
                                {w.priority === 'HIGH'
                                  ? 'عالية'
                                  : w.priority === 'MEDIUM'
                                    ? 'متوسطة'
                                    : 'منخفضة'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatPrice(w.current_price, w.market)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'font-mono text-xs',
                                  change.positive
                                    ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                                    : 'text-red-600 bg-red-50 border-red-200'
                                )}
                              >
                                {change.text}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs">
                              {w.rsi?.toFixed(0) || '—'}
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs">
                              {w.volume_surge > 1
                                ? `${w.volume_surge.toFixed(1)}x`
                                : formatNumber(w.volume)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground max-w-xs">
                              {w.watch_reason}
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
        </TabsContent>
      </Tabs>

      {/* إخلاء مسؤولية قانوني */}
      <LegalDisclaimerFooter />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div
        className={cn(
          'text-lg font-bold',
          tone === 'positive' && 'text-emerald-600',
          tone === 'negative' && 'text-red-600',
          tone === 'warning' && 'text-amber-600'
        )}
      >
        {value}
      </div>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="ml-2 text-muted-foreground">جاري التحميل...</span>
    </div>
  );
}

function EmptyState({
  icon,
  message,
  hint,
}: {
  icon: React.ReactNode;
  message: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="text-muted-foreground mb-2">{icon}</div>
      <p className="text-sm text-muted-foreground">{message}</p>
      {hint && <p className="text-xs text-muted-foreground mt-2">{hint}</p>}
    </div>
  );
}

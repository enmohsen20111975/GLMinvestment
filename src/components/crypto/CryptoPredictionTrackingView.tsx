'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LegalDisclaimerFooter } from '@/components/legal/DisclaimerBanner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Target,
  Shield,
  Activity,
  Bitcoin,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Trophy,
  Percent,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CryptoPrediction {
  id: number;
  ticker: string;
  signal: string;
  signal_type: string;
  prediction_date: string;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  master_score: number | null;
  technical_score: number | null;
  outcome_date: string | null;
  exit_price: number | null;
  actual_return: number | null;
  hit_target: number;
  hit_stop: number;
  is_correct: number | null;
  holding_days: number;
  market: string;
  confidence: number | null;
}

interface ApiResponse {
  success: boolean;
  count: number;
  stats: {
    total: number;
    pending: number;
    closed: number;
    wins: number;
    losses: number;
    avg_return: number;
  };
  data: CryptoPrediction[];
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPrice(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function formatPercent(n: number | null): { text: string; positive: boolean } {
  if (n === null || n === undefined || Number.isNaN(n))
    return { text: '—', positive: false };
  return {
    text: (n >= 0 ? '+' : '') + n.toFixed(2) + '%',
    positive: n >= 0,
  };
}

function getPotentialReturn(p: CryptoPrediction): number | null {
  if (!p.target_price || !p.entry_price) return null;
  return ((p.target_price - p.entry_price) / p.entry_price) * 100;
}

function getRiskReward(p: CryptoPrediction): number | null {
  if (!p.target_price || !p.stop_loss || !p.entry_price) return null;
  const risk = Math.abs(p.entry_price - p.stop_loss);
  const reward = Math.abs(p.target_price - p.entry_price);
  if (risk === 0) return null;
  return reward / risk;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CryptoPredictionTrackingView() {
  const [predictions, setPredictions] = useState<CryptoPrediction[]>([]);
  const [stats, setStats] = useState<ApiResponse['stats']>({
    total: 0,
    pending: 0,
    closed: 0,
    wins: 0,
    losses: 0,
    avg_return: 0,
  });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'pending' | 'closed'>('all');
  const [search, setSearch] = useState('');
  const [signalFilter, setSignalFilter] = useState<string>('all');

  // ─── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/crypto-predictions?limit=200', {
        cache: 'no-store',
      });
      const json: ApiResponse = await res.json();
      if (json.success) {
        setPredictions(json.data || []);
        setStats(
          json.stats || {
            total: 0,
            pending: 0,
            closed: 0,
            wins: 0,
            losses: 0,
            avg_return: 0,
          }
        );
      } else {
        toast.error('فشل تحميل توقعات العملات');
      }
    } catch (e) {
      toast.error('خطأ في الاتصال بقاعدة التوقعات');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Filtered by tab + search ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = [...predictions];
    if (tab === 'pending') {
      result = result.filter((p) => !p.outcome_date);
    } else if (tab === 'closed') {
      result = result.filter((p) => p.outcome_date);
    }
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      result = result.filter((p) => p.ticker.includes(q));
    }
    if (signalFilter !== 'all') {
      result = result.filter((p) => p.signal === signalFilter.toUpperCase());
    }
    return result.sort((a, b) =>
      b.prediction_date.localeCompare(a.prediction_date)
    );
  }, [predictions, tab, search, signalFilter]);

  // ─── Win rate ──────────────────────────────────────────────────────────────
  const winRate =
    stats.closed > 0 ? (stats.wins / stats.closed) * 100 : 0;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Bitcoin className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              متابعة توقعات العملات الرقمية
            </h1>
            <p className="text-sm text-muted-foreground">
              توقعات{' '}
              <code className="text-xs bg-muted px-1 rounded">
                market=CRYPTO
              </code>{' '}
              من قاعدة التوقعات (predictions.db)
            </p>
          </div>
        </div>
        <Button variant="default" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4 ml-2', loading && 'animate-spin')} />
          تحديث
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="إجمالي التوقعات"
          value={stats.total.toString()}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="قيد التنفيذ"
          value={stats.pending.toString()}
          tone="neutral"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="مغلقة"
          value={stats.closed.toString()}
        />
        <StatCard
          icon={<Trophy className="h-4 w-4" />}
          label="مكاسب"
          value={stats.wins.toString()}
          tone="positive"
        />
        <StatCard
          icon={<XCircle className="h-4 w-4" />}
          label="خسائر"
          value={stats.losses.toString()}
          tone="negative"
        />
        <StatCard
          icon={<Percent className="h-4 w-4" />}
          label="نسبة النجاح"
          value={winRate.toFixed(1) + '%'}
          tone={winRate >= 50 ? 'positive' : 'negative'}
        />
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            التوقعات ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالرمز (BTC, ETH, SOL...)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Select value={signalFilter} onValueChange={setSignalFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="نوع الإشارة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الإشارات</SelectItem>
                <SelectItem value="buy">BUY</SelectItem>
                <SelectItem value="sell">SELL</SelectItem>
                <SelectItem value="hold">HOLD</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tabs */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="all">الكل ({stats.total})</TabsTrigger>
              <TabsTrigger value="pending">
                قيد التنفيذ ({stats.pending})
              </TabsTrigger>
              <TabsTrigger value="closed">مغلقة ({stats.closed})</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">
                    جاري تحميل التوقعات...
                  </span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    لا توجد توقعات تطابق الفلاتر
                  </p>
                </div>
              ) : (
                <div className="max-h-[600px] overflow-auto -mx-2">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>العملة</TableHead>
                        <TableHead className="text-center">الإشارة</TableHead>
                        <TableHead className="text-right">التاريخ</TableHead>
                        <TableHead className="text-right">سعر الدخول</TableHead>
                        <TableHead className="text-right">الهدف</TableHead>
                        <TableHead className="text-right">الوقف</TableHead>
                        <TableHead className="text-center">عائد محتمل</TableHead>
                        <TableHead className="text-center">R:R</TableHead>
                        <TableHead className="text-center">الثقة</TableHead>
                        <TableHead className="text-center">الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((p) => {
                        const potential = getPotentialReturn(p);
                        const rr = getRiskReward(p);
                        const actual = formatPercent(p.actual_return);
                        const isClosed = !!p.outcome_date;
                        return (
                          <TableRow
                            key={p.id}
                            className="hover:bg-muted/50"
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 text-xs font-bold">
                                  {p.ticker.slice(0, 3)}
                                </div>
                                <span className="font-semibold text-sm">
                                  {p.ticker}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-xs',
                                  p.signal === 'BUY'
                                    ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                                    : p.signal === 'SELL'
                                      ? 'text-red-600 bg-red-50 border-red-200'
                                      : 'text-amber-600 bg-amber-50 border-amber-200'
                                )}
                              >
                                {p.signal}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs font-mono text-muted-foreground">
                              {p.prediction_date}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatPrice(p.entry_price)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-emerald-600">
                              {formatPrice(p.target_price)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-red-600">
                              {formatPrice(p.stop_loss)}
                            </TableCell>
                            <TableCell className="text-center">
                              {potential !== null ? (
                                <Badge
                                  variant="outline"
                                  className="text-xs font-mono text-emerald-600 bg-emerald-50 border-emerald-200"
                                >
                                  +{potential.toFixed(1)}%
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center font-mono text-sm">
                              {rr !== null ? rr.toFixed(2) : '—'}
                            </TableCell>
                            <TableCell className="text-center">
                              {p.confidence !== null ? (
                                <Badge variant="secondary" className="text-xs">
                                  {p.confidence.toFixed(0)}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {isClosed ? (
                                <div className="flex flex-col items-center gap-1">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'text-xs',
                                      p.hit_target === 1
                                        ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                                        : p.hit_stop === 1
                                          ? 'text-red-600 bg-red-50 border-red-200'
                                          : 'text-muted-foreground'
                                    )}
                                  >
                                    {p.hit_target === 1
                                      ? '🎯 هدف'
                                      : p.hit_stop === 1
                                        ? '🛑 وقف'
                                        : '—'}
                                  </Badge>
                                  <span
                                    className={cn(
                                      'text-xs font-mono',
                                      actual.positive
                                        ? 'text-emerald-600'
                                        : 'text-red-600'
                                    )}
                                  >
                                    {actual.text}
                                  </span>
                                </div>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-xs text-amber-600 bg-amber-50 border-amber-200"
                                >
                                  <Clock className="h-3 w-3 ml-1" />
                                  نشط
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* إخلاء مسؤولية قانوني */}
      <LegalDisclaimerFooter />
    </div>
  );
}

// ─── StatCard sub-component ─────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative';
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
          tone === 'negative' && 'text-red-600'
        )}
      >
        {value}
      </div>
    </Card>
  );
}

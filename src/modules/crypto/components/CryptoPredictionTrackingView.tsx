'use client';
import { StatCard } from '@/components/ui/stat-card';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LegalDisclaimerFooter } from '@/components/legal/DisclaimerBanner';
import {
import { formatPrice, formatNumber, formatPercent } from '@/lib/format';
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher';
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

/* formatPrice moved to @/lib/format (Phase 1 DRY) */);
 if (n >= 1) return '$' + (n ?? 0).toFixed(2);
 if (n >= 0.01) return '$' + (n ?? 0).toFixed(4);
 return '$' + (n ?? 0).toFixed(6);
}

function formatPercent(n: number | null): { text: string; positive: boolean } {
 if (n === null || n === undefined || Number.isNaN(n))
 return { text: '—', positive: false };
 return {
 text: (n >= 0 ? '+' : '') + (n ?? 0).toFixed(2) + '%',
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

// ─── UnifiedTable columns ─────────────────────────────────────────────────────
const predictionColumns: Column<CryptoPrediction>[] = [
 {
 key: 'ticker',
 header: 'العملة',
 sortable: true,
 filterable: true,
 render: (p) => (
 <div className="flex items-center gap-2">
 <div className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/10 text-warning text-xs font-bold">
 {p.ticker.slice(0, 3)}
 </div>
 <span className="font-semibold text-sm">{p.ticker}</span>
 <StockPublisher
 data={{
 ticker: p.ticker,
 currentPrice: Number(p.entry_price ?? 0),
 entryPrice: Number(p.entry_price ?? 0) || undefined,
 targetPrice1: Number(p.target_price ?? 0) || undefined,
 stopLoss: Number(p.stop_loss ?? 0) || undefined,
 confidence: Number(p.confidence ?? 0) || undefined,
 market: 'CRYPTO' as StockPublishData['market'],
 recommendation:
 p.signal === 'BUY' ? 'BUY' :
 p.signal === 'SELL' ? 'SELL' : 'HOLD',
 }}
 variant="icon"
 size="sm"
 />
 </div>
 ),
 },
 {
 key: 'signal',
 header: 'الإشارة',
 align: 'center',
 sortable: true,
 filterable: true,
 render: (p) => (
 <Badge variant="outline" className={cn('text-xs',
 p.signal === 'BUY' ? 'text-profit bg-profit border-profit'
 : p.signal === 'SELL' ? 'text-loss bg-loss border-loss'
 : 'text-warning bg-warning border-warning'
 )}>
 {p.signal}
 </Badge>
 ),
 },
 {
 key: 'prediction_date',
 header: 'التاريخ',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'text-xs font-mono text-muted-foreground',
 },
 {
 key: 'entry_price',
 header: 'سعر الدخول',
 align: 'right',
 sortable: true,
 className: 'font-mono text-sm',
 render: (p) => formatPrice(p.entry_price),
 },
 {
 key: 'target_price',
 header: 'الهدف',
 align: 'right',
 sortable: true,
 className: 'font-mono text-sm text-profit',
 render: (p) => formatPrice(p.target_price),
 },
 {
 key: 'stop_loss',
 header: 'الوقف',
 align: 'right',
 sortable: true,
 className: 'font-mono text-sm text-loss',
 render: (p) => formatPrice(p.stop_loss),
 },
 {
 key: '_potential',
 header: 'عائد محتمل',
 align: 'center',
 sortable: true,
 render: (p) => {
 const potential = getPotentialReturn(p);
 return potential !== null ? (
 <Badge variant="outline" className="text-xs font-mono text-profit bg-profit border-profit">
 +{(potential ?? 0).toFixed(1)}%
 </Badge>
 ) : '—';
 },
 },
 {
 key: '_rr',
 header: 'R:R',
 align: 'center',
 sortable: true,
 className: 'font-mono text-sm',
 render: (p) => {
 const rr = getRiskReward(p);
 return rr !== null ? (rr ?? 0).toFixed(2) : '—';
 },
 },
 {
 key: 'confidence',
 header: 'الثقة',
 align: 'center',
 sortable: true,
 render: (p) => p.confidence !== null ? (
 <Badge variant="secondary" className="text-xs">{(p.confidence ?? 0).toFixed(0)}</Badge>
 ) : '—',
 },
 {
 key: '_status',
 header: 'الحالة',
 align: 'center',
 render: (p) => {
 const isClosed = !!p.outcome_date;
 if (!isClosed) {
 return (
 <Badge variant="outline" className="text-xs text-warning bg-warning border-warning">
 <Clock className="h-3 w-3 ml-1" />
 نشط
 </Badge>
 );
 }
 const actual = formatPercent(p.actual_return);
 return (
 <div className="flex flex-col items-center gap-1">
 <Badge variant="outline" className={cn('text-xs',
 p.hit_target === 1 ? 'text-profit bg-profit border-profit'
 : p.hit_stop === 1 ? 'text-loss bg-loss border-loss'
 : 'text-muted-foreground'
 )}>
 {p.hit_target === 1 ? '🎯 هدف' : p.hit_stop === 1 ? '🛑 وقف' : '—'}
 </Badge>
 <span className={cn('text-xs font-mono', actual.positive ? 'text-profit' : 'text-loss')}>
 {actual.text}
 </span>
 </div>
 );
 },
 },
];

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
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10 text-warning">
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
 <UnifiedPublishButton
 variant="outline"
 size="sm"
 title="متابعة توقعات العملات الرقمية"
 content={`متابعة توقعات العملات الرقمية\nإجمالي: ${stats.total} · مغلقة: ${stats.closed} · مكاسب: ${stats.wins} · خسائر: ${stats.losses}\nنسبة النجاح: ${(winRate ?? 0).toFixed(1)}%\n\nأحدث التوقعات:\n${filtered.slice(0, 15).map((p, i) => `${i + 1}. ${p.ticker} — ${p.signal} — دخول ${formatPrice(p.entry_price)} — هدف ${formatPrice(p.target_price)} — وقف ${formatPrice(p.stop_loss)}`).join('\n')}`}
 filename={`crypto-predictions-${Date.now()}`}
 hashtags={['crypto', 'توقعات', 'بيتكوين']}
 triggerLabel="نشر"
 />
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
 value={(winRate ?? 0).toFixed(1) + '%'}
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
 <UnifiedTable<CryptoPrediction>
 columns={predictionColumns}
 data={filtered}
 loading={loading}
 loadingRows={6}
 keyField="id"
 dense
 columnToggle
 filterable
 maxHeight="max-h-[600px]"
 emptyTextAr="لا توجد توقعات تطابق الفلاتر"
 />
 </TabsContent>
 </Tabs>
 </CardContent>
 </Card>

 {/* إخلاء مسؤولية قانوني */}
 <LegalDisclaimerFooter />
 </div>
 );
}

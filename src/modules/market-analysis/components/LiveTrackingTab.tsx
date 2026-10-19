'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import {
 TrendingUp, TrendingDown, Clock, Calendar,
 BarChart3, Target, AlertTriangle, CheckCircle,
 Activity, ArrowUpRight, ArrowDownRight, Info,
 RefreshCw, Moon, Copy, Share2, ShieldCheck, ShieldX, Crosshair, Gauge, Facebook, ArrowRight, ArrowLeft,
 Bitcoin, Zap, Download, Image as ImageIcon, FileText, Camera, Loader2, X, Layers, Send
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { Radio, Radar } from 'lucide-react';
import {
 ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
 XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn, getRRVerdict, getStockRiskAlert, safeToFixed, verdictStyle, computeRR, rrColor, scoreColor, fmtPrice, formatNumber } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { useAnalysisStore } from '@/lib/analysis-store';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

import { isBuySignalLabel, isSellSignalLabel } from '@/lib/signal-utils';
import { PersonaImageCard, PersonaPick } from '@/components/market/PersonaImageCard';
import { ExpertPredictionsImageCard } from '@/components/market/ExpertPredictionsImageCard';
import { PredictionsImageCard } from '@/components/market/PredictionsImageCard';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import { MarketStatusExport } from '@/components/market/MarketStatusExport';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
import { ExpertRecommendationsPanel } from '@/modules/market-analysis/components/ExpertRecommendationsPanel';
import { ExpertIntelligencePanel } from '@/components/shared/ExpertIntelligencePanel';
import { DailyPicksPoster } from '@/components/daily-picks/DailyPicksPoster';
import type {
 StockData,
 LifecycleStatus,
 StatusBadgeStyle,
 PreviousPrediction,
 PersonaData,
 AnalysisJson,
 StoredAnalysisItem,
 NameMap,
 CryptoPrediction,
 CryptoPredictionsResponse,
 SectorTrackingStock,
 SectorTrackingEntry,
 SectorTrackingResponse,
 SectorSortField,
 SectorStockSortField,
 MorningBellStock,
 PredictionRow,
} from './types';
import {
 pickValidPrice,
 getStatusBadge,
 pnlColorClass,
 formatPnl,
 formatChangePct,
 formatDateShort,
 mapPredictionToStockData,
 MARKET_CODES,
 isMarketClosedNow,
 getNextTradingDay,
 formatDateLabel,
 formatAllPredictionsText,
 formatSinglePredictionText,
 formatSinglePersonaPickText,
 formatAllPersonaPicksText,
 formatComprehensiveStockText,
 formatSingleExpertPredictionText,
 formatAllExpertPredictionsText,
 isTraderPrediction,
 evalPrediction,
 buildNameMap,
 enrichItems,
 pickPersonaMix,
 pickPersonaDiverged,
 getVerdictColor,
 getScoreColor,
 PERSONA_DISPLAY_LIMIT,
 PERSONA_PAGE_SIZE,
 usdCurrencyFmt,
 arDateTimeFmt,
 cryptoSignalStyle,
 cryptoSignalLabelAr,
 cryptoSymbolMeta,
 HEAT_LEVEL_STYLE,
 formatVolumeShort,
 formatEGPShort,
 avgChangeHeatClass,
 stockChangeHeatClass,
 _isEgxIntradayNow,
} from './helpers';


export function LiveTrackingTab({ market }: { market: MarketType }) {
 const [activeStatus, setActiveStatus] = useState<Array<Record<string, unknown>>>([]);
 const [watchlist, setWatchlist] = useState<Array<Record<string, unknown>>>([]);
 const [loading, setLoading] = useState(true);
 const [subTab, setSubTab] = useState<'active' | 'watchlist'>('active');
 const marketCode = market === 'CRYPTO' ? 'CRYPTO' : 'EGX';

 const fetchData = useCallback(async () => {
 try {
 setLoading(true);
 // canonical: تتبع التوقعات النشطة من Python
 const [trackingRes, screenerRes] = await Promise.all([
 fetch(`/api/stored-analysis/live-tracking?market=${marketCode}&days=30&limit=20`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ predictions: { balanced: [] }, stats: {} })),
 // canonical: أسهم تحت المراقبة من Python screener (volume_surge + RSI extremes + near 52w)
 fetch(`/api/screener/advanced?market=${marketCode}&volume_surge=1&rsi_oversold=1&rsi_overbought=1&near_52w_high=1&near_52w_low=1&limit=15&sort=change_percent&order=desc`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ stocks: [] })),
 ]);

 // الـ predictions من live-tracking (نشطة)
 const activePredictions = trackingRes?.predictions?.balanced || trackingRes?.predictions || [];
 setActiveStatus(Array.isArray(activePredictions) ? activePredictions : []);

 // الـ watchlist من screener
 const screenerStocks = screenerRes?.stocks || [];
 setWatchlist(Array.isArray(screenerStocks) ? screenerStocks : []);
 } catch (e) {
 console.error(e);
 } finally {
 setLoading(false);
 }
 }, [marketCode]);

 useEffect(() => { fetchData(); }, [fetchData]);

 return (
 <div className="space-y-4">
 {/* Status banner */}
 <Card className="bg-muted/30">
 <CardContent className="py-3 px-4">
 <div className="flex items-center gap-2 text-sm">
 <Activity className="h-4 w-4 text-profit" />
 <span className="font-semibold">متابعة حية أثناء الجلسة</span>
 <span className="text-muted-foreground">— توقعات نشطة ومستوياتها الحالية، وأسهم تحت المراقبة قد تُظهر فرصاً</span>
 </div>
 </CardContent>
 </Card>

 {/* Stats */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <Card className="p-3">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <Activity className="h-4 w-4" />
 <span className="text-xs">توقعات نشطة</span>
 </div>
 <div className="text-lg font-bold">{activeStatus.length}</div>
 </Card>
 <Card className="p-3">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <CheckCircle className="h-4 w-4" />
 <span className="text-xs">حققت الهدف</span>
 </div>
 <div className="text-lg font-bold text-profit">
 {activeStatus.filter((s) => s.hit_target === 1 || s.status === 'TARGET_HIT').length}
 </div>
 </Card>
 <Card className="p-3">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <AlertTriangle className="h-4 w-4" />
 <span className="text-xs">قرب الهدف</span>
 </div>
 <div className="text-lg font-bold text-warning">
 {activeStatus.filter((s) => {
 const progress = s.progress_percent || 0;
 return progress >= 70 && progress < 100;
 }).length}
 </div>
 </Card>
 <Card className="p-3">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <TrendingUp className="h-4 w-4" />
 <span className="text-xs">تحت المراقبة</span>
 </div>
 <div className="text-lg font-bold">{watchlist.length}</div>
 </Card>
 </div>

 {/* Sub-tabs */}
 <div className="flex items-center justify-between">
 <Tabs value={subTab} onValueChange={(v) => setSubTab(v as typeof subTab)}>
 <TabsList>
 <TabsTrigger value="active">
 <Activity className="h-4 w-4 ml-1" />
 التوقعات النشطة ({activeStatus.length})
 </TabsTrigger>
 <TabsTrigger value="watchlist">
 <AlertTriangle className="h-4 w-4 ml-1" />
 تحت المراقبة ({watchlist.length})
 </TabsTrigger>
 </TabsList>
 </Tabs>
 <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
 <RefreshCw className={cn('h-4 w-4 ml-2', loading && 'animate-spin')} />
 تحديث
 </Button>
 </div>

 {/* Content */}
 {loading ? (
 <Card>
 <CardContent className="py-12 flex items-center justify-center">
 <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
 <span className="ml-2 text-muted-foreground">جاري التحميل...</span>
 </CardContent>
 </Card>
 ) : subTab === 'active' ? (
 <ActiveStatusTable activeStatus={activeStatus} />
 ) : (
 <WatchlistTable watchlist={watchlist} />
 )}

 <p className="text-xs text-muted-foreground text-center leading-relaxed">
 ⚠️ إخلاء مسؤولية: هذه المتابعة رأي آلي تعليمي وليست نصيحة استثمارية مرخصة. القرار مسؤولية العميل.
 </p>
 </div>
 );
}

// ─── تبويب التوقعات — توقعات V40.2 الإنتاجية (canonical) ─────────────────────
// يستخدم /api/unified/predictions (canonical endpoint لـ V40.2 picks)
// زر الإرسال لتليجرام يستخدم Python TelegramNotifier عبر proxy

function TomorrowPredictionsPanel({ market }: { market: MarketType }) {
 const [predictions, setPredictions] = useState<Array<Record<string, unknown>>>([]);
 const [loading, setLoading] = useState(true);
 const [sendingTelegram, setSendingTelegram] = useState(false);
 const marketCode = market === 'CRYPTO' ? 'CRYPTO' : 'EGX';

 const fetchData = useCallback(async () => {
 try {
 setLoading(true);
 // canonical: توقعات V40.2 من Python
 const res = await fetch(`/api/unified/predictions?market=${marketCode}&limit=5`, { cache: 'no-store' });
 const json = await res.json();
 const preds = json?.predictions || [];
 setPredictions(Array.isArray(preds) ? preds : []);
 } catch (e) {
 console.error(e);
 } finally {
 setLoading(false);
 }
 }, [marketCode]);

 useEffect(() => { fetchData(); }, [fetchData]);

 const handleSendTelegram = useCallback(async () => {
 setSendingTelegram(true);
 try {
 // canonical: Python TelegramNotifier عبر proxy
 const res = await fetch('/api/telegram/send-daily-report', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ market: marketCode }),
 });
 const json = await res.json();
 if (json.success) {
 // toast success
 }
 } catch (e) {
 console.error(e);
 } finally {
 setSendingTelegram(false);
 }
 }, [marketCode]);

 return (
 <div className="space-y-4">
 {/* Status banner */}
 <Card className="bg-warning /30 border-warning ">
 <CardContent className="py-3 px-4">
 <div className="flex items-center gap-2 text-sm">
 <Calendar className="h-4 w-4 text-warning" />
 <span className="font-semibold text-warning ">
 التوقعات الإنتاجية
 </span>
 <span className="text-warning ">
 — تتولد بعد إغلاق السوق وتتبعت على تليجرام تلقائياً
 </span>
 </div>
 </CardContent>
 </Card>

 {/* Stats */}
 <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
 <Card className="p-3">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <Target className="h-4 w-4" />
 <span className="text-xs">إجمالي التوقعات</span>
 </div>
 <div className="text-lg font-bold">{predictions.length}</div>
 </Card>
 <Card className="p-3">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <TrendingUp className="h-4 w-4" />
 <span className="text-xs">شراء</span>
 </div>
 <div className="text-lg font-bold text-profit">
 {predictions.filter((p) => ['BUY', 'STRONG_BUY'].includes(String(p.signal || p.signal_type))).length}
 </div>
 </Card>
 <Card className="p-3">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <TrendingDown className="h-4 w-4" />
 <span className="text-xs">بيع</span>
 </div>
 <div className="text-lg font-bold text-loss">
 {predictions.filter((p) => ['SELL', 'STRONG_SELL'].includes(String(p.signal || p.signal_type))).length}
 </div>
 </Card>
 </div>

 {/* Action buttons */}
 <div className="flex items-center justify-end gap-2">
 <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
 <RefreshCw className={cn('h-4 w-4 ml-2', loading && 'animate-spin')} />
 تحديث
 </Button>
 <Button variant="outline" size="sm" onClick={handleSendTelegram} disabled={sendingTelegram || predictions.length === 0}>
 <Send className={cn('h-4 w-4 ml-2', sendingTelegram && 'animate-pulse')} />
 {sendingTelegram ? 'جاري الإرسال...' : 'إرسال لتليجرام'}
 </Button>
 </div>

 {/* Predictions table */}
 {loading ? (
 <Card>
 <CardContent className="py-12 flex items-center justify-center">
 <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
 <span className="ml-2 text-muted-foreground">جاري التحميل...</span>
 </CardContent>
 </Card>
 ) : (
 <PredictionsTable predictions={predictions} />
 )}

 <p className="text-xs text-muted-foreground text-center leading-relaxed">
 ⚠️ إخلاء مسؤولية: هذه التوقعات رأي آلي تعليمي وليست نصيحة استثمارية مرخصة. القرار مسؤولية العميل.
 </p>
 </div>
 );
}

// ─── جدول التوقعات (شراء/بيع) — UnifiedTable ──────────────────────────────────

const predictionsColumns: Column<PredictionRow>[] = [
 {
 key: 'ticker',
 header: 'السهم',
 align: 'right',
 sortable: true,
 width: 'min-w-[140px]',
 render: (p) => (
 <div className="flex flex-col">
 <div className="font-semibold text-sm">{String(p.ticker ?? '')}</div>
 {p.name ? <div className="text-xs text-muted-foreground">{String(p.name)}</div> : null}
 </div>
 ),
 },
 {
 key: 'signal',
 header: 'الإشارة',
 align: 'center',
 render: (p) => {
 const sig = String(p.signal ?? '');
 const isBuy = sig === 'BUY' || sig === 'STRONG_BUY';
 return (
 <Badge variant="outline" className={cn(
 'text-xs',
 isBuy
 ? 'text-profit bg-profit border-profit'
 : 'text-loss bg-loss border-loss'
 )}>
 {sig === 'STRONG_BUY' ? 'شراء قوي' : sig === 'BUY' ? 'شراء' : sig === 'STRONG_SELL' ? 'بيع قوي' : sig || '—'}
 </Badge>
 );
 },
 },
 {
 key: 'entry_price',
 header: 'سعر الدخول',
 align: 'right',
 sortable: true,
 className: 'font-mono text-sm',
 render: (p) => (typeof p.entry_price === 'number' ? (p.entry_price ?? 0).toFixed(2) : '—'),
 },
 {
 key: 'target_price',
 header: 'الهدف',
 align: 'right',
 sortable: true,
 className: 'font-mono text-sm text-profit',
 render: (p) => (typeof p.target_price === 'number' ? (p.target_price ?? 0).toFixed(2) : '—'),
 },
 {
 key: 'stop_loss',
 header: 'الوقف',
 align: 'right',
 sortable: true,
 className: 'font-mono text-sm text-loss',
 render: (p) => (typeof p.stop_loss === 'number' ? (p.stop_loss ?? 0).toFixed(2) : '—'),
 },
 {
 key: 'r_multiple',
 header: 'R/R',
 align: 'center',
 sortable: true,
 className: 'font-mono text-sm',
 render: (p) => (typeof p.r_multiple === 'number' ? (p.r_multiple ?? 0).toFixed(2) : '—'),
 },
 {
 key: 'confidence',
 header: 'الثقة',
 align: 'center',
 sortable: true,
 render: (p) => (typeof p.confidence === 'number' && p.confidence > 0
 ? <Badge variant="secondary" className="text-xs">{(p.confidence ?? 0).toFixed(0)}%</Badge>
 : <span className="text-muted-foreground">—</span>
 ),
 },
 {
 key: 'reason',
 header: 'السبب',
 align: 'right',
 className: 'text-xs text-muted-foreground max-w-xs',
 render: (p) => {
 const r = p.reason;
 if (typeof r !== 'string' || !r) return <span className="text-muted-foreground">—</span>;
 return <span className="truncate block max-w-[280px]" title={r}>{r.slice(0, 80)}</span>;
 },
 },
];


function PredictionsTable({ predictions }: { predictions: Array<Record<string, unknown>> }) {
 if (predictions.length === 0) {
 return (
 <Card>
 <CardContent className="py-12 text-center text-muted-foreground">
 <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
 لا توجد توقعات متاحة — اضغط "توليد يدوي"
 </CardContent>
 </Card>
 );
 }
 return (
 <Card>
 <CardContent className="p-0">
 <UnifiedTable<PredictionRow>
 columns={predictionsColumns}
 data={predictions as PredictionRow[]}
 keyField="id"
 maxHeight="max-h-[600px]"
 dense
 emptyTextAr="لا توجد توقعات متاحة"
 rowClassName={() => 'hover:bg-muted/50'}
 />
 </CardContent>
 </Card>
 );
}

// ─── جدول حالة الأسهم النشطة — UnifiedTable ─────────────────────────────────

const activeStatusColumns: Column<PredictionRow>[] = [
 {
 key: 'ticker',
 header: 'السهم',
 align: 'right',
 sortable: true,
 width: 'min-w-[140px]',
 render: (s) => (
 <div className="flex flex-col">
 <div className="font-semibold text-sm">{String(s.ticker ?? '')}</div>
 {s.name ? <div className="text-xs text-muted-foreground">{String(s.name)}</div> : null}
 </div>
 ),
 },
 {
 key: 'original_signal',
 header: 'الإشارة',
 align: 'center',
 render: (s) => (
 <Badge variant="outline" className="text-xs">{String(s.original_signal ?? '—')}</Badge>
 ),
 },
 {
 key: 'original_entry_price',
 header: 'دخول',
 align: 'right',
 sortable: true,
 className: 'font-mono text-sm',
 render: (s) => (typeof s.original_entry_price === 'number' ? (s.original_entry_price ?? 0).toFixed(2) : '—'),
 },
 {
 key: 'current_price',
 header: 'السعر الحالي',
 align: 'right',
 sortable: true,
 className: 'font-mono text-sm',
 render: (s) => (typeof s.current_price === 'number' ? (s.current_price ?? 0).toFixed(2) : '—'),
 },
 {
 key: 'progress_percent',
 header: 'التقدم',
 align: 'center',
 sortable: true,
 render: (s) => {
 const p = typeof s.progress_percent === 'number' ? s.progress_percent : 0;
 return (
 <div className="flex flex-col items-center">
 <span className={cn(
 'font-mono text-sm font-bold',
 p >= 70 ? 'text-profit' : p >= 30 ? 'text-warning' : p < 0 ? 'text-loss' : 'text-muted-foreground'
 )}>
 {p > 0 ? '+' : ''}{(p ?? 0).toFixed(1)}%
 </span>
 <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
 <div className={cn(
 'h-full',
 p >= 70 ? 'bg-profit' : p >= 30 ? 'bg-warning' : p < 0 ? 'bg-loss' : 'bg-whale'
 )} style={{ width: `${Math.max(0, Math.min(100, p))}%` }} />
 </div>
 </div>
 );
 },
 },
 {
 key: 'status',
 header: 'الحالة',
 align: 'center',
 render: (s) => (
 <Badge variant="outline" className="text-xs">{String(s.status ?? '—')}</Badge>
 ),
 },
 {
 key: 'expected_action',
 header: 'الإجراء المتوقع',
 align: 'right',
 className: 'text-xs font-medium',
 render: (s) => (s.expected_action ? String(s.expected_action) : <span className="text-muted-foreground">—</span>),
 },
];


function ActiveStatusTable({ activeStatus }: { activeStatus: Array<Record<string, unknown>> }) {
 if (activeStatus.length === 0) {
 return (
 <Card>
 <CardContent className="py-12 text-center text-muted-foreground">
 <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
 لا توجد توقعات نشطة حالياً
 </CardContent>
 </Card>
 );
 }
 return (
 <Card>
 <CardContent className="p-0">
 <UnifiedTable<PredictionRow>
 columns={activeStatusColumns}
 data={activeStatus as PredictionRow[]}
 keyField="id"
 maxHeight="max-h-[600px]"
 dense
 emptyTextAr="لا توجد توقعات نشطة حالياً"
 rowClassName={() => 'hover:bg-muted/50'}
 />
 </CardContent>
 </Card>
 );
}

// ─── جدول أسهم تحت المراقبة — UnifiedTable ────────────────────────────────────

type WatchlistRow = {
 id: string | number;
 ticker: string;
 name?: string;
 watch_type?: string;
 priority?: string;
 current_price?: number | null;
 change_percent?: number | null;
 rsi?: number | null;
 volume_surge?: number | null;
 watch_reason?: string;
};

const watchlistColumns: Column<WatchlistRow>[] = [
 {
 key: 'ticker',
 header: 'السهم',
 sortable: true,
 filterable: true,
 render: (w) => (
 <div>
 <div className="font-semibold text-sm">{w.ticker}</div>
 <div className="text-xs text-muted-foreground">{w.name}</div>
 </div>
 ),
 },
 {
 key: 'watch_type',
 header: 'النوع',
 align: 'center',
 filterable: true,
 render: (w) => (
 <Badge variant="outline" className="text-xs">{w.watch_type}</Badge>
 ),
 },
 {
 key: 'priority',
 header: 'الأولوية',
 align: 'center',
 sortable: true,
 filterable: true,
 render: (w) => (
 <Badge variant="outline" className={cn(
 'text-xs',
 w.priority === 'HIGH' ? 'text-loss bg-loss border-loss'
 : w.priority === 'MEDIUM' ? 'text-warning bg-warning border-warning'
 : 'text-muted-foreground bg-muted border-border'
 )}>
 {w.priority === 'HIGH' ? 'عالية' : w.priority === 'MEDIUM' ? 'متوسطة' : 'منخفضة'}
 </Badge>
 ),
 },
 {
 key: 'current_price',
 header: 'السعر',
 align: 'right',
 sortable: true,
 className: 'font-mono text-sm',
 render: (w) => w.current_price?.toFixed(2) ?? '—',
 },
 {
 key: 'change_percent',
 header: 'التغير',
 align: 'right',
 sortable: true,
 render: (w) => (
 <Badge variant="outline" className={cn(
 'font-mono text-xs',
 (w.change_percent ?? 0) >= 0 ? 'text-profit bg-profit border-profit' : 'text-loss bg-loss border-loss'
 )}>
 {(w.change_percent ?? 0) >= 0 ? '+' : ''}{w.change_percent?.toFixed(2)}%
 </Badge>
 ),
 },
 {
 key: 'rsi',
 header: 'RSI',
 align: 'center',
 sortable: true,
 className: 'font-mono text-xs',
 render: (w) => w.rsi?.toFixed(0) || '—',
 },
 {
 key: 'volume_surge',
 header: 'حجم',
 align: 'center',
 sortable: true,
 className: 'font-mono text-xs',
 render: (w) => (w.volume_surge ?? 0) > 1 ? `${w.volume_surge?.toFixed(1)}x` : '—',
 },
 {
 key: 'watch_reason',
 header: 'السبب',
 align: 'right',
 className: 'text-xs text-muted-foreground max-w-xs',
 render: (w) => (
 <span className="block max-w-xs truncate" title={w.watch_reason}>
 {w.watch_reason}
 </span>
 ),
 },
];

function WatchlistTable({ watchlist }: { watchlist: Array<Record<string, unknown>> }) {
 if (watchlist.length === 0) {
 return (
 <Card>
 <CardContent className="py-12 text-center text-muted-foreground">
 <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
 لا توجد أسهم تحت المراقبة حالياً
 </CardContent>
 </Card>
 );
 }
 return (
 <Card>
 <CardContent className="p-0">
 <UnifiedTable<WatchlistRow>
 columns={watchlistColumns}
 data={watchlist as unknown as WatchlistRow[]}
 keyField="id"
 dense
 columnToggle
 filterable
 maxHeight="max-h-[600px]"
 rowClassName={() => 'hover:bg-muted/50'}
 />
 </CardContent>
 </Card>
 );
}


'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
 TrendingUp,
 TrendingDown,
 AlertCircle,
 RefreshCw,
 Activity,
 Target,
 Gauge,
 HelpCircle,
 Loader2,
 Shield,
 CheckCircle,
 Zap,
 Globe,
} from 'lucide-react';
import { ShareButton } from '@/modules/publishing/components/ShareButton';
import { QuickPublishButton } from '@/components/publishing/QuickPublishButton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
 LineChart as RechartsLineChart,
 Line,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip as RechartsTooltip,
 ResponsiveContainer,
 Area,
 AreaChart,
 ReferenceLine,
} from 'recharts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/* Types - التحليل الذكي للسهم Output */
/* ------------------------------------------------------------------ */

interface PythonAnalysis {
 ticker: string;
 signal: 'STRONG_BUY' | 'BUY' | 'ACCUMULATE' | 'HOLD' | 'SELL' | 'STRONG_SELL';
 signal_ar: string;
 master_score: number;
 confidence: number;
 is_tradeable: boolean;
 risk_profile?: {
 entry_price?: number;
 entry_low?: number;
 entry_high?: number;
 target_price?: number;
 stop_loss_price?: number;
 risk_reward_ratio?: number;
 position_size_pct?: number;
 };
 technical_score?: number;
 fundamental_score?: number;
 momentum_score?: number;
 risk_score?: number;
 quality_score?: number;
 indicators?: {
 rsi?: number;
 macd_signal?: string;
 bb_position?: string;
 trend?: string;
 };
 reasons?: string[];
 warnings?: string[];
 analyzed_at?: string;
 market_regime_ar?: string;
 market_regime_strength?: number;
 sector_relative_score?: number;
}

interface OHLCVData {
 timestamp: number;
 open: number;
 high: number;
 low: number;
 close: number;
 volume?: number;
}

interface ChartData {
 success: boolean;
 data: {
 ticker: string;
 ohlcv: OHLCVData[];
 indicators: {
 sma: { sma20: number | null; sma50: number | null };
 ema: { ema12: number | null; ema26: number | null; ema50: number | null };
 volumeMA: number | null;
 currentPrice: number;
 priceChange24h: number;
 priceChangePercent24h: number;
 };
 };
}

/* ------------------------------------------------------------------ */
/* Constants */
/* ------------------------------------------------------------------ */

const TIME_PERIODS = [
 { value: '30', label: '30 يوم' },
 { value: '60', label: '60 يوم' },
 { value: '90', label: '90 يوم' },
 { value: '180', label: '180 يوم' },
 { value: '365', label: 'سنة' },
];

const SIGNAL_CONFIG = {
 'STRONG_BUY': { label: 'شراء قوي', color: 'bg-profit', textColor: 'text-profit', bgLight: 'bg-profit/10' },
 'BUY': { label: 'شراء', color: 'bg-profit', textColor: 'text-profit', bgLight: 'bg-profit/10' },
 'ACCUMULATE': { label: 'تجميع', color: 'bg-warning', textColor: 'text-warning', bgLight: 'bg-warning/10' },
 'HOLD': { label: 'احتفاظ', color: 'bg-warning', textColor: 'text-warning', bgLight: 'bg-warning/10' },
 'SELL': { label: 'بيع', color: 'bg-loss', textColor: 'text-loss', bgLight: 'bg-loss/10' },
 'STRONG_SELL': { label: 'بيع قوي', color: 'bg-loss', textColor: 'text-loss', bgLight: 'bg-loss/10' },
};

/* ------------------------------------------------------------------ */
/* Helper Functions */
/* ------------------------------------------------------------------ */

function formatPrice(price: number | null | undefined, currency: string = 'ج.م'): string {
 if (price == null) return `-- ${currency}`;
 return `${(price ?? 0).toFixed(2)} ${currency}`;
}

function formatPercent(value: number): string {
 const sign = value >= 0 ? '+' : '';
 return `${sign}${(value ?? 0).toFixed(2)}%`;
}

function getScoreColor(score?: number): string {
 const s = score ?? 0
 if (s >= 70) return 'text-profit'
 if (s >= 50) return 'text-warning'
 return 'text-loss'
}

function getScoreBgColor(score?: number): string {
 const s = score ?? 0
 if (s >= 70) return 'bg-profit'
 if (s >= 50) return 'bg-warning'
 return 'bg-loss'
}

/* ------------------------------------------------------------------ */
/* Sub-Components */
/* ------------------------------------------------------------------ */

function PriceChart({ data, analysis }: { data: OHLCVData[]; analysis: PythonAnalysis | null }) {
 const chartData = useMemo(() => {
 return data.map(item => ({
 time: new Date(item.timestamp).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' }),
 close: item.close,
 }));
 }, [data]);

 const targetPrice = analysis?.risk_profile?.target_price;
 const stopLoss = analysis?.risk_profile?.stop_loss_price;
 const currentPrice = data[data.length - 1]?.close;

 return (
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-sm font-medium">السعر والتاريخ</span>
 <Badge variant="outline" className="text-xs">التحليل الذكي للسهم</Badge>
 </div>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <AreaChart data={chartData}>
 <defs>
 <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
 <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
 <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
 <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={['auto', 'auto']} />
 <RechartsTooltip
 contentStyle={{
 backgroundColor: 'hsl(var(--background))',
 border: '1px solid hsl(var(--border))',
 borderRadius: '8px',
 }}
 formatter={(value: number) => [formatPrice(value), '']}
 />
 <Area type="monotone" dataKey="close" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorClose)" strokeWidth={2} />
 {targetPrice && currentPrice && (
 <ReferenceLine y={targetPrice} stroke="#22c55e" strokeDasharray="5 5" label={{ value: `الهدف: ${(targetPrice ?? 0).toFixed(2)}`, fontSize: 10, fill: '#22c55e', position: 'left' }} />
 )}
 {stopLoss && currentPrice && (
 <ReferenceLine y={stopLoss} stroke="#ef4444" strokeDasharray="5 5" label={{ value: `الستوب: ${(stopLoss ?? 0).toFixed(2)}`, fontSize: 10, fill: '#ef4444', position: 'left' }} />
 )}
 </AreaChart>
 </ResponsiveContainer>
 </div>
 </div>
 );
}

function ScoreCircle({ score, label }: { score?: number; label: string }) {
 const safeScore = score ?? 0;
 return (
 <div className="text-center">
 <div className="relative w-24 h-24 mx-auto">
 <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
 <path
 className="text-muted"
 stroke="currentColor"
 strokeWidth="3"
 fill="none"
 d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
 />
 <path
 className={getScoreColor(safeScore)}
 stroke="currentColor"
 strokeWidth="3"
 strokeLinecap="round"
 fill="none"
 strokeDasharray={`${safeScore}, 100`}
 d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
 />
 </svg>
 <div className="absolute inset-0 flex flex-col items-center justify-center">
 <span className={cn('text-xl font-bold', getScoreColor(safeScore))}>{(safeScore ?? 0).toFixed(0)}</span>
 </div>
 </div>
 <span className="text-xs text-muted-foreground mt-1 block">{label}</span>
 </div>
 );
}

function LoadingSkeleton() {
 return (
 <div className="p-4 md:p-6 space-y-4" dir="rtl">
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 <Skeleton className="h-64 rounded-xl" />
 <Skeleton className="h-64 rounded-xl" />
 <Skeleton className="h-64 rounded-xl" />
 </div>
 <Skeleton className="h-96 rounded-xl" />
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Main Component */
/* ------------------------------------------------------------------ */

interface StockAdvancedAnalysisViewProps {
 ticker: string;
 stockName?: string;
 currentPrice?: number;
}

export function StockAdvancedAnalysisView({ ticker, stockName, currentPrice }: StockAdvancedAnalysisViewProps) {
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [chartData, setChartData] = useState<ChartData['data'] | null>(null);
 const [pythonAnalysis, setPythonAnalysis] = useState<PythonAnalysis | null>(null);
 const [days, setDays] = useState(90);
 const shareCardRef = useRef<HTMLDivElement>(null);

 const fetchData = async () => {
 if (!ticker) return;
 
 setLoading(true);
 setError(null);
 
 try {
 // Chart data from unified chart endpoint
 try {
 const periodParam = days <= 30 ? '1m' : days <= 90 ? '3m' : '1y';
 const chartResponse = await fetch(`/api/chart/${ticker}?interval=1d&period=${periodParam}`);
 if (chartResponse.ok) {
 const chartJson = await chartResponse.json();
 if (chartJson.success && Array.isArray(chartJson.data) && chartJson.data.length > 0) {
 const ohlcvList: OHLCVData[] = chartJson.data.map((c: any) => ({
 timestamp: (typeof c.timestamp === 'number' ? c.timestamp : typeof c.date === 'number' ? c.date : Math.floor(new Date(c.date || c.time).getTime() / 1000)) * 1000,
 open: Number(c.open),
 high: Number(c.high),
 low: Number(c.low),
 close: Number(c.close),
 volume: Number(c.volume || 0),
 }));
 const lastClose = ohlcvList[ohlcvList.length - 1]?.close || 0;
 const prevClose = ohlcvList[ohlcvList.length - 2]?.close || lastClose;
 const change = lastClose - prevClose;
 const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

 setChartData({
 success: true,
 data: {
 ticker,
 ohlcv: ohlcvList,
 indicators: {
 sma: { sma20: null, sma50: null },
 ema: { ema12: null, ema26: null, ema50: null },
 volumeMA: null,
 currentPrice: lastClose,
 priceChange24h: change,
 priceChangePercent24h: changePct,
 },
 },
 });
 }
 }
 } catch (chartErr) {
 console.warn('Could not fetch chart data for advanced analysis:', chartErr);
 }

 // Python analysis (source of truth for recommendations)
 const analysisResponse = await fetch(`/api/python/v2/cached-analysis/${ticker}?XTransformPort=8010`);
 
 // Python analysis (source of truth for recommendations)
 const analysisJson = await analysisResponse.json();
 if (analysisJson.success && analysisJson.data) {
 setPythonAnalysis(analysisJson.data);
 } else {
 // If no cached analysis, trigger a new one
 try {
 const analyzeResponse = await fetch(`/api/python/v2/analyze/${ticker}?XTransformPort=8010`);
 const analyzeJson = await analyzeResponse.json();
 if (analyzeJson.success && analyzeJson.data) {
 setPythonAnalysis(analyzeJson.data);
 }
 } catch (analyzeErr) {
 console.warn('Could not trigger analysis:', analyzeErr);
 }
 }
 
 } catch (err) {
 console.error('Error fetching stock analysis:', err);
 setError('تعذّر تحميل التحليل، حاول مرة أخرى');
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchData();
 }, [ticker, days]);

 if (loading) {
 return <LoadingSkeleton />;
 }

 if (error) {
 return (
 <Card className="border-loss /50">
 <CardContent className="p-6 text-center">
 <AlertCircle className="w-10 h-10 text-loss mx-auto mb-3" />
 <p className="text-sm font-medium mb-1">خطأ في التحليل</p>
 <p className="text-xs text-muted-foreground mb-3">{error}</p>
 <Button variant="outline" size="sm" onClick={fetchData}>
 <RefreshCw className="w-4 h-4 ml-2" />
 إعادة المحاولة
 </Button>
 </CardContent>
 </Card>
 );
 }

 const signalConfig = pythonAnalysis ? SIGNAL_CONFIG[pythonAnalysis.signal] : null;
 // 🔥 FIXED: Always use currentPrice from stock detail (passed as prop) as primary source
 // This ensures consistency with the stock detail page
 const currentPriceValue = currentPrice || chartData?.indicators?.currentPrice || 0;
 // UNIFY-FIX (Rule 20 + Rule 27): أزلنا overwrite entry_price بـ currentPrice.
 // كان الكود يستبدل entry_price الحقيقي من Python بـ currentPrice + fabrication
 // entry_low/high = currentPrice * 0.99/1.01. الآن نحترم risk_profile من Python كما هو.
 const updatedAnalysis = pythonAnalysis;

 return (
 <div className="space-y-6" dir="rtl" ref={shareCardRef}>
 {/* Header */}
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div>
 <h2 className="text-xl font-bold flex items-center gap-2">
 <Activity className="w-6 h-6 text-primary" />
 التحليل الموحد
 </h2>
 <p className="text-muted-foreground text-sm">
 {stockName || ticker} - تحليل التحليل الذكي للسهم
 </p>
 </div>
 <div className="flex items-center gap-2">
 <QuickPublishButton
 ticker={ticker}
 stockName={stockName}
 currentPrice={currentPriceValue}
 analysisData={{
 signal: updatedAnalysis?.signal,
 signalAr: updatedAnalysis?.signal_ar,
 score: updatedAnalysis?.master_score,
 confidence: updatedAnalysis?.confidence,
 targetPrice: updatedAnalysis?.risk_profile?.target_price,
 stopLoss: updatedAnalysis?.risk_profile?.stop_loss_price,
 reasons: updatedAnalysis?.reasons,
 warnings: updatedAnalysis?.warnings,
 }}
 />
 <ShareButton
 targetRef={shareCardRef}
 title={`تحليل ${stockName || ticker}`}
 description={`إشارة: ${updatedAnalysis?.signal_ar || 'غير محدد'} - الدرجة: ${updatedAnalysis?.master_score?.toFixed(0) || '--'}`}
 variant="outline"
 size="sm"
 />
 <select
 value={days}
 onChange={(e) => setDays(Number(e.target.value))}
 className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
 >
 {TIME_PERIODS.map(period => (
 <option key={period.value} value={period.value}>{period.label}</option>
 ))}
 </select>
 <Button variant="outline" size="sm" onClick={fetchData}>
 <RefreshCw className="w-4 h-4" />
 </Button>
 </div>
 </div>

 {/* Python Analysis Banner */}
 {updatedAnalysis && (
 <Card className={cn("border-2", signalConfig?.bgLight)}>
 <CardContent className="p-4">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div className="flex items-center gap-4">
 <div className={cn("w-16 h-16 rounded-full flex items-center justify-center", signalConfig?.color)}>
 <span className="text-foreground text-2xl font-bold">{(updatedAnalysis.master_score ?? 0).toFixed(0)}</span>
 </div>
 <div>
 <div className="flex items-center gap-2">
 <Badge className={cn("text-base px-4 py-1", signalConfig?.color)}>
 {updatedAnalysis.signal_ar || signalConfig?.label}
 </Badge>
 {updatedAnalysis.is_tradeable && (
 <Badge variant="outline" className="text-xs text-profit">
 <CheckCircle className="w-3 h-3 ml-1" />
 قابل للتداول
 </Badge>
 )}
 </div>
 <p className="text-sm text-muted-foreground mt-1">
 ثقة: {updatedAnalysis.confidence?.toFixed(0) || '--'}%
 </p>
 </div>
 </div>
 
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <Zap className="w-4 h-4 text-primary" />
 <span>التحليل الذكي للسهم</span>
 </div>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Main Grid */}
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 {/* Score Breakdown */}
 <Card className="md:col-span-1">
 <CardHeader className="pb-2">
 <CardTitle className="text-base">تفصيل الدرجة</CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 {updatedAnalysis ? (
 <>
 <ScoreCircle score={updatedAnalysis.master_score} label="الدرجة الإجمالية" />
 
 <Separator />
 
 <div className="grid grid-cols-2 gap-4 text-center">
 <div>
 <span className="text-xs text-muted-foreground block">الفني</span>
 <span className={cn("text-lg font-bold", getScoreColor(updatedAnalysis.technical_score || 50))}>
 {updatedAnalysis.technical_score?.toFixed(0) || '--'}
 </span>
 </div>
 <div>
 <span className="text-xs text-muted-foreground block">الأساسي</span>
 <span className={cn("text-lg font-bold", getScoreColor(updatedAnalysis.fundamental_score || 50))}>
 {updatedAnalysis.fundamental_score?.toFixed(0) || '--'}
 </span>
 </div>
 <div>
 <span className="text-xs text-muted-foreground block">الزخم</span>
 <span className={cn("text-lg font-bold", getScoreColor(updatedAnalysis.momentum_score || 50))}>
 {updatedAnalysis.momentum_score?.toFixed(0) || '--'}
 </span>
 </div>
 <div>
 <span className="text-xs text-muted-foreground block">المخاطر</span>
 <span className={cn("text-lg font-bold", getScoreColor(updatedAnalysis.risk_score || 50))}>
 {updatedAnalysis.risk_score?.toFixed(0) || '--'}
 </span>
 </div>
 </div>
 </>
 ) : (
 <div className="text-center text-muted-foreground py-8">
 <HelpCircle className="w-8 h-8 mx-auto mb-2" />
 <p className="text-sm">لا يوجد تحليل متاح</p>
 <Button variant="outline" size="sm" className="mt-2" onClick={fetchData}>
 طلب التحليل
 </Button>
 </div>
 )}
 </CardContent>
 </Card>

 {/* Chart */}
 <Card className="md:col-span-2">
 <CardContent className="p-4">
 {chartData?.ohlcv ? (
 <PriceChart data={chartData.ohlcv} analysis={updatedAnalysis} />
 ) : (
 <div className="h-64 flex items-center justify-center text-muted-foreground">
 لا توجد بيانات رسم بياني
 </div>
 )}
 </CardContent>
 </Card>
 </div>

 {/* Risk Profile - Use updatedAnalysis with current price */}
 {updatedAnalysis?.risk_profile && (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-base flex items-center gap-2">
 <Shield className="w-4 h-4" />
 ملف المخاطر
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <span className="text-xs text-muted-foreground block">منطقة الدخول</span>
 <span className="font-medium">
 {updatedAnalysis.risk_profile.entry_low && updatedAnalysis.risk_profile.entry_high
 ? `${(updatedAnalysis.risk_profile.entry_low ?? 0).toFixed(2)} - ${(updatedAnalysis.risk_profile.entry_high ?? 0).toFixed(2)}`
 : updatedAnalysis.risk_profile.entry_price?.toFixed(2) || '--'}
 </span>
 </div>
 <div className="text-center p-3 bg-profit/10 rounded-lg">
 <span className="text-xs text-muted-foreground block">الهدف</span>
 <span className="font-medium text-profit">
 {formatPrice(updatedAnalysis.risk_profile.target_price)}
 </span>
 </div>
 <div className="text-center p-3 bg-loss/10 rounded-lg">
 <span className="text-xs text-muted-foreground block">وقف الخسارة</span>
 <span className="font-medium text-loss">
 {formatPrice(updatedAnalysis.risk_profile.stop_loss_price)}
 </span>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <span className="text-xs text-muted-foreground block">نسبة المخاطرة/العائد</span>
 <span className="font-medium">
 {updatedAnalysis.risk_profile.risk_reward_ratio?.toFixed(2) || '--'}:1
 </span>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <span className="text-xs text-muted-foreground block">حجم المركز</span>
 <span className="font-medium">
 {updatedAnalysis.risk_profile.position_size_pct?.toFixed(1) || '--'}%
 </span>
 </div>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Market Regime & Sector Overview - wired July 2026 */}
 {updatedAnalysis && (updatedAnalysis.market_regime_ar || updatedAnalysis.sector_relative_score != null) && (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-base flex items-center gap-2">
 <Globe className="w-4 h-4" />
 نظرة عامة على السوق والقطاع
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <span className="text-xs text-muted-foreground block">حالة السوق</span>
 <span className="font-medium">{updatedAnalysis.market_regime_ar || 'غير معروف'}</span>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <span className="text-xs text-muted-foreground block">قوة الاتجاه</span>
 <span className={cn("text-lg font-bold", getScoreColor(updatedAnalysis.market_regime_strength || 50))}>
 {(updatedAnalysis.market_regime_strength || 0).toFixed(0)}
 </span>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <span className="text-xs text-muted-foreground block">الأداء النسبي للقطاع</span>
 <span className={cn("text-lg font-bold", getScoreColor(updatedAnalysis.sector_relative_score || 50))}>
 {(updatedAnalysis.sector_relative_score || 50).toFixed(0)}
 </span>
 </div>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Reasons & Warnings - Use updatedAnalysis */}
 {(updatedAnalysis?.reasons?.length || updatedAnalysis?.warnings?.length) && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {updatedAnalysis.reasons && updatedAnalysis.reasons.length > 0 && (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-base text-profit">أسباب الإشارة</CardTitle>
 </CardHeader>
 <CardContent>
 <ul className="space-y-2">
 {updatedAnalysis.reasons.map((reason, i) => (
 <li key={i} className="flex items-start gap-2 text-sm">
 <CheckCircle className="w-4 h-4 text-profit mt-0.5 shrink-0" />
 <span>{reason}</span>
 </li>
 ))}
 </ul>
 </CardContent>
 </Card>
 )}
 
 {updatedAnalysis.warnings && updatedAnalysis.warnings.length > 0 && (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-base text-warning">تحذيرات</CardTitle>
 </CardHeader>
 <CardContent>
 <ul className="space-y-2">
 {updatedAnalysis.warnings.map((warning, i) => (
 <li key={i} className="flex items-start gap-2 text-sm">
 <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
 <span>{warning}</span>
 </li>
 ))}
 </ul>
 </CardContent>
 </Card>
 )}
 </div>
 )}

 {/* Price Info */}
 {chartData?.indicators && (
 <Card>
 <CardContent className="p-4">
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
 <div>
 <span className="text-xs text-muted-foreground block">السعر الحالي</span>
 <span className="font-medium">{formatPrice(currentPriceValue)}</span>
 </div>
 <div>
 <span className="text-xs text-muted-foreground block">التغير 24 ساعة</span>
 <span className={cn(
 "font-medium",
 chartData.indicators.priceChangePercent24h >= 0 ? "text-profit" : "text-loss"
 )}>
 {formatPercent(chartData.indicators.priceChangePercent24h)}
 </span>
 </div>
 <div>
 <span className="text-xs text-muted-foreground block">SMA 20</span>
 <span className="font-medium">{formatPrice(chartData.indicators.sma.sma20)}</span>
 </div>
 <div>
 <span className="text-xs text-muted-foreground block">SMA 50</span>
 <span className="font-medium">{formatPrice(chartData.indicators.sma.sma50)}</span>
 </div>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Disclaimer */}
 <Card className="border-warning /50 bg-warning /20">
 <CardContent className="p-4">
 <p className="text-xs text-warning text-center">
 ⚠️ هذا التحليل للأغراض التعليمية فقط ولا يُعتبر نصيحة استثمارية. 
 جميع التحليلات مصدرها التحليل الذكي للسهم. قرارات الاستثمار مسؤوليتك الشخصية.
 </p>
 </CardContent>
 </Card>
 </div>
 );
}

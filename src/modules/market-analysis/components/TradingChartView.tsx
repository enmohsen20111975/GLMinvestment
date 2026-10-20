'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
// ALPHA-CHART-MERGE-1: TradingChartView now renders InteractiveChart directly
// (replaces ProfessionalTradingChart which was removed). TradingChartView owns
// the per-ticker data fetch + tooling header; InteractiveChart renders the
// professional sections (Decision Header / Trade Plan / Reasons / Technical
// Details / Rescue CTA) plus the chart itself.
import { InteractiveChart } from './InteractiveChart';
import { TradingViewChart } from '@/modules/stock-analysis/components/TradingViewChart';
import { ChartToggle } from '@/components/shared/ChartToggle';
import { AlertPanel } from './AlertPanel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
 LayoutGrid,
 Plus,
 Trash2,
 TrendingUp,
 TrendingDown,
 Columns,
 RefreshCw,
 X,
 Send,
 Loader2,
 Check,
 Bell,
 BellRing,
 Star,
 Maximize2,
 Minimize2,
 Image as ImageIcon,
 AlertTriangle,
 Activity,
 Gauge,
} from 'lucide-react';
import { useAppStore, MARKET_CURRENCY_LABEL } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useLiveTicker } from '@/lib/ws-client';
import { useAlertsStore } from '@/lib/alerts-store';
import { ExchangeSelector } from '@/components/layout/ExchangeSelector';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { StockSearchSelector } from '@/components/shared/StockSearchSelector';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';
// ALPHA-CHART-MERGE-1: canonical decision source (Rule 73 — single display source)
import type { UnifiedStockData } from '@/lib/unified-stock-data';

interface TradingChartViewProps {
 initialTicker?: string;
}

// ─── Local types (ALPHA-CHART-MERGE-1) ───────────────────────────────────────
// Mirrors the response of /api/v2/chart/full-analysis + /api/crypto/full-analysis.
// Kept local to avoid touching SingleStockAnalysisView's exported types.
interface ChartAnalysisData {
 success?: boolean;
 error?: string;
 ticker: string;
 name?: string;
 name_ar?: string;
 timeframe: string;
 ohlcv: Array<{
 time: string;
 open: number;
 high: number;
 low: number;
 close: number;
 volume: number;
 }>;
 indicators: Record<string, Array<{ time: string; value: number | null }>>;
 levels?: {
 support: number | null;
 resistance: number | null;
 pivot: number | null;
 far_support?: number | null;
 far_resistance?: number | null;
 support_levels?: { price: number; strength: string }[];
 resistance_levels?: { price: number; strength: string }[];
 };
 market_regime?: { regime?: string; regime_ar?: string; confidence?: number; color?: string };
 bos_events?: Array<{ index: number; type: string; price: number; level: number }>;
 bb_squeeze?: { state?: string; color?: string; text?: string };
 current_indicators?: {
 rsi?: number;
 rsi_trend_ar?: string;
 rsi_color?: string;
 macd?: number;
 macd_signal?: number;
 macd_hist?: number;
 macd_trend_ar?: string;
 macd_color?: string;
 cmf?: number;
 atr?: number;
 sma20?: number;
 sma50?: number;
 };
 smc_analysis?: { score?: number; score_pct?: number; bias_ar?: string; summary_ar?: string };
 fusion_metrics?: {
 score?: number;
 signal?: string;
 signal_ar?: string;
 fair_value?: number;
 fair_premium?: number;
 bigbeluga?: {
 trend: number;
 in_pocket: boolean;
 fib_618: number;
 fib_786: number;
 basis: number;
 upper_band: number;
 lower_band: number;
 };
 risk?: {
 entry: number;
 sl: number;
 tp1: number;
 tp2: number;
 risk_amount?: number;
 rr_ratio_tp1?: number;
 rr_ratio_tp2?: number;
 };
 ready?: boolean;
 };
 cmf_data?: Array<{ time: string; value: number | null }>;
 macd_projection?: Array<number | null>;
 smart_markers?: Array<{
 time: string;
 type: string;
 position: string;
 color: string;
 shape: string;
 text: string;
 }>;
 smc_data?: {
 order_blocks?: Array<{ type: string; top: number; bottom: number; time?: number }>;
 fvgs?: Array<{ type: string; top: number; bottom: number; time?: number }>;
 sweeps?: Array<{ type: string; level: number; time?: number }>;
 score?: number;
 signals?: string[];
 ready?: boolean;
 smc_zones?: Array<{ type: string; top: number; bottom: number; zone_type: string }>;
 };
 confluence?: {
 score?: number;
 breakdown?: Record<string, { passed: boolean; points: number; max: number; detail: string }>;
 signal?: string;
 signal_color?: string;
 };
 institutional_decision?: {
 signal_final?: string;
 path_taken?: string;
 adjustment_reason?: string;
 risk_profile?: {
 entry?: number;
 sl?: number;
 tp1?: number;
 tp2?: number;
 rr_ratio_tp1?: number;
 };
 flight_state?: { state?: string };
 maker_state?: { state?: string };
 } | null;
 stock_dna?: {
 typical_range?: { current_position?: string };
 } | null;
 analysis_text?: string;
 suggested_position_size_pct?: number;
 position_warning?: string;
}

export function TradingChartView({ initialTicker }: TradingChartViewProps) {
 const { stocks, loadStocks, marketOverview, currentMarket } = useAppStore();
 const isCrypto = currentMarket === 'CRYPTO';
 const defaultTicker = (initialTicker || (isCrypto ? 'BTC' : 'PHDC')).toUpperCase();
 const [columns, setColumns] = useState<1 | 2>(1);
 const [selectedStockToAdd, setSelectedStockToAdd] = useState('');
 const [publishingAll, setPublishingAll] = useState(false);

 // ─── قائمة الأسهم المعروضة في اللوحة (لكل سهم شاشته الشاملة بالكامل) ───
 const [selectedTickers, setSelectedTickers] = useState<string[]>(() => {
 return [defaultTicker];
 });

 useEffect(() => {
 loadStocks('');
 }, [loadStocks]);

 // ─── إضافة سهم جديد للوحة ───
 const handleAddStock = (tickerToAdd?: string) => {
 const targetTicker = (tickerToAdd || selectedStockToAdd).trim().toUpperCase();
 if (!targetTicker) {
 toast.info('اختر سهمًا أولاً لإضافته للتحليل');
 return;
 }

 if (selectedTickers.includes(targetTicker)) {
 toast.info(`السهم ${targetTicker} مضاف بالفعل في اللوحة`);
 return;
 }

 if (selectedTickers.length >= 6) {
 toast.warning('يمكنك إضافة حتى 6 أسهم كحد أقصى للوحة التحليل');
 return;
 }

 setSelectedTickers((prev) => [...prev, targetTicker]);
 setSelectedStockToAdd('');
 toast.success(`تمت إضافة الشارت والتحليل الشامل لـ ${targetTicker}`);
 };

 // ─── إزالة سهم من اللوحة ───
 const handleRemoveStock = (tickerToRemove: string) => {
 if (selectedTickers.length <= 1) {
 toast.info('يجب الإبقاء على سهم واحد على الأقل في اللوحة');
 return;
 }
 setSelectedTickers((prev) => prev.filter((t) => t !== tickerToRemove));
 };

 // ─── إعادة تعيين اللوحة ───
 const handleResetWorkspace = () => {
 setSelectedTickers([defaultTicker]);
 toast.success('تمت إعادة التعيين للسهم الرئيسي');
 };

 // ─── نشر جميع الشارتات على تيليجرام ───
 const handlePublishAll = useCallback(async () => {
 setPublishingAll(true);
 try {
 const cards = Array.from(document.querySelectorAll('[id^="chart-card-"]'));
 if (cards.length === 0) {
 toast.error('لا توجد شارتات للنشر');
 return;
 }

 let successCount = 0;
 for (const card of cards) {
 try {
 const dataUrl = await toPng(card as HTMLElement, {
 quality: 0.95,
 pixelRatio: 2,
 backgroundColor: '#ffffff',
 cacheBust: true,
 skipFonts: true,
 style: {
 transform: 'scale(1)',
 transformOrigin: 'top right',
 },
 });

 const ticker = (card as HTMLElement).id.replace('chart-card-', '');
 const res = await fetch('/api/market/publish-status-image', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 image: dataUrl,
 market: isCrypto ? 'CRYPTO' : 'EGX',
 caption: `📊 تحليل شامل لسهم ${ticker}\n${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })}`,
 }),
 });

 const data = await res.json().catch(() => ({}));
 if (res.ok && data.success) {
 successCount++;
 }
 } catch (err) {
 console.error('Failed to publish chart:', err);
 }
 }

 if (successCount > 0) {
 toast.success(`تم نشر ${successCount} من ${cards.length} شارت بنجاح`);
 } else {
 toast.error('فشل في نشر الشارتات');
 }
 } finally {
 setPublishingAll(false);
 }
 }, [isCrypto]);

 return (
 <div
 dir="rtl"
 className="w-full min-h-screen overflow-y-auto bg-background text-foreground p-2 md:p-5 pb-28 space-y-5"
 >
 <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
 <div className="border-b border-border bg-gradient-to-r from-profit via-background to-sky-50/20 dark:via-card dark:to-sky-950/20 px-4 py-4 md:px-5 md:py-5">
 <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
 <div className="space-y-2">
 <div className="flex items-center gap-2 text-profit">
 <LayoutGrid className="w-5 h-5" />
 <span className="text-xs font-bold tracking-[0.22em] uppercase">غرفة التداول</span>
 </div>
 <h1 className="text-xl md:text-2xl font-black text-foreground">
 الشارت التفاعلي والتحليل المتقدم
 </h1>
 <p className="text-xs text-muted-foreground max-w-2xl">
 مقارنة فورية للأسهم مع تحليل السعر، مستويات الدعم والمقاومة، المخاطرة، ومؤشرات التوافق الفني.
 </p>
 </div>

 <div className="flex flex-wrap items-center gap-2">
 <ExchangeSelector compact className="h-9 text-xs rounded-xl border-border bg-card" />
 {marketOverview && (
 <div className="hidden lg:flex items-center gap-2 text-xs">
 <Badge variant="outline" className="text-profit border-profit bg-profit px-2.5 py-1">
 <TrendingUp className="w-3 h-3 ml-0.5" />
 ارتفاعات: {marketOverview.summary.gainers}
 </Badge>
 <Badge variant="outline" className="text-loss border-loss bg-loss px-2.5 py-1">
 <TrendingDown className="w-3 h-3 ml-0.5" />
 خسائر: {marketOverview.summary.losers}
 </Badge>
 </div>
 )}
 </div>
 </div>
 </div>

 <div className="px-4 py-4 md:px-5">
 <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
 <div className="flex-1 min-w-0">
 <StockSearchSelector
 mode="add"
 placeholder="إدراج سهم آخر للتحليل..."
 onSelectStock={(ticker) => handleAddStock(ticker)}
 buttonClassName="w-full border-border bg-muted hover:bg-card text-foreground rounded-xl shadow-sm"
 />
 </div>

 <div className="flex flex-wrap items-center gap-2">
 <div className="flex bg-muted p-1 rounded-xl border border-border">
 <Button
 variant="ghost"
 size="sm"
 onClick={() => setColumns(1)}
 className={cn(
 'h-8 px-2.5 text-xs font-bold rounded-lg transition-all',
 columns === 1 ? 'bg-card text-profit shadow-sm' : 'text-muted-foreground'
 )}
 >
 1 عمود
 </Button>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => setColumns(2)}
 className={cn(
 'h-8 px-2.5 text-xs font-bold rounded-lg transition-all',
 columns === 2 ? 'bg-card text-profit shadow-sm' : 'text-muted-foreground'
 )}
 >
 2 عمود
 </Button>
 </div>

 <Badge className="font-mono text-xs px-2.5 py-1 bg-profit text-profit border border-profit">
 {selectedTickers.length} سهم
 </Badge>

 {selectedTickers.length > 1 && (
 <Button
 variant="ghost"
 size="sm"
 onClick={handleResetWorkspace}
 className="h-8 px-2.5 text-xs text-loss hover:bg-loss gap-1.5"
 >
 <RefreshCw className="w-3.5 h-3.5" />
 إعادة تعيين
 </Button>
 )}

 <Button
 variant="ghost"
 size="sm"
 onClick={handlePublishAll}
 disabled={publishingAll || selectedTickers.length === 0}
 className="h-8 px-2.5 text-xs text-profit hover:bg-profit gap-1.5"
 >
 {publishingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
 نشر الكل
 </Button>
 </div>
 </div>

 {selectedTickers.length > 0 && (
 <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-border">
 <span className="text-xs md:text-xs font-bold text-muted-foreground">الأوراق المعروضة:</span>
 {selectedTickers.map((tk, idx) => {
 const st = stocks.find((s) => s.ticker === tk);
 const isPrimary = idx === 0;
 return (
 <Badge
 key={tk}
 variant={isPrimary ? 'secondary' : 'outline'}
 className={cn(
 'text-xs font-mono py-1 px-2.5 flex items-center gap-1.5 rounded-full',
 isPrimary
 ? 'bg-profit text-profit border border-profit'
 : 'bg-card text-foreground border border-border'
 )}
 >
 <span>{st?.name_ar || tk}</span>
 <span className="text-xs text-muted-foreground font-bold">({tk})</span>
 {!isPrimary && (
 <button
 type="button"
 onClick={() => handleRemoveStock(tk)}
 className="hover:text-loss transition-colors ml-0.5"
 title={`إزالة ${tk}`}
 >
 <X className="w-3 h-3" />
 </button>
 )}
 </Badge>
 );
 })}
 </div>
 )}
 </div>
 </div>

 <div
 className={cn(
 'grid gap-6 w-full transition-all duration-300 p-2 md:p-5',
 columns === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'
 )}
 >
 {selectedTickers.map((tk) => (
 <TickerChartCard key={tk} initialTicker={tk} />
 ))}
 </div>
 </div>
 );
}

// ─── ALPHA-CHART-MERGE-1: Per-ticker chart card ──────────────────────────────
// Owns the data-fetch state (moved here from ProfessionalTradingChart) and the
// tooling header (search / timeframe / refresh / alerts / screenshot). Renders
// InteractiveChart with all the professional sections enabled.
function TickerChartCard({ initialTicker }: { initialTicker: string }) {
 const { stocks, currentMarket, chartPreference } = useAppStore();
 const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket] || 'ج.م';
 const isCrypto = currentMarket === 'CRYPTO';
 const [ticker, setTicker] = useState(initialTicker);
 const [timeframe, setTimeframe] = useState('DAY');
 const [data, setData] = useState<ChartAnalysisData | null>(null);
 const [canonical, setCanonical] = useState<UnifiedStockData | null>(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [isMaximized, setIsMaximized] = useState(false);
 const [alertPanelOpen, setAlertPanelOpen] = useState(false);
 const [advancedLevels, setAdvancedLevels] = useState(false); // Fib/FVG/OB
 const [extraIndicators, setExtraIndicators] = useState(false); // RSI/MACD
 const [quickAdding, setQuickAdding] = useState(false);
 const [quickAdded, setQuickAdded] = useState(false);

 const cardRef = useRef<HTMLDivElement>(null);
 const [screenshotting, setScreenshotting] = useState(false);

 const { liveData, isLive } = useLiveTicker(ticker);
 const activeAlertsCount = useAlertsStore(
 (s) => s.alerts.filter((a) => a.ticker === ticker.toUpperCase() && a.enabled).length
 );
 const addAlert = useAlertsStore((s) => s.addAlert);

 // ─── عرض افتراضي نظيف للشارت ────────────────────────────────────────────────
 const [visibleIndicators, setVisibleIndicators] = useState<Record<string, boolean>>({
 sma20: true,
 sma50: true,
 sma200: true,
 ema: false,
 rsi: false,
 cmf: false,
 bb: false,
 macd: false,
 volume: true,
 obv: false,
 fibonacci: false,
 levels: true,
 bos: false,
 });

 const fetchData = useCallback(async (tk: string, tf: string) => {
 setLoading(true);
 setError(null);
 // UNIFY-FIX: جلب موازٍ من unified API — المصدر الكنسي الوحيد للقرار (Rule 73)
 // signal/score/entry/stop/target تأتي ONLY من هنا (predictions.db — Python V40.2)
 if (!isCrypto) {
 fetch(`/api/stocks/${encodeURIComponent(tk)}/unified?_t=${Date.now()}`)
 .then((r) => (r.ok ? r.json() : null))
 .then((json: UnifiedStockData | null) => setCanonical(json))
 .catch(() => setCanonical(null));
 } else {
 setCanonical(null);
 }
 try {
 const LIMIT_MAP: Record<string, number> = {
 '5M': 500, '15M': 500, '1H': 500, TODAY: 200, DAY: 365, WEEK: 730, MONTH: 1825,
 };
 const limit = LIMIT_MAP[tf] || 365;
 const url = isCrypto
 ? `/api/crypto/full-analysis?ticker=${encodeURIComponent(tk)}&timeframe=${tf}&limit=${limit}&_t=${Date.now()}`
 : `/api/v2/chart/full-analysis?ticker=${encodeURIComponent(tk)}&timeframe=${tf}&limit=${limit}&_t=${Date.now()}`;
 const res = await fetch(url);
 const json = await res.json();
 if (!json.success && !json.ohlcv) {
 setError(json.error || `خطأ في تحميل بيانات ${tk}`);
 return;
 }
 setData(json as ChartAnalysisData);
 } catch (err) {
 setError(err instanceof Error ? err.message : 'فشل تحميل البيانات');
 } finally {
 setLoading(false);
 }
 }, [isCrypto]);

 useEffect(() => {
 fetchData(ticker, timeframe);
 }, [ticker, timeframe, fetchData]);

 const handleSelectTicker = (newTk: string) => setTicker(newTk);

 const toggleAdvancedLevels = () => {
 setAdvancedLevels((v) => {
 const next = !v;
 setVisibleIndicators((prev) => ({
 ...prev,
 fibonacci: next,
 bos: next,
 }));
 return next;
 });
 };

 const toggleExtraIndicators = () => {
 setExtraIndicators((v) => {
 const next = !v;
 setVisibleIndicators((prev) => ({
 ...prev,
 rsi: next,
 macd: next,
 bb: next,
 }));
 return next;
 });
 };

 // ─── القيم الكنسية للقرار (ONLY من canonical — Rule 73) ─────────────────────
 const decision = data?.institutional_decision;
 const signalFinal = canonical?.canonical?.signal || decision?.signal_final || '';
 const masterScore = canonical?.canonical?.master_score ?? null;

 const pred = canonical?.prediction;
 const rawEntry = pred?.entry_price ?? decision?.risk_profile?.entry ?? null;
 const rawStop = pred?.stop_loss ?? decision?.risk_profile?.sl ?? null;
 const rawTarget1 = pred?.target_price ?? decision?.risk_profile?.tp1 ?? null;
 const rawTarget2 = pred?.target_price_2 ?? decision?.risk_profile?.tp2 ?? null;
 const rawRr = pred?.risk_reward ?? decision?.risk_profile?.rr_ratio_tp1 ?? null;
 const isBuySignal = Boolean(
 signalFinal && (
 signalFinal.toUpperCase().includes('BUY') ||
 signalFinal.toUpperCase().includes('ACCUMULATE')
 )
 );
 // Buy-signal gate: only show trade plan for genuine BUY signals
 const entry = isBuySignal ? rawEntry : null;
 const stop = isBuySignal ? rawStop : null;
 const target1 = isBuySignal ? rawTarget1 : null;
 const target2 = isBuySignal ? rawTarget2 : null;
 const rr = isBuySignal ? rawRr : null;
 const techScore = masterScore;

 // السعر الحالي
 const stockInfo = stocks.find((s) => s.ticker === ticker.toUpperCase());
 const tc = liveData?.today_candle || data?.ohlcv?.[data.ohlcv.length - 1];
 const livePrice = liveData?.today_candle?.close ?? tc?.close ?? stockInfo?.current_price ?? 0;
 const prevClose = data?.ohlcv?.[data.ohlcv.length - 2]?.close ?? livePrice;
 const chgPct = prevClose > 0 ? ((livePrice - prevClose) / prevClose) * 100 : 0;
 const isUp = chgPct >= 0;

 // ─── Quick-Add Price Alert ──────────────────────────────────────────────────
 const handleQuickAddAlert = useCallback(async () => {
 if (quickAdding) return;
 const refPrice = livePrice > 0 ? livePrice : (stockInfo?.current_price ?? 0);
 if (refPrice <= 0) {
 toast.error('لا يوجد سعر متاح لتسجيل التنبيه');
 return;
 }
 setQuickAdding(true);
 setQuickAdded(false);
 try {
 const DROP_PCT = -3;
 const res = await fetch('/api/alerts/quick-add', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 ticker: ticker.toUpperCase(),
 current_price: refPrice,
 drop_pct: DROP_PCT,
 label: `تنبيه سريع: ${ticker.toUpperCase()} نزل ${DROP_PCT}% تحت ${(refPrice ?? 0).toFixed(2)}`,
 }),
 });
 const json = await res.json().catch(() => ({}));
 if (!res.ok || !json.success) {
 throw new Error(json.error || 'فشل حفظ التنبيه');
 }
 const thresholdPrice = Number((refPrice * (1 + DROP_PCT / 100)).toFixed(4));
 addAlert({
 ticker: ticker.toUpperCase(),
 type: 'price_below',
 threshold: thresholdPrice,
 label: `تنبيه سريع: ${ticker.toUpperCase()} نزل ${DROP_PCT}% تحت ${(refPrice ?? 0).toFixed(2)} (عتبة: ${(thresholdPrice ?? 0).toFixed(2)})`,
 });
 setQuickAdded(true);
 toast.success(`🔔 تنبيه مسجّل: ${ticker.toUpperCase()} نزل ${DROP_PCT}% تحت ${(refPrice ?? 0).toFixed(2)}`);
 setTimeout(() => setQuickAdded(false), 2000);
 } catch (err) {
 toast.error(err instanceof Error ? err.message : 'فشل تسجيل التنبيه');
 } finally {
 setQuickAdding(false);
 }
 }, [ticker, livePrice, stockInfo?.current_price, quickAdding, addAlert]);

 // ─── Screenshot ──────────────────────────────────────────────────────────────
 const handleScreenshot = useCallback(async () => {
 if (!cardRef.current) return;
 setScreenshotting(true);
 try {
 const dataUrl = await toPng(cardRef.current, {
 quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff',
 cacheBust: true, skipFonts: true,
 });
 const link = document.createElement('a');
 link.download = `${ticker.toUpperCase()}_analysis_${new Date().toISOString().split('T')[0]}.png`;
 link.href = dataUrl;
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 toast.success('تم تحميل صورة التحليل');
 } catch {
 toast.error('فشل في التقاط الصورة');
 } finally {
 setScreenshotting(false);
 }
 }, [ticker]);

 const tickerName =
 data?.name_ar || data?.name || stockInfo?.name_ar || stockInfo?.name || ticker;

 // ─── Canonical props bundle for InteractiveChart ─────────────────────────────
 const canonicalProp = canonical
 ? {
 signal: signalFinal || undefined,
 signal_ar: canonical.canonical?.signal_ar || undefined,
 entry_price: entry,
 stop_loss: stop,
 target_price: target1,
 target_price_2: target2,
 tech_score: techScore,
 risk_reward: rr,
 }
 : undefined;

 const decisionDataProp = decision
 ? {
 path_taken: decision.path_taken,
 adjustment_reason: decision.adjustment_reason,
 }
 : undefined;

 return (
 <div
 id={`chart-card-${ticker.toUpperCase()}`}
 ref={cardRef}
 dir="rtl"
 className={cn(
 'border border-border bg-card rounded-2xl shadow-sm overflow-hidden flex flex-col',
 isMaximized ? 'fixed inset-2 z-50 overflow-y-auto p-4' : 'w-full'
 )}
 >
 {/* ════════════════════════════════════════════════════════════════════════
 Header bar — tooling (search / timeframe / refresh / alerts / screenshot)
 The Decision Header (signal + entry/stop/target/R:R) is delegated to
 InteractiveChart's §1 section.
 ════════════════════════════════════════════════════════════════════════ */}
 <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
 <div className="flex items-center gap-2 flex-wrap">
 <StockSearchSelector
 value={ticker}
 onSelectStock={handleSelectTicker}
 placeholder="اختر السهم"
 compact
 buttonClassName="w-[140px] md:w-[170px] bg-card border-border shadow-sm rounded-xl"
 />
 <div className="min-w-0">
 <div className="flex items-center gap-2">
 <Badge
 variant="outline"
 className={cn(
 'font-mono text-xs font-black px-2 py-0.5 rounded-full',
 isUp
 ? 'bg-profit text-profit border-profit/20'
 : 'bg-loss text-loss border-loss/20'
 )}
 >
 {livePrice > 0 ? `${(livePrice ?? 0).toFixed(2)} ${currencyLabel}` : '—'}
 <span className="text-xs mr-1">
 ({isUp ? '+' : ''}{(chgPct ?? 0).toFixed(1)}%)
 </span>
 </Badge>
 {isLive && (
 <Badge className={cn(
 'text-xs font-bold rounded-full',
 liveData?.delayed_mode
 ? 'bg-warning text-white border border-warning'
 : 'bg-loss text-white animate-pulse'
 )}>
 {liveData?.delayed_mode ? `DELAYED ${liveData.delayed_minutes || 5}M` : 'LIVE'}
 </Badge>
 )}
 </div>
 </div>
 </div>

 <div className="flex items-center gap-1">
 {/* Timeframe */}
 <div className="flex bg-muted border border-border rounded-xl p-0.5 text-xs font-semibold gap-0.5">
 {['DAY', 'WEEK', 'MONTH'].map((tf) => (
 <button
 key={tf}
 type="button"
 onClick={() => setTimeframe(tf)}
 className={cn(
 'px-2 py-1 rounded-lg transition-colors',
 timeframe === tf
 ? 'bg-profit text-white font-bold shadow-sm'
 : 'text-muted-foreground hover:text-foreground'
 )}
 >
 {tf === 'DAY' ? 'يومي' : tf === 'WEEK' ? 'أسبوعي' : 'شهري'}
 </button>
 ))}
 </div>
 <Button variant="ghost" size="sm" onClick={() => fetchData(ticker, timeframe)} disabled={loading} className="h-8 w-8 p-0 rounded-lg">
 <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
 </Button>
 <Button variant="ghost" size="sm" onClick={() => setAlertPanelOpen(true)} className="h-8 w-8 p-0 rounded-lg relative">
 {activeAlertsCount > 0 ? <BellRing className="h-3.5 w-3.5 text-warning" /> : <Bell className="h-3.5 w-3.5" />}
 </Button>
 <Button variant="ghost" size="sm" onClick={handleQuickAddAlert} disabled={quickAdding || livePrice <= 0} className="h-8 w-8 p-0 rounded-lg">
 {quickAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : quickAdded ? <Check className="h-3.5 w-3.5 text-profit" /> : <Star className="h-3.5 w-3.5" />}
 </Button>
 <Button variant="ghost" size="sm" onClick={() => setIsMaximized((v) => !v)} className="h-8 w-8 p-0 rounded-lg">
 {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
 </Button>
 <Button variant="ghost" size="sm" onClick={handleScreenshot} disabled={screenshotting} className="h-8 w-8 p-0 rounded-lg">
 {screenshotting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
 </Button>
 </div>
 </div>

 {/* ════════════════════════════════════════════════════════════════════════
 Chart toolbar — advanced levels + extra indicators
 ════════════════════════════════════════════════════════════════════════ */}
 <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-2 flex-wrap">
 <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
 شارت الأسعار
 </div>
 <div className="flex items-center gap-1.5">
 <Button
 variant={advancedLevels ? 'default' : 'outline'}
 size="sm"
 onClick={toggleAdvancedLevels}
 className={cn('h-7 text-xs px-2.5 rounded-lg', advancedLevels && 'bg-profit text-white')}
 >
 <Activity className="w-3 h-3 ml-1" />
 مستويات متقدمة
 </Button>
 <Button
 variant={extraIndicators ? 'default' : 'outline'}
 size="sm"
 onClick={toggleExtraIndicators}
 className={cn('h-7 text-xs px-2.5 rounded-lg', extraIndicators && 'bg-profit text-white')}
 >
 <Gauge className="w-3 h-3 ml-1" />
 مؤشرات
 </Button>
 </div>
 </div>

 {/* Body — chart (toggle between InteractiveChart and TradingViewChart) */}
 {/* ALPHA-CHART-TOGGLE-1: user can switch between InteractiveChart and TradingViewChart */}
 <div className="flex justify-end mb-1">
 <ChartToggle />
 </div>
 <div className={cn('flex-1 min-h-0', isMaximized ? 'h-[600px]' : 'h-[500px]')}>
 {loading && !data ? (
 <div className="w-full h-full p-4 space-y-3">
 <Skeleton className="h-20 w-full rounded-xl" />
 <Skeleton className="h-96 w-full rounded-xl" />
 <Skeleton className="h-32 w-full rounded-xl" />
 </div>
 ) : error ? (
 <div className="w-full h-full p-8 text-center">
 <AlertTriangle className="w-12 h-12 mx-auto text-warning mb-3" />
 <p className="text-sm text-muted-foreground mb-3">{error}</p>
 <Button variant="outline" size="sm" onClick={() => fetchData(ticker, timeframe)}>
 <RefreshCw className="w-4 h-4 ml-1" /> إعادة المحاولة
 </Button>
 </div>
 ) : data && data.ohlcv && data.ohlcv.length > 0 ? (
 chartPreference === 'tradingview' ? (
 <TradingViewChart ticker={ticker} stockName={tickerName} />
 ) : (
 <InteractiveChart
 ohlcv={data.ohlcv}
 indicators={data.indicators || {}}
 visibleIndicators={visibleIndicators}
 levels={data.levels}
 regimeColor={data.market_regime?.color}
 targetPrice={target1 ?? undefined}
 stopLossPrice={stop ?? undefined}
 entryPrice={entry ?? undefined}
 target2Price={target2 ?? undefined}
 bbSqueezeLevel={data.bb_squeeze?.state}
 bosEvents={data.bos_events}
 livePrice={liveData?.today_candle?.close ?? null}
 cmfData={data.cmf_data}
 macdProjection={data.macd_projection}
 smartMarkers={data.smart_markers}
 smcData={data.smc_data}
 fusionMetrics={data.fusion_metrics as unknown as NonNullable<React.ComponentProps<typeof InteractiveChart>['fusionMetrics']>}
 // ALPHA-CHART-MERGE-1: professional sections props
 canonical={canonicalProp}
 decisionData={decisionDataProp}
 flightState={decision?.flight_state}
 makerState={decision?.maker_state}
 stockDna={data.stock_dna ?? undefined}
 confluence={data.confluence}
 currentIndicators={data.current_indicators}
 suggestedPositionSizePct={data.suggested_position_size_pct}
 analysisText={data.analysis_text}
 smcAnalysis={data.smc_analysis}
 showDecisionHeader
 showTradePlan
 showReasons
 showTechnicalDetails
 showRescueCTA
 tickerName={tickerName}
 currencyLabel={currencyLabel}
 />
 )
 ) : (
 <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
 <div className="text-center space-y-1">
 <p>بانتظار تحميل الشموع — يتم التحميل تلقائياً</p>
 <p className="text-xs">إذا لم تظهر خلال لحظات، يمكن للسهم غير متوفر على TradingView</p>
 </div>
 </div>
 )}
 </div>

 <AlertPanel ticker={ticker} open={alertPanelOpen} onClose={() => setAlertPanelOpen(false)} />
 </div>
 );
}

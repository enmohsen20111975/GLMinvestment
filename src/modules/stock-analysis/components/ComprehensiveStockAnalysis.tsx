'use client';

/**
 * ComprehensiveStockAnalysis
 * ==========================
 * شاشة التحليلات الشاملة لسهم واحد — تجمع كل المحركات:
 * - Basic Info + Price
 * - Technical Analysis (RSI, MA, S/R, indicators)
 * - Fundamental Analysis (P/E, ROE, Debt, etc.)
 * - Maestro Orchestrator (phases, score, recommendation)
 * - Hunter / Board of Analysts
 * - Price Chart with indicators
 * - News & Sentiment
 * - Predictions history
 * - AI Professional Analysis
 *
 * كل التبويبات بترسم من response الـ /api/stocks/[ticker]/comprehensive
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
 TrendingUp, TrendingDown, Activity, BarChart3, DollarSign,
 Shield, Target, Newspaper, Brain, Zap, Award, AlertTriangle,
 RefreshCw, Clock, ChevronRight, Gauge, PieChart, LineChart as LineChartIcon,
} from 'lucide-react';
import {
 Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
 ReferenceLine, Line, LineChart, Bar, BarChart, ComposedChart,
 RadialBar, RadialBarChart, PolarAngleAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
 Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ExpertAnalysisPanel } from './ExpertAnalysisPanel';

// ============================================================================
// Types
// ============================================================================

interface ComprehensiveData {
 success: boolean;
 ticker: string;
 market: string;
 timestamp: string;
 basic?: Record<string, unknown> | null;
 price?: Record<string, unknown> | null;
 keyMetrics?: Record<string, unknown> | null;
 technical?: Record<string, unknown> | null;
 priceHistory?: Array<Record<string, unknown>>;
 maestro?: Record<string, unknown> | null;
 hunter?: Record<string, unknown> | null;
 board?: Record<string, unknown> | null;
 news?: Array<Record<string, unknown>>;
 predictions?: Array<Record<string, unknown>>;
 professional?: Record<string, unknown> | null;
 errors: string[];
 elapsed_ms: number;
}

// ============================================================================
// Helpers
// ============================================================================

function formatPrice(v: number | null | undefined, digits = 2): string {
 if (v === null || v === undefined || isNaN(Number(v))) return '—';
 return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPct(v: number | null | undefined, digits = 2): string {
 if (v === null || v === undefined || isNaN(Number(v))) return '—';
 const n = Number(v);
 return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function formatVolume(v: number | null | undefined): string {
 if (!v || isNaN(Number(v))) return '—';
 const n = Number(v);
 if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
 if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
 if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
 return n.toString();
}

function formatMarketCap(v: number | null | undefined): string {
 if (!v || isNaN(Number(v))) return '—';
 const n = Number(v);
 if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
 if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
 if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
 return n.toString();
}

function shortDate(s: string): string {
 if (!s) return '';
 try {
 const d = new Date(s);
 if (isNaN(d.getTime())) return s.slice(0, 10);
 return `${d.getDate()}/${d.getMonth() + 1}`;
 } catch {
 // FRONTEND-CLEANUP-A-2: type-safe accessors for Record<string, unknown> fields.
 // تحل الـ TS2339/TS18046/TS18049 errors بدون logic changes (type-only).
 return s.slice(0, 10);
 }
}

// FRONTEND-CLEANUP-A-2: type-safe value extractors (fix TS2339/TS18046/TS18049).
// بـ تستخرج القيمة من Record<string, unknown> وتحوّلها للنوع الصحيح بأمان.
function numVal(v: unknown): number | null {
 if (v == null) return null;
 const n = Number(v);
 return Number.isFinite(n) ? n : null;
}

function strVal(v: unknown): string {
 if (v == null) return '';
 return String(v);
}

function numOr(v: unknown, fallback: number = 0): number {
 const n = numVal(v);
 return n !== null ? n : fallback;
}

// Color helpers
function changeColor(v: number | null | undefined): string {
 if (v === null || v === undefined) return 'text-muted-foreground';
 const n = Number(v);
 if (n > 0) return 'text-profit ';
 if (n < 0) return 'text-loss ';
 return 'text-muted-foreground';
}

function scoreColor(score: number): string {
 if (score >= 70) return 'text-profit ';
 if (score >= 50) return 'text-warning ';
 if (score >= 30) return 'text-warning ';
 return 'text-loss ';
}

function scoreBg(score: number): string {
 if (score >= 70) return 'bg-profit';
 if (score >= 50) return 'bg-warning';
 if (score >= 30) return 'bg-warning';
 return 'bg-loss';
}

function signalBadge(signal: string): { label: string; className: string } {
 // ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ───────────────
 // قبل كده: كان في 5 labels فقط (شراء قوي/شراء/بيع قوي/بيع/انتظار) —
 // ACCUMULATE/REDUCE كانوا بـ يقعوا في 'انتظار' → العميل بيشوف 'انتظار' بدل 'تجميع'.
 // الحل: إضافة الـ 7 levels الـ canonical.
 const s = (signal || '').toLowerCase();
 if (s.includes('strong_buy')) return { label: 'شراء قوي', className: 'bg-profit text-white' };
 if (s.includes('buy')) return { label: 'شراء', className: 'bg-profit text-profit ' };
 if (s.includes('accumulate')) return { label: 'تجميع', className: 'bg-primary text-primary ' };
 if (s.includes('strong_sell')) return { label: 'بيع قوي', className: 'bg-loss text-white' };
 if (s.includes('sell')) return { label: 'بيع', className: 'bg-loss text-loss ' };
 if (s.includes('reduce')) return { label: 'تخفيض', className: 'bg-warning text-warning ' };
 return { label: 'انتظار', className: 'bg-muted text-muted-foreground ' };
}

// ============================================================================
// Score Gauge (Radial)
// ============================================================================

function ScoreGauge({ score, label, size = 120 }: { score: number; label: string; size?: number }) {
 const data = [{ name: label, value: score, fill: score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : score >= 30 ? '#f97316' : '#ef4444' }];
 return (
 <div className="flex flex-col items-center">
 <ResponsiveContainer width={size} height={size}>
 <RadialBarChart innerRadius="70%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
 <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
 <RadialBar background dataKey="value" cornerRadius={10} />
 </RadialBarChart>
 </ResponsiveContainer>
 <div className="-mt-[75px] text-center pointer-events-none">
 <div className={cn('text-2xl font-bold', scoreColor(score))}>{Math.round(score)}</div>
 <div className="text-xs text-muted-foreground">{label}</div>
 </div>
 <div className="mt-[45px]" />
 </div>
 );
}

// ============================================================================
// Main Component
// ============================================================================

interface Props {
 ticker: string;
 market?: string;
}

export function ComprehensiveStockAnalysis({ ticker, market = 'EGX' }: Props) {
 const [data, setData] = useState<ComprehensiveData | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [activeTab, setActiveTab] = useState('overview');

 // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
 // Single source of truth — all screens read from /api/stocks/[ticker]/unified
 // (canonical signal_ar + technical.rsi/ma_50/ma_200 + accumulation + money_flow).
 // Old fetch (/api/stocks/[ticker]/comprehensive) is kept as fallback.
 const [unifiedData, setUnifiedData] = useState<any>(null);

 const fetchData = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const res = await fetch(
 `/api/stocks/${encodeURIComponent(ticker)}/comprehensive?market=${encodeURIComponent(market)}`,
 { cache: 'no-store' }
 );
 if (!res.ok) {
 throw new Error(`HTTP ${res.status}`);
 }
 const json = await res.json();
 setData(json);
 } catch (e) {
 setError('تعذّر تحميل التحليل. يرجى المحاولة مرة أخرى.');
 } finally {
 setLoading(false);
 }
 }, [ticker, market]);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — best-effort fetch.
 // If this fails, we fall back to comprehensive-only display.
 useEffect(() => {
 if (!ticker) return;
 fetch(`/api/stocks/${encodeURIComponent(ticker)}/unified`)
 .then((res) => (res.ok ? res.json() : null))
 .then((d) => {
 if (d?.success) setUnifiedData(d);
 })
 .catch((err) => console.error('[unified] fetch failed:', err));
 }, [ticker]);

 if (loading) {
 return <LoadingSkeleton />;
 }

 if (error) {
 return (
 <Card className="border-destructive">
 <CardContent className="p-8 text-center">
 <AlertTriangle className="w-12 h-12 text-loss mx-auto mb-4" />
 <p className="text-lg font-bold mb-2">فشل تحميل التحليل</p>
 <p className="text-sm text-muted-foreground mb-4">{error}</p>
 <Button onClick={fetchData} variant="outline">
 <RefreshCw className="w-4 h-4 ml-2" />
 إعادة المحاولة
 </Button>
 </CardContent>
 </Card>
 );
 }

 if (!data) return null;

 // FRONTEND-CLEANUP-A-2: type-safe accessors (fix TS2339/TS18046/TS18049).
 const price: Record<string, unknown> = data.price || {};
 const basic: Record<string, unknown> = data.basic || {};
 const rawTech: Record<string, unknown> = data.technical || {};
 const currentPriceNum = numOr(price.current_price ?? price.close, 0);
 const tech: Record<string, any> = { ...rawTech };

 // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
 // Override technical fields with canonical values from unified API when available.
 // unified.technical is read directly from stocks.db (pre-computed RSI/MA),
 // so it is the single source of truth for these indicators.
 if (unifiedData?.technical) {
 if (unifiedData.technical.rsi != null) tech.rsi = Number(unifiedData.technical.rsi);
 if (unifiedData.technical.ma_50 != null) tech.ma_50 = Number(unifiedData.technical.ma_50);
 if (unifiedData.technical.ma_200 != null) tech.ma_200 = Number(unifiedData.technical.ma_200);
 if (unifiedData.technical.support != null) tech.support = Number(unifiedData.technical.support);
 if (unifiedData.technical.resistance != null) tech.resistance = Number(unifiedData.technical.resistance);
 }

 // Financial Sanity Gate: Ensure support < price < resistance under all circumstances
 if (currentPriceNum > 0) {
 let sup = Number(tech.support || 0);
 let res = Number(tech.resistance || 0);
 // Rule 67 — never fabricate 52w values. null if missing; formatPrice shows "—".
 let h52: number | null = tech.high_52w != null ? Number(tech.high_52w) : null;
 let l52: number | null = tech.low_52w != null ? Number(tech.low_52w) : null;

 if (sup <= 0 || sup >= currentPriceNum) {
 sup = Number((currentPriceNum * 0.95).toFixed(2));
 }
 if (res <= currentPriceNum) {
 res = Number((currentPriceNum * 1.05).toFixed(2));
 }
 if (sup >= res) {
 sup = Number((currentPriceNum * 0.95).toFixed(2));
 res = Number((currentPriceNum * 1.05).toFixed(2));
 }

 // Real 52-week High/Low: Single source of truth from market database.
 // Rule 67 — null when missing is honest. cp * 1.15 was a fabricated lie.
 if (h52 != null && !isNaN(h52) && h52 > 0) {
 h52 = Math.max(h52, currentPriceNum);
 } else {
 h52 = null;
 }
 if (l52 != null && !isNaN(l52) && l52 > 0) {
 l52 = Math.min(l52, currentPriceNum);
 } else {
 l52 = null;
 }

 tech.support = sup;
 tech.resistance = res;
 tech.high_52w = h52;
 tech.low_52w = l52;
 }

 const metrics: Record<string, unknown> = data.keyMetrics || {};
 const maestro: Record<string, unknown> = (data.maestro as Record<string, unknown> | undefined)?.maestroAnalysis as Record<string, unknown> || data.maestro || {};
 const change = numOr(price.change_percent, 0);
 const isPositive = change >= 0;

 return (
 <div className="space-y-4">
 {/* Header — Stock Identity + Price */}
 <StockHeaderBar
 ticker={data.ticker}
 name={strVal(basic.name_ar) || strVal(basic.name) || data.ticker}
 market={data.market}
 sector={strVal(basic.sector)}
 price={numOr(price.current_price, 0)}
 change={change}
 isPositive={isPositive}
 onRefresh={fetchData}
 elapsedMs={data.elapsed_ms}
 />

 {/* Error warnings (if any API failed) */}
 {data.errors.length > 0 && (
 <Card className="border-warning /50 bg-warning /20">
 <CardContent className="p-3">
 <div className="flex items-center gap-2 text-xs text-warning ">
 <AlertTriangle className="w-4 h-4 flex-shrink-0" />
 <span>بعض المحركات فشلت: {data.errors.join(' | ')}</span>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Quick Stats Row (3 cards — Maestro card removed per user request 2026-09-28) */}
 <QuickStatsRow price={price} tech={tech} metrics={metrics} />

 {/* Main Tabs */}
 <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
 <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto">
 <TabsTrigger value="overview" className="text-xs">نظرة عامة</TabsTrigger>
 <TabsTrigger value="expert" className="text-xs">⚡ تحليل خبير</TabsTrigger>
 <TabsTrigger value="technical" className="text-xs">فني</TabsTrigger>
 <TabsTrigger value="fundamental" className="text-xs">أساسي</TabsTrigger>
 <TabsTrigger value="chart" className="text-xs">رسوم</TabsTrigger>
 <TabsTrigger value="news" className="text-xs">أخبار</TabsTrigger>
 <TabsTrigger value="predictions" className="text-xs">توقعات</TabsTrigger>
 </TabsList>

 {/* Overview Tab */}
 <TabsContent value="overview" className="mt-4">
 <OverviewTab data={data} unifiedData={unifiedData} />
 </TabsContent>

 {/* Expert Analysis Tab (NEW — 2026-10-09) */}
 <TabsContent value="expert" className="mt-4">
 <ExpertAnalysisPanel ticker={ticker} />
 </TabsContent>

 {/* Technical Tab */}
 <TabsContent value="technical" className="mt-4">
 <TechnicalTab tech={tech} price={price} priceHistory={data.priceHistory || []} />
 </TabsContent>

 {/* Fundamental Tab */}
 <TabsContent value="fundamental" className="mt-4">
 <FundamentalTab metrics={metrics} basic={basic} />
 </TabsContent>

 {/* Charts Tab */}
 <TabsContent value="chart" className="mt-4">
 <ChartsTab priceHistory={data.priceHistory || []} tech={tech} />
 </TabsContent>

 {/* News Tab */}
 <TabsContent value="news" className="mt-4">
 <NewsTab news={data.news || []} />
 </TabsContent>

 {/* Predictions Tab */}
 <TabsContent value="predictions" className="mt-4">
 <PredictionsTab predictions={data.predictions || []} />
 </TabsContent>
 </Tabs>
 </div>
 );
}

// ============================================================================
// Header Bar
// ============================================================================

function StockHeaderBar({
 ticker, name, market, sector, price, change, isPositive, onRefresh, elapsedMs,
}: {
 ticker: string; name: string; market: string; sector: string;
 price: number; change: number; isPositive: boolean;
 onRefresh: () => void; elapsedMs: number;
}) {
 return (
 <Card className="overflow-hidden">
 <CardContent className="p-4 sm:p-6">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
 {/* Left: Identity */}
 <div className="flex items-center gap-4">
 <div className={cn(
 'w-14 h-14 rounded-xl flex items-center justify-center text-foreground font-bold text-xl',
 isPositive ? 'bg-gradient-to-br from-profit to-whale' : 'bg-gradient-to-br from-loss to-loss'
 )}>
 {ticker.slice(0, 2)}
 </div>
 <div>
 <div className="flex items-center gap-2 flex-wrap">
 <h2 className="text-xl font-bold">{ticker}</h2>
 <Badge variant="outline" className="text-xs">{market}</Badge>
 {sector && <Badge variant="secondary" className="text-xs">{sector}</Badge>}
 </div>
 <p className="text-sm text-muted-foreground mt-0.5">{name}</p>
 </div>
 </div>

 {/* Right: Price + Change */}
 <div className="flex items-center gap-4">
 <div className="text-right">
 <div className="text-2xl font-bold tabular-nums">
 {formatPrice(price)}
 </div>
 <div className={cn('text-sm font-semibold flex items-center gap-1 justify-end', changeColor(change))}>
 {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
 {formatPct(change)}
 </div>
 </div>
 <Button variant="ghost" size="icon" onClick={onRefresh} title="تحديث">
 <RefreshCw className="w-4 h-4" />
 </Button>
 </div>
 </div>

 {/* Meta */}
 <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
 <Clock className="w-3 h-3" />
 <span>آخر تحديث: {new Date().toLocaleTimeString('ar-EG')}</span>
 <Separator orientation="vertical" className="h-3" />
 <Zap className="w-3 h-3" />
 <span>زمن الاستجابة: {elapsedMs}ms</span>
 </div>
 </CardContent>
 </Card>
 );
}

// ============================================================================
// Quick Stats Row (3 cards — Maestro card removed per user request 2026-09-28)
// ============================================================================

function QuickStatsRow({ price, tech, metrics }: { price: Record<string, unknown> | null | undefined; tech: Record<string, unknown> | null | undefined; metrics: Record<string, unknown> | null | undefined }) {
 const p: Record<string, unknown> = price || {};
 const t: Record<string, unknown> = tech || {};
 const m: Record<string, unknown> = metrics || {};
 const rsiVal = numOr(t.rsi, 0);
 const peVal = numOr(m.pe_ratio, 0);
 const stats = [
 {
 label: 'السعر',
 value: formatPrice(numVal(p.current_price)),
 sub: `إغلاق سابق: ${formatPrice(numVal(p.previous_close))}`,
 icon: DollarSign,
 color: 'text-whale',
 },
 {
 label: 'RSI (14)',
 value: t.rsi ? rsiVal.toFixed(1) : '—',
 sub: rsiVal > 70 ? 'تشبع شرائي' : rsiVal < 30 ? 'تشبع بيعي' : 'محايد',
 icon: Activity,
 color: rsiVal > 70 ? 'text-loss' : rsiVal < 30 ? 'text-profit' : 'text-warning',
 },
 {
 label: 'P/E',
 value: m.pe_ratio ? peVal.toFixed(1) : '—',
 sub: peVal < 15 ? 'رخيص' : peVal > 30 ? 'غالي' : 'عادل',
 icon: BarChart3,
 color: 'text-primary',
 },
 ];

 return (
 <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
 {stats.map((s, i) => (
 <Card key={i} className="overflow-hidden">
 <CardContent className="p-3">
 <div className="flex items-center justify-between mb-1">
 <span className="text-xs text-muted-foreground">{s.label}</span>
 <s.icon className={cn('w-4 h-4', s.color)} />
 </div>
 <div className={cn('text-lg font-bold tabular-nums', s.color)}>{s.value}</div>
 <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
 </CardContent>
 </Card>
 ))}
 </div>
 );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab({ data, unifiedData }: { data: ComprehensiveData; unifiedData?: any }) {
 const board = data.board || {};
 const hunter = data.hunter || {};
 const price = data.price || {};
 const tech = data.technical || {};

 // ─── PHASE-0 (Task UNIFICATION-PHASE-0, Rule 72 + Rule 73) ───────────
 // ROOT CAUSE FIX: قبل كده كان في 7 شارات قرار من 7 محركات مختلفة معروضة جنب
 // بعض → العميل بيشوف 3-5 signals مختلفة على نفس السهم.
 //
 // الحل: عرض canonical signal فقط (من unified API) — لا board/maestro/professional/hunter signals.
 // لو unified API مش متاح → عرض "— بيانات غير متاحة" (سياسة الفراغ، مش fabrication).
 const canonicalSignalAr = unifiedData?.canonical?.signal_ar ?? null;
 const canonicalSignal = unifiedData?.canonical?.signal ?? null;
 const canonicalMasterScore = unifiedData?.canonical?.master_score ?? null;
 const canonicalAccumulation = unifiedData?.canonical?.accumulation ?? null;
 const canonicalMoneyFlow = unifiedData?.canonical?.money_flow ?? null;
 const canonicalPhase = unifiedData?.canonical?.phase ?? null;

 // Prediction (single source of truth for entry/target/stop)
 const prediction = unifiedData?.prediction ?? null;

 // سياسة الفراغ: لو canonical NULL → "— بيانات غير متاحة" (مش HOLD الكاذب)
 const displaySignal = canonicalSignalAr ?? '— بيانات غير متاحة';
 const displaySignalBadge = canonicalSignal
 ? signalBadge(canonicalSignal)
 : { label: '—', className: 'bg-muted text-muted-foreground' };

 return (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

 {/* ─── CANONICAL Signal (UNIFIED-DATA-CONTRACT, Rule 72 + Rule 73) ─── */}
 {/* العميل بيشوف قرار واحد فقط — من unified API (single display source). */}
 <Card className="md:col-span-2 border-profit/30 bg-profit/5">
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Award className="w-4 h-4 text-profit" />
 الإشارة الموحدة (Canonical)
 {unifiedData?.canonical?.master_score_source && (
 <Badge variant="outline" className="text-xs text-muted-foreground ml-2">
 {unifiedData.canonical.master_score_source === 'prediction_db_fresh'
 ? 'من قاعدة التوقعات'
 : 'محسوب فورياً'}
 </Badge>
 )}
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-2">
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 {/* Signal */}
 <div className="flex flex-col items-center justify-center">
 <span className="text-xs text-muted-foreground mb-1">الإشارة</span>
 <Badge className={cn('text-sm font-bold py-1 px-3', displaySignalBadge.className)}>
 {displaySignal}
 </Badge>
 </div>
 {/* Master Score */}
 <div className="flex flex-col items-center justify-center">
 <span className="text-xs text-muted-foreground mb-1">الدرجة الإجمالية</span>
 <span className="text-2xl font-bold tabular-nums">
 {canonicalMasterScore !== null ? Math.round(canonicalMasterScore) : '—'}
 </span>
 </div>
 {/* Accumulation */}
 {canonicalAccumulation && (
 <div className="flex flex-col items-center justify-center">
 <span className="text-xs text-muted-foreground mb-1">التجميع/التصريف</span>
 <Badge variant="outline" className="text-xs font-bold">
 {canonicalAccumulation}
 </Badge>
 </div>
 )}
 {/* Phase */}
 {canonicalPhase && (
 <div className="flex flex-col items-center justify-center">
 <span className="text-xs text-muted-foreground mb-1">المرحلة</span>
 <Badge variant="outline" className="text-xs font-bold">
 {canonicalPhase}
 </Badge>
 </div>
 )}
 </div>

 {/* Money Flow */}
 {canonicalMoneyFlow && (
 <div className="mt-3 pt-3 border-t flex items-center justify-between">
 <span className="text-xs text-muted-foreground">حالة السيولة</span>
 <span className="text-sm font-bold">{canonicalMoneyFlow}</span>
 </div>
 )}

 {/* Trade setup (entry/target/stop) — from prediction only, NO fabrication */}
 {prediction && (
 <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-4">
 {prediction.entry_price != null && (
 <div className="flex flex-col items-center">
 <span className="text-xs text-muted-foreground">سعر الدخول</span>
 <span className="font-bold tabular-nums">{formatPrice(prediction.entry_price)}</span>
 </div>
 )}
 {prediction.target_price != null && (
 <div className="flex flex-col items-center">
 <span className="text-xs text-muted-foreground">الهدف</span>
 <span className="font-bold tabular-nums text-profit">{formatPrice(prediction.target_price)}</span>
 </div>
 )}
 {prediction.stop_loss != null && (
 <div className="flex flex-col items-center">
 <span className="text-xs text-muted-foreground">وقف الخسارة</span>
 <span className="font-bold tabular-nums text-loss">{formatPrice(prediction.stop_loss)}</span>
 </div>
 )}
 </div>
 )}

 {/* Freshness indicator */}
 {unifiedData?.canonical?.prediction_is_fresh === false && prediction && (
 <div className="mt-3 pt-3 border-t flex items-center gap-2 text-xs text-warning">
 <AlertTriangle className="w-3 h-3" />
 <span>التوقع غير حديث (أقدم من 48 ساعة) — يُنصح بمراجعة التحليل</span>
 </div>
 )}
 </CardContent>
 </Card>

 {/* ─── HIDDEN sub-engine badges (Task UNIFICATION-PHASE-0) ─────── */}
 {/* قبل كده: كان فيه Cards لـ board/hunter بـ تعرض signals مختلفة.
 تم إخفاؤها لأنها بتسبب تناقضات للعميل (Rule 73: SINGLE-DISPLAY-SOURCE).
 الـ canonical signal أعلاه هو المصدر الوحيد للقرار المعروض. */}
 </div>
 );
}

// ============================================================================
// Technical Tab
// ============================================================================

function TechnicalTab({ tech, price, priceHistory }: { tech: Record<string, unknown> | null | undefined; price: Record<string, unknown> | null | undefined; priceHistory: Array<Record<string, unknown>> }) {
 const t: Record<string, unknown> = tech || {};
 const p: Record<string, unknown> = price || {};
 const rsi = numOr(t.rsi, 0);
 const rsiStatus = rsi > 70 ? 'تشبع شرائي ⚠️' : rsi < 30 ? 'تشبع بيعي ✅' : 'محايد';
 const rsiColor = rsi > 70 ? 'text-loss' : rsi < 30 ? 'text-profit' : 'text-warning';

 const ma50 = numOr(t.ma_50, 0);
 const ma200 = numOr(t.ma_200, 0);
 const current = numOr(p.current_price, 0);
 const trend = ma50 > ma200 ? 'صاعد' : ma50 < ma200 ? 'هابط' : 'عرضي';
 const trendColor = ma50 > ma200 ? 'text-profit' : ma50 < ma200 ? 'text-loss' : 'text-warning';

 return (
 <div className="space-y-4">
 {/* Indicators Grid */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {/* RSI */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Activity className="w-4 h-4" />
 RSI (14)
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-2">
 <div className="flex items-center justify-between mb-2">
 <span className="text-3xl font-bold tabular-nums">{(rsi ?? 0).toFixed(1)}</span>
 <span className={cn('text-sm font-semibold', rsiColor)}>{rsiStatus}</span>
 </div>
 <div className="relative h-3 bg-gradient-to-r from-profit via-warning to-loss rounded-full">
 <div
 className="absolute top-0 -mt-1 w-1 h-5 bg-foreground rounded"
 style={{ left: `${Math.min(100, Math.max(0, rsi))}%` }}
 />
 </div>
 <div className="flex justify-between text-xs text-muted-foreground mt-1">
 <span>0 (تشبع بيعي)</span>
 <span>30</span>
 <span>50</span>
 <span>70</span>
 <span>100 (تشبع شرائي)</span>
 </div>
 </CardContent>
 </Card>

 {/* Moving Averages */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <LineChartIcon className="w-4 h-4" />
 المتوسطات المتحركة
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-2 space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-sm">السعر الحالي</span>
 <span className="font-bold tabular-nums">{formatPrice(current)}</span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-sm">MA 50</span>
 <span className={cn('font-bold tabular-nums', current > ma50 ? 'text-profit' : 'text-loss')}>
 {formatPrice(ma50)} {current > ma50 ? '▲' : '▼'}
 </span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-sm">MA 200</span>
 <span className={cn('font-bold tabular-nums', current > ma200 ? 'text-profit' : 'text-loss')}>
 {formatPrice(ma200)} {current > ma200 ? '▲' : '▼'}
 </span>
 </div>
 <Separator className="my-2" />
 <div className="flex items-center justify-between">
 <span className="text-sm font-semibold">الاتجاه</span>
 <span className={cn('font-bold', trendColor)}>{trend}</span>
 </div>
 </CardContent>
 </Card>

 {/* Support / Resistance */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Shield className="w-4 h-4" />
 الدعم والمقاومة
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-2 space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-sm text-loss">المقاومة</span>
 <span className="font-bold tabular-nums text-loss">{formatPrice(numVal(t.resistance))}</span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-sm">السعر الحالي</span>
 <span className="font-bold tabular-nums">{formatPrice(current)}</span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-sm text-profit">الدعم</span>
 <span className="font-bold tabular-nums text-profit">{formatPrice(numVal(t.support))}</span>
 </div>
 <Separator className="my-2" />
 {t.resistance && t.support && current > 0 && (
 <div className="text-xs text-muted-foreground">
 المدى: {formatPct(((numOr(t.resistance, 0) - numOr(t.support, 0)) / numOr(t.support, 1)) * 100)} من الدعم للمقاومة
 </div>
 )}
 </CardContent>
 </Card>

 {/* 52-Week Range */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Gauge className="w-4 h-4" />
 مدى 52 أسبوع
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-2 space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-sm">أعلى 52 أسبوع</span>
 <span className="font-bold tabular-nums text-profit">{formatPrice(numVal(t.high_52w))}</span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-sm">أدنى 52 أسبوع</span>
 <span className="font-bold tabular-nums text-loss">{formatPrice(numVal(t.low_52w))}</span>
 </div>
 {t.high_52w && t.low_52w && current > 0 && (
 <>
 <div className="relative h-2 bg-gradient-to-r from-loss via-warning to-profit rounded-full mt-2">
 <div
 className="absolute top-0 -mt-1 w-1 h-4 bg-foreground rounded"
 style={{
 left: `${Math.min(100, Math.max(0, ((current - numOr(t.low_52w, 0)) / (numOr(t.high_52w, 1) - numOr(t.low_52w, 0))) * 100))}%`,
 }}
 />
 </div>
 <div className="text-xs text-muted-foreground mt-1">
 السعر عند {formatPct(((current - numOr(t.low_52w, 0)) / (numOr(t.high_52w, 1) - numOr(t.low_52w, 0))) * 100, 0)} من المدى
 </div>
 </>
 )}
 </CardContent>
 </Card>
 </div>

 {/* Price + MA Chart */}
 {priceHistory && priceHistory.length > 0 && (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm">السعر مع المتوسطات (آخر 90 يوم)</CardTitle>
 </CardHeader>
 <CardContent>
 <PriceWithMAChart history={priceHistory} ma50={ma50} ma200={ma200} support={numOr(t.support, 0)} resistance={numOr(t.resistance, 0)} />
 </CardContent>
 </Card>
 )}
 </div>
 );
}

// ============================================================================
// Fundamental Tab
// ============================================================================

function FundamentalTab({ metrics, basic }: { metrics: Record<string, unknown> | null | undefined; basic: Record<string, unknown> | null | undefined }) {
 const m: Record<string, unknown> = metrics || {};
 const b: Record<string, unknown> = basic || {};
 const items = [
 { label: 'القيمة السوقية', value: formatMarketCap(numVal(m.market_cap)), icon: DollarSign },
 { label: 'P/E (السعر/الربح)', value: m.pe_ratio ? numOr(m.pe_ratio, 0).toFixed(1) : '—', icon: BarChart3 },
 { label: 'P/B (السعر/القيمة الدفترية)', value: m.pb_ratio ? numOr(m.pb_ratio, 0).toFixed(2) : '—', icon: BarChart3 },
 { label: 'P/S (السعر/المبيعات)', value: m.ps_ratio ? numOr(m.ps_ratio, 0).toFixed(2) : '—', icon: BarChart3 },
 { label: 'EPS (ربحية السهم)', value: m.eps ? numOr(m.eps, 0).toFixed(2) : '—', icon: DollarSign },
 { label: 'ROE (العائد على حقوق الملكية)', value: m.roe ? `${numOr(m.roe, 0).toFixed(1)}%` : '—', icon: TrendingUp },
 { label: 'ROA (العائد على الأصول)', value: m.roa ? `${numOr(m.roa, 0).toFixed(1)}%` : '—', icon: TrendingUp },
 { label: 'هامش الربح', value: m.profit_margin ? `${numOr(m.profit_margin, 0).toFixed(1)}%` : '—', icon: PieChart },
 { label: 'توزيعات الأرباح', value: m.dividend_yield ? `${numOr(m.dividend_yield, 0).toFixed(2)}%` : '—', icon: DollarSign },
 { label: 'دين/حقوق ملكية', value: m.debt_to_equity ? numOr(m.debt_to_equity, 0).toFixed(2) : '—', icon: Shield },
 { label: 'السيولة (Current Ratio)', value: m.current_ratio ? numOr(m.current_ratio, 0).toFixed(2) : '—', icon: Activity },
 { label: 'القيمة الدفترية/السهم', value: m.book_value_per_share ? numOr(m.book_value_per_share, 0).toFixed(2) : '—', icon: DollarSign },
 { label: 'Beta', value: m.beta ? numOr(m.beta, 0).toFixed(2) : '—', icon: Activity },
 ];

 return (
 <div className="space-y-4">
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <BarChart3 className="w-4 h-4" />
 المؤشرات المالية
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
 {items.map((item, i) => (
 <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
 <item.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
 <div className="min-w-0 flex-1">
 <div className="text-xs text-muted-foreground truncate">{item.label}</div>
 <div className="text-sm font-bold tabular-nums">{item.value}</div>
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Valuation Assessment */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm">تقييم التقييم</CardTitle>
 </CardHeader>
 <CardContent className="space-y-2">
 {m.pe_ratio && (
 <ValuationRow
 label="P/E"
 value={numOr(m.pe_ratio, 0)}
 low={15}
 high={30}
 lowLabel="رخيص"
 highLabel="غالي"
 />
 )}
 {m.pb_ratio && (
 <ValuationRow
 label="P/B"
 value={numOr(m.pb_ratio, 0)}
 low={1.5}
 high={3}
 lowLabel="رخيص"
 highLabel="غالي"
 />
 )}
 {m.roe && (
 <ValuationRow
 label="ROE"
 value={numOr(m.roe, 0)}
 low={15}
 high={25}
 lowLabel="ضعيف"
 highLabel="ممتاز"
 reverse
 />
 )}
 {m.debt_to_equity && (
 <ValuationRow
 label="دين/حقوق ملكية"
 value={numOr(m.debt_to_equity, 0)}
 low={1}
 high={2}
 lowLabel="آمن"
 highLabel="مخاطر"
 reverse
 />
 )}
 </CardContent>
 </Card>
 </div>
 );
}

function ValuationRow({ label, value, low, high, lowLabel, highLabel, reverse }: {
 label: string; value: number; low: number; high: number;
 lowLabel: string; highLabel: string; reverse?: boolean;
}) {
 const isGood = reverse ? value >= low : value <= low;
 const isBad = reverse ? value >= high : value >= high;
 const color = isGood ? 'text-profit' : isBad ? 'text-loss' : 'text-warning';
 const status = isGood ? lowLabel : isBad ? highLabel : 'عادل';

 return (
 <div className="flex items-center justify-between">
 <span className="text-sm">{label}</span>
 <div className="flex items-center gap-2">
 <span className={cn('font-bold tabular-nums', color)}>{(value ?? 0).toFixed(1)}</span>
 <Badge variant="outline" className={cn('text-xs', color)}>{status}</Badge>
 </div>
 </div>
 );
}

// ============================================================================
// Maestro Tab
// ============================================================================

function MaestroTab({ maestro, hunter, board }: { maestro: Record<string, unknown> | null | undefined; hunter: Record<string, unknown> | null | undefined; board: Record<string, unknown> | null | undefined }) {
 const m = maestro?.maestroAnalysis || maestro || {};

 return (
 <div className="space-y-4">
 {/* Maestro Score + Recommendation */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Brain className="w-4 h-4" />
 تحليل المايسترو
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-2">
 {(m.maestroScore != null ? Number(m.maestroScore) : 0) !== undefined ? (
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 {/* Score Gauge */}
 <div className="flex flex-col items-center justify-center">
 <ScoreGauge score={(m.maestroScore != null ? Number(m.maestroScore) : 0)} label="الدرجة" size={120} />
 <Badge className={cn('mt-2', signalBadge(strVal(m.recommendation)).className)}>
 {strVal(m.recommendationAr) || signalBadge(strVal(m.recommendation)).label}
 </Badge>
 </div>

 {/* Details */}
 <div className="md:col-span-2 space-y-2">
 {m.confidence !== undefined && (
 <div className="flex items-center justify-between">
 <span className="text-sm">الثقة</span>
 <div className="flex items-center gap-2">
 <Progress value={numOr(m.confidence, 0)} className="w-24 h-2" />
 <span className="font-bold text-sm">{Math.round(m.confidence)}%</span>
 </div>
 </div>
 )}
 {m.entry?.price && (
 <div className="flex items-center justify-between">
 <span className="text-sm">سعر الدخول</span>
 <span className="font-bold tabular-nums">{formatPrice(m.entry.price)}</span>
 </div>
 )}
 {m.target && (
 <div className="flex items-center justify-between">
 <span className="text-sm">الهدف</span>
 <span className="font-bold tabular-nums text-profit">{formatPrice(m.target)}</span>
 </div>
 )}
 {m.stopLoss && (
 <div className="flex items-center justify-between">
 <span className="text-sm">وقف الخسارة</span>
 <span className="font-bold tabular-nums text-loss">{formatPrice(m.stopLoss)}</span>
 </div>
 )}
 {m.riskReward && (
 <div className="flex items-center justify-between">
 <span className="text-sm">R/R</span>
 <span className={cn('font-bold', m.riskReward >= 1.5 ? 'text-profit' : m.riskReward >= 1 ? 'text-warning' : 'text-loss')}>
 {Number(m.riskReward).toFixed(2)}:1
 </span>
 </div>
 )}
 {m.entry?.strategyAr && (
 <div className="pt-2 border-t">
 <span className="text-xs text-muted-foreground">استراتيجية الدخول:</span>
 <p className="text-sm mt-1">{m.entry.strategyAr}</p>
 </div>
 )}
 </div>
 </div>
 ) : (
 <p className="text-sm text-muted-foreground py-4">المايسترو غير متاح لهذا السهم</p>
 )}

 {/* Warnings */}
 {m.warningsAr && m.warningsAr.length > 0 && (
 <div className="mt-4 pt-4 border-t">
 <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
 <AlertTriangle className="w-3 h-3" />
 تنبيهات
 </h4>
 <ul className="space-y-1">
 {m.warningsAr.map((w: string, i: number) => (
 <li key={i} className="text-xs text-muted-foreground">• {w}</li>
 ))}
 </ul>
 </div>
 )}
 </CardContent>
 </Card>

 {/* Phases */}
 {m.phases && (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm">مراحل التحليل (Phases)</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 {m.phases.regime && (
 <PhaseCard title="النظام" phase={m.phases.regime} />
 )}
 {m.phases.timeframe && (
 <PhaseCard title="الإطار الزمني" phase={m.phases.timeframe} />
 )}
 {m.phases.volume && (
 <PhaseCard title="السيولة" phase={m.phases.volume} />
 )}
 {m.phases.news && (
 <PhaseCard title="الأخبار" phase={m.phases.news} />
 )}
 </div>
 </CardContent>
 </Card>
 )}

 {/* Board Opinions */}
 {board?.available && board.opinions && (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Award className="w-4 h-4" />
 آراء المحللين
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-2">
 {Object.entries(board.opinions).map(([analyst, opinion]: [string, any]) => (
 <div key={analyst} className="flex items-start justify-between p-2 rounded-lg bg-muted/30">
 <div>
 <span className="text-xs font-semibold">{analyst}</span>
 {opinion.reason && (
 <p className="text-xs text-muted-foreground mt-0.5">{opinion.reason}</p>
 )}
 </div>
 <Badge variant="outline" className="text-xs">
 {opinion.signal || opinion.recommendation || '—'}
 </Badge>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 )}
 </div>
 );
}

function PhaseCard({ title, phase }: { title: string; phase: Record<string, unknown> | null | undefined }) {
 const score = phase?.score || 0;
 return (
 <div className="p-3 rounded-lg bg-muted/30">
 <div className="text-xs text-muted-foreground mb-1">{title}</div>
 <div className={cn('text-lg font-bold', scoreColor(score))}>{Math.round(score)}</div>
 {phase?.phase && (
 <div className="text-xs text-muted-foreground mt-0.5">{phase.phase}</div>
 )}
 </div>
 );
}

// ============================================================================
// Charts Tab
// ============================================================================

function ChartsTab({ priceHistory, tech }: { priceHistory: Array<Record<string, unknown>>; tech: Record<string, unknown> | null | undefined }) {
 if (!priceHistory || priceHistory.length === 0) {
 return (
 <Card>
 <CardContent className="p-8 text-center text-muted-foreground">
 لا توجد بيانات تاريخية متاحة للرسم
 </CardContent>
 </Card>
 );
 }

 return (
 <div className="space-y-4">
 {/* Price Chart with S/R */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm">السعر مع الدعم والمقاومة</CardTitle>
 </CardHeader>
 <CardContent>
 <PriceWithMAChart
 history={priceHistory}
 ma50={tech.ma_50}
 ma200={tech.ma_200}
 support={tech.support}
 resistance={tech.resistance}
 />
 </CardContent>
 </Card>

 {/* Volume Chart */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm">أحجام التداول</CardTitle>
 </CardHeader>
 <CardContent>
 <VolumeChart history={priceHistory} />
 </CardContent>
 </Card>
 </div>
 );
}

function PriceWithMAChart({ history, ma50, ma200, support, resistance }: {
 history: Array<Record<string, unknown>>; ma50: number; ma200: number; support: number; resistance: number;
}) {
 const data = history.map((h) => ({
 date: shortDate(h.date || h.price_date || ''),
 close: Number(h.close || h.close_price || 0),
 volume: Number(h.volume || 0),
 }));

 return (
 <ResponsiveContainer width="100%" height={300}>
 <ComposedChart data={data}>
 <defs>
 <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
 <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
 <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
 <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
 <Tooltip
 contentStyle={{ fontSize: 12, borderRadius: 8 }}
 labelStyle={{ fontSize: 10 }}
 />
 <Area
 type="monotone"
 dataKey="close"
 stroke="#3b82f6"
 strokeWidth={2}
 fill="url(#priceGradient)"
 name="السعر"
 />
 {ma50 > 0 && (
 <Line
 type="monotone"
 dataKey={() => ma50}
 stroke="#f59e0b"
 strokeWidth={1}
 strokeDasharray="5 5"
 name="MA50"
 dot={false}
 />
 )}
 {ma200 > 0 && (
 <Line
 type="monotone"
 dataKey={() => ma200}
 stroke="#ef4444"
 strokeWidth={1}
 strokeDasharray="5 5"
 name="MA200"
 dot={false}
 />
 )}
 {support > 0 && (
 <ReferenceLine y={support} stroke="#10b981" strokeDasharray="3 3" label={{ value: `دعم: ${(support ?? 0).toFixed(2)}`, fontSize: 10, fill: '#10b981' }} />
 )}
 {resistance > 0 && (
 <ReferenceLine y={resistance} stroke="#ef4444" strokeDasharray="3 3" label={{ value: `مقاومة: ${(resistance ?? 0).toFixed(2)}`, fontSize: 10, fill: '#ef4444' }} />
 )}
 </ComposedChart>
 </ResponsiveContainer>
 );
}

function VolumeChart({ history }: { history: Array<Record<string, unknown>> }) {
 const data = history.map((h) => ({
 date: shortDate(h.date || h.price_date || ''),
 volume: Number(h.volume || 0),
 }));

 return (
 <ResponsiveContainer width="100%" height={150}>
 <BarChart data={data}>
 <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
 <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
 <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatVolume(v)} />
 <Tooltip
 contentStyle={{ fontSize: 12, borderRadius: 8 }}
 formatter={(v: unknown) => [formatVolume(Number(v)), 'الحجم']}
 />
 <Bar dataKey="volume" fill="#6366f1" name="الحجم" />
 </BarChart>
 </ResponsiveContainer>
 );
}

// ============================================================================
// News Tab
// ============================================================================

function NewsTab({ news }: { news: Array<Record<string, unknown>> }) {
 if (!news || news.length === 0) {
 return (
 <Card>
 <CardContent className="p-8 text-center text-muted-foreground">
 لا توجد أخبار متاحة لهذا السهم
 </CardContent>
 </Card>
 );
 }

 return (
 <div className="space-y-3">
 {news.map((item, i) => (
 <Card key={i}>
 <CardContent className="p-3">
 <div className="flex items-start gap-3">
 <Newspaper className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
 <div className="flex-1 min-w-0">
 <h4 className="text-sm font-semibold mb-1">{item.title || item.title_ar || 'بدون عنوان'}</h4>
 {item.summary && (
 <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>
 )}
 <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
 {item.source && <Badge variant="outline" className="text-xs">{item.source}</Badge>}
 {item.timestamp && <span>{shortDate(item.timestamp)}</span>}
 {item.sentiment && (
 <Badge variant="outline" className={cn(
 'text-xs',
 item.sentiment === 'positive' ? 'text-profit' :
 item.sentiment === 'negative' ? 'text-loss' : ''
 )}>
 {item.sentiment === 'positive' ? 'إيجابي' : item.sentiment === 'negative' ? 'سلبي' : 'محايد'}
 </Badge>
 )}
 </div>
 </div>
 </div>
 </CardContent>
 </Card>
 ))}
 </div>
 );
}

// ============================================================================
// Predictions Tab
// ============================================================================

function PredictionsTab({ predictions }: { predictions: Array<Record<string, unknown>> }) {
 if (!predictions || predictions.length === 0) {
 return (
 <Card>
 <CardContent className="p-8 text-center text-muted-foreground">
 لا توجد توقعات سابقة لهذا السهم
 </CardContent>
 </Card>
 );
 }

 return (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Target className="w-4 h-4" />
 التوقعات السابقة ({predictions.length})
 </CardTitle>
 </CardHeader>
 <CardContent>
 <ScrollArea className="max-h-96">
 <div className="space-y-2">
 {predictions.map((pred, i) => {
 const outcome = pred.outcome || pred.status || 'PENDING';
 const return_ = pred.actual_return || pred.profit_loss_percent;
 return (
 <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
 <div className="flex items-center gap-3">
 <Badge className={signalBadge(pred.signal || pred.signal_type || '').className}>
 {pred.signal || pred.signal_type || '—'}
 </Badge>
 <div>
 <div className="text-xs font-semibold">
 {shortDate(pred.prediction_date || pred.created_at || '')}
 </div>
 {pred.entry_price && (
 <div className="text-xs text-muted-foreground">
 دخول: {formatPrice(pred.entry_price)}
 {pred.target_price && ` → هدف: ${formatPrice(pred.target_price)}`}
 </div>
 )}
 </div>
 </div>
 <div className="text-left">
 <Badge variant="outline" className={cn(
 'text-xs',
 outcome === 'TARGET_HIT' ? 'text-profit' :
 outcome === 'STOPPED' ? 'text-loss' :
 outcome === 'EXPIRED' ? 'text-warning' : ''
 )}>
 {outcome === 'TARGET_HIT' ? '🎯 تحقق' :
 outcome === 'STOPPED' ? '🛑 وقف' :
 outcome === 'EXPIRED' ? '⚠️ انتهى' : '⏳ معلق'}
 </Badge>
 {return_ !== null && return_ !== undefined && (
 <div className={cn('text-xs font-bold mt-1', changeColor(Number(return_)))}>
 {formatPct(Number(return_))}
 </div>
 )}
 </div>
 </div>
 );
 })}
 </div>
 </ScrollArea>
 </CardContent>
 </Card>
 );
}

// ============================================================================
// AI Tab
// ============================================================================

function AITab({ professional, ticker }: { professional: Record<string, unknown> | null | undefined; ticker: string }) {
 if (!professional) {
 return (
 <Card>
 <CardContent className="p-8 text-center text-muted-foreground">
 التحليل الاحترافي بالـ AI غير متاح لهذا السهم
 </CardContent>
 </Card>
 );
 }

 return (
 <div className="space-y-4">
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Brain className="w-4 h-4" />
 التحليل الاحترافي بالـ AI
 </CardTitle>
 </CardHeader>
 <CardContent>
 {typeof professional === 'string' ? (
 <p className="text-sm whitespace-pre-wrap">{professional}</p>
 ) : (
 <div className="space-y-3">
 {professional.recommendation && (
 <div className="flex items-center gap-2">
 <span className="text-xs text-muted-foreground">التوقع:</span>
 <Badge className={signalBadge(professional.recommendation).className}>
 {professional.recommendation_ar || professional.recommendation}
 </Badge>
 </div>
 )}
 {professional.analysis && (
 <div>
 <span className="text-xs text-muted-foreground">التحليل:</span>
 <p className="text-sm mt-1 whitespace-pre-wrap">{professional.analysis}</p>
 </div>
 )}
 {professional.summary && (
 <div>
 <span className="text-xs text-muted-foreground">الملخص:</span>
 <p className="text-sm mt-1">{professional.summary}</p>
 </div>
 )}
 {professional.target_price && (
 <div className="flex items-center gap-2">
 <span className="text-xs text-muted-foreground">الهدف:</span>
 <span className="font-bold">{formatPrice(professional.target_price)}</span>
 </div>
 )}
 {professional.risks && (
 <div>
 <span className="text-xs text-muted-foreground">المخاطر:</span>
 <p className="text-sm mt-1 text-loss">{professional.risks}</p>
 </div>
 )}
 </div>
 )}
 </CardContent>
 </Card>
 </div>
 );
}

// ============================================================================
// Loading Skeleton
// ============================================================================

function LoadingSkeleton() {
 return (
 <div className="space-y-4">
 <Skeleton className="h-24 w-full rounded-xl" />
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 {[1, 2, 3, 4].map((i) => (
 <Skeleton key={i} className="h-20 rounded-xl" />
 ))}
 </div>
 <Skeleton className="h-10 w-full rounded-lg" />
 <Skeleton className="h-64 w-full rounded-xl" />
 <Skeleton className="h-64 w-full rounded-xl" />
 </div>
 );
}

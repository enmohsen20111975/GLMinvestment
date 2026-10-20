'use client';

/**
 * ShariaView — شاشة التوافق الشرعي المستقلة (Deliverable 1, Task 23-C)
 * ========================================================================
 * شاشة احترافية بطراز مالي إسلامي تعرض:
 * 1. قائمة بأسهم البورصة المصرية مع حالة التوافق الشرعي (253 سهماً)
 * 2. فلاتر (متوافق فقط / إجماع / بحث بالرمز أو الاسم)
 * 3. تفصيل لكل سهم: شارة التوافق + نسبة التطهير + تفصيل المصادر الثمانية
 * 4. حاسبة تطهير الأرباح لصفقة مفردة (POST /api/sharia/purification)
 * 5. حاسبة تطهير المحفظة بالكامل (user_id)
 *
 * المصدر: GET /api/sharia و POST /api/sharia/purification
 * (تم إنشاؤهما بواسطة prod assistant — لا تعديل على الـ API)
 *
 * Reference:
 * - Constitution Rule 4 (NO-NEW-SCREENS): استثناء صريح من المالك لهذه الشاشة.
 * - Constitution Rule 30 (CLIENT-FACING-STYLE): عربي فصيح رسمي.
 * - Constitution Rule 29 (NO-HYPE): لغة محايدة إخبارية.
 * - Constitution Rule 62 (GIT-PUSH-DISCIPLINE).
 *
 * Color system:
 * - emerald (لون التمويل الإسلامي) كلون رئيسي
 * - ذهبي (gold #d4af37) كلون مميِّز للأطر والزخارف
 * - بدون أزرق/بنفسجي (rule: colors should reflect Islamic finance aesthetic)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
 ShieldCheck,
 ShieldX,
 ShieldAlert,
 Search,
 Filter,
 Calculator,
 Coins,
 BookOpen,
 Sparkles,
 RefreshCw,
 TrendingUp,
 TrendingDown,
 Info,
 AlertTriangle,
 Loader2,
 Users,
 Building2,
 Scale,
 Award,
 ExternalLink,
} from 'lucide-react';
import {
 Card,
 CardContent,
 CardDescription,
 CardHeader,
 CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
 Tabs,
 TabsContent,
 TabsList,
 TabsTrigger,
} from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from '@/components/ui/table';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { UnifiedPagination } from '@/components/shared/ui';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/* Islamic visual vocabulary (consistent with ZakatView/TithesView) */
/* ------------------------------------------------------------------ */

function IslamicPattern() {
 return (
 <svg
 className="absolute inset-0 w-full h-full opacity-[0.06] pointer-events-none"
 xmlns="http://www.w3.org/2000/svg"
 aria-hidden
 >
 <defs>
 <pattern
 id="shariaIslamicPattern"
 x="0"
 y="0"
 width="60"
 height="60"
 patternUnits="userSpaceOnUse"
 >
 <path
 d="M30 0 L60 30 L30 60 L0 30 Z"
 fill="none"
 stroke="currentColor"
 strokeWidth="0.5"
 />
 <circle cx="30" cy="30" r="10" fill="none" stroke="currentColor" strokeWidth="0.5" />
 <path d="M30 20 L30 40 M20 30 L40 30" stroke="currentColor" strokeWidth="0.3" />
 </pattern>
 </defs>
 <rect width="100%" height="100%" fill="url(#shariaIslamicPattern)" />
 </svg>
 );
}

function OrnamentDivider() {
 return (
 <div className="flex items-center justify-center gap-2 py-1" aria-hidden>
 <div className="flex-1 h-px from-transparent to-transparent" />
 <Sparkles className="w-3.5 h-3.5 text-warning/70" />
 <div className="flex-1 h-px from-transparent to-transparent" />
 </div>
 );
}

function GoldBorder() {
 return (
 <div
 className="h-0.5 w-full rounded-full"
 style={{
 background:
 'linear-gradient(90deg, rgba(212,175,55,0) 0%, rgba(212,175,55,0.7) 50%, rgba(212,175,55,0) 100%)',
 }}
 aria-hidden
 />
 );
}

/* ------------------------------------------------------------------ */
/* Types — mirrors /api/sharia response contract */
/* ------------------------------------------------------------------ */

type ShariaStatus = 'compliant' | 'non_compliant' | 'doubtful' | 'not_available';

interface ShariaRow {
 symbol: string;
 name_ar?: string | null;
 category_ar?: string | null;
 category?: string | null;
 market?: string | null;
 sp_haram_earning_pct?: number | null;
 haram_earnings_pct?: number | null;
 loans_pct?: number | null;
 zakat_per_share?: number | null;
 dividend?: number | null;
 dividend_yield?: number | null;
 core_activity_ok?: number | null;
 cash_liquidity_ok?: number | null;
 haram_investments_ok?: number | null;
 compliant_sources_count?: number | null;
 active_sources_count?: number | null;
 is_halal_consensus?: number | null;
 source_updated_max?: string | null;
 synced_at?: string | null;
 purification_rate?: number | null;
 compliant_sources?: string | null;
}

interface ShariaSourceRow {
 source_key: string;
 source_name_ar: string;
 status: ShariaStatus | null;
 percentage?: number | null;
 note?: string | null;
 sector?: string | null;
 grade?: string | null;
 statement_date?: string | null;
 source_updated?: string | null;
 methodology?: string | null;
 is_active?: number | null;
}

interface ShariaDetailResponse {
 success: boolean;
 symbol: string;
 metric: Record<string, unknown>;
 sources: ShariaSourceRow[];
 purification_rates: Array<{
 method_key: string;
 method_name_ar: string;
 rate_pct: number | null;
 basis: string | null;
 is_primary: number;
 source_updated: string | null;
 }>;
 price?: {
 ticker?: string;
 name?: string;
 current_price?: number;
 dividend_yield?: number;
 sector?: string;
 } | null;
 generated_at: string;
}

interface ShariaListResponse {
 success: boolean;
 primary_method: string;
 consensus_min: number;
 filters: Record<string, unknown>;
 stats: {
 total: number;
 consensus_count: number;
 with_sp_rate: number;
 latest_source_update: string | null;
 };
 sources: Array<{ source_key: string; name_ar: string; methodology: string; is_active: number }>;
 total: number;
 count: number;
 offset: number;
 limit: number;
 rows: ShariaRow[];
 generated_at: string;
}

interface PurificationResponse {
 success: boolean;
 primary_method?: string;
 engine?: string;
 error?: string;
 detail?: string;
 // Single-trade calculator payload
 symbol?: string;
 quantity?: number;
 buy_price?: number;
 sell_price?: number;
 method?: string;
 purification_rate_pct?: number;
 dividends?: number;
 realized_capital_gain?: number;
 purification_amount?: number;
 // Portfolio calculator payload (different shape — let it pass through)
 [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Status helpers */
/* ------------------------------------------------------------------ */

const STATUS_LABELS_AR: Record<ShariaStatus, string> = {
 compliant: 'متوافق',
 non_compliant: 'غير متوافق',
 doubtful: 'مشمول', // مشمول بالقائمة لكن مش صريح
 not_available: 'غير متاح',
};

const STATUS_EMOJI: Record<ShariaStatus, string> = {
 compliant: '🟢',
 non_compliant: '🔴',
 doubtful: '🟡',
 not_available: '⚪',
};

const STATUS_BADGE_CLASS: Record<ShariaStatus, string> = {
 compliant:
 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 border-profit ',
 non_compliant:
 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 border-loss ',
 doubtful:
 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 border-warning ',
 not_available:
 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

function deriveOverallStatus(row: ShariaRow): ShariaStatus {
 const consensus = Number(row.is_halal_consensus ?? 0);
 if (consensus >= 1) return 'compliant';
 const compliantCount = Number(row.compliant_sources_count ?? 0);
 const activeCount = Number(row.active_sources_count ?? 0);
 if (activeCount > 0 && compliantCount === 0) return 'non_compliant';
 if (activeCount > 0 && compliantCount < 6) return 'doubtful';
 return 'not_available';
}

function formatPct(v: number | null | undefined, digits = 2): string {
 if (v == null || !Number.isFinite(v)) return '—';
 return `${v.toFixed(digits)}%`;
}

function safeNumber(v: unknown): number | null {
 const n = typeof v === 'string' ? parseFloat(v) : (v as number);
 return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* Stock card — per-stock Sharia status */
/* ------------------------------------------------------------------ */

interface StockCardProps {
 row: ShariaRow;
 onOpenDetail: (symbol: string) => void;
}

function ShariaStockRowCard({ row, onOpenDetail }: StockCardProps) {
 const status = deriveOverallStatus(row);
 const compliantCount = Number(row.compliant_sources_count ?? 0);
 const activeCount = Number(row.active_sources_count ?? 0);
 const purificationRate = row.purification_rate ?? row.sp_haram_earning_pct ?? null;

 return (
 <Card
 className="relative overflow-hidden border border-border hover:border-profit dark:hover:border-profit transition-colors cursor-pointer group"
 onClick={() => onOpenDetail(row.symbol)}
 >
 <IslamicPattern />
 <CardContent className="relative p-3 sm:p-4">
 <div className="flex items-start justify-between gap-3">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="font-bold text-profit text-base">
 {row.symbol}
 </span>
 <span className={cn('text-xs px-1.5 py-0.5 rounded-full border', STATUS_BADGE_CLASS[status])}>
 {STATUS_EMOJI[status]} {STATUS_LABELS_AR[status]}
 </span>
 {row.is_halal_consensus === 1 && (
 <span className="text-xs px-1.5 py-0.5 rounded-full border border-warning bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 ">
 <Award className="w-2.5 h-2.5 inline ml-0.5" />
 إجماع
 </span>
 )}
 </div>
 <p className="text-xs text-muted-foreground truncate mt-1">
 {row.name_ar || '—'}
 </p>
 {row.category_ar && (
 <p className="text-xs text-muted-foreground/70 mt-0.5">
 {row.category_ar}
 </p>
 )}
 </div>

 <div className="text-left flex-shrink-0 space-y-1">
 <div className="text-xs text-muted-foreground">نسبة التطهير (S&P)</div>
 <div className="text-sm font-bold tabular-nums text-warning " dir="ltr">
 {formatPct(purificationRate)}
 </div>
 <div className="text-xs text-muted-foreground">
 {compliantCount}/{activeCount || 8} مصدر
 </div>
 </div>
 </div>
 </CardContent>
 </Card>
 );
}

/* ------------------------------------------------------------------ */
/* Stock detail dialog */
/* ------------------------------------------------------------------ */

interface StockDetailModalProps {
 symbol: string | null;
 onClose: () => void;
}

function ShariaStockDetailModal({ symbol, onClose }: StockDetailModalProps) {
 const [data, setData] = useState<ShariaDetailResponse | null>(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
 if (!symbol) {
 setData(null);
 setError(null);
 return;
 }
 let cancelled = false;
 setLoading(true);
 setError(null);
 fetch(`/api/sharia?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
 .then((r) => {
 if (!r.ok) throw new Error(`HTTP ${r.status}`);
 return r.json();
 })
 .then((json: ShariaDetailResponse) => {
 if (cancelled) return;
 if (!json.success) throw new Error('لم يتم العثور على السهم');
 setData(json);
 })
 .catch((e) => {
 if (cancelled) return;
 setError(String(e?.message || e));
 })
 .finally(() => !cancelled && setLoading(false));
 return () => {
 cancelled = true;
 };
 }, [symbol]);

 if (!symbol) return null;

 return (
 <div
 className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
 role="dialog"
 aria-modal="true"
 aria-label="تفاصيل التوافق الشرعي"
 onClick={onClose}
 >
 <div
 className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-card rounded-2xl border border-profit shadow-2xl"
 onClick={(e) => e.stopPropagation()}
 >
 {/* Header */}
 <div className="relative from-profit via-profit to-profit text-profit p-4">
 <IslamicPattern />
 <div className="relative flex items-start justify-between gap-3">
 <div>
 <div className="flex items-center gap-2">
 <ShieldCheck className="w-5 h-5" />
 <h3 className="text-lg font-bold">التوافق الشرعي — {symbol}</h3>
 </div>
 <p className="text-xs text-profit/80 mt-1">
 التفصيل حسب المصادر الثمانية + نسب التطهير
 </p>
 </div>
 <Button
 variant="ghost"
 size="sm"
 onClick={onClose}
 className="text-profit hover:bg-profit/10 hover:text-foreground"
 aria-label="إغلاق"
 >
 ✕
 </Button>
 </div>
 </div>
 <GoldBorder />

 <div className="p-4 space-y-4">
 {loading && (
 <div className="space-y-3">
 <Skeleton className="h-16 w-full rounded-lg" />
 <Skeleton className="h-32 w-full rounded-lg" />
 </div>
 )}
 {error && !loading && (
 <Card className="border-loss/20">
 <CardContent className="p-4 flex items-center gap-2 text-sm text-loss ">
 <AlertTriangle className="w-4 h-4 flex-shrink-0" />
 <span>{error}</span>
 </CardContent>
 </Card>
 )}
 {data && !loading && (
 <ShariaStockDetailBody data={data} />
 )}
 </div>
 </div>
 </div>
 );
}

function ShariaStockDetailBody({ data }: { data: ShariaDetailResponse }) {
 const metric = data.metric || {};
 const symbol = data.symbol;
 const isHalal = Number((metric as Record<string, unknown>).is_halal_consensus ?? 0) === 1;
 const compliantCount = Number((metric as Record<string, unknown>).compliant_sources_count ?? 0);
 const activeCount = Number((metric as Record<string, unknown>).active_sources_count ?? 0);
 const spPct = safeNumber((metric as Record<string, unknown>).sp_haram_earning_pct);
 const haramPct = safeNumber((metric as Record<string, unknown>).haram_earnings_pct);
 const loansPct = safeNumber((metric as Record<string, unknown>).loans_pct);
 const nameAr = (metric as Record<string, unknown>).name_ar as string | undefined;
 const categoryAr = (metric as Record<string, unknown>).category_ar as string | undefined;
 const price = data.price;

 return (
 <>
 {/* Headline */}
 <div className="rounded-lg border border-profit bg-profit/10 /20 p-3 space-y-1">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="font-bold text-profit text-lg">{symbol}</span>
 <Badge
 className={cn(
 'border',
 isHalal
 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 border-profit '
 : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 border-warning ',
 )}
 >
 {isHalal ? '🟢 متوافق (إجماع)' : '🟡 مشمول بالقائمة'}
 </Badge>
 <Badge variant="outline" className="text-xs">
 {compliantCount}/{activeCount || 8} مصدر
 </Badge>
 </div>
 {nameAr && <p className="text-sm text-muted-foreground">{nameAr}</p>}
 {categoryAr && <p className="text-xs text-muted-foreground/70">{categoryAr}</p>}
 </div>

 {/* Metrics grid */}
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
 <MetricTile label="نسبة S&P الحرام" value={formatPct(spPct)} accent="amber" />
 <MetricTile label="الأرباح المحرمة" value={formatPct(haramPct)} accent="amber" />
 <MetricTile label="نسبة القروض" value={formatPct(loansPct)} accent="amber" />
 <MetricTile
 label="سعر السوق"
 value={price?.current_price != null ? price.current_price.toFixed(2) : '—'}
 accent="emerald"
 />
 </div>

 <OrnamentDivider />

 {/* Sources breakdown */}
 <div>
 <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
 <BookOpen className="w-4 h-4 text-profit" />
 تفصيل المصادر الثمانية
 </h4>
 <div className="rounded-md border border-border overflow-hidden">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/40">
 <TableHead className="text-xs">المصدر</TableHead>
 <TableHead className="text-xs text-center">الحالة</TableHead>
 <TableHead className="text-xs text-center">النسبة</TableHead>
 <TableHead className="text-xs text-center hidden sm:table-cell">المنهجية</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {data.sources.length === 0 && (
 <TableRow>
 <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">
 لا توجد بيانات مصادر لهذا السهم.
 </TableCell>
 </TableRow>
 )}
 {data.sources.map((s) => {
 const st = (s.status || 'not_available') as ShariaStatus;
 return (
 <TableRow key={`${symbol}-${s.source_key}`} className="text-xs">
 <TableCell className="font-medium">{s.source_name_ar}</TableCell>
 <TableCell className="text-center">
 <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs', STATUS_BADGE_CLASS[st])}>
 {STATUS_EMOJI[st]} {STATUS_LABELS_AR[st]}
 </span>
 </TableCell>
 <TableCell className="text-center tabular-nums" dir="ltr">
 {formatPct(s.percentage)}
 </TableCell>
 <TableCell className="text-center text-muted-foreground hidden sm:table-cell">
 {s.methodology || '—'}
 </TableCell>
 </TableRow>
 );
 })}
 </TableBody>
 </Table>
 </div>
 </div>

 {/* Purification rates */}
 {data.purification_rates.length > 0 && (
 <>
 <OrnamentDivider />
 <div>
 <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
 <Scale className="w-4 h-4 text-warning" />
 نسب التطهير المعتمدة
 </h4>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
 {data.purification_rates.map((r) => (
 <div
 key={`${symbol}-${r.method_key}`}
 className={cn(
 'rounded-md border p-2 flex items-center justify-between',
 r.is_primary === 1
 ? 'border-warning bg-warning/10 '
 : 'border-border bg-muted/30',
 )}
 >
 <div>
 <div className="text-xs font-medium">
 {r.method_name_ar || r.method_key}
 {r.is_primary === 1 && (
 <span className="text-xs text-warning mr-1">★ أساسي</span>
 )}
 </div>
 <div className="text-xs text-muted-foreground">{r.basis || '—'}</div>
 </div>
 <div className="text-sm font-bold tabular-nums text-warning " dir="ltr">
 {formatPct(r.rate_pct)}
 </div>
 </div>
 ))}
 </div>
 </div>
 </>
 )}
 </>
 );
}

function MetricTile({
 label,
 value,
 accent,
}: {
 label: string;
 value: string;
 accent: 'emerald' | 'amber';
}) {
 return (
 <div
 className={cn(
 'rounded-md border p-2 text-center',
 accent === 'emerald'
 ? 'border-profit bg-profit/10 /20'
 : 'border-warning bg-warning/10 /20',
 )}
 >
 <div className="text-xs text-muted-foreground">{label}</div>
 <div
 className={cn(
 'text-sm font-bold tabular-nums',
 accent === 'emerald'
 ? 'text-profit '
 : 'text-warning ',
 )}
 dir="ltr"
 >
 {value}
 </div>
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Purification calculator — single trade */
/* ------------------------------------------------------------------ */

interface PurificationCalculatorProps {
 defaultSymbol?: string;
}

function SingleTradePurificationCalculator({ defaultSymbol }: PurificationCalculatorProps) {
 const [symbol, setSymbol] = useState(defaultSymbol || '');
 const [quantity, setQuantity] = useState('');
 const [buyPrice, setBuyPrice] = useState('');
 const [sellPrice, setSellPrice] = useState('');
 const [method, setMethod] = useState('S&P');
 const [includeCapitalGain, setIncludeCapitalGain] = useState(true);
 const [loading, setLoading] = useState(false);
 const [result, setResult] = useState<PurificationResponse | null>(null);
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
 if (defaultSymbol) setSymbol(defaultSymbol);
 }, [defaultSymbol]);

 const canSubmit =
 symbol.trim().length > 0 &&
 Number(quantity) > 0 &&
 !loading;

 const handleCalculate = useCallback(async () => {
 if (!canSubmit) return;
 setLoading(true);
 setError(null);
 setResult(null);
 try {
 const body: Record<string, unknown> = {
 symbol: symbol.trim().toUpperCase(),
 quantity: Number(quantity),
 method,
 include_capital_gain: includeCapitalGain,
 };
 const buy = Number(buyPrice);
 const sell = Number(sellPrice);
 if (Number.isFinite(buy) && buy > 0) body.buy_price = buy;
 if (Number.isFinite(sell) && sell > 0) body.sell_price = sell;

 const res = await fetch('/api/sharia/purification', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 const json = (await res.json()) as PurificationResponse;
 if (!json.success) {
 throw new Error(json.error || json.detail || 'فشل الحساب');
 }
 setResult(json);
 } catch (e) {
 setError(String((e as Error).message || e));
 } finally {
 setLoading(false);
 }
 }, [symbol, quantity, buyPrice, sellPrice, method, includeCapitalGain, canSubmit]);

 return (
 <Card className="border-profit ">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2 text-base">
 <Calculator className="w-4 h-4 text-profit" />
 حاسبة تطهير صفقة واحدة
 </CardTitle>
 <CardDescription className="text-xs">
 أدخل رمز السهم وعدد الأسهم وسعري الشراء والبيع لحساب قيمة التطهير الواجب إخراجها.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div>
 <label className="text-xs font-medium text-muted-foreground mb-1 block">رمز السهم</label>
 <Input
 value={symbol}
 onChange={(e) => setSymbol(e.target.value)}
 placeholder="مثال: ABUK"
 className="font-mono"
 dir="ltr"
 />
 </div>
 <div>
 <label className="text-xs font-medium text-muted-foreground mb-1 block">عدد الأسهم</label>
 <Input
 type="number"
 value={quantity}
 onChange={(e) => setQuantity(e.target.value)}
 placeholder="مثال: 500"
 dir="ltr"
 />
 </div>
 <div>
 <label className="text-xs font-medium text-muted-foreground mb-1 block">سعر الشراء (ج.م)</label>
 <Input
 type="number"
 value={buyPrice}
 onChange={(e) => setBuyPrice(e.target.value)}
 placeholder="اختياري"
 dir="ltr"
 />
 </div>
 <div>
 <label className="text-xs font-medium text-muted-foreground mb-1 block">سعر البيع (ج.م)</label>
 <Input
 type="number"
 value={sellPrice}
 onChange={(e) => setSellPrice(e.target.value)}
 placeholder="اختياري"
 dir="ltr"
 />
 </div>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
 <div>
 <label className="text-xs font-medium text-muted-foreground mb-1 block">المنهجية</label>
 <Select value={method} onValueChange={setMethod}>
 <SelectTrigger className="w-full">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="S&P">معيار S&P (أساسي)</SelectItem>
 <SelectItem value="musaffa">مصفّى</SelectItem>
 <SelectItem value="kashif">كاشف</SelectItem>
 <SelectItem value="osoul">أسطول</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
 <input
 type="checkbox"
 checked={includeCapitalGain}
 onChange={(e) => setIncludeCapitalGain(e.target.checked)}
 className="w-4 h-4 rounded border-border accent-profit"
 />
 تضمين الربح الرأسمالي المحقق
 </label>
 </div>

 <Button
 onClick={handleCalculate}
 disabled={!canSubmit}
 className="w-full bg-profit hover:bg-profit text-white gap-2"
 >
 {loading ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin" />
 جارٍ الحساب...
 </>
 ) : (
 <>
 <Calculator className="w-4 h-4" />
 احسب قيمة التطهير
 </>
 )}
 </Button>

 {error && (
 <Alert variant="error">{error}</Alert>
 )}

 {result && (
 <PurificationResultCard result={result} />
 )}
 </CardContent>
 </Card>
 );
}

function PurificationResultCard({ result }: { result: PurificationResponse }) {
 const amount = typeof result.purification_amount === 'number' ? result.purification_amount : null;
 const rate = typeof result.purification_rate_pct === 'number' ? result.purification_rate_pct : null;
 const dividends = typeof result.dividends === 'number' ? result.dividends : null;
 const capitalGain = typeof result.realized_capital_gain === 'number' ? result.realized_capital_gain : null;

 return (
 <div className="rounded-lg border-2 border-warning from-warning to-warning dark:dark:dark:p-4">
 <div className="flex items-center justify-between gap-3 mb-3">
 <div>
 <p className="text-xs uppercase tracking-wider text-warning font-semibold">
 قيمة التطهير الواجبة
 </p>
 <p className="text-2xl font-bold text-warning tabular-nums" dir="ltr">
 {amount != null ? `${amount.toFixed(2)} ج.م` : '—'}
 </p>
 </div>
 <div className="text-left">
 <p className="text-xs text-muted-foreground">المنهجية</p>
 <p className="text-xs font-bold">{result.method || result.primary_method || 'S&P'}</p>
 </div>
 </div>
 <Separator className="my-2 bg-warning " />
 <div className="grid grid-cols-3 gap-2 text-center">
 <div>
 <p className="text-xs text-muted-foreground">نسبة التطهير</p>
 <p className="text-sm font-bold tabular-nums" dir="ltr">{formatPct(rate)}</p>
 </div>
 <div>
 <p className="text-xs text-muted-foreground">التوزيعات</p>
 <p className="text-sm font-bold tabular-nums" dir="ltr">
 {dividends != null ? `${dividends.toFixed(2)}` : '—'}
 </p>
 </div>
 <div>
 <p className="text-xs text-muted-foreground">الربح المحقق</p>
 <p className="text-sm font-bold tabular-nums" dir="ltr">
 {capitalGain != null ? `${capitalGain.toFixed(2)}` : '—'}
 </p>
 </div>
 </div>
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Portfolio purification calculator */
/* ------------------------------------------------------------------ */

function PortfolioPurificationCalculator() {
 const user = useAppStore((s) => s.user);
 const [userId, setUserId] = useState('');
 const [method, setMethod] = useState('S&P');
 const [includeCapitalGain, setIncludeCapitalGain] = useState(true);
 const [loading, setLoading] = useState(false);
 const [result, setResult] = useState<Record<string, unknown> | null>(null);
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
 if (user?.id) setUserId(user.id);
 }, [user?.id]);

 const canSubmit = userId.trim().length > 0 && !loading;

 const handleCalculate = useCallback(async () => {
 if (!canSubmit) return;
 setLoading(true);
 setError(null);
 setResult(null);
 try {
 const res = await fetch('/api/sharia/purification', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 user_id: userId.trim(),
 method,
 include_capital_gain: includeCapitalGain,
 }),
 });
 const json = (await res.json()) as PurificationResponse & Record<string, unknown>;
 if (!json.success) {
 throw new Error(json.error || json.detail || 'فشل الحساب');
 }
 setResult(json);
 } catch (e) {
 setError(String((e as Error).message || e));
 } finally {
 setLoading(false);
 }
 }, [userId, method, includeCapitalGain, canSubmit]);

 return (
 <Card className="border-warning ">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2 text-base">
 <Users className="w-4 h-4 text-warning" />
 تطهير المحفظة بالكامل
 </CardTitle>
 <CardDescription className="text-xs">
 احسب إجمالي قيمة التطهير الواجب إخراجها لكامل محفظتك عبر أسهم متعددة.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
 <div>
 <label className="text-xs font-medium text-muted-foreground mb-1 block">معرّف المستخدم</label>
 <Input
 value={userId}
 onChange={(e) => setUserId(e.target.value)}
 placeholder="معرّف حسابك في المنصة"
 dir="ltr"
 />
 </div>
 <div>
 <label className="text-xs font-medium text-muted-foreground mb-1 block">المنهجية</label>
 <Select value={method} onValueChange={setMethod}>
 <SelectTrigger className="w-full">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="S&P">معيار S&P (أساسي)</SelectItem>
 <SelectItem value="musaffa">مصفّى</SelectItem>
 <SelectItem value="kashif">كاشف</SelectItem>
 <SelectItem value="osoul">أسطول</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
 <input
 type="checkbox"
 checked={includeCapitalGain}
 onChange={(e) => setIncludeCapitalGain(e.target.checked)}
 className="w-4 h-4 rounded border-border accent-profit"
 />
 تضمين الأرباح الرأسمالية المحققة
 </label>

 <Button
 onClick={handleCalculate}
 disabled={!canSubmit}
 className="w-full bg-warning hover:bg-warning text-white gap-2"
 >
 {loading ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin" />
 جارٍ حساب المحفظة...
 </>
 ) : (
 <>
 <Scale className="w-4 h-4" />
 احسب تطهير المحفظة
 </>
 )}
 </Button>

 {error && <Alert variant="error">{error}</Alert>}

 {result && <PortfolioResultCard result={result} />}
 </CardContent>
 </Card>
 );
}

function PortfolioResultCard({ result }: { result: Record<string, unknown> }) {
 // Try common fields the calculator may return; fall back gracefully.
 const totalPurification = safeNumber(result.total_purification ?? result.purification_amount ?? result.purification);
 const tradesCount = safeNumber(result.trades_count ?? result.positions_count ?? result.assets_count);
 const totalDividends = safeNumber(result.total_dividends ?? result.dividends);
 const totalCapitalGain = safeNumber(result.total_realized_capital_gain ?? result.realized_capital_gain);
 const perSymbol = Array.isArray(result.per_symbol) ? (result.per_symbol as Array<Record<string, unknown>>) : [];

 return (
 <div className="rounded-lg border-2 border-profit from-profit to-profit /30 /10 /30 p-4 space-y-3">
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="text-xs uppercase tracking-wider text-profit font-semibold">
 إجمالي التطهير للمحفظة
 </p>
 <p className="text-2xl font-bold text-profit tabular-nums" dir="ltr">
 {totalPurification != null ? `${totalPurification.toFixed(2)} ج.م` : '—'}
 </p>
 </div>
 <div className="text-left">
 <p className="text-xs text-muted-foreground">عدد المراكز</p>
 <p className="text-sm font-bold tabular-nums">{tradesCount != null ? tradesCount : '—'}</p>
 </div>
 </div>

 <div className="grid grid-cols-2 gap-2 text-center">
 <div className="rounded-md border border-border bg-background/60 p-2">
 <p className="text-xs text-muted-foreground">إجمالي التوزيعات</p>
 <p className="text-sm font-bold tabular-nums" dir="ltr">
 {totalDividends != null ? totalDividends.toFixed(2) : '—'}
 </p>
 </div>
 <div className="rounded-md border border-border bg-background/60 p-2">
 <p className="text-xs text-muted-foreground">إجمالي الربح المحقق</p>
 <p className="text-sm font-bold tabular-nums" dir="ltr">
 {totalCapitalGain != null ? totalCapitalGain.toFixed(2) : '—'}
 </p>
 </div>
 </div>

 {perSymbol.length > 0 && (
 <div>
 <p className="text-xs font-semibold mb-1">تفصيل لكل سهم</p>
 <div className="rounded-md border border-border overflow-hidden max-h-48 overflow-y-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/40">
 <TableHead className="text-xs">السهم</TableHead>
 <TableHead className="text-xs text-center">الكمية</TableHead>
 <TableHead className="text-xs text-center">قيمة التطهير</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {perSymbol.map((row, i) => (
 <TableRow key={String(row.symbol || i)} className="text-xs">
 <TableCell className="font-mono font-medium">
 {String(row.symbol || row.ticker || '—')}
 </TableCell>
 <TableCell className="text-center tabular-nums" dir="ltr">
 {safeNumber(row.quantity ?? row.shares) != null
 ? safeNumber(row.quantity ?? row.shares)?.toString()
 : '—'}
 </TableCell>
 <TableCell className="text-center tabular-nums font-bold text-warning " dir="ltr">
 {safeNumber(row.purification_amount ?? row.purification ?? row.amount) != null
 ? `${safeNumber(row.purification_amount ?? row.purification ?? row.amount)?.toFixed(2)}`
 : '—'}
 </TableCell>
 </TableRow>
 ))}
 </TableBody>
 </Table>
 </div>
 </div>
 )}
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Small alert */
/* ------------------------------------------------------------------ */

function Alert({ variant, children }: { variant: 'error' | 'info'; children: React.ReactNode }) {
 return (
 <div
 className={cn(
 'flex items-start gap-2 p-3 rounded-md text-xs border',
 variant === 'error'
 ? 'border-loss bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 '
 : 'border-warning bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30/30 ',
 )}
 >
 <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
 <span>{children}</span>
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Stocks list tab */
/* ------------------------------------------------------------------ */

interface StocksListTabProps {
 onOpenDetail: (symbol: string) => void;
}

function ShariaStocksListTab({ onOpenDetail }: StocksListTabProps) {
 const [rows, setRows] = useState<ShariaRow[]>([]);
 const [stats, setStats] = useState<{
 total: number;
 consensus_count: number;
 with_sp_rate: number;
 latest_source_update: string | null;
 } | null>(null);
 const [sources, setSources] = useState<
 Array<{ source_key: string; name_ar: string; methodology: string; is_active: number }>
 >([]);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);

 // Filters
 const [search, setSearch] = useState('');
 const [consensusOnly, setConsensusOnly] = useState(false);
 const [filterStatus, setFilterStatus] = useState<'all' | 'compliant' | 'doubtful' | 'non_compliant'>('all');

 // Pagination
 const [page, setPage] = useState(0);
 const pageSize = 24;

 const fetchList = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const params = new URLSearchParams({
 limit: '1000',
 offset: '0',
 });
 if (consensusOnly) params.set('consensus', 'true');
 if (search.trim()) params.set('search', search.trim());
 const res = await fetch(`/api/sharia?${params.toString()}`, { cache: 'no-store' });
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const json = (await res.json()) as ShariaListResponse;
 if (!json.success) throw new Error('استجابة غير صالحة');
 setRows(json.rows || []);
 setStats(json.stats || null);
 setSources(json.sources || []);
 } catch (e) {
 setError(String((e as Error).message || e));
 setRows([]);
 } finally {
 setLoading(false);
 }
 }, [consensusOnly, search]);

 useEffect(() => {
 fetchList();
 }, [fetchList]);

 // Client-side filter by status (server doesn't filter by exact status field).
 const filteredRows = useMemo(() => {
 if (filterStatus === 'all') return rows;
 return rows.filter((r) => deriveOverallStatus(r) === filterStatus);
 }, [rows, filterStatus]);

 const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
 const safePage = Math.min(page, totalPages - 1);
 const pageRows = filteredRows.slice(safePage * pageSize, (safePage + 1) * pageSize);

 const consensusPct =
 stats && stats.total > 0
 ? Math.round((stats.consensus_count / stats.total) * 100)
 : null;

 return (
 <div className="space-y-3">
 {/* Stats strip */}
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
 <StatPill label="إجمالي الأسهم" value={stats?.total?.toString() ?? '—'} icon={<Building2 className="w-3.5 h-3.5" />} accent="emerald" />
 <StatPill label="متوافق (إجماع)" value={stats?.consensus_count?.toString() ?? '—'} icon={<ShieldCheck className="w-3.5 h-3.5" />} accent="emerald" />
 <StatPill label="نسبة الإجماع" value={consensusPct != null ? `${consensusPct}%` : '—'} icon={<Award className="w-3.5 h-3.5" />} accent="amber" />
 <StatPill label="آخر تحديث مصدر" value={stats?.latest_source_update ? stats.latest_source_update.slice(0, 10) : '—'} icon={<Info className="w-3.5 h-3.5" />} accent="emerald" />
 </div>

 {/* Filters */}
 <Card className="border-profit ">
 <CardContent className="p-3 space-y-3">
 <div className="flex flex-col sm:flex-row gap-2">
 <div className="relative flex-1">
 <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => {
 setSearch(e.target.value);
 setPage(0);
 }}
 placeholder="بحث بالرمز أو الاسم العربي..."
 className="pr-9"
 />
 </div>
 <div className="flex gap-2">
 <Button
 variant={consensusOnly ? 'default' : 'outline'}
 onClick={() => {
 setConsensusOnly((v) => !v);
 setPage(0);
 }}
 className={cn(
 'gap-1.5 text-xs h-9',
 consensusOnly && 'bg-profit hover:bg-profit text-white',
 )}
 >
 <ShieldCheck className="w-3.5 h-3.5" />
 الإجماع فقط
 </Button>
 <Button
 variant="outline"
 size="icon"
 onClick={fetchList}
 disabled={loading}
 className="h-9 w-9"
 aria-label="تحديث"
 >
 <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
 </Button>
 </div>
 </div>

 {/* Status filter chips */}
 <div className="flex flex-wrap gap-1.5">
 {([
 { id: 'all', label: 'الكل', color: 'bg-muted text-foreground' },
 { id: 'compliant', label: '🟢 متوافق', color: STATUS_BADGE_CLASS.compliant },
 { id: 'doubtful', label: '🟡 مشمول', color: STATUS_BADGE_CLASS.doubtful },
 { id: 'non_compliant', label: '🔴 غير متوافق', color: STATUS_BADGE_CLASS.non_compliant },
 ] as const).map((opt) => (
 <button
 key={opt.id}
 onClick={() => {
 setFilterStatus(opt.id);
 setPage(0);
 }}
 className={cn(
 'text-xs px-2 py-1 rounded-full border transition-all',
 opt.color,
 filterStatus === opt.id
 ? 'ring-2 ring-offset-1 ring-profit font-bold'
 : 'opacity-70 hover:opacity-100',
 )}
 >
 {opt.label}
 </button>
 ))}
 </div>

 {/* Sources legend */}
 {sources.length > 0 && (
 <details className="text-xs">
 <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-1.5">
 <BookOpen className="w-3.5 h-3.5" />
 المصادر الشرعية الثمانية ({sources.filter((s) => s.is_active === 1).length} نشط)
 </summary>
 <div className="mt-2 grid grid-cols-2 gap-1.5 p-2 rounded-md bg-muted/40">
 {sources.map((s) => (
 <div key={s.source_key} className="flex items-center justify-between text-xs">
 <span className="font-medium">{s.name_ar}</span>
 <span className="text-muted-foreground">
 {s.is_active === 1 ? 'نشط' : 'متوقف'} · {s.methodology}
 </span>
 </div>
 ))}
 </div>
 </details>
 )}
 </CardContent>
 </Card>

 {error && <Alert variant="error">{error}</Alert>}

 {/* Grid */}
 {loading ? (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
 {Array.from({ length: 6 }).map((_, i) => (
 <Skeleton key={i} className="h-24 rounded-lg" />
 ))}
 </div>
 ) : pageRows.length === 0 ? (
 <Card>
 <CardContent className="py-8 text-center text-sm text-muted-foreground">
 <Filter className="w-8 h-8 mx-auto mb-2 opacity-40" />
 لا توجد أسهم مطابقة للفلتر الحالي.
 </CardContent>
 </Card>
 ) : (
 <>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
 {pageRows.map((row) => (
 <ShariaStockRowCard key={row.symbol} row={row} onOpenDetail={onOpenDetail} />
 ))}
 </div>

 {/* Pagination */}
 {totalPages > 1 && (
 <div className="flex items-center justify-between gap-2 pt-2">
 <span className="text-xs text-muted-foreground">
 صفحة {safePage + 1} من {totalPages} · إجمالي {filteredRows.length} سهماً
 </span>
 <div className="flex gap-1">
 {/* P0-COMPONENT-UNIFICATION Phase 2.4: UnifiedPagination بدل inline buttons */}
 <UnifiedPagination
 page={safePage}
 totalPages={totalPages}
 onChange={setPage}
 size="sm"
 variant="compact"
 showCounter={false}
 />
 </div>
 </div>
 )}
 </>
 )}
 </div>
 );
}

function StatPill({
 label,
 value,
 icon,
 accent,
}: {
 label: string;
 value: string;
 icon: React.ReactNode;
 accent: 'emerald' | 'amber';
}) {
 return (
 <div
 className={cn(
 'rounded-lg border p-2 flex items-center gap-2',
 accent === 'emerald'
 ? 'border-profit bg-profit/10 /20'
 : 'border-warning bg-warning/10 /20',
 )}
 >
 <span
 className={cn(
 'flex h-7 w-7 items-center justify-center rounded-full',
 accent === 'emerald'
 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 '
 : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 ',
 )}
 >
 {icon}
 </span>
 <div className="min-w-0">
 <p className="text-xs text-muted-foreground truncate">{label}</p>
 <p
 className={cn(
 'text-sm font-bold tabular-nums',
 accent === 'emerald'
 ? 'text-profit '
 : 'text-warning ',
 )}
 dir="ltr"
 >
 {value}
 </p>
 </div>
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Main view */
/* ------------------------------------------------------------------ */

export function ShariaView() {
 const [activeTab, setActiveTab] = useState<'stocks' | 'single' | 'portfolio'>('stocks');
 const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
 const [defaultCalcSymbol, setDefaultCalcSymbol] = useState<string>('');

 const openDetail = useCallback((symbol: string) => {
 setSelectedSymbol(symbol);
 }, []);

 const openCalculatorForSymbol = useCallback((symbol: string) => {
 setDefaultCalcSymbol(symbol);
 setActiveTab('single');
 setSelectedSymbol(null);
 toast.info(`تم ضبط حاسبة التطهير على السهم ${symbol}`);
 }, []);

 return (
 <div className="min-h-screen via-background to-background /10">
 <div className="max-w-6xl mx-auto p-3 sm:p-4 space-y-4" dir="rtl">
 {/* Hero header */}
 <Card className="relative overflow-hidden border-profit from-profit via-profit to-profit text-profit">
 <IslamicPattern />
 <CardContent className="relative p-5 sm:p-6">
 <div className="flex items-start justify-between gap-3 flex-wrap">
 <div>
 <div className="flex items-center gap-2 mb-1">
 <ShieldCheck className="w-6 h-6 text-warning" />
 <h1 className="text-xl sm:text-2xl font-bold">شاشة التوافق الشرعي</h1>
 </div>
 <p className="text-xs sm:text-sm text-profit/90 max-w-2xl leading-relaxed">
 بيانات التوافق الشرعي لأسهم البورصة المصرية من ثمانية مصادر متخصصة، مع
 حاسبة تطهير الأرباح وفق معيار S&P الشرعي وحاسبة تطهير المحفظة بالكامل.
 </p>
 </div>
 <div className="text-left">
 <div className="text-xs uppercase tracking-wider text-profit/80">
 المنهجية الأساسية
 </div>
 <div className="text-lg font-bold text-warning">معيار S&P</div>
 <div className="text-xs text-profit/70 mt-0.5">
 8 مصادر · تحديث أسبوعي
 </div>
 </div>
 </div>
 </CardContent>
 </Card>
 <GoldBorder />

 <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
 <TabsList className="grid grid-cols-3 w-full">
 <TabsTrigger value="stocks" className="flex items-center gap-1.5 text-xs sm:text-sm">
 <Building2 className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">قائمة الأسهم</span>
 <span className="sm:hidden">الأسهم</span>
 </TabsTrigger>
 <TabsTrigger value="single" className="flex items-center gap-1.5 text-xs sm:text-sm">
 <Calculator className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">حاسبة تطهير صفقة</span>
 <span className="sm:hidden">صفقة</span>
 </TabsTrigger>
 <TabsTrigger value="portfolio" className="flex items-center gap-1.5 text-xs sm:text-sm">
 <Users className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">تطهير المحفظة</span>
 <span className="sm:hidden">المحفظة</span>
 </TabsTrigger>
 </TabsList>

 <TabsContent value="stocks" className="mt-3">
 <ShariaStocksListTab onOpenDetail={openDetail} />
 </TabsContent>

 <TabsContent value="single" className="mt-3">
 <SingleTradePurificationCalculator defaultSymbol={defaultCalcSymbol} />
 <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
 <Info className="w-3 h-3" />
 الحساب يتم عبر محرك Python المعتمد (vps-service/portfolio/purification_calculator.py) لضمان الدقة.
 </p>
 </TabsContent>

 <TabsContent value="portfolio" className="mt-3">
 <PortfolioPurificationCalculator />
 <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
 <Info className="w-3 h-3" />
 يتم حساب التطهير لكل صفقة نشطة في محفظتك ثم جمعها. قد يستغرق الحساب بضع ثوانٍ.
 </p>
 </TabsContent>
 </Tabs>

 {/* Footer note */}
 <OrnamentDivider />
 <p className="text-xs text-muted-foreground text-center px-4 pb-2 leading-relaxed">
 البيانات مصدرها ثمانية مواقع متخصصة في التوافق الشرعي (بورصة حلال، مصفّى، كاشف،
 حلال إنفست، بنك فيصل الإسلامي، أسطول، ثندر/Islamicly، جروب الأسهم الشرعية فقط) ويتم
 تحديثها أسبوعياً. الإجماع يعني توافق 6 مصادر أو أكثر. هذه المعلومات للاسترشاد فقط ولا تُغني
 عن الفتوى المتخصصة.
 </p>
 </div>

 {/* Detail modal */}
 <ShariaStockDetailModal
 symbol={selectedSymbol}
 onClose={() => setSelectedSymbol(null)}
 />

 {/* Hidden helper to allow "calculate for this symbol" shortcut from modal — kept in scope */}
 <button
 type="button"
 aria-hidden
 style={{ display: 'none' }}
 onClick={() => selectedSymbol && openCalculatorForSymbol(selectedSymbol)}
 />
 </div>
 );
}

export default ShariaView;

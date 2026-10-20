'use client';

/**
 * ShariaStockCard — بطاقة معلومات شرعية مفصّلة لسهم (Deliverable 2, Task 23-C)
 * ========================================================================
 * بطاقة متكاملة (Card) تعرض ملخص التوافق الشرعي لسهم معيّن — تُستخدم في
 * الصفوف التفصيلية (StockDetail drawer / radar stock drawer / analysis
 * drawer) بجانب بيانات السهم الأخرى.
 *
 * البيانات تُجلب من GET /api/sharia?symbol=TICKER (مع cache per-ticker عبر
 * useShariaDetail hook — مشترك مع ShariaBadge).
 *
 * Reference:
 * - Constitution Rule 30 (CLIENT-FACING-STYLE): عربي فصيح رسمي.
 * - Constitution Rule 29 (NO-HYPE): لغة محايدة.
 * - Constitution Rule 62 (GIT-PUSH-DISCIPLINE).
 */

import React from 'react';
import {
 ShieldCheck,
 BookOpen,
 Scale,
 Award,
 Info,
 Calculator,
 Loader2,
} from 'lucide-react';
import {
 Card,
 CardContent,
 CardHeader,
 CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import {
 useShariaDetail,
 deriveShariaSummary,
} from './ShariaBadge';

/* ------------------------------------------------------------------ */
/* Shared status display (must match ShariaBadge) */
/* ------------------------------------------------------------------ */

type ShariaStatus = 'compliant' | 'non_compliant' | 'doubtful' | 'not_available';

const STATUS_LABELS_AR: Record<ShariaStatus, string> = {
 compliant: 'متوافق',
 non_compliant: 'غير متوافق',
 doubtful: 'مشمول',
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
 'bg-profit text-profit/50 border-profit ',
 non_compliant:
 'bg-loss text-loss/50 border-loss ',
 doubtful:
 'bg-warning text-warning/50 border-warning ',
 not_available:
 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

function formatPct(v: number | null | undefined, digits = 2): string {
 if (v == null || !Number.isFinite(v)) return '—';
 return `${v.toFixed(digits)}%`;
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export interface ShariaStockCardProps {
 ticker: string | null | undefined;
 /** compact = hide the 8-source table; default = full */
 variant?: 'compact' | 'default';
 className?: string;
}

export function ShariaStockCard({ ticker, variant = 'default', className }: ShariaStockCardProps) {
 const { state, data, error } = useShariaDetail(ticker);
 const setCurrentView = useAppStore((s) => s.setCurrentView);

 if (!ticker) {
 return null;
 }

 return (
 <Card
 className={cn(
 'border-profit to-background /10',
 className,
 )}
 >
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center justify-between gap-2 text-sm">
 <span className="flex items-center gap-1.5">
 <ShieldCheck className="w-4 h-4 text-profit" />
 التوافق الشرعي — {ticker}
 </span>
 {state === 'ok' && data && (
 <StatusBadge data={data} />
 )}
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 {state === 'loading' && (
 <div className="space-y-2">
 <Skeleton className="h-4 w-1/2" />
 <Skeleton className="h-12 w-full" />
 <Skeleton className="h-20 w-full" />
 </div>
 )}

 {state === 'error' && (
 <div className="flex items-center gap-2 text-xs text-loss ">
 <Info className="w-3.5 h-3.5" />
 <span>تعذّر تحميل البيانات: {error?.slice(0, 100)}</span>
 </div>
 )}

 {state === 'ok' && data && (
 <ShariaStockCardBody
 data={data}
 variant={variant}
 onOpenSharia={() => {
 setCurrentView('sharia');
 if (typeof window !== 'undefined') window.location.hash = 'sharia';
 }}
 />
 )}
 </CardContent>
 </Card>
 );
}

function StatusBadge({ data }: { data: import('./ShariaBadge').ShariaDetailResponse }) {
 const summary = deriveShariaSummary(data);
 return (
 <span
 className={cn(
 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
 summary.badgeClass,
 )}
 >
 {summary.emoji} {summary.label}
 {summary.isConsensus && (
 <span className="text-warning ">★</span>
 )}
 </span>
 );
}

function ShariaStockCardBody({
 data,
 variant,
 onOpenSharia,
}: {
 data: import('./ShariaBadge').ShariaDetailResponse;
 variant: 'compact' | 'default';
 onOpenSharia: () => void;
}) {
 const summary = deriveShariaSummary(data);
 const metric = data.metric || {};
 const spPct =
 typeof metric.sp_haram_earning_pct === 'number' ? metric.sp_haram_earning_pct : null;
 const haramPct =
 typeof metric.haram_earnings_pct === 'number' ? metric.haram_earnings_pct : null;
 const loansPct = typeof metric.loans_pct === 'number' ? metric.loans_pct : null;
 const sources = data.sources || [];
 const rates = data.purification_rates || [];

 return (
 <>
 {/* Metrics row */}
 <div className="grid grid-cols-3 gap-1.5">
 <MetricTile label="نسبة التطهير (S&P)" value={formatPct(summary.purificationRatePct ?? spPct)} accent="amber" />
 <MetricTile
 label="المصادر"
 value={`${summary.compliantCount}/${summary.activeCount || 8}`}
 accent="emerald"
 />
 <MetricTile
 label="السعر"
 value={
 data.price?.current_price != null
 ? (data.price.current_price ?? 0).toFixed(2)
 : '—'
 }
 accent="emerald"
 />
 </div>

 {/* Extra metrics for default variant */}
 {variant === 'default' && (
 <div className="grid grid-cols-2 gap-1.5">
 <MetricTile label="الأرباح المحرمة" value={formatPct(haramPct)} accent="amber" />
 <MetricTile label="نسبة القروض" value={formatPct(loansPct)} accent="amber" />
 </div>
 )}

 {/* Consensus / purification rates */}
 {(summary.isConsensus || rates.length > 0) && (
 <>
 <Separator className="my-1" />
 {summary.isConsensus && (
 <div className="flex items-center gap-1.5 text-xs text-profit ">
 <Award className="w-3.5 h-3.5" />
 <span>إجماع: متوافق في {summary.compliantCount} من {summary.activeCount || 8} مصادر.</span>
 </div>
 )}
 {rates.length > 0 && (
 <div>
 <p className="text-xs font-semibold mb-1 flex items-center gap-1">
 <Scale className="w-3 h-3 text-warning" />
 نسب التطهير المعتمدة
 </p>
 <div className="grid grid-cols-2 gap-1">
 {rates.slice(0, 4).map((r) => (
 <div
 key={r.method_key}
 className={cn(
 'rounded border p-1 flex items-center justify-between',
 r.is_primary === 1
 ? 'border-warning bg-warning/10 '
 : 'border-border bg-muted/30',
 )}
 >
 <span className="text-xs truncate">
 {r.method_name_ar || r.method_key}
 {r.is_primary === 1 && <span className="text-warning ml-0.5">★</span>}
 </span>
 <span
 className="text-xs font-bold tabular-nums text-warning "
 dir="ltr"
 >
 {formatPct(r.rate_pct)}
 </span>
 </div>
 ))}
 </div>
 </div>
 )}
 </>
 )}

 {/* Sources table — only in default variant */}
 {variant === 'default' && sources.length > 0 && (
 <>
 <Separator className="my-1" />
 <div>
 <p className="text-xs font-semibold mb-1 flex items-center gap-1">
 <BookOpen className="w-3 h-3 text-profit" />
 تفصيل المصادر الثمانية
 </p>
 <div className="rounded border border-border overflow-hidden">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/40">
 <TableHead className="text-xs h-7">المصدر</TableHead>
 <TableHead className="text-xs h-7 text-center">الحالة</TableHead>
 <TableHead className="text-xs h-7 text-center">النسبة</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {sources.slice(0, 8).map((s) => {
 const st = (s.status || 'not_available') as ShariaStatus;
 return (
 <TableRow key={s.source_key} className="text-xs">
 <TableCell className="py-1 font-medium">{s.source_name_ar}</TableCell>
 <TableCell className="py-1 text-center">
 <span className={cn('inline-flex items-center gap-0.5 px-1 py-0 rounded border text-xs', STATUS_BADGE_CLASS[st])}>
 {STATUS_EMOJI[st]} {STATUS_LABELS_AR[st]}
 </span>
 </TableCell>
 <TableCell className="py-1 text-center tabular-nums" dir="ltr">
 {formatPct(s.percentage)}
 </TableCell>
 </TableRow>
 );
 })}
 </TableBody>
 </Table>
 </div>
 </div>
 </>
 )}

 {/* Footer CTA */}
 <button
 onClick={onOpenSharia}
 className="w-full text-xs flex items-center justify-center gap-1 py-1.5 rounded-md bg-profit hover:bg-profit text-white transition-colors"
 >
 <Calculator className="w-3.5 h-3.5" />
 حاسبة التطهير + شاشة التوافق الشرعي
 </button>
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
 'rounded border p-1.5 text-center',
 accent === 'emerald'
 ? 'border-profit bg-profit/10 /20'
 : 'border-warning bg-warning/10 /20',
 )}
 >
 <div className="text-xs text-muted-foreground leading-tight">{label}</div>
 <div
 className={cn(
 'text-xs font-bold tabular-nums',
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

export default ShariaStockCard;

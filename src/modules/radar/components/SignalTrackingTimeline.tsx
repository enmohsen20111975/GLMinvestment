'use client';

/**
 * SignalTrackingTimeline.tsx — رحلة الإشارة
 * ============================================================================
 *
 * Visual timeline showing the journey of a tracked stock from the moment it
 * entered the radar until now. Renders:
 * 1. Header — ticker + entry date + days tracked + price → price + change%
 * 2. Price journey SVG line chart (entry → current) with target / stop lines
 * 3. Target progress bars (target_1, target_2, stop_loss) — color coded
 * 4. Vertical timeline events (signal / milestone / alert / current)
 * 5. Milestones checklist (reached ✅ / pending ⬜)
 *
 * Edge cases:
 * - Stock not tracked → CTA "أضف للمتابعة"
 * - No price history since entry → "مفيش بيانات أسعار كافية بعد"
 * - Entry price missing → "سعر الدخول مش متسجل"
 * - API error → graceful error card
 *
 * Source: GET /api/maker-radar/timeline?ticker=COMI&days=60
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
 Card,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
 Satellite, Calendar, TrendingUp, TrendingDown,
 Target, ShieldCheck, AlertTriangle, Rocket, Crosshair,
 CheckCircle2, Circle, RefreshCw, StarOff, Activity,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirrors the API response shape
// ─────────────────────────────────────────────────────────────────────────────
export type TimelineEventType = 'signal' | 'milestone' | 'alert' | 'current';

export interface TimelinePoint {
 date: string;
 price: number;
 event: TimelineEventType;
 label: string;
 note: string | null;
}

export interface Milestone {
 label: string;
 date: string | null;
 price: number | null;
 reached: boolean;
}

export interface TimelineData {
 success: boolean;
 ticker: string;
 entry: { date: string; price: number };
 current: { date: string; price: number; change_pct: number; days_tracked?: number };
 target_1: { price: number; pct: number; status: string; progress_pct: number };
 target_2: { price: number; pct: number; status: string; progress_pct: number };
 stop_loss: { price: number; pct: number; status: string; progress_pct: number };
 timeline: TimelinePoint[];
 milestones: Milestone[];
}

interface TimelineError {
 success: false;
 error: string;
 not_tracked?: boolean;
 no_price_history?: boolean;
 entry_price_missing?: boolean;
 ticker?: string;
 entry?: { date: string; price: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmtNum = (n: number | null | undefined, digits = 2): string => {
 if (n == null || isNaN(n as number)) return '-';
 return Number(n).toLocaleString('en-US', {
 maximumFractionDigits: digits,
 minimumFractionDigits: 0,
 });
};

const fmtPct = (n: number | null | undefined): string => {
 if (n == null || isNaN(n as number)) return '-';
 const sign = n > 0 ? '+' : '';
 return `${sign}${(n ?? 0).toFixed(1)}%`;
};

const fmtDate = (d: string | null): string => {
 if (!d) return '—';
 // YYYY-MM-DD → keep as-is for compactness in timeline
 return d.length >= 10 ? d.slice(0, 10) : d;
};

const pnlColorClass = (n: number | null | undefined): string => {
 if (n == null || isNaN(n as number)) return '';
 if (n > 0) return 'text-profit ';
 if (n < 0) return 'text-loss ';
 return 'text-muted-foreground';
};

// ─────────────────────────────────────────────────────────────────────────────
// Price journey SVG chart
// ─────────────────────────────────────────────────────────────────────────────
interface ChartPoint { x: number; y: number; date: string; price: number; }

interface PriceJourneyProps {
 timeline: TimelinePoint[];
 entryPrice: number;
 target1: number;
 target2: number;
 stopLoss: number;
 currentPrice: number;
}

function PriceJourneySVG({
 timeline,
 entryPrice,
 target1,
 target2,
 stopLoss,
 currentPrice,
}: PriceJourneyProps) {
 const W = 320;
 const H = 140;
 const padX = 32;
 const padY = 18;

 // Build price series from timeline — ensure at least entry + current
 const series: { date: string; price: number }[] = useMemo(() => {
 if (timeline.length === 0) return [];
 return timeline.map((p) => ({ date: p.date, price: p.price }));
 }, [timeline]);

 if (series.length < 2) {
 return (
 <div className="text-xs text-muted-foreground py-6 text-center">
 لا توجد نقاط كافية لرسم الخط
 </div>
 );
 }

 // Compute scale — include target_2 as ceiling, stop_loss as floor
 const allPrices = [...series.map((s) => s.price), target1, target2, stopLoss, entryPrice];
 const min = Math.min(...allPrices);
 const max = Math.max(...allPrices);
 const range = max - min || 1;

 const xFor = (i: number) => padX + (i / (series.length - 1)) * (W - padX * 2);
 const yFor = (p: number) => padY + (H - padY * 2) - ((p - min) / range) * (H - padY * 2);

 const points: ChartPoint[] = series.map((s, i) => ({
 x: xFor(i),
 y: yFor(s.price),
 date: s.date,
 price: s.price,
 }));

 const pathD = points
 .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x ?? 0).toFixed(1)} ${(p.y ?? 0).toFixed(1)}`)
 .join(' ');

 const isUp = currentPrice >= entryPrice;
 const lineColor = isUp ? '#10b981' : '#f43f5e';

 const lineFor = (label: string, price: number, color: string, dash = '4 2') => {
 if (price < min || price > max) return null;
 const y = yFor(price);
 return (
 <g key={label}>
 <line
 x1={padX}
 x2={W - padX}
 y1={y}
 y2={y}
 stroke={color}
 strokeWidth="1"
 strokeDasharray={dash}
 opacity={0.7}
 />
 <text x={padX - 4} y={y + 3} fontSize="8" fill={color} textAnchor="end">
 {label} {fmtNum(price, 2)}
 </text>
 </g>
 );
 };

 const last = points[points.length - 1];

 return (
 <div className="bg-background/60 rounded-md p-2 border border-border/40">
 <svg
 viewBox={`0 0 ${W} ${H}`}
 className="w-full h-32"
 preserveAspectRatio="none"
 role="img"
 aria-label="مخطط رحلة السعر من الدخول للحالي مع خطوط الهدف ووقف الخسارة"
 >
 <defs>
 <linearGradient id="timeline-grad" x1="0" x2="0" y1="0" y2="1">
 <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
 <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
 </linearGradient>
 </defs>

 {/* Target / stop horizontal lines */}
 {lineFor('هدف 2', target2, '#10b981')}
 {lineFor('هدف 1', target1, '#10b981')}
 {lineFor('وقف', stopLoss, '#f43f5e')}
 {lineFor('دخول', entryPrice, '#64748b', '2 2')}

 {/* Area under the curve */}
 <path
 d={`${pathD} L ${(last.x ?? 0).toFixed(1)} ${H - padY} L ${(points[0].x ?? 0).toFixed(1)} ${H - padY} Z`}
 fill="url(#timeline-grad)"
 stroke="none"
 />

 {/* Main line */}
 <path
 d={pathD}
 fill="none"
 stroke={lineColor}
 strokeWidth="1.5"
 strokeLinecap="round"
 strokeLinejoin="round"
 />

 {/* Current price marker */}
 <circle
 cx={last.x}
 cy={last.y}
 r="3.5"
 fill={lineColor}
 stroke="white"
 strokeWidth="1.5"
 />

 {/* Entry marker */}
 <circle
 cx={points[0].x}
 cy={points[0].y}
 r="3"
 fill="#3b82f6"
 stroke="white"
 strokeWidth="1.5"
 />
 </svg>

 <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
 <span>أول: {fmtDate(points[0].date)}</span>
 <span>آخر: {fmtDate(last.date)}</span>
 </div>
 </div>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Target progress bar
// ─────────────────────────────────────────────────────────────────────────────
interface ProgressRowProps {
 label: string;
 icon: React.ReactNode;
 price: number;
 pct: number;
 progress: number;
 status: string;
 statusLabel: string;
 variant: 'target_1' | 'target_2' | 'stop_loss';
}

function statusColorFor(variant: ProgressRowProps['variant'], status: string): string {
 if (variant === 'stop_loss') {
 if (status === 'danger') return 'bg-loss';
 if (status === 'warning') return 'bg-warning';
 return 'bg-profit'; // safe
 }
 // target_1 / target_2
 if (status === 'hit') return 'bg-profit';
 if (status === 'approaching') return 'bg-warning';
 if (variant === 'target_2') return 'bg-primary';
 return 'bg-warning';
}

function statusBadgeClass(variant: ProgressRowProps['variant'], status: string): string {
 if (variant === 'stop_loss') {
 if (status === 'danger') return 'bg-loss text-loss /40 ';
 if (status === 'warning') return 'bg-warning text-warning /40 ';
 return 'bg-profit text-profit /40 ';
 }
 if (status === 'hit') return 'bg-profit text-profit /40 ';
 if (status === 'approaching') return 'bg-warning text-warning /40 ';
 if (variant === 'target_2') return 'bg-primary text-primary /40 ';
 return 'bg-warning text-warning /40 ';
}

function ProgressRow({ label, icon, price, pct, progress, status, statusLabel, variant }: ProgressRowProps) {
 const barColor = statusColorFor(variant, status);
 const badgeClass = statusBadgeClass(variant, status);

 return (
 <div className="space-y-1">
 <div className="flex items-center justify-between text-xs">
 <span className="flex items-center gap-1 text-muted-foreground">
 {icon}
 {label}
 </span>
 <span className="flex items-center gap-1.5">
 <span className="font-mono font-semibold" dir="ltr">{fmtNum(price)}</span>
 <span className="text-muted-foreground">({fmtPct(pct)})</span>
 </span>
 </div>
 <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
 <div
 className={`h-full ${barColor} transition-all`}
 style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
 />
 </div>
 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span className={`px-1.5 py-0.5 rounded ${badgeClass} font-medium`}>{statusLabel}</span>
 <span className="font-mono">{progress}%</span>
 </div>
 </div>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline event row
// ─────────────────────────────────────────────────────────────────────────────
interface TimelineRowProps {
 point: TimelinePoint;
 isLast: boolean;
}

function eventIcon(event: TimelineEventType): React.ReactNode {
 switch (event) {
 case 'signal': return <Satellite className="h-3 w-3 text-primary" />;
 case 'milestone': return <Rocket className="h-3 w-3 text-profit" />;
 case 'alert': return <AlertTriangle className="h-3 w-3 text-warning" />;
 case 'current': return <Crosshair className="h-3.5 w-3.5 text-primary" />;
 }
}

function eventDotClass(event: TimelineEventType): string {
 switch (event) {
 case 'signal': return 'bg-primary border-primary';
 case 'milestone': return 'bg-profit border-profit';
 case 'alert': return 'bg-warning border-warning';
 case 'current': return 'bg-primary border-primary-foreground ring-2 ring-primary/30';
 }
}

function eventLabelEmoji(event: TimelineEventType): string {
 switch (event) {
 case 'signal': return '📡';
 case 'milestone': return '📈';
 case 'alert': return '⚠️';
 case 'current': return '📍';
 }
}

function TimelineRow({ point, isLast }: TimelineRowProps) {
 const changeFromEntry = 0; // already encoded in label
 return (
 <div className="flex gap-2 relative">
 {/* Vertical connector */}
 {!isLast && (
 <div className="absolute right-[7px] top-5 bottom-0 w-px bg-border/60" aria-hidden />
 )}
 {/* Dot */}
 <div
 className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 mt-1 ${eventDotClass(point.event)}`}
 aria-hidden
 />
 {/* Content */}
 <div className="flex-1 pb-3 min-w-0">
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <div className="flex items-center gap-1 min-w-0">
 <span className="text-xs" aria-hidden>{eventLabelEmoji(point.event)}</span>
 <span className="text-xs font-medium truncate">{point.label}</span>
 </div>
 <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono shrink-0">
 <span>{fmtDate(point.date)}</span>
 <span dir="ltr">{fmtNum(point.price)}</span>
 </div>
 </div>
 {point.note && (
 <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
 {point.note}
 </div>
 )}
 </div>
 {changeFromEntry !== 0 && null}
 </div>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestones checklist
// ─────────────────────────────────────────────────────────────────────────────
function MilestonesChecklist({ milestones }: { milestones: Milestone[] }) {
 if (!milestones || milestones.length === 0) return null;

 return (
 <div className="space-y-1.5">
 {milestones.map((m, i) => (
 <div key={`${m.label}-${i}`} className="flex items-center gap-2 text-xs">
 {m.reached ? (
 <CheckCircle2 className="h-3.5 w-3.5 text-profit shrink-0" />
 ) : (
 <Circle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
 )}
 <span className={m.reached ? 'text-foreground' : 'text-muted-foreground'}>
 {m.label}
 </span>
 <span className="text-xs text-muted-foreground font-mono mr-auto">
 {m.reached && m.date && m.price != null
 ? `${fmtDate(m.date)} @ ${fmtNum(m.price)}`
 : !m.reached
 ? 'لم يصل بعد'
 : ''}
 </span>
 </div>
 ))}
 </div>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge case cards
// ─────────────────────────────────────────────────────────────────────────────
function NotTrackedCard() {
 return (
 <Card className="p-4 border-dashed border-warning /40 bg-warning/40 /10">
 <div className="flex items-start gap-3">
 <div className="h-9 w-9 rounded-full bg-warning /40 flex items-center justify-center shrink-0">
 <StarOff className="h-4 w-4 text-warning " />
 </div>
 <div className="flex-1">
 <div className="text-sm font-semibold mb-1">رحلة الإشارة غير متاحة</div>
 <div className="text-xs text-muted-foreground leading-relaxed">
 أضِف السهم إلى قائمة المتابعة لعرض الخط الزمني الكامل — من تاريخ الدخول حتى الآن.
 </div>
 </div>
 </div>
 </Card>
 );
}

function NoPriceHistoryCard() {
 return (
 <Card className="p-4 border-dashed border-primary /40 bg-primary/40 /10">
 <div className="flex items-start gap-3">
 <div className="h-9 w-9 rounded-full bg-primary /40 flex items-center justify-center shrink-0">
 <Activity className="h-4 w-4 text-primary " />
 </div>
 <div className="flex-1">
 <div className="text-sm font-semibold mb-1">لا توجد بيانات أسعار كافية بعد</div>
 <div className="text-xs text-muted-foreground leading-relaxed">
 يتطلب الخط الزمني على الأقل جلستي أسعار من تاريخ الدخول. حاول مرة أخرى بعد فتح السوق.
 </div>
 </div>
 </div>
 </Card>
 );
}

function EntryPriceMissingCard() {
 return (
 <Card className="p-4 border-dashed border-loss /40 bg-loss/40 /10">
 <div className="flex items-start gap-3">
 <div className="h-9 w-9 rounded-full bg-loss /40 flex items-center justify-center shrink-0">
 <AlertTriangle className="h-4 w-4 text-loss " />
 </div>
 <div className="flex-1">
 <div className="text-sm font-semibold mb-1">سعر الدخول غير مُسجَّل</div>
 <div className="text-xs text-muted-foreground leading-relaxed">
 أزِل السهم من قائمة المتابعة وأضِفه مرة أخرى بسعر دخول صحيح ليعمل الخط الزمني.
 </div>
 </div>
 </div>
 </Card>
 );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
 return (
 <Card className="p-4 border-loss /40">
 <div className="flex items-start gap-3">
 <AlertTriangle className="h-5 w-5 text-loss shrink-0 mt-0.5" />
 <div className="flex-1">
 <div className="text-sm font-semibold mb-1">تعذّر تحميل الخط الزمني</div>
 <div className="text-xs text-muted-foreground mb-2">{message}</div>
 <Button size="sm" variant="outline" onClick={onRetry} className="h-7 text-xs">
 <RefreshCw className="h-3 w-3 ml-1" />
 إعادة المحاولة
 </Button>
 </div>
 </div>
 </Card>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export function SignalTrackingTimeline({ ticker }: { ticker: string }) {
 const [data, setData] = useState<TimelineData | null>(null);
 const [err, setErr] = useState<TimelineError | null>(null);
 const [loading, setLoading] = useState(true);
 const [errorMsg, setErrorMsg] = useState<string | null>(null);

 const fetchData = useCallback(async () => {
 setLoading(true);
 setErr(null);
 setErrorMsg(null);
 try {
 const res = await fetch(
 `/api/maker-radar/timeline?ticker=${encodeURIComponent(ticker)}&days=60`,
 { cache: 'no-store' }
 );
 const json = await res.json();
 if (json.success) {
 setData(json as TimelineData);
 } else {
 setData(null);
 setErr(json as TimelineError);
 if (
 !json.not_tracked &&
 !json.no_price_history &&
 !json.entry_price_missing
 ) {
 setErrorMsg(json.error || 'خطأ غير معروف');
 }
 }
 } catch (e) {
 setData(null);
 setErr(null);
 setErrorMsg(e instanceof Error ? e.message : 'خطأ في الاتصال');
 } finally {
 setLoading(false);
 }
 }, [ticker]);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 // ─── Loading state ──────────────────────────────────────────────────────
 if (loading) {
 return (
 <Card className="p-3 space-y-3">
 <div className="flex items-center gap-2">
 <Satellite className="h-4 w-4 text-primary" />
 <span className="text-xs font-semibold">رحلة الإشارة</span>
 </div>
 <Skeleton className="h-24 w-full" />
 <Skeleton className="h-16 w-full" />
 <Skeleton className="h-32 w-full" />
 </Card>
 );
 }

 // ─── Edge cases ─────────────────────────────────────────────────────────
 if (err?.not_tracked) {
 return (
 <Card className="p-3 space-y-2">
 <div className="flex items-center gap-2">
 <Satellite className="h-4 w-4 text-primary" />
 <span className="text-xs font-semibold">رحلة الإشارة — {ticker}</span>
 </div>
 <NotTrackedCard />
 </Card>
 );
 }

 if (err?.entry_price_missing) {
 return (
 <Card className="p-3 space-y-2">
 <div className="flex items-center gap-2">
 <Satellite className="h-4 w-4 text-primary" />
 <span className="text-xs font-semibold">رحلة الإشارة — {ticker}</span>
 </div>
 <EntryPriceMissingCard />
 </Card>
 );
 }

 if (err?.no_price_history) {
 return (
 <Card className="p-3 space-y-2">
 <div className="flex items-center gap-2">
 <Satellite className="h-4 w-4 text-primary" />
 <span className="text-xs font-semibold">رحلة الإشارة — {ticker}</span>
 </div>
 <NoPriceHistoryCard />
 </Card>
 );
 }

 if (errorMsg) {
 return (
 <Card className="p-3 space-y-2">
 <div className="flex items-center gap-2">
 <Satellite className="h-4 w-4 text-primary" />
 <span className="text-xs font-semibold">رحلة الإشارة — {ticker}</span>
 </div>
 <ErrorCard message={errorMsg} onRetry={fetchData} />
 </Card>
 );
 }

 if (!data) {
 return (
 <Card className="p-3 space-y-2">
 <div className="flex items-center gap-2">
 <Satellite className="h-4 w-4 text-primary" />
 <span className="text-xs font-semibold">رحلة الإشارة — {ticker}</span>
 </div>
 <NoPriceHistoryCard />
 </Card>
 );
 }

 // ─── Map status → Arabic label ──────────────────────────────────────────
 const statusAr = (s: string): string => {
 switch (s) {
 case 'hit': return 'تم الوصول';
 case 'approaching': return 'اقتراب';
 case 'pending': return 'بانتظار';
 case 'safe': return 'آمن — بعيد عنه';
 case 'warning': return 'تحذير — قرب منه';
 case 'danger': return 'خطر — قريب';
 default: return s;
 }
 };

 const daysTracked = data.current.days_tracked ?? 0;
 const isUp = data.current.change_pct >= 0;

 return (
 <Card className="p-3 space-y-3 border-primary/60 /40 bg-primary/20 /10">
 {/* ─── 2.1 Header ─── */}
 <div className="space-y-1.5">
 <div className="flex items-center justify-between flex-wrap gap-1">
 <div className="flex items-center gap-1.5">
 <Satellite className="h-4 w-4 text-primary" />
 <span className="text-sm font-bold">{ticker}</span>
 <span className="text-xs text-muted-foreground">— رحلة الإشارة</span>
 </div>
 <Badge variant="outline" className="text-xs h-5">
 <Calendar className="h-3 w-3 ml-1" />
 {daysTracked} يوم
 </Badge>
 </div>
 <div className="text-xs text-muted-foreground">
 📅 بدأ المتابعة: {fmtDate(data.entry.date)}
 </div>
 <div className="flex items-baseline gap-2 flex-wrap">
 <span className="text-xs text-muted-foreground">💰 من</span>
 <span className="font-mono font-semibold" dir="ltr">{fmtNum(data.entry.price)}</span>
 <span className="text-muted-foreground">←</span>
 <span className="font-mono font-semibold" dir="ltr">{fmtNum(data.current.price)}</span>
 <Badge
 variant="outline"
 className={`text-xs ${isUp ? 'text-profit' : 'text-loss'}`}
 >
 {isUp ? <TrendingUp className="h-3 w-3 ml-1" /> : <TrendingDown className="h-3 w-3 ml-1" />}
 {fmtPct(data.current.change_pct)}
 </Badge>
 </div>
 </div>

 {/* ─── 2.2 Price journey SVG ─── */}
 <PriceJourneySVG
 timeline={data.timeline}
 entryPrice={data.entry.price}
 target1={data.target_1.price}
 target2={data.target_2.price}
 stopLoss={data.stop_loss.price}
 currentPrice={data.current.price}
 />

 {/* ─── 2.3 Target progress bars ─── */}
 <div className="space-y-2 bg-background/60 rounded-md p-2 border border-border/40">
 <div className="text-xs font-semibold flex items-center gap-1 mb-1">
 <Target className="h-3 w-3 text-primary" />
 تقدّم الأهداف
 </div>
 <ProgressRow
 label="الهدف 1"
 icon={<Target className="h-3 w-3" />}
 price={data.target_1.price}
 pct={data.target_1.pct}
 progress={data.target_1.progress_pct}
 status={data.target_1.status}
 statusLabel={statusAr(data.target_1.status)}
 variant="target_1"
 />
 <ProgressRow
 label="الهدف 2"
 icon={<Target className="h-3 w-3" />}
 price={data.target_2.price}
 pct={data.target_2.pct}
 progress={data.target_2.progress_pct}
 status={data.target_2.status}
 statusLabel={statusAr(data.target_2.status)}
 variant="target_2"
 />
 <ProgressRow
 label="وقف الخسارة"
 icon={<ShieldCheck className="h-3 w-3" />}
 price={data.stop_loss.price}
 pct={data.stop_loss.pct}
 progress={data.stop_loss.progress_pct}
 status={data.stop_loss.status}
 statusLabel={statusAr(data.stop_loss.status)}
 variant="stop_loss"
 />
 </div>

 {/* ─── 2.4 Timeline events (vertical) ─── */}
 <div className="bg-background/60 rounded-md p-2 border border-border/40">
 <div className="text-xs font-semibold mb-2 flex items-center gap-1">
 <Activity className="h-3 w-3 text-primary" />
 أحداث الخط الزمني
 </div>
 {data.timeline.length === 0 ? (
 <div className="text-xs text-muted-foreground py-2 text-center">
 لا توجد أحداث بعد
 </div>
 ) : (
 <div className="space-y-0">
 {data.timeline.map((p, i) => (
 <TimelineRow
 key={`${p.date}-${i}`}
 point={p}
 isLast={i === data.timeline.length - 1}
 />
 ))}
 </div>
 )}
 </div>

 {/* ─── 2.5 Milestones checklist ─── */}
 <div className="bg-background/60 rounded-md p-2 border border-border/40">
 <div className="text-xs font-semibold mb-2 flex items-center gap-1">
 <CheckCircle2 className="h-3 w-3 text-profit" />
 محطات الإنجاز
 </div>
 <MilestonesChecklist milestones={data.milestones} />
 </div>

 {/* Footer / meta */}
 <div className="text-xs text-muted-foreground text-center pt-1 border-t border-border/30">
 آخر تحديث: {fmtDate(data.current.date)} · {data.timeline.length} حدث · {data.milestones.filter((m) => m.reached).length}/{data.milestones.length} محطة
 </div>
 </Card>
 );
}

export default SignalTrackingTimeline;

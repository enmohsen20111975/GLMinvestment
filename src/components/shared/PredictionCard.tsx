'use client';

/**
 * PredictionCard — Shared reusable card for displaying a stock/crypto prediction.
 * ==============================================================================
 * Phase 4 of EMERGENCY_REMEDIATION_PLAN.md — addresses the "22 prediction card
 * components with no shared primitive" problem from the engineering audit.
 *
 * Single source of truth for the standard prediction shape:
 * { ticker, signal, entryPrice, targetPrice, stopLoss, riskReward,
 * confidence, masterScore, evidenceCount, technicalExplanation? }
 *
 * Used by:
 * - market/PredictionsImageCard.tsx
 * - predictions/PredictionTrackingView.tsx
 * - recommendations/AiRecommendations.tsx
 * - recommendations/PublishedPredictions.tsx
 * - predictions/PicksManagementView.tsx
 *
 * Rules honored:
 * - Rule 28 (NO-DUPLICATION): one shape, one component, many consumers
 * - Rule 31 (NO-HYPE-LANGUAGE): neutral, professional tone
 * - Rule 52 (UNIFIED-REUSABLE-COMPONENTS): extend shared primitives
 *
 * Author: PHASE-4-FRONTEND agent
 */

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
 Collapsible,
 CollapsibleContent,
 CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
 Activity,
 AlertTriangle,
 ArrowDownCircle,
 ArrowUpCircle,
 BarChart3,
 CheckCircle2,
 ChevronDown,
 Gauge,
 Layers,
 Minus,
 Shield,
 ShieldAlert,
 Target,
 TrendingDown,
 TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================

export interface PredictionCardTechnicalExplanation {
 summary?: string;
 candlestick?: string;
 smc?: string;
 volume?: string;
 patterns?: string;
 proofs?: string[];
 riskNote?: string;
}

export interface PredictionCardProps {
 ticker: string;
 name?: string;
 nameAr?: string;
 signal: string;
 signalAr?: string;
 entryPrice: number;
 targetPrice: number;
 stopLoss: number;
 riskReward?: number;
 confidence?: number;
 masterScore?: number;
 evidenceCount?: number;
 technicalExplanation?: PredictionCardTechnicalExplanation;
 onClick?: () => void;
 /** Show the collapsible technical explanation section (default: true). */
 showTechnical?: boolean;
 /** Compact mode — hides the technical section entirely, no expand button. */
 compact?: boolean;
 /** Optional right-aligned slot for caller-specific actions (share button, etc.). */
 actionSlot?: React.ReactNode;
 /** Optional extra row rendered under the price section (e.g. R/R breakdown). */
 footer?: React.ReactNode;
 /** Override default signal normalization (rare; auto-detected by default). */
 signalKind?: 'buy' | 'sell' | 'hold' | 'strong_buy';
 /** Optional rank badge content (e.g. "#1"). */
 rankBadge?: React.ReactNode;
 /** Optional className passthrough for the root Card. */
 className?: string;
}

// ============================================================
// Helpers
// ============================================================

type SignalKind = 'buy' | 'sell' | 'hold' | 'strong_buy';

function detectSignalKind(signal: string): SignalKind {
 const s = (signal || '').toUpperCase().trim();
 if (s === 'STRONG_BUY' || s === 'STRONG BUY' || s === 'ACCUMULATE') return 'strong_buy';
 if (s === 'BUY') return 'buy';
 if (s === 'HOLD' || s === 'WAIT') return 'hold';
 // SELL / STRONG_SELL / AVOID → treat as sell
 return 'sell';
}

const SIGNAL_STYLES: Record<
 SignalKind,
 {
 bg: string;
 text: string;
 border: string;
 icon: React.ReactNode;
 defaultLabelAr: string;
 }
> = {
 strong_buy: {
 bg: 'bg-profit /50',
 text: 'text-profit ',
 border: 'border-profit ',
 icon: <ArrowUpCircle className="h-3.5 w-3.5" />,
 defaultLabelAr: 'شراء قوي',
 },
 buy: {
 bg: 'bg-profit /40',
 text: 'text-success ',
 border: 'border-success dark:border-success',
 icon: <TrendingUp className="h-3.5 w-3.5" />,
 defaultLabelAr: 'شراء',
 },
 hold: {
 bg: 'bg-warning /40',
 text: 'text-warning ',
 border: 'border-warning ',
 icon: <Minus className="h-3.5 w-3.5" />,
 defaultLabelAr: 'احتفاظ',
 },
 sell: {
 bg: 'bg-loss /50',
 text: 'text-loss ',
 border: 'border-loss ',
 icon: <TrendingDown className="h-3.5 w-3.5" />,
 defaultLabelAr: 'بيع / تجنب',
 },
};

function formatPrice(v: number | null | undefined, digits = 2): string {
 if (v === null || v === undefined || Number.isNaN(v)) return '—';
 return Number(v).toLocaleString('en-US', {
 minimumFractionDigits: digits,
 maximumFractionDigits: digits,
 });
}

function formatPct(v: number | null | undefined, withSign = false, digits = 1): string {
 if (v === null || v === undefined || Number.isNaN(v)) return '—';
 const sign = withSign && v > 0 ? '+' : '';
 return `${sign}${Number(v).toFixed(digits)}%`;
}

function hasTechnical(t?: PredictionCardTechnicalExplanation): boolean {
 if (!t) return false;
 return Boolean(
 t.summary ||
 t.candlestick ||
 t.smc ||
 t.volume ||
 t.patterns ||
 (Array.isArray(t.proofs) && t.proofs.length > 0) ||
 t.riskNote,
 );
}

// ============================================================
// Component
// ============================================================

export function PredictionCard({
 ticker,
 name,
 nameAr,
 signal,
 signalAr,
 entryPrice,
 targetPrice,
 stopLoss,
 riskReward,
 confidence,
 masterScore,
 evidenceCount,
 technicalExplanation,
 onClick,
 showTechnical = true,
 compact = false,
 actionSlot,
 footer,
 signalKind,
 rankBadge,
 className,
}: PredictionCardProps) {
 const [open, setOpen] = useState(false);

 const kind: SignalKind = signalKind ?? detectSignalKind(signal);
 const style = SIGNAL_STYLES[kind] ?? SIGNAL_STYLES.buy;
 const isBuy = kind === 'buy' || kind === 'strong_buy';

 const entryNum = Number(entryPrice) || 0;
 const targetNum = Number(targetPrice) || 0;
 const stopNum = Number(stopLoss) || 0;

 // Optional upside/risk for BUY-style signals (entry→target & entry→stop)
 const upsidePct =
 entryNum > 0 && targetNum > 0
 ? ((targetNum - entryNum) / entryNum) * 100 * (isBuy ? 1 : -1)
 : null;
 const riskPct =
 entryNum > 0 && stopNum > 0
 ? Math.abs(((stopNum - entryNum) / entryNum) * 100)
 : null;

 const displaySignal = signalAr || style.defaultLabelAr;
 const showTechSection = showTechnical && !compact && hasTechnical(technicalExplanation);

 const interactive = typeof onClick === 'function';

 return (
 <Card
 className={cn(
 'relative overflow-hidden transition-all',
 interactive && 'cursor-pointer hover:shadow-md',
 className,
 )}
 onClick={onClick}
 role={interactive ? 'button' : undefined}
 tabIndex={interactive ? 0 : undefined}
 onKeyDown={
 interactive
 ? (e) => {
 if (e.key === 'Enter' || e.key === ' ') {
 e.preventDefault();
 onClick?.();
 }
 }
 : undefined
 }
 dir="rtl"
 >
 <CardContent className="p-4">
 {/* ===== Header: ticker + name + signal badge + rank + action slot ===== */}
 <div className="flex items-start justify-between gap-2 mb-3">
 <div className="flex items-center gap-2 min-w-0 flex-1">
 {rankBadge && (
 <div
 className={cn(
 'flex items-center justify-center w-7 h-7 rounded-full font-bold text-xs flex-shrink-0',
 style.bg,
 style.text,
 )}
 >
 {rankBadge}
 </div>
 )}
 <div className="min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <h3 className="text-base sm:text-lg font-bold truncate" dir="ltr">
 {ticker}
 </h3>
 <Badge
 variant="outline"
 className={cn('text-xs', style.bg, style.text, style.border)}
 >
 {style.icon}
 <span className="mr-1">{displaySignal}</span>
 </Badge>
 </div>
 {(nameAr || name) && (
 <p className="text-xs text-muted-foreground mt-0.5 truncate">
 {nameAr || name}
 </p>
 )}
 </div>
 </div>

 {actionSlot && (
 <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
 {actionSlot}
 </div>
 )}
 </div>

 {/* ===== Price grid: entry / target / stop ===== */}
 <div className="grid grid-cols-3 gap-2 text-center mb-3">
 <div className="rounded-lg bg-background/60 /30 p-2 border border-border/40">
 <div className="text-xs sm:text-xs text-muted-foreground">الدخول</div>
 <div className="font-bold text-sm tabular-nums" dir="ltr">
 {formatPrice(entryNum)}
 </div>
 </div>
 <div
 className={cn(
 'rounded-lg p-2 border',
 'bg-profit/60 /30 border-profit/60 /40',
 )}
 >
 <div className="text-xs sm:text-xs text-profit flex items-center justify-center gap-1">
 <Target className="h-3 w-3" />
 الهدف
 </div>
 <div
 className="font-bold text-sm text-profit tabular-nums"
 dir="ltr"
 >
 {formatPrice(targetNum)}
 </div>
 </div>
 <div
 className={cn(
 'rounded-lg p-2 border',
 'bg-loss/60 /30 border-loss/60 /40',
 )}
 >
 <div className="text-xs sm:text-xs text-loss flex items-center justify-center gap-1">
 <Shield className="h-3 w-3" />
 الوقف
 </div>
 <div
 className="font-bold text-sm text-loss tabular-nums"
 dir="ltr"
 >
 {formatPrice(stopNum)}
 </div>
 </div>
 </div>

 {/* ===== Metrics row: confidence / master score / R:R / evidence ===== */}
 <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs mb-2">
 {typeof confidence === 'number' && !Number.isNaN(confidence) && (
 <span className="flex items-center gap-1">
 <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-muted-foreground">الثقة:</span>
 <span
 className={cn(
 'font-bold tabular-nums',
 confidence >= 70
 ? 'text-profit '
 : confidence >= 50
 ? 'text-warning '
 : 'text-loss ',
 )}
 >
 {(confidence ?? 0).toFixed(0)}%
 </span>
 </span>
 )}

 {typeof masterScore === 'number' && !Number.isNaN(masterScore) && (
 <span className="flex items-center gap-1">
 <Activity className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-muted-foreground">النقاط:</span>
 <span className="font-bold tabular-nums">{(masterScore ?? 0).toFixed(0)}</span>
 </span>
 )}

 {typeof riskReward === 'number' && !Number.isNaN(riskReward) && riskReward > 0 && (
 <Badge
 variant="outline"
 className="text-xs font-mono font-bold border-profit text-profit "
 >
 R/R {(riskReward ?? 0).toFixed(2)}
 </Badge>
 )}

 {typeof evidenceCount === 'number' && evidenceCount > 0 && (
 <span className="flex items-center gap-1">
 <Layers className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-muted-foreground">الأدلة:</span>
 <span className="font-bold tabular-nums">{evidenceCount}</span>
 </span>
 )}

 {upsidePct !== null && (
 <span className="flex items-center gap-1 text-profit ">
 <ArrowUpCircle className="h-3.5 w-3.5" />
 <span className="font-semibold tabular-nums">{formatPct(upsidePct, true)}</span>
 <span className="text-muted-foreground">العائد المتوقع</span>
 </span>
 )}

 {riskPct !== null && (
 <span className="flex items-center gap-1 text-loss ">
 <ArrowDownCircle className="h-3.5 w-3.5" />
 <span className="font-semibold tabular-nums">-{(riskPct ?? 0).toFixed(1)}%</span>
 <span className="text-muted-foreground">المخاطرة</span>
 </span>
 )}
 </div>

 {/* ===== Optional caller-provided footer ===== */}
 {footer && <div className="mt-2">{footer}</div>}

 {/* ===== Risk note (if present, always visible — important warning) ===== */}
 {technicalExplanation?.riskNote && (
 <div className="mt-2 rounded-md border border-warning bg-warning/70 /30 p-2 flex items-start gap-2">
 <ShieldAlert className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
 <p className="text-xs text-warning ">
 {technicalExplanation.riskNote}
 </p>
 </div>
 )}

 {/* ===== Collapsible technical explanation section ===== */}
 {showTechSection && (
 <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
 <CollapsibleTrigger asChild>
 <button
 type="button"
 className="flex w-full items-center justify-between rounded-md bg-muted/50 hover:bg-muted/70 px-3 py-1.5 text-xs font-medium transition-colors"
 onClick={(e) => e.stopPropagation()}
 >
 <span className="flex items-center gap-1.5">
 <BarChart3 className="h-3.5 w-3.5" />
 التحليل الفني والأدلة
 </span>
 <ChevronDown
 className={cn(
 'h-3.5 w-3.5 transition-transform',
 open && 'rotate-180',
 )}
 />
 </button>
 </CollapsibleTrigger>
 <CollapsibleContent className="mt-2 space-y-2 text-xs text-muted-foreground">
 {technicalExplanation?.summary && (
 <p className="leading-relaxed text-foreground/90">
 {technicalExplanation.summary}
 </p>
 )}

 {technicalExplanation?.candlestick && (
 <div className="flex gap-1.5">
 <span className="font-semibold text-foreground/80 flex-shrink-0">
 الشموع اليابانية:
 </span>
 <span>{technicalExplanation.candlestick}</span>
 </div>
 )}

 {technicalExplanation?.smc && (
 <div className="flex gap-1.5">
 <span className="font-semibold text-foreground/80 flex-shrink-0">
 تحليل السيولة (SMC):
 </span>
 <span>{technicalExplanation.smc}</span>
 </div>
 )}

 {technicalExplanation?.volume && (
 <div className="flex gap-1.5">
 <span className="font-semibold text-foreground/80 flex-shrink-0">
 الحجم:
 </span>
 <span>{technicalExplanation.volume}</span>
 </div>
 )}

 {technicalExplanation?.patterns && (
 <div className="flex gap-1.5">
 <span className="font-semibold text-foreground/80 flex-shrink-0">
 الأنماط:
 </span>
 <span>{technicalExplanation.patterns}</span>
 </div>
 )}

 {Array.isArray(technicalExplanation?.proofs) &&
 technicalExplanation.proofs!.length > 0 && (
 <ul className="space-y-1 pr-4 list-disc">
 {technicalExplanation.proofs!.map((p, i) => (
 <li key={i} className="flex items-start gap-1">
 <CheckCircle2 className="h-3 w-3 text-profit mt-1 flex-shrink-0" />
 <span>{p}</span>
 </li>
 ))}
 </ul>
 )}

 {!technicalExplanation?.summary &&
 !technicalExplanation?.candlestick &&
 !technicalExplanation?.smc &&
 !technicalExplanation?.volume &&
 !technicalExplanation?.patterns &&
 (!Array.isArray(technicalExplanation?.proofs) ||
 technicalExplanation.proofs!.length === 0) && (
 <p className="text-muted-foreground/70 italic">
 لا تتوفر تفاصيل فنية إضافية.
 </p>
 )}
 </CollapsibleContent>
 </Collapsible>
 )}

 {/* ===== Compact mode hint when technical explanation exists but compact=true ===== */}
 {compact &&
 hasTechnical(technicalExplanation) &&
 !technicalExplanation?.riskNote && (
 <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
 <AlertTriangle className="h-3 w-3" />
 <span>يوجد تحليل فني مفصّل — استخدم الوضع الكامل لعرضه.</span>
 </div>
 )}
 </CardContent>
 </Card>
 );
}

export default PredictionCard;

/**
 * prediction-dashboard/desktopColumns.tsx
 * =======================================
 * The desktop `UnifiedTable` column definitions for the predictions table.
 *
 * Originally inlined as a `useMemo` block inside PredictionTrackingDashboard.tsx
 * (lines 845-1126, ~282 LOC). Extracted here as a pure factory function
 * `buildDesktopColumns(focusTickers, onSelectProof)` so the container stays
 * thin. Returns a `Column<LivePrediction>[]` ready to pass to UnifiedTable.
 *
 * Columns:
 *  1. ticker       — symbol + persona badge + focus/morning_bell/evidence badges
 *  2. entryDate    — formatted entry date
 *  3. entryPrice   — entry + stop loss
 *  4. targetPrice  — first target
 *  5. targetPrice2 — second target (or — if absent)
 *  6. currentPrice — current/exit price + execution date
 *  7. outcome      — official outcome badge (or TRAILING_PROFIT variant)
 *  8. liveOutcome  — dashed "معاينة" badge (only when PENDING + live data)
 *  9. returnPct    — formatted % with color
 * 10. highestPriceReached — high-water mark
 * 11. lowestPriceReached  — low-water mark
 * 12. maxProfitPct — direction-aware max profit %
 * 13. maxLossPct   — direction-aware max loss %
 * 14. daysSinceEntry — holding days
 * 15. proof        — "إثبات الصفقة 🔍" button
 */

'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, fmtPrice } from '@/lib/utils';
import type { Column } from '@/components/shared/UnifiedTable';
import {
 PERSONA_CONFIG,
 OUTCOME_CONFIG,
 TRAILING_PROFIT_CONFIG,
 LIVE_OUTCOME_CONFIG,
} from './constants';
import {
 isTrailingProfit,
 computeMaxProfitPct,
 computeMaxLossPct,
 computeLiveReturnPct,
 formatDateShort,
 computeHoldingDays,
 formatReturnPct,
} from './helpers';
import type { LivePrediction, FocusTickerInfo } from './types';

export function buildDesktopColumns(
 focusTickers: Record<string, FocusTickerInfo>,
 onSelectProof: (p: LivePrediction) => void,
): Column<LivePrediction>[] {
 return [
 {
 key: 'ticker',
 header: 'السهم والشخصية',
 align: 'right',
 width: 'min-w-[180px]',
 render: (p) => {
 const personaCfg = PERSONA_CONFIG[p.persona];
 return (
 <div className="flex flex-col gap-0.5">
 <div className="flex items-center gap-1.5 flex-wrap">
 <span className="font-mono font-black text-sm text-foreground">
 {p.ticker}
 </span>
 <Badge variant="outline" className={cn('text-xs py-0 px-1.5 font-bold', personaCfg.badgeBg)}>
 {personaCfg.emoji} {personaCfg.nameAr}
 </Badge>
 {focusTickers[p.ticker] && (
 <Badge className="bg-warning/15 text-warning border border-warning/20 text-xs py-0 px-1.5 font-bold whitespace-nowrap" title="مكرر في عدة شخصيات — إشارة قوية">
 🎯 تركيز ×{focusTickers[p.ticker].count}
 </Badge>
 )}
 {p.morning_bell && (
 <Badge className="bg-warning/20 text-warning border border-warning/20 text-xs py-0 px-1.5 font-bold whitespace-nowrap" title="جرس الصباح — أعلى ثقة وربحية متوقعة">
 🔔 جرس الصباح
 </Badge>
 )}
 {p.evidence_count != null && p.evidence_count > 0 && (
 <Badge variant="outline" className="text-xs py-0 px-1.5 font-bold text-profit border-profit/20 whitespace-nowrap" title="عدد الأدلة المتوافقة">
 ✅ {p.evidence_count}/6
 </Badge>
 )}
 </div>
 <span className="text-xs text-muted-foreground truncate max-w-[140px]">
 {p.nameAr || p.ticker}
 </span>
 </div>
 );
 },
 },
 {
 key: 'entryDate',
 header: 'تاريخ التوقع',
 align: 'right',
 width: 'min-w-[110px]',
 className: 'font-mono',
 render: (p) => (
 <div className="flex flex-col">
 <span className="text-xs text-muted-foreground">تاريخ التوقع</span>
 <span className="font-bold text-foreground text-xs">{formatDateShort(p.entryDate)}</span>
 </div>
 ),
 },
 {
 key: 'entryPrice',
 header: 'الأسعار (دخول/وقف)',
 align: 'right',
 width: 'min-w-[120px]',
 className: 'font-mono',
 render: (p) => (
 <div className="flex flex-col">
 <span className="font-bold text-foreground">📥 {fmtPrice(p.entryPrice)}</span>
 <span className="text-loss text-xs">🛑 {fmtPrice(p.stopLoss)}</span>
 </div>
 ),
 },
 {
 key: 'targetPrice',
 header: 'المستهدف الأول',
 align: 'right',
 width: 'min-w-[120px]',
 className: 'font-mono',
 render: (p) => (
 <div className="flex flex-col">
 <span className="text-xs text-muted-foreground">المستهدف الأول</span>
 <span className="text-profit font-bold">🎯 {fmtPrice(p.targetPrice)}</span>
 </div>
 ),
 },
 {
 key: 'targetPrice2',
 header: 'المستهدف الثاني',
 align: 'right',
 width: 'min-w-[120px]',
 className: 'font-mono',
 render: (p) => {
 const hasTarget2 = p.targetPrice2 != null && Number(p.targetPrice2) > 0;
 return (
 <div className="flex flex-col">
 <span className="text-xs text-muted-foreground">المستهدف الثاني</span>
 {hasTarget2 ? (
 <span className="text-whale font-bold">🎯 {fmtPrice(p.targetPrice2)}</span>
 ) : (
 <span className="text-muted-foreground font-bold">—</span>
 )}
 </div>
 );
 },
 },
 {
 key: 'currentPrice',
 header: 'السعر الحالي + تاريخ التنفيذ',
 align: 'right',
 width: 'min-w-[140px]',
 className: 'font-mono font-bold',
 render: (p) => {
 const isClosed = p.outcome !== 'PENDING';
 const lastPrice = isClosed ? p.exitPrice : p.currentPrice;
 const executionDate = p.executionDate || p.closedAt;
 return (
 <div className="flex flex-col">
 <span>{fmtPrice(lastPrice)}</span>
 <span className="text-xs text-muted-foreground font-normal">
 {executionDate ? `تنفيذ: ${formatDateShort(executionDate)}` : 'معلّقة ⏳'}
 </span>
 </div>
 );
 },
 },
 {
 key: 'outcome',
 header: 'الحالة الرسمية',
 align: 'right',
 width: 'min-w-[120px]',
 render: (p) => {
 const trailingProfit = isTrailingProfit(p);
 return trailingProfit ? (
 <Badge className={cn('text-xs font-bold whitespace-nowrap', TRAILING_PROFIT_CONFIG.badge)} title="السهم وصل لربح جزئي ثم ارتد — تم جني الأرباح قبل الهدف الكامل">
 {TRAILING_PROFIT_CONFIG.label}
 </Badge>
 ) : (
 <Badge className={cn('text-xs font-bold whitespace-nowrap', OUTCOME_CONFIG[p.outcome].badge)}>
 {OUTCOME_CONFIG[p.outcome].label}
 </Badge>
 );
 },
 },
 {
 key: 'liveOutcome',
 header: 'الحالة الحية (معاينة)',
 align: 'right',
 width: 'min-w-[120px]',
 render: (p) => {
 const isClosed = p.outcome !== 'PENDING';
 const liveOutcomeKey = p.liveOutcome ?? 'PENDING';
 const showLivePreview = !isClosed && p.liveOutcome != null && p.liveOutcome !== 'PENDING';
 const highest = Number(p.highestPriceReached ?? p.highest_price_reached ?? 0);
 const liveReturnPct = computeLiveReturnPct(p);
 const showLiveReturnBadge = !isClosed && liveReturnPct != null && highest > 0;
 if (isClosed) {
 return <span className="text-xs text-profit font-bold">✓ مؤكدة</span>;
 }
 if (showLiveReturnBadge) {
 return (
 <Badge
 className={cn(
 'text-xs font-bold whitespace-nowrap border border-dashed',
 liveReturnPct != null && liveReturnPct >= 0
 ? 'bg-warning/15 text-warning border-warning/20'
 : 'bg-loss/15 text-loss border-loss/20'
 )}
 title="العائد اللحظي من السعر الحالي (معاينة غير رسمية — لم تُقفل الصفقة بعد)"
 >
 معاينة: {liveReturnPct != null ? `${liveReturnPct >= 0 ? '+' : ''}${liveReturnPct.toFixed(2)}%` : '—'}
 </Badge>
 );
 }
 if (showLivePreview) {
 return (
 <Badge className={cn('text-xs font-bold whitespace-nowrap', LIVE_OUTCOME_CONFIG[liveOutcomeKey].badge)} title="الحالة الحية بناءً على السعر اللحظي (معاينة غير رسمية)">
 {LIVE_OUTCOME_CONFIG[liveOutcomeKey].label}
 </Badge>
 );
 }
 return <span className="text-xs text-muted-foreground">—</span>;
 },
 },
 {
 key: 'returnPct',
 header: 'العائد %',
 align: 'right',
 sortable: true,
 width: 'min-w-[100px]',
 className: 'font-mono font-black text-sm',
 render: (p) => {
 const ret = formatReturnPct(p.returnPct);
 return <span className={cn('font-mono font-black text-sm', ret.color)}>{ret.text}</span>;
 },
 },
 {
 key: 'highestPriceReached',
 header: 'أعلى سعر 📈',
 align: 'right',
 width: 'min-w-[100px]',
 className: 'font-mono',
 render: (p) => {
 const highest = Number(p.highestPriceReached ?? p.highest_price_reached ?? 0);
 return (
 <span className={cn('text-xs font-bold', highest > 0 ? 'text-profit ' : 'text-muted-foreground')}>
 {highest > 0 ? fmtPrice(highest) : '—'}
 </span>
 );
 },
 },
 {
 key: 'lowestPriceReached',
 header: 'أقل سعر 📉',
 align: 'right',
 width: 'min-w-[100px]',
 className: 'font-mono',
 render: (p) => {
 const lowest = Number(p.lowestPriceReached ?? p.lowest_price_reached ?? 0);
 return (
 <span className={cn('text-xs font-bold', lowest > 0 ? 'text-loss ' : 'text-muted-foreground')}>
 {lowest > 0 ? fmtPrice(lowest) : '—'}
 </span>
 );
 },
 },
 {
 key: 'maxProfitPct',
 header: 'أقصى ربح %',
 align: 'right',
 width: 'min-w-[100px]',
 className: 'font-mono',
 render: (p) => {
 const v = computeMaxProfitPct(p);
 if (v == null) return <span className="text-xs text-muted-foreground">—</span>;
 return (
 <span className={cn('text-xs font-bold', v >= 0 ? 'text-profit ' : 'text-muted-foreground')}>
 {v >= 0 ? '+' : ''}{(v ?? 0).toFixed(2)}%
 </span>
 );
 },
 },
 {
 key: 'maxLossPct',
 header: 'أقصى خسارة %',
 align: 'right',
 width: 'min-w-[100px]',
 className: 'font-mono',
 render: (p) => {
 const v = computeMaxLossPct(p);
 if (v == null) return <span className="text-xs text-muted-foreground">—</span>;
 return (
 <span className={cn('text-xs font-bold', v < 0 ? 'text-loss ' : 'text-muted-foreground')}>
 {v >= 0 ? '+' : ''}{(v ?? 0).toFixed(2)}%
 </span>
 );
 },
 },
 {
 key: 'daysSinceEntry',
 header: 'المدة',
 align: 'center',
 width: 'min-w-[70px]',
 className: 'font-mono font-bold',
 render: (p) => {
 const d = computeHoldingDays(p.entryDate, p.closedAt);
 return d != null ? `${d}d` : (p.daysSinceEntry != null ? `${p.daysSinceEntry}d` : '—');
 },
 },
 {
 key: 'proof',
 header: 'بطاقة الإثبات',
 align: 'center',
 width: 'min-w-[110px]',
 render: (p) => (
 <Button
 variant="ghost"
 size="sm"
 onClick={(e) => {
 e.stopPropagation();
 onSelectProof(p);
 }}
 className="h-7 text-xs text-profit hover:bg-profit/10 font-bold gap-1"
 >
 إثبات الصفقة 🔍
 </Button>
 ),
 },
 ];
}

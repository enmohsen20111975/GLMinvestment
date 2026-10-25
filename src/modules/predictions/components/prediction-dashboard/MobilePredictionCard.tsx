/**
 * prediction-dashboard/MobilePredictionCard.tsx
 * ============================================
 * Mobile card view for a single prediction row. Rendered for each item in
 * `filteredPredictions` when the viewport is < sm breakpoint (block sm:hidden).
 *
 * Shows ticker + persona badge + focus/morning_bell/evidence/who_is_buying/
 * hmm_regime badges + outcome badge (or TRAILING_PROFIT variant) + entry/stop/
 * target1/target2 grid + entry/execution date row + holding days + live preview
 * + highest/lowest prices + return %. Click opens the proof modal.
 *
 * Originally inlined at lines 1707-1914 of PredictionTrackingDashboard.tsx
 * (~207 LOC).
 */

'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn, fmtPrice } from '@/lib/utils';
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

interface MobilePredictionCardProps {
 pred: LivePrediction;
 idx: number;
 focusTickers: Record<string, FocusTickerInfo>;
 onSelectProof: (p: LivePrediction) => void;
}

export function MobilePredictionCard({
 pred,
 idx,
 focusTickers,
 onSelectProof,
}: MobilePredictionCardProps) {
 const ret = formatReturnPct(pred.returnPct);
 const isClosed = pred.outcome !== 'PENDING';
 const lastPrice = isClosed ? pred.exitPrice : pred.currentPrice;
 const personaCfg = PERSONA_CONFIG[pred.persona];
 // RL-FIX-6: live preview + second target + execution date
 const liveOutcomeKey = pred.liveOutcome ?? 'PENDING';
 const showLivePreview =
 !isClosed && pred.liveOutcome != null && pred.liveOutcome !== 'PENDING';
 const hasTarget2 =
 pred.targetPrice2 != null && Number(pred.targetPrice2) > 0;
 const executionDate = pred.executionDate || pred.closedAt;
 // FIX-5B: highest/lowest + maxProfit/maxLoss direction-aware + trailing_profit + live_return
 const highest = Number(pred.highestPriceReached ?? pred.highest_price_reached ?? 0);
 const lowest = Number(pred.lowestPriceReached ?? pred.lowest_price_reached ?? 0);
 const maxProfitPct = computeMaxProfitPct(pred);
 const maxLossPct = computeMaxLossPct(pred);
 const trailingProfit = isTrailingProfit(pred);
 const liveReturnPct = computeLiveReturnPct(pred);
 const showLiveReturnBadge =
 !isClosed && liveReturnPct != null && highest > 0;

 return (
 <div
 key={`mob-pred-${pred.ticker}-${idx}`}
 onClick={() => onSelectProof(pred)}
 className="p-3 hover:bg-muted/40 cursor-pointer space-y-2"
 >
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-1.5">
 <span className="font-mono font-black text-sm">{pred.ticker}</span>
 <Badge variant="outline" className={cn('text-xs py-0 px-1.5', personaCfg.badgeBg)}>
 {personaCfg.emoji} {personaCfg.nameAr}
 </Badge>
 {focusTickers[pred.ticker] && (
 <Badge className="bg-warning/15 text-warning border border-warning/20 text-xs py-0 px-1.5 font-bold" title="مكرر في عدة شخصيات — إشارة قوية">
 🎯 تركيز ×{focusTickers[pred.ticker].count}
 </Badge>
 )}
 {/* NEW: WHO IS BUYING badge */}
 {pred.who_is_buying_state && (
 <Badge className="bg-primary/15 text-primary border border-primary/20 text-xs py-0 px-1.5 font-bold whitespace-nowrap" title={pred.who_is_buying_state}>
 {pred.who_is_buying_state.includes('مؤسساتي') ? '🏦 مؤسساتي' : pred.who_is_buying_state.includes('أفراد') ? '👤 أفراد' : '⚪'}
 </Badge>
 )}
 {/* NEW: HMM regime badge */}
 {pred.hmm_regime_ar && (
 <Badge className="bg-primary/15 text-primary border border-purple-500/30 text-xs py-0 px-1.5 font-bold whitespace-nowrap" title={`HMM: ${pred.hmm_regime_ar}`}>
 🧠
 </Badge>
 )}
 {pred.morning_bell && (
 <Badge className="bg-warning/20 text-warning border border-warning/20 text-xs py-0 px-1.5 font-bold" title="جرس الصباح — أعلى ثقة وربحية متوقعة">
 🔔 جرس الصباح
 </Badge>
 )}
 {pred.evidence_count != null && pred.evidence_count > 0 && (
 <Badge variant="outline" className="text-xs py-0 px-1.5 text-profit border-profit/20 font-bold" title="عدد الأدلة المتوافقة">
 ✅ {pred.evidence_count}/6
 </Badge>
 )}
 </div>
 {/* FIX-5B: TRAILING_PROFIT badge بـ لون زمردي مميز عن WIN العادي */}
 {trailingProfit ? (
 <Badge className={cn('text-xs', TRAILING_PROFIT_CONFIG.badge)}>
 {TRAILING_PROFIT_CONFIG.label}
 </Badge>
 ) : (
 <Badge className={cn('text-xs', OUTCOME_CONFIG[pred.outcome].badge)}>
 {OUTCOME_CONFIG[pred.outcome].label}
 </Badge>
 )}
 </div>

 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span>{pred.nameAr || pred.ticker}</span>
 <span className="font-mono font-bold text-foreground">
 {formatDateShort(pred.entryDate)}
 </span>
 </div>

 {/* RL-FIX-6: 4-column grid (entry / target1 / target2 / stop) */}
 <div className="grid grid-cols-4 gap-1.5 bg-muted/30 p-2 rounded-lg text-xs font-mono">
 <div>
 <div className="text-xs text-muted-foreground">الدخول</div>
 <div className="font-bold">{fmtPrice(pred.entryPrice)}</div>
 </div>
 <div>
 <div className="text-xs text-muted-foreground">المستهدف ١</div>
 <div className="font-bold text-profit ">{fmtPrice(pred.targetPrice)}</div>
 </div>
 <div>
 <div className="text-xs text-muted-foreground">المستهدف ٢</div>
 {hasTarget2 ? (
 <div className="font-bold text-whale ">{fmtPrice(pred.targetPrice2)}</div>
 ) : (
 <div className="font-bold text-muted-foreground">—</div>
 )}
 </div>
 <div>
 <div className="text-xs text-muted-foreground">الوقف</div>
 <div className="font-bold text-loss ">{fmtPrice(pred.stopLoss)}</div>
 </div>
 </div>

 {/* RL-FIX-6: صف تواريخ التوقع + التنفيذ */}
 <div className="grid grid-cols-2 gap-2 bg-muted/20 p-2 rounded-lg text-xs font-mono">
 <div>
 <div className="text-xs text-muted-foreground">تاريخ التوقع</div>
 <div className="font-bold text-foreground">{formatDateShort(pred.entryDate)}</div>
 </div>
 <div>
 <div className="text-xs text-muted-foreground">تاريخ التنفيذ</div>
 <div className="font-bold text-foreground">
 {executionDate ? formatDateShort(executionDate) : 'معلّقة'}
 </div>
 </div>
 </div>

 {/* RL-FIX-6: مدة التداول + السعر الحالي */}
 <div className="grid grid-cols-2 gap-2 bg-muted/20 p-2 rounded-lg text-xs font-mono">
 <div>
 <div className="text-xs text-muted-foreground">مدة التداول</div>
 <div className="font-bold text-foreground">
 {(() => {
 const d = computeHoldingDays(pred.entryDate, pred.closedAt);
 return d != null ? `${d} يوم` : '—';
 })()}
 </div>
 </div>
 <div>
 <div className="text-xs text-muted-foreground">السعر الحالي/الإغلاق</div>
 <div className="font-bold text-foreground">{fmtPrice(lastPrice)}</div>
 </div>
 </div>

 {/* RL-FIX-6: الحالة الحية (معاينة) — تظهر فقط للصفقات المعلّقة الفعالة */}
 {showLivePreview && !showLiveReturnBadge && (
 <div className="flex items-center justify-between gap-2 bg-background/60 border border-dashed border-border rounded-lg p-2 text-xs">
 <span className="text-muted-foreground font-bold">الحالة الحية:</span>
 <Badge
 className={cn('text-xs font-bold', LIVE_OUTCOME_CONFIG[liveOutcomeKey].badge)}
 title="الحالة الحية بناءً على السعر اللحظي (معاينة غير رسمية)"
 >
 {LIVE_OUTCOME_CONFIG[liveOutcomeKey].label}
 </Badge>
 </div>
 )}

 {/* FIX-5B: _live_return للـ PENDING — اعرض badge بـ النسبة المئوية */}
 {showLiveReturnBadge && (
 <div className="flex items-center justify-between gap-2 bg-warning/5 border border-dashed border-warning/20 rounded-lg p-2 text-xs">
 <span className="text-muted-foreground font-bold">العائد اللحظي (معاينة):</span>
 <Badge
 className={cn(
 'text-xs font-bold whitespace-nowrap',
 liveReturnPct != null && liveReturnPct >= 0
 ? 'bg-warning/15 text-warning border border-warning/20'
 : 'bg-loss/15 text-loss border border-loss/20'
 )}
 title="العائد اللحظي من السعر الحالي (معاينة غير رسمية — لم تُقفل الصفقة بعد)"
 >
 معاينة: {liveReturnPct != null
 ? `${liveReturnPct >= 0 ? '+' : ''}${(liveReturnPct ?? 0).toFixed(2)}%`
 : '—'}
 </Badge>
 </div>
 )}

 {/* FIX-5B: highest/lowest + maxProfit/maxLoss — صف مختصر للموبايل */}
 {(highest > 0 || lowest > 0) && (
 <div className="grid grid-cols-2 gap-2 bg-muted/20 p-2 rounded-lg text-xs font-mono">
 <div>
 <div className="text-xs text-muted-foreground">أعلى سعر 📈</div>
 <div className="font-bold text-profit ">
 {highest > 0 ? fmtPrice(highest) : '—'}
 {maxProfitPct != null && (
 <span className="text-xs mr-1">
 ({maxProfitPct >= 0 ? '+' : ''}{(maxProfitPct ?? 0).toFixed(1)}%)
 </span>
 )}
 </div>
 </div>
 <div>
 <div className="text-xs text-muted-foreground">أقل سعر 📉</div>
 <div className="font-bold text-loss ">
 {lowest > 0 ? fmtPrice(lowest) : '—'}
 {maxLossPct != null && (
 <span className="text-xs mr-1">
 ({maxLossPct >= 0 ? '+' : ''}{(maxLossPct ?? 0).toFixed(1)}%)
 </span>
 )}
 </div>
 </div>
 </div>
 )}

 <div className="flex items-center justify-between pt-1 text-xs">
 <span className={cn('font-mono font-black', ret.color)}>
 العائد: {ret.text}
 </span>
 <span className="text-xs text-profit font-bold flex items-center gap-1">
 عرض بطاقة الإثبات 🔍
 </span>
 </div>
 </div>
 );
}

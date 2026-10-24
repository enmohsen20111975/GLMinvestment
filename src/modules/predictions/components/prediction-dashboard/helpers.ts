/**
 * prediction-dashboard/helpers.ts
 * ==============================
 * Pure utility functions for PredictionTrackingDashboard.
 *
 * Originally inlined at lines 251-499 of PredictionTrackingDashboard.tsx
 * (~250 LOC). Pure module — no React, no JSX, no hooks.
 *
 * Contents:
 *  - isTrailingProfit(p)      — exit_type === 'trailing_profit'? (FIX-5B)
 *  - computeMaxProfitPct(p)    — direction-aware max profit % (FIX-5B)
 *  - computeMaxLossPct(p)      — direction-aware max loss % (FIX-5B)
 *  - computeLiveReturnPct(p)  — live return % for PENDING (FIX-5B)
 *  - formatReturnPct(pct)     — format % with color class
 *  - formatProfitFactor(pf)   — format PF with ∞ for >= 999
 *  - formatDateShort(d, time) — dd/mm/yyyy [hh:mm]
 *  - computeHoldingDays(...)  — calendar days between entry and exit/now
 *  - generatePredictionsText(preds, data) — plain-text export generator
 *  - computeStatsFromPredictions(preds)   — recompute PersonaStats from filtered list (RL-FIX-13)
 */

import { fmtPrice } from '@/lib/utils';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';
import {
 PERSONA_CONFIG,
 OUTCOME_CONFIG,
 TRAILING_PROFIT_CONFIG,
 DAYS_OPTIONS,
} from './constants';
import type { LivePrediction, PersonaStats, LiveTrackingResponse } from './types';

// FIX-5B: helper — يحدد هل التوقع ده TRAILING_PROFIT (للـ status display).
// الـ data بتيجي من مسارين:
// 1. live-tracking (Python): exit_type field lowercase (e.g. 'trailing_profit').
// 2. honest-tracking/list (Node): exit_type field from DB (same lowercase).
export function isTrailingProfit(p: LivePrediction): boolean {
 const et = (p.exit_type || p.exitType || '').toString().toLowerCase().trim();
 return et === 'trailing_profit';
}

// FIX-5B: helper — يحسب أقصى ربح % بناءً على direction (BUY vs SELL).
// للـ BUY: (highest - entry) / entry × 100
// للـ SELL: (entry - lowest) / entry × 100 (لأن الـ SELL ربحه في نزول السعر)
export function computeMaxProfitPct(p: LivePrediction): number | null {
 const entry = Number(p.entryPrice || 0);
 if (!entry || entry <= 0) return null;
 const highest = Number(p.highestPriceReached ?? p.highest_price_reached ?? 0);
 const lowest = Number(p.lowestPriceReached ?? p.lowest_price_reached ?? 0);
 if (highest <= 0 && lowest <= 0) return null;
 const sigType = (p.signal || '').toString().toUpperCase();
 const isSell = sigType.includes('SELL');
 if (isSell) {
 // للـ SELL: الربح لما السعر ينزل → نستخدم lowest
 if (lowest <= 0) return null;
 return ((entry - lowest) / entry) * 100;
 }
 // للـ BUY: الربح لما السعر يطلع → نستخدم highest
 if (highest <= 0) return null;
 return ((highest - entry) / entry) * 100;
}

// FIX-5B: helper — يحسب أقصى خسارة % بناءً على direction (BUY vs SELL).
// للـ BUY: (lowest - entry) / entry × 100 (سالب)
// للـ SELL: (entry - highest) / entry × 100 (سالب لو highest > entry)
export function computeMaxLossPct(p: LivePrediction): number | null {
 const entry = Number(p.entryPrice || 0);
 if (!entry || entry <= 0) return null;
 const highest = Number(p.highestPriceReached ?? p.highest_price_reached ?? 0);
 const lowest = Number(p.lowestPriceReached ?? p.lowest_price_reached ?? 0);
 if (highest <= 0 && lowest <= 0) return null;
 const sigType = (p.signal || '').toString().toUpperCase();
 const isSell = sigType.includes('SELL');
 if (isSell) {
 // للـ SELL: الخسارة لما السعر يطلع → نستخدم highest
 if (highest <= 0) return null;
 return ((entry - highest) / entry) * 100; // سالب لو highest > entry
 }
 // للـ BUY: الخسارة لما السعر ينزل → نستخدم lowest
 if (lowest <= 0) return null;
 return ((lowest - entry) / entry) * 100; // سالب لو lowest < entry
}

// FIX-5B: helper — يحسب _live_return للـ PENDING (معاينة غير رسمية).
// لو outcome_date === null و highest_price_reached > 0:
// - احسب من current_price (إن وُجد) أو exitPrice أو last known price.
// - direction-aware: BUY = (current - entry)/entry, SELL = (entry - current)/entry.
// الـ return بـ يكون percentage. بـ يـ return null لو مفيش سعر متاح.
export function computeLiveReturnPct(p: LivePrediction): number | null {
 const entry = Number(p.entryPrice || 0);
 if (!entry || entry <= 0) return null;
 // لو مُقفلة رسمياً → الـ returnPct هو الرسمي، مش محتاجين نحسب live
 if (p.outcome !== 'PENDING') return null;
 const current = Number(p.currentPrice ?? p.exitPrice ?? 0);
 if (!current || current <= 0) return null;
 const sigType = (p.signal || '').toString().toUpperCase();
 const isSell = sigType.includes('SELL');
 if (isSell) {
 return ((entry - current) / entry) * 100;
 }
 return ((current - entry) / entry) * 100;
}

export function formatReturnPct(pct: number | null | undefined) {
 if (pct == null || isNaN(Number(pct))) return { text: '—', color: 'text-muted-foreground' };
 const n = Number(pct);
 if (n > 0) return { text: `+${(n ?? 0).toFixed(2)}%`, color: 'text-profit ' };
 if (n < 0) return { text: `${(n ?? 0).toFixed(2)}%`, color: 'text-loss ' };
 return { text: '0.00%', color: 'text-muted-foreground' };
}

export function formatProfitFactor(pf: number | null | undefined): string {
 if (pf == null || isNaN(Number(pf))) return '—';
 const n = Number(pf);
 if (n >= 999) return '∞';
 return (n ?? 0).toFixed(2);
}

// P0-v17: عرض تاريخ الدخول/التنفيذ بصيغة موجزة (dd/mm/yyyy) + الوقت إن وُجد
export function formatDateShort(d?: string | null, withTime = false): string {
 if (!d) return '—';
 try {
 const s = String(d).replace(' ', 'T');
 const dt = new Date(s);
 if (isNaN(dt.getTime())) return String(d).slice(0, 10);
 const dd = String(dt.getDate()).padStart(2, '0');
 const mm = String(dt.getMonth() + 1).padStart(2, '0');
 const yyyy = dt.getFullYear();
 if (withTime) {
 const hh = String(dt.getHours()).padStart(2, '0');
 const mi = String(dt.getMinutes()).padStart(2, '0');
 return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
 }
 return `${dd}/${mm}/${yyyy}`;
 } catch {
 return String(d).slice(0, 10);
 }
}

// P0-v17: حساب أيام التداول الفعلية بين تاريخين (entry → exit/now)
export function computeHoldingDays(entryDate?: string | null, closedAt?: string | null): number | null {
 if (!entryDate) return null;
 try {
 const start = new Date(String(entryDate).replace(' ', 'T'));
 if (isNaN(start.getTime())) return null;
 const end = closedAt ? new Date(String(closedAt).replace(' ', 'T')) : new Date();
 if (isNaN(end.getTime())) return null;
 const diff = Math.floor((end.getTime() - start.getTime()) / 86400000);
 return Math.max(0, diff);
 } catch {
 return null;
 }
}

// ─── Export text generator — builds shareable plain-text from the predictions table ─
export function generatePredictionsText(
 predictions: LivePrediction[],
 data: LiveTrackingResponse | null,
): string {
 if (!predictions.length) return '';
 const daysLabel = data?.daysWindow != null ? DAYS_OPTIONS.find((d) => d.value === data.daysWindow)?.label : '';
 const lines: string[] = [
 '📊 سجل أداء التوقعات — تتبع القصاعات بين الشخصيات',
 `📋 عدد الصفقات: ${predictions.length}${daysLabel ? ` | الفترة: ${daysLabel}` : ''}`,
 `🕒 آخر تحديث: ${data?.last_updated || '—'}`,
 '',
 ];
 predictions.forEach((p) => {
 const personaCfg = PERSONA_CONFIG[p.persona as keyof typeof PERSONA_CONFIG];
 const trailing = isTrailingProfit(p);
 const outcomeLabel = trailing
 ? TRAILING_PROFIT_CONFIG.label
 : OUTCOME_CONFIG[p.outcome as keyof typeof OUTCOME_CONFIG]?.label || p.outcome || '—';
 const lastPrice = !p.outcome || p.outcome === 'PENDING' ? p.currentPrice : p.exitPrice;
 const pct = p.returnPct != null ? (p.returnPct >= 0 ? '+' : '') + p.returnPct.toFixed(2) + '%' : '—';
 const holding = computeHoldingDays(p.entryDate, p.closedAt);
 lines.push(
 `• ${p.ticker} — ${p.nameAr || p.ticker}`,
 ` 🔥 الشخصية: ${personaCfg?.nameAr || p.persona}`,
 ` 📅 التاريخ: ${formatDateShort(p.entryDate)}`,
 ` 📥 دخول: ${fmtPrice(p.entryPrice)} ج.م | 🛑 وقف: ${fmtPrice(p.stopLoss)}`,
 ` 🎯 هدف 1: ${fmtPrice(p.targetPrice)} ج.م${p.targetPrice2 != null ? ` | 🎯 هدف 2: ${fmtPrice(p.targetPrice2)}` : ''}`,
 ` 💰 ${!p.outcome || p.outcome === 'PENDING' ? 'حالي' : 'نهائي'}: ${fmtPrice(lastPrice ?? 0)} ج.م`,
 ` 🏷️ الحالة: ${outcomeLabel} | 📈 العائد: ${pct}`,
 ` 📆 المدة: ${holding != null ? `${holding} يوم` : (p.daysSinceEntry != null ? `${p.daysSinceEntry} يوم` : '—')}`,
 );
 });
 lines.push('', '⚠️ هذا التحليل لأغراض تعليمية فقط — ليس نصيحة استثمارية', OFFICIAL_LINKS_BLOCK);
 return lines.join('\n');
}

// RL-FIX-13: أعِد حساب الإحصائيات من قائمة توقعات مفلترة (بدلاً من استخدام stats الـ backend
// اللي بتعكس كل التوقعات بما فيها الضعيفة). دي الدالة اللي بتخلي الـ KPI cards والـ persona
// cards يتحدثوا مع تغيير فلتر الجودة.
export function computeStatsFromPredictions(preds: LivePrediction[]): PersonaStats {
 let wins = 0, losses = 0, expired = 0, pending = 0;
 let winReturnsSum = 0; // مجموع عوائد الصفقات الرابحة (موجب)
 let lossReturnsSum = 0; // مجموع عوائد الصفقات الخاسرة (سالب)
 for (const p of preds) {
 const ret = Number(p.returnPct || 0);
 if (p.outcome === 'WIN') {
 // Constitution Rule 7 (HARD cap): تجاهل العوائد السامة |ret| > 50% اللي بتلوث المتوسطات والـ PF.
 if (Math.abs(ret) > 50) continue;
 wins++;
 winReturnsSum += ret;
 } else if (p.outcome === 'LOSS') {
 if (Math.abs(ret) > 50) continue;
 losses++;
 lossReturnsSum += ret; // ret سالب للخسائر
 } else if (p.outcome === 'EXPIRED') {
 expired++;
 } else if (p.outcome === 'PENDING') {
 pending++;
 }
 }
 const settled = wins + losses;
 const total = preds.length;
 const winRate = settled > 0 ? (wins / settled) * 100 : 0;
 const avgWinPct = wins > 0 ? winReturnsSum / wins : 0;
 const avgLossPct = losses > 0 ? lossReturnsSum / losses : 0; // سالب
 const profitFactor = lossReturnsSum < 0
 ? winReturnsSum / Math.abs(lossReturnsSum)
 : (winReturnsSum > 0 ? 999 : 0);
 const closedCount = settled;
 const netReturn = winReturnsSum + lossReturnsSum; // صافي الربح/الخسارة
 const grossProfit = winReturnsSum; // إجمالي الأرباح (موجب)
 const grossLoss = lossReturnsSum; // إجمالي الخسائر (سالب)
 const validLosses = preds
 .map(p => Number(p.returnPct ?? (p as any).actual_return ?? (p as any).pnl_pct))
 .filter(r => !isNaN(r) && r < 0);
 const maxLoss = validLosses.length > 0 ? Math.min(...validLosses) : 0; // أقصى خسارة (أكثر قيمة سالبة)
 const rrRatio = avgLossPct < 0 ? avgWinPct / Math.abs(avgLossPct) : 0; // متوسط الربح ÷ متوسط الخسارة
 return { total, wins, losses, pending, settled, winRate, avgWinPct, avgLossPct, profitFactor, closedCount, expired, netReturn, grossProfit, grossLoss, maxLoss, rrRatio };
}

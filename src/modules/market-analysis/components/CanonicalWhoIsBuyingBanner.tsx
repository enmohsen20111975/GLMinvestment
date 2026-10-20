'use client';

/**
 * CanonicalWhoIsBuyingBanner.tsx
 * ===============================================================================
 *
 * بانر محرك القرار المؤسسي V60.2 — مطابق لمنطق Pine Script:
 * data/pine_scripts/EGX_Pro_Institutional_Engine_V60_2_Who_Is_Buying (1).pine
 *
 * المصدر الكنسي (Rule 73 SINGLE-DISPLAY-SOURCE):
 * /api/stocks/[ticker]/unified ← getUnifiedStockData()
 *
 * ما يعرضه (كل القيم من المحرك الموحّد — لا حساب مالي في الواجهة):
 * 1. WHO IS BUYING? — prediction.who_is_buying (mirror Pine L669-763)
 * "🏦 شراء مؤسساتي محتمل" / "👤 شراء أفراد محتمل" / "مختلط" إلخ
 * 2. الإشارة الكنسية — canonical.signal + canonical.signal_ar (78/65/55/40/25)
 * 3. master_score — canonical.master_score (0-100) + source badge (fresh vs prediction)
 * 4. تحليل السيولة — canonical.money_flow (5 مستويات، مطابق Pine L353-366)
 * 5. حالة التجميع/التصريف — canonical.accumulation (مطابق maker_state)
 * 6. مرحلة السهم — canonical.phase (تجميع/تصاعد/توزيع/تخفيض/محايد)
 * 7. مستويات الدخول/الهدف/الوقف — prediction.entry/target/target_2/target_3/stop_loss
 * 8. R:R + الثقة — prediction.risk_reward + prediction.confidence
 * 9. التعليق التحليلي العربي — prediction.analysis_reason (مطابق Pine L919-951)
 * 10. RSI + ATR الكنسي — technical.rsi (Wilder) + technical.atr
 * 11. HMM Regime — prediction.hmm_regime (إضافة unified-only)
 *
 * Rule 27 NO-FAKE-DATA: لو أي حقل = null → نعرض "— بيانات غير متاحة" (مش HOLD كاذب).
 * ===============================================================================
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
 Building2,
 User,
 Users2,
 TrendingUp,
 TrendingDown,
 Minus,
 Activity,
 Target,
 ShieldAlert,
 Gauge,
 Sparkles,
 Waves,
 Layers,
 AlertTriangle,
} from 'lucide-react';
import type { UnifiedStockData } from '@/lib/unified-stock-data';

interface Props {
 data: UnifiedStockData;
 currencyLabel?: string;
}

// ─── خريطة ألوان الإشارة الكنسية (مطابقة Pine L895) ─────────────────────────
const SIGNAL_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
 STRONG_BUY: { bg: 'bg-profit', text: 'text-foreground', border: 'border-profit', icon: <TrendingUp className="w-4 h-4" /> },
 BUY: { bg: 'bg-profit/10', text: 'text-profit ', border: 'border-profit ', icon: <TrendingUp className="w-4 h-4" /> },
 ACCUMULATE: { bg: 'bg-whale/10', text: 'text-whale ', border: 'border-whale ', icon: <Layers className="w-4 h-4" /> },
 HOLD: { bg: 'bg-warning/10', text: 'text-warning ', border: 'border-warning ', icon: <Minus className="w-4 h-4" /> },
 REDUCE: { bg: 'bg-warning/10', text: 'text-warning ', border: 'border-orange-300 dark:border-orange-700', icon: <TrendingDown className="w-4 h-4" /> },
 SELL: { bg: 'bg-loss/10', text: 'text-loss ', border: 'border-loss ', icon: <TrendingDown className="w-4 h-4" /> },
 STRONG_SELL:{ bg: 'bg-loss', text: 'text-foreground', border: 'border-loss', icon: <TrendingDown className="w-4 h-4" /> },
};

// ─── خريطة WHO IS BUYING (مطابقة Pine L742-761) ─────────────────────────────
function getWhoIsBuyingStyle(state: string | null): { bg: string; text: string; icon: React.ReactNode; label: string } {
 if (!state) {
 // P0 FIX: AlertCircle → AlertTriangle (مطابق للاستيراد في lucide)
 return { bg: 'bg-muted', text: 'text-muted-foreground', icon: <AlertTriangle className="w-4 h-4" />, label: '— بيانات غير متاحة' };
 }
 const s = state.toLowerCase();
 if (s.includes('مؤسس') && s.includes('شراء')) {
 return { bg: 'bg-profit/10', text: 'text-profit ', icon: <Building2 className="w-4 h-4" />, label: state };
 }
 if (s.includes('مؤسس') && (s.includes('بيع') || s.includes('تصريف'))) {
 return { bg: 'bg-loss/10', text: 'text-loss ', icon: <Building2 className="w-4 h-4" />, label: state };
 }
 if (s.includes('أفراد') && s.includes('شراء')) {
 return { bg: 'bg-sky-100 dark:bg-sky-900/40', text: 'text-sky-700 dark:text-sky-300', icon: <User className="w-4 h-4" />, label: state };
 }
 if (s.includes('أفراد') && (s.includes('بيع'))) {
 return { bg: 'bg-warning/10', text: 'text-warning ', icon: <User className="w-4 h-4" />, label: state };
 }
 if (s.includes('مختلط') && (s.includes('شراء') || s.includes('ميل شرائي'))) {
 return { bg: 'bg-whale/10', text: 'text-whale ', icon: <Users2 className="w-4 h-4" />, label: state };
 }
 if (s.includes('مختلط') && (s.includes('بيع') || s.includes('ميل بيعي'))) {
 return { bg: 'bg-warning/10', text: 'text-warning ', icon: <Users2 className="w-4 h-4" />, label: state };
 }
 return { bg: 'bg-muted', text: 'text-muted-foreground', icon: <Users2 className="w-4 h-4" />, label: state };
}

// ─── خريطة Money Flow (مطابقة Pine L353-366) ────────────────────────────────
const MONEY_FLOW_STYLES: Record<string, string> = {
 'سيولة داخلة قوية': 'bg-profit text-white',
 'سيولة داخلة': 'bg-profit text-profit/40 ',
 'متوازنة': 'bg-warning text-warning/40 ',
 'سيولة خارجة': 'bg-loss text-loss/40 ',
 'سيولة خارجة قوية': 'bg-loss text-white',
};

export function CanonicalWhoIsBuyingBanner({ data, currencyLabel = 'ج.م' }: Props) {
 const { canonical, prediction, technical, stock, radar } = data;

 // ⚠️ CRITICAL FIX (CONFLICT-AVOIDANCE, 2026-10-07):
 // كان البانر يعرض canonical.signal + master_score، لكن هذه تأتي أحيانًا من
 // fresh_technical_score (TS-side computation) وليس من V40.2 الحقيقي (Python).
 // هذا سبب تضارب: البانر يقول "شراء 70/100" بينما InstitutionalDecisionPanel
 // يقول "تجنب 35/100" (من Python /api/v2/chart/full-analysis).
 //
 // الحل: البانر لا يعرض signal/score إطلاقًا. يعرض فقط:
 // - who_is_buying (من predictions.db — فريد، لا يعرضه InstitutionalDecisionPanel)
 // - analysis_reason (من predictions.db — فريد)
 // - money_flow / accumulation / phase (من buy_pct — بيانات سيولة، ليست قرارًا)
 // - entry/target/stop (من predictions.db — لو متوفرة)
 //
 // القرار النهائي (BUY/HOLD/SELL) يُعرض في InstitutionalDecisionPanel بالأسفل
 // (من Python V40.2 الكامل مع Kill Filters + 6 proofs).
 const isFreshPrediction = canonical.master_score_source === 'prediction_db_fresh';
 const whoStyle = getWhoIsBuyingStyle(prediction?.who_is_buying ?? null);

 // مستويات الدخول/الهدف/الوقف (من predictions.db فقط — لا fabrication)
 const entry = prediction?.entry_price ?? null;
 const tp1 = prediction?.target_price ?? null;
 const tp2 = prediction?.target_price_2 ?? null;
 const tp3 = prediction?.target_price_3 ?? null;
 const stop = prediction?.stop_loss ?? null;
 const rr = prediction?.risk_reward ?? null;
 const confidence = prediction?.confidence ?? null;

 // RSI + ATR (كنسي Wilder)
 const rsi = technical.rsi;
 const atr = technical.atr;

 // buy_pct / sell_pct من radar cache (أو fresh candle colors)
 const buyPct = canonical.buy_pct;
 const sellPct = canonical.sell_pct;

 // current price (كنسي)
 const price = stock.current_price ?? null;

 // لو لا يوجد توقع طازج → اعرض بانر مبسّط (لا signal، لا levels — فقط تحذير)
 if (!isFreshPrediction || !prediction) {
 return (
 <div className="mb-3 rounded-xl border-2 border-warning/20 bg-warning/10 /10 p-3">
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <AlertTriangle className="w-4 h-4 text-warning" />
 <span className="font-bold text-warning ">
 لا يوجد توقع طازج من V40.2 (≤ 48 ساعة)
 </span>
 </div>
 <p className="text-xs text-muted-foreground mt-1">
 القرار النهائي يُحسب لحظيًا في لوحة &quot;محرك القرار المؤسسي&quot; بالأسفل (Python V40.2 + Kill Filters).
 لا نعرض signal هنا لتجنب التضارب مع المحرك الحقيقي.
 </p>
 </div>
 );
 }

 return (
 <div className="mb-3 rounded-xl border-2 border-sky-500/40 bg-gradient-to-l from-sky-50 via-card to-profit dark:from-sky-950/20 dark:via-card /20 overflow-hidden shadow-sm">
 {/* ─── Header: العنوان + إحالة للقرار النهائي ─── */}
 <div className="px-4 py-3 border-b border-sky-500/20 bg-sky-100/40 dark:bg-sky-900/15 flex items-center justify-between gap-3 flex-wrap">
 <div className="flex items-center gap-2">
 <span className="text-xs font-bold tracking-[0.15em] uppercase text-sky-700 dark:text-sky-300">
 🏛️ من يشتري؟ (Who Is Buying)
 </span>
 <span className="text-xs text-muted-foreground">
 (من predictions.db — V40.2 الكنسي)
 </span>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant="outline" className="text-xs font-bold px-2 py-0.5 bg-profit text-profit border-profit">
 <Sparkles className="w-3 h-3 ml-0.5" />
 توقع طازج
 </Badge>
 <span className="text-xs text-muted-foreground">
 ↩️ القرار النهائي في &quot;محرك القرار المؤسسي&quot; بالأسفل
 </span>
 </div>
 </div>

 {/* ─── WHO IS BUYING? (العنوان الرئيسي — مطابق Pine L669-763) ─── */}
 <div className="px-4 py-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
 {/* WHO IS BUYING */}
 <div className="lg:col-span-2 p-3 rounded-lg bg-card/60 /40 border border-sky-500/20">
 <div className="flex items-center gap-2 mb-2">
 <span className="text-xs font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wider">
 👥 من يشتري؟
 </span>
 <span className="text-xs text-muted-foreground">(تقدير من حجم/استمرارية/امتصاص/VWAP/MFI)</span>
 </div>
 <div className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-sm', whoStyle.bg, whoStyle.text)}>
 {whoStyle.icon}
 <span>{whoStyle.label}</span>
 </div>
 {/* buy_pct / sell_pct bar (إن وُجدا) */}
 {(buyPct !== null || sellPct !== null) && (
 <div className="mt-2">
 <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
 <span>شراء: <strong className="font-mono text-profit">{buyPct !== null ? `${(buyPct ?? 0).toFixed(1)}%` : '—'}</strong></span>
 <span>بيع: <strong className="font-mono text-loss">{sellPct !== null ? `${(sellPct ?? 0).toFixed(1)}%` : '—'}</strong></span>
 </div>
 <div className="h-2 rounded-full overflow-hidden bg-loss/10 flex">
 {buyPct !== null && (
 <div className="h-full bg-gradient-to-l from-profit to-profit" style={{ width: `${Math.min(100, Math.max(0, buyPct))}%` }} />
 )}
 </div>
 </div>
 )}
 {/* net flow (إن وُجد في radar) */}
 {radar && radar.net_flow_egp !== null && (
 <div className="mt-1.5 text-xs text-muted-foreground">
 صافي التدفق:{' '}
 <strong className={cn('font-mono', radar.net_flow_egp >= 0 ? 'text-profit' : 'text-loss')}>
 {radar.net_flow_egp >= 0 ? '+' : ''}{(radar.net_flow_egp / 1e6).toFixed(2)}M {currencyLabel}
 </strong>
 {radar.buy_value_m !== null && radar.sell_value_m !== null && (
 <span className="text-muted-foreground/70">
 {' '}(شراء {(radar.buy_value_m ?? 0).toFixed(1)}M · بيع {(radar.sell_value_m ?? 0).toFixed(1)}M)
 </span>
 )}
 </div>
 )}
 </div>

 {/* Money Flow + Phase */}
 <div className="p-3 rounded-lg bg-card/60 /40 border border-profit/20 space-y-2">
 <div>
 <div className="text-xs font-bold text-profit uppercase tracking-wider mb-1 flex items-center gap-1">
 <Waves className="w-3 h-3" /> تدفق السيولة
 </div>
 <Badge
 className={cn(
 'text-xs font-bold px-2 py-0.5 rounded-full border-0',
 MONEY_FLOW_STYLES[canonical.money_flow] ?? 'bg-muted text-muted-foreground'
 )}
 >
 {canonical.money_flow}
 </Badge>
 </div>
 <div>
 <div className="text-xs font-bold text-profit uppercase tracking-wider mb-1 flex items-center gap-1">
 <Layers className="w-3 h-3" /> المرحلة
 </div>
 <Badge variant="outline" className="text-xs font-bold px-2 py-0.5 rounded-full">
 {canonical.phase}
 </Badge>
 </div>
 </div>
 </div>

 {/* ─── مستويات الدخول / الأهداف / الوقف (كنسي من predictions.db) ─── */}
 {(entry !== null || tp1 !== null || stop !== null) && (
 <div className="px-4 py-3 border-t border-profit/20 bg-card/40 /20">
 <div className="text-xs font-bold text-profit uppercase tracking-wider mb-2 flex items-center gap-1">
 <Target className="w-3 h-3" /> مستويات الصفقة
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
 <LevelCell label="الدخول" value={entry} currencyLabel={currencyLabel} color="text-foreground" />
 <LevelCell label="الهدف 1" value={tp1} currencyLabel={currencyLabel} color="text-profit" />
 <LevelCell label="الهدف 2" value={tp2} currencyLabel={currencyLabel} color="text-profit" />
 <LevelCell label="الهدف 3" value={tp3} currencyLabel={currencyLabel} color="text-profit" />
 <LevelCell label="الوقف" value={stop} currencyLabel={currencyLabel} color="text-loss" icon={<ShieldAlert className="w-3 h-3" />} />
 <LevelCell label="R:R" value={rr !== null ? `${(rr ?? 0).toFixed(2)}R` : null} currencyLabel="" color="text-foreground" icon={<Gauge className="w-3 h-3" />} />
 </div>
 {confidence !== null && (
 <div className="mt-2 text-xs text-muted-foreground">
 الثقة: <strong className="font-mono text-foreground">{(confidence ?? 0).toFixed(0)}%</strong>
 {price !== null && entry !== null && entry > 0 && (
 <span className="ml-3">
 السعر الحالي: <strong className="font-mono text-foreground">{(price ?? 0).toFixed(2)} {currencyLabel}</strong>
 {Math.abs(price - entry) / entry > 0.001 && (
 <span className={cn('font-mono ml-1', price > entry ? 'text-profit' : 'text-loss')}>
 ({price > entry ? '+' : ''}{(((price - entry) / entry) * 100).toFixed(2)}%)
 </span>
 )}
 </span>
 )}
 </div>
 )}
 </div>
 )}

 {/* ─── المؤشرات الفنية الكنسية (RSI Wilder + ATR) ─── */}
 <div className="px-4 py-2 border-t border-profit/20 flex items-center gap-3 flex-wrap text-xs">
 <span className="font-bold text-profit uppercase tracking-wider flex items-center gap-1">
 <Activity className="w-3 h-3" /> مؤشرات كنسية
 </span>
 <span className="text-muted-foreground">
 RSI (14, Wilder): <strong className="font-mono text-foreground">{rsi !== null ? (rsi ?? 0).toFixed(1) : '—'}</strong>
 <span className="text-muted-foreground/60 ml-1">[{technical.rsi_source}]</span>
 </span>
 <span className="text-muted-foreground">
 ATR: <strong className="font-mono text-foreground">{atr !== null ? (atr ?? 0).toFixed(3) : '—'}</strong>
 </span>
 {technical.support !== null && (
 <span className="text-muted-foreground">
 دعم: <strong className="font-mono text-profit">{(technical.support ?? 0).toFixed(2)}</strong>
 </span>
 )}
 {technical.resistance !== null && (
 <span className="text-muted-foreground">
 مقاومة: <strong className="font-mono text-loss">{(technical.resistance ?? 0).toFixed(2)}</strong>
 </span>
 )}
 {prediction?.hmm_regime && (
 <span className="text-muted-foreground">
 HMM: <strong className="font-mono text-foreground">{prediction.hmm_regime}</strong>
 </span>
 )}
 {radar?.under_microscope && (
 <Badge className="bg-warning text-warning/40 text-xs font-bold px-2 py-0.5 rounded-full border-0">
 🔬 تحت المجهر
 </Badge>
 )}
 </div>

 {/* ─── التعليق التحليلي العربي (مطابق Pine L919-951 analysis_reason) ─── */}
 {prediction?.analysis_reason && (
 <div className="px-4 py-2.5 border-t border-profit/20 bg-profit/10 /15">
 <div className="text-xs font-bold text-profit uppercase tracking-wider mb-1 flex items-center gap-1">
 <Sparkles className="w-3 h-3" /> التعليق التحليلي
 </div>
 <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">
 {prediction.analysis_reason}
 </p>
 </div>
 )}
 </div>
 );
}

// ─── مكون مساعد: خلية مستوى سعري ─────────────────────────────────────────────
function LevelCell({
 label,
 value,
 currencyLabel,
 color,
 icon,
}: {
 label: string;
 value: number | null;
 currencyLabel: string;
 color: string;
 icon?: React.ReactNode;
}) {
 return (
 <div className="flex flex-col gap-0.5 p-1.5 rounded bg-card/80 /60 border border-border/40">
 <span className="text-xs text-muted-foreground flex items-center gap-0.5">
 {icon}
 {label}
 </span>
 <span className={cn('font-mono font-bold text-xs', color)}>
 {value !== null && value !== undefined
 ? `${typeof value === 'number' ? (value ?? 0).toFixed(2) : value}${currencyLabel ? ' ' + currencyLabel : ''}`
 : '— بيانات غير متاحة'}
 </span>
 </div>
 );
}

'use client';

import React, { forwardRef, useMemo, useState } from 'react';
import { MARKET_NAMES_AR, MarketType } from '@/lib/store';
import {
 Collapsible,
 CollapsibleTrigger,
 CollapsibleContent,
} from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { PredictionCard } from '@/components/shared/PredictionCard';

export interface TechnicalExplanation {
 summary?: string | null;
 candlestick?: string | null;
 smc?: string | null;
 volume?: string | null;
 patterns?: string | null;
 proofs?: string[] | null;
 risk_note?: string | null;
 full_text?: string | null;
 compact_text?: string | null;
 [key: string]: any;
}

export interface PredictionPick {
 ticker: string;
 name?: string;
 name_ar?: string;
 current_price?: number;
 entry_price?: number;
 target_price?: number;
 stop_loss?: number;
 profit_loss_percent?: number;
 status?: string;
 hit_target?: boolean;
 hit_stop_loss?: boolean;
 prediction_date?: string;
 signal?: string | number;
 signal_ar?: string;
 confidence?: number;
 master_score?: number;
 logo_url?: string;
// TASK-C: AI technical fields
 ai_reason?: string | null;
 ai_narrative?: string | null;
 technical_explanation?: TechnicalExplanation | null;
}

export interface PredictionsImageCardProps {
 market: MarketType;
 stocks: PredictionPick[];
 lastUpdate?: string;
 winRate?: number;
 avgPnl?: number;
 hits?: number;
 /**
 * MERGE-PREDICTION-CARDS: optional expert badge.
 * When provided, renders a "🎯 {expertName}" pill in the header so the same
 * canonical card can serve as the ExpertPredictionsImageCard.
 */
 expertName?: string;
 /**
 * MERGE-PREDICTION-CARDS: optional persona badge.
 * Accepts the same persona keys as the original PersonaImageCard.
 */
 persona?: 'investor' | 'gambler';
 /**
 * MERGE-PREDICTION-CARDS: custom label for the persona badge
 * (defaults to "المستثمر" / "المضارب" based on `persona`).
 */
 personaLabel?: string;
}

const MARKET_FLAGS: Record<MarketType, string> = {
 EGX: '🇪🇬',
 TADAWUL: '🇸🇦',
 KSE: '🇰🇼',
 QSE: '🇶🇦',
 US: '🇺🇸',
 CRYPTO: '🪙',
};

/**
 * Map a tracked pick's status to a canonical signal kind.
 * PredictionsImageCard is a status-tracking card (post-prediction), so the
 * "signal" displayed is the original BUY/SELL signal paired with the outcome.
 */
function deriveSignalFromPick(p: PredictionPick): {
 signal: string;
 signalAr?: string;
} {
 if (p.signal) {
 const s = String(p.signal).toUpperCase();
 return { signal: s, signalAr: p.signal_ar };
 }
 // Fallback: infer from status
 const status = (p.status || '').toUpperCase();
 if (status.includes('PROFIT') || status.includes('TARGET_HIT')) {
 return { signal: 'BUY', signalAr: p.signal_ar || 'شراء' };
 }
 if (status.includes('LOSS') || status.includes('STOPPED')) {
 return { signal: 'SELL', signalAr: p.signal_ar || 'بيع' };
 }
 return { signal: 'HOLD', signalAr: p.signal_ar || 'احتفاظ' };
}

function statusOutcome(p: PredictionPick): {
 label: string;
 cls: string;
} | null {
 const status = (p.status || '').toUpperCase();
 const entry = p.entry_price || p.current_price || 0;
 const current = p.current_price || entry;
 const isHit =
 status === 'TARGET_HIT' ||
 status === 'CLOSED_PROFIT' ||
 p.hit_target ||
 (p.target_price !== undefined && current >= p.target_price);
 const isStopped =
 status === 'STOPPED' ||
 status === 'CLOSED_LOSS' ||
 p.hit_stop_loss ||
 (p.stop_loss !== undefined && current <= p.stop_loss);

 if (isHit) {
 return {
 label: '🎯 صفقة مكتملة',
 cls: 'bg-profit text-white',
 };
 }
 if (isStopped) {
 return {
 label: '🛑 ضربت الوقف',
 cls: 'bg-loss text-white',
 };
 }
 if (status === 'PENDING' || status === 'OPEN' || (!isHit && !isStopped && entry > 0)) {
 return {
 label: '⏳ صفقة مستمرة',
 cls: 'bg-sky-100 text-sky-700 border border-sky-300',
 };
 }
 return null;
}

function computePnl(p: PredictionPick): number {
 if (p.profit_loss_percent !== undefined && p.profit_loss_percent !== null) {
 return p.profit_loss_percent;
 }
 const entry = p.entry_price || 0;
 const current = p.current_price || entry;
 if (entry > 0) {
 return ((current - entry) / entry) * 100;
 }
 return 0;
}

export const PredictionsImageCard = forwardRef<
 HTMLDivElement,
 PredictionsImageCardProps
>(function PredictionsImageCard(
 { market, stocks, lastUpdate, winRate, avgPnl, hits: hitsProp, expertName, persona, personaLabel },
 ref,
) {
 const [techOpen, setTechOpen] = useState(false);

 // MERGE-PREDICTION-CARDS: compute optional mode badge (expert or persona).
 // Rendered as a small pill in the header so a single canonical card can
 // serve Predictions / ExpertPredictions / Persona contexts.
 const modeBadge = expertName
 ? `🎯 ${expertName}`
 : persona
 ? persona === 'investor'
 ? `🏦 ${personaLabel || 'المستثمر'}`
 : `🎯 ${personaLabel || 'المضارب'}`
 : null;

 const stats = useMemo(() => {
 if (stocks.length === 0) {
 return { total: 0, hits: 0, winRate: 0, avgPnl: 0, top: [] as PredictionPick[] };
 }
 const computedHits =
 hitsProp !== undefined
 ? hitsProp
 : stocks.filter(
 (s) =>
 s.status === 'TARGET_HIT' ||
 s.status === 'CLOSED_PROFIT' ||
 s.hit_target ||
 (s.profit_loss_percent != null && s.profit_loss_percent > 0),
 ).length;
 const total = stocks.length;
 const computedWinRate = total > 0 ? (computedHits / total) * 100 : 0;

 let pnlSum = 0;
 stocks.forEach((s) => {
 pnlSum += computePnl(s);
 });
 const computedAvgPnl =
 avgPnl !== undefined ? avgPnl : total > 0 ? pnlSum / total : 0;
 const top = stocks.slice(0, 50);
 return { total, hits: computedHits, winRate: computedWinRate, avgPnl: computedAvgPnl, top };
 }, [stocks, winRate, avgPnl, hitsProp]);

 const now = new Date();
 const dateStr = now.toLocaleDateString('ar-EG', {
 weekday: 'long',
 year: 'numeric',
 month: 'long',
 day: 'numeric',
 });
 const timeStr = now.toLocaleTimeString('ar-EG', {
 hour: '2-digit',
 minute: '2-digit',
 });

const accentDark = '#0f766e'; // Teal/emerald theme

 // TASK-C: Collect stocks that have any technical explanation data
 const techStocks = useMemo(() => {
 return stats.top.filter((s) => {
 const te = s.technical_explanation;
 if (te && typeof te === 'object' && Object.keys(te).length > 0) return true;
 if (s.ai_narrative && String(s.ai_narrative).trim()) return true;
 if (s.ai_reason && String(s.ai_reason).trim()) return true;
 return false;
 });
 }, [stats.top]);

 return (
 <div
 ref={ref}
 dir="rtl"
 lang="ar"
 style={{
 width: 850,
 maxWidth: 850,
 fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', 'Arial', sans-serif",
 background:
 'linear-gradient(135deg, #f0fdf4 0%, #e6fffa 50%, #ccfbf1 100%)',
 color: '#1c1917',
 borderRadius: 20,
 overflow: 'hidden',
 boxShadow: '0 10px 40px rgba(13, 148, 136, 0.18)',
 border: '1px solid #99f6e4',
 }}
 >
 {/* HEADER */}
 <div
 style={{
 background:
 'linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #115e59 100%)',
 padding: '20px 28px',
 color: '#fff',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'space-between',
 gap: 16,
 }}
 >
 <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img
 src="/logo-square.png"
 alt="شعار دليل الاستثمار"
 width={56}
 height={56}
 style={{
 width: 56,
 height: 56,
 borderRadius: 12,
 background: '#fff',
 objectFit: 'contain',
 border: '2px solid rgba(255,255,255,0.4)',
 }}
 crossOrigin="anonymous"
 />
 <div style={{ display: 'flex', flexDirection: 'column' }}>
 <span
 style={{
 fontSize: 22,
 fontWeight: 800,
 lineHeight: 1.1,
 letterSpacing: 0.2,
 }}
 >
 🏆 نتائج وتوثيق دقة التحليلات الفنية والمالية
 </span>
 <span style={{ fontSize: 12, opacity: 0.9, marginTop: 3 }}>
 إثبات وتوثيق مباشر لنسب الربح والصفقات المكتملة — {MARKET_NAMES_AR[market]} {MARKET_FLAGS[market]}
 </span>
 </div>
 </div>

 <div
 style={{
 textAlign: 'left',
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'flex-end',
 gap: 4,
 }}
 >
 {modeBadge && (
 <span
 style={{
 background: 'rgba(255,255,255,0.22)',
 border: '1px solid rgba(255,255,255,0.35)',
 padding: '5px 12px',
 borderRadius: 999,
 fontSize: 12,
 fontWeight: 800,
 whiteSpace: 'nowrap',
 }}
 >
 {modeBadge}
 </span>
 )}
 <span
 style={{
 background: 'rgba(255,255,255,0.2)',
 padding: '6px 14px',
 borderRadius: 999,
 fontSize: 13,
 fontWeight: 700,
 whiteSpace: 'nowrap',
 }}
 >
 📅 {dateStr}
 </span>
 <span style={{ fontSize: 11, opacity: 0.85 }}>
 🕐 {timeStr}
 {lastUpdate ? ` · آخر تحديث: ${lastUpdate}` : ''}
 </span>
 </div>
 </div>

 {/* STATS OVERALL BAR */}
 <div
 style={{
 padding: '16px 28px',
 display: 'grid',
 gridTemplateColumns: 'repeat(4, 1fr)',
 gap: 12,
 }}
 >
 <div
 style={{
 background: '#ffffff',
 borderRadius: 12,
 padding: '12px 14px',
 textAlign: 'center',
 border: '1px solid #ccfbf1',
 boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
 }}
 >
 <div style={{ fontSize: 11, color: '#57534e', marginBottom: 2, fontWeight: 600 }}>إجمالي الصفقات</div>
 <div style={{ fontSize: 20, fontWeight: 800, color: '#0f766e', lineHeight: 1.1 }}>{stats.total}</div>
 </div>
 <div
 style={{
 background: '#ffffff',
 borderRadius: 12,
 padding: '12px 14px',
 textAlign: 'center',
 border: '1px solid #bbf7d0',
 boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
 }}
 >
 <div style={{ fontSize: 11, color: '#57534e', marginBottom: 2, fontWeight: 600 }}>حققت الهدف 🎯</div>
 <div style={{ fontSize: 20, fontWeight: 800, color: '#16a34a', lineHeight: 1.1 }}>{stats.hits}</div>
 </div>
 <div
 style={{
 background: '#ffffff',
 borderRadius: 12,
 padding: '12px 14px',
 textAlign: 'center',
 border: '1px solid #bbf7d0',
 boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
 }}
 >
 <div style={{ fontSize: 11, color: '#57534e', marginBottom: 2, fontWeight: 600 }}>نسبة الدقة والنجاح</div>
 <div style={{ fontSize: 20, fontWeight: 800, color: '#15803d', lineHeight: 1.1 }}>
 {(stats.winRate ?? 0).toFixed(0)}%
 </div>
 </div>
 <div
 style={{
 background: stats.avgPnl >= 0 ? '#f0fdf4' : '#fef2f2',
 borderRadius: 12,
 padding: '12px 14px',
 textAlign: 'center',
 border: stats.avgPnl >= 0 ? '1px solid #86efac' : '1px solid #fca5a5',
 boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
 }}
 >
 <div style={{ fontSize: 11, color: '#57534e', marginBottom: 2, fontWeight: 600 }}>متوسط الربح المحقق</div>
 <div style={{ fontSize: 20, fontWeight: 800, color: stats.avgPnl >= 0 ? '#15803d' : '#b91c1c', lineHeight: 1.1 }}>
 {stats.avgPnl >= 0 ? `+${(stats.avgPnl ?? 0).toFixed(2)}%` : `${(stats.avgPnl ?? 0).toFixed(2)}%`}
 </div>
 </div>
 </div>

 {/* STOCKS LIST — migrated to shared PredictionCard */}
 <div style={{ padding: '0 28px 20px' }}>
 {stats.top.length === 0 ? (
 <div
 style={{
 padding: '24px 10px',
 textAlign: 'center',
 color: '#a8a29e',
 fontSize: 14,
 background: '#ffffff',
 borderRadius: 14,
 border: '1px solid #ccfbf1',
 }}
 >
 لا توجد صفقات متاحة حالياً
 </div>
 ) : (
 <div
 style={{
 display: 'grid',
 gridTemplateColumns: 'repeat(2, 1fr)',
 gap: 10,
 }}
 >
 {stats.top.map((s, i) => {
 const { signal, signalAr } = deriveSignalFromPick(s);
 const pnl = computePnl(s);
 const outcome = statusOutcome(s);

 return (
 <PredictionCard
 key={`img-pick-${s.ticker}-${i}`}
 ticker={s.ticker}
 name={s.name}
 nameAr={s.name_ar}
 signal={signal}
 signalAr={signalAr}
 entryPrice={s.entry_price || s.current_price || 0}
 targetPrice={s.target_price || 0}
 stopLoss={s.stop_loss || 0}
 confidence={s.confidence}
 masterScore={s.master_score}
 compact
 showTechnical={false}
 rankBadge={`#${i + 1}`}
 className="border-whale/60 /40 bg-white/90"
 footer={
 <div className="flex items-center justify-between gap-2 text-xs">
 <span className="text-muted-foreground">
 السعر الحالي:{' '}
 <span className="font-mono font-semibold text-foreground">
 {(s.current_price || 0).toLocaleString('en-US', {
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 })}
 </span>
 </span>
 <span
 className={`inline-flex items-center px-2 py-0.5 rounded font-bold text-xs ${
 pnl > 0
 ? 'bg-profit text-profit'
 : pnl < 0
 ? 'bg-loss text-loss'
 : 'bg-zinc-100 text-zinc-600'
 }`}
 >
 {pnl > 0 ? '+' : ''}
 {(pnl ?? 0).toFixed(2)}%
 </span>
 {outcome && (
 <span
 className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${outcome.cls}`}
 >
 {outcome.label}
 </span>
 )}
 </div>
 }
 />
 );
 })}
 </div>
 )}
 </div>

 {/* TASK-C: Technical Analysis Section (collapsible) */}
 {techStocks.length > 0 && (
 <div style={{ padding: '0 28px 18px' }}>
 <Collapsible open={techOpen} onOpenChange={setTechOpen}>
 <CollapsibleTrigger asChild>
 <button
 type="button"
 style={{
 width: '100%',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'space-between',
 padding: '12px 16px',
 background: techOpen ? '#0f766e' : '#ffffff',
 color: techOpen ? '#ffffff' : '#0f766e',
 border: '1px solid #99f6e4',
 borderRadius: 12,
 cursor: 'pointer',
 fontSize: 14,
 fontWeight: 700,
 fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', 'Arial', sans-serif",
 transition: 'background 0.15s',
 }}
 >
 <span>📝 التحليل الفني ({techStocks.length} سهم)</span>
 <ChevronDown
 style={{
 width: 18,
 height: 18,
 transform: techOpen ? 'rotate(180deg)' : 'none',
 transition: 'transform 0.15s',
 }}
 />
 </button>
 </CollapsibleTrigger>
 <CollapsibleContent>
 <div
 style={{
 marginTop: 8,
 display: 'flex',
 flexDirection: 'column',
 gap: 10,
 }}
 >
 {techStocks.map((s, i) => (
 <TechExplanationBlock key={`tech-${s.ticker}-${i}`} stock={s} />
 ))}
 </div>
 </CollapsibleContent>
 </Collapsible>
 </div>
 )}

 {/* FOOTER */}
 <div
 style={{
 background: 'linear-gradient(135deg, #134e4a 0%, #0f766e 100%)',
 color: '#e6fffa',
 padding: '14px 28px 10px',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'space-between',
 gap: 12,
 flexWrap: 'wrap',
 }}
 >
 <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img
 src="/logo.png"
 alt="شعار"
 width={28}
 height={16}
 style={{ height: 16, width: 'auto', opacity: 0.9 }}
 crossOrigin="anonymous"
 />
 <span style={{ fontSize: 13, fontWeight: 700 }}>منصة دليل الاستثمار</span>
 <span style={{ opacity: 0.5 }}>|</span>
 <span style={{ fontSize: 12, opacity: 0.9 }}>invist.m2y.net</span>
 </div>
 <span
 style={{
 fontSize: 10,
 opacity: 0.8,
 maxWidth: 460,
 textAlign: 'left',
 lineHeight: 1.4,
 }}
 >
 ⚠️ نتائج وتوقعات صادرة عن المحرك التحليلي المالي لأغراض الاسترشاد والتتبع التلقائي للنتائج.
 </span>
 </div>

 {/* OFFICIAL LINKS FOOTER */}
 <div
 style={{
 background: 'linear-gradient(135deg, #064e3b 0%, #0f766e 100%)',
 color: '#ffffff',
 padding: '10px 28px',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'space-between',
 gap: 8,
 fontSize: 11,
 borderTop: '1px solid rgba(255,255,255,0.15)',
 fontWeight: 600,
 }}
 >
 <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
 <span>🌐 invist.m2y.net</span>
 <span>📱 تطبيق أندرويد: com.egx.investment</span>
 <span>✈️ t.me/Arabian_investment_guide</span>
 </div>
 <span style={{ fontSize: 10, opacity: 0.9, background: 'rgba(255,255,255,0.18)', padding: '2px 8px', borderRadius: 4 }}>
 التقرير الرسمي المعتمد 🌐
 </span>
 </div>
 </div>
 );
});

/* ------------------------------------------------------------------ */
/* TASK-C: TechExplanationBlock subcomponent */
/* Renders one stock's technical explanation in the collapsible area */
/* ------------------------------------------------------------------ */

function TechExplanationBlock({ stock }: { stock: PredictionPick }) {
 const te = stock.technical_explanation;
 const hasStructured = te && typeof te === 'object'
 && (te.summary || te.candlestick || te.smc || te.volume || te.patterns
 || (Array.isArray(te.proofs) && te.proofs.length > 0) || te.risk_note || te.full_text);
 const narrative = stock.ai_narrative || null;
 const reason = stock.ai_reason || null;

 // Fallback: only narrative/reason available — show plain text
 if (!hasStructured && (narrative || reason)) {
 return (
 <div
 style={{
 background: '#ffffff',
 border: '1px solid #ccfbf1',
 borderRadius: 12,
 padding: '12px 14px',
 fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', 'Arial', sans-serif",
 }}
 >
 <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
 <span style={{ fontWeight: 800, color: '#0f766e', fontSize: 13 }}>
 {stock.name_ar || stock.name || stock.ticker}
 </span>
 <span style={{ fontSize: 10, color: '#78716c', fontFamily: 'monospace' }}>
 ({stock.ticker})
 </span>
 </div>
 {reason && (
 <div style={{ fontSize: 12, color: '#1c1917', fontWeight: 600, marginBottom: 4 }}>
 {reason}
 </div>
 )}
 {narrative && (
 <div style={{ fontSize: 11.5, color: '#44403c', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
 {narrative}
 </div>
 )}
 </div>
 );
 }

 if (!hasStructured) return null;

 const proofs: string[] = Array.isArray(te!.proofs) ? te!.proofs.filter((p) => typeof p === 'string' && p.trim()) : [];

 return (
 <div
 style={{
 background: '#ffffff',
 border: '1px solid #ccfbf1',
 borderRadius: 12,
 padding: '12px 14px',
 fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', 'Arial', sans-serif",
 }}
 >
 <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
 <span style={{ fontWeight: 800, color: '#0f766e', fontSize: 13 }}>
 {stock.name_ar || stock.name || stock.ticker}
 </span>
 <span style={{ fontSize: 10, color: '#78716c', fontFamily: 'monospace' }}>
 ({stock.ticker})
 </span>
 </div>

 <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
 {te!.summary && (
 <Line label="" value={te!.summary} bold color="#0f766e" />
 )}
 {te!.candlestick && (
 <Line label="🕯️ الشموع اليابانية" value={te!.candlestick} />
 )}
 {te!.smc && (
 <Line label="🐋 تحليل SMC" value={te!.smc} />
 )}
 {te!.volume && (
 <Line label="📊 السيولة والحجم" value={te!.volume} />
 )}
 {te!.patterns && (
 <Line label="📐 الأنماط الفنية" value={te!.patterns} />
 )}
 {proofs.length > 0 && (
 <div>
 <div style={{ fontSize: 11, fontWeight: 700, color: '#57534e', marginBottom: 3 }}>
 ✅ الأدلة الفنية:
 </div>
 <ul style={{ margin: 0, paddingInlineStart: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
 {proofs.map((p, i) => (
 <li key={i} style={{ fontSize: 11, color: '#1c1917', lineHeight: 1.5 }}>
 {p}
 </li>
 ))}
 </ul>
 </div>
 )}
 {te!.risk_note && (
 <div
 style={{
 marginTop: 4,
 padding: '6px 10px',
 background: '#fef2f2',
 border: '1px solid #fecaca',
 borderRadius: 8,
 fontSize: 11,
 color: '#b91c1c',
 fontWeight: 600,
 }}
 >
 ⚠️ {te!.risk_note}
 </div>
 )}
 </div>
 </div>
 );
}

function Line({
 label, value, bold = false, color = '#1c1917',
}: { label: string; value: string; bold?: boolean; color?: string }) {
 if (!value) return null;
 return (
 <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
 {label && (
 <span style={{ fontSize: 10, fontWeight: 700, color: '#57534e' }}>{label}</span>
 )}
 <span
 style={{
 fontSize: bold ? 12.5 : 11.5,
 color,
 fontWeight: bold ? 700 : 400,
 lineHeight: 1.55,
 }}
 >
 {value}
 </span>
 </div>
 );
}

'use client';

/**
 * InstitutionalDecisionPanel — لوحة القرار المؤسسي
 * =======================================================
 * محرك القرار المؤسسي (نظام تحليل متعدد المراحل)
 *
 * لوحة قرار موحّدة بتجمع كل المحركات في مكان واحد:
 * 1. القرار النهائي + Tech Score
 * 2. حالة الطيران (طائر / واقع / عرضي)
 * 3. حركة الميكرز (تجميع / تصريف / هدوء)
 * 4. القيمة العادلة (VWAP) — غالي / عادل / رخيص (ديناميكي)
 * 5. الإثباتات الستة (Proofs) — V39 أضفنا إثبات القوة النسبية:
 * - إثبات 1: الترند
 * - إثبات 2: الميكرز
 * - إثبات 3: البصمة
 * - إثبات 4: الأساسي
 * - إثبات 5: القطاع
 * - إثبات 6: القوة النسبية للمؤشر العام (V39 NEW)
 * 6. خطة التداول (Entry / SL / TP1 / TP2 / R:R) — ديناميكي
 * 7. مدير المحفظة (نصيحة حسب المركز المفتوح)
 * 8. التوقع بالعربي
 * 9. التقييم والتعلم الذاتي (V39 NEW):
 * - حالة الضبط (model_quality)
 * - نسبة النجاح (win_rate)
 * - معامل الربحية (profit_factor)
 * - حد الشراء الديناميكي (dynamic_thresh)
 *
 * المستخدم يقدر يدخل بيانات مركزه (entry_price + qty) ويشوف نصيحة فورية.
 */

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
 Rocket, TrendingDown, Moon, Activity, Fish, Shield, Target,
 AlertTriangle, CheckCircle2, XCircle, Clock, Brain,
 TrendingUp, DollarSign, Scale, RefreshCw, ChevronDown,
 BarChart3, Zap, Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { getTrialStatus } from '@/lib/subscription-gate';

// ───────── Types ─────────
export interface MakerState {
 state: 'absorption' | 'distribution' | 'calm';
 state_ar: string;
 emoji: string;
 score_impact: number;
 reason?: string;
 signals?: string[];
 vol_ratio?: number;
 vsa_absorption?: boolean;
 sweep_bullish?: boolean;
 sweep_bearish?: boolean;
 no_supply?: boolean;
 no_demand?: boolean;
 volume_surge?: boolean;
}

export interface FlightState {
 state: 'flying_up' | 'falling_down' | 'coiling' | 'sideways';
 state_ar: string;
 emoji: string;
 color: string;
 reason?: string;
 broke_resist?: boolean;
 broke_support?: boolean;
 is_expanding?: boolean;
 is_squeeze?: boolean;
 volume_surge?: boolean;
}

export interface Proof {
 id: number;
 name: string;
 name_ar: string;
 passed: boolean;
 emoji: string;
 text: string;
 detail?: string;
 score_impact: number;
}

export interface PortfolioAdvice {
 action: string;
 color: string;
 pnl_pct: number;
 pnl_value: number;
 entry_price: number;
 entry_qty: number;
 current_price: number;
 exit_type: 'stop_loss' | 'partial_sell' | 'scale_in' | 'trail' | 'watch' | 'hold';
 exit_pct: number;
 stop_loss: number;
}

export interface RiskProfile {
 entry: number;
 sl: number;
 tp1: number;
 tp2: number;
 rr_ratio_tp1: number;
 rr_ratio_tp2: number;
}

export interface BacktestSummary {
 win_rate: number;
 profit_factor: number;
 total_trades: number;
 winning_trades: number;
 net_return: number;
 win_rate_text: string;
 pf_text: string;
}

export interface InstitutionalDecision {
 ticker?: string;
 current_price?: number;
 ready: boolean;
 error?: string;
 maker_state: MakerState;
 flight_state: FlightState;
 proofs: Proof[];
 tech_score: number;
 signal_final: string;
 path_taken: string;
 signal_color: string;
 portfolio_advice: PortfolioAdvice | null;
 fair_value: number;
 fair_premium: number;
 fair_state: string;
 risk_profile: RiskProfile;
 prediction_ar: string;
 rsi_status: string;
 adaptive_ob: number;
 // V39 new fields
 backtest?: BacktestSummary;
 dynamic_thresh?: number;
 dynamic_thresh_reason?: string;
 model_quality?: string;
 quality_color?: string;
 dynamic_sl_mult?: number;
 dynamic_rr1?: number;
 outperforming_market?: boolean;
 dna_target_price?: number | null;
 version?: string;
}

interface InstitutionalDecisionPanelProps {
 decision: InstitutionalDecision | null;
 ticker: string;
 currencyLabel?: string;
 /** Callback لما المستخدم يحدّث بيانات مركزه (entry_price + qty) */
 onPositionUpdate?: (entryPrice: number, entryQty: number) => void;
}

// ───────── Helper: color maps ─────────
const signalColorMap: Record<string, string> = {
 purple: 'bg-primary text-white border-purple-600',
 lime: 'bg-lime-500 text-black border-lime-600',
 green: 'bg-profit text-white border-profit',
 yellow: 'bg-warning text-black border-warning',
 orange: 'bg-warning text-white border-orange-600',
 red: 'bg-loss text-white border-loss',
 gray: 'bg-slate-400 text-foreground border-slate-500',
};

const flightIconMap: Record<string, React.ElementType> = {
 flying_up: Rocket,
 falling_down: TrendingDown,
 coiling: Activity,
 sideways: Moon,
};

const flightColorMap: Record<string, string> = {
 flying_up: 'text-lime-500 bg-lime-500/10 border-lime-500/30',
 falling_down: 'text-loss bg-loss/10 border-loss/20',
 coiling: 'text-warning bg-warning/10 border-warning/20',
 sideways: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};

const makerColorMap: Record<string, string> = {
 absorption: 'text-profit bg-profit/10 border-profit/20',
 distribution: 'text-loss bg-loss/10 border-loss/20',
 calm: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};

const adviceColorMap: Record<string, string> = {
 red: 'border-loss/20 bg-loss/10 text-loss ',
 orange: 'border-orange-500/40 bg-warning/10 text-warning ',
 yellow: 'border-warning/20 bg-warning/10 text-warning ',
 green: 'border-profit/20 bg-profit/10 text-profit ',
};

const qualityColorMap: Record<string, string> = {
 lime: 'text-lime-500',
 orange: 'text-warning',
 gray: 'text-slate-400',
 red: 'text-loss',
};

// ───────── Component ─────────
export function InstitutionalDecisionPanel({
 decision,
 ticker,
 currencyLabel = 'ج.م',
 onPositionUpdate,
}: InstitutionalDecisionPanelProps) {
 const [showPositionForm, setShowPositionForm] = useState(false);
 const [entryPriceInput, setEntryPriceInput] = useState('');
 const [entryQtyInput, setEntryQtyInput] = useState('');

 // PAYWALL Gate 1: fair value locked for free users post-trial
 const subscriptionUser = useAppStore((s) => s.user);
 const fairValueSubStatus = getTrialStatus(subscriptionUser);
 const fairValueLocked = fairValueSubStatus.isFreeUser && fairValueSubStatus.isTrialExpired;

 if (!decision || !decision.ready) {
 return (
 <Card className="border-purple-500/30 bg-gradient-to-br from-slate-950/80 to-purple-950/30">
 <CardContent className="p-3 text-xs text-center text-muted-foreground">
 محرك القرار المؤسسي غير متاح لهذا السهم
 </CardContent>
 </Card>
 );
 }

 const {
 maker_state,
 flight_state,
 proofs = [],
 tech_score,
 signal_final,
 path_taken,
 signal_color,
 portfolio_advice,
 fair_value,
 fair_premium,
 fair_state,
 risk_profile,
 prediction_ar,
 rsi_status,
 adaptive_ob,
 current_price,
 // V39 fields
 backtest,
 dynamic_thresh,
 dynamic_thresh_reason,
 model_quality,
 quality_color,
 dynamic_sl_mult,
 dynamic_rr1,
 outperforming_market,
 dna_target_price,
 version,
 } = decision;

 // Tech Score gauge (0-100) — لون حسب الدرجة
 const scoreColor =
 tech_score >= 75 ? 'text-profit' :
 tech_score >= 60 ? 'text-lime-500' :
 tech_score >= 40 ? 'text-warning' :
 tech_score >= 25 ? 'text-warning' :
 'text-loss';

 const scoreBg =
 tech_score >= 75 ? 'from-profit/20 to-profit/10 border-profit/20' :
 tech_score >= 60 ? 'from-lime-500/20 to-lime-600/10 border-lime-500/40' :
 tech_score >= 40 ? 'from-warning/20 to-warning/10 border-warning/20' :
 tech_score >= 25 ? 'from-orange-500/20 to-orange-600/10 border-orange-500/40' :
 'from-loss/20 to-loss/10 border-loss/20';

 const FlightIcon = flightIconMap[flight_state?.state] || Moon;
 const adviceClass = portfolio_advice ? adviceColorMap[portfolio_advice.color] : '';

 // V39: عدد الإثباتات الناجحة
 const proofsPassed = proofs.filter(p => p.passed).length;
 const proofsTotal = proofs.length || 6;

 const handleApplyPosition = () => {
 const price = parseFloat(entryPriceInput);
 const qty = parseFloat(entryQtyInput);
 if (isNaN(price) || price <= 0) {
 return;
 }
 onPositionUpdate?.(price, isNaN(qty) ? 0 : qty);
 setShowPositionForm(false);
 };

 // Proof detail tooltip
 const renderProof = (proof: Proof) => (
 <div
 key={proof.id}
 className={cn(
 'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-xs transition-colors',
 proof.passed
 ? 'border-profit/20 bg-profit/5'
 : proof.score_impact < 0
 ? 'border-loss/20 bg-loss/5'
 : 'border-slate-500/20 bg-slate-500/5'
 )}
 title={proof.detail || ''}
 >
 <div className="flex items-center gap-1.5 min-w-0">
 <span className="text-sm flex-shrink-0">{proof.emoji}</span>
 <span className="text-muted-foreground truncate font-sans">{proof.name_ar}</span>
 </div>
 <div className="flex items-center gap-1 flex-shrink-0">
 <span className={cn(
 'font-bold text-xs',
 proof.score_impact > 0 ? 'text-profit' :
 proof.score_impact < 0 ? 'text-loss' : 'text-slate-400'
 )}>
 {proof.score_impact > 0 ? '+' : ''}{proof.score_impact}
 </span>
 </div>
 </div>
 );

 return (
 <div
 id={`institutional-decision-${ticker}`}
 dir="rtl"
 className="rounded-xl border border-border bg-card text-card-foreground shadow-sm overflow-hidden"
 >
 {/* ─── Header ─── */}
 <div className="px-3 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Brain className="w-4 h-4 text-primary" />
 <h3 className="text-[13px] font-black text-foreground">
 محرك القرار المؤسسي
 <span className="text-xs text-muted-foreground font-normal mr-1.5">{version || 'V39'} · Full Dynamic Adaptive</span>
 </h3>
 </div>
 <div className="flex items-center gap-1.5">
 <Badge variant="secondary" className="text-xs font-mono">
 {ticker}
 </Badge>
 {/* V39: عدد الإثباتات */}
 <Badge className={cn(
 'text-xs border font-mono',
 proofsPassed >= 4 ? 'bg-profit/20 text-profit border-profit/20' :
 proofsPassed >= 2 ? 'bg-warning/20 text-warning border-warning/20' :
 'bg-loss/20 text-loss border-loss/20'
 )}>
 {proofsPassed}/{proofsTotal} إثباتات
 </Badge>
 </div>
 </div>

 <div className="p-3 space-y-2.5">
 {/* ─── 1. القرار النهائي + Tech Score ─── */}
 <div className={cn('rounded-lg bg-gradient-to-l p-2.5 border', scoreBg)}>
 <div className="flex items-center justify-between gap-2">
 <div className="flex flex-col">
 <span className="text-xs text-muted-foreground font-bold">القرار النهائي:</span>
 <span className="text-xs font-black text-foreground">{signal_final}</span>
 </div>
 <div className="flex flex-col items-center min-w-[60px]">
 <span className="text-xs text-muted-foreground font-bold">Tech Score</span>
 <span className={cn('text-xl font-black font-mono', scoreColor)}>
 {tech_score}
 <span className="text-xs text-muted-foreground">/100</span>
 </span>
 </div>
 </div>
 <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed border-t border-border/30 pt-1.5">
 🧭 <span className="font-bold text-foreground">المسار:</span> {path_taken}
 </p>
 </div>

 {/* ─── 2. حالة الطيران + الميكرز (صف واحد) ─── */}
 <div className="grid grid-cols-2 gap-2">
 {/* Flight State */}
 <div className={cn('rounded-md border p-2', flightColorMap[flight_state?.state] || flightColorMap.sideways)}>
 <div className="flex items-center gap-1.5 mb-0.5">
 <FlightIcon className="w-3.5 h-3.5" />
 <span className="text-xs font-bold text-muted-foreground">حالة الطيران</span>
 </div>
 <div className="text-xs font-black leading-tight">{flight_state?.state_ar}</div>
 <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
 {flight_state?.reason}
 </div>
 </div>

 {/* Maker State */}
 <div className={cn('rounded-md border p-2', makerColorMap[maker_state?.state] || makerColorMap.calm)}>
 <div className="flex items-center gap-1.5 mb-0.5">
 <Fish className="w-3.5 h-3.5" />
 <span className="text-xs font-bold text-muted-foreground">🐋 حركة الميكرز</span>
 </div>
 <div className="text-xs font-black leading-tight">
 {maker_state?.emoji} {maker_state?.state_ar}
 </div>
 <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
 Vol × {(maker_state?.vol_ratio || 1).toFixed(2)}
 {maker_state?.vsa_absorption && ' · VSA ✅'}
 {maker_state?.sweep_bullish && ' · Sweep ↑'}
 {maker_state?.sweep_bearish && ' · Sweep ↓'}
 {maker_state?.volume_surge && ' · Surge ⚡'}
 </div>
 </div>
 </div>

 {/* ─── 3. Fair Value (V39) — PAYWALL Gate 1: locked for free users post-trial ─── */}
 <div className="rounded-md border border-border bg-muted/20 p-2">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-1.5">
 <Scale className="w-3.5 h-3.5 text-primary" />
 <span className="text-xs font-bold text-muted-foreground">القيمة العادلة</span>
 </div>
 <div className="flex items-center gap-1">
 {fairValueLocked ? (
 <span className="text-xs font-semibold text-warning ">
 🔒 متاحة للمشتركين
 </span>
 ) : (
 <>
 <span className="font-bold text-foreground">{fair_value?.toFixed(2)}</span>
 <Badge
 variant="outline"
 className={cn(
 'text-xs py-0 px-1.5',
 fair_state === 'غالي' ? 'border-loss/20 text-loss' :
 fair_state === 'رخيص' ? 'border-profit/20 text-profit' :
 'border-slate-500/40 text-slate-300'
 )}
 >
 {fair_state} ({fair_premium > 0 ? '+' : ''}{fair_premium?.toFixed(1)}%)
 </Badge>
 </>
 )}
 </div>
 </div>
 {fairValueLocked && current_price > 0 && fair_value && fair_value > 0 && (
 <div className="mt-1 text-xs text-muted-foreground">
 القيمة العادلة أعلى من السعر الحالي بـ{' '}
 <span className="font-semibold text-warning ">
 {Math.round(((fair_value - current_price) / current_price) * 100)}%
 </span>
 </div>
 )}
 </div>

 {/* ─── 4. الإثباتات الستة (Proofs) — V39 ─── */}
 <div>
 <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
 <div className="h-px flex-1 bg-warning/10" />
 <span className="text-xs font-bold text-warning flex items-center gap-1">
 <Shield className="w-3 h-3" /> الإثباتات (Proofs) — {proofsPassed}/{proofsTotal}
 </span>
 <div className="h-px flex-1 bg-warning/10" />
 </div>
 <div className="grid grid-cols-1 gap-1">
 {proofs.map(renderProof)}
 </div>
 </div>

 {/* ─── 5. التقييم والتعلم الذاتي (V39 NEW) ─── */}
 <div>
 <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
 <div className="h-px flex-1 bg-cyan-500/30" />
 <span className="text-xs font-bold text-cyan-400 flex items-center gap-1">
 <Brain className="w-3 h-3" /> التقييم والتعلم الذاتي
 </span>
 <div className="h-px flex-1 bg-cyan-500/30" />
 </div>
 <div className="grid grid-cols-2 gap-1.5">
 {/* Model Quality */}
 <div className="rounded-md border border-slate-500/20 bg-slate-500/5 p-1.5">
 <div className="text-[8px] text-muted-foreground mb-0.5">حالة الضبط</div>
 <div className={cn('text-xs font-bold', qualityColorMap[quality_color || 'gray'])}>
 {model_quality || '⏳ غير متاح'}
 </div>
 </div>
 {/* Dynamic Threshold */}
 <div className="rounded-md border border-slate-500/20 bg-slate-500/5 p-1.5">
 <div className="text-[8px] text-muted-foreground mb-0.5">حد الشراء الديناميكي</div>
 <div className="text-xs font-bold text-cyan-400">
 {dynamic_thresh || 75} <span className="text-[8px] text-muted-foreground">(متكيف)</span>
 </div>
 {dynamic_thresh_reason && (
 <div className="text-[8px] text-muted-foreground mt-0.5 leading-tight">{dynamic_thresh_reason}</div>
 )}
 </div>
 {/* Win Rate */}
 <div className="rounded-md border border-slate-500/20 bg-slate-500/5 p-1.5">
 <div className="text-[8px] text-muted-foreground mb-0.5">نسبة النجاح</div>
 <div className={cn(
 'text-xs font-bold font-mono',
 (backtest?.win_rate || 0) >= 60 ? 'text-profit' :
 (backtest?.win_rate || 0) > 0 ? 'text-warning' : 'text-slate-400'
 )}>
 {backtest?.win_rate_text || 'لا يوجد صفقات سابقة'}
 </div>
 </div>
 {/* Profit Factor */}
 <div className="rounded-md border border-slate-500/20 bg-slate-500/5 p-1.5">
 <div className="text-[8px] text-muted-foreground mb-0.5">معامل الربحية (PF)</div>
 <div className={cn(
 'text-xs font-bold font-mono',
 (backtest?.profit_factor || 0) > 1.5 ? 'text-profit' :
 (backtest?.profit_factor || 0) > 0 ? 'text-warning' : 'text-slate-400'
 )}>
 {backtest?.pf_text || '0.00'}
 </div>
 {backtest && backtest.net_return !== 0 && (
 <div className={cn(
 'text-[8px] mt-0.5',
 backtest.net_return >= 0 ? 'text-profit' : 'text-loss'
 )}>
 صافي: {backtest.net_return >= 0 ? '+' : ''}{(backtest.net_return ?? 0).toFixed(2)}%
 </div>
 )}
 </div>
 </div>
 </div>

 {/* ─── 6. خطة التداول (Risk Profile — Dynamic V39) ─── */}
 {risk_profile && (
 <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2">
 <div className="flex items-center gap-1.5 mb-1.5">
 <Target className="w-3.5 h-3.5 text-cyan-400" />
 <span className="text-xs font-bold text-cyan-300">🎯 خطة التداول (ديناميكي)</span>
 {/* V39: Dynamic indicators */}
 <div className="flex items-center gap-1 mr-auto">
 {dynamic_sl_mult && (
 <Badge variant="outline" className="text-[7px] py-0 px-1 border-loss/20 text-loss">
 SL ×{dynamic_sl_mult}
 </Badge>
 )}
 {dynamic_rr1 && (
 <Badge variant="outline" className="text-[7px] py-0 px-1 border-profit/20 text-profit">
 R:R {dynamic_rr1}
 </Badge>
 )}
 {outperforming_market !== undefined && (
 <Badge variant="outline" className={cn(
 'text-[7px] py-0 px-1',
 outperforming_market ? 'border-lime-500/30 text-lime-300' : 'border-slate-500/30 text-slate-400'
 )}>
 {outperforming_market ? 'أقوى من السوق' : 'أضعف من السوق'}
 </Badge>
 )}
 </div>
 </div>
 <div className="grid grid-cols-4 gap-1 text-center">
 <div className="rounded bg-slate-800/60 p-1">
 <div className="text-[8px] text-muted-foreground">الدخول</div>
 <div className="text-xs font-mono font-bold">{risk_profile.entry?.toFixed(2)}</div>
 </div>
 <div className="rounded bg-loss/10 p-1">
 <div className="text-[8px] text-muted-foreground">🛑 الوقف</div>
 <div className="text-xs font-mono font-bold text-loss">{risk_profile.sl?.toFixed(2)}</div>
 </div>
 <div className="rounded bg-profit/10 p-1">
 <div className="text-[8px] text-muted-foreground">🎯 TP1</div>
 <div className="text-xs font-mono font-bold text-profit">{risk_profile.tp1?.toFixed(2)}</div>
 </div>
 <div className="rounded bg-profit/15 p-1">
 <div className="text-[8px] text-muted-foreground">TP2</div>
 <div className="text-xs font-mono font-bold text-profit">{risk_profile.tp2?.toFixed(2)}</div>
 </div>
 </div>
 {/* V39: DNA target note */}
 {dna_target_price && dna_target_price > 0 && (
 <div className="text-[8px] text-primary mt-1 leading-tight">
 🔮 TP1 من البصمة المستقبلية: {(dna_target_price ?? 0).toFixed(2)}
 </div>
 )}
 <div className="flex justify-between text-xs text-muted-foreground mt-1.5 pt-1 border-t border-border/30">
 <span>R:R TP1 = <strong className="text-foreground font-mono">{risk_profile.rr_ratio_tp1?.toFixed(2)}</strong></span>
 <span>R:R TP2 = <strong className="text-foreground font-mono">{risk_profile.rr_ratio_tp2?.toFixed(2)}</strong></span>
 </div>
 </div>
 )}

 {/* ─── 7. التوقع بالعربي ─── */}
 <div className="rounded-md border border-warning/20 bg-warning/5 p-2">
 <div className="flex items-start gap-1.5">
 <span className="text-base">🔮</span>
 <div className="flex-1">
 <div className="text-xs font-bold text-warning mb-0.5">التوقع بالبلدي</div>
 <div className="text-xs text-foreground leading-relaxed">{prediction_ar}</div>
 </div>
 </div>
 <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-border/30 text-xs text-muted-foreground">
 <span>RSI: <strong className="text-foreground">{rsi_status}</strong></span>
 <span>·</span>
 <span>OB العتبة: <strong className="text-foreground font-mono">{adaptive_ob}</strong></span>
 {current_price && (
 <>
 <span>·</span>
 <span>السعر: <strong className="text-foreground font-mono">{(current_price ?? 0).toFixed(2)} {currencyLabel}</strong></span>
 </>
 )}
 </div>
 </div>

 {/* ─── 8. مدير المحفظة (Portfolio Manager) ─── */}
 {portfolio_advice ? (
 <div className={cn('rounded-md border p-2.5', adviceClass)}>
 <div className="flex items-center gap-1.5 mb-1.5">
 <DollarSign className="w-3.5 h-3.5" />
 <span className="text-xs font-black">💼 مدير المحفظة</span>
 <Badge variant="outline" className="text-[8px] ml-auto py-0 px-1 border-current/40">
 مركز مفتوح
 </Badge>
 </div>
 <div className="grid grid-cols-2 gap-1.5 text-xs mb-1.5">
 <div className="rounded bg-black/20 p-1.5">
 <div className="text-[8px] text-muted-foreground">الربح/الخسارة</div>
 <div className={cn(
 'font-mono font-black text-sm',
 portfolio_advice.pnl_pct >= 0 ? 'text-profit' : 'text-loss'
 )}>
 {portfolio_advice.pnl_pct >= 0 ? '+' : ''}{(portfolio_advice.pnl_pct ?? 0).toFixed(2)}%
 </div>
 </div>
 <div className="rounded bg-black/20 p-1.5">
 <div className="text-[8px] text-muted-foreground">القيمة (P&L)</div>
 <div className={cn(
 'font-mono font-black text-sm',
 portfolio_advice.pnl_value >= 0 ? 'text-profit' : 'text-loss'
 )}>
 {portfolio_advice.pnl_value >= 0 ? '+' : ''}{(portfolio_advice.pnl_value ?? 0).toFixed(2)}
 </div>
 </div>
 </div>
 <div className="rounded bg-black/30 p-1.5 text-xs font-bold leading-relaxed">
 💡 {portfolio_advice.action}
 </div>
 <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
 <span>الدخول: <strong className="font-mono text-foreground">{portfolio_advice.entry_price}</strong> × {portfolio_advice.entry_qty} سهم</span>
 <span>الوقف الحالي: <strong className="font-mono text-loss">{portfolio_advice.stop_loss}</strong></span>
 </div>
 </div>
 ) : (
 <div className="rounded-md border border-slate-500/20 bg-slate-500/5 p-2.5">
 <div className="flex items-center justify-between gap-2 mb-1">
 <div className="flex items-center gap-1.5">
 <DollarSign className="w-3.5 h-3.5 text-slate-400" />
 <span className="text-xs font-black text-slate-300">💼 مدير المحفظة</span>
 </div>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => setShowPositionForm(!showPositionForm)}
 className="h-6 px-2 text-xs text-slate-300 hover:text-foreground hover:bg-slate-700/40"
 >
 {showPositionForm ? 'إلغاء' : '+ أضف مركزك'}
 {!showPositionForm && <ChevronDown className="w-3 h-3 mr-1" />}
 </Button>
 </div>

 {showPositionForm ? (
 <div className="space-y-1.5 mt-2">
 <div className="grid grid-cols-2 gap-1.5">
 <div>
 <Label className="text-xs text-slate-300 mb-0.5 block">سعر الشراء</Label>
 <Input
 type="number"
 step="0.01"
 value={entryPriceInput}
 onChange={(e) => setEntryPriceInput(e.target.value)}
 placeholder="0.00"
 className="h-7 text-xs bg-slate-900/60 border-slate-600/40"
 />
 </div>
 <div>
 <Label className="text-xs text-slate-300 mb-0.5 block">الكمية</Label>
 <Input
 type="number"
 value={entryQtyInput}
 onChange={(e) => setEntryQtyInput(e.target.value)}
 placeholder="0"
 className="h-7 text-xs bg-slate-900/60 border-slate-600/40"
 />
 </div>
 </div>
 <Button
 size="sm"
 onClick={handleApplyPosition}
 className="w-full h-7 text-xs bg-profit hover:bg-profit text-white"
 >
 <CheckCircle2 className="w-3 h-3 ml-1" />
 احسب نصيحتك
 </Button>
 </div>
 ) : (
 <p className="text-xs text-slate-400 leading-relaxed">
 أدخل بيانات مركزك (سعر الشراء + الكمية) لعرض نصيحة فورية:
 احتفظ / زِد / بيع / بيع جزئي.
 </p>
 )}
 </div>
 )}
 </div>
 </div>
 );
}

export default InstitutionalDecisionPanel;

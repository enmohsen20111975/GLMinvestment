'use client';

// ============================================================================
// TradingPlanSection.tsx — Smart Entry Card + helpers + ProofSection +
// MarketIntelligenceCard. Used by StockDetailDrawer.
// ============================================================================

import { useState, useEffect } from 'react';
import {
 Crosshair, Target, Award, ShieldCheck, Gauge,
 ChevronLeft, AlertTriangle, Info, Activity, TrendingUp, Loader2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
 Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { SignalStrengthMeter, signalsToStars, signalHintAr } from '@/modules/radar/components/SignalStrengthMeter';
import { useTranslation } from '@/lib/i18n-context';
import {
 accentClasses, pathMeta, PATH_DESC,
 resolveSignalCount, resolveMaxSignals,
 fmtNum, fmtMoney,
} from './helpers';
import type {
 TradingFieldRowProps, StatCardProps, ProofMetricCardProps,
 StockDetail, RadarStock, RadarPath,
} from './types';

// ============================================================================
// Trading Field Row (key/value display used inside the Trading Plan details)
// ============================================================================
export function TradingFieldRow({ label, value, sub, valueClass }: TradingFieldRowProps) {
 return (
 <div className="flex items-baseline justify-between py-1 border-b border-border/40 last:border-0">
 <span className="text-xs text-muted-foreground">{label}</span>
 <span className="flex items-baseline gap-1">
 <span className={`text-xs font-mono font-semibold ${valueClass || ''}`}>{value}</span>
 {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
 </span>
 </div>
 );
}

// ============================================================================
// Trading Plan Section — real numbers calculated from price history
// (replaces generic guidance box with calculated supports/resistances,
// entry/stop/target1/target2, R:R ratio, and dynamic Arabic analysis)
// ============================================================================
export function TradingPlanSection({ detail, radarStock }: { detail: StockDetail; radarStock?: RadarStock | null }) {
 const t = useTranslation();
 const prices = detail.prices;

 if (!prices || prices.length === 0) {
 return null;
 }

 // Sort by date ascending (oldest first) so "last N" = most recent N entries
 const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
 const lastClose = sorted[sorted.length - 1].close;

 if (!lastClose || lastClose <= 0) {
 return null;
 }

 const last10 = sorted.slice(-10);
 const last20 = sorted.slice(-20);

 // Support / Resistance calculated from OHLC history (NOT static numbers).
 // Filter out zero/negative values which appear in the data when the source
 // had no high/low recorded for a session (treat them as missing bars).
 const validLows10 = last10.map((p) => p.low).filter((v) => v > 0);
 const validLows20 = last20.map((p) => p.low).filter((v) => v > 0);
 const validHighs10 = last10.map((p) => p.high).filter((v) => v > 0);
 const validHighs20 = last20.map((p) => p.high).filter((v) => v > 0);

 const pred = detail.prediction;
 // UNIFY-FIX (Rule 27 NO-FAKE-DATA): أزلنا كل fabrications في Smart Entry Card.
 // entry/target/stop/R:R تأتي ONLY من prediction (predictions.db — Python V40.2).
 // لو لا توقع → null (لا fabrication، لا lastClose*1.05، لا support*0.98).
 const support_1 = pred?.support_level || (validLows10.length > 0 ? Math.min(...validLows10) : null);
 const support_2 = pred?.support_level_2 || (validLows20.length > 0 ? Math.min(...validLows20) : null);
 const resistance_1 = pred?.resistance_level || (validHighs10.length > 0 ? Math.max(...validHighs10) : null);
 const resistance_2 = pred?.resistance_level_2 || (validHighs20.length > 0 ? Math.max(...validHighs20) : null);

 // Entry / Stop / Targets — ONLY from prediction (Rule 73 SINGLE-DISPLAY-SOURCE)
 const entry_price = pred?.entry_price ?? null;
 const target_1 = pred?.target_price ?? null;
 const target_2 = pred?.target_price_2 ?? null;
 const stop_loss = pred?.stop_loss ?? null;
 const rr_ratio = pred?.risk_reward ?? null;

 // MA10 — average of last 10 closes
 const ma10 = last10.reduce((sum, p) => sum + p.close, 0) / last10.length;
 const above_ma10 = lastClose > ma10;

 // Volume ratio: last session volume vs avg of last 20 sessions
 const last_volume = sorted[sorted.length - 1].volume;
 const avg_20_vol = last20.reduce((sum, p) => sum + p.volume, 0) / last20.length;
 const vol_ratio = avg_20_vol > 0 ? last_volume / avg_20_vol : 0;

 // Range 10d % = (max_high - min_low) / min_low * 100
 const range_10d_pct = support_1 > 0 ? ((resistance_1 - support_1) / support_1) * 100 : 0;

 // ─── RADAR-QUICK-WINS (Priority 1): Smart Entry Card inputs ───────────────
 // Path description (emoji + plain Arabic) — falls back to "تحت الميكروسكوب"
 // if the drawer was opened from outside the radar table.
 const path: RadarPath | null = radarStock?.path ?? null;
 const pathDesc = path ? PATH_DESC[path] : null;
 const pathAccent = path ? accentClasses[pathMeta[path].accent] : accentClasses.amber;

 // Position size from API (0..1) — display as a percentage badge.
 const positionSizePct = radarStock?.position_size != null
 ? Math.round(radarStock.position_size * 1000) / 10
 : null;

 // Signal strength meter inputs.
 const signalCount = resolveSignalCount(radarStock);
 const maxSignals = resolveMaxSignals(path);

 // Entry zone from SSOT (or support_1 → lastClose)
 const entryZoneLow = pred?.entry_price_min || Math.min(support_1, lastClose);
 const entryZoneHigh = pred?.entry_price_max || lastClose;

 // Build dynamic Arabic analysis — changes based on real data, not a fixed string
 const analysis_lines: string[] = [];

 analysis_lines.push(
 above_ma10
 ? `السهم يتداول فوق متوسط 10 أيام (${fmtNum(lastClose)} > ${fmtNum(ma10)}).`
 : `السهم يتداول تحت متوسط 10 أيام (${fmtNum(lastClose)} < ${fmtNum(ma10)}).`
 );

 if (vol_ratio >= 1.5) {
 analysis_lines.push(`الحجم الحالي ${(vol_ratio ?? 0).toFixed(2)}× متوسط 20 يوم — تأكيد قوة.`);
 } else if (vol_ratio < 0.7) {
 analysis_lines.push(`الحجم الحالي ${(vol_ratio ?? 0).toFixed(2)}× متوسط 20 يوم — ضعف سيولة.`);
 }

 if (range_10d_pct < 6) {
 analysis_lines.push(`المدى الضيق ${(range_10d_pct ?? 0).toFixed(1)}% في آخر 10 أيام يشير لتجميع.`);
 } else if (range_10d_pct > 15) {
 analysis_lines.push(`المدى الواسع ${(range_10d_pct ?? 0).toFixed(1)}% في آخر 10 أيام يشير لتقلب عالي.`);
 } else {
 // Same dead-assignment shape as the recommendation block: this line used
 // to sit inside the `> 15` branch, so it could only ever render alongside
 // the "wide range / high volatility" message and the normal 6-15% range
 // produced no line at all.
 analysis_lines.push(`المدى ${(range_10d_pct ?? 0).toFixed(1)}% في آخر 10 أيام طبيعي.`);
 }

 // UNIFY-FIX (Rule 20 Python=Brain): أزلنا client-side recommendation fabrication.
 // كان الكود يحسب قرار تداول من above_ma10 + vol_ratio (client-side — مخالف Rule 20).
 // الآن: recommendation تأتي ONLY من prediction.signal_ar (Python V40.2).
 // لو لا توقع → "راجع التوصية الرسمية" (لا fabrication).
 const recommendation = pred?.signal_ar || 'راجع التوقع الفني من المحرك';

 // Gain / loss percentages — only if prediction values exist (no fabrication)
 const t1Gain = (entry_price && target_1) ? ((target_1 - entry_price) / entry_price) * 100 : null;
 const t2Gain = (entry_price && target_2) ? ((target_2 - entry_price) / entry_price) * 100 : null;
 const slLoss = (entry_price && stop_loss) ? ((stop_loss - entry_price) / entry_price) * 100 : null;

 return (
 <Card className={`p-3 ${pathAccent.softBg} ${pathAccent.card}`}>
 {/* ─── Header — path emoji + ticker + short Arabic meaning ─────── */}
 <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
 <div className="flex items-center gap-1.5 min-w-0">
 <div className={`h-7 w-7 rounded-full ${pathAccent.headerBg} flex items-center justify-center shrink-0`}>
 <Crosshair className={`h-3.5 w-3.5 ${pathAccent.iconColor}`} />
 </div>
 <div className="min-w-0">
 <div className={`text-xs font-semibold ${pathAccent.iconColor} truncate`}>
 📡 بطاقة الدخول الذكية
 </div>
 {pathDesc && (
 <div className="text-xs text-muted-foreground truncate">
 {pathDesc.emoji} {t(`predictions.makerRadar.paths.${path}.descShort`)} — {t(`predictions.makerRadar.paths.${path}.descLong`)}
 </div>
 )}
 </div>
 </div>
 {positionSizePct != null && (
 <Badge variant="outline" className={`text-xs h-5 px-1.5 ${pathAccent.badge}`} title="حجم المركز المقترح من المحفظة">
 <Crosshair className="h-3 w-3 ml-1" />
 حجم المركز: {(positionSizePct ?? 0).toFixed(1)}%
 </Badge>
 )}
 </div>

 {/* ─── Entry Zone (support_2 → current_price) ────────────────────── */}
 <div className="bg-background/60 rounded-md p-2 border border-border/40 mb-2">
 <div className="flex items-baseline justify-between flex-wrap gap-1">
 <span className="text-xs text-muted-foreground">💰 الدخول</span>
 <span className="font-mono text-sm font-bold text-primary " dir="ltr">
 {fmtNum(entryZoneLow)} → {fmtNum(entryZoneHigh)}
 </span>
 </div>
 <div className="text-xs text-muted-foreground mt-0.5">
 المنطقة المثالية (الدعم 20 يوم → السعر الحالي)
 </div>
 </div>

 {/* ─── Targets + Stop grid (prominent, 3 cells) ───────────────────── */}
 <div className="grid grid-cols-3 gap-1.5 mb-2">
 <div className="bg-background/60 rounded-md p-2 border border-profit/20 /40">
 <div className="text-xs text-muted-foreground flex items-center gap-0.5">
 <Target className="h-3 w-3" /> هدف 1
 </div>
 <div className="text-sm font-mono font-bold text-profit " dir="ltr">
 {fmtNum(target_1)}
 </div>
 <div className="text-xs text-profit font-mono">
 (+{(t1Gain ?? 0).toFixed(1)}%)
 </div>
 </div>
 <div className="bg-background/60 rounded-md p-2 border border-profit/20 /40">
 <div className="text-xs text-muted-foreground flex items-center gap-0.5">
 <Award className="h-3 w-3" /> هدف 2
 </div>
 <div className="text-sm font-mono font-bold text-profit " dir="ltr">
 {fmtNum(target_2)}
 </div>
 <div className="text-xs text-profit font-mono">
 (+{(t2Gain ?? 0).toFixed(1)}%)
 </div>
 </div>
 <div className="bg-background/60 rounded-md p-2 border border-loss/20 /40">
 <div className="text-xs text-muted-foreground flex items-center gap-0.5">
 <ShieldCheck className="h-3 w-3" /> وقف
 </div>
 <div className="text-sm font-mono font-bold text-loss " dir="ltr">
 {fmtNum(stop_loss)}
 </div>
 <div className="text-xs text-loss font-mono">
 ({(slLoss ?? 0).toFixed(1)}%)
 </div>
 </div>
 </div>

 {/* ─── Signal Strength Meter (Priority 2) ────────────────────────── */}
 {signalCount != null && maxSignals != null ? (
 <div className="bg-background/60 rounded-md p-2 border border-border/40 mb-2">
 <div className="flex items-center justify-between mb-1">
 <span className="text-xs text-muted-foreground flex items-center gap-1">
 <Gauge className="h-3 w-3" /> قوة الإشارة
 </span>
 <span className="text-xs text-muted-foreground">{signalHintAr(signalsToStars(signalCount, maxSignals))}</span>
 </div>
 <SignalStrengthMeter
 signalCount={signalCount}
 maxSignals={maxSignals}
 size="md"
 />
 </div>
 ) : (
 <div className="bg-background/60 rounded-md p-2 border border-border/40 mb-2 text-xs text-muted-foreground">
 ⚙️ قوة الإشارة غير متاحة لهذا المسار — يعتمد على التفاصيل الحجمية.
 </div>
 )}

 {/* ─── Support / Resistance levels (still useful for advanced users) ─── */}
 <details className="mb-2">
 <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none">
 مستويات الدعم والمقاومة (تفاصيل)
 </summary>
 <div className="space-y-0 mt-1">
 <TradingFieldRow label="سعر السهم الحالي" value={`${fmtNum(lastClose)} جنيه`} />
 <TradingFieldRow label="الدعم الأول" value={fmtNum(support_1)} sub="(أقل سعر في 10 أيام)" valueClass="text-profit " />
 <TradingFieldRow label="الدعم الثاني" value={fmtNum(support_2)} sub="(أقل سعر في 20 يوم)" valueClass="text-profit " />
 <TradingFieldRow label="المقاومة الأولى" value={fmtNum(resistance_1)} sub="(أعلى سعر في 10 أيام)" valueClass="text-loss " />
 <TradingFieldRow label="المقاومة الثانية" value={fmtNum(resistance_2)} sub="(أعلى سعر في 20 يوم)" valueClass="text-loss " />
 <TradingFieldRow label="نسبة العائد/المخاطرة" value={`${(rr_ratio ?? 0).toFixed(1)}:1`} valueClass="text-warning font-bold" />
 </div>
 </details>

 {/* ─── Dynamic analysis text — changes based on MA10 / volume / range ─── */}
 <div className="pt-2 border-t border-border/50">
 <div className="text-xs font-semibold text-primary mb-1">💡 التحليل:</div>
 <div className="space-y-0.5 text-xs text-muted-foreground leading-relaxed">
 {analysis_lines.map((line, i) => (
 <p key={i}>{line}</p>
 ))}
 <p className="font-medium text-foreground mt-1">{recommendation}</p>
 </div>
 </div>
 </Card>
 );
}

// ============================================================================
// Stat Card (inside drawer)
// ============================================================================
export function StatCard({ label, value, sub, valueClass, icon }: StatCardProps) {
 return (
 <Card className="p-2.5">
 <div className="flex items-center gap-1 mb-0.5">
 {icon && <span className="text-muted-foreground">{icon}</span>}
 <div className="text-xs text-muted-foreground">{label}</div>
 </div>
 <div className={`text-sm font-mono font-bold ${valueClass || ''}`}>{value}</div>
 {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
 </Card>
 );
}

export function FundamentalField({ label, value }: { label: string; value: string | null }) {
 return (
 <div className="bg-background/50 rounded-md px-2 py-1.5 border border-border/30">
 <div className="text-xs text-muted-foreground">{label}</div>
 <div className="font-mono font-semibold">{value ?? '—'}</div>
 </div>
 );
}

// ============================================================================
// Proof Section (collapsible)
// ============================================================================
export function ProofSection() {
 const [open, setOpen] = useState(false);

 // P0-3 FIX (RADAR-AUDIT-UI): PROOF_METRICS كانت قيم ثابتة (precision=24.20%،
 // recall=21.08%، avg_rr=0.014) تُعرَض كأنها live. هذا fabrication مخالف لـ
 // Rule 27 (NO-FAKE-DATA). القيم الحقيقية متاحة عبر /api/radar/accuracy.
 // تم استبدال القسم الثابت بـ placeholder يحيل للـ API الكنسي.

 return (
 <Collapsible open={open} onOpenChange={setOpen}>
 <Card className="overflow-hidden">
 <CollapsibleTrigger asChild>
 <button className="w-full flex items-center justify-between p-3 md:p-4 hover:bg-muted/50 transition-colors">
 <div className="flex items-center gap-2">
 <div className="h-8 w-8 rounded-lg bg-profit/10 flex items-center justify-center">
 <ShieldCheck className="h-4 w-4 text-profit " />
 </div>
 <div className="text-right">
 <div className="text-sm font-semibold">إثباتات دقة الرادار</div>
 <div className="text-xs text-muted-foreground">القيم الحقيقية متاحة عبر API الدقة</div>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant="outline" className="text-xs hidden sm:inline-flex bg-warning/10 text-warning dark:text-warning border border-warning/20 border-warning">
 <Award className="h-3 w-3 ml-1" />
 بيانات حقيقية مطلوبة
 </Badge>
 <ChevronLeft className={`h-4 w-4 text-muted-foreground transition-transform ${open ? '-rotate-90' : ''}`} />
 </div>
 </button>
 </CollapsibleTrigger>

 <CollapsibleContent>
 <div className="p-3 md:p-4 pt-0 space-y-3 border-t border-border/50">
 {/* P0-3: placeholder بدل القيم الثابتة الوهمية */}
 <div className="mt-3 p-4 rounded-lg bg-warning/20 border border-warning text-center">
 <div className="flex items-center justify-center gap-2 mb-2">
 <AlertTriangle className="h-5 w-5 text-warning" />
 <span className="text-sm font-bold text-warning ">
 القيم الحقيقية متاحة عبر API الدقة
 </span>
 </div>
 <p className="text-xs text-muted-foreground leading-relaxed mb-3">
 كانت تُعرَض هنا قيم ثابتة (precision=24.20%، recall=21.08%، avg_rr=0.014)
 كأنها نتائج حية — وهذا مخالف لقاعدة &quot;لا بيانات وهمية&quot;.
 القيم الحقيقية تُحسَب من predictions.db عبر:
 </p>
 <code className="block text-xs font-mono bg-card border border-border rounded p-2 text-profit mb-2" dir="ltr">
 GET /api/radar/accuracy?market=EGX&amp;days=90
 </code>
 <p className="text-xs text-muted-foreground">
 (P0-3 RADAR-AUDIT-UI — Rule 27 NO-FAKE-DATA + Rule 73 SINGLE-DISPLAY-SOURCE)
 </p>
 </div>
 </div>
 </CollapsibleContent>
 </Card>
 </Collapsible>
 );
}

// ─── ORPHAN CODE (P0-3 RADAR-AUDIT-UI — kept for reference, no longer used) ───
// ProofMetricCard + ExplosiveBarChart كانت تُستخدم في ProofSection القديم
// الذي عرض PROOF_METRICS الثابتة. مع تعطيل القيم الثابتة (Rule 27)،
// لم يعدا يُستخدمان. يُحتفظ بهما للتوثيق (VERIFY-BEFORE-DELETE).
// لإعادة التفعيل: اجلب القيم الحقيقية من /api/radar/accuracy بدل الثوابت.
// ─────────────────────────────────────────────────────────────────────────────

export function ProofMetricCard({ icon, label, value, sub, accent }: ProofMetricCardProps) {
 const colors: Record<ProofMetricCardProps['accent'], { bg: string; text: string }> = {
 blue: { bg: 'bg-primary/10', text: 'text-primary ' },
 amber: { bg: 'bg-warning/10', text: 'text-warning ' },
 rose: { bg: 'bg-loss/10', text: 'text-loss ' },
 emerald: { bg: 'bg-profit/10', text: 'text-profit ' },
 };
 const c = colors[accent];
 return (
 <Card className="p-2.5">
 <div className="flex items-center gap-1.5 mb-1">
 <div className={`h-6 w-6 rounded ${c.bg} flex items-center justify-center`}>
 <div className={c.text}>{icon}</div>
 </div>
 <div className="text-xs text-muted-foreground">{label}</div>
 </div>
 <div className={`text-lg font-bold font-mono ${c.text}`}>{value}</div>
 {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
 </Card>
 );
}

export function ExplosiveBarChart({ detected, total }: { detected: number; total: number }) {
 const missed = Math.max(0, total - detected);
 const max = Math.max(detected, missed, 1);
 const detectedPct = (detected / max) * 100;
 const missedPct = (missed / max) * 100;

 return (
 <div className="space-y-2">
 <div className="flex items-end gap-3 h-32">
 <div className="flex-1 flex flex-col items-center justify-end">
 <div className="text-xs font-mono font-semibold text-profit mb-1">
 {detected}
 </div>
 <div
 className="w-full from-profit to-profit rounded-t-md transition-all"
 style={{ height: `${Math.max(detectedPct, 4)}%` }}
 title={`${detected} مكتشفة`}
 />
 <div className="text-xs text-muted-foreground mt-1 text-center">مكتشفة</div>
 </div>
 <div className="flex-1 flex flex-col items-center justify-end">
 <div className="text-xs font-mono font-semibold text-loss mb-1">
 {missed}
 </div>
 <div
 className="w-full from-loss to-loss rounded-t-md transition-all"
 style={{ height: `${Math.max(missedPct, 4)}%` }}
 title={`${missed} فائتة`}
 />
 <div className="text-xs text-muted-foreground mt-1 text-center">فائتة</div>
 </div>
 </div>
 <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/30">
 <span>إجمالي الانفجارات: <span className="font-bold text-foreground">{total}</span></span>
 <span>نسبة الاكتشاف: <span className="font-bold text-profit ">
 {total > 0 ? ((detected / total) * 100).toFixed(1) : '0.0'}%
 </span></span>
 </div>
 </div>
 );
}

// ============================================================================
// MarketIntelligenceCard — خريطة الكنوز (intraday + fundamentals + price history)
// ============================================================================

export function MarketIntelligenceCard({ ticker }: { ticker: string }) {
 const [data, setData] = useState<any>(null);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 let cancelled = false;
 setLoading(true);
 fetch(`/api/maker-radar/market-intelligence?ticker=${encodeURIComponent(ticker)}`)
 .then((r) => r.json())
 .then((j) => { if (!cancelled) setData(j); })
 .catch(() => {})
 .finally(() => { if (!cancelled) setLoading(false); });
 return () => { cancelled = true; };
 }, [ticker]);

 if (loading) {
 return (
 <Card className="p-3 border-primary/20">
 <div className="flex items-center gap-2">
 <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
 <span className="text-xs text-muted-foreground">بيحلّل بيانات السوق...</span>
 </div>
 </Card>
 );
 }

 if (!data?.success) {
 return (
 <Card className="p-3 border-dashed border-muted-foreground/30">
 <div className="text-xs text-muted-foreground text-center">تعذّر تحليل البيانات</div>
 </Card>
 );
 }

 const sections = data.sections || {};
 const intraday = sections.intraday || {};
 const fundamentals = sections.fundamentals || {};
 const intelligence = sections.intelligence || {};
 const priceHistory = sections.priceHistory || {};

 return (
 <Card className="p-3 border-primary/20 space-y-3">
 <div className="flex items-center gap-1.5">
 <Target className="h-3.5 w-3.5 text-primary" />
 <span className="text-xs font-bold">خريطة ذكاء السوق</span>
 <Badge variant="outline" className="text-xs ml-auto">تحليل آلي</Badge>
 </div>

 {/* Intelligence Summary */}
 {intelligence?.signals?.length > 0 && (
 <div className="space-y-1">
 {intelligence.signals.map((sig: string, i: number) => (
 <div key={i} className="text-xs leading-relaxed bg-background/50 rounded px-2 py-1 border border-border/30">
 {sig}
 </div>
 ))}
 </div>
 )}
 {intelligence?.signalCount === 0 && (
 <p className="text-xs text-muted-foreground">لا توجد إشارات واضحة من fundamentals حالياً</p>
 )}

 {/* Intraday */}
 {intraday && !intraday.error && intraday.ticks > 0 && (
 <div className="space-y-2">
 <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
 <Activity className="w-3 h-3" /> بيانات لحظية ({intraday.date})
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
 <FundamentalField label="التغير" value={intraday.change} />
 <FundamentalField label="ضغط شراء" value={intraday.buyPressure} />
 <FundamentalField label="ضغط بيع" value={intraday.sellPressure} />
 <FundamentalField label="التوجه" value={intraday.sentiment} />
 <FundamentalField label="أعلى" value={intraday.maxPrice} />
 <FundamentalField label="أدنى" value={intraday.minPrice} />
 <FundamentalField label="إجمالي الفوليوم" value={intraday.totalVolume ? fmtMoney(intraday.totalVolume) : '—'} />
 <FundamentalField label="عدد النقاط" value={String(intraday.ticks || 0)} />
 </div>

 {/* Opening vs Closing */}
 <div className="grid grid-cols-2 gap-2">
 {intraday.opening && (
 <div className="bg-background/50 rounded-md p-2 border border-border/30">
 <div className="text-xs text-muted-foreground mb-1">مزاد الافتتاح</div>
 <div className="text-xs font-bold">{intraday.opening.direction}</div>
 <div className="text-xs text-muted-foreground">فوليوم: {intraday.opening.volume ? fmtMoney(intraday.opening.volume) : '—'}</div>
 </div>
 )}
 {intraday.closing && (
 <div className="bg-background/50 rounded-md p-2 border border-border/30">
 <div className="text-xs text-muted-foreground mb-1">مزاد الإغلاق</div>
 <div className="text-xs font-bold">{intraday.closing.direction}</div>
 <div className="text-xs text-muted-foreground">فوليوم: {intraday.closing.volume ? fmtMoney(intraday.closing.volume) : '—'}</div>
 </div>
 )}
 </div>

 {/* Volume Profile */}
 {intraday.volumeProfile?.length > 0 && (
 <div className="space-y-1">
 <div className="text-xs text-muted-foreground">بصمة السيولة (أعلى 5 مستويات)</div>
 {intraday.volumeProfile.map((vp: any, i: number) => (
 <div key={i} className="flex items-center gap-2 text-xs">
 <span className="font-mono font-semibold w-16">{vp.price?.toFixed(2)}</span>
 <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
 <div className="h-full bg-primary/10" style={{ width: `${Math.min(100, (vp.volume / intraday.volumeProfile[0].volume) * 100)}%` }} />
 </div>
 <span className="text-muted-foreground w-16 text-left">{fmtMoney(vp.volume)}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 )}

 {/* Fundamentals */}
 {fundamentals && !fundamentals.error && (fundamentals.valuation || fundamentals.performance || fundamentals.profitability) && (
 <div className="space-y-2">
 <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
 <Info className="w-3 h-3" /> الأساسيات (من data_engine.db)
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
 {fundamentals.valuation && (
 <>
 <FundamentalField label="P/E" value={fundamentals.valuation.pe} />
 <FundamentalField label="P/B" value={fundamentals.valuation.pb} />
 <FundamentalField label="P/S" value={fundamentals.valuation.ps} />
 <FundamentalField label="PEG" value={fundamentals.valuation.peg} />
 <FundamentalField label="القيمة السوقية" value={fundamentals.valuation.marketCap} />
 </>
 )}
 {fundamentals.performance && (
 <>
 <FundamentalField label="أسبوع" value={fundamentals.performance.perf1w} />
 <FundamentalField label="شهر" value={fundamentals.performance.perf1m} />
 <FundamentalField label="3 شهور" value={fundamentals.performance.perf3m} />
 <FundamentalField label="سنة" value={fundamentals.performance.perf1y} />
 </>
 )}
 {fundamentals.profitability && (
 <>
 <FundamentalField label="ROE" value={fundamentals.profitability.roe} />
 <FundamentalField label="ROA" value={fundamentals.profitability.roa} />
 </>
 )}
 </div>
 </div>
 )}

 {/* Price History */}
 {priceHistory && !priceHistory.error && priceHistory.days > 0 && (
 <div className="space-y-2">
 <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
 <TrendingUp className="w-3 h-3" /> ملخص السعر ({priceHistory.days} يوم)
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
 <FundamentalField label="العائد" value={priceHistory.return30d} />
 <FundamentalField label="المدى" value={`${priceHistory.range} (${priceHistory.rangePct})`} />
 <FundamentalField label="موقع السعر" value={priceHistory.positionInRange} />
 <FundamentalField label="دعم قريب" value={priceHistory.nearestSupport} />
 <FundamentalField label="مقاومة قريبة" value={priceHistory.nearestResistance} />
 <FundamentalField label="متوسط فوليوم" value={priceHistory.avgVolume ? fmtMoney(priceHistory.avgVolume) : '—'} />
 </div>
 </div>
 )}
 </Card>
 );
}

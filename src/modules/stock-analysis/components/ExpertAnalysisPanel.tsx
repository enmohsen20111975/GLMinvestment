'use client';

/**
 * ExpertAnalysisPanel.tsx
 * =========================
 * بعرض التحليل الاحترافي الشامل للسهم (من /api/stocks/[ticker]/expert-analysis)
 * 
 * بيتعرض في شاشة تفاصيل السهم كـ tab منفصل أو section.
 * 
 * الاستخدام:
 * <ExpertAnalysisPanel ticker="COMI" />
 */

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { Separator } from '@/components/ui/separator';
import { Loader2, TrendingUp, TrendingDown, Minus, Target, Shield, AlertTriangle, Activity } from 'lucide-react';

interface ExpertAnalysis {
 ticker: string;
 name: string;
 sector: string;
 recommendation: string;
 recommendation_ar: string;
 confidence: number | null;
 entry: { price: number | null; rationale_ar: string };
 target1: { price: number | null; pct: number | null; rationale_ar: string };
 target2: { price: number | null; pct: number | null; rationale_ar: string };
 stopLoss: { price: number | null; pct: number | null; rationale_ar: string };
 riskReward: number | null;
 technical: {
 rsi: { value: number | null; signal_ar: string; analysis_ar: string };
 movingAverages: { ma50: number | null; ma200: number | null; trend_ar: string; analysis_ar: string };
 supportResistance: { support: number | null; resistance: number | null; analysis_ar: string };
 range52w: { high: number | null; low: number | null; position_ar: string; analysis_ar: string };
 };
 fundamental: {
 peRatio: { value: number | null; rating_ar: string; analysis_ar: string };
 roe: { value: number | null; rating_ar: string; analysis_ar: string };
 eps: { value: number | null; analysis_ar: string };
 pbRatio: { value: number | null; rating_ar: string; analysis_ar: string };
 dividend: { value: number | null; rating_ar: string; analysis_ar: string };
 };
 risk: { level_ar: string; positionSize_ar: string; factors_ar: string[] };
 fullReport_ar: string;
}

interface Props {
 ticker: string;
 className?: string;
}

export function ExpertAnalysisPanel({ ticker, className }: Props) {
 const [analysis, setAnalysis] = useState<ExpertAnalysis | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
 if (!ticker) return;
 setLoading(true);
 setError(null);
 fetch(`/api/stocks/${encodeURIComponent(ticker)}/expert-analysis`, { cache: 'no-store' })
 .then((res) => {
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 return res.json();
 })
 .then((data) => {
 if (data?.success && data?.analysis) {
 setAnalysis(data.analysis);
 } else {
 setError(data?.error || 'تعذّر تحميل التحليل');
 }
 })
 .catch((err) => setError(err.message))
 .finally(() => setLoading(false));
 }, [ticker]);

 if (loading) {
 return (
 <div className="flex items-center justify-center py-12">
 <Loader2 className="w-6 h-6 animate-spin text-primary" />
 <span className="mr-2 text-sm text-muted-foreground">جاري تحليل السهم...</span>
 </div>
 );
 }

 if (error || !analysis) {
 return (
 <Card className={className}>
 <CardContent className="p-6 text-center text-muted-foreground">
 <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-warning" />
 <p className="text-sm">{error || 'لا يتوفر تحليل لهذا السهم حالياً'}</p>
 </CardContent>
 </Card>
 );
 }

 // Recommendation color
 const recColor = getRecommendationColor(analysis.recommendation);
 const recIcon = getRecommendationIcon(analysis.recommendation);

 return (
 <div className={className} dir="rtl">
 {/* Header: Recommendation + Confidence */}
 <Card className="mb-4 border-2" style={{ borderColor: recColor }}>
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between">
 <div>
 <CardTitle className="text-xl flex items-center gap-2">
 {recIcon}
 <span style={{ color: recColor }}>{analysis.recommendation_ar}</span>
 </CardTitle>
 <p className="text-sm text-muted-foreground mt-1">
 {analysis.name} ({analysis.ticker}) — {analysis.sector}
 </p>
 </div>
 {analysis.confidence !== null && (
 <div className="text-left">
 <div className="text-2xl font-bold" style={{ color: recColor }}>
 {analysis.confidence.toFixed(0)}%
 </div>
 <div className="text-xs text-muted-foreground">مستوى الثقة</div>
 </div>
 )}
 </div>
 </CardHeader>
 </Card>

 {/* Entry / Targets / Stop Loss */}
 <WidgetCard
 	title="نقطة الدخول والأهداف"
 	icon={Target}
 	iconColor="text-primary"
 	iconSize="w-4 h-4"
 	titleClassName="text-base"
 	className="mb-4"
 	contentClassName="space-y-3"
 >
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <PriceBox label="نقطة الدخول" value={analysis.entry.price} rationale={analysis.entry.rationale_ar} color="emerald" />
 <PriceBox label="الهدف الأول" value={analysis.target1.price} pct={analysis.target1.pct} rationale={analysis.target1.rationale_ar} color="blue" />
 <PriceBox label="الهدف الثاني" value={analysis.target2.price} pct={analysis.target2.pct} rationale={analysis.target2.rationale_ar} color="purple" />
 <PriceBox label="وقف الخسارة" value={analysis.stopLoss.price} pct={analysis.stopLoss.pct} rationale={analysis.stopLoss.rationale_ar} color="rose" />
 </div>
 {analysis.riskReward !== null && (
 <div className="flex items-center justify-between pt-2 border-t">
 <span className="text-sm text-muted-foreground">نسبة المخاطرة/العائد (R:R)</span>
 <Badge variant={analysis.riskReward >= 2 ? 'default' : 'secondary'}>
 {analysis.riskReward.toFixed(2)} {analysis.riskReward >= 2 ? '✓ ممتاز' : analysis.riskReward >= 1.5 ? 'مقبول' : 'منخفض'}
 </Badge>
 </div>
 )}
 </WidgetCard>

 <div className="grid md:grid-cols-2 gap-4">
 {/* Technical Analysis */}
 <WidgetCard
 	title="التحليل الفني"
 	icon={Activity}
 	iconColor="text-primary"
 	iconSize="w-4 h-4"
 	titleClassName="text-base"
 	contentClassName="space-y-3 text-sm"
 >
 <AnalysisRow
 label="RSI"
 value={analysis.technical.rsi.value !== null ? analysis.technical.rsi.value.toFixed(1) : '—'}
 badge={analysis.technical.rsi.signal_ar}
 analysis={analysis.technical.rsi.analysis_ar}
 />
 <AnalysisRow
 label="المتوسطات المتحركة"
 value={`MA50: ${analysis.technical.movingAverages.ma50?.toFixed(2) ?? '—'} | MA200: ${analysis.technical.movingAverages.ma200?.toFixed(2) ?? '—'}`}
 badge={analysis.technical.movingAverages.trend_ar}
 analysis={analysis.technical.movingAverages.analysis_ar}
 />
 <AnalysisRow
 label="الدعم والمقاومة"
 value={`دعم: ${analysis.technical.supportResistance.support?.toFixed(2) ?? '—'} | مقاومة: ${analysis.technical.supportResistance.resistance?.toFixed(2) ?? '—'}`}
 analysis={analysis.technical.supportResistance.analysis_ar}
 />
 <AnalysisRow
 label="نطاق 52 أسبوع"
 value={`أدنى: ${analysis.technical.range52w.low?.toFixed(2) ?? '—'} | أعلى: ${analysis.technical.range52w.high?.toFixed(2) ?? '—'}`}
 badge={analysis.technical.range52w.position_ar}
 analysis={analysis.technical.range52w.analysis_ar}
 />
 </WidgetCard>

 {/* Fundamental Analysis */}
 <WidgetCard
 	title="التحليل الأساسي"
 	icon={TrendingUp}
 	iconColor="text-primary"
 	iconSize="w-4 h-4"
 	titleClassName="text-base"
 	contentClassName="space-y-3 text-sm"
 >
 <AnalysisRow
 label="مكرر الربحية (P/E)"
 value={analysis.fundamental.peRatio.value !== null ? `${analysis.fundamental.peRatio.value.toFixed(1)}x` : '—'}
 badge={analysis.fundamental.peRatio.rating_ar}
 analysis={analysis.fundamental.peRatio.analysis_ar}
 />
 <AnalysisRow
 label="العائد على حقوق الملكية (ROE)"
 value={analysis.fundamental.roe.value !== null ? `${analysis.fundamental.roe.value.toFixed(1)}%` : '—'}
 badge={analysis.fundamental.roe.rating_ar}
 analysis={analysis.fundamental.roe.analysis_ar}
 />
 <AnalysisRow
 label="ربحية السهم (EPS)"
 value={analysis.fundamental.eps.value !== null ? `${analysis.fundamental.eps.value.toFixed(2)} جنيه` : '—'}
 analysis={analysis.fundamental.eps.analysis_ar}
 />
 <AnalysisRow
 label="مكرر القيمة الدفترية (P/B)"
 value={analysis.fundamental.pbRatio.value !== null ? `${analysis.fundamental.pbRatio.value.toFixed(2)}x` : '—'}
 badge={analysis.fundamental.pbRatio.rating_ar}
 analysis={analysis.fundamental.pbRatio.analysis_ar}
 />
 <AnalysisRow
 label="عائد التوزيعات"
 value={analysis.fundamental.dividend.value !== null ? `${analysis.fundamental.dividend.value.toFixed(2)}%` : '—'}
 badge={analysis.fundamental.dividend.rating_ar}
 analysis={analysis.fundamental.dividend.analysis_ar}
 />
 </WidgetCard>
 </div>

 {/* Risk Assessment */}
 <WidgetCard
 	title="تقييم المخاطر"
 	icon={Shield}
 	iconColor="text-primary"
 	iconSize="w-4 h-4"
 	titleClassName="text-base"
 	className="mt-4"
 	contentClassName="space-y-2 text-sm"
 >
 <div className="flex items-center justify-between">
 <span className="text-muted-foreground">مستوى المخاطرة</span>
 <Badge variant={analysis.risk.level_ar === 'مرتفع' ? 'destructive' : analysis.risk.level_ar === 'متوسط' ? 'secondary' : 'default'}>
 {analysis.risk.level_ar}
 </Badge>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-muted-foreground">حجم المركز الموصى به</span>
 <span className="font-medium">{analysis.risk.positionSize_ar}</span>
 </div>
 {analysis.risk.factors_ar.length > 0 && (
 <div className="pt-2 border-t">
 <p className="text-xs text-muted-foreground mb-1">عوامل المخاطر:</p>
 <ul className="space-y-1">
 {analysis.risk.factors_ar.map((f, i) => (
 <li key={i} className="text-xs flex items-start gap-1">
 <AlertTriangle className="w-3 h-3 text-warning mt-0.5 flex-shrink-0" />
 <span>{f}</span>
 </li>
 ))}
 </ul>
 </div>
 )}
 </WidgetCard>

 {/* Disclaimer */}
 <div className="mt-4 p-3 rounded-md bg-warning/20 border border-warning ">
 <p className="text-xs text-warning ">
 ⚠️ إخلاء مسؤولية: هذا التحليل لأغراض تعليمية وإعلامية فقط ولا يُعتبر توصية استثمارية ملزمة.
 الاستثمار في الأسهم ينطوي على مخاطر، يُرجى استشارة مستشار مالي مرخص قبل اتخاذ قرارات الاستثمار.
 </p>
 </div>
 </div>
 );
}

// ─── Helper Components ──────────────────────────────────────────────────

function PriceBox({ label, value, pct, rationale, color }: {
 label: string;
 value: number | null;
 pct?: number | null;
 rationale?: string;
 color: 'emerald' | 'blue' | 'purple' | 'rose';
}) {
 const colorClasses = {
 emerald: 'border-profit bg-profit/20',
 blue: 'border-primary bg-primary/20',
 purple: 'border-purple-200 dark:border-purple-900 bg-primary/20',
 rose: 'border-loss bg-loss/20',
 };

 const valueColor = {
 emerald: 'text-profit ',
 blue: 'text-primary ',
 purple: 'text-primary ',
 rose: 'text-loss ',
 };

 return (
 <div className={`rounded-md border p-3 ${colorClasses[color]}`}>
 <div className="text-xs text-muted-foreground mb-1">{label}</div>
 <div className={`text-lg font-bold ${valueColor[color]}`}>
 {value !== null ? value.toFixed(2) : '—'}
 </div>
 {pct !== undefined && pct !== null && (
 <div className="text-xs text-muted-foreground">
 {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
 </div>
 )}
 {rationale && (
 <div className="text-xs text-muted-foreground mt-1">{rationale}</div>
 )}
 </div>
 );
}

function AnalysisRow({ label, value, badge, analysis }: {
 label: string;
 value: string;
 badge?: string;
 analysis?: string;
}) {
 return (
 <div className="py-2 border-b last:border-0">
 <div className="flex items-center justify-between mb-1">
 <span className="text-muted-foreground">{label}</span>
 <div className="flex items-center gap-2">
 <span className="font-medium">{value}</span>
 {badge && <Badge variant="outline" className="text-xs">{badge}</Badge>}
 </div>
 </div>
 {analysis && (
 <p className="text-xs text-muted-foreground leading-relaxed mt-1">{analysis}</p>
 )}
 </div>
 );
}

function getRecommendationColor(rec: string): string {
 const colors: Record<string, string> = {
 'STRONG_BUY': '#16a34a', // green-600
 'BUY': '#22c55e', // green-500
 'ACCUMULATE': '#84cc16', // lime-500
 'HOLD': '#71717a', // zinc-500
 'REDUCE': '#f97316', // orange-500
 'SELL': '#ef4444', // red-500
 'STRONG_SELL': '#dc2626', // red-600
 };
 return colors[rec] || '#71717a';
}

function getRecommendationIcon(rec: string) {
 if (['STRONG_BUY', 'BUY', 'ACCUMULATE'].includes(rec)) {
 return <TrendingUp className="w-5 h-5" />;
 } else if (['STRONG_SELL', 'SELL', 'REDUCE'].includes(rec)) {
 return <TrendingDown className="w-5 h-5" />;
 }
 return <Minus className="w-5 h-5" />;
}

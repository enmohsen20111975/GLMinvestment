'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
 AlertTriangle, Activity, TrendingDown, TrendingUp, Clock,
 Heart, Skull, Stethoscope, Lightbulb, Target, Loader2, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'next/navigation';

// ─── Types (matching Python API response) ────────────────────────────────────

interface RescueResponse {
 success: boolean;
 ticker: string;
 decision: string;
 decision_ar: string;
 verdict_badge: string;
 current_price: number;
 buy_price: number;
 loss_amount: number;
 loss_pct: number;
 autopsy: {
 bought_near_peak: boolean;
 is_falling_knife: boolean;
 ignored_stop_loss: boolean;
 summary: string;
 };
 asset_health: {
 is_profitable: boolean | null;
 pe_ratio: number | null;
 institutional_flow: string;
 support_level: number | null;
 resistance_exit_level: number | null;
 dividend_yield: number;
 };
 action_plan: {
 recommended_action: string;
 average_down_allowed: boolean;
 average_down_reason: string;
 };
 lessons_learned: string[];
 error?: string;
 message?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RescuePage() {
 const searchParams = useSearchParams();
 const initialTicker = searchParams.get('ticker') || '';

 const [ticker, setTicker] = useState(initialTicker);
 const [entryPrice, setEntryPrice] = useState('');
 const [qty, setQty] = useState('');
 const [loading, setLoading] = useState(false);
 const [result, setResult] = useState<RescueResponse | null>(null);
 const [livePrice, setLivePrice] = useState<number | null>(null);
 const [fetchingPrice, setFetchingPrice] = useState(false);

 // Auto-fetch live price when ticker changes (or on mount from URL)
 const fetchLivePrice = useCallback(async (t: string) => {
 if (!t.trim()) { setLivePrice(null); return; }
 setFetchingPrice(true);
 try {
 const res = await fetch(`/api/stocks/${encodeURIComponent(t.trim())}/comprehensive`, { cache: 'no-store' });
 const json = await res.json();
 const price = Number(json?.stock?.current_price ?? json?.stats?.lastClose ?? 0);
 setLivePrice(price > 0 ? price : null);
 } catch {
 setLivePrice(null);
 } finally {
 setFetchingPrice(false);
 }
 }, []);

 useEffect(() => {
 if (initialTicker) {
 setTicker(initialTicker);
 fetchLivePrice(initialTicker);
 }
 }, [initialTicker, fetchLivePrice]);

 const handleTickerChange = (val: string) => {
 setTicker(val.toUpperCase());
 if (val.trim().length >= 2) {
 fetchLivePrice(val);
 }
 };

 const handleDiagnose = useCallback(async () => {
 if (!ticker.trim()) { toast.error('أدخل رمز السهم'); return; }
 if (!entryPrice || Number(entryPrice) <= 0) { toast.error('أدخل سعر الشراء الأصلي'); return; }
 if (!qty || Number(qty) <= 0) { toast.error('أدخل الكمية المملوكة'); return; }

 setLoading(true);
 setResult(null);

 try {
 // ALPHA-V2: Direct call to /api/rescue/analyze (Python brain — Rule 20 & 27)
 const params = new URLSearchParams({
 ticker: ticker.trim().toUpperCase(),
 buy_price: entryPrice,
 quantity: qty,
 });
 const res = await fetch(`/api/rescue/analyze?${params.toString()}`, { cache: 'no-store' });
 const json: RescueResponse = await res.json();

 if (json.success) {
 setResult(json);
 // Update live price from the API response
 if (json.current_price > 0) setLivePrice(json.current_price);
 } else {
 toast.error(json.message || json.error || 'فشل التشخيص');
 }
 } catch {
 toast.error('فشل الاتصال بمحرك التحليل — حاول مرة أخرى');
 } finally {
 setLoading(false);
 }
 }, [ticker, entryPrice, qty]);

 // Verdict config
 const verdictConfig = result ? (() => {
 const v = result.decision;
 if (v === 'CUT_LOSS') return {
 label: result.decision_ar || 'اقطع الخسارة فوراً',
 icon: Skull,
 color: 'text-danger',
 bg: 'bg-red-50 dark:bg-red-950/30',
 border: 'border-red-300 dark:border-red-800',
 badge: 'bg-danger text-white',
 };
 if (v === 'AVERAGE_DOWN') return {
 label: result.decision_ar || 'اعمل متوسط بحساب دقيق',
 icon: Activity,
 color: 'text-primary',
 bg: 'bg-blue-50 dark:bg-blue-950/30',
 border: 'border-blue-300 dark:border-blue-800',
 badge: 'bg-blue-600 text-white',
 };
 return {
 label: result.decision_ar || 'اصبر',
 icon: Clock,
 color: 'text-profit',
 bg: 'bg-profit/5',
 border: 'border-profit/30 ',
 badge: 'bg-profit text-white',
 };
 })() : null;

 return (
 <div className="min-h-screen bg-background" dir="rtl">
 <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
 {/* Header */}
 <div className="text-center space-y-2">
 <h1 className="text-2xl md:text-3xl font-black flex items-center justify-center gap-2">
 🚑 عيادة إنقاذ الصفقات المتعثرة
 </h1>
 <p className="text-sm text-muted-foreground max-w-xl mx-auto">
 تشخيص تشريحي للمراكز الخاسرة، كشف أسباب التعثر، وحسم القرار بين القطع أو التبريد أو الصبر بخطة تعافي دقيقة
 </p>
 </div>

 {/* Input Card */}
 <Card className="border-2 border-primary/20">
 <CardContent className="p-4 md:p-6 space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">رمز السهم</Label>
 <Input
 value={ticker}
 onChange={(e) => handleTickerChange(e.target.value)}
 placeholder="مثال: COMI"
 className="h-10 font-mono"
 dir="ltr"
 />
 {fetchingPrice && <span className="text-[10px] text-muted-foreground">جاري جلب السعر...</span>}
 {livePrice !== null && !fetchingPrice && (
 <span className="text-[10px] text-muted-foreground">
 السعر الحالي: <span className="font-mono font-bold text-primary">{livePrice.toFixed(2)} ج.م</span>
 </span>
 )}
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">سعر الشراء الأصلي (ج.م)</Label>
 <Input
 type="number"
 value={entryPrice}
 onChange={(e) => setEntryPrice(e.target.value)}
 placeholder="مثال: 25.50"
 className="h-10 font-mono"
 dir="ltr"
 />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">الكمية المملوكة</Label>
 <Input
 type="number"
 value={qty}
 onChange={(e) => setQty(e.target.value)}
 placeholder="مثال: 1000"
 className="h-10 font-mono"
 dir="ltr"
 />
 </div>
 </div>
 <Button
 onClick={handleDiagnose}
 disabled={loading}
 className="w-full h-11 text-sm font-bold gap-2"
 >
 {loading ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin" />
 جاري التشخيص...
 </>
 ) : (
 <>
 <Stethoscope className="w-4 h-4" />
 🩺 تشخيص الصفقة وإصدار قرار الإنقاذ
 </>
 )}
 </Button>
 </CardContent>
 </Card>

 {/* Results */}
 {loading && (
 <div className="space-y-3">
 <Skeleton className="h-20 w-full rounded-xl" />
 <Skeleton className="h-40 w-full rounded-xl" />
 <Skeleton className="h-32 w-full rounded-xl" />
 </div>
 )}

 {result && verdictConfig && !loading && (
 <div className="space-y-4">
 {/* Verdict Banner */}
 <Card className={cn('border-2', verdictConfig.border, verdictConfig.bg)}>
 <CardContent className="p-4 md:p-5">
 <div className="flex items-center gap-4">
 <div className={cn('w-12 h-12 rounded-full flex items-center justify-center shrink-0', verdictConfig.badge)}>
 <verdictConfig.icon className="w-6 h-6 text-white" />
 </div>
 <div className="min-w-0 flex-1">
 <p className={cn('text-lg md:text-xl font-black', verdictConfig.color)}>
 {verdictConfig.label}
 </p>
 <p className="text-xs text-muted-foreground mt-0.5">
 {result.action_plan.recommended_action}
 </p>
 </div>
 </div>
 {result.verdict_badge === 'danger' && (
 <div className="mt-3 flex items-center gap-1.5 text-xs text-danger">
 <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
 <span>السيولة المستردة: {Math.abs(result.loss_amount).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م</span>
 </div>
 )}
 </CardContent>
 </Card>

 {/* Trade Autopsy + Asset Health */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {/* Trade Autopsy */}
 <WidgetCard
 	title="تشريح الصفقة"
 	icon={Skull}
 	iconColor="text-danger"
 	iconSize="w-4 h-4"
 	titleClassName="text-sm gap-1.5"
 	contentClassName="space-y-2 text-xs"
 >

 <div className="flex justify-between">
 <span className="text-muted-foreground">نسبة الخسارة</span>
 <span className={cn('font-bold font-mono', result.loss_pct < 0 ? 'text-danger' : 'text-profit')}>
 {result.loss_pct >= 0 ? '+' : ''}{result.loss_pct.toFixed(2)}%
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">قيمة الخسارة</span>
 <span className={cn('font-bold font-mono', result.loss_amount < 0 ? 'text-danger' : 'text-profit')}>
 {result.loss_amount >= 0 ? '+' : ''}{result.loss_amount.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">سعر الشراء</span>
 <span className="font-mono font-semibold">{result.buy_price.toFixed(2)}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">السعر الحالي</span>
 <span className="font-mono font-semibold">{result.current_price > 0 ? result.current_price.toFixed(2) : '—'}</span>
 </div>
 <div className="pt-2 border-t border-border/30 space-y-1">
 {result.autopsy.bought_near_peak && (
 <Badge variant="outline" className="text-[9px] border-red-300 text-danger mr-1">شراء في قمة</Badge>
 )}
 {result.autopsy.is_falling_knife && (
 <Badge variant="outline" className="text-[9px] border-red-300 text-danger mr-1">سكين ساقطة</Badge>
 )}
 {result.autopsy.ignored_stop_loss && (
 <Badge variant="outline" className="text-[9px] border-warning/30 text-warning mr-1">تجاهل الوقف</Badge>
 )}
 </div>
 <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">{result.autopsy.summary}</p>
 </WidgetCard>

 {/* Asset Health */}
 <WidgetCard
 	title="حيوية الأصل والسيولة"
 	icon={Heart}
 	iconColor="text-profit"
 	iconSize="w-4 h-4"
 	titleClassName="text-sm gap-1.5"
 	contentClassName="space-y-2 text-xs"
 >

 <div className="flex justify-between">
 <span className="text-muted-foreground">تدفق السيولة المؤسسية</span>
 <span className="font-semibold">{result.asset_health.institutional_flow}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">ربحية الشركة</span>
 <span className="font-semibold">
 {result.asset_health.is_profitable === true ? '✅ رابحة' : result.asset_health.is_profitable === false ? '❌ خاسرة' : '—'}
 </span>
 </div>
 {result.asset_health.pe_ratio !== null && (
 <div className="flex justify-between">
 <span className="text-muted-foreground">مكرر الربحية (P/E)</span>
 <span className="font-mono font-semibold">{result.asset_health.pe_ratio?.toFixed(2)}</span>
 </div>
 )}
 {result.asset_health.dividend_yield > 0 && (
 <div className="flex justify-between">
 <span className="text-muted-foreground">عائد التوزيعات</span>
 <span className="font-mono font-semibold text-profit">{result.asset_health.dividend_yield.toFixed(2)}%</span>
 </div>
 )}
 {result.asset_health.support_level !== null && result.asset_health.support_level > 0 && (
 <div className="flex justify-between">
 <span className="text-muted-foreground">مستوى الدعم</span>
 <span className="font-mono font-semibold text-profit">{result.asset_health.support_level.toFixed(2)}</span>
 </div>
 )}
 {result.asset_health.resistance_exit_level !== null && result.asset_health.resistance_exit_level > 0 && (
 <div className="flex justify-between">
 <span className="text-muted-foreground">مستوى الخروج</span>
 <span className="font-mono font-semibold text-loss">{result.asset_health.resistance_exit_level.toFixed(2)}</span>
 </div>
 )}
 </WidgetCard>
 </div>

 {/* Action Plan */}
 <WidgetCard
 	title="خطة العمل والتعافي"
 	icon={Target}
 	iconColor="text-primary"
 	iconSize="w-4 h-4"
 	titleClassName="text-sm gap-1.5"
 	contentClassName="space-y-2"
 >

 <div className="p-3 rounded-lg bg-muted/30">
 <p className="text-xs text-foreground leading-relaxed">{result.action_plan.recommended_action}</p>
 </div>
 {result.action_plan.average_down_allowed && (
 <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
 <div className="flex items-center gap-1.5 mb-1">
 <Activity className="w-3.5 h-3.5 text-primary" />
 <span className="text-xs font-bold text-blue-700 dark:text-blue-300">خطة التبريد المقترحة</span>
 </div>
 <p className="text-xs text-muted-foreground">{result.action_plan.average_down_reason}</p>
 </div>
 )}
 </WidgetCard>

 {/* Lessons Learned */}
 <WidgetCard
 	title="الدروس المستفادة"
 	icon={Lightbulb}
 	iconColor="text-warning"
 	iconSize="w-4 h-4"
 	titleClassName="text-sm gap-1.5"
 	className="border-warning/20 dark:border-warning/30 bg-warning/5"
 	contentClassName="space-y-1.5"
 >

 {result.lessons_learned.map((lesson, i) => (
 <p key={i} className="text-xs text-muted-foreground leading-relaxed">{lesson}</p>
 ))}
 </WidgetCard>
 </div>
 )}
 </div>
 </div>
 );
}

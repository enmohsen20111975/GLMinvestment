'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
 TrendingUp,
 TrendingDown,
 Minus,
 RefreshCw,
 Bitcoin,
 Coins,
 Landmark,
 Building2,
 Gem,
 Sparkles,
 AlertTriangle
} from 'lucide-react';
import { toArabicError } from '@/lib/safe-error';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
// ALPHA-UX-FIX-5: guest freemium preview CTA (3 predictions + register for more)
import { GuestLimitCta } from '@/components/auth/GuestLimitCta';

interface Prediction {
 id: string;
 symbol: string;
 signal: 'BUY' | 'SELL' | 'HOLD';
 entryPrice: number;
 targetPrice: number;
 stopLoss: number;
 confidence: number;
 reasoning: string;
 created_at: string;
 // ALPHA-API-STATUS-1: lifecycle_status من الـ engine (برافو — column جديد دستوري).
 // undefined → 'proven' (backward-compat). status الرسمية محفوظة.
 lifecycle_status?: 'proven' | 'testing' | 'closed';
 // status الرسمية (الـ 5 قيم) — للـ outcome detail + inferring lifecycle
 status?: string;
}

const iconMap: Record<string, any> = {
 'BTC': Bitcoin,
 'ETH': Coins,
 'EGX 100': Landmark,
 'COMI': Building2,
 'GOLD': Gem
};

const signalColors: Record<string, string> = {
 'BUY': 'bg-success/20 text-success border-success/50',
 'SELL': 'bg-loss/20 text-loss border-loss/50',
 'HOLD': 'bg-warning/20 text-warning border-yellow-500/50'
};

const signalIcons: Record<string, any> = {
 'BUY': TrendingUp,
 'SELL': TrendingDown,
 'HOLD': Minus
};

// ALPHA-UX-FIX-9: module-level helpers (مستخدمة في PredictionCard)
function formatPrice(price: number | null | undefined, symbol: string) {
 if (price == null || Number.isNaN(price)) return '—';
 if (symbol === 'BTC' || symbol === 'ETH') {
 return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
 } else if (symbol === 'GOLD') {
 return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
 } else {
 return `${(price ?? 0).toFixed(2)} ج.م`;
 }
}

function getPotentialGain(pred: Prediction) {
 const entry = pred.entryPrice;
 const target = pred.targetPrice;
 if (entry == null || target == null || entry === 0 || Number.isNaN(entry) || Number.isNaN(target)) {
 return '0.0';
 }
 const gain = ((target - entry) / entry) * 100;
 if (!Number.isFinite(gain)) return '0.0';
 return (gain ?? 0).toFixed(1);
}

/**
 * getLifecycle — ALPHA-API-STATUS-1: بيرجّع lifecycle_status مع backward-compat.
 * لو lifecycle_status موجود → بيرجّعه. لو null → بـ infer من status الرسمية:
 * TARGET_HIT/STOPPED/EXPIRED → 'closed'. active/PENDING/ACTIVE → 'proven'.
 */
function getLifecycle(pred: Prediction): 'proven' | 'testing' | 'closed' {
 if (pred.lifecycle_status) return pred.lifecycle_status as 'proven' | 'testing' | 'closed';
 if (pred.status) {
 const s = pred.status.toUpperCase();
 if (['TARGET_HIT', 'STOPPED', 'EXPIRED'].includes(s)) return 'closed';
 if (['ACTIVE', 'PENDING', 'WAITING'].includes(s)) return 'proven';
 }
 return 'proven';
}

/**
 * PredictionCard — ALPHA-UX-FIX-9: prediction card بـ status badge + token colors.
 * - proven (أو undefined): الكارت العادي (bg-card).
 * - testing: badge «🟡 تحت الاختبار» (warning).
 * - closed: كارت خافت (opacity-60) + badge «🔴 منتهية».
 */
function PredictionCard({ pred }: { pred: Prediction }) {
 const Icon = iconMap[pred.symbol] || TrendingUp;
 const SignalIcon = signalIcons[pred.signal];
 const potentialGain = parseFloat(getPotentialGain(pred));
 const isClosed = getLifecycle(pred) === 'closed';
 return (
 <div
 key={pred.id}
 className={cn('rounded-lg p-3 border transition-colors', isClosed ? 'bg-muted/50 border-border opacity-60' : 'bg-card border-border hover:border-primary/40')}
 >
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-2">
 <div className="p-1.5 rounded-lg bg-muted">
 <Icon className="h-4 w-4 text-foreground" />
 </div>
 <span className="font-bold text-foreground">{pred.symbol}</span>
 {getLifecycle(pred) === 'testing' && (<Badge className="bg-warning/15 text-warning border-warning/40 text-[10px]">🟡 تحت الاختبار</Badge>)}
 {getLifecycle(pred) === 'closed' && (<Badge className="bg-muted text-muted-foreground border-border text-[10px]">🔴 منتهية</Badge>)}
 </div>
 <Badge className={signalColors[pred.signal]}>
 <SignalIcon className="h-3 w-3 mr-1" />
 {pred.signal === 'BUY' ? 'شراء' : pred.signal === 'SELL' ? 'بيع' : 'انتظار'}
 </Badge>
 </div>
 <div className="grid grid-cols-3 gap-2 text-xs mb-2">
 <div><span className="text-muted-foreground">الدخول</span><p className="text-foreground font-mono">{formatPrice(pred.entryPrice, pred.symbol)}</p></div>
 <div><span className="text-muted-foreground">الهدف</span><p className="text-success font-mono">{formatPrice(pred.targetPrice, pred.symbol)}</p></div>
 <div><span className="text-muted-foreground">وقف الخسارة</span><p className="text-loss font-mono">{formatPrice(pred.stopLoss, pred.symbol)}</p></div>
 </div>
 <div className="flex items-center justify-between text-xs">
 <div className="flex items-center gap-2">
 <span className="text-muted-foreground">الثقة:</span>
 <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
 <div className={`h-full rounded-full ${pred.confidence >= 0.7 ? 'bg-success' : pred.confidence >= 0.5 ? 'bg-warning' : 'bg-loss'}`} style={{ width: `${pred.confidence * 100}%` }} />
 </div>
 <span className="text-foreground">{(pred.confidence * 100).toFixed(0)}%</span>
 </div>
 <div className={`flex items-center gap-1 ${potentialGain >= 0 ? 'text-success' : 'text-loss'}`}>
 {potentialGain >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
 {potentialGain >= 0 ? '+' : ''}{potentialGain}%
 </div>
 </div>
 <p className="text-xs text-muted-foreground mt-2 border-t border-border pt-2">{pred.reasoning}</p>
 </div>
 );
}

export function EidPredictionsWidget() {
 const [predictions, setPredictions] = useState<Prediction[]>([]);
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [lastUpdate, setLastUpdate] = useState<string | null>(null);
 // ALPHA-UX-FIX-5: guest freemium — guest يشوف 3 توقعات، الباقي خلف CTA
 const isAuthenticated = useAppStore((s) => s.isAuthenticated);
 const GUEST_PREDICTION_LIMIT = 3;
 const displayPredictions = (!isAuthenticated ? predictions.slice(0, GUEST_PREDICTION_LIMIT) : predictions).filter(p => {
 // HARD GATE: R/R >= 1.5 for BUY (Rule: no BUY with R/R < 1.5 — no Zبالة)
 if (p.signal === 'BUY') {
 const risk = p.entryPrice - p.stopLoss;
 const reward = p.targetPrice - p.entryPrice;
 if (risk <= 0 || reward <= 0) return false;
 return (reward / risk) >= 1.5;
 }
 return true;
 });

 const fetchPredictions = useCallback(async (forceRefresh = false) => {
 try {
 if (forceRefresh) {
 setRefreshing(true);
 } else {
 setLoading(true);
 }
 setError(null);

 const _market = typeof window !== 'undefined'
 ? JSON.parse(localStorage.getItem('egx_current_market') || '"EGX"')
 : 'EGX';
 const url = `/api/predictions/eid?market=${_market}`;
 const method = forceRefresh ? 'POST' : 'GET';

 const response = await fetch(url, { method });
 const data = await response.json();

 if (data.success) {
 setPredictions(data.predictions);
 setLastUpdate(data.generated_at || new Date().toISOString());
 } else {
 setError(toArabicError(data.error, 'فشل في تحميل التوقعات'));
 }
 } catch (err: any) {
 setError(toArabicError(err, 'تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.'));
 } finally {
 setLoading(false);
 setRefreshing(false);
 }
 }, []);

 useEffect(() => {
 fetchPredictions();
 }, [fetchPredictions]);

 // ALPHA-UX-FIX-9: formatPrice + getPotentialGain انتقلوا لـ module level (شوف فوق)

 if (loading) {
 return (
 <Card className="bg-card border-border">
 <CardHeader>
 <div className="flex items-center gap-2">
 <Sparkles className="h-5 w-5 text-warning" />
 <Skeleton className="h-6 w-40" />
 </div>
 </CardHeader>
 <CardContent className="space-y-3">
 {[1, 2, 3, 4, 5].map((i) => (
 <Skeleton key={i} className="h-24 w-full" />
 ))}
 </CardContent>
 </Card>
 );
 }

 if (error) {
 return (
 <Card className="bg-card border-border">
 <CardHeader>
 <div className="flex items-center gap-2">
 <AlertTriangle className="h-5 w-5 text-loss" />
 <CardTitle className="text-foreground">خطأ في التحميل</CardTitle>
 </div>
 </CardHeader>
 <CardContent>
 <p className="text-loss mb-4">{error}</p>
 <Button onClick={() => fetchPredictions()} variant="outline">
 <RefreshCw className="h-4 w-4 mr-2" />
 إعادة المحاولة
 </Button>
 </CardContent>
 </Card>
 );
 }

 return (
 <Card className="bg-card border-border">
 <CardHeader className="pb-2">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Sparkles className="h-5 w-5 text-warning" />
 <CardTitle className="text-foreground text-lg">
 توقعات اليوم
 </CardTitle>
 </div>
 <Button
 size="sm"
 variant="ghost"
 onClick={() => fetchPredictions(true)}
 disabled={refreshing}
 className="text-muted-foreground hover:text-foreground"
 >
 <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
 </Button>
 </div>
 {lastUpdate && (
 <p className="text-xs text-muted-foreground mt-1">
 آخر تحديث: {new Date(lastUpdate).toLocaleString('ar-EG')}
 </p>
 )}
 </CardHeader>
 <CardContent className="space-y-3">
 {/* Disclaimer */}
 <div className="bg-warning/10 border border-warning/30 rounded-lg p-2 mb-4">
 <p className="text-xs text-warning flex items-center gap-1">
 <AlertTriangle className="h-3 w-3" />
 هذه التوقعات للأغراض التعليمية فقط. استشر مستشار مالي قبل الاستثمار.
 </p>
 </div>

 {/* ALPHA-UX-FIX-9: 3 sections — main (proven) / testing / closed */}
 {(() => {
 const proven = displayPredictions.filter(p => getLifecycle(p) === 'proven');
 const testing = displayPredictions.filter(p => getLifecycle(p) === 'testing');
 const closed = displayPredictions.filter(p => getLifecycle(p) === 'closed');
 return (
 <>
 {proven.length > 0 && (
 <div>
 <h4 className="text-xs font-bold text-foreground mb-2 flex items-center gap-1">🟢 التوقعات الأساسية <span className="text-muted-foreground font-normal">({proven.length})</span></h4>
 <div className="space-y-2">{proven.map(p => <PredictionCard key={p.id} pred={p} />)}</div>
 </div>
 )}
 {testing.length > 0 && (
 <div>
 <h4 className="text-xs font-bold text-warning mb-2 flex items-center gap-1">🟡 تحت الاختبار <span className="text-muted-foreground font-normal">({testing.length})</span></h4>
 <p className="text-[10px] text-muted-foreground mb-2">فرص جديدة بتتـ validate — لو ثبتت معانا بتنتقل للتوقعات الأساسية.</p>
 <div className="space-y-2">{testing.map(p => <PredictionCard key={p.id} pred={p} />)}</div>
 </div>
 )}
 {closed.length > 0 && (
 <details className="mt-2">
 <summary className="text-xs font-bold text-muted-foreground cursor-pointer">🔴 منتهية ({closed.length})</summary>
 <div className="space-y-2 mt-2">{closed.map(p => <PredictionCard key={p.id} pred={p} />)}</div>
 </details>
 )}
 </>
 );
 })()}

 {/* ALPHA-UX-FIX-5: guest freemium CTA — بتشوف 3 من الكل، سجل للمزيد */}
 <GuestLimitCta shown={displayPredictions.length} total={predictions.length} itemLabel="توقعًا" itemLabelPlural="توقعات" />

 {/* Memory Stats */}
 <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
 <p>التوقعات تُحدّث يومياً بناءً على تحليل السوق</p>
 </div>
 </CardContent>
 </Card>
 );
}

export default EidPredictionsWidget;

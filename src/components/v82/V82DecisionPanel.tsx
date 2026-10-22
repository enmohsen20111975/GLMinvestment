'use client';

/**
 * V82DecisionPanel — لوحة قرار V82 المؤسسي
 * ==========================================
 * تعرض نتيجة V82 Analyzer لأي سهم:
 * - القرار (BUY/SELL/WAIT/AVOID)
 * - 9-Condition Gate
 * - Entry / SL / TP1 / TP2
 * - Money Flow (buy_value_m / sell_value_m)
 * - Position Sizing (EGP)
 * - Fuel Gauge
 * - Kill Switch status
 */

import React, { useState, useCallback } from 'react';
import {
 Target, Shield, TrendingUp, TrendingDown, Zap, AlertTriangle,
 CheckCircle2, XCircle, Activity, Fuel, DollarSign, Gauge, Loader2,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface V82Result {
 success: boolean;
 ticker?: string;
 action?: string;
 signal_strength?: string;
 diagnosis?: string;
 buy_path?: string;
 entry_price?: number;
 best_entry_price?: number;
 stop_loss?: number;
 target_price_1?: number;
 target_price_2?: number;
 risk_reward?: number;
 buy_value_m?: number;
 sell_value_m?: number;
 gate_conditions?: Record<string, boolean>;
 gate_passed?: boolean;
 fuel_pct?: number;
 fuel_exhausted?: boolean;
 position_size?: number;
 position_value_egp?: number;
 risk_amount_egp?: number;
 expected_profit_egp?: number;
 safe_mode_active?: boolean;
 kill_switch_triggered?: boolean;
 confidence?: number;
 error?: string;
}

const ACTION_COLORS: Record<string, string> = {
 BUY: 'bg-profit/10 border-profit/20 text-profit',
 SELL: 'bg-loss/10 border-loss/20 text-loss',
 WAIT: 'bg-warning/10 border-warning/20 text-warning',
 AVOID: 'bg-loss/10 border-loss/20 text-loss',
};

const ACTION_LABELS: Record<string, string> = {
 BUY: '🟢 شراء',
 SELL: '🔴 بيع',
 WAIT: '🟡 انتظار',
 AVOID: '🔴 تجنّب',
};

export function V82DecisionPanel({ initialTicker = 'COMI' }: { initialTicker?: string }) {
 const [ticker, setTicker] = useState(initialTicker);
 const [loading, setLoading] = useState(false);
 const [result, setResult] = useState<V82Result | null>(null);

 const analyze = useCallback(async () => {
 if (!ticker.trim()) return;
 setLoading(true);
 try {
 // FIX (Oct 2026 — owner directive "مؤشرات وبيانات مصرية بتظهر فى باقى الاسواق"):
 // respect currentMarket from the unified store instead of hardcoding EGX.
 const market = useAppStore.getState().currentMarket;
 const res = await fetch(`/api/v82?ticker=${ticker.toUpperCase()}&market=${market}&days=365`);
 const data = await res.json();
 setResult(data);
 } catch (e) {
 setResult({ success: false, error: (e as Error).message });
 } finally {
 setLoading(false);
 }
 }, [ticker]);

 // re-run analysis when the active market changes
 const currentMarket = useAppStore((s) => s.currentMarket);
 React.useEffect(() => {
 analyze();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [analyze, currentMarket]);

 const action = result?.action || 'WAIT';
 const gateConditions = result?.gate_conditions || {};
 const gatePassed = result?.gate_passed || false;

 return (
 <div className="space-y-3" dir="rtl">
 {/* Search */}
 <div className="flex gap-2">
 <Input
 value={ticker}
 onChange={(e) => setTicker(e.target.value)}
 placeholder="رمز السهم (مثلاً: COMI)"
 className="max-w-[200px]"
 onKeyDown={(e) => e.key === 'Enter' && analyze()}
 />
 <Button onClick={analyze} disabled={loading} size="sm">
 {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
 تحليل القرار المؤسسي
 </Button>
 </div>

 {loading && (
 <Card className="p-4">
 <div className="flex items-center gap-2 text-sm text-muted-foreground">
 <Loader2 className="w-4 h-4 animate-spin" />
 جاري تحليل {ticker} بنظام التحليل المؤسسي...
 </div>
 </Card>
 )}

 {!loading && result && !result.success && (
 <Card className="p-4 border-loss/20">
 <div className="text-sm text-loss">❌ {result.error}</div>
 </Card>
 )}

 {!loading && result && result.success && (
 <>
 {/* Decision Card */}
 <Card className={cn('border-2', ACTION_COLORS[action] || ACTION_COLORS.WAIT)}>
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Gauge className="w-5 h-5" />
 قرار السهم — {result.ticker}
 </div>
 <Badge className={ACTION_COLORS[action]}>
 {ACTION_LABELS[action] || action}
 </Badge>
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-2">
 <div className="flex items-center gap-2 text-xs">
 <span className="text-muted-foreground">التشخيص:</span>
 <span className="font-medium">{result.diagnosis}</span>
 </div>
 <div className="flex items-center gap-2 text-xs">
 <span className="text-muted-foreground">السبب:</span>
 <span>{result.buy_path}</span>
 </div>
 {result.safe_mode_active && (
 <div className="text-xs text-loss font-medium">
 🔒 وضع آمن مفعّل (خسائر متتالية)
 </div>
 )}
 </CardContent>
 </Card>

 {/* Entry / Exit */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
 <Card className="p-3">
 <div className="text-xs text-muted-foreground">أفضل دخول</div>
 <div className="text-lg font-bold text-whale">
 {result.best_entry_price?.toFixed(2) || '—'}
 </div>
 </Card>
 <Card className="p-3 border-loss/20">
 <div className="text-xs text-muted-foreground">وقف الخسارة</div>
 <div className="text-lg font-bold text-loss">
 {result.stop_loss?.toFixed(2) || '—'}
 </div>
 </Card>
 <Card className="p-3 border-profit/20">
 <div className="text-xs text-muted-foreground">الهدف 1</div>
 <div className="text-lg font-bold text-profit">
 {result.target_price_1?.toFixed(2) || '—'}
 </div>
 </Card>
 <Card className="p-3 border-profit/20">
 <div className="text-xs text-muted-foreground">الهدف 2</div>
 <div className="text-lg font-bold text-profit">
 {result.target_price_2?.toFixed(2) || '—'}
 </div>
 </Card>
 </div>

 {/* 9-Condition Gate */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Shield className="w-4 h-4 text-warning" />
 بوابة الدخول (9 شروط)
 <Badge variant={gatePassed ? 'default' : 'destructive'}>
 {gatePassed ? '✅ مقبول' : '❌ مرفوض'}
 </Badge>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
 {Object.entries(gateConditions).map(([cond, passed]) => (
 <div key={cond} className="flex items-center gap-2 text-xs">
 {passed ? (
 <CheckCircle2 className="w-3.5 h-3.5 text-profit" />
 ) : (
 <XCircle className="w-3.5 h-3.5 text-loss" />
 )}
 <span className={passed ? 'text-foreground' : 'text-muted-foreground'}>
 {cond}
 </span>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Money Flow */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Activity className="w-4 h-4 text-whale" />
 تدفق الأموال
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 gap-2">
 <div className="text-center p-2 rounded-lg bg-profit/5">
 <div className="text-xs text-muted-foreground">سيولة شراء</div>
 <div className="text-lg font-bold text-profit">
 {result.buy_value_m?.toFixed(2) || '0'}M
 </div>
 </div>
 <div className="text-center p-2 rounded-lg bg-loss/5">
 <div className="text-xs text-muted-foreground">سيولة بيع</div>
 <div className="text-lg font-bold text-loss">
 {result.sell_value_m?.toFixed(2) || '0'}M
 </div>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Position Sizing */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <DollarSign className="w-4 h-4 text-warning" />
 إدارة رأس المال (جنيه)
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center text-xs">
 <div>
 <div className="text-muted-foreground">عدد الأسهم</div>
 <div className="font-bold text-whale">{result.position_size || 0}</div>
 </div>
 <div>
 <div className="text-muted-foreground">قيمة الصفقة</div>
 <div className="font-bold text-warning">
 {(result.position_value_egp || 0).toFixed(0)} ج.م
 </div>
 </div>
 <div>
 <div className="text-muted-foreground">المخاطرة</div>
 <div className="font-bold text-loss">
 {(result.risk_amount_egp || 0).toFixed(0)} ج.م
 </div>
 </div>
 <div>
 <div className="text-muted-foreground">ربح متوقع</div>
 <div className="font-bold text-profit">
 {(result.expected_profit_egp || 0).toFixed(0)} ج.م
 </div>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Disclaimer */}
 <Card className="bg-warning/5 border-warning/20">
 <CardContent className="p-2">
 <p className="text-xs text-muted-foreground">
 ⚠️ توقّع آلي من نظام التحليل — ليست نصيحة استثمارية مرخصة.
 R:R = {result.risk_reward?.toFixed(1) || '—'}
 </p>
 </CardContent>
 </Card>
 </>
 )}
 </div>
 );
}

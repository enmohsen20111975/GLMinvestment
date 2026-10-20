'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity, RefreshCw, Target, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface RegimeData {
 ticker: string;
 regime: 'bull_trend' | 'bear_trend' | 'ranging' | 'unknown';
 regime_ar: string;
 confidence: number;
 indicators?: {
 adx: { adx: number; trend_strength: string; direction: string };
 roc: { roc: number; status: string };
 };
}

const REGIME_CONFIG = {
 bull_trend: { color: 'text-success', bg: 'bg-success/10', icon: TrendingUp, label: 'صاعد واضح' },
 bear_trend: { color: 'text-loss', bg: 'bg-loss/10', icon: TrendingDown, label: 'هابط واضح' },
 ranging: { color: 'text-warning', bg: 'bg-warning/10', icon: Minus, label: 'متراوح' },
 unknown: { color: 'text-muted-foreground', bg: 'bg-muted /30', icon: Activity, label: 'غير معروف' }
};

export function RegimeDetectionWidget() {
 const [regime, setRegime] = useState<RegimeData | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 const fetchRegime = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const res = await fetch('/api/python/regime/market');
 const data = await res.json();
 if (data.success) setRegime(data.data);
 else setError(data.error || 'فشل جلب البيانات');
 } catch (e) {
 setError('فشل الاتصال بالخادم');
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => { fetchRegime(); }, [fetchRegime]);

 if (loading && !regime) {
 return (
 <Card>
 <CardContent className="py-8 flex justify-center">
 <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
 </CardContent>
 </Card>
 );
 }

 if (error) {
 return (
 <Card className="border-destructive">
 <CardContent className="py-4">
 <div className="flex items-center gap-2 text-destructive">
 <AlertTriangle className="h-5 w-5" />
 <span>{error}</span>
 </div>
 <Button variant="outline" size="sm" onClick={fetchRegime} className="mt-2">إعادة المحاولة</Button>
 </CardContent>
 </Card>
 );
 }

 const config = REGIME_CONFIG[regime?.regime || 'unknown'];
 const Icon = config.icon;

 return (
 <div className="space-y-4" dir="rtl">
 <Card>
 <CardHeader className="pb-2">
 <div className="flex items-center justify-between">
 <CardTitle className="flex items-center gap-2">
 <Activity className="h-5 w-5" />
 حالة السوق
 </CardTitle>
 <Button variant="ghost" size="sm" onClick={fetchRegime} disabled={loading}>
 <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
 </Button>
 </div>
 <CardDescription>تحليل EGX30 - كشف حالة السوق</CardDescription>
 </CardHeader>
 <CardContent>
 <div className={cn("rounded-xl p-6 text-center mb-4", config.bg)}>
 <Icon className={cn("h-12 w-12 mx-auto mb-2", config.color)} />
 <h3 className="text-2xl font-bold">{regime?.regime_ar || config.label}</h3>
 <div className="mt-3">
 <div className="text-sm text-muted-foreground mb-1">مستوى الثقة</div>
 <Progress value={regime?.confidence || 0} className="h-2" />
 <div className="text-lg font-bold mt-1">{regime?.confidence || 0}%</div>
 </div>
 </div>

 {regime?.indicators && (
 <div className="space-y-2">
 <div className="flex justify-between p-2 bg-muted/30 rounded-lg">
 <span className="text-sm">ADX</span>
 <div className="flex items-center gap-2">
 <span className="font-bold">{regime.indicators.adx.adx}</span>
 <Badge variant="outline" className="text-xs">{regime.indicators.adx.trend_strength}</Badge>
 </div>
 </div>
 <div className="flex justify-between p-2 bg-muted/30 rounded-lg">
 <span className="text-sm">ROC (20)</span>
 <div className="flex items-center gap-2">
 <span className="font-bold">{regime.indicators.roc.roc}%</span>
 <Badge variant="outline" className="text-xs">{regime.indicators.roc.status}</Badge>
 </div>
 </div>
 </div>
 )}
 </CardContent>
 </Card>
 </div>
 );
}

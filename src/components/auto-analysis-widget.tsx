'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
 Brain,
 TrendingUp,
 TrendingDown,
 Activity,
 CheckCircle2,
 XCircle,
 AlertTriangle,
 Sparkles,
 RefreshCw
} from 'lucide-react';
import { toArabicError } from '@/lib/safe-error';

interface WalkForwardResult {
 month: string;
 predictions: number;
 successful: number;
 failed: number;
 accuracy: number;
 improvement: number;
}

interface TestResult {
 success: boolean;
 results: WalkForwardResult[];
 overallAccuracy: number;
 improvement: number;
 recommendation: string;
 auto_analysis_eligible: boolean;
}

function safeNum(v: unknown, fallback = 0): number {
 const n = Number(v);
 return !isNaN(n) && isFinite(n) ? n : fallback;
}

export function AutoAnalysisWidget() {
 const [testResult, setTestResult] = useState<TestResult | null>(null);
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [error, setError] = useState<string | null>(null);

 const fetchTestResult = useCallback(async () => {
 try {
 setLoading(true);
 setError(null);

 const response = await fetch('/api/walk-forward-test');
 const data = await response.json();

 if (data.success) {
 setTestResult({
 success: data.success,
 results: Array.isArray(data.results) ? data.results : [],
 overallAccuracy: safeNum(data.overallAccuracy ?? data.aggregate?.accuracy, 0),
 improvement: safeNum(data.improvement ?? data.aggregate?.improvement, 0),
 recommendation: data.recommendation ?? data.decision ?? 'لا يوجد توقع',
 auto_analysis_eligible: data.auto_analysis_eligible ?? data.aggregate?.accuracy >= 55,
 });
 } else {
 setError(toArabicError(data.error, 'فشل في تحميل النتائج'));
 }
 } catch (err: any) {
 setError(toArabicError(err, 'تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.'));
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchTestResult();
 }, [fetchTestResult]);

 const handleRefresh = async () => {
 setRefreshing(true);
 await fetchTestResult();
 setRefreshing(false);
 };

 if (loading) {
 return (
 <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
 <CardHeader>
 <div className="flex items-center gap-2">
 <Brain className="h-5 w-5 text-primary" />
 <Skeleton className="h-6 w-40" />
 </div>
 </CardHeader>
 <CardContent className="space-y-4">
 <Skeleton className="h-20 w-full" />
 <Skeleton className="h-40 w-full" />
 </CardContent>
 </Card>
 );
 }

 if (error) {
 return (
 <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
 <CardHeader>
 <div className="flex items-center gap-2">
 <AlertTriangle className="h-5 w-5 text-loss" />
 <CardTitle className="text-foreground">خطأ في التحميل</CardTitle>
 </div>
 </CardHeader>
 <CardContent>
 <p className="text-loss mb-4">{error}</p>
 <Button onClick={fetchTestResult} variant="outline">
 <RefreshCw className="h-4 w-4 mr-2" />
 إعادة المحاولة
 </Button>
 </CardContent>
 </Card>
 );
 }

 if (!testResult) return null;

 return (
 <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
 <CardHeader className="pb-2">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Brain className="h-5 w-5 text-primary" />
 <CardTitle className="text-foreground text-lg">
 Walk-Forward Test
 </CardTitle>
 </div>
 <div className="flex items-center gap-2">
 {testResult.auto_analysis_eligible ? (
 <Badge className="bg-success/20 text-success border-success/20">
 <CheckCircle2 className="h-3 w-3 mr-1" />
 جاهز للتشغيل
 </Badge>
 ) : (
 <Badge className="bg-warning/20 text-warning border-yellow-500/50">
 <AlertTriangle className="h-3 w-3 mr-1" />
 يحتاج بيانات أكثر
 </Badge>
 )}
 <Button
 size="sm"
 variant="ghost"
 onClick={handleRefresh}
 disabled={refreshing}
 className="text-slate-400 hover:text-foreground"
 >
 <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
 </Button>
 </div>
 </div>
 </CardHeader>
 <CardContent className="space-y-4">
 {/* Overall Stats */}
 <div className="grid grid-cols-3 gap-3">
 <div className="bg-slate-800/50 rounded-lg p-3 text-center">
 <div className="text-2xl font-bold text-foreground">
 {safeNum(testResult.overallAccuracy).toFixed(1)}%
 </div>
 <div className="text-xs text-slate-400">الدقة الإجمالية</div>
 </div>
 <div className="bg-slate-800/50 rounded-lg p-3 text-center">
 <div className={`text-2xl font-bold ${safeNum(testResult.improvement) >= 0 ? 'text-success' : 'text-loss'}`}>
 {safeNum(testResult.improvement) >= 0 ? '+' : ''}{safeNum(testResult.improvement).toFixed(1)}%
 </div>
 <div className="text-xs text-slate-400">التحسن</div>
 </div>
 <div className="bg-slate-800/50 rounded-lg p-3 text-center">
 <div className="text-2xl font-bold text-foreground">
 {testResult.results?.length ?? 0}
 </div>
 <div className="text-xs text-slate-400">شهور مختبرة</div>
 </div>
 </div>

 {/* Accuracy Progress */}
 <div className="space-y-2">
 <div className="flex items-center justify-between text-xs">
 <span className="text-slate-400">مستوى الدقة</span>
 <span className="text-slate-300">{safeNum(testResult.overallAccuracy).toFixed(1)}%</span>
 </div>
 <Progress
 value={safeNum(testResult.overallAccuracy)}
 className="h-2 bg-slate-700"
 />
 <div className="flex justify-between text-xs text-slate-500">
 <span>0%</span>
 <span className="text-warning">55% (الهدف)</span>
 <span>100%</span>
 </div>
 </div>

 {/* Monthly Results */}
 <div className="space-y-2">
 <div className="text-sm font-semibold text-slate-300">النتائج الشهرية</div>
 <div className="max-h-40 overflow-y-auto space-y-1">
 {(testResult.results ?? []).map((result, index) => (
 <div
 key={index}
 className="flex items-center justify-between bg-slate-800/30 rounded-lg p-2 text-xs"
 >
 <span className="text-slate-300">{result.month}</span>
 <div className="flex items-center gap-3">
 <span className="text-slate-500">{safeNum(result.predictions)} توقع</span>
 <div className="flex items-center gap-1">
 <CheckCircle2 className="h-3 w-3 text-success" />
 <span className="text-success">{safeNum(result.successful)}</span>
 </div>
 <div className="flex items-center gap-1">
 <XCircle className="h-3 w-3 text-loss" />
 <span className="text-loss">{safeNum(result.failed)}</span>
 </div>
 <div className={`flex items-center gap-1 ${safeNum(result.improvement) >= 0 ? 'text-success' : 'text-loss'}`}>
 {safeNum(result.improvement) >= 0 ? (
 <TrendingUp className="h-3 w-3" />
 ) : (
 <TrendingDown className="h-3 w-3" />
 )}
 <span>{safeNum(result.accuracy).toFixed(0)}%</span>
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* Recommendation */}
 <div className={`p-3 rounded-lg border ${
 testResult.auto_analysis_eligible
 ? 'bg-success/10 border-success/20'
 : 'bg-warning/10 border-yellow-500/30'
 }`}>
 <div className="flex items-center gap-2 mb-1">
 <Sparkles className={`h-4 w-4 ${testResult.auto_analysis_eligible ? 'text-success' : 'text-warning'}`} />
 <span className={`font-semibold text-sm ${testResult.auto_analysis_eligible ? 'text-success' : 'text-warning'}`}>
 التحليل
 </span>
 </div>
 <p className="text-sm text-slate-300">{testResult.recommendation ?? 'لا يوجد توقع'}</p>
 </div>

 {/* Info */}
 <div className="text-xs text-slate-500 pt-2 border-t border-slate-700/50">
 <p>النظام يختبر التوقعات الموسمية شهر بشهر ويقيس الدقة الفعلية</p>
 </div>
 </CardContent>
 </Card>
 );
}

export default AutoAnalysisWidget;

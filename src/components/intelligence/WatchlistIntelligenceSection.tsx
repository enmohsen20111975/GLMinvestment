'use client';

import React, { useState, useEffect } from 'react';
import {
 Eye,
 TrendingUp,
 TrendingDown,
 Target,
 Zap,
 ChevronUp,
 ChevronDown,
 Minus,
 Sparkles,
 Lightbulb,
 RefreshCw,
 Star,
 StarOff,
 AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface StockAnalysis {
 signal: string;
 signal_ar: string;
 confidence: number;
 trend: string;
 trend_ar: string;
 support: number | null;
 resistance: number | null;
 rsi: number | null;
 distance_to_support: number | null;
 distance_to_resistance: number | null;
 recommendation: {
 action: string;
 action_ar: string;
 reason: string;
 entry_price: number | null;
 stop_loss: number | null;
 target: number | null;
 };
}

interface WatchlistItem {
 id: number;
 ticker: string;
 name_ar: string;
 current_price: number;
 previous_close: number;
 price_change: number;
 purchase_price: number | null;
 quantity: number | null;
 sector: string;
 analysis: StockAnalysis | null;
 alerts: Array<{ type: string; message_ar: string; priority: string }>;
}

interface IntelligenceData {
 success: boolean;
 total: number;
 items: WatchlistItem[];
 opportunities: Array<{ ticker: string; reason_ar: string; priority: string }>;
 warnings: Array<{ ticker: string; reason_ar: string }>;
 summary: {
 total_watching: number;
 buy_opportunities: number;
 warnings_count: number;
 near_support_count: number;
 near_resistance_count: number;
 };
}

function formatCurrency(value: number | null | undefined): string {
 if (value === null || value === undefined || isNaN(value)) return '0.00 ج.م';
 return new Intl.NumberFormat('ar-EG', {
 style: 'decimal',
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 }).format(value) + ' ج.م';
}

function formatPercent(value: number | null | undefined): string {
 if (value === null || value === undefined || isNaN(value)) return '—';
 const sign = value >= 0 ? '+' : '';
 return `${sign}${(value ?? 0).toFixed(2)}%`;
}

function getSignalIcon(signal: string) {
 const s = signal?.toLowerCase() || '';
 if (s.includes('buy') || s.includes('bullish')) {
 return <ChevronUp className="w-4 h-4 text-profit" />;
 }
 if (s.includes('sell') || s.includes('bearish')) {
 return <ChevronDown className="w-4 h-4 text-loss" />;
 }
 return <Minus className="w-4 h-4 text-warning" />;
}

function getActionColor(action: string): { bg: string; text: string; border: string } {
 const a = action?.toLowerCase() || '';
 if (a.includes('buy')) {
 return { bg: 'bg-profit/10', text: 'text-profit ', border: 'border-profit ' };
 }
 if (a.includes('sell') || a.includes('avoid')) {
 return { bg: 'bg-loss/10', text: 'text-loss ', border: 'border-loss ' };
 }
 return { bg: 'bg-warning/10', text: 'text-warning ', border: 'border-yellow-200 dark:border-yellow-800' };
}

export function WatchlistIntelligenceSection() {
 const [data, setData] = useState<IntelligenceData | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 const loadData = async () => {
 setLoading(true);
 setError(null);
 try {
 const res = await fetch('/api/mobile/watchlist/intelligence');
 const json = await res.json();
 if (json.success) {
 setData(json);
 } else {
 setError(json.error || 'فشل في تحميل البيانات');
 }
 } catch {
 setError('حدث خطأ في الاتصال');
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadData();
 }, []);

 if (loading) {
 return (
 <div className="space-y-6">
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
 {[...Array(4)].map((_, i) => (
 <Card key={i}>
 <CardContent className="p-4">
 <Skeleton className="h-4 w-24 mb-2" />
 <Skeleton className="h-8 w-32" />
 </CardContent>
 </Card>
 ))}
 </div>
 </div>
 );
 }

 // إذا مفيش أسهم في القائمة
 if (!data || data.total === 0) {
 return (
 <Card className="border-dashed">
 <CardContent className="flex flex-col items-center justify-center py-12 text-center">
 <Eye className="w-12 h-12 text-muted-foreground mb-4" />
 <h3 className="text-lg font-semibold mb-2">لا توجد أسهم في القائمة</h3>
 <p className="text-sm text-muted-foreground mb-4">أضف أسهم إلى قائمة المراقبة للحصول على تحليل ذكي</p>
 <Button onClick={loadData} variant="outline" size="sm">
 <RefreshCw className="w-4 h-4 ml-2" />
 إعادة المحاولة
 </Button>
 </CardContent>
 </Card>
 );
 }

 const { items, summary, opportunities, warnings } = data;

 // تصنيف الأسهم حسب التحليل
 const buyStocks = items.filter(i => {
 const action = i.analysis?.recommendation?.action || '';
 return action.includes('buy');
 });
 const sellStocks = items.filter(i => {
 const action = i.analysis?.recommendation?.action || '';
 return action.includes('avoid') || action.includes('sell');
 });
 const neutralStocks = items.filter(i => {
 const action = i.analysis?.recommendation?.action || '';
 return !action.includes('buy') && !action.includes('avoid') && !action.includes('sell');
 });

 // حساب معنويات السوق
 const bullishPercent = items.length > 0 ? Math.round((buyStocks.length / items.length) * 100) : 0;
 const bearishPercent = items.length > 0 ? Math.round((sellStocks.length / items.length) * 100) : 0;
 const neutralPercent = 100 - bullishPercent - bearishPercent;

 return (
 <div className="space-y-6">
 {/* Top Actions */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Badge variant="outline" className="gap-1.5">
 <Sparkles className="w-3 h-3" />
 تحليل آلي
 </Badge>
 <Badge variant="secondary">{summary.total_watching} سهم</Badge>
 </div>
 <Button onClick={loadData} variant="outline" size="sm" disabled={loading}>
 <RefreshCw className={cn("w-4 h-4 ml-2", loading && "animate-spin")} />
 تحديث
 </Button>
 </div>

 {/* Summary Cards */}
 <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
 <Card className="p-4 gap-2">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <Eye className="w-4 h-4" />
 <span className="text-xs font-medium">إجمالي الأسهم</span>
 </div>
 <p className="text-2xl font-bold">{summary.total_watching}</p>
 </Card>

 <Card className="p-4 gap-2 from-profit to-transparent /20">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <TrendingUp className="w-4 h-4 text-profit" />
 <span className="text-xs font-medium">فرص شراء</span>
 </div>
 <p className="text-2xl font-bold text-profit">{summary.buy_opportunities}</p>
 <Progress 
 value={summary.total_watching > 0 ? (summary.buy_opportunities / summary.total_watching) * 100 : 0} 
 className="h-2 mt-2" 
 />
 </Card>

 <Card className="p-4 gap-2 from-loss to-transparent /20">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <TrendingDown className="w-4 h-4 text-loss" />
 <span className="text-xs font-medium">تحذيرات</span>
 </div>
 <p className="text-2xl font-bold text-loss">{summary.warnings_count}</p>
 <Progress 
 value={summary.total_watching > 0 ? (summary.warnings_count / summary.total_watching) * 100 : 0} 
 className="h-2 mt-2" 
 />
 </Card>

 <Card className="p-4 gap-2 from-primary to-transparent dark:">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <Target className="w-4 h-4 text-whale" />
 <span className="text-xs font-medium">قرب الدعم</span>
 </div>
 <p className="text-2xl font-bold text-whale">{summary.near_support_count}</p>
 </Card>

 <Card className="p-4 gap-2 from-warning to-transparent dark:">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <AlertTriangle className="w-4 h-4 text-warning" />
 <span className="text-xs font-medium">قرب المقاومة</span>
 </div>
 <p className="text-2xl font-bold text-warning">{summary.near_resistance_count}</p>
 </Card>
 </div>

 {/* Market Sentiment */}
 <Card>
 <CardHeader className="pb-2">
 <div className="flex items-center gap-2">
 <Target className="w-5 h-5 text-primary" />
 <CardTitle className="text-base">معنويات السوق</CardTitle>
 </div>
 </CardHeader>
 <CardContent>
 <div className="flex items-center gap-4">
 <div className="flex-1">
 <div className="flex items-center justify-between mb-2">
 <span className="text-sm text-muted-foreground">صعودي</span>
 <span className="text-sm font-medium text-profit">{bullishPercent}%</span>
 </div>
 <Progress value={bullishPercent} className="h-3 bg-muted [&>div]:bg-profit" />
 </div>
 <div className="flex-1">
 <div className="flex items-center justify-between mb-2">
 <span className="text-sm text-muted-foreground">هبوطي</span>
 <span className="text-sm font-medium text-loss">{bearishPercent}%</span>
 </div>
 <Progress value={bearishPercent} className="h-3 bg-muted [&>div]:bg-loss" />
 </div>
 <div className="flex-1">
 <div className="flex items-center justify-between mb-2">
 <span className="text-sm text-muted-foreground">محايد</span>
 <span className="text-sm font-medium text-warning">{neutralPercent}%</span>
 </div>
 <Progress value={neutralPercent} className="h-3 bg-muted [&>div]:bg-warning" />
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Quick Opportunities */}
 {opportunities.length > 0 && (
 <Card className="border-profit/20">
 <CardHeader className="pb-2">
 <div className="flex items-center gap-2">
 <Star className="w-5 h-5 text-profit" />
 <CardTitle className="text-base text-profit">أفضل فرص الشراء</CardTitle>
 </div>
 </CardHeader>
 <CardContent>
 <div className="space-y-2">
 {opportunities.slice(0, 3).map((opp, i) => (
 <div key={i} className="flex items-center justify-between p-2 rounded bg-profit/10">
 <div className="flex items-center gap-2">
 <Badge className="bg-profit/10 text-profit border border-profit/20 ">
 {opp.ticker}
 </Badge>
 <span className="text-sm">{opp.reason_ar}</span>
 </div>
 {opp.priority === 'high' && (
 <Zap className="w-4 h-4 text-warning" />
 )}
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 )}

 {/* Quick Warnings */}
 {warnings.length > 0 && (
 <Card className="border-loss/20">
 <CardHeader className="pb-2">
 <div className="flex items-center gap-2">
 <AlertTriangle className="w-5 h-5 text-loss" />
 <CardTitle className="text-base text-loss">تحذيرات</CardTitle>
 </div>
 </CardHeader>
 <CardContent>
 <div className="space-y-2">
 {warnings.slice(0, 3).map((warn, i) => (
 <div key={i} className="flex items-center gap-2 p-2 rounded bg-loss/10">
 <Badge className="bg-loss/10 text-loss border border-loss/20 ">
 {warn.ticker}
 </Badge>
 <span className="text-sm">{warn.reason_ar}</span>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 )}

 {/* Stock Cards */}
 <div className="space-y-4">
 <h3 className="text-lg font-semibold">تحليل الأسهم</h3>
 {items.map((stock) => {
 const analysis = stock.analysis;
 const action = analysis?.recommendation?.action || 'wait';
 const colors = getActionColor(action);
 
 return (
 <Card key={stock.id} className={cn(
 "overflow-hidden transition-all hover:shadow-lg",
 colors.border
 )}>
 <div className={cn(
 "h-1",
 action.includes('buy') ? "bg-profit" :
 action.includes('avoid') || action.includes('sell') ? "bg-loss" : "bg-warning"
 )} />
 <CardContent className="p-4">
 <div className="flex items-start justify-between mb-4">
 <div>
 <div className="flex items-center gap-2">
 <span className="font-bold text-lg">{stock.ticker}</span>
 <span className="text-sm text-muted-foreground">{stock.name_ar}</span>
 {action.includes('buy') && (
 <Star className="w-4 h-4 text-profit fill-profit" />
 )}
 {(action.includes('avoid') || action.includes('sell')) && (
 <StarOff className="w-4 h-4 text-loss" />
 )}
 </div>
 <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
 <span>السعر: {formatCurrency(stock.current_price)}</span>
 <span className={cn(
 "font-medium",
 stock.price_change >= 0 ? "text-profit" : "text-loss"
 )}>
 {formatPercent(stock.price_change)}
 </span>
 </div>
 </div>
 <div className="flex flex-col items-end gap-1">
 <Badge 
 variant={action.includes('buy') ? 'default' : action.includes('avoid') ? 'destructive' : 'secondary'}
 className="px-4"
 >
 {analysis?.recommendation?.action_ar || 'انتظر'}
 </Badge>
 {analysis && (
 <span className="text-xs text-muted-foreground">
 الثقة: {Math.round(analysis.confidence)}%
 </span>
 )}
 </div>
 </div>

 {/* Analysis Details */}
 {analysis && (
 <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-4">
 <div className="p-2 rounded bg-muted/50">
 <div className="text-muted-foreground text-xs">RSI</div>
 <span className={cn(
 "font-medium",
 analysis.rsi !== null && analysis.rsi < 30 ? "text-profit" :
 analysis.rsi !== null && analysis.rsi > 70 ? "text-loss" : ""
 )}>
 {analysis.rsi !== null ? (analysis.rsi ?? 0).toFixed(1) : '—'}
 </span>
 </div>
 <div className="p-2 rounded bg-muted/50">
 <div className="text-muted-foreground text-xs">الاتجاه</div>
 <div className="flex items-center gap-1">
 {getSignalIcon(analysis.signal)}
 <span>{analysis.trend_ar}</span>
 </div>
 </div>
 <div className="p-2 rounded bg-muted/50">
 <div className="text-muted-foreground text-xs">الدعم</div>
 <span className="font-medium text-profit">
 {analysis.support ? (analysis.support ?? 0).toFixed(2) : '—'}
 </span>
 </div>
 <div className="p-2 rounded bg-muted/50">
 <div className="text-muted-foreground text-xs">للدعم</div>
 <span className={cn(
 "font-medium",
 analysis.distance_to_support !== null && analysis.distance_to_support < 5 ? "text-profit" : ""
 )}>
 {analysis.distance_to_support !== null ? `${(analysis.distance_to_support ?? 0).toFixed(1)}%` : '—'}
 </span>
 </div>
 <div className="p-2 rounded bg-muted/50">
 <div className="text-muted-foreground text-xs">للمقاومة</div>
 <span className={cn(
 "font-medium",
 analysis.distance_to_resistance !== null && analysis.distance_to_resistance < 5 ? "text-loss" : ""
 )}>
 {analysis.distance_to_resistance !== null ? `${(analysis.distance_to_resistance ?? 0).toFixed(1)}%` : '—'}
 </span>
 </div>
 </div>
 )}

 {/* Alerts */}
 {stock.alerts && stock.alerts.length > 0 && (
 <div className="flex flex-wrap gap-1 mb-3">
 {stock.alerts.map((alert, j) => (
 <Badge key={j} variant="outline" className={cn(
 "text-xs",
 alert.priority === 'high' ? "border-loss text-loss" : ""
 )}>
 <Zap className="w-3 h-3 ml-1" />
 {alert.message_ar}
 </Badge>
 ))}
 </div>
 )}

 {/* Recommendation */}
 {analysis?.recommendation && (
 <div className="pt-3 border-t">
 <p className="text-sm text-muted-foreground">
 <Lightbulb className="w-4 h-4 inline ml-1 text-warning" />
 {analysis.recommendation.reason}
 </p>
 {analysis.recommendation.target && (
 <p className="text-xs text-muted-foreground mt-1">
 الهدف: {analysis.recommendation.target ? analysis.recommendation.target.toFixed(2) : "—"} | 
 وقف الخسارة: {analysis.recommendation.stop_loss?.toFixed(2) || '—'}
 </p>
 )}
 </div>
 )}

 {/* No Analysis */}
 {!analysis && (
 <div className="pt-3 border-t">
 <p className="text-sm text-muted-foreground">
 لا توجد بيانات تحليل كافية لهذا السهم
 </p>
 </div>
 )}
 </CardContent>
 </Card>
 );
 })}
 </div>
 </div>
 );
}

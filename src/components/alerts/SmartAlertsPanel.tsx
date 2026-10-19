'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
 Bell,
 TrendingUp,
 TrendingDown,
 Target,
 ShieldAlert,
 AlertTriangle,
 CheckCircle,
 Info,
 RefreshCw,
 DollarSign,
 AlertCircle,
 Zap,
 ArrowUpRight,
 ArrowDownRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SmartAlert {
 id: string;
 type: 'profit_target' | 'stop_loss' | 'support_near' | 'resistance_near' | 'dividend_soon' | 'price_drop' | 'price_surge' | 'breakout' | 'breakdown';
 severity: 'info' | 'warning' | 'danger' | 'success';
 ticker: string;
 name: string;
 message: string;
 details: {
 currentPrice: number;
 targetPrice?: number;
 buyPrice: number;
 profitLossPercent: number;
 distancePercent?: number;
 };
 action?: string;
 created_at: string;
}

interface AlertSummary {
 total: number;
 by_severity: {
 danger: number;
 warning: number;
 success: number;
 info: number;
 };
 by_type: {
 profit_target: number;
 stop_loss: number;
 support_near: number;
 resistance_near: number;
 dividend_soon: number;
 breakout: number;
 breakdown: number;
 price_surge: number;
 price_drop: number;
 };
}

const typeIcons: Record<string, React.ReactNode> = {
 profit_target: <Target className="h-4 w-4 text-success" />,
 stop_loss: <ShieldAlert className="h-4 w-4 text-loss" />,
 support_near: <ArrowDownRight className="h-4 w-4 text-whale" />,
 resistance_near: <ArrowUpRight className="h-4 w-4 text-warning" />,
 dividend_soon: <DollarSign className="h-4 w-4 text-primary" />,
 breakout: <Zap className="h-4 w-4 text-success" />,
 breakdown: <AlertCircle className="h-4 w-4 text-loss" />,
 price_surge: <TrendingUp className="h-4 w-4 text-success" />,
 price_drop: <TrendingDown className="h-4 w-4 text-loss" />
};

const typeLabels: Record<string, string> = {
 profit_target: 'هدف ربح',
 stop_loss: 'وقف خسارة',
 support_near: 'قريب من دعم',
 resistance_near: 'قريب من مقاومة',
 dividend_soon: 'أرباح',
 breakout: 'كسر مقاومة',
 breakdown: 'كسر دعم',
 price_surge: 'قفزة سعرية',
 price_drop: 'هبوط حاد'
};

const severityColors: Record<string, string> = {
 danger: 'border-loss bg-loss /20',
 warning: 'border-yellow-300 bg-warning /20',
 success: 'border-success bg-success /20',
 info: 'border-whale bg-primary /20'
};

const severityBadgeColors: Record<string, string> = {
 danger: 'bg-loss text-white',
 warning: 'bg-warning text-white',
 success: 'bg-success text-white',
 info: 'bg-whale text-white'
};

export function SmartAlertsPanel() {
 const [alerts, setAlerts] = useState<SmartAlert[]>([]);
 const [summary, setSummary] = useState<AlertSummary | null>(null);
 const [loading, setLoading] = useState(true);
 const [filter, setFilter] = useState<'all' | 'danger' | 'warning' | 'success' | 'info'>('all');

 useEffect(() => {
 fetchAlerts();
 }, []);

 const fetchAlerts = async () => {
 setLoading(true);
 try {
 const res = await fetch('/api/finance/smart-alerts');
 const json = await res.json();
 if (json.success) {
 setAlerts(json.alerts);
 setSummary(json.summary);
 }
 } catch (e) {
 console.error('Error fetching alerts:', e);
 } finally {
 setLoading(false);
 }
 };

 const filteredAlerts = filter === 'all' 
 ? alerts 
 : alerts.filter(a => a.severity === filter);

 if (loading) {
 return (
 <div className="space-y-4">
 <Skeleton className="h-20 w-full" />
 <Skeleton className="h-40 w-full" />
 </div>
 );
 }

 if (!summary || summary.total === 0) {
 return (
 <Card className="border-dashed">
 <CardContent className="flex flex-col items-center justify-center py-8">
 <CheckCircle className="h-10 w-10 text-success mb-3" />
 <h3 className="text-lg font-semibold mb-1">لا توجد تنبيهات</h3>
 <p className="text-sm text-muted-foreground text-center">
 محفظتك في وضع جيد - لا توجد تحذيرات أو تنبيهات حالياً
 </p>
 </CardContent>
 </Card>
 );
 }

 return (
 <div className="space-y-4">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Bell className="h-5 w-5 text-primary" />
 <h2 className="text-lg font-bold">التنبيهات الذكية</h2>
 <Badge variant="secondary">{summary.total}</Badge>
 </div>
 <Button variant="outline" size="sm" onClick={fetchAlerts}>
 <RefreshCw className="h-4 w-4 ml-2" />
 تحديث
 </Button>
 </div>

 {/* Severity Stats */}
 <div className="grid grid-cols-4 gap-2">
 <Card className="p-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilter(filter === 'danger' ? 'all' : 'danger')}>
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 rounded-full bg-loss flex items-center justify-center">
 <AlertTriangle className="h-4 w-4 text-loss" />
 </div>
 <div>
 <div className="text-lg font-bold text-loss">{summary.by_severity.danger}</div>
 <div className="text-xs text-muted-foreground">خطر</div>
 </div>
 </div>
 </Card>
 <Card className="p-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilter(filter === 'warning' ? 'all' : 'warning')}>
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 rounded-full bg-warning flex items-center justify-center">
 <Info className="h-4 w-4 text-warning" />
 </div>
 <div>
 <div className="text-lg font-bold text-warning">{summary.by_severity.warning}</div>
 <div className="text-xs text-muted-foreground">تحذير</div>
 </div>
 </div>
 </Card>
 <Card className="p-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilter(filter === 'success' ? 'all' : 'success')}>
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 rounded-full bg-success flex items-center justify-center">
 <CheckCircle className="h-4 w-4 text-success" />
 </div>
 <div>
 <div className="text-lg font-bold text-success">{summary.by_severity.success}</div>
 <div className="text-xs text-muted-foreground">نجاح</div>
 </div>
 </div>
 </Card>
 <Card className="p-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilter(filter === 'info' ? 'all' : 'info')}>
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 rounded-full bg-whale flex items-center justify-center">
 <Info className="h-4 w-4 text-whale" />
 </div>
 <div>
 <div className="text-lg font-bold text-whale">{summary.by_severity.info}</div>
 <div className="text-xs text-muted-foreground">معلومة</div>
 </div>
 </div>
 </Card>
 </div>

 {/* Filter */}
 {filter !== 'all' && (
 <Button variant="outline" size="sm" onClick={() => setFilter('all')}>
 عرض الكل ({summary.total})
 </Button>
 )}

 {/* Alerts List */}
 <div className="space-y-3 max-h-96 overflow-y-auto">
 {filteredAlerts.map((alert) => (
 <Card key={alert.id} className={cn('border-r-4', severityColors[alert.severity])}>
 <CardContent className="p-4">
 <div className="flex items-start gap-3">
 <div className="shrink-0 mt-1">
 {typeIcons[alert.type]}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 mb-1">
 <span className="font-bold">{alert.ticker}</span>
 <Badge variant="outline" className="text-xs">
 {typeLabels[alert.type]}
 </Badge>
 <Badge className={cn('text-xs', severityBadgeColors[alert.severity])}>
 {alert.severity === 'danger' ? 'خطر' : 
 alert.severity === 'warning' ? 'تحذير' : 
 alert.severity === 'success' ? 'نجاح' : 'معلومة'}
 </Badge>
 </div>
 <p className="text-sm">{alert.message}</p>
 
 {/* Details */}
 <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
 <span>الشراء: {(alert.details?.buyPrice ?? 0).toFixed(2)}</span>
 <span>الحالي: {(alert.details?.currentPrice ?? 0).toFixed(2)}</span>
 <span className={cn(
 "font-medium",
 (alert.details?.profitLossPercent ?? 0) >= 0 ? "text-success" : "text-loss"
 )}>
 {(alert.details?.profitLossPercent ?? 0) >= 0 ? '+' : ''}{(alert.details?.profitLossPercent ?? 0).toFixed(1)}%
 </span>
 </div>
 
 {/* Action Suggestion */}
 {alert.action && (
 <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
 <span className="text-muted-foreground">الاقتراح: </span>
 <span className="font-medium">{alert.action}</span>
 </div>
 )}
 </div>
 </div>
 </CardContent>
 </Card>
 ))}
 </div>

 {/* Type Summary */}
 <Card className="bg-muted/30">
 <CardContent className="p-3">
 <div className="flex flex-wrap gap-2 text-xs">
 {summary.by_type.profit_target > 0 && (
 <Badge variant="outline" className="bg-success text-success">
 🎯 {summary.by_type.profit_target} هدف ربح
 </Badge>
 )}
 {summary.by_type.stop_loss > 0 && (
 <Badge variant="outline" className="bg-loss text-loss">
 🛡️ {summary.by_type.stop_loss} وقف خسارة
 </Badge>
 )}
 {summary.by_type.support_near > 0 && (
 <Badge variant="outline" className="bg-primary text-whale">
 📥 {summary.by_type.support_near} قريب من دعم
 </Badge>
 )}
 {summary.by_type.resistance_near > 0 && (
 <Badge variant="outline" className="bg-warning text-warning">
 📤 {summary.by_type.resistance_near} قريب من مقاومة
 </Badge>
 )}
 {summary.by_type.dividend_soon > 0 && (
 <Badge variant="outline" className="bg-primary text-primary">
 💰 {summary.by_type.dividend_soon} أرباح
 </Badge>
 )}
 {summary.by_type.breakout > 0 && (
 <Badge variant="outline" className="bg-success text-success">
 {summary.by_type.breakout} كسر مقاومة
 </Badge>
 )}
 {summary.by_type.breakdown > 0 && (
 <Badge variant="outline" className="bg-loss text-loss">
 📉 {summary.by_type.breakdown} كسر دعم
 </Badge>
 )}
 </div>
 </CardContent>
 </Card>
 </div>
 );
}

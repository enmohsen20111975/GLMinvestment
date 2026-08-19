'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Eye,
  Bell,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  Info,
  RefreshCw,
  DollarSign,
  BarChart3,
  Activity,
  Wallet,
  Landmark,
  Gem,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Types
interface TradingViewData {
  technical_rating: string;
  recommendation: string;
  rsi: number | null;
  macd: number | null;
  performance: { week: string | null; month: string | null; year: string | null };
  valuation: { pe: string | null; pb: string | null };
  dividend_yield: string | null;
}

interface SmartAlert {
  id: string;
  type: string;
  severity: 'danger' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
}

interface SmartWatchlistItem {
  id: number;
  type: 'stock' | 'bank' | 'gold';
  ticker: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  total_invested: number;
  current_price: number;
  current_value: number;
  profit_loss: number;
  profit_loss_percent: number;
  tradingview: TradingViewData;
  alerts: SmartAlert[];
  action: {
    type: string;
    confidence: number;
    reason: string;
    target_price?: number;
    stop_loss?: number;
  };
}

interface Summary {
  total_items: number;
  total_invested: number;
  total_value: number;
  total_profit_loss: number;
  alerts_count: number;
  alerts_by_severity: {
    danger: number;
    warning: number;
    info: number;
    success: number;
  };
}

// Helpers
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    maximumFractionDigits: 0
  }).format(value) + ' ج.م';
}

function getActionColor(type: string): string {
  switch (type) {
    case 'SELL':
    case 'TAKE_PROFIT': return 'bg-red-500 text-white';
    case 'BUY_MORE': return 'bg-green-500 text-white';
    case 'AVERAGE_DOWN': return 'bg-blue-500 text-white';
    default: return 'bg-yellow-500 text-white';
  }
}

function getActionIcon(type: string) {
  switch (type) {
    case 'SELL':
    case 'TAKE_PROFIT': return <TrendingDown className="h-3 w-3" />;
    case 'BUY_MORE':
    case 'AVERAGE_DOWN': return <TrendingUp className="h-3 w-3" />;
    default: return <Minus className="h-3 w-3" />;
  }
}

function getActionText(type: string): string {
  switch (type) {
    case 'SELL': return 'بيع';
    case 'TAKE_PROFIT': return 'جني أرباح';
    case 'BUY_MORE': return 'شراء زيادة';
    case 'AVERAGE_DOWN': return 'متوسط سعر';
    default: return 'احتفاظ';
  }
}

function getRecommendationColor(rec: string): string {
  switch (rec) {
    case 'STRONG_BUY': return 'text-green-600 bg-green-100';
    case 'BUY': return 'text-green-500 bg-green-50';
    case 'STRONG_SELL': return 'text-red-600 bg-red-100';
    case 'SELL': return 'text-red-500 bg-red-50';
    default: return 'text-yellow-600 bg-yellow-100';
  }
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'danger': return 'border-red-300 bg-red-50 dark:bg-red-950/20';
    case 'warning': return 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20';
    case 'success': return 'border-green-300 bg-green-50 dark:bg-green-950/20';
    default: return 'border-blue-300 bg-blue-50 dark:bg-blue-950/20';
  }
}

// Components
function WatchlistItemCard({ item, expanded, onToggle }: { 
  item: SmartWatchlistItem; 
  expanded: boolean;
  onToggle: () => void;
}) {
  const typeIcon = item.type === 'stock' ? <BarChart3 className="h-4 w-4" /> :
                   item.type === 'bank' ? <Landmark className="h-4 w-4" /> :
                   <Gem className="h-4 w-4 text-yellow-600" />;
  
  return (
    <Card className={cn(
      "cursor-pointer transition-all hover:shadow-md",
      item.profit_loss_percent > 10 && "border-green-300",
      item.profit_loss_percent < -10 && "border-red-300"
    )} onClick={onToggle}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge className={getActionColor(item.action.type)}>
              {getActionIcon(item.action.type)}
              <span className="mr-1">{getActionText(item.action.type)}</span>
            </Badge>
            <div>
              <div className="flex items-center gap-2">
                {typeIcon}
                <span className="font-bold">{item.ticker}</span>
              </div>
              <div className="text-sm text-muted-foreground">{item.name}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="text-left">
              <div className={cn(
                "font-bold",
                item.profit_loss >= 0 ? "text-green-600" : "text-red-600"
              )}>
                {item.profit_loss >= 0 ? '+' : ''}{formatCurrency(item.profit_loss)}
              </div>
              <div className={cn(
                "text-sm text-right",
                item.profit_loss_percent >= 0 ? "text-green-600" : "text-red-600"
              )}>
                {item.profit_loss_percent >= 0 ? '+' : ''}{item.profit_loss_percent.toFixed(1)}%
              </div>
            </div>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
        
        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t space-y-4">
            {/* Position Details */}
            <div className="grid grid-cols-4 gap-2 text-sm">
              <div className="bg-muted/50 p-2 rounded">
                <div className="text-muted-foreground">الكمية</div>
                <div className="font-medium">{item.quantity.toLocaleString('ar-EG')}</div>
              </div>
              <div className="bg-muted/50 p-2 rounded">
                <div className="text-muted-foreground">سعر الشراء</div>
                <div className="font-medium">{item.avg_buy_price.toFixed(2)}</div>
              </div>
              <div className="bg-muted/50 p-2 rounded">
                <div className="text-muted-foreground">السعر الحالي</div>
                <div className="font-medium">{item.current_price.toFixed(2)}</div>
              </div>
              <div className="bg-muted/50 p-2 rounded">
                <div className="text-muted-foreground">القيمة</div>
                <div className="font-medium">{formatCurrency(item.current_value)}</div>
              </div>
            </div>
            
            {/* TradingView Integration */}
            {item.type === 'stock' && (
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-blue-600" />
                  <span className="font-medium text-sm">TradingView</span>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">التوقعة الفنية</div>
                    <Badge className={getRecommendationColor(item.tradingview.recommendation)}>
                      {item.tradingview.technical_rating}
                    </Badge>
                  </div>
                  {item.tradingview.rsi !== null && (
                    <div>
                      <div className="text-muted-foreground text-xs">RSI</div>
                      <div className="font-medium">{item.tradingview.rsi.toFixed(0)}</div>
                    </div>
                  )}
                  {item.tradingview.valuation.pe && (
                    <div>
                      <div className="text-muted-foreground text-xs">P/E</div>
                      <div className="font-medium">{item.tradingview.valuation.pe}</div>
                    </div>
                  )}
                  {item.tradingview.dividend_yield && (
                    <div>
                      <div className="text-muted-foreground text-xs">عائد الأرباح</div>
                      <div className="font-medium">{item.tradingview.dividend_yield}</div>
                    </div>
                  )}
                </div>
                
                {/* Performance */}
                <div className="flex gap-4 mt-2 text-xs">
                  {item.tradingview.performance.week && (
                    <span>أسبوع: {item.tradingview.performance.week}</span>
                  )}
                  {item.tradingview.performance.month && (
                    <span>شهر: {item.tradingview.performance.month}</span>
                  )}
                  {item.tradingview.performance.year && (
                    <span>سنة: {item.tradingview.performance.year}</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Action Details */}
            <div className="bg-muted/30 p-3 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <span className="font-medium">التوقعة</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">الثقة:</span>
                  <span className="font-medium">{item.action.confidence}%</span>
                </div>
              </div>
              <p className="text-sm">{item.action.reason}</p>
              
              <div className="flex gap-4 mt-2 text-sm">
                {item.action.target_price && (
                  <div className="flex items-center gap-1 text-green-600">
                    <Target className="h-3 w-3" />
                    <span>الهدف: {item.action.target_price.toFixed(2)}</span>
                  </div>
                )}
                {item.action.stop_loss && (
                  <div className="flex items-center gap-1 text-red-600">
                    <ShieldAlert className="h-3 w-3" />
                    <span>وقف الخسارة: {item.action.stop_loss.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Alerts */}
            {item.alerts.length > 0 && (
              <div className="space-y-2">
                {item.alerts.map(alert => (
                  <div key={alert.id} className={cn(
                    "p-2 rounded border-r-4 text-sm",
                    getSeverityColor(alert.severity)
                  )}>
                    <div className="font-medium">{alert.title}</div>
                    <div className="text-muted-foreground">{alert.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Main Component
export function ProfessionalWatchlistView() {
  const [data, setData] = useState<{ watchlist: SmartWatchlistItem[]; alerts: SmartAlert[]; summary: Summary } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  
  useEffect(() => {
    fetchData();
  }, []);
  
  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/smart-watchlist');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch (e) {
      console.error('Error fetching watchlist:', e);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  
  if (!data) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <Eye className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">لا توجد بيانات</p>
        </CardContent>
      </Card>
    );
  }
  
  const { watchlist, alerts, summary } = data;
  const safeSummary = summary || {} as Summary;
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">قائمة المراقبة الذكية</h2>
          <Badge variant="secondary">{safeSummary.total_items ?? 0}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 ml-2" />
          تحديث
        </Button>
      </div>
      
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Wallet className="h-4 w-4" />
            <span className="text-xs">إجمالي الاستثمار</span>
          </div>
          <div className="text-lg font-bold">{formatCurrency(safeSummary.total_invested ?? 0)}</div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs">القيمة الحالية</span>
          </div>
          <div className="text-lg font-bold">{formatCurrency(safeSummary.total_value ?? 0)}</div>
        </Card>
        <Card className={cn("p-3", (safeSummary.total_profit_loss ?? 0) >= 0 ? "bg-green-50" : "bg-red-50")}>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Activity className="h-4 w-4" />
            <span className="text-xs">الربح/الخسارة</span>
          </div>
          <div className={cn(
            "text-lg font-bold",
            (safeSummary.total_profit_loss ?? 0) >= 0 ? "text-green-600" : "text-red-600"
          )}>
            {(safeSummary.total_profit_loss ?? 0) >= 0 ? '+' : ''}{formatCurrency(safeSummary.total_profit_loss ?? 0)}
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Bell className="h-4 w-4" />
            <span className="text-xs">التنبيهات</span>
          </div>
          <div className="text-lg font-bold">{safeSummary.alerts_count ?? 0}</div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-xs">خطر</span>
          </div>
          <div className="text-lg font-bold text-red-600">{summary.alerts_by_severity.danger}</div>
        </Card>
      </div>
      
      {/* Alerts Summary */}
      {alerts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="h-4 w-4 text-orange-600" />
              <span className="font-medium">أهم التنبيهات</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {alerts.slice(0, 4).map(alert => (
                <div key={alert.id} className={cn(
                  "p-2 rounded border-r-4 text-sm",
                  getSeverityColor(alert.severity)
                )}>
                  <span className="font-medium">{alert.title}</span>
                  <span className="text-muted-foreground mr-1">- {alert.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Watchlist Items */}
      <div className="space-y-3">
        {watchlist.map(item => (
          <WatchlistItemCard 
            key={item.id} 
            item={item} 
            expanded={expandedItem === item.id}
            onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
          />
        ))}
      </div>
    </div>
  );
}

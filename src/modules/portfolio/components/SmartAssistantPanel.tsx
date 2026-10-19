'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Bot,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  ShieldAlert,
  Lightbulb,
  AlertTriangle,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  DollarSign,
  BarChart3,
  Activity,
  Wallet,
  Landmark,
  Gem,
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface StockAnalysis {
  asset: {
    id: number;
    type: string;
    name: string;
    stock_ticker: string | null;
    quantity: number | null;
    avg_buy_price: number | null;
    total_invested: number;
  };
  stockInfo: {
    ticker: string;
    name_ar: string;
    current_price: number;
    support: number;
    resistance: number;
    trend: string;
    dividend_yield: number;
  } | null;
  currentValue: number;
  profitLoss: number;
  profitLossPercent: number;
  profitLossPerShare: number;
  recommendation: {
    action: 'SELL' | 'HOLD' | 'BUY_MORE' | 'AVERAGE_DOWN';
    confidence: number;
    reasons: string[];
    targetPrice?: number;
    stopLoss?: number;
    urgency: 'high' | 'medium' | 'low';
  };
  alerts: string[];
  technicalSignals: {
    nearSupport: boolean;
    nearResistance: boolean;
    aboveMA50: boolean | null;
    aboveMA200: boolean | null;
    rsiLevel: string;
    trendDirection: string;
  };
}

interface BankAnalysis {
  id: number;
  type: string;
  name: string;
  total_invested: number;
  bank_name: string | null;
  interest_rate: number | null;
  currentValue: number;
  monthlyReturn: number;
  yearlyReturn: number;
  recommendation: {
    action: string;
    confidence: number;
    reasons: string[];
    urgency: string;
  };
  alerts: string[];
}

interface GoldAnalysis {
  id: number;
  type: string;
  name: string;
  total_invested: number;
  weight_grams: number | null;
  karat: number | null;
  currentValue: number;
  profitLoss: number;
  profitLossPercent: number;
  currentPricePerGram: number;
  recommendation: {
    action: string;
    confidence: number;
    reasons: string[];
    urgency: string;
  };
  alerts: string[];
}

interface PortfolioSummary {
  totalInvested: number;
  totalValue: number;
  totalProfitLoss: number;
  totalProfitLossPercent: number;
}

interface SmartAnalysisData {
  stocks: StockAnalysis[];
  banks: BankAnalysis[];
  gold: GoldAnalysis[];
  summary: PortfolioSummary;
}

export function SmartAssistantPanel() {
  const [data, setData] = useState<SmartAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedStock, setExpandedStock] = useState<number | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/smart-analysis');
      const json = await res.json();
      if (json.success) {
        setData({
          ...json.data,
          stocks: json.data.stocks || [],
          banks: json.data.banks || [],
          gold: json.data.gold || [],
        });
      }
    } catch (e) {
      console.error('Error fetching smart analysis:', e);
    } finally {
      setLoading(false);
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'SELL':
        return { color: 'bg-loss text-white', icon: <TrendingDown className="h-3 w-3" />, text: 'بيع' };
      case 'BUY_MORE':
        return { color: 'bg-success text-white', icon: <TrendingUp className="h-3 w-3" />, text: 'شراء زيادة' };
      case 'AVERAGE_DOWN':
        return { color: 'bg-whale text-white', icon: <Target className="h-3 w-3" />, text: 'متوسط' };
      default:
        return { color: 'bg-warning text-white', icon: <Minus className="h-3 w-3" />, text: 'احتفاظ' };
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'high': return 'text-loss';
      case 'medium': return 'text-warning';
      default: return 'text-profit';
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">لا توجد بيانات محفظة</p>
        </CardContent>
      </Card>
    );
  }

  const allAlerts = [
    ...data.stocks.flatMap(s => s.alerts.map(a => ({ type: 'stock', ticker: s.asset.stock_ticker, alert: a }))),
    ...data.banks.flatMap(b => b.alerts.map(a => ({ type: 'bank', name: b.name, alert: a }))),
    ...data.gold.flatMap(g => g.alerts.map(a => ({ type: 'gold', name: g.name, alert: a })))
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold">المساعد المالى الذكى</h2>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 ml-2" />
          تحديث
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 bg-gradient-to-br from-primary to-primary dark:from-primary dark:to-primary">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="h-4 w-4 text-whale" />
            <span className="text-sm text-muted-foreground">إجمالى الاستثمار</span>
          </div>
          <div className="text-xl font-bold text-whale dark:text-whale">
            {data.summary.totalInvested.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
          </div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">القيمة الحالية</span>
          </div>
          <div className="text-xl font-bold text-primary dark:text-primary">
            {data.summary.totalValue.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
          </div>
        </Card>
        <Card className={cn(
          "p-4",
          data.summary.totalProfitLoss >= 0 
            ? "bg-gradient-to-br from-success to-success dark:from-success dark:to-success"
            : "bg-gradient-to-br from-loss to-loss dark:from-loss dark:to-loss"
        )}>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className={cn(
              "h-4 w-4",
              data.summary.totalProfitLoss >= 0 ? "text-profit" : "text-loss"
            )} />
            <span className="text-sm text-muted-foreground">الربح/الخسارة</span>
          </div>
          <div className={cn(
            "text-xl font-bold",
            data.summary.totalProfitLoss >= 0 
              ? "text-profit dark:text-success"
              : "text-loss dark:text-loss"
          )}>
            {data.summary.totalProfitLoss >= 0 ? '+' : ''}
            {data.summary.totalProfitLoss.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
          </div>
          <div className={cn(
            "text-xs",
            data.summary.totalProfitLossPercent >= 0 ? "text-profit" : "text-loss"
          )}>
            ({data.summary.totalProfitLossPercent >= 0 ? '+' : ''}{(data.summary.totalProfitLossPercent ?? 0).toFixed(2)}%)
          </div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-warning" />
            <span className="text-sm text-muted-foreground">عدد الأصول</span>
          </div>
          <div className="text-xl font-bold text-warning dark:text-warning">
            {data.stocks.length + data.banks.length + data.gold.length}
          </div>
          <div className="text-xs text-muted-foreground">
            {data.stocks.length} سهم • {data.banks.length} بنك • {data.gold.length} ذهب
          </div>
        </Card>
      </div>

      {/* Alerts Section */}
      {allAlerts.length > 0 && (
        <Card className="border-orange-200 bg-warning dark:bg-warning/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-warning" />
              تنبيهات هامة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {allAlerts.slice(0, 5).map((item, i) => (
                <div key={i} className="text-sm p-2 bg-white dark:bg-muted rounded border">
                  <span className="font-medium">{item.ticker || item.name}:</span>{' '}
                  <span className="text-muted-foreground">{item.alert}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stocks Analysis */}
      {data.stocks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              تحليل الأسهم ({data.stocks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.stocks.map((stock, i) => {
              const actionInfo = getActionBadge(stock.recommendation.action);
              const isExpanded = expandedStock === stock.asset.id;
              
              return (
                <Card 
                  key={i} 
                  className={cn(
                    "cursor-pointer transition-all hover:shadow-md",
                    stock.profitLossPercent > 10 && "border-success",
                    stock.profitLossPercent < -10 && "border-loss"
                  )}
                  onClick={() => setExpandedStock(isExpanded ? null : stock.asset.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge className={actionInfo.color}>
                          {actionInfo.icon}
                          <span className="mr-1">{actionInfo.text}</span>
                        </Badge>
                        <div>
                          <div className="font-bold">{stock.asset.stock_ticker}</div>
                          <div className="text-sm text-muted-foreground">{stock.asset.name}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-left">
                          <div className={cn(
                            "font-bold",
                            stock.profitLoss >= 0 ? "text-profit" : "text-loss"
                          )}>
                            {stock.profitLoss >= 0 ? '+' : ''}
                            {stock.profitLoss.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
                          </div>
                          <div className={cn(
                            "text-sm",
                            stock.profitLossPercent >= 0 ? "text-profit" : "text-loss"
                          )}>
                            ({stock.profitLossPercent >= 0 ? '+' : ''}{(stock.profitLossPercent ?? 0).toFixed(1)}%)
                          </div>
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t space-y-4">
                        {/* Recommendation */}
                        <div className="bg-muted/50 p-3 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Lightbulb className="h-4 w-4 text-warning" />
                              <span className="font-medium">التوقّع</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Progress value={stock.recommendation.confidence} className="w-16 h-2" />
                              <span className="text-sm text-muted-foreground">{stock.recommendation.confidence}%</span>
                            </div>
                          </div>
                          <ul className="space-y-1">
                            {stock.recommendation.reasons.map((reason, idx) => (
                              <li key={idx} className="text-sm flex items-start gap-2">
                                <span className="text-primary">•</span>
                                <span>{reason}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Price Details */}
                        {stock.stockInfo && (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                            <div className="bg-muted/50 p-2 rounded">
                              <div className="text-muted-foreground">سعر الشراء</div>
                              <div className="font-medium">{stock.asset.avg_buy_price?.toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/50 p-2 rounded">
                              <div className="text-muted-foreground">السعر الحالى</div>
                              <div className="font-medium">{(stock.stockInfo.current_price ?? 0).toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/50 p-2 rounded">
                              <div className="text-muted-foreground">الدعم</div>
                              <div className="font-medium text-profit">{(stock.stockInfo.support ?? 0).toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/50 p-2 rounded">
                              <div className="text-muted-foreground">المقاومة</div>
                              <div className="font-medium text-loss">{(stock.stockInfo.resistance ?? 0).toFixed(2)}</div>
                            </div>
                          </div>
                        )}

                        {/* Target & Stop Loss */}
                        {(stock.recommendation.targetPrice || stock.recommendation.stopLoss) && (
                          <div className="flex gap-4">
                            {stock.recommendation.targetPrice && (
                              <div className="flex items-center gap-2 text-sm">
                                <Target className="h-4 w-4 text-profit" />
                                <span>الهدف: <strong>{(stock.recommendation.targetPrice ?? 0).toFixed(2)}</strong></span>
                              </div>
                            )}
                            {stock.recommendation.stopLoss && (
                              <div className="flex items-center gap-2 text-sm">
                                <ShieldAlert className="h-4 w-4 text-loss" />
                                <span>وقف الخسارة: <strong>{(stock.recommendation.stopLoss ?? 0).toFixed(2)}</strong></span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Technical Signals */}
                        <div className="flex flex-wrap gap-2">
                          {stock.technicalSignals.nearSupport && (
                            <Badge variant="outline" className="bg-success text-profit border-success">
                              قريب من دعم
                            </Badge>
                          )}
                          {stock.technicalSignals.nearResistance && (
                            <Badge variant="outline" className="bg-loss text-loss border-loss">
                              قريب من مقاومة
                            </Badge>
                          )}
                          {stock.stockInfo?.dividend_yield && stock.stockInfo.dividend_yield > 4 && (
                            <Badge variant="outline" className="bg-primary text-whale border-whale">
                              يوزع {(stock.stockInfo.dividend_yield ?? 0).toFixed(1)}% أرباح
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Bank Deposits */}
      {data.banks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="h-4 w-4 text-primary" />
              الشهادات البنكية ({data.banks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.banks.map((bank, i) => (
              <Card key={i} className="bg-muted/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold">{bank.name}</div>
                      <div className="text-sm text-muted-foreground">{bank.bank_name}</div>
                    </div>
                    <div className="text-left">
                      <Badge className="bg-success text-white">{bank.interest_rate}% سنوياً</Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">المبلغ</div>
                      <div className="font-medium">{bank.total_invested.toLocaleString('ar-EG')} ج.م</div>
                    </div>
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">عائد شهرى</div>
                      <div className="font-medium text-profit">{bank.monthlyReturn.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م</div>
                    </div>
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">عائد سنوى</div>
                      <div className="font-medium text-profit">{bank.yearlyReturn.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Gold */}
      {data.gold.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gem className="h-4 w-4 text-warning" />
              الذهب ({data.gold.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.gold.map((gold, i) => (
              <Card key={i} className="bg-warning dark:bg-warning/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold">{gold.name}</div>
                      <div className="text-sm text-muted-foreground">{gold.weight_grams} جرام - {gold.karat} قراط</div>
                    </div>
                    <div className="text-left">
                      <div className={cn(
                        "font-bold",
                        gold.profitLoss >= 0 ? "text-profit" : "text-loss"
                      )}>
                        {gold.profitLoss >= 0 ? '+' : ''}{(gold.profitLossPercent ?? 0).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">سعر الشراء/جرام</div>
                      <div className="font-medium">{gold.purchase_price_per_gram?.toLocaleString('ar-EG')}</div>
                    </div>
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">السعر الحالى/جرام</div>
                      <div className="font-medium">{gold.currentPricePerGram.toLocaleString('ar-EG')}</div>
                    </div>
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">القيمة الحالية</div>
                      <div className="font-medium">{gold.currentValue.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">المساعد المالى الذكى</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• التحليلات مبنية على بيانات السوق الحالية</li>
                <li>• التوقعات استرشادية - قرارات الاستثمار مسؤوليتك</li>
                <li>• راقب التنبيهات وتصرف بحكمة</li>
                <li>• المتوسط السعر مفيد لتقليل التكلفة عند الخسارة</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

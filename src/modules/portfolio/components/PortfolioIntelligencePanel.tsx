'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  ShieldAlert,
  Lightbulb,
  BarChart3,
  Newspaper,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PortfolioStock {
  ticker: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  current_price: number;
  total_value: number;
  profit_loss: number;
  profit_loss_percent: number;
  sector: string;
}

interface StockRecommendation {
  ticker: string;
  action: 'BUY' | 'HOLD' | 'SELL';
  confidence: number;
  target_price: number | null;
  stop_loss: number | null;
  reason: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface StockAnalysis {
  ticker: string;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  support: number;
  resistance: number;
  rsi: number;
  macd_signal: string;
  volume_trend: string;
}

interface PortfolioData {
  portfolio: PortfolioStock[];
  recommendations: StockRecommendation[];
  analyses: StockAnalysis[];
  summary: {
    total_stocks: number;
    total_value: number;
    total_cost: number;
    total_pnl: number;
    total_pnl_percent: number;
    buy_signals: number;
    sell_signals: number;
    hold_signals: number;
  };
}

export function PortfolioIntelligencePanel() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio/intelligence');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch (e) {
      console.error('Error fetching portfolio intelligence:', e);
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'BUY': return 'bg-success text-white';
      case 'SELL': return 'bg-loss text-white';
      default: return 'bg-yellow-500 text-white';
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'BUY': return <TrendingUp className="h-3 w-3" />;
      case 'SELL': return <TrendingDown className="h-3 w-3" />;
      default: return <Minus className="h-3 w-3" />;
    }
  };

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'BULLISH': return 'text-profit';
      case 'BEARISH': return 'text-loss';
      default: return 'text-yellow-600';
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'LOW': return 'bg-success text-profit';
      case 'HIGH': return 'bg-loss text-loss';
      default: return 'bg-yellow-100 text-yellow-700';
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">ذكاء المحفظة</h2>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 ml-2" />
          تحديث
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-sm text-muted-foreground">إجمالى القيمة</div>
          <div className="text-xl font-bold">
            {data.summary.total_value.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-sm text-muted-foreground">الربح/الخسارة</div>
          <div className={cn(
            "text-xl font-bold",
            data.summary.total_pnl >= 0 ? "text-profit" : "text-loss"
          )}>
            {data.summary.total_pnl >= 0 ? '+' : ''}
            {data.summary.total_pnl.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
          </div>
          <div className={cn(
            "text-xs",
            data.summary.total_pnl_percent >= 0 ? "text-profit" : "text-loss"
          )}>
            ({(data.summary.total_pnl_percent ?? 0) >= 0 ? '+' : ''}{(data.summary.total_pnl_percent ?? 0).toFixed(2)}%)
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-1">
            <CheckCircle className="h-4 w-4 text-profit" />
            <span className="text-sm">شراء</span>
          </div>
          <div className="text-xl font-bold text-profit">{data.summary.buy_signals}</div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-1">
            <XCircle className="h-4 w-4 text-loss" />
            <span className="text-sm">بيع</span>
          </div>
          <div className="text-xl font-bold text-loss">{data.summary.sell_signals}</div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="recommendations" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="recommendations">
            <Lightbulb className="h-4 w-4 ml-2" />
            التوقعات
          </TabsTrigger>
          <TabsTrigger value="analysis">
            <BarChart3 className="h-4 w-4 ml-2" />
            التحليلات
          </TabsTrigger>
          <TabsTrigger value="portfolio">
            <Activity className="h-4 w-4 ml-2" />
            المحفظة
          </TabsTrigger>
        </TabsList>

        {/* Recommendations Tab */}
        <TabsContent value="recommendations" className="space-y-3 mt-4">
          {data.recommendations.map((rec, i) => {
            const stock = data.portfolio.find(s => s.ticker === rec.ticker);
            return (
              <Card 
                key={i} 
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
                  selectedTicker === rec.ticker && "ring-2 ring-primary"
                )}
                onClick={() => setSelectedTicker(selectedTicker === rec.ticker ? null : rec.ticker)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge className={getActionColor(rec.action)}>
                        {getActionIcon(rec.action)}
                        <span className="mr-1">{rec.action === 'BUY' ? 'شراء' : rec.action === 'SELL' ? 'بيع' : 'احتفاظ'}</span>
                      </Badge>
                      <div>
                        <div className="font-bold">{rec.ticker}</div>
                        <div className="text-sm text-muted-foreground">{stock?.name}</div>
                      </div>
                    </div>
                    <div className="text-left">
                      <Badge className={getRiskColor(rec.risk_level)}>
                        {rec.risk_level === 'LOW' ? 'مخاطر منخفضة' : rec.risk_level === 'HIGH' ? 'مخاطر عالية' : 'مخاطر متوسطة'}
                      </Badge>
                    </div>
                  </div>
                  
                  {selectedTicker === rec.ticker && (
                    <div className="mt-4 pt-4 border-t space-y-3">
                      <p className="text-sm">{rec.reason}</p>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        {rec.target_price && (
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-profit" />
                            <span>الهدف: {(rec.target_price ?? 0).toFixed(2)} ج.م</span>
                          </div>
                        )}
                        {rec.stop_loss && (
                          <div className="flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 text-loss" />
                            <span>وقف الخسارة: {(rec.stop_loss ?? 0).toFixed(2)} ج.م</span>
                          </div>
                        )}
                      </div>

                      {stock && (
                        <div className="grid grid-cols-3 gap-2 text-sm bg-muted/50 p-2 rounded">
                          <div>
                            <span className="text-muted-foreground">الكمية:</span>
                            <span className="font-medium mr-1">{stock.quantity}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">متوسط:</span>
                            <span className="font-medium mr-1">{(stock.avg_buy_price ?? 0).toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">الحالي:</span>
                            <span className="font-medium mr-1">{(stock.current_price ?? 0).toFixed(2)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Analysis Tab */}
        <TabsContent value="analysis" className="space-y-3 mt-4">
          {data.analyses.map((analysis, i) => {
            const stock = data.portfolio.find(s => s.ticker === analysis.ticker);
            return (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-bold">{analysis.ticker}</div>
                      <div className="text-sm text-muted-foreground">{stock?.name}</div>
                    </div>
                    <Badge className={cn(
                      "text-white",
                      analysis.trend === 'BULLISH' ? "bg-success" : 
                      analysis.trend === 'BEARISH' ? "bg-loss" : "bg-yellow-500"
                    )}>
                      {analysis.trend === 'BULLISH' ? 'صاعد' : analysis.trend === 'BEARISH' ? 'هابط' : 'محايد'}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">الدعم</div>
                      <div className="font-medium">{(analysis.support ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">المقاومة</div>
                      <div className="font-medium">{(analysis.resistance ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">RSI</div>
                      <div className={cn(
                        "font-medium",
                        analysis.rsi > 70 ? "text-loss" : 
                        analysis.rsi < 30 ? "text-profit" : ""
                      )}>
                        {(analysis.rsi ?? 0).toFixed(0)}
                      </div>
                    </div>
                    <div className="bg-muted/50 p-2 rounded">
                      <div className="text-muted-foreground">MACD</div>
                      <div className="font-medium text-xs">{analysis.macd_signal}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Portfolio Tab */}
        <TabsContent value="portfolio" className="space-y-3 mt-4">
          {data.portfolio.map((stock, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold">{stock.ticker}</div>
                    <div className="text-sm text-muted-foreground">{stock.name}</div>
                  </div>
                  <div className="text-left">
                    <div className={cn(
                      "font-bold",
                      (stock.profit_loss ?? 0) >= 0 ? "text-profit" : "text-loss"
                    )}>
                      {(stock.profit_loss ?? 0) >= 0 ? '+' : ''}
                      {(stock.profit_loss ?? 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
                    </div>
                    <div className={cn(
                      "text-sm",
                      (stock.profit_loss_percent ?? 0) >= 0 ? "text-profit" : "text-loss"
                    )}>
                      ({(stock.profit_loss_percent ?? 0) >= 0 ? '+' : ''}{(stock.profit_loss_percent ?? 0).toFixed(2)}%)
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-4 gap-2 mt-3 text-sm bg-muted/50 p-2 rounded">
                  <div>
                    <span className="text-muted-foreground">الكمية:</span>
                    <span className="font-medium mr-1">{stock.quantity}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">متوسط:</span>
                    <span className="font-medium mr-1">{(stock.avg_buy_price ?? 0).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">الحالي:</span>
                    <span className="font-medium mr-1">{(stock.current_price ?? 0).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">القيمة:</span>
                    <span className="font-medium mr-1">{(stock.total_value ?? 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

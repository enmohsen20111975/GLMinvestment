'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Target, CheckCircle, XCircle,
  BarChart3, Calendar, RefreshCw, Trophy, DollarSign, Activity,
  Award, Zap, Loader2, Brain, User, Bot, LineChart,
  Globe, Clock, PieChart, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface MonthlyData {
  month: string;
  monthName: string;
  total: number;
  successful: number;
  failed: number;
  pending: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  aiProfit: number;
  humanProfit: number;
  successRate: number;
  stocks: Array<{ ticker: string; profit: number; source: string }>;
}

interface SourceStats {
  total: number;
  successful: number;
  failed: number;
  totalProfit: number;
  avgProfit: number;
  successRate: number;
}

interface MarketStats {
  market: string;
  marketName: string;
  total: number;
  successful: number;
  failed: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  successRate: number;
}

interface TopPerformer {
  ticker: string;
  name_ar?: string;
  profit: number;
  source: string;
  market?: string;
  prediction_date?: string;
}

interface PerformanceData {
  success: boolean;
  year: number;
  generatedAt: string;
  summary: {
    totalPredictions: number;
    successful: number;
    failed: number;
    pending: number;
    totalProfit: number;
    totalLoss: number;
    netProfit: number;
    successRate: number;
  };
  monthly: MonthlyData[];
  bySource: {
    ai: SourceStats;
    human: SourceStats;
  };
  byMarket: MarketStats[];
  topPerformers: TopPerformer[];
  hasData?: boolean;
}

const MARKET_CONFIG: Record<string, { name: string; nameAr: string; icon: React.ReactNode; color: string }> = {
  egx: { name: 'EGX', nameAr: 'مصر', icon: <span>🇪🇬</span>, color: 'bg-red-500' },
  tadawul: { name: 'TADAWUL', nameAr: 'السعودية', icon: <span>🇸🇦</span>, color: 'bg-green-500' },
  kse: { name: 'KSE', nameAr: 'الكويت', icon: <span>🇰🇼</span>, color: 'bg-emerald-500' },
  dfm: { name: 'DFM', nameAr: 'دبي', icon: <span>🇦🇪</span>, color: 'bg-blue-500' },
  crypto: { name: 'Crypto', nameAr: 'كريبتو', icon: <span>₿</span>, color: 'bg-orange-500' },
  forex: { name: 'Forex', nameAr: 'فوركس', icon: <span>💱</span>, color: 'bg-purple-500' },
};

const safeToFixed = (val: any, decimals: number = 1, defaultVal: string = '0'): string => {
  if (val === undefined || val === null || isNaN(Number(val))) return defaultVal;
  return Number(val).toFixed(decimals);
};

export function UserPerformanceView() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<string>(new Date().getFullYear().toString());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/monthly-performance?year=${yearFilter}`);
      const jsonData = await res.json();
      if (jsonData.success) {
        setData(jsonData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [yearFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4" dir="rtl">
        {[1, 2, 3].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />)}
      </div>
    );
  }

  // إذا لا توجد بيانات حقيقية
  if (!data || data.hasData === false || data.summary.totalPredictions === 0) {
    return (
      <div className="p-4 md:p-6" dir="rtl">
        <Card className="border-2 border-dashed border-muted-foreground/20">
          <CardContent className="p-8 text-center">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-100 to-purple-100 dark:from-emerald-900/30 dark:to-purple-900/30 flex items-center justify-center mx-auto mb-6">
              <Trophy className="w-12 h-12 text-emerald-500" />
            </div>
            <h3 className="text-2xl font-bold mb-3">🚀 دليل الاستثمار</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              منصة تحليلات استثمارية متقدمة تجمع بين التحليل الفني والأساسي
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto mt-6">
              <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20">
                <Bot className="w-8 h-8 text-purple-500 mx-auto mb-2" />
                <div className="font-bold">تحليلات AI</div>
                <div className="text-xs text-muted-foreground">ذكاء اصطناعي متقدم</div>
              </div>
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                <User className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                <div className="font-bold">خبراء بشريين</div>
                <div className="text-xs text-muted-foreground">محللين محترفين</div>
              </div>
              <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                <Target className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <div className="font-bold">توقعات دقيقة</div>
                <div className="text-xs text-muted-foreground">نتائج موثقة</div>
              </div>
            </div>
            
            <p className="text-sm text-muted-foreground mt-6">
              سيتم عرض تقارير الأداء الفعلية عند توفر البيانات
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">📊 أداء التوقعات</h2>
          <p className="text-muted-foreground text-sm">
            تقرير تجميعي شهري - الأرباح والخسائر الصافية
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2025">2025</SelectItem>
              <SelectItem value="2024">2024</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={fetchData} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 ml-2" />تحديث
          </Button>
        </div>
      </div>

      {/* ===== البطاقة الرئيسية - صافي الربح ===== */}
      <Card className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-emerald-100 text-sm">صافي الربح الكلي</p>
              <p className="text-4xl font-bold mt-1">
                {data.summary.netProfit >= 0 ? '+' : ''}{safeToFixed(data.summary.netProfit, 1)}%
              </p>
              <p className="text-emerald-200 text-sm mt-2">
                {data.summary.totalPredictions} توقع في {data.year}
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 text-emerald-100">
                <TrendingUp className="w-5 h-5" />
                <span>+{safeToFixed(data.summary.totalProfit, 1)}% أرباح</span>
              </div>
              <div className="flex items-center gap-2 text-red-200 mt-1">
                <TrendingDown className="w-5 h-5" />
                <span>-{safeToFixed(data.summary.totalLoss, 1)}% خسائر</span>
              </div>
            </div>
          </div>
          
          {/* نسبة النجاح */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span>نسبة النجاح</span>
              <span>{safeToFixed(data.summary.successRate, 1)}%</span>
            </div>
            <Progress 
              value={data.summary.successRate} 
              className="h-3 bg-emerald-700 [&>div]:bg-white"
            />
          </div>
        </CardContent>
      </Card>

      {/* ===== تقسيم AI vs الخبراء ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AI */}
        <Card className="border-purple-200 dark:border-purple-800">
          <CardHeader className="bg-purple-50 dark:bg-purple-900/20 pb-3">
            <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
              <Bot className="w-5 h-5" />
              🤖 تحليلات AI
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className={cn(
                  "text-3xl font-bold",
                  data.bySource.ai.totalProfit >= 0 ? "text-emerald-600" : "text-red-600"
                )}>
                  {data.bySource.ai.totalProfit >= 0 ? '+' : ''}{safeToFixed(data.bySource.ai.totalProfit, 1)}%
                </div>
                <div className="text-xs text-muted-foreground">صافي الربح</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{data.bySource.ai.total}</div>
                <div className="text-xs text-muted-foreground">توقع</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">نسبة النجاح</span>
              <Badge className="bg-purple-500">{safeToFixed(data.bySource.ai.successRate, 0)}%</Badge>
            </div>
          </CardContent>
        </Card>

        {/* الخبراء */}
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="bg-blue-50 dark:bg-blue-900/20 pb-3">
            <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <User className="w-5 h-5" />
              👤 توقعات الخبراء
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className={cn(
                  "text-3xl font-bold",
                  data.bySource.human.totalProfit >= 0 ? "text-emerald-600" : "text-red-600"
                )}>
                  {data.bySource.human.totalProfit >= 0 ? '+' : ''}{safeToFixed(data.bySource.human.totalProfit, 1)}%
                </div>
                <div className="text-xs text-muted-foreground">صافي الربح</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{data.bySource.human.total}</div>
                <div className="text-xs text-muted-foreground">توقع</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">نسبة النجاح</span>
              <Badge className="bg-blue-500">{safeToFixed(data.bySource.human.successRate, 0)}%</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== التجميع الشهري ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-500" />
            الأداء الشهري
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {data.monthly.map((month) => (
                <div key={month.month} className="p-4 rounded-lg border hover:bg-muted/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">
                        {month.month.split('-')[1]}
                      </div>
                      <div>
                        <div className="font-bold">{month.monthName}</div>
                        <div className="text-xs text-muted-foreground">{month.total} توقع</div>
                      </div>
                    </div>
                    <div className="text-left">
                      <div className={cn(
                        "text-2xl font-bold",
                        month.netProfit >= 0 ? "text-emerald-600" : "text-red-600"
                      )}>
                        {month.netProfit >= 0 ? '+' : ''}{safeToFixed(month.netProfit, 1)}%
                      </div>
                      <div className="text-xs text-muted-foreground">صافي</div>
                    </div>
                  </div>
                  
                  {/* شريط الأرباح والخسائر */}
                  <div className="flex gap-1 h-4 rounded-full overflow-hidden bg-muted">
                    {month.totalProfit > 0 && (
                      <div 
                        className="bg-emerald-500 flex items-center justify-center text-[10px] text-white"
                        style={{ width: `${(month.totalProfit / (month.totalProfit + month.totalLoss)) * 100}%` }}
                      >
                        +{safeToFixed(month.totalProfit, 0)}%
                      </div>
                    )}
                    {month.totalLoss > 0 && (
                      <div 
                        className="bg-red-500 flex items-center justify-center text-[10px] text-white"
                        style={{ width: `${(month.totalLoss / (month.totalProfit + month.totalLoss)) * 100}%` }}
                      >
                        -{safeToFixed(month.totalLoss, 0)}%
                      </div>
                    )}
                  </div>
                  
                  {/* تفاصيل */}
                  <div className="grid grid-cols-4 gap-2 mt-3 text-center text-xs">
                    <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-900/20">
                      <div className="font-bold text-emerald-600">{month.successful}</div>
                      <div className="text-muted-foreground">نجاح</div>
                    </div>
                    <div className="p-2 rounded bg-red-50 dark:bg-red-900/20">
                      <div className="font-bold text-red-600">{month.failed}</div>
                      <div className="text-muted-foreground">خسارة</div>
                    </div>
                    <div className="p-2 rounded bg-purple-50 dark:bg-purple-900/20">
                      <div className="font-bold text-purple-600">+{safeToFixed(month.aiProfit, 0)}%</div>
                      <div className="text-muted-foreground">AI</div>
                    </div>
                    <div className="p-2 rounded bg-blue-50 dark:bg-blue-900/20">
                      <div className="font-bold text-blue-600">+{safeToFixed(month.humanProfit, 0)}%</div>
                      <div className="text-muted-foreground">خبراء</div>
                    </div>
                  </div>
                  
                  {/* أفضل أسهم الشهر */}
                  {month.stocks.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {month.stocks.slice(0, 5).map((stock, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">
                          {stock.ticker}: +{safeToFixed(stock.profit, 1)}%
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ===== تقسيم الأسواق ===== */}
      {data.byMarket.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.byMarket.map((market) => (
            <Card key={market.market} className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="text-2xl">
                  {MARKET_CONFIG[market.market]?.icon || <Globe className="w-6 h-6" />}
                </div>
                <div>
                  <div className="font-bold">{MARKET_CONFIG[market.market]?.nameAr || market.market}</div>
                  <div className="text-xs text-muted-foreground">{market.total} توقع</div>
                </div>
              </div>
              <div className={cn(
                "text-2xl font-bold mb-2",
                market.netProfit >= 0 ? "text-emerald-600" : "text-red-600"
              )}>
                {market.netProfit >= 0 ? '+' : ''}{safeToFixed(market.netProfit, 1)}%
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="text-emerald-600">+{safeToFixed(market.totalProfit, 1)}%</span>
                <span>/</span>
                <span className="text-red-600">-{safeToFixed(market.totalLoss, 1)}%</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">نجاح</span>
                <Badge variant="outline">{safeToFixed(market.successRate, 0)}%</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ===== أفضل الأسهم ===== */}
      {data.topPerformers.length > 0 && (
        <Card className="border-yellow-200 dark:border-yellow-800">
          <CardHeader className="bg-yellow-50 dark:bg-yellow-900/20 pb-3">
            <CardTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
              <Trophy className="w-5 h-5" />
              🏆 أفضل الأسهم
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {data.topPerformers.slice(0, 10).map((stock, i) => (
                <div key={i} className="p-3 rounded-lg border text-center">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-500 text-white text-xs font-bold mx-auto mb-2">
                    {i + 1}
                  </div>
                  <div className="font-bold">{stock.ticker}</div>
                  <div className="text-emerald-600 font-bold">+{safeToFixed(stock.profit, 1)}%</div>
                  <Badge className={cn(
                    "text-[10px] mt-1",
                    stock.source === 'ai' ? "bg-purple-500" : "bg-blue-500"
                  )}>
                    {stock.source === 'ai' ? 'AI' : 'خبير'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== إحصائيات سريعة ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-blue-600">{data.summary.totalPredictions}</p>
          <p className="text-xs text-muted-foreground">إجمالي التوقعات</p>
        </Card>
        <Card className="p-3 text-center bg-emerald-50 dark:bg-emerald-950/20">
          <p className="text-2xl font-bold text-emerald-600">{data.summary.successful}</p>
          <p className="text-xs text-muted-foreground">✅ ناجحة</p>
        </Card>
        <Card className="p-3 text-center bg-red-50 dark:bg-red-950/20">
          <p className="text-2xl font-bold text-red-600">{data.summary.failed}</p>
          <p className="text-xs text-muted-foreground">❌ خاسرة</p>
        </Card>
        <Card className="p-3 text-center">
          <p className={cn(
            "text-2xl font-bold",
            data.summary.successRate >= 50 ? "text-emerald-600" : "text-red-600"
          )}>
            {safeToFixed(data.summary.successRate, 0)}%
          </p>
          <p className="text-xs text-muted-foreground">نسبة النجاح</p>
        </Card>
      </div>
    </div>
  );
}

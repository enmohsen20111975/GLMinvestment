'use client';

import React, { useState, useEffect } from 'react';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  Shield,
  Activity,
  ChevronUp,
  ChevronDown,
  Minus,
  Sparkles,
  BarChart3,
  PieChart,
  Gauge,
  Lightbulb,
  XCircle,
  Info,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  PieChart as RechartsPie,
  Pie,
  Cell,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
  Legend,
} from 'recharts';

// API Response Types (matching backend)
interface PositionAnalysis {
  id: string;
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  sector_ar: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  pnl: number;
  pnl_percent: number;
  entry_date: string | null;
  notes: string | null;
  analysis: {
    signal: string;
    signal_ar: string;
    confidence: number;
    trend: string;
    trend_ar: string;
    support: number | null;
    resistance: number | null;
    rsi: number | null;
    macd: string | null;
    recommendation: {
      action: string;
      action_ar: string;
      reason: string;
      stop_loss: number | null;
      target: number | null;
    };
  } | null;
  alerts: Array<{ type: string; message: string; message_ar: string; priority: string }>;
}

interface PortfolioIntelligenceResponse {
  success: boolean;
  error?: string;
  error_ar?: string;
  summary: {
    total_value: number;
    total_cost: number;
    total_pnl: number;
    total_pnl_percent: number;
    positions_count: number;
    winning_count: number;
    losing_count: number;
    heat: number;
    heat_level: string;
    heat_level_ar: string;
    diversification_score: number;
    sectors: Record<string, number>;
    risk_level: string;
    risk_level_ar: string;
  };
  positions_analysis: PositionAnalysis[];
  stock_alerts: Array<{ type: string; message: string; message_ar: string; priority: string }>;
  portfolio_alerts: Array<{ type: string; message: string; message_ar: string; priority: string }>;
  recommendations: string[];
  timestamp: string;
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0.00 ج.م';
  const numValue = Number(value);
  if (!Number.isFinite(numValue)) return '0.00 ج.م';
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue) + ' ج.م';
}

function formatPercent(value: number | null | undefined): string {
  // Comprehensive null/undefined/NaN check
  if (value === null || value === undefined) return '—';
  const numValue = Number(value);
  if (!Number.isFinite(numValue)) return '—';
  const sign = numValue >= 0 ? '+' : '';
  return `${sign}${numValue.toFixed(2)}%`;
}

function getRSIColor(rsi: number | null | undefined): string {
  if (rsi === null || rsi === undefined || !Number.isFinite(Number(rsi))) return 'text-muted-foreground';
  if (rsi > 70) return 'text-red-500';
  if (rsi < 30) return 'text-emerald-500';
  return 'text-yellow-500';
}

function getRSILabel(rsi: number | null | undefined): string {
  if (rsi === null || rsi === undefined || !Number.isFinite(Number(rsi))) return 'غير متاح';
  if (rsi > 70) return 'تشبع شراء';
  if (rsi < 30) return 'تشبع بيع';
  return 'محايد';
}

function getSignalIcon(signal: string) {
  switch (signal.toLowerCase()) {
    case 'buy':
    case 'strong_buy':
    case 'bullish':
      return <ChevronUp className="w-4 h-4 text-emerald-500" />;
    case 'sell':
    case 'strong_sell':
    case 'bearish':
      return <ChevronDown className="w-4 h-4 text-red-500" />;
    default:
      return <Minus className="w-4 h-4 text-yellow-500" />;
  }
}

function getHealthStatus(pnlPercent: number | null | undefined): { score: number; status: string } {
  // Handle null/undefined/NaN
  const safePnlPercent = Number.isFinite(Number(pnlPercent)) ? Number(pnlPercent) : 0;
  if (safePnlPercent >= 20) return { score: 95, status: 'ممتاز' };
  if (safePnlPercent >= 10) return { score: 80, status: 'جيد جداً' };
  if (safePnlPercent >= 5) return { score: 70, status: 'جيد' };
  if (safePnlPercent >= 0) return { score: 60, status: 'متوسط' };
  if (safePnlPercent >= -10) return { score: 45, status: 'ضعيف' };
  return { score: 25, status: 'حرج' };
}

export function PortfolioIntelligenceSection() {
  const [data, setData] = useState<PortfolioIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('[Portfolio Intelligence] Fetching data...');
      const res = await fetch('/api/mobile/portfolio/intelligence');
      const json = await res.json();
      console.log('[Portfolio Intelligence] Response:', json);
      
      if (json.success) {
        setData(json);
      } else {
        setError(json.error_ar || json.error || 'فشل في تحميل البيانات');
      }
    } catch (err) {
      console.error('[Portfolio Intelligence] Error:', err);
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

  if (error) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Brain className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">خطأ في تحميل البيانات</h3>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button onClick={loadData} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.summary || data.summary.positions_count === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Brain className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">لا توجد بيانات كافية</h3>
          <p className="text-sm text-muted-foreground mb-4">أضف أسهم إلى محفظتك للحصول على تحليل ذكي</p>
          <Button onClick={loadData} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  const health = getHealthStatus(data.summary.total_pnl_percent);
  
  // Radar data from positions - with safe number handling
  const radarData = data.positions_analysis.slice(0, 5).map(s => {
    const safePnlPercent = Number.isFinite(Number(s.pnl_percent)) ? Number(s.pnl_percent) : 0;
    const safeRsi = Number.isFinite(Number(s.analysis?.rsi)) ? Number(s.analysis.rsi) : null;
    const safeConfidence = Number.isFinite(Number(s.analysis?.confidence)) ? Number(s.analysis.confidence) : 50;
    return {
      subject: s.ticker,
      RSI: safeRsi !== null ? Math.min(100, Math.max(0, safeRsi)) : 50,
      الأداء: Math.min(100, Math.max(0, 50 + safePnlPercent)),
      الثقة: safeConfidence * 100,
    };
  });

  // Pie data from sectors
  const pieData = Object.entries(data.summary.sectors || {}).map(([sector, value]) => ({
    name: sector,
    value: data.summary.total_value > 0 ? Math.round((value / data.summary.total_value) * 100) : 0,
  }));

  // Top gainers and losers - with safe number handling
  const sortedByPnl = [...data.positions_analysis]
    .filter(p => Number.isFinite(Number(p.pnl_percent)))
    .sort((a, b) => (Number(b.pnl_percent) || 0) - (Number(a.pnl_percent) || 0));
  const topGainers = sortedByPnl.filter(p => (Number(p.pnl_percent) || 0) > 0).slice(0, 3);
  const topLosers = sortedByPnl.filter(p => (Number(p.pnl_percent) || 0) < 0).reverse().slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Top Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            <Sparkles className="w-3 h-3" />
            تحليل آلي
          </Badge>
          <Badge variant="secondary">{data.summary.positions_count} سهم</Badge>
        </div>
        <Button onClick={loadData} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={cn("w-4 h-4 ml-2", loading && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 gap-2 bg-gradient-to-br from-emerald-50 to-transparent dark:from-emerald-950/20">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Brain className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-medium">صحة المحفظة</span>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold">{health.score}%</p>
            <Badge variant={health.status === 'ممتاز' ? 'default' : 'secondary'} className="text-xs">
              {health.status}
            </Badge>
          </div>
          <Progress value={health.score} className="h-2 mt-2" />
        </Card>

        <Card className="p-4 gap-2">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Shield className="w-4 h-4" />
            <span className="text-xs font-medium">مستوى المخاطرة</span>
          </div>
          <Badge 
            variant={data.summary.risk_level_ar === 'منخفض' ? 'default' : data.summary.risk_level_ar === 'عالي' ? 'destructive' : 'secondary'}
            className="text-base px-3 py-1"
          >
            {data.summary.risk_level_ar}
          </Badge>
          <div className="flex items-center gap-1 mt-2">
            <Progress value={data.summary.diversification_score} className="h-2 flex-1" />
            <span className="text-xs text-muted-foreground">{data.summary.diversification_score}% تنوع</span>
          </div>
        </Card>

        <Card className="p-4 gap-2">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            {data.summary.total_pnl >= 0 ? (
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500" />
            )}
            <span className="text-xs font-medium">إجمالي الربح/الخسارة</span>
          </div>
          <p className={cn(
            "text-2xl font-bold",
            data.summary.total_pnl >= 0 ? "text-emerald-600" : "text-red-600"
          )}>
            {formatCurrency(Math.abs(data.summary.total_pnl))}
          </p>
          <span className={cn(
            "text-sm",
            data.summary.total_pnl >= 0 ? "text-emerald-500" : "text-red-500"
          )}>
            {formatPercent(data.summary.total_pnl_percent)}
          </span>
        </Card>

        <Card className="p-4 gap-2">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Activity className="w-4 h-4" />
            <span className="text-xs font-medium">حرارة المحفظة</span>
          </div>
          <p className={cn(
            "text-2xl font-bold",
            (data.summary.heat ?? 0) > 10 ? "text-red-600" : (data.summary.heat ?? 0) > 6 ? "text-yellow-600" : "text-emerald-600"
          )}>
            {(data.summary.heat ?? 0).toFixed(1)}%
          </p>
          <Badge 
            variant={data.summary.heat_level === 'cold' ? 'default' : data.summary.heat_level === 'hot' ? 'destructive' : 'secondary'}
          >
            {data.summary.heat_level_ar}
          </Badge>
        </Card>
      </div>

      {/* Overall Recommendation */}
      <Card className="border-2 border-primary/20 bg-gradient-to-l from-primary/5 to-transparent">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">التحليلات</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {data.recommendations.map((reason, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Lightbulb className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                <span className="text-muted-foreground">{reason}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sector Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <PieChart className="w-5 h-5 text-primary" />
              <CardTitle className="text-base">توزيع القطاعات</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}%`}
                    >
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </RechartsPie>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  لا توجد بيانات قطاعات
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Radar Analysis */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-primary" />
              <CardTitle className="text-base">تحليل الأسهم الرئيسية</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {radarData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} />
                    <Radar name="RSI" dataKey="RSI" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                    <Radar name="الأداء" dataKey="الأداء" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                    <Radar name="الثقة" dataKey="الثقة" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} />
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  لا توجد بيانات كافية
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Movers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {topGainers.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                <CardTitle className="text-base">أفضل الأداء</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topGainers.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20">
                    <div>
                      <span className="font-semibold">{item.ticker}</span>
                      <span className="text-xs text-muted-foreground mr-2">{item.name_ar}</span>
                    </div>
                    <Badge className="bg-emerald-500">{formatPercent(item.pnl_percent)}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {topLosers.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-red-500" />
                <CardTitle className="text-base">أسوأ الأداء</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topLosers.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-red-50 dark:bg-red-950/20">
                    <div>
                      <span className="font-semibold">{item.ticker}</span>
                      <span className="text-xs text-muted-foreground mr-2">{item.name_ar}</span>
                    </div>
                    <Badge variant="destructive">{formatPercent(item.pnl_percent)}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Alerts */}
      {(data.stock_alerts.length > 0 || data.portfolio_alerts.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              <CardTitle className="text-base">التنبيهات</CardTitle>
              <Badge variant="secondary">{data.stock_alerts.length + data.portfolio_alerts.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[...data.portfolio_alerts, ...data.stock_alerts].slice(0, 10).map((alert, i) => (
                <div key={i} className={cn(
                  "flex items-start gap-3 p-3 rounded-lg",
                  alert.priority === 'high' ? "bg-red-50 dark:bg-red-950/20" :
                  alert.priority === 'medium' ? "bg-yellow-50 dark:bg-yellow-950/20" :
                  "bg-blue-50 dark:bg-blue-950/20"
                )}>
                  {alert.priority === 'high' ? (
                    <XCircle className="w-5 h-5 text-red-500 mt-0.5" />
                  ) : alert.priority === 'medium' ? (
                    <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
                  ) : (
                    <Info className="w-5 h-5 text-blue-500 mt-0.5" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{alert.type}</p>
                    <p className="text-sm text-muted-foreground">{alert.message_ar || alert.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detailed Stock Analysis */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">تحليل الأسهم التفصيلي</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.positions_analysis.map((stock, i) => (
              <div key={i} className="p-4 rounded-lg border hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{stock.ticker}</span>
                      <span className="text-sm text-muted-foreground">{stock.name_ar}</span>
                      {stock.analysis && getSignalIcon(stock.analysis.signal)}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                      <span>السعر: {formatCurrency(stock.current_price)}</span>
                      <span>الكمية: {stock.shares.toLocaleString('ar-EG')}</span>
                      <span>القيمة: {formatCurrency(stock.market_value)}</span>
                    </div>
                  </div>
                  <Badge 
                    variant={stock.analysis?.recommendation?.action === 'buy' ? 'default' : stock.analysis?.recommendation?.action === 'sell' ? 'destructive' : 'secondary'}
                  >
                    {stock.analysis?.recommendation?.action_ar || 'انتظر'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="p-2 rounded bg-muted/50">
                    <div className="text-muted-foreground text-xs">RSI</div>
                    <div className="flex items-center gap-1">
                      <span className={cn("font-medium", getRSIColor(stock.analysis?.rsi))}>
                        {Number.isFinite(Number(stock.analysis?.rsi)) ? Number(stock.analysis.rsi).toFixed(1) : '—'}
                      </span>
                      <span className="text-xs">({getRSILabel(stock.analysis?.rsi)})</span>
                    </div>
                  </div>
                  <div className="p-2 rounded bg-muted/50">
                    <div className="text-muted-foreground text-xs">الاتجاه</div>
                    <div className="flex items-center gap-1">
                      {stock.analysis && getSignalIcon(stock.analysis.trend)}
                      <span>{stock.analysis?.trend_ar || '—'}</span>
                    </div>
                  </div>
                  <div className="p-2 rounded bg-muted/50">
                    <div className="text-muted-foreground text-xs">الثقة</div>
                    <div className="flex items-center gap-1">
                      <span>{stock.analysis?.confidence ?? 0}%</span>
                    </div>
                  </div>
                  <div className="p-2 rounded bg-muted/50">
                    <div className="text-muted-foreground text-xs">الدعم / المقاومة</div>
                    <div className="text-xs">
                      <span className="text-emerald-500">{Number.isFinite(Number(stock.analysis?.support)) ? Number(stock.analysis.support).toFixed(2) : '—'}</span>
                      {' / '}
                      <span className="text-red-500">{Number.isFinite(Number(stock.analysis?.resistance)) ? Number(stock.analysis.resistance).toFixed(2) : '—'}</span>
                    </div>
                  </div>
                </div>

                {stock.alerts.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {stock.alerts.map((alert, j) => (
                      <Badge key={j} variant="outline" className="text-xs">
                        {alert.message_ar}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="mt-3 pt-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    <Lightbulb className="w-4 h-4 inline ml-1 text-yellow-500" />
                    {stock.analysis?.recommendation?.reason || 'لا توجد تحليل متاحة'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

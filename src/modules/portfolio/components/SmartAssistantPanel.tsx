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
  Lightbulb,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Wallet,
  DollarSign,
  BarChart3,
  Activity,
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * CONTRACT (2026-10-11): /api/finance/smart-analysis returns
 *   { success, data: { assets: SmartAsset[], summary: { total, buy, sell, hold } } }
 * The old contract (stocks/banks/gold + summary.totalInvested/...) was removed
 * when the route was rewritten — rendering against it caused
 * "Cannot read properties of undefined (reading 'toLocaleString')".
 */
interface SmartAsset {
  id: number;
  ticker: string;
  name: string;
  type: string;
  invested: number;
  current_value: number;
  profit_loss: number;
  profit_loss_percent: number;
  action: 'SELL' | 'HOLD' | 'BUY_MORE' | 'AVERAGE_DOWN';
  reason: string;
  confidence: number;
}

interface SmartSummary {
  total: number;
  buy: number;
  sell: number;
  hold: number;
}

interface SmartAnalysisData {
  assets: SmartAsset[];
  summary: SmartSummary;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function SmartAssistantPanel() {
  const [data, setData] = useState<SmartAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedAsset, setExpandedAsset] = useState<number | null>(null);

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
          assets: Array.isArray(json.data?.assets) ? json.data.assets : [],
          summary: {
            total: num(json.data?.summary?.total),
            buy: num(json.data?.summary?.buy),
            sell: num(json.data?.summary?.sell),
            hold: num(json.data?.summary?.hold),
          },
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
        return { color: 'bg-red-500 text-white', icon: <TrendingDown className="h-3 w-3" />, text: 'بيع' };
      case 'BUY_MORE':
        return { color: 'bg-green-500 text-white', icon: <TrendingUp className="h-3 w-3" />, text: 'شراء زيادة' };
      case 'AVERAGE_DOWN':
        return { color: 'bg-teal-500 text-white', icon: <Target className="h-3 w-3" />, text: 'متوسط' };
      default:
        return { color: 'bg-yellow-500 text-white', icon: <Minus className="h-3 w-3" />, text: 'احتفاظ' };
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

  const assets = data.assets;
  const totalInvested = assets.reduce((s, a) => s + num(a.invested), 0);
  const totalValue = assets.reduce((s, a) => s + num(a.current_value), 0);
  const totalProfitLoss = totalValue - totalInvested;
  const totalProfitLossPercent = totalInvested > 0 ? (totalProfitLoss / totalInvested) * 100 : 0;

  const sellAlerts = assets.filter(a => a.action === 'SELL').slice(0, 5);
  const stocks = assets.filter(a => a.type === 'stock');
  const gold = assets.filter(a => a.type === 'gold');
  const others = assets.filter(a => a.type !== 'stock' && a.type !== 'gold');

  const renderAsset = (asset: SmartAsset, i: number) => {
    const actionInfo = getActionBadge(asset.action);
    const invested = num(asset.invested);
    const currentValue = num(asset.current_value);
    const profitLoss = num(asset.profit_loss);
    const profitLossPercent = num(asset.profit_loss_percent);
    const isExpanded = expandedAsset === asset.id;

    return (
      <Card
        key={`${asset.id}-${i}`}
        className={cn(
          "cursor-pointer transition-all hover:shadow-md",
          profitLossPercent > 10 && "border-green-300",
          profitLossPercent < -10 && "border-red-300"
        )}
        onClick={() => setExpandedAsset(isExpanded ? null : asset.id)}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge className={actionInfo.color}>
                {actionInfo.icon}
                <span className="mr-1">{actionInfo.text}</span>
              </Badge>
              <div>
                <div className="font-bold">{asset.ticker}</div>
                <div className="text-sm text-muted-foreground">{asset.name}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-left">
                <div className={cn(
                  "font-bold",
                  profitLoss >= 0 ? "text-emerald-500" : "text-red-600"
                )}>
                  {profitLoss >= 0 ? '+' : ''}
                  {profitLoss.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
                </div>
                <div className={cn(
                  "text-sm",
                  profitLossPercent >= 0 ? "text-emerald-500" : "text-red-600"
                )}>
                  ({profitLossPercent >= 0 ? '+' : ''}{profitLossPercent.toFixed(1)}%)
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
                    <Lightbulb className="h-4 w-4 text-yellow-600" />
                    <span className="font-medium">التوقّع</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={num(asset.confidence)} className="w-16 h-2" />
                    <span className="text-sm text-muted-foreground">{num(asset.confidence)}%</span>
                  </div>
                </div>
                <p className="text-sm">{asset.reason}</p>
              </div>

              {/* Value Details */}
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="bg-muted/50 p-2 rounded">
                  <div className="text-muted-foreground">المستثمر</div>
                  <div className="font-medium">{invested.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م</div>
                </div>
                <div className="bg-muted/50 p-2 rounded">
                  <div className="text-muted-foreground">القيمة الحالية</div>
                  <div className="font-medium">{currentValue.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م</div>
                </div>
                <div className="bg-muted/50 p-2 rounded">
                  <div className="text-muted-foreground">النوع</div>
                  <div className="font-medium">
                    {asset.type === 'stock' ? 'سهم' : asset.type === 'gold' ? 'ذهب' : asset.type === 'bank' ? 'شهادة بنكية' : 'أصل'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

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
        <Card className="p-4 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="h-4 w-4 text-teal-600" />
            <span className="text-sm text-muted-foreground">إجمالى الاستثمار</span>
          </div>
          <div className="text-xl font-bold text-teal-700 dark:text-teal-300">
            {totalInvested.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
          </div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-purple-600" />
            <span className="text-sm text-muted-foreground">القيمة الحالية</span>
          </div>
          <div className="text-xl font-bold text-purple-700 dark:text-purple-300">
            {totalValue.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
          </div>
        </Card>
        <Card className={cn(
          "p-4",
          totalProfitLoss >= 0
            ? "bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900"
            : "bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900"
        )}>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className={cn(
              "h-4 w-4",
              totalProfitLoss >= 0 ? "text-emerald-500" : "text-red-600"
            )} />
            <span className="text-sm text-muted-foreground">الربح/الخسارة</span>
          </div>
          <div className={cn(
            "text-xl font-bold",
            totalProfitLoss >= 0
              ? "text-emerald-500 dark:text-green-300"
              : "text-red-700 dark:text-red-300"
          )}>
            {totalProfitLoss >= 0 ? '+' : ''}
            {totalProfitLoss.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م
          </div>
          <div className={cn(
            "text-xs",
            totalProfitLossPercent >= 0 ? "text-emerald-500" : "text-red-600"
          )}>
            ({totalProfitLossPercent >= 0 ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%)
          </div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-orange-600" />
            <span className="text-sm text-muted-foreground">عدد الأصول</span>
          </div>
          <div className="text-xl font-bold text-orange-700 dark:text-orange-300">
            {num(data.summary.total) || assets.length}
          </div>
          <div className="text-xs text-muted-foreground">
            {stocks.length} سهم • {gold.length} ذهب • {others.length} أخرى
          </div>
        </Card>
      </div>

      {/* Signal Summary */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-sm py-1 px-3">
          إشارات شراء: {num(data.summary.buy)}
        </Badge>
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-sm py-1 px-3">
          إشارات بيع: {num(data.summary.sell)}
        </Badge>
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 text-sm py-1 px-3">
          احتفاظ: {num(data.summary.hold)}
        </Badge>
      </div>

      {/* Sell Alerts */}
      {sellAlerts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              تنبيهات هامة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sellAlerts.map((asset, i) => (
                <div key={i} className="text-sm p-2 bg-white dark:bg-gray-900 rounded border">
                  <span className="font-medium">{asset.ticker || asset.name}:</span>{' '}
                  <span className="text-muted-foreground">{asset.reason}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assets Analysis */}
      {assets.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              تحليل الأصول ({assets.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {assets.map(renderAsset)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">لا توجد أصول في المحفظة بعد</p>
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

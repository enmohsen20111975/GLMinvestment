'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  TrendingUp, TrendingDown, Target, AlertTriangle, 
  Clock, RefreshCw, Trophy, Activity, Calendar
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, MarketType } from '@/lib/store';

interface Prediction {
  id: string;
  symbol: string;
  name: string;
  signal: string;
  signal_ar: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  score: number;
  prediction_date: string;
  status: string;
  status_ar: string;
  final_price: number | null;
  actual_return: number | null;
  days_held: number;
  close_date: string | null;
  market: string;
  market_ar: string;
  created_at: string;
}

interface Summary {
  total: number;
  closed: number;
  pending: number;
  expired: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_profit: number;
  avg_loss: number;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
  TARGET_HIT: {
    color: 'text-green-700 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-950/30',
    icon: <Target className="w-4 h-4" />,
    label: '🎯 تم'
  },
  STOPPED: {
    color: 'text-red-700 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/30',
    icon: <AlertTriangle className="w-4 h-4" />,
    label: '🛑 وقف'
  },
  PENDING: {
    color: 'text-gray-600 dark:text-gray-400',
    bg: 'bg-gray-50 dark:bg-gray-900/20',
    icon: <Clock className="w-4 h-4" />,
    label: '⏳ مفتوح'
  },
  EXPIRED: {
    color: 'text-yellow-700 dark:text-yellow-400',
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    icon: <AlertTriangle className="w-4 h-4" />,
    label: '⚠️ منتهي'
  },
};

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit' });
}

export function PredictionsPerformanceView() {
  const currentMarket = useAppStore((s) => s.currentMarket);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const marketCode = currentMarket === 'TADAWUL' ? 'TADAWUL' : currentMarket;
      const res = await fetch(`/api/predictions/performance?month=${selectedMonth}&market=${marketCode}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setPredictions(data.predictions || []);
        setSummary(data.summary || null);
      }
    } catch (error) {
      console.error('Error fetching performance data:', error);
    } finally {
      setLoading(false);
    }
  }, [currentMarket, selectedMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Get available months (last 6 months)
  const availableMonths = (() => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
      months.push({ value, label });
    }
    return months;
  })();

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            جدول المصداقية
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            متابعة توقعات الشهر ونتائجها الفعلية
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 rounded-lg border bg-background text-foreground text-sm"
          >
            {availableMonths.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 ml-1" />
            تحديث
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-muted-foreground">توقعات الشهر</span>
              </div>
              <p className="text-3xl font-bold">{summary.total}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {summary.pending} مفتوح · {summary.closed} مغلق
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Trophy className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-muted-foreground">نسبة النجاح</span>
              </div>
              <p className={cn(
                "text-3xl font-bold",
                summary.win_rate >= 60 ? "text-green-600" : 
                summary.win_rate >= 40 ? "text-amber-500" : "text-red-500"
              )}>
                {summary.win_rate}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {summary.wins} رابحة · {summary.losses} خاسرة
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-green-500" />
                <span className="text-sm text-muted-foreground">متوسط الربح</span>
              </div>
              <p className="text-3xl font-bold text-green-600">
                +{summary.avg_profit}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">عند تحقيق الهدف</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-red-500" />
                <span className="text-sm text-muted-foreground">متوسط الخسارة</span>
              </div>
              <p className="text-3xl font-bold text-red-600">
                {summary.avg_loss}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">عند وقف الخسارة</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Predictions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            توقعات {availableMonths.find(m => m.value === selectedMonth)?.label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {predictions.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 mx-auto text-muted-foreground opacity-50 mb-3" />
              <p className="text-muted-foreground">لا توجد توقعات في هذا الشهر</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-right py-3 px-2 font-semibold">التاريخ</th>
                    <th className="text-right py-3 px-2 font-semibold">السوق</th>
                    <th className="text-right py-3 px-2 font-semibold">السهم</th>
                    <th className="text-right py-3 px-2 font-semibold">الإشارة</th>
                    <th className="text-right py-3 px-2 font-semibold">الدخول</th>
                    <th className="text-right py-3 px-2 font-semibold">الهدف</th>
                    <th className="text-right py-3 px-2 font-semibold">الوقف</th>
                    <th className="text-right py-3 px-2 font-semibold">النتيجة</th>
                    <th className="text-right py-3 px-2 font-semibold">العائد</th>
                    <th className="text-right py-3 px-2 font-semibold">الأيام</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((pred, idx) => {
                    const config = STATUS_CONFIG[pred.status] || STATUS_CONFIG.PENDING;
                    const isPositive = (pred.actual_return || 0) >= 0;
                    
                    return (
                      <tr 
                        key={idx} 
                        className={cn(
                          "border-b last:border-0 transition-colors",
                          config.bg,
                          pred.status === 'PENDING' && "hover:bg-muted/30"
                        )}
                      >
                        <td className="py-3 px-2 text-muted-foreground">
                          {formatDate(pred.prediction_date)}
                        </td>
                        <td className="py-3 px-2">{pred.market_ar}</td>
                        <td className="py-3 px-2">
                          <div className="font-bold">{pred.symbol}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[120px]">{pred.name}</div>
                        </td>
                        <td className="py-3 px-2">
                          <Badge className={cn(
                            "text-xs",
                            pred.signal === 'BUY' ? "bg-green-500 text-white" :
                            pred.signal === 'SELL' ? "bg-red-500 text-white" :
                            "bg-gray-500 text-white"
                          )}>
                            {pred.signal_ar}
                          </Badge>
                        </td>
                        <td className="py-3 px-2 font-medium">{pred.entry_price.toFixed(2)}</td>
                        <td className="py-3 px-2 text-green-600 font-medium">
                          {pred.target_price.toFixed(2)}
                        </td>
                        <td className="py-3 px-2 text-red-600 font-medium">
                          {pred.stop_loss.toFixed(2)}
                        </td>
                        <td className="py-3 px-2">
                          <span className={cn("font-medium flex items-center gap-1", config.color)}>
                            {config.label}
                          </span>
                        </td>
                        <td className="py-3 px-2 font-bold">
                          {pred.actual_return !== null ? (
                            <span className={isPositive ? "text-green-600" : "text-red-600"}>
                              {isPositive ? '+' : ''}{pred.actual_return.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-muted-foreground">
                          {pred.days_held > 0 ? pred.days_held : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 flex-wrap text-xs text-muted-foreground">
        {Object.entries(STATUS_CONFIG).map(([key, config]) => (
          <div key={key} className="flex items-center gap-1">
            <div className={cn("w-3 h-3 rounded", config.bg)} />
            <span>{config.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

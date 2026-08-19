'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  AlertTriangle,
  RefreshCw,
  Calendar,
  Zap,
  CheckCircle,
  BarChart3
} from 'lucide-react';
import { toast } from 'sonner';

// Types
interface SeasonalitySignal {
  ticker: string;
  name_ar?: string;
  signal: string;
  confidence: number;
  total_score: number;
  recommendations?: string[];
  entry_price?: number;
  stop_loss?: number;
  take_profit?: number;
}

interface ScanSummary {
  total_signals: number;
  strong_buy_signals: number;
  buy_signals: number;
  accumulate_signals: number;
  hold_signals: number;
  sell_signals: number;
  avg_total_score: number;
  avg_confidence: number;
}

// Helper functions
const getSignalColor = (signal: string): string => {
  switch (signal) {
    case 'STRONG_BUY': return 'bg-green-600 text-white';
    case 'BUY': return 'bg-green-500 text-white';
    case 'ACCUMULATE': return 'bg-green-400 text-white';
    case 'HOLD': return 'bg-gray-500 text-white';
    case 'REDUCE': return 'bg-orange-500 text-white';
    case 'SELL': return 'bg-red-500 text-white';
    default: return 'bg-gray-400 text-white';
  }
};

const getSignalArabic = (signal: string): string => {
  const translations: Record<string, string> = {
    'STRONG_BUY': 'شراء قوي',
    'BUY': 'شراء',
    'ACCUMULATE': 'تجميع',
    'HOLD': 'احتفاظ',
    'REDUCE': 'تخفيف',
    'SELL': 'بيع',
  };
  return translations[signal] || signal;
};

// Safe number helper
const safeNum = (val: unknown, fallback: number = 0): number => {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

export function SeasonalityDashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [signals, setSignals] = useState<SeasonalitySignal[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [scanDate, setScanDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [totalAnalyzed, setTotalAnalyzed] = useState<number>(0);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/seasonality-signals');
      const data = await res.json();

      if (data.status === 'success') {
        setSignals(data.signals || []);
        setSummary(data.summary || null);
        setScanDate(data.scan_date || '');
        setTotalAnalyzed(data.total_stocks_analyzed || 0);
      } else {
        setError(data.error || 'فشل في جلب البيانات');
      }
    } catch (err) {
      setError('حدث خطأ في الاتصال');
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    toast.info('جاري تحديث البيانات...');
    await fetchData();
    toast.success('تم تحديث البيانات');
  };

  // Loading state
  if (loading) {
    return (
      <div className="p-4 space-y-4" dir="rtl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">محرك الموسمية</h1>
            <p className="text-muted-foreground">جاري التحميل...</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Main render
  return (
    <div className="p-4 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-yellow-500" />
            محرك الموسمية
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            تحليل تلقائي للأسهم بدون مؤشرات فنية معقدة
          </p>
          {totalAnalyzed > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              تم تحليل {totalAnalyzed} سهم
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={"h-4 w-4 ml-2 " + (refreshing ? "animate-spin" : "")} />
          تحديث
        </Button>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">إجمالي الإشارات</div>
              <div className="text-3xl font-bold text-green-600">{safeNum(summary.total_signals, 0)}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">شراء قوي</div>
              <div className="text-3xl font-bold text-emerald-600">{safeNum(summary.strong_buy_signals, 0)}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">شراء</div>
              <div className="text-3xl font-bold text-blue-600">{safeNum(summary.buy_signals, 0)}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">متوسط الثقة</div>
              <div className="text-3xl font-bold text-purple-600">{safeNum(summary.avg_confidence, 0)}%</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Signals Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            الإشارات النشطة
          </CardTitle>
        </CardHeader>
        <CardContent>
          {signals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">لا توجد إشارات متاحة حالياً</p>
              <p className="text-sm mt-2">جاري تحليل السوق...</p>
            </div>
          ) : (
            <div className="space-y-3">
              {signals.map((signal) => (
                <div
                  key={signal.ticker}
                  className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="font-bold text-lg">{signal.ticker.slice(0, 2)}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg">{signal.ticker}</span>
                        <Badge className={getSignalColor(signal.signal)}>
                          {getSignalArabic(signal.signal)}
                        </Badge>
                      </div>
                      {signal.name_ar && (
                        <p className="text-sm text-muted-foreground">{signal.name_ar}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span>الثقة: <strong>{safeNum(signal.confidence, 0).toFixed(0)}%</strong></span>
                    </div>
                    <div className="flex items-center gap-1">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      <span>الدرجة: <strong>{safeNum(signal.total_score, 0).toFixed(0)}</strong></span>
                    </div>
                    {signal.entry_price && (
                      <div className="flex items-center gap-1">
                        <span>الدخول: <strong>{safeNum(signal.entry_price, 0).toFixed(2)}</strong></span>
                      </div>
                    )}
                  </div>

                  {signal.recommendations && signal.recommendations.length > 0 && (
                    <div className="w-full md:w-auto">
                      <div className="flex flex-wrap gap-1">
                        {signal.recommendations.map((rec, i) => (
                          <span key={i} className="text-xs bg-muted px-2 py-1 rounded">
                            {rec}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Alert */}
      <Alert className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-700 dark:text-green-300">
          <strong>كيف يعمل المحرك؟</strong>
          <br />
          • يحلل الأسهم بناءً على المتوسطات المتحركة (MA50, MA200)
          <br />
          • يستخدم مؤشر RSI لتحديد مناطق التشبع الشرائي والبيعي
          <br />
          • يعطي إشارات مبسطة بدون تعقيد المؤشرات الفنية
        </AlertDescription>
      </Alert>
    </div>
  );
}

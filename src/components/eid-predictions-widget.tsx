'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Bitcoin,
  Coins,
  Landmark,
  Building2,
  Gem,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import { toArabicError } from '@/lib/safe-error';

interface Prediction {
  id: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  confidence: number;
  reasoning: string;
  created_at: string;
}

const iconMap: Record<string, any> = {
  'BTC': Bitcoin,
  'ETH': Coins,
  'EGX 100': Landmark,
  'COMI': Building2,
  'GOLD': Gem
};

const signalColors: Record<string, string> = {
  'BUY': 'bg-success/20 text-success border-success/50',
  'SELL': 'bg-loss/20 text-loss border-loss/50',
  'HOLD': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'
};

const signalIcons: Record<string, any> = {
  'BUY': TrendingUp,
  'SELL': TrendingDown,
  'HOLD': Minus
};

export function EidPredictionsWidget() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const fetchPredictions = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const _market = typeof window !== 'undefined'
        ? JSON.parse(localStorage.getItem('egx_current_market') || '"EGX"')
        : 'EGX';
      const url = `/api/predictions/eid?market=${_market}`;
      const method = forceRefresh ? 'POST' : 'GET';

      const response = await fetch(url, { method });
      const data = await response.json();

      if (data.success) {
        setPredictions(data.predictions);
        setLastUpdate(data.generated_at || new Date().toISOString());
      } else {
        setError(toArabicError(data.error, 'فشل في تحميل التوقعات'));
      }
    } catch (err: any) {
      setError(toArabicError(err, 'تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchPredictions();
  }, [fetchPredictions]);

  const formatPrice = (price: number | null | undefined, symbol: string) => {
    if (price == null || Number.isNaN(price)) return '—';
    if (symbol === 'BTC' || symbol === 'ETH') {
      return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    } else if (symbol === 'GOLD') {
      return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    } else {
      return `${(price ?? 0).toFixed(2)} ج.م`;
    }
  };

  const getPotentialGain = (pred: Prediction) => {
    const entry = pred.entryPrice;
    const target = pred.targetPrice;
    if (entry == null || target == null || entry === 0 || Number.isNaN(entry) || Number.isNaN(target)) {
      return '0.0';
    }
    const gain = ((target - entry) / entry) * 100;
    if (!Number.isFinite(gain)) return '0.0';
    return (gain ?? 0).toFixed(1);
  };

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-warning" />
            <Skeleton className="h-6 w-40" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-loss" />
            <CardTitle className="text-white">خطأ في التحميل</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-loss mb-4">{error}</p>
          <Button onClick={() => fetchPredictions()} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-warning" />
            <CardTitle className="text-white text-lg">
              توقعات اليوم
            </CardTitle>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchPredictions(true)}
            disabled={refreshing}
            className="text-slate-400 hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        {lastUpdate && (
          <p className="text-xs text-slate-500 mt-1">
            آخر تحديث: {new Date(lastUpdate).toLocaleString('ar-EG')}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Disclaimer */}
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-2 mb-4">
          <p className="text-xs text-warning flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            هذه التوقعات للأغراض التعليمية فقط. استشر مستشار مالي قبل الاستثمار.
          </p>
        </div>

        {/* Predictions List */}
        {predictions.map((pred) => {
          const Icon = iconMap[pred.symbol] || TrendingUp;
          const SignalIcon = signalIcons[pred.signal];
          const potentialGain = parseFloat(getPotentialGain(pred));

          return (
            <div
              key={pred.id}
              className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-slate-700/50">
                    <Icon className="h-4 w-4 text-slate-300" />
                  </div>
                  <span className="font-bold text-white">{pred.symbol}</span>
                </div>
                <Badge className={signalColors[pred.signal]}>
                  <SignalIcon className="h-3 w-3 mr-1" />
                  {pred.signal === 'BUY' ? 'شراء' : pred.signal === 'SELL' ? 'بيع' : 'انتظار'}
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                <div>
                  <span className="text-slate-500">الدخول</span>
                  <p className="text-slate-200 font-mono">{formatPrice(pred.entryPrice, pred.symbol)}</p>
                </div>
                <div>
                  <span className="text-slate-500">الهدف</span>
                  <p className="text-success font-mono">{formatPrice(pred.targetPrice, pred.symbol)}</p>
                </div>
                <div>
                  <span className="text-slate-500">وقف الخسارة</span>
                  <p className="text-loss font-mono">{formatPrice(pred.stopLoss, pred.symbol)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">الثقة:</span>
                  <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pred.confidence >= 0.7 ? 'bg-success' : pred.confidence >= 0.5 ? 'bg-yellow-500' : 'bg-loss'}`}
                      style={{ width: `${pred.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-slate-300">{(pred.confidence * 100).toFixed(0)}%</span>
                </div>
                <div className={`flex items-center gap-1 ${potentialGain >= 0 ? 'text-success' : 'text-loss'}`}>
                  {potentialGain >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {potentialGain >= 0 ? '+' : ''}{potentialGain}%
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-2 border-t border-slate-700/50 pt-2">
                {pred.reasoning}
              </p>
            </div>
          );
        })}

        {/* Memory Stats */}
        <div className="mt-4 pt-3 border-t border-slate-700/50 text-xs text-slate-500">
          <p>التوقعات تُحدّث يومياً بناءً على تحليل السوق</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default EidPredictionsWidget;

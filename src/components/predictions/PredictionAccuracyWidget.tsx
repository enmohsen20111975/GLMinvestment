'use client';

/**
 * Prediction Accuracy Widget
 * عرض نسبة دقة توقعات الـ AI
 */

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  AlertCircle,
  RefreshCw,
  BarChart3
} from 'lucide-react';

interface PredictionStats {
  total_predictions: number;
  successful: number;
  failed: number;
  success_rate: number;
  avg_profit_loss: number;
  by_signal: Record<string, number>;
}

interface Prediction {
  id: string;
  symbol: string;
  market: string;
  signal: string;
  confidence: number;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  reasoning: string | null;
  verified: boolean;
  result: string | null;
  profit_loss_pct: number | null;
  created_at: string;
  verify_date: string;
}

export function PredictionAccuracyWidget() {
  const [stats, setStats] = useState<PredictionStats | null>(null);
  const [recent, setRecent] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [statsRes, recentRes] = await Promise.all([
        fetch('/api/predictions?action=stats'),
        fetch('/api/predictions?action=recent')
      ]);

      const statsData = await statsRes.json();
      const recentData = await recentRes.json();

      if (statsData.success) {
        setStats(statsData.stats);
      }

      if (recentData.success) {
        setRecent(recentData.predictions.slice(0, 5));
      }

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="bg-card border rounded-xl p-6">
        <div className="flex items-center justify-center h-40">
          <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border rounded-xl p-6">
        <div className="flex items-center gap-3 text-red-500">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const successRate = stats?.success_rate || 0;
  const successColor = successRate >= 60 ? 'text-green-500' : 
                       successRate >= 40 ? 'text-yellow-500' : 'text-red-500';

  return (
    <div className="bg-card border rounded-xl p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Target className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold">دقة توقعات AI</h3>
            <p className="text-xs text-muted-foreground">DeepSeek Predictions</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Success Rate */}
        <div className="bg-muted/50 rounded-xl p-4 text-center">
          <div className={cn("text-3xl font-bold", successColor)}>
            {successRate.toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground mt-1">نسبة النجاح</div>
        </div>

        {/* Total Predictions */}
        <div className="bg-muted/50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold">
            {stats?.total_predictions || 0}
          </div>
          <div className="text-xs text-muted-foreground mt-1">إجمالي التوقعات</div>
        </div>

        {/* Successful */}
        <div className="bg-green-500/10 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-green-600">
            {stats?.successful || 0}
          </div>
          <div className="text-xs text-muted-foreground mt-1">ناجحة ✓</div>
        </div>

        {/* Failed */}
        <div className="bg-red-500/10 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-red-600">
            {stats?.failed || 0}
          </div>
          <div className="text-xs text-muted-foreground mt-1">فاشلة ✗</div>
        </div>
      </div>

      {/* Avg P/L */}
      {stats && (
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <span className="text-sm">متوسط الربح/الخسارة</span>
          <span className={cn(
            "font-bold",
            (stats.avg_profit_loss || 0) >= 0 ? "text-green-500" : "text-red-500"
          )}>
            {(stats.avg_profit_loss || 0).toFixed(2)}%
          </span>
        </div>
      )}

      {/* Recent Predictions */}
      {recent.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">آخر التوقعات</h4>
          <div className="space-y-2">
            {recent.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between p-3 bg-muted/30 rounded-lg text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.symbol}</span>
                  <SignalBadge signal={p.signal} />
                </div>
                <div className="flex items-center gap-2">
                  {p.verified ? (
                    <span className={cn(
                      "text-xs font-medium",
                      p.result === 'SUCCESS' ? "text-green-500" : "text-red-500"
                    )}>
                      {p.result === 'SUCCESS' ? '✓' : '✗'}
                      {p.profit_loss_pct?.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">قيد المتابعة</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No predictions yet */}
      {stats?.total_predictions === 0 && (
        <div className="text-center py-4 text-muted-foreground">
          <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p className="text-sm">لا توجد توقعات بعد</p>
          <p className="text-xs">سيتم توليد توقعات تلقائياً يومياً</p>
        </div>
      )}
    </div>
  );
}

// Signal badge component
function SignalBadge({ signal }: { signal: string }) {
  const config: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    BUY: { 
      bg: 'bg-green-500/20', 
      text: 'text-green-600',
      icon: <TrendingUp className="w-3 h-3" />
    },
    SELL: { 
      bg: 'bg-red-500/20', 
      text: 'text-red-600',
      icon: <TrendingDown className="w-3 h-3" />
    },
    HOLD: { 
      bg: 'bg-yellow-500/20', 
      text: 'text-yellow-600',
      icon: <Minus className="w-3 h-3" />
    }
  };

  const c = config[signal] || config.HOLD;

  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
      c.bg, c.text
    )}>
      {c.icon}
      {signal === 'BUY' ? 'شراء' : signal === 'SELL' ? 'بيع' : 'انتظار'}
    </span>
  );
}

export default PredictionAccuracyWidget;

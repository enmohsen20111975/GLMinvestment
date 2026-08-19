'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  History,
  ChevronRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Lightbulb
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AnalystInsight {
  ticker: string;
  total_trades: number;
  wins: number;
  losses: number;
  open_positions: number;
  win_rate: number;
  avg_pnl: number;
  best_pattern: string;
  best_pattern_win_rate: number;
  worst_pattern: string;
  worst_pattern_win_rate: number;
  favorite_support: number | null;
  similar_cases: Array<{
    ticker: string;
    ticker_name?: string;
    pattern: string;
    entry: number;
    result: string;
    pnl?: number;
    date: string;
    notes?: string;
    support?: number;
  }>;
  suggestion: string;
  confidence: number;
  pattern_breakdown: Record<string, { total: number; wins: number; losses: number; open: number }>;
}

interface ExpertMemoryPanelProps {
  ticker: string;
  currentPrice?: number;
  support?: number;
  resistance?: number;
  onRecordTrade?: () => void;
}

export function ExpertMemoryPanel({
  ticker,
  currentPrice,
  support,
  resistance,
  onRecordTrade
}: ExpertMemoryPanelProps) {
  const [insight, setInsight] = useState<AnalystInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    const fetchInsight = async () => {
      setLoading(true);
      setError(null);

      try {
        let url = `/api/python/v4/insight/${ticker}`;
        const params = new URLSearchParams();
        if (currentPrice) params.set('current_price', currentPrice.toString());
        if (support) params.set('support', support.toString());
        if (resistance) params.set('resistance', resistance.toString());
        if (params.toString()) url += `?${params.toString()}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
          setInsight(data.data);
        } else {
          setError(data.error || 'فشل في جلب البيانات');
        }
      } catch {
        setError('خطأ في الاتصال');
      } finally {
        setLoading(false);
      }
    };

    fetchInsight();
  }, [ticker, currentPrice, support, resistance]);

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!insight || insight.total_trades === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4" />
            ذاكرتك مع {ticker}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">لا توجد صفقات سابقة على هذا السهم</p>
            <p className="text-xs mt-1">سجل صفقاتك لتبني ذاكرتك</p>
            {onRecordTrade && (
              <Button size="sm" variant="outline" className="mt-3" onClick={onRecordTrade}>
                تسجيل صفقة جديدة
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getWinRateColor = (wr: number) => {
    if (wr >= 60) return 'text-green-600';
    if (wr >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getResultIcon = (result: string) => {
    switch (result) {
      case 'win':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'loss':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <MinusCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              ذاكرتك مع {ticker}
            </span>
            <Badge variant={insight.win_rate >= 50 ? 'success' : 'destructive'}>
              {insight.win_rate.toFixed(0)}% نجاح
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="space-y-1">
              <div className="text-2xl font-bold">{insight.total_trades}</div>
              <div className="text-xs text-muted-foreground">إجمالي</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-bold text-green-600">{insight.wins}</div>
              <div className="text-xs text-muted-foreground">ربح</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-bold text-red-600">{insight.losses}</div>
              <div className="text-xs text-muted-foreground">خسارة</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-bold text-blue-600">{insight.open_positions}</div>
              <div className="text-xs text-muted-foreground">مفتوح</div>
            </div>
          </div>

          {/* Win Rate Progress */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>نسبة النجاح</span>
              <span className={getWinRateColor(insight.win_rate)}>
                {insight.win_rate.toFixed(1)}%
              </span>
            </div>
            <Progress value={insight.win_rate} className="h-2" />
          </div>

          {/* Avg PnL */}
          {insight.avg_pnl !== 0 && (
            <div className={cn(
              "flex items-center gap-2 text-sm p-2 rounded-md",
              insight.avg_pnl > 0 ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
            )}>
              {insight.avg_pnl > 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span>
                متوسط العائد: {insight.avg_pnl > 0 ? '+' : ''}{insight.avg_pnl.toFixed(2)}%
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Best/Worst Patterns */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4" />
            أنماطك
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {insight.best_pattern && (
            <div className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-950 rounded-md">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm">{insight.best_pattern}</span>
              </div>
              <Badge variant="success" className="text-xs">
                {insight.best_pattern_win_rate.toFixed(0)}%
              </Badge>
            </div>
          )}

          {insight.worst_pattern && insight.worst_pattern !== insight.best_pattern && (
            <div className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-950 rounded-md">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-600" />
                <span className="text-sm">{insight.worst_pattern}</span>
              </div>
              <Badge variant="destructive" className="text-xs">
                {insight.worst_pattern_win_rate.toFixed(0)}%
              </Badge>
            </div>
          )}

          {!insight.best_pattern && !insight.worst_pattern && (
            <p className="text-sm text-muted-foreground text-center py-2">
              لا توجد أنماط كافية للتحليل
            </p>
          )}
        </CardContent>
      </Card>

      {/* Suggestion */}
      {insight.suggestion && insight.suggestion !== 'لا توجد بيانات كافية' && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium mb-1">نصيحة</p>
                <p className="text-sm text-muted-foreground">{insight.suggestion}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Similar Cases */}
      {insight.similar_cases && insight.similar_cases.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" />
              حالات مشابهة ({insight.similar_cases.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {insight.similar_cases.slice(0, 5).map((c, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {getResultIcon(c.result)}
                    <div>
                      <span className="font-medium">{c.ticker}</span>
                      <span className="text-muted-foreground text-xs mr-1">({c.pattern})</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.pnl !== undefined && c.pnl !== null && (
                      <span className={cn(
                        "font-medium",
                        c.pnl > 0 ? "text-green-600" : "text-red-600"
                      )}>
                        {c.pnl > 0 ? '+' : ''}{c.pnl.toFixed(1)}%
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {c.date ? new Date(c.date).toLocaleDateString('ar-EG') : '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Record Trade Button */}
      {onRecordTrade && (
        <Button className="w-full" onClick={onRecordTrade}>
          <ChevronRight className="h-4 w-4 ml-2" />
          تسجيل صفقة جديدة
        </Button>
      )}
    </div>
  );
}

// Compact version for inline use
export function ExpertMemoryBadge({ ticker }: { ticker: string }) {
  const [insight, setInsight] = useState<AnalystInsight | null>(null);

  useEffect(() => {
    fetch(`/api/python/v4/insight/${ticker}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) setInsight(data.data);
      })
      .catch(() => {});
  }, [ticker]);

  if (!insight || insight.total_trades === 0) return null;

  return (
    <Badge
      variant={insight.win_rate >= 50 ? 'success' : 'secondary'}
      className="text-xs gap-1"
    >
      <Brain className="h-3 w-3" />
      {insight.total_trades} صفقة • {insight.win_rate.toFixed(0)}% نجاح
    </Badge>
  );
}

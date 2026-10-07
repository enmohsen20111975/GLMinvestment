'use client';

/**
 * 😈 مصفوفة السيناريوهات (Scenario Matrix)
 *
 * لو السوق اتغير، إيه هيحصل لـ {ticker}؟
 * 3 سيناريوهات: ذهبي، عرضي، أسود
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, RefreshCw, TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScenarioMatrix as ScenarioMatrixType } from '@/lib/devil/types';

interface ScenarioMatrixProps {
  ticker: string;
}

export function ScenarioMatrix({ ticker }: ScenarioMatrixProps) {
  const [matrix, setMatrix] = useState<ScenarioMatrixType | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMatrix = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/devil/scenario/${ticker}`, { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        setMatrix(data);
      }
    } catch (err) {
      console.error('[ScenarioMatrix] fetch error:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMatrix();
  }, [ticker]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
          <span className="text-sm text-muted-foreground">بيبني السيناريوهات...</span>
        </CardContent>
      </Card>
    );
  }

  if (!matrix) {
    return (
      <Card>
        <CardContent className="p-4 text-center">
          <p className="text-sm text-muted-foreground">مفيش سيناريوهات متاحة</p>
        </CardContent>
      </Card>
    );
  }

  const scenarioConfig = [
    {
      key: 'best' as const,
      label: 'السيناريو الذهبي',
      icon: TrendingUp,
      color: 'green',
      bg: 'from-green-500/10 to-emerald-500/5',
      border: 'border-green-500/30',
    },
    {
      key: 'base' as const,
      label: 'السيناريو العرضي',
      icon: Minus,
      color: 'amber',
      bg: 'from-amber-500/10 to-yellow-500/5',
      border: 'border-amber-500/30',
    },
    {
      key: 'worst' as const,
      label: 'السيناريو الأسود',
      icon: TrendingDown,
      color: 'red',
      bg: 'from-red-500/10 to-rose-500/5',
      border: 'border-red-500/30',
    },
  ];

  const actionConfig = {
    buy_now: { label: 'اشترِ دلوقتي', color: 'bg-green-500/20 text-green-700 dark:text-green-400' },
    wait: { label: 'انتظر', color: 'bg-amber-500/20 text-amber-700 dark:text-amber-400' },
    sell_or_avoid: { label: 'بيع / ابتعد', color: 'bg-red-500/20 text-red-700 dark:text-red-400' },
  };

  return (
    <Card className="border-purple-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-purple-500" />
            😈 مصفوفة السيناريوهات — {ticker}
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={fetchMatrix}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* القرار */}
        <div className="rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 p-3">
          <p className="text-sm font-medium">{matrix.devilVerdict}</p>
        </div>

        {/* السيناريوهات */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {scenarioConfig.map((cfg, idx) => {
            const scenario = idx === 0 ? matrix.bestCase : idx === 1 ? matrix.baseCase : matrix.worstCase;
            const Icon = cfg.icon;
            const action = actionConfig[scenario.action];
            const stockMoveColor = scenario.stockMove > 0 ? 'text-green-600' : scenario.stockMove < 0 ? 'text-red-600' : 'text-muted-foreground';

            return (
              <div
                key={cfg.key}
                className={cn('rounded-lg border bg-gradient-to-br p-3', cfg.bg, cfg.border)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn(
                      'h-4 w-4',
                      cfg.color === 'green' && 'text-green-500',
                      cfg.color === 'amber' && 'text-amber-500',
                      cfg.color === 'red' && 'text-red-500'
                    )} />
                    <span className="text-sm font-bold">{cfg.label}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {(scenario.probability * 100).toFixed(0)}%
                  </Badge>
                </div>

                <div className="space-y-1 mb-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">السوق:</span>
                    <span className={cn(
                      'font-bold',
                      scenario.marketMove > 0 ? 'text-green-600' : scenario.marketMove < 0 ? 'text-red-600' : 'text-muted-foreground'
                    )}>
                      {scenario.marketMove > 0 ? '+' : ''}{scenario.marketMove}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{ticker}:</span>
                    <span className={cn('font-bold text-base', stockMoveColor)}>
                      {scenario.stockMove > 0 ? '+' : ''}{scenario.stockMove}%
                    </span>
                  </div>
                </div>

                <Progress
                  value={Math.min(100, Math.abs(scenario.stockMove) * 10)}
                  className="h-1.5 mb-2"
                />

                <p className="text-xs text-foreground/70 mb-2">{scenario.reasoning}</p>

                <Badge className={cn('text-xs w-full justify-center', action.color)}>
                  {action.label}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

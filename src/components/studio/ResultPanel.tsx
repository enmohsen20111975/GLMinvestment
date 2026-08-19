'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  FileOutput, ArrowUpRight, ArrowDownRight, Minus,
  BarChart3, Activity, Zap, TrendingDown, Settings2,
} from 'lucide-react';
import type { AnalysisResult } from './types';
import { ENGINE_VISUAL, SIGNAL_VISUAL } from './types';
import { isValidTimestamp } from '@/lib/utils';

const ENGINE_ICONS: Record<string, React.ReactNode> = {
  fundamental: <BarChart3 className="h-4 w-4" />,
  technical: <Activity className="h-4 w-4" />,
  candlestick: <Zap className="h-4 w-4" />,
  mean_reversion: <TrendingDown className="h-4 w-4" />,
};

const SIGNAL_ICONS: Record<string, React.ReactNode> = {
  BUY: <ArrowUpRight className="h-4 w-4" />,
  SELL: <ArrowDownRight className="h-4 w-4" />,
  HOLD: <Minus className="h-4 w-4" />,
};

interface ResultPanelProps {
  result: AnalysisResult | null;
  loading: boolean;
}

export function ResultPanel({ result, loading }: ResultPanelProps) {
  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-40">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Running analysis...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-40">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FileOutput className="h-8 w-8" />
            <span className="text-sm">Execute to see results</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const signalVisual = SIGNAL_VISUAL[result.signal] || SIGNAL_VISUAL.HOLD;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Analysis Result
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Ticker + Signal */}
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold">{result.ticker}</span>
          <Badge className={`${signalVisual.bgClass} ${signalVisual.colorClass} text-sm px-3 py-1 font-bold`}>
            {SIGNAL_ICONS[result.signal]} {result.signal}
          </Badge>
        </div>

        {/* Score + Confidence */}
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <div className="text-2xl font-bold">{result.score.toFixed(1)}</div>
            <div className="text-[10px] text-muted-foreground">Score /10</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <div className="text-2xl font-bold">{result.confidence.toFixed(0)}%</div>
            <div className="text-[10px] text-muted-foreground">Confidence</div>
          </div>
        </div>

        {/* Signal Counts */}
        {result.signal_counts && (
          <div className="flex gap-2">
            {Object.entries(result.signal_counts).map(([sig, count]) => {
              const sv = SIGNAL_VISUAL[sig] || SIGNAL_VISUAL.HOLD;
              return (
                <Badge key={sig} className={`${sv.bgClass} ${sv.colorClass} text-[10px]`}>
                  {sig}: {count}
                </Badge>
              );
            })}
          </div>
        )}

        <Separator />

        {/* Engine Breakdown */}
        <div className="space-y-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">ENGINE BREAKDOWN</span>
          {result.engines.map(eng => {
            const visual = ENGINE_VISUAL[eng.name];
            const sv = SIGNAL_VISUAL[eng.signal] || SIGNAL_VISUAL.HOLD;
            return (
              <div
                key={eng.name}
                className={`flex items-center justify-between p-1.5 rounded-md ${
                  visual?.bgColorClass || 'bg-muted'
                } ${!eng.enabled ? 'opacity-40' : ''}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={visual?.colorClass}>
                    {ENGINE_ICONS[eng.name] || <Activity className="h-4 w-4" />}
                  </span>
                  <span className="text-xs font-medium">{visual?.label || eng.name}</span>
                </div>
                {eng.enabled ? (
                  <div className="flex items-center gap-2">
                    <Badge className={`${sv.bgClass} ${sv.colorClass} text-[10px] px-1.5 py-0`}>
                      {eng.signal}
                    </Badge>
                    <span className="text-xs font-mono">{eng.score.toFixed(1)}</span>
                    <span className="text-[10px] text-muted-foreground">x{eng.weight}</span>
                  </div>
                ) : (
                  <Badge variant="outline" className="text-[10px] opacity-50">OFF</Badge>
                )}
              </div>
            );
          })}
        </div>

        {/* Timestamp */}
        <div className="text-[10px] text-muted-foreground text-center">
          {isValidTimestamp(result.timestamp) ? new Date(result.timestamp).toLocaleString('ar-EG') : '—'}
        </div>
      </CardContent>
    </Card>
  );
}

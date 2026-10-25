/**
 * super-learning/ActionButtonsCard.tsx
 * ====================================
 * Bottom-of-page action buttons Card for the Super Learning System:
 * - تعلم تكراري (until 75% win-rate) — calls runIterativeLearningSystem.
 * - اختبار واحد — calls runSingleBacktest.
 * - تطبيق البرمترات — calls applyParameters (visible only when results.win_rate >= 50).
 * - مسح النتائج — clears results/trades/iterations.
 */
'use client';

import React from 'react';
import {
  Brain, Play, Loader2, CheckCircle2, RotateCcw,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { BacktestResult, BacktestIteration, BacktestTrade } from '@/hooks/useSuperLearningData';

export interface ActionButtonsCardProps {
  isRunning: boolean;
  loading: string | null;
  results: BacktestResult | null;
  setResults: React.Dispatch<React.SetStateAction<BacktestResult | null>>;
  setTrades: React.Dispatch<React.SetStateAction<BacktestTrade[]>>;
  setIterations: React.Dispatch<React.SetStateAction<BacktestIteration[]>>;
  runIterativeLearningSystem: () => void;
  runSingleBacktest: () => void;
  applyParameters: () => void;
}

export function ActionButtonsCard(props: ActionButtonsCardProps) {
  const {
    isRunning, loading,
    results, setResults, setTrades, setIterations,
    runIterativeLearningSystem, runSingleBacktest, applyParameters,
  } = props;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap gap-2 justify-between">
          <div className="flex flex-wrap gap-2">
            {/* زر التعلم التكراري - الرئيسي */}
            <Button
              onClick={runIterativeLearningSystem}
              disabled={isRunning || loading !== null}
              className="gap-2 from-profit to-whale hover:from-profit hover:to-whale"
            >
              {loading === 'iterative' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Brain className="w-4 h-4" />
              )}
              تعلم تكراري (حتى 75%)
            </Button>

            {/* زر الاختبار الفردي */}
            <Button
              onClick={runSingleBacktest}
              disabled={isRunning || loading !== null}
              variant="outline"
              className="gap-2"
            >
              {loading === 'backtest' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              اختبار واحد
            </Button>

            {results && results.win_rate >= 50 && (
              <Button
                variant="default"
                onClick={applyParameters}
                disabled={loading !== null}
                className="gap-2 bg-violet-600 hover:bg-violet-700"
              >
                <CheckCircle2 className="w-4 h-4" />
                تطبيق البرمترات
              </Button>
            )}
          </div>

          <Button variant="outline" onClick={() => { setResults(null); setTrades([]); setIterations([]); }} className="gap-2">
            <RotateCcw className="w-4 h-4" />
            مسح النتائج
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

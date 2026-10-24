/**
 * super-learning/tabs/ResultsTab.tsx
 * ==================================
 * The "النتائج" tab — renders backtest results:
 * - Pie chart of trade distribution (winners vs losers).
 * - Line chart of iteration progress (win rate over iterations).
 * - Error analysis & improvements (from the last iteration's analysis object).
 * - Iteration history badges (color-coded by win rate).
 * - Table view of trades (when viewMode = 'table').
 * - Empty state ("قم بتشغيل الاختبار لرؤية النتائج") when no results.
 */
'use client';

import React, { useMemo } from 'react';
import {
  AlertTriangle, XCircle, CheckCircle2, RefreshCw, Loader2, Brain,
} from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart as RechartsPieChart, Pie, Cell,
} from 'recharts';
import { UnifiedTable } from '@/components/shared/UnifiedTable';
import type { Column } from '@/components/shared/UnifiedTable';
import { cn } from '@/lib/utils';
import type {
  BacktestResult,
  BacktestIteration,
  BacktestTrade,
} from '@/hooks/useSuperLearningData';
import { COLORS } from '../constants';
import { buildTradesColumns } from '../columns';
import { safeNumber, safeToFixed } from '../helpers';

export interface ResultsTabProps {
  viewMode: 'chart' | 'table';
  results: BacktestResult | null;
  iterations: BacktestIteration[];
  trades: BacktestTrade[];
  targetWinRate: number;
}

export function ResultsTab({ viewMode, results, iterations, trades, targetWinRate }: ResultsTabProps) {
  const tradesColumns: Column<BacktestTrade>[] = useMemo(() => buildTradesColumns(), []);
  const tradesTableRows = useMemo(() => trades.slice(0, 50), [trades]);

  const iterationsChartData = iterations.map((iter) => ({
    name: `#${iter.iteration}`,
    winRate: safeNumber(iter?.result?.win_rate, 0),
    trades: safeNumber(iter?.result?.total_trades, 0),
    return: safeNumber(iter?.result?.total_return, 0)
  }));

  const tradesPieData = results ? [
    { name: 'رابحة', value: results.winning_trades, color: COLORS.winners },
    { name: 'خاسرة', value: results.losing_trades, color: COLORS.losers }
  ] : [];

  return (
    <div className="space-y-4">
      {results ? (
        <>
          {/* Charts */}
          {viewMode === 'chart' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">توزيع الصفقات</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie data={tradesPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value">
                          {tradesPieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {iterations.length > 1 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">تقدم الاختبارات</CardTitle></CardHeader>
                  <CardContent>
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsLineChart data={iterationsChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis domain={[0, 100]} />
                          <Tooltip />
                          <Line type="monotone" dataKey="winRate" stroke={COLORS.winRate} strokeWidth={2} name="نسبة النجاح %" />
                        </RechartsLineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Error Analysis & Improvements - NEW! */}
          {iterations.length > 0 && iterations[iterations.length - 1].analysis && (
            <Card className="border-warning ">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  تحليل الأخطاء والتحسينات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Errors Detected */}
                  <div className="space-y-2">
                    <h4 className="font-medium text-loss flex items-center gap-2">
                      <XCircle className="w-4 h-4" />
                      الأخطاء المكتشفة
                    </h4>
                    <div className="space-y-1">
                      {iterations[iterations.length - 1].analysis?.errors_detected.map((error, idx) => (
                        <div key={idx} className="text-sm p-2 bg-loss/10 rounded border border-loss ">
                          {error}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Improvements Made */}
                  <div className="space-y-2">
                    <h4 className="font-medium text-success flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      التحسينات المطبقة
                    </h4>
                    <div className="space-y-1">
                      {iterations[iterations.length - 1].analysis?.improvements_made.length > 0 ? (
                        iterations[iterations.length - 1].analysis?.improvements_made.map((improvement, idx) => (
                          <div key={idx} className="text-sm p-2 bg-success/10 rounded border border-success dark:border-success">
                            {improvement}
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground p-2">
                          لا توجد تحسينات بعد - التكرار الأول
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Iteration History */}
                {iterations.length > 1 && (
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      سجل التكرارات ({iterations.length} دورة)
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {iterations.map((iter, idx) => (
                        <Badge
                          key={idx}
                          variant={safeNumber(iter?.result?.win_rate) >= targetWinRate ? "default" : "outline"}
                          className={cn(
                            "cursor-pointer",
                            safeNumber(iter?.result?.win_rate) >= 70 && "bg-success hover:bg-success",
                            safeNumber(iter?.result?.win_rate) >= 50 && safeNumber(iter?.result?.win_rate) < 70 && "bg-warning hover:bg-warning",
                            safeNumber(iter?.result?.win_rate) < 50 && "bg-loss hover:bg-loss"
                          )}
                        >
                          #{iter?.iteration || idx + 1}: {safeToFixed(iter?.result?.win_rate)}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Table View */}
          {viewMode === 'table' && trades.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">الصفقات</CardTitle></CardHeader>
              <CardContent>
                <UnifiedTable
                  columns={tradesColumns}
                  data={tradesTableRows}
                  keyField="id"
                  dense
                  columnToggle
                  filterable
                  maxHeight="max-h-[400px]"
                />
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card className="p-8 text-center">
          <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <p className="text-muted-foreground">قم بتشغيل الاختبار لرؤية النتائج</p>
        </Card>
      )}
    </div>
  );
}

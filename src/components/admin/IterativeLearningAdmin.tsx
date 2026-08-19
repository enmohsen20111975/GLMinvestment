'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain, Play, Pause, RotateCcw, TrendingUp, Target,
  BarChart3, Settings, Zap, CheckCircle2, XCircle,
  Activity, Lightbulb, Award, RefreshCw, Loader2, Sliders
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Backend API base - use proxy route for client-side calls
// This avoids CORS issues and works in both development and production
const API_BASE = '/api/python';

// Types
interface BacktestParams {
  min_risk_reward: number;
  min_score_for_signal: number;
  min_candle_score: number;
  max_rsi_for_buy: number;
  rsi_overbought: number;
  rsi_oversold: number;
  rsi_extreme_high: number;
  stop_loss_min_pct: number;
  stop_loss_max_pct: number;
  target_multiplier: number;
  weeks_to_test: number;
  max_picks_per_week: number;
}

interface IterationResult {
  iteration: number;
  win_rate: number;
  profit_factor: number;
  score: number;
  params: BacktestParams;
}

interface LearningStatus {
  is_running: boolean;
  current_iteration: number;
  max_iterations: number;
  best_score: number;
  best_params: BacktestParams | null;
  targets: {
    win_rate: number;
    profit_factor: number;
  };
  history: IterationResult[];
}

// Default params
const DEFAULT_PARAMS: BacktestParams = {
  min_risk_reward: 1.8,
  min_score_for_signal: 75,
  min_candle_score: 20,
  max_rsi_for_buy: 65,
  rsi_overbought: 70,
  rsi_oversold: 30,
  rsi_extreme_high: 85,
  stop_loss_min_pct: 5.0,
  stop_loss_max_pct: 10.0,
  target_multiplier: 1.8,
  weeks_to_test: 8,
  max_picks_per_week: 3
};

const PARAM_LABELS: Record<keyof BacktestParams, string> = {
  min_risk_reward: 'نسبة المخاطرة/عائد',
  min_score_for_signal: 'أقل درجة للإشارة',
  min_candle_score: 'أقل درجة للشمعة',
  max_rsi_for_buy: 'أقصى RSI للشراء',
  rsi_overbought: 'RSI تشبع شرائي',
  rsi_oversold: 'RSI تشبع بيعي',
  rsi_extreme_high: 'RSI طبيعي جداً',
  stop_loss_min_pct: 'أقل وقف %',
  stop_loss_max_pct: 'أقصى وقف %',
  target_multiplier: 'مضاعف الهدف',
  weeks_to_test: 'أسابيع الاختبار',
  max_picks_per_week: 'اختيارات/أسبوع'
};

/**
 * Iterative Learning Admin Panel
 * نظام التعلم الذاتي التكراري
 */
export function IterativeLearningAdmin() {
  // State
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [params, setParams] = useState<BacktestParams>(DEFAULT_PARAMS);
  const [targetWinRate, setTargetWinRate] = useState(55);
  const [targetProfitFactor, setTargetProfitFactor] = useState(1.3);
  const [maxIterations, setMaxIterations] = useState(20);
  const [loading, setLoading] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<any>(null);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
    fetchParams();
  }, []);

  // Poll when running
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Fetch current status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/iterative-learning/status`);
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
        setIsRunning(data.data.is_running);
      }
    } catch (e) {
      console.error('Failed to fetch status:', e);
    }
  }, []);

  // Fetch current params
  const fetchParams = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/backtest/params`);
      const data = await res.json();
      if (data.success && data.data.params) {
        setParams(data.data.params);
      }
    } catch (e) {
      console.error('Failed to fetch params:', e);
    }
  }, []);

  // Run auto learning
  const handleRunAuto = useCallback(async () => {
    setLoading('start');
    setIsRunning(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/iterative-learning/run-auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_win_rate: targetWinRate,
          target_profit_factor: targetProfitFactor,
          max_iterations: maxIterations
        })
      });
      
      const data = await res.json();
      if (data.success) {
        setLastResults(data.data);
        if (data.data.status === 'TARGET_REACHED') {
          toast.success(`🎯 تم الوصول للهدف! Win Rate: ${data.data.final_results.win_rate}%, PF: ${data.data.final_results.profit_factor}`);
        } else {
          toast.info(`انتهت ${data.data.iterations} تكرارات. أفضل: WR=${data.data.best_results?.win_rate}%`);
        }
        if (data.data.best_params) {
          setParams(data.data.best_params);
        }
      } else {
        toast.error(data.error || 'فشل في التعلم');
      }
    } catch (e) {
      toast.error('فشل في الاتصال بالخادم');
    } finally {
      setLoading(null);
      setIsRunning(false);
      fetchStatus();
    }
  }, [targetWinRate, targetProfitFactor, maxIterations]);

  // Stop learning
  const handleStop = useCallback(async () => {
    setLoading('stop');
    try {
      await fetch(`${API_BASE}/api/admin/iterative-learning/stop`, { method: 'POST' });
      setIsRunning(false);
      toast.success('تم إيقاف التعلم');
    } catch (e) {
      toast.error('فشل في الإيقاف');
    } finally {
      setLoading(null);
    }
  }, []);

  // Run single backtest
  const handleSingleBacktest = useCallback(async () => {
    setLoading('backtest');
    try {
      const res = await fetch(`${API_BASE}/api/admin/backtest/run-enhanced`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        const stats = data.data.results?.statistics || {};
        setLastResults({
          win_rate: stats.win_rate,
          profit_factor: stats.profit_factor,
          total_trades: stats.total_trades
        });
        toast.success(`Win Rate: ${stats.win_rate}%, PF: ${stats.profit_factor}`);
      } else {
        toast.error(data.error || 'فشل الاختبار');
      }
    } catch (e) {
      toast.error('فشل في تشغيل الاختبار');
    } finally {
      setLoading(null);
    }
  }, []);

  // Update params
  const handleUpdateParams = useCallback(async (newParams: Partial<BacktestParams>) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/backtest/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newParams)
      });
      const data = await res.json();
      if (data.success) {
        setParams(data.data.params);
        toast.success('تم تحديث المعاملات');
      }
    } catch (e) {
      toast.error('فشل في تحديث المعاملات');
    }
  }, []);

  // Progress percentage
  const progressPct = status?.current_iteration && status?.max_iterations
    ? (status.current_iteration / status.max_iterations) * 100
    : 0;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl shadow-lg">
            <Brain className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold">التعلم الذاتي التكراري</h2>
            <p className="text-sm text-muted-foreground">تحسين تلقائي للمعاملات</p>
          </div>
        </div>
        <Badge 
          variant={isRunning ? 'default' : 'secondary'}
          className={cn('gap-1.5 px-3 py-1', isRunning && 'bg-violet-600 animate-pulse')}
        >
          {isRunning ? (
            <>
              <RefreshCw className="h-3 w-3 animate-spin" />
              جاري التعلم...
            </>
          ) : (
            <>
              <Activity className="h-3 w-3" />
              جاهز
            </>
          )}
        </Badge>
      </div>

      {/* Progress Card */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-l from-violet-600 via-purple-600 to-violet-700 p-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold">تقدم التعلم</h3>
              <p className="text-sm text-white/80">
                الهدف: Win Rate {targetWinRate}% | PF {targetProfitFactor}
              </p>
            </div>
            <div className="text-left">
              <p className="text-3xl font-bold">
                {status?.current_iteration || 0}/{status?.max_iterations || maxIterations}
              </p>
              <p className="text-xs text-white/70">التكرار الحالي</p>
            </div>
          </div>
          
          <Progress value={progressPct} className="h-3 bg-white/20" />
          
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{status?.best_score?.toFixed(2) || '0.00'}</p>
              <p className="text-xs text-white/70">أفضل Score</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{status?.history?.length || 0}</p>
              <p className="text-xs text-white/70">التكرارات</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">
                {lastResults ? `${lastResults.win_rate}%` : '-'}
              </p>
              <p className="text-xs text-white/70">Win Rate</p>
            </div>
          </div>
        </div>
        
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={isRunning ? handleStop : handleRunAuto}
              disabled={loading !== null}
              className={cn('gap-2', isRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-violet-600 hover:bg-violet-700')}
            >
              {loading === 'start' || loading === 'stop' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRunning ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isRunning ? 'إيقاف' : 'تشغيل التعلم الذاتي'}
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleSingleBacktest} 
              disabled={isRunning || loading !== null} 
              className="gap-2"
            >
              {loading === 'backtest' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BarChart3 className="h-4 w-4" />
              )}
              اختبار واحد
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />
            إعدادات التعلم
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>الهدف Win Rate: {targetWinRate}%</Label>
              <Slider
                value={[targetWinRate]}
                onValueChange={([v]) => setTargetWinRate(v)}
                min={50}
                max={80}
                step={5}
              />
            </div>
            
            <div className="space-y-2">
              <Label>الهدف Profit Factor: {targetProfitFactor}</Label>
              <Slider
                value={[targetProfitFactor * 10]}
                onValueChange={([v]) => setTargetProfitFactor(v / 10)}
                min={10}
                max={25}
                step={1}
              />
            </div>
            
            <div className="space-y-2">
              <Label>أقصى تكرارات: {maxIterations}</Label>
              <Slider
                value={[maxIterations]}
                onValueChange={([v]) => setMaxIterations(v)}
                min={5}
                max={50}
                step={5}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Parameters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sliders className="h-4 w-4" />
            المعاملات الحالية
          </CardTitle>
          <CardDescription>
            يتم تعديلها تلقائياً أثناء التعلم
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {(Object.keys(params) as Array<keyof BacktestParams>).map((key) => (
              <div key={key} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                <span className="text-xs text-muted-foreground">{PARAM_LABELS[key]}</span>
                <Badge variant="outline" className="font-mono">
                  {typeof params[key] === 'number' ? params[key].toFixed(1) : params[key]}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* History Table */}
      {status?.history && status.history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              سجل التكرارات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Win Rate</TableHead>
                  <TableHead>Profit Factor</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>R:R</TableHead>
                  <TableHead>Min Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.history.slice(-10).map((iter) => (
                  <TableRow key={iter.iteration}>
                    <TableCell>{iter.iteration}</TableCell>
                    <TableCell className={cn(
                      iter.win_rate >= targetWinRate ? 'text-green-600' : 'text-amber-600'
                    )}>
                      {iter.win_rate.toFixed(1)}%
                    </TableCell>
                    <TableCell className={cn(
                      iter.profit_factor >= targetProfitFactor ? 'text-green-600' : 'text-amber-600'
                    )}>
                      {iter.profit_factor.toFixed(2)}
                    </TableCell>
                    <TableCell>{iter.score.toFixed(3)}</TableCell>
                    <TableCell>{iter.params?.min_risk_reward?.toFixed(1)}</TableCell>
                    <TableCell>{iter.params?.min_score_for_signal}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Best Parameters */}
      {status?.best_params && (
        <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-green-700 dark:text-green-400">
              <Award className="h-4 w-4" />
              أفضل معاملات وجدها النظام
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {(Object.keys(status.best_params) as Array<keyof BacktestParams>).map((key) => (
                <div key={key} className="flex items-center justify-between p-2 bg-green-100/50 dark:bg-green-900/30 rounded-lg">
                  <span className="text-xs">{PARAM_LABELS[key]}</span>
                  <Badge className="bg-green-600">
                    {typeof status.best_params![key] === 'number' 
                      ? (status.best_params![key] as number).toFixed(1) 
                      : status.best_params![key]}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

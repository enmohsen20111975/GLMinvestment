'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Play, Pause, RotateCcw, TrendingUp, TrendingDown, Target,
  BarChart3, Settings, Zap, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Clock, DollarSign, Percent, Activity,
  Lightbulb, Award, RefreshCw, Info, LayoutGrid, List, PieChart, Bug
} from 'lucide-react';
import { HelpTooltip, HELP_DEFINITIONS } from '@/components/ui/help-tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart as RechartsPieChart,
  Pie,
  Legend,
} from 'recharts';

// Types
interface LearningProgress {
  target_win_rate: number;
  current_win_rate: number;
  iterations: LearningIteration[];
  best_parameters: LearningParameters;
  best_win_rate: number;
  total_trades_analyzed: number;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  winning_patterns?: string[];
  losing_patterns?: string[];
  cross_validation_score?: number;
}

interface LearningIteration {
  iteration: number;
  parameters: LearningParameters;
  result: BacktestResult;
  changes: string[];
  timestamp: string;
  pattern_insights?: string[];
  data_range?: {
    start_date: string;
    end_date: string;
    tickers_count: number;
  };
}

interface BacktestResult {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_return: number;
  avg_winner: number;
  avg_loser: number;
  total_return: number;
}

interface LearningParameters {
  rsi_oversold: number;
  rsi_overbought: number;
  rsi_weight: number;
  macd_weight: number;
  ma_weight: number;
  bollinger_std: number;
  bollinger_weight: number;
  stop_loss_min: number;
  stop_loss_max: number;
  target_multiplier: number;
  confidence_threshold: number;
  min_indicators_agree: number;
  volume_threshold: number;
  volume_weight: number;
}

interface BacktestTrade {
  id: number;
  ticker: string;
  entry_date: string;
  entry_price: number;
  action: 'BUY' | 'SELL';
  actual_return: number;
  analysis_correct: boolean;
  reasoning: string;
}

// Default parameters
const DEFAULT_PARAMS: LearningParameters = {
  rsi_oversold: 30,
  rsi_overbought: 70,
  rsi_weight: 15,
  macd_weight: 10,
  ma_weight: 12,
  bollinger_std: 2,
  bollinger_weight: 8,
  stop_loss_min: 3,
  stop_loss_max: 8,
  target_multiplier: 2,
  confidence_threshold: 55,
  min_indicators_agree: 2,
  volume_threshold: 1.5,
  volume_weight: 5
};

// Chart configurations
const winRateChartConfig: ChartConfig = {
  winRate: {
    label: 'نسبة النجاح',
    color: 'hsl(var(--chart-1))',
  },
  target: {
    label: 'الهدف',
    color: 'hsl(var(--chart-2))',
  },
};

const returnChartConfig: ChartConfig = {
  return: {
    label: 'العائد',
    color: 'hsl(var(--chart-3))',
  },
};

const tradesChartConfig: ChartConfig = {
  trades: {
    label: 'الصفقات',
    color: 'hsl(var(--chart-4))',
  },
  winners: {
    label: 'رابحة',
    color: 'hsl(142, 76%, 36%)',
  },
  losers: {
    label: 'خاسرة',
    color: 'hsl(0, 84%, 60%)',
  },
};

// View mode type
type ViewMode = 'table' | 'chart';

// Debug log interface
interface DebugLog {
  timestamp: string;
  action: string;
  url: string;
  status: 'pending' | 'success' | 'error';
  duration?: number;
  message?: string;
  data?: any;
}

// Use server-side API to avoid CORS issues

export function IterativeLearningView() {
  // State
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<LearningProgress | null>(null);
  const [targetWinRate, setTargetWinRate] = useState(99);
  const [maxIterations, setMaxIterations] = useState(50);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showDebug, setShowDebug] = useState(true);
  const [pythonHealth, setPythonHealth] = useState<any>(null);
  const [config, setConfig] = useState({
    start_date: '2024-12-01',
    end_date: '2026-05-10',
    capital: 100000,
    max_positions: 10,
    holding_days: 30,
    confidence_threshold: 50
  });
  const [sampleTrades, setSampleTrades] = useState<BacktestTrade[]>([]);
  const [activeTab, setActiveTab] = useState('progress');
  const [viewMode, setViewMode] = useState<ViewMode>('chart');

  // Add debug log
  const addLog = (log: Omit<DebugLog, 'timestamp'>) => {
    setDebugLogs(prev => [...prev.slice(-29), { ...log, timestamp: new Date().toISOString() }]);
  };

  // Check Python health on mount - use server-side API
  useEffect(() => {
    const checkHealth = async () => {
      addLog({ action: 'HEALTH', url: '/api/market/connections', status: 'pending' });
      try {
        const res = await fetch('/api/market/connections');
        const data = await res.json();
        const vpsOk = data?.sources?.vps_python?.available === true;
        if (vpsOk) {
          setPythonHealth({ status: 'ok', latency: data?.sources?.vps_python?.latency_ms });
          addLog({ action: 'HEALTH', url: '/api/market/connections', status: 'success', data: data?.sources?.vps_python });
        } else {
          setPythonHealth(null);
          addLog({ action: 'HEALTH', url: '/api/market/connections', status: 'error', message: data?.sources?.vps_python?.message || 'Not available' });
        }
      } catch (err: any) {
        addLog({ action: 'HEALTH', url: '/api/market/connections', status: 'error', message: err.message });
      }
    };
    checkHealth();
  }, []);

  // Poll for progress updates
  useEffect(() => {
    if (!isRunning) return;
    
    const interval = setInterval(async () => {
      try {
        addLog({ action: 'POLL', url: '/api/iterative-learning?action=progress', status: 'pending' });
        const res = await fetch('/api/iterative-learning?action=progress');
        const data = await res.json();
        if (data.success && data.progress) {
          setProgress(data.progress);
          addLog({ action: 'POLL', url: '/api/iterative-learning?action=progress', status: 'success', data: { win_rate: data.progress.current_win_rate } });
          if (data.progress.status !== 'running') {
            setIsRunning(false);
          }
        }
      } catch (error: any) {
        addLog({ action: 'POLL', url: '/api/iterative-learning?action=progress', status: 'error', message: error.message });
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isRunning]);

  // Start iterative learning
  const handleStart = useCallback(async () => {
    setIsRunning(true);
    addLog({ action: 'START', url: '/api/iterative-learning', status: 'pending' });
    try {
      const res = await fetch('/api/iterative-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          targetWinRate,
          maxIterations,
          config
        })
      });
      
      const data = await res.json();
      if (data.success) {
        toast.success(`Started iterative learning - Target: ${targetWinRate}%`);
        setProgress(data.progress);
        addLog({ action: 'START', url: '/api/iterative-learning', status: 'success', data });
      } else {
        toast.error(data.error || 'Failed to start');
        setIsRunning(false);
        addLog({ action: 'START', url: '/api/iterative-learning', status: 'error', message: data.error });
      }
    } catch (error: any) {
      toast.error('Failed to start iterative learning');
      setIsRunning(false);
      addLog({ action: 'START', url: '/api/iterative-learning', status: 'error', message: error.message });
    }
  }, [targetWinRate, maxIterations, config]);

  // Stop iterative learning
  const handleStop = useCallback(async () => {
    try {
      await fetch('/api/iterative-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      setIsRunning(false);
      toast.success('Iterative learning stopped');
    } catch (error) {
      toast.error('Failed to stop');
    }
  }, []);

  // Run single backtest
  const handleSingleBacktest = useCallback(async () => {
    try {
      toast.info('Running single backtest...');
      addLog({ action: 'BACKTEST', url: '/api/iterative-learning', status: 'pending' });
      const res = await fetch('/api/iterative-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'single-backtest',
          config,
          parameters: DEFAULT_PARAMS
        })
      });
      
      const data = await res.json();
      if (data.success) {
        setSampleTrades(data.sample_trades || []);
        setProgress({
          target_win_rate: targetWinRate,
          current_win_rate: data.result.win_rate,
          iterations: [{
            iteration: 1,
            parameters: DEFAULT_PARAMS,
            result: data.result,
            changes: [],
            timestamp: new Date().toISOString()
          }],
          best_parameters: DEFAULT_PARAMS,
          best_win_rate: data.result.win_rate,
          total_trades_analyzed: data.result.total_trades,
          status: 'completed',
          started_at: new Date().toISOString()
        });
        toast.success(`Backtest complete: ${safeToFixed(data?.result?.win_rate)}% win rate`);
        addLog({ action: 'BACKTEST', url: '/api/iterative-learning', status: 'success', data: { win_rate: data.result.win_rate, trades: data.result.total_trades } });
      } else {
        toast.error(data.error || 'Backtest failed');
        addLog({ action: 'BACKTEST', url: '/api/iterative-learning', status: 'error', message: data.error });
      }
    } catch (error: any) {
      toast.error('Failed to run backtest');
      addLog({ action: 'BACKTEST', url: '/api/iterative-learning', status: 'error', message: error.message });
    }
  }, [config, targetWinRate]);

  // Render progress bar color
  const getProgressColor = (winRate: number) => {
    if (winRate >= 80) return 'bg-emerald-500';
    if (winRate >= 60) return 'bg-teal-500';
    if (winRate >= 40) return 'bg-amber-500';
    return 'bg-red-500';
  };

  // Helper function for safe toFixed
  const safeToFixed = (value: number | undefined | null, decimals: number = 1): string => {
    if (value === undefined || value === null || isNaN(value)) return '0';
    return value.toFixed(decimals);
  };

  // Helper function for safe number conversion
  const safeNumber = (value: number | undefined | null, defaultValue: number = 0): number => {
    if (value === undefined || value === null || isNaN(value)) return defaultValue;
    return value;
  };

  // Prepare chart data from iterations
  const winRateChartData = progress?.iterations.map((iter, idx) => ({
    iteration: iter.iteration,
    winRate: safeNumber(iter?.result?.win_rate, 0),
    target: targetWinRate,
    trades: safeNumber(iter?.result?.total_trades, 0),
    return: safeNumber(iter?.result?.total_return, 0),
  })) || [];

  const tradesChartData = progress?.iterations.map((iter) => ({
    iteration: iter?.iteration || 0,
    winners: safeNumber(iter?.result?.winning_trades, 0),
    losers: safeNumber(iter?.result?.losing_trades, 0),
  })) || [];

  // Pie chart data for win/loss distribution
  const pieChartData = progress ? [
    { name: 'رابحة', value: progress.iterations.reduce((sum, i) => sum + safeNumber(i?.result?.winning_trades, 0), 0), color: 'hsl(142, 76%, 36%)' },
    { name: 'خاسرة', value: progress.iterations.reduce((sum, i) => sum + safeNumber(i?.result?.losing_trades, 0), 0), color: 'hsl(0, 84%, 60%)' },
  ] : [];

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl shadow-lg">
            <Brain className="h-6 w-6 text-white" />
          </div>
          <div className="flex items-center gap-2">
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                نظام التعلم التكراري
                <HelpTooltip items={HELP_DEFINITIONS.learningSystem.items} />
              </h1>
              <p className="text-sm text-muted-foreground">تحسين نسبة النجاح من 60% إلى 99%</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {progress && (
            <Badge 
              variant={progress.status === 'running' ? 'default' : 'secondary'}
              className={cn(
                'gap-1.5 px-3 py-1',
                progress.status === 'running' && 'bg-violet-600 animate-pulse'
              )}
            >
              {progress.status === 'running' ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  جاري التعلم...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  مكتمل
                </>
              )}
            </Badge>
          )}
        </div>
      </div>

      {/* Debug Terminal - ALWAYS VISIBLE */}
      <Card className="border-2 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-yellow-700">
              <Bug className="w-5 h-5" />
              Debug Terminal - لوحة التشخيص
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowDebug(!showDebug)}>
              {showDebug ? 'إخفاء' : 'إظهار'}
            </Button>
          </div>
          <CardDescription>
            الاتصال عبر Server-side API | Status: {pythonHealth ? (
              <Badge variant="default" className="bg-green-500 ml-1">متصل ✓</Badge>
            ) : (
              <Badge variant="destructive" className="ml-1">غير متصل ✗</Badge>
            )}
          </CardDescription>
        </CardHeader>
        {showDebug && (
          <CardContent>
            <div className="bg-gray-900 text-green-400 p-3 rounded-lg font-mono text-xs max-h-48 overflow-auto">
              {debugLogs.length === 0 ? (
                <span className="text-gray-500">في انتظار البيانات...</span>
              ) : (
                debugLogs.map((log, idx) => (
                  <div key={idx} className={`mb-1 pb-1 border-b border-gray-700 ${log.status === 'error' ? 'text-red-400' : log.status === 'success' ? 'text-green-400' : 'text-yellow-400'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">[{log.timestamp.split('T')[1]?.slice(0, 8)}]</span>
                      <span className="text-cyan-400">{log.action}</span>
                      <span className={`px-1 rounded ${log.status === 'success' ? 'bg-green-900' : log.status === 'error' ? 'bg-red-900' : 'bg-yellow-900'}`}>
                        {log.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-gray-400 truncate">{log.url}</div>
                    {log.message && <div className="text-red-500">ERROR: {log.message}</div>}
                    {log.data && (
                      <pre className="text-gray-300 bg-gray-800 p-1 rounded mt-1 overflow-auto">
                        {JSON.stringify(log.data, null, 1).slice(0, 200)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Main Progress Card */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-l from-violet-600 via-purple-600 to-violet-700 p-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold">تقدم التعلم</h3>
              <p className="text-sm text-white/80">
                الهدف: {targetWinRate}% | الحالي: {safeToFixed(progress?.current_win_rate)}%
              </p>
            </div>
            <div className="text-left">
              <p className="text-3xl font-bold">
                {safeToFixed(progress?.current_win_rate)}%
              </p>
              <p className="text-xs text-white/70">نسبة النجاح</p>
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="relative h-4 bg-white/20 rounded-full overflow-hidden">
            <motion.div
              className={cn('absolute inset-y-0 right-0 rounded-full', getProgressColor(progress?.current_win_rate || 0))}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (progress?.current_win_rate || 0) / targetWinRate * 100)}%` }}
              transition={{ duration: 0.5 }}
            />
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-white/50"
              style={{ right: `${(targetWinRate / 100) * 100}%` }}
            />
          </div>
          
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{progress?.iterations.length || 0}</p>
              <p className="text-xs text-white/70">التكرارات</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{progress?.total_trades_analyzed || 0}</p>
              <p className="text-xs text-white/70">الصفقات</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{safeToFixed(progress?.best_win_rate)}%</p>
              <p className="text-xs text-white/70">أفضل نسبة</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">
                {safeToFixed(progress?.cross_validation_score, 1) || '-'}
              </p>
              <p className="text-xs text-white/70">CV Score</p>
            </div>
          </div>
        </div>
        
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={isRunning ? handleStop : handleStart}
              className={cn('gap-2', isRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-violet-600 hover:bg-violet-700')}
            >
              {isRunning ? (
                <>
                  <Pause className="h-4 w-4" />
                  إيقاف
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  بدء التعلم التكراري
                </>
              )}
            </Button>
            
            <Button variant="outline" onClick={handleSingleBacktest} disabled={isRunning} className="gap-2">
              <BarChart3 className="h-4 w-4" />
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
          {/* الفترة الزمنية */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-muted/50 rounded-lg">
            <div className="space-y-2">
              <Label>من تاريخ</Label>
              <Input
                type="date"
                value={config.start_date}
                onChange={(e) => setConfig({ ...config, start_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>إلى تاريخ</Label>
              <Input
                type="date"
                value={config.end_date}
                onChange={(e) => setConfig({ ...config, end_date: e.target.value })}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>الهدف: {targetWinRate}%</Label>
              <Slider
                value={[targetWinRate]}
                onValueChange={([v]) => setTargetWinRate(v)}
                min={60}
                max={99}
                step={1}
              />
            </div>
            
            <div className="space-y-2">
              <Label>أقصى تكرارات: {maxIterations}</Label>
              <Slider
                value={[maxIterations]}
                onValueChange={([v]) => setMaxIterations(v)}
                min={10}
                max={100}
                step={5}
              />
            </div>
            
            <div className="space-y-2">
              <Label>رأس المال</Label>
              <Input
                type="number"
                value={config.capital}
                onChange={(e) => setConfig({ ...config, capital: Number(e.target.value) })}
              />
            </div>
            
            <div className="space-y-2">
              <Label>أيام الاحتفاظ</Label>
              <Input
                type="number"
                value={config.holding_days}
                onChange={(e) => setConfig({ ...config, holding_days: Number(e.target.value) })}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>حد الثقة: {config.confidence_threshold}%</Label>
              <Slider
                value={[config.confidence_threshold]}
                onValueChange={([v]) => setConfig({ ...config, confidence_threshold: v })}
                min={40}
                max={80}
                step={5}
              />
              <p className="text-xs text-muted-foreground">أقل = صفقات أكثر</p>
            </div>
            
            <div className="space-y-2">
              <Label>أقصى صفقات مفتوحة</Label>
              <Input
                type="number"
                value={config.max_positions}
                onChange={(e) => setConfig({ ...config, max_positions: Number(e.target.value) })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-3 gap-1">
          <TabsTrigger value="progress">التقدم</TabsTrigger>
          <TabsTrigger value="trades">الصفقات</TabsTrigger>
          <TabsTrigger value="parameters">البارامترات</TabsTrigger>
        </TabsList>

        {/* Progress Tab */}
        <TabsContent value="progress" className="space-y-4">
          {progress && progress.iterations.length > 0 ? (
            <div className="space-y-4">
              {/* View Mode Toggle */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">تاريخ التكرارات</h3>
                <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
                  <Button
                    variant={viewMode === 'chart' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('chart')}
                    className="gap-1"
                  >
                    <PieChart className="h-4 w-4" />
                    رسم بياني
                  </Button>
                  <Button
                    variant={viewMode === 'table' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('table')}
                    className="gap-1"
                  >
                    <List className="h-4 w-4" />
                    جدول
                  </Button>
                </div>
              </div>

              {viewMode === 'chart' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Win Rate Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">نسبة النجاح عبر التكرارات</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={winRateChartConfig} className="h-[300px]">
                        <LineChart data={winRateChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="iteration" />
                          <YAxis domain={[0, 100]} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line
                            type="monotone"
                            dataKey="winRate"
                            stroke="hsl(var(--chart-1))"
                            strokeWidth={2}
                            dot={{ fill: 'hsl(var(--chart-1))' }}
                          />
                          <Line
                            type="monotone"
                            dataKey="target"
                            stroke="hsl(var(--chart-2))"
                            strokeDasharray="5 5"
                            dot={false}
                          />
                        </LineChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  {/* Trades Distribution Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">توزيع الصفقات</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={tradesChartConfig} className="h-[300px]">
                        <BarChart data={tradesChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="iteration" />
                          <YAxis />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="winners" fill="hsl(142, 76%, 36%)" name="رابحة" />
                          <Bar dataKey="losers" fill="hsl(0, 84%, 60%)" name="خاسرة" />
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  {/* Return Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">العائد الإجمالي</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={returnChartConfig} className="h-[300px]">
                        <BarChart data={winRateChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="iteration" />
                          <YAxis />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="return">
                            {winRateChartData.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={entry.return >= 0 ? 'hsl(142, 76%, 36%)' : 'hsl(0, 84%, 60%)'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  {/* Win/Loss Pie Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">نسبة الربح/الخسارة الإجمالية</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={tradesChartConfig} className="h-[300px]">
                        <RechartsPieChart>
                          <Pie
                            data={pieChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                          >
                            {pieChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Legend />
                        </RechartsPieChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="max-h-[400px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">#</TableHead>
                            <TableHead className="text-right">الصفقات</TableHead>
                            <TableHead className="text-right">نسبة النجاح</TableHead>
                            <TableHead className="text-right">العائد</TableHead>
                            <TableHead className="text-right">التغييرات</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {progress.iterations.slice().reverse().map((iter) => (
                            <TableRow key={iter.iteration}>
                              <TableCell className="font-medium">{iter.iteration}</TableCell>
                              <TableCell>{iter.result.total_trades}</TableCell>
                              <TableCell>
                                <Badge className={cn(
                                  safeNumber(iter?.result?.win_rate) >= 60 ? 'bg-emerald-100 text-emerald-700' : 
                                  safeNumber(iter?.result?.win_rate) >= 40 ? 'bg-amber-100 text-amber-700' : 
                                  'bg-red-100 text-red-700'
                                )}>
                                  {safeToFixed(iter?.result?.win_rate, 1)}%
                                </Badge>
                              </TableCell>
                              <TableCell className={cn(
                                safeNumber(iter?.result?.total_return) >= 0 ? 'text-emerald-600' : 'text-red-600'
                              )}>
                                {safeNumber(iter?.result?.total_return) >= 0 ? '+' : ''}{safeToFixed(iter?.result?.total_return, 2)}%
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {iter.changes.length > 0 ? iter.changes[0].slice(0, 50) + '...' : '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>لم يتم تشغيل التعلم التكراري بعد</p>
                <p className="text-sm mt-2">اضغط "بدء التعلم التكراري" للبدء</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Trades Tab */}
        <TabsContent value="trades" className="space-y-4">
          {sampleTrades.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">عينة من الصفقات</CardTitle>
                <CardDescription>آخر 20 صفقة من الاختبار</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">السهم</TableHead>
                        <TableHead className="text-right">التاريخ</TableHead>
                        <TableHead className="text-right">النوع</TableHead>
                        <TableHead className="text-right">العائد</TableHead>
                        <TableHead className="text-right">صحيح؟</TableHead>
                        <TableHead className="text-right">التحليل</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sampleTrades.map((trade) => (
                        <TableRow key={trade.id}>
                          <TableCell className="font-mono font-bold">{trade.ticker}</TableCell>
                          <TableCell className="text-sm">{trade.entry_date}</TableCell>
                          <TableCell>
                            <Badge variant={trade.action === 'BUY' ? 'default' : 'destructive'}>
                              {trade.action === 'BUY' ? 'شراء' : 'بيع'}
                            </Badge>
                          </TableCell>
                          <TableCell className={cn(
                            safeNumber(trade?.actual_return) >= 0 ? 'text-emerald-600' : 'text-red-600'
                          )}>
                            {safeNumber(trade?.actual_return) >= 0 ? '+' : ''}{safeToFixed(trade?.actual_return, 2)}%
                          </TableCell>
                          <TableCell>
                            {trade.analysis_correct ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                            {trade.reasoning}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>لا توجد صفقات لعرضها</p>
                <p className="text-sm mt-2">اضغط "اختبار واحد" لرؤية عينة من الصفقات</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Parameters Tab */}
        <TabsContent value="parameters" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">أفضل البارامترات</CardTitle>
              <CardDescription>البارامترات المثلى بعد التعلم</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {Object.entries(progress?.best_parameters || DEFAULT_PARAMS).map(([key, value]) => (
                  <div key={key} className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">{key.replace(/_/g, ' ')}</p>
                    <p className="text-lg font-bold">{typeof value === 'number' ? safeToFixed(value, 1) : value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

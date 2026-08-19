'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Play, Pause, RotateCcw, TrendingUp, TrendingDown, Target,
  BarChart3, Settings, Zap, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Clock, DollarSign, Percent, Activity,
  Award, RefreshCw, Loader2, PieChart, LineChart, Table2,
  Sliders, Save, Download, Upload, Shield, Flame, Scale
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart as RechartsBarChart, Bar, PieChart as RechartsPieChart, Pie, Cell
} from 'recharts';

// ==================== TYPES ====================

interface BacktestParameters {
  // Technical Indicators
  rsi_oversold: number;
  rsi_overbought: number;
  rsi_weight: number;
  macd_weight: number;
  ma_weight: number;
  bollinger_std: number;
  bollinger_weight: number;
  // Risk Management
  stop_loss_min: number;
  stop_loss_max: number;
  target_multiplier: number;
  // Decision Logic
  confidence_threshold: number;
  min_indicators_agree: number;
  volume_threshold: number;
  volume_weight: number;
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
  max_drawdown: number;
  profit_factor: number;
  sharpe_ratio: number;
  expectancy: number;
}

interface BacktestIteration {
  iteration: number;
  parameters: BacktestParameters;
  result: BacktestResult;
  timestamp: string;
}

interface SimulatedTrade {
  id: number;
  ticker: string;
  stockName: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  action: 'BUY' | 'SELL';
  profitLoss: number;
  profitLossPercent: number;
  holdingDays: number;
  correct: boolean;
}

// ==================== DEFAULT PARAMETERS FOR PERSONAS ====================

const PERSONA_DEFAULTS: Record<string, BacktestParameters> = {
  conservative: {
    rsi_oversold: 35,
    rsi_overbought: 65,
    rsi_weight: 12,
    macd_weight: 8,
    ma_weight: 15,
    bollinger_std: 2.5,
    bollinger_weight: 10,
    stop_loss_min: 4,
    stop_loss_max: 6,
    target_multiplier: 1.5,
    confidence_threshold: 70,
    min_indicators_agree: 3,
    volume_threshold: 1.3,
    volume_weight: 8
  },
  balanced: {
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
  },
  gambler: {
    rsi_oversold: 20,
    rsi_overbought: 80,
    rsi_weight: 18,
    macd_weight: 12,
    ma_weight: 8,
    bollinger_std: 1.5,
    bollinger_weight: 5,
    stop_loss_min: 2,
    stop_loss_max: 15,
    target_multiplier: 3,
    confidence_threshold: 40,
    min_indicators_agree: 1,
    volume_threshold: 1.2,
    volume_weight: 3
  }
};

// Global defaults (system baseline)
const SYSTEM_DEFAULTS: BacktestParameters = PERSONA_DEFAULTS.balanced;

// Parameter descriptions
const PARAM_CONFIG: Record<keyof BacktestParameters, {
  ar: string;
  group: 'technical' | 'risk' | 'decision';
  min: number;
  max: number;
  step: number;
  description: string;
}> = {
  // Technical
  rsi_oversold: { ar: 'مستوى RSI للشراء', group: 'technical', min: 15, max: 40, step: 1, description: 'أقل مستوى RSI للشراء (تشبع بيعي)' },
  rsi_overbought: { ar: 'مستوى RSI للبيع', group: 'technical', min: 60, max: 85, step: 1, description: 'أعلى مستوى RSI للبيع (تشبع شرائي)' },
  rsi_weight: { ar: 'وزن RSI', group: 'technical', min: 5, max: 30, step: 1, description: 'تأثير إشارة RSI على القرار' },
  macd_weight: { ar: 'وزن MACD', group: 'technical', min: 5, max: 25, step: 1, description: 'تأثير إشارة MACD على القرار' },
  ma_weight: { ar: 'وزن المتوسطات', group: 'technical', min: 5, max: 25, step: 1, description: 'تأثير المتوسطات المتحركة' },
  bollinger_std: { ar: 'انحراف Bollinger', group: 'technical', min: 1, max: 3, step: 0.5, description: 'عدد الانحرافات المعيارية' },
  bollinger_weight: { ar: 'وزن Bollinger', group: 'technical', min: 3, max: 20, step: 1, description: 'تأثير أشرطة Bollinger' },
  // Risk
  stop_loss_min: { ar: 'أقل Stop Loss %', group: 'risk', min: 1, max: 6, step: 0.5, description: 'أقل نسبة لوقف الخسارة' },
  stop_loss_max: { ar: 'أقصى Stop Loss %', group: 'risk', min: 5, max: 20, step: 0.5, description: 'أقصى نسبة لوقف الخسارة' },
  target_multiplier: { ar: 'مضاعف الهدف', group: 'risk', min: 1, max: 4, step: 0.5, description: 'الهدف = Stop Loss × المضاعف' },
  // Decision
  confidence_threshold: { ar: 'حد الثقة الأدنى', group: 'decision', min: 30, max: 80, step: 5, description: 'أقل درجة ثقة للدخول في صفقة' },
  min_indicators_agree: { ar: 'أقل مؤشرات متفقة', group: 'decision', min: 1, max: 4, step: 1, description: 'أقل عدد مؤشرات متفقة' },
  volume_threshold: { ar: 'حد الحجم', group: 'decision', min: 1, max: 3, step: 0.1, description: 'نسبة حجم التداول المطلوبة' },
  volume_weight: { ar: 'وزن الحجم', group: 'decision', min: 2, max: 15, step: 1, description: 'تأثير حجم التداول' }
};

// Chart colors
const COLORS = {
  winRate: '#10b981',
  trades: '#6366f1',
  winners: '#22c55e',
  losers: '#ef4444',
  return: '#f59e0b',
  primary: '#8b5cf6',
  conservative: '#3b82f6',
  balanced: '#eab308',
  gambler: '#ef4444'
};

// ==================== PERSONA BADGE COMPONENT ====================

function PersonaBadge({ persona }: { persona: string }) {
  const config = {
    conservative: { icon: Shield, label: 'المستثمر', color: 'bg-blue-500', textColor: 'text-blue-600' },
    balanced: { icon: Scale, label: 'المتوازن', color: 'bg-yellow-500', textColor: 'text-yellow-600' },
    gambler: { icon: Flame, label: 'المضارب', color: 'bg-red-500', textColor: 'text-red-600' }
  };
  
  const c = config[persona as keyof typeof config] || config.balanced;
  const Icon = c.icon;
  
  return (
    <Badge className={`${c.color} text-white gap-1`}>
      <Icon className="w-3 h-3" />
      {c.label}
    </Badge>
  );
}

// ==================== MAIN COMPONENT ====================

export function UnifiedBacktestingSystem() {
  // State
  const [activePersona, setActivePersona] = useState<string>('balanced');
  const [parameters, setParameters] = useState<BacktestParameters>(SYSTEM_DEFAULTS);
  const [customMode, setCustomMode] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<BacktestResult | null>(null);
  const [iterations, setIterations] = useState<BacktestIteration[]>([]);
  const [trades, setTrades] = useState<SimulatedTrade[]>([]);
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [activeTab, setActiveTab] = useState('parameters');
  
  // Config
  const [config, setConfig] = useState({
    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    initialCapital: 100000,
    maxPositions: 5
  });

  // Handle persona change
  const handlePersonaChange = useCallback((persona: string) => {
    setActivePersona(persona);
    if (!customMode) {
      setParameters(PERSONA_DEFAULTS[persona]);
    }
  }, [customMode]);

  // Reset to persona defaults
  const resetToDefaults = useCallback(() => {
    setParameters(PERSONA_DEFAULTS[activePersona]);
    toast.success('تم إعادة الضبط للقيم القياسية');
  }, [activePersona]);

  // Reset all to system defaults
  const resetAllToSystem = useCallback(() => {
    setParameters(SYSTEM_DEFAULTS);
    setActivePersona('balanced');
    setCustomMode(false);
    setResults(null);
    setIterations([]);
    setTrades([]);
    toast.success('تم إعادة ضبط كل الإعدادات');
  }, []);

  // Update single parameter
  const updateParameter = useCallback((key: keyof BacktestParameters, value: number) => {
    setParameters(prev => ({ ...prev, [key]: value }));
    setCustomMode(true);
  }, []);

  // Run backtest
  const runBacktest = useCallback(async () => {
    setLoading('backtest');
    setIsRunning(true);
    
    try {
      const res = await fetch('/api/backtesting/unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parameters,
          config,
          persona: activePersona
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setResults(data.result);
        setTrades(data.trades || []);
        setIterations(prev => [...prev, {
          iteration: prev.length + 1,
          parameters: { ...parameters },
          result: data.result,
          timestamp: new Date().toISOString()
        }]);
        toast.success(`تم الاختبار! نسبة النجاح: ${data.result.win_rate.toFixed(1)}%`);
      } else {
        toast.error(data.error || 'فشل في الاختبار');
      }
    } catch {
      toast.error('خطأ في الاتصال');
    } finally {
      setLoading(null);
      setIsRunning(false);
    }
  }, [parameters, config, activePersona]);

  // Apply parameters to system
  const applyParameters = useCallback(async () => {
    if (!results || results.win_rate < 50) {
      toast.error('نسبة النجاح أقل من 50% - لا يمكن تطبيق الإعدادات');
      return;
    }
    
    setLoading('apply');
    
    try {
      const res = await fetch('/api/backtesting/apply-params', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parameters,
          persona: activePersona,
          winRate: results.win_rate
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        toast.success('تم تطبيق الإعدادات الجديدة على النظام');
      } else {
        toast.error(data.error || 'فشل في التطبيق');
      }
    } catch {
      toast.error('خطأ في الاتصال');
    } finally {
      setLoading(null);
    }
  }, [parameters, activePersona, results]);

  // Export parameters
  const exportParameters = useCallback(() => {
    const data = {
      persona: activePersona,
      parameters,
      results,
      exportedAt: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_params_${activePersona}_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('تم تصدير الإعدادات');
  }, [activePersona, parameters, results]);

  // Get win rate color
  const getWinRateColor = (rate: number) => {
    if (rate >= 70) return 'text-emerald-600 dark:text-emerald-400';
    if (rate >= 50) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  // Prepare chart data
  const iterationsChartData = iterations.map((iter, idx) => ({
    name: `#${iter.iteration}`,
    iteration: iter.iteration,
    winRate: Number(iter.result.win_rate.toFixed(1)),
    trades: iter.result.total_trades,
    winners: iter.result.winning_trades,
    losers: iter.result.losing_trades,
    return: Number(iter.result.total_return.toFixed(2))
  }));

  const tradesPieData = results ? [
    { name: 'رابحة', value: results.winning_trades, color: COLORS.winners },
    { name: 'خاسرة', value: results.losing_trades, color: COLORS.losers }
  ] : [];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl shadow-lg">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">نظام الاختبار والتعلم</h2>
            <p className="text-sm text-muted-foreground">اختبار البرمترات على البيانات التاريخية</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button
              size="sm"
              variant={viewMode === 'chart' ? 'default' : 'ghost'}
              onClick={() => setViewMode('chart')}
              className="gap-1"
            >
              <LineChart className="h-4 w-4" />
              رسوم
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              onClick={() => setViewMode('table')}
              className="gap-1"
            >
              <Table2 className="h-4 w-4" />
              جداول
            </Button>
          </div>
          
          {customMode && (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              ⚙️ وضع مخصص
            </Badge>
          )}
        </div>
      </div>

      {/* Persona Selector Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sliders className="h-4 w-4" />
            اختر الشخصية
          </CardTitle>
          <CardDescription>
            كل شخصية لها إعدادات قياسية مختلفة تناسب مستوى المخاطرة
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {/* Conservative */}
            <Card 
              className={cn(
                "cursor-pointer transition-all hover:shadow-md",
                activePersona === 'conservative' && "ring-2 ring-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
              )}
              onClick={() => handlePersonaChange('conservative')}
            >
              <CardContent className="p-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center mb-2">
                  <Shield className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-sm">المستثمر</h3>
                <p className="text-xs text-muted-foreground mt-1">حماية رأس المال</p>
                <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                  <p>Stop Loss: 4-6%</p>
                  <p>ثقة: 70%+</p>
                </div>
              </CardContent>
            </Card>
            
            {/* Balanced */}
            <Card 
              className={cn(
                "cursor-pointer transition-all hover:shadow-md",
                activePersona === 'balanced' && "ring-2 ring-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20"
              )}
              onClick={() => handlePersonaChange('balanced')}
            >
              <CardContent className="p-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-yellow-100 dark:bg-yellow-950/30 flex items-center justify-center mb-2">
                  <Scale className="w-6 h-6 text-yellow-600" />
                </div>
                <h3 className="font-semibold text-sm">المتوازن</h3>
                <p className="text-xs text-muted-foreground mt-1">توازن العائد والمخاطر</p>
                <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                  <p>Stop Loss: 3-8%</p>
                  <p>ثقة: 55%+</p>
                </div>
              </CardContent>
            </Card>
            
            {/* Gambler */}
            <Card 
              className={cn(
                "cursor-pointer transition-all hover:shadow-md",
                activePersona === 'gambler' && "ring-2 ring-red-500 bg-red-50/50 dark:bg-red-950/20"
              )}
              onClick={() => handlePersonaChange('gambler')}
            >
              <CardContent className="p-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center mb-2">
                  <Flame className="w-6 h-6 text-red-600" />
                </div>
                <h3 className="font-semibold text-sm">المضارب</h3>
                <p className="text-xs text-muted-foreground mt-1">مخاطر عالية</p>
                <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                  <p>Stop Loss: 2-15%</p>
                  <p>ثقة: 40%+</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="parameters" className="gap-1">
            <Sliders className="w-4 h-4" />
            البرمترات
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1">
            <Settings className="w-4 h-4" />
            الإعدادات
          </TabsTrigger>
          <TabsTrigger value="results" className="gap-1">
            <BarChart3 className="w-4 h-4" />
            النتائج
          </TabsTrigger>
        </TabsList>

        {/* Parameters Tab */}
        <TabsContent value="parameters" className="space-y-4">
          {/* Parameters Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PersonaBadge persona={activePersona} />
              {customMode && (
                <Badge variant="outline" className="text-amber-600">
                  تم التعديل
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetToDefaults}
                className="gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                إعادة للقياسي
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetAllToSystem}
                className="text-muted-foreground"
              >
                إعادة ضبط الكل
              </Button>
            </div>
          </div>

          {/* Parameters by Group */}
          {(['technical', 'risk', 'decision'] as const).map(group => (
            <Card key={group}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {group === 'technical' && <TrendingUp className="w-4 h-4 text-blue-500" />}
                  {group === 'risk' && <Shield className="w-4 h-4 text-amber-500" />}
                  {group === 'decision' && <Target className="w-4 h-4 text-purple-500" />}
                  {group === 'technical' && 'المؤشرات الفنية'}
                  {group === 'risk' && 'إدارة المخاطر'}
                  {group === 'decision' && 'منطق القرار'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(Object.keys(PARAM_CONFIG) as Array<keyof BacktestParameters>)
                    .filter(key => PARAM_CONFIG[key].group === group)
                    .map(key => {
                      const cfg = PARAM_CONFIG[key];
                      const defaultValue = PERSONA_DEFAULTS[activePersona][key];
                      const isModified = parameters[key] !== defaultValue;
                      
                      return (
                        <div 
                          key={key} 
                          className={cn(
                            "space-y-1.5 p-3 rounded-lg border transition-colors",
                            isModified 
                              ? "bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800" 
                              : "bg-muted/30 border-transparent"
                          )}
                        >
                          <div className="flex justify-between items-center gap-2">
                            <Label className="text-xs font-medium">{cfg.ar}</Label>
                            <div className="flex items-center gap-1.5">
                              {isModified && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0"
                                  onClick={() => updateParameter(key, defaultValue)}
                                  title={`إعادة للافتراضي (${defaultValue})`}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </Button>
                              )}
                              <Badge 
                                variant={isModified ? "default" : "outline"} 
                                className={cn(
                                  "text-xs font-mono",
                                  isModified ? "bg-violet-600" : "text-muted-foreground"
                                )}
                              >
                                {parameters[key].toFixed(key.includes('threshold') || key.includes('std') || key.includes('stop') || key.includes('target') || key.includes('multiplier') ? 1 : 0)}
                              </Badge>
                            </div>
                          </div>
                          <Slider
                            value={[parameters[key]]}
                            onValueChange={([v]) => updateParameter(key, v)}
                            min={cfg.min}
                            max={cfg.max}
                            step={cfg.step}
                            className="mt-1"
                          />
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-muted-foreground">{cfg.min}</span>
                            <span className="text-[10px] text-muted-foreground">
                              قياسي: {defaultValue}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{cfg.max}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {cfg.description}
                          </p>
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Config Tab */}
        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4" />
                إعدادات الاختبار
              </CardTitle>
              <CardDescription>
                حدد نطاق التاريخ ورأس المال للاختبار
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">تاريخ البداية</Label>
                  <Input
                    type="date"
                    value={config.startDate}
                    onChange={(e) => setConfig(prev => ({ ...prev, startDate: e.target.value }))}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">تاريخ النهاية</Label>
                  <Input
                    type="date"
                    value={config.endDate}
                    onChange={(e) => setConfig(prev => ({ ...prev, endDate: e.target.value }))}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">رأس المال</Label>
                  <Input
                    type="number"
                    value={config.initialCapital}
                    onChange={(e) => setConfig(prev => ({ ...prev, initialCapital: Number(e.target.value) }))}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">أقصى صفقات مفتوحة</Label>
                  <Input
                    type="number"
                    value={config.maxPositions}
                    onChange={(e) => setConfig(prev => ({ ...prev, maxPositions: Number(e.target.value) }))}
                    className="h-9"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Results Tab */}
        <TabsContent value="results" className="space-y-4">
          {results ? (
            <>
              {/* Quick Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Percent className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">نسبة النجاح</span>
                  </div>
                  <p className={cn("text-2xl font-bold", getWinRateColor(results.win_rate))}>
                    {results.win_rate.toFixed(1)}%
                  </p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">الصفقات</span>
                  </div>
                  <p className="text-2xl font-bold">{results.total_trades}</p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">العائد الكلي</span>
                  </div>
                  <p className={cn("text-2xl font-bold", results.total_return >= 0 ? "text-green-600" : "text-red-600")}>
                    {results.total_return >= 0 ? '+' : ''}{results.total_return.toFixed(1)}%
                  </p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingDown className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">أقصى تراجع</span>
                  </div>
                  <p className="text-2xl font-bold text-red-600">
                    -{results.max_drawdown.toFixed(1)}%
                  </p>
                </Card>
              </div>

              {/* Charts */}
              {viewMode === 'chart' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Win/Loss Pie */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">توزيع الصفقات</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsPieChart>
                            <Pie
                              data={tradesPieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {tradesPieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => [value, 'صفقة']} />
                            <Legend />
                          </RechartsPieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Iterations Line Chart */}
                  {iterations.length > 1 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">تقدم الاختبارات</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[250px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <RechartsLineChart data={iterationsChartData}>
                              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                              <XAxis dataKey="name" className="text-xs" />
                              <YAxis domain={[0, 100]} className="text-xs" />
                              <Tooltip 
                                contentStyle={{ 
                                  backgroundColor: 'hsl(var(--card))', 
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: '8px'
                                }}
                                formatter={(value: number) => [`${value}%`, 'نسبة النجاح']}
                              />
                              <Legend />
                              <Line 
                                type="monotone" 
                                dataKey="winRate" 
                                stroke={COLORS.winRate} 
                                strokeWidth={2}
                                name="نسبة النجاح %"
                                dot={{ fill: COLORS.winRate, strokeWidth: 2 }}
                              />
                            </RechartsLineChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Table View */}
              {viewMode === 'table' && trades.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">الصفقات المحاكاة</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto max-h-[400px]">
                      <Table>
                        <TableHeader className="sticky top-0 bg-card">
                          <TableRow>
                            <TableHead>السهم</TableHead>
                            <TableHead>تاريخ الدخول</TableHead>
                            <TableHead>سعر الدخول</TableHead>
                            <TableHead>سعر الخروج</TableHead>
                            <TableHead>الربح/الخسارة</TableHead>
                            <TableHead>صحيح؟</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {trades.slice(0, 50).map(trade => (
                            <TableRow key={trade.id}>
                              <TableCell className="font-medium">{trade.ticker}</TableCell>
                              <TableCell>{trade.entryDate}</TableCell>
                              <TableCell>{trade.entryPrice.toFixed(2)}</TableCell>
                              <TableCell>{trade.exitPrice.toFixed(2)}</TableCell>
                              <TableCell className={trade.profitLossPercent >= 0 ? "text-green-600" : "text-red-600"}>
                                {trade.profitLossPercent >= 0 ? '+' : ''}{trade.profitLossPercent.toFixed(2)}%
                              </TableCell>
                              <TableCell>
                                {trade.correct ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-500" />
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="p-8 text-center">
              <BarChart3 className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-muted-foreground">قم بتشغيل الاختبار لرؤية النتائج</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Action Buttons */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-2 justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={runBacktest}
                disabled={isRunning || loading !== null}
                className="gap-2 bg-violet-600 hover:bg-violet-700"
              >
                {loading === 'backtest' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                تشغيل الاختبار
              </Button>
              
              {results && results.win_rate >= 50 && (
                <Button
                  variant="default"
                  onClick={applyParameters}
                  disabled={loading !== null}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  {loading === 'apply' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  تطبيق على النظام
                </Button>
              )}
            </div>
            
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={exportParameters}
                disabled={!results}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                تصدير
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default UnifiedBacktestingSystem;

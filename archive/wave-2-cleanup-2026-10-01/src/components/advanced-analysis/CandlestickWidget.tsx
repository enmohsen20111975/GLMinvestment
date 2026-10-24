'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  CandlestickChart, TrendingUp, TrendingDown, Target, Shield,
  Loader2, RefreshCw, Sparkles, Minus
} from 'lucide-react';
import { toast } from 'sonner';

interface CandlestickSignal {
  pattern: string;
  pattern_ar: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  entry: number;
  stop_loss: number;
  target: number;
  description: string;
  filter_status: {
    stochastic_filter: boolean;
    fibonacci_filter: boolean;
    overall_filter_passed: boolean;
  };
}

interface CandlestickWidgetProps {
  ticker: string;
  currentPrice?: number;
  onAnalyze?: () => void;
  compact?: boolean;
}

export function CandlestickWidget({ ticker, currentPrice, onAnalyze, compact = false }: CandlestickWidgetProps) {
  const [loading, setLoading] = useState(false);
  const [signal, setSignal] = useState<CandlestickSignal | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fetchAnalysis = useCallback(async () => {
    if (!ticker) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/advanced-analysis?ticker=${ticker}&days=30`);
      const data = await response.json();
      
      if (data.success && data.candlestick_analysis?.best_signal) {
        setSignal(data.candlestick_analysis.best_signal);
      } else {
        setSignal(null);
        if (!data.success) {
          setError(data.error || 'لا توجد بيانات');
        }
      }
    } catch (err) {
      setError('خطأ في التحليل');
    } finally {
      setLoading(false);
    }
  }, [ticker]);
  
  useEffect(() => {
    if (ticker) {
      fetchAnalysis();
    }
  }, [ticker, fetchAnalysis]);
  
  const getSignalColor = (direction: string) => {
    if (direction === 'BULLISH') return 'text-emerald-600 dark:text-emerald-400';
    if (direction === 'BEARISH') return 'text-red-600 dark:text-red-400';
    return 'text-gray-600 dark:text-gray-400';
  };
  
  const getSignalBg = (direction: string) => {
    if (direction === 'BULLISH') return 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800';
    if (direction === 'BEARISH') return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    return 'bg-gray-50 dark:bg-gray-800/20 border-gray-200 dark:border-gray-700';
  };
  
  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-4 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="mr-2 text-sm text-muted-foreground">تحليل الشموع...</span>
        </CardContent>
      </Card>
    );
  }
  
  if (error && !signal) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{error}</span>
            <Button variant="ghost" size="sm" onClick={fetchAnalysis}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  if (!signal) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 text-muted-foreground">
            <CandlestickChart className="w-5 h-5" />
            <span className="text-sm">لا توجد نماذج شمعية واضحة</span>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  // Compact version for recommendations view
  if (compact) {
    return (
      <div className={`rounded-lg p-3 border ${getSignalBg(signal.direction)}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {signal.direction === 'BULLISH' ? 
              <TrendingUp className="w-4 h-4 text-emerald-600" /> : 
              signal.direction === 'BEARISH' ? 
              <TrendingDown className="w-4 h-4 text-red-600" /> :
              <Minus className="w-4 h-4 text-gray-500" />
            }
            <span className="font-medium text-sm">{signal.pattern_ar}</span>
          </div>
          <Badge variant="outline" className="text-xs">{signal.confidence}%</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>الهدف: <strong className="text-emerald-600">{signal.target.toFixed(2)}</strong></span>
          <span>الوقف: <strong className="text-red-600">{signal.stop_loss.toFixed(2)}</strong></span>
        </div>
      </div>
    );
  }
  
  // Full version
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <CandlestickChart className="w-4 h-4 text-purple-500" />
            نموذج الشموع
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={fetchAnalysis}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className={`rounded-lg p-3 ${getSignalBg(signal.direction)}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {signal.direction === 'BULLISH' ? 
              <TrendingUp className="w-5 h-5 text-emerald-600" /> : 
              <TrendingDown className="w-5 h-5 text-red-600" />
            }
            <span className="font-bold">{signal.pattern_ar}</span>
            <Badge className={
              signal.strength === 'STRONG' ? 'bg-emerald-500 text-white' :
              signal.strength === 'MODERATE' ? 'bg-amber-500 text-white' : ''
            }>
              {signal.strength === 'STRONG' ? 'قوي' : signal.strength === 'MODERATE' ? 'متوسط' : 'ضعيف'}
            </Badge>
          </div>
        </div>
        
        <p className="text-sm text-muted-foreground mb-3">{signal.description}</p>
        
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <p className="text-xs text-muted-foreground">الدخول</p>
            <p className="font-medium">{signal.entry.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">الهدف</p>
            <p className="font-medium text-emerald-600 flex items-center gap-1">
              <Target className="w-3 h-3" />
              {signal.target.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">الوقف</p>
            <p className="font-medium text-red-600 flex items-center gap-1">
              <Shield className="w-3 h-3" />
              {signal.stop_loss.toFixed(2)}
            </p>
          </div>
        </div>
        
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">مستوى الثقة</span>
          <div className="flex items-center gap-2">
            <Progress value={signal.confidence} className="w-20 h-1.5" />
            <span className="font-medium">{signal.confidence}%</span>
          </div>
        </div>
        
        {/* Filter Status */}
        <div className="flex flex-wrap gap-1 mt-3 pt-2 border-t border-border/50">
          <Badge variant={signal.filter_status.stochastic_filter ? 'default' : 'outline'} className="text-[10px]">
            {signal.filter_status.stochastic_filter ? '✓' : '○'} Stochastic
          </Badge>
          <Badge variant={signal.filter_status.fibonacci_filter ? 'default' : 'outline'} className="text-[10px]">
            {signal.filter_status.fibonacci_filter ? '✓' : '○'} فيبوناتشي
          </Badge>
          <Badge variant={signal.filter_status.overall_filter_passed ? 'default' : 'destructive'} className="text-[10px]">
            {signal.filter_status.overall_filter_passed ? '✓ معتمدة' : '✗ غير معتمدة'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export default CandlestickWidget;

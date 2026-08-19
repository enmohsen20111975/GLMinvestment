'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  BarChart3, Loader2, RefreshCw, TrendingUp, TrendingDown
} from 'lucide-react';

interface FibonacciLevel {
  level_name: string;
  level_value: number;
  price: number;
  significance: string;
  description: string;
}

interface FibonacciWidgetProps {
  ticker: string;
  currentPrice?: number;
  compact?: boolean;
}

export function FibonacciWidget({ ticker, currentPrice, compact = false }: FibonacciWidgetProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    swing_high: number;
    swing_low: number;
    retracement_levels: FibonacciLevel[];
    golden_level: FibonacciLevel | null;
    price_at_golden: boolean;
  } | null>(null);
  
  const fetchAnalysis = useCallback(async () => {
    if (!ticker) return;
    
    setLoading(true);
    
    try {
      const response = await fetch(`/api/advanced-analysis?ticker=${ticker}&days=30`);
      const result = await response.json();
      
      if (result.success && result.fibonacci_analysis) {
        setData(result.fibonacci_analysis);
      }
    } catch (err) {
      console.error('Fibonacci analysis error:', err);
    } finally {
      setLoading(false);
    }
  }, [ticker]);
  
  useEffect(() => {
    if (ticker) {
      fetchAnalysis();
    }
  }, [ticker, fetchAnalysis]);
  
  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-4 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="mr-2 text-sm text-muted-foreground">تحليل فيبوناتشي...</span>
        </CardContent>
      </Card>
    );
  }
  
  if (!data) {
    return null;
  }
  
  // Compact version
  if (compact) {
    return (
      <div className="rounded-lg p-3 border border-border/60 bg-muted/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            <span className="font-medium text-sm">فيبوناتشي</span>
          </div>
          {data.price_at_golden && (
            <Badge className="bg-amber-500 text-white text-xs">عند الذهبي</Badge>
          )}
        </div>
        
        {data.golden_level && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">المستوى الذهبي 61.8%:</span>
            <span className="font-bold text-amber-600">{(data.golden_level.price ?? 0).toFixed(2)}</span>
          </div>
        )}
        
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-muted-foreground">المدى:</span>
          <span>{(data.swing_low ?? 0).toFixed(2)} - {(data.swing_high ?? 0).toFixed(2)}</span>
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
            <BarChart3 className="w-4 h-4 text-blue-500" />
            مستويات فيبوناتشي
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={fetchAnalysis}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
          <span>المدى: {(data.swing_low ?? 0).toFixed(2)} - {(data.swing_high ?? 0).toFixed(2)}</span>
          {data.price_at_golden && (
            <Badge className="bg-amber-500 text-white">السعر عند المستوى الذهبي</Badge>
          )}
        </div>
        
        <div className="space-y-1.5">
          {data.retracement_levels.slice(0, 5).map((level, idx) => (
            <div 
              key={idx}
              className={`flex items-center justify-between p-2 rounded-lg text-sm ${
                level.level_value === 61.8 ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{level.level_name}</span>
                {level.level_value === 61.8 && (
                  <Badge className="bg-amber-500 text-white text-[10px]">ذهبي</Badge>
                )}
              </div>
              <span className="font-bold">{(level.price ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default FibonacciWidget;

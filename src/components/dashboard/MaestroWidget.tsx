'use client';

import React, { useState, useEffect } from 'react';
import { Zap, TrendingUp, TrendingDown, Minus, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface MaestroOverview {
  totalStocks: number;
  lastAnalysis: string | null;
  marketRegime: 'bull' | 'bear' | 'range';
  regimeConfidence: number;
  recentSignals: number;
  avgScore: number;
}

const REGIME_CONFIG = {
  bull: { color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30', icon: TrendingUp, label: 'صاعد' },
  bear: { color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30', icon: TrendingDown, label: 'هابط' },
  range: { color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30', icon: Minus, label: 'متراوح' }
};

export function MaestroWidget() {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<MaestroOverview | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/maestro/overview');
      // Guard against HTML responses
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.error('Maestro overview API returned non-JSON response:', res.status);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setOverview(data.data);
      }
    } catch (e) {
      console.error('Error fetching Maestro overview:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!overview) {
    return null;
  }

  const regimeConfig = REGIME_CONFIG[overview.marketRegime] || REGIME_CONFIG.range;
  const RegimeIcon = regimeConfig.icon;

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 p-2">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">نظام المايسترو</CardTitle>
              <CardDescription className="text-xs">نظام التحليل المتكامل</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </Button>
            <a href="/maestro">
              <Button variant="outline" size="sm" className="gap-1">
                <span>التفاصيل</span>
                <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Market Regime */}
          <div className={cn('rounded-lg p-3 text-center', regimeConfig.bg)}>
            <RegimeIcon className={cn('h-6 w-6 mx-auto mb-1', regimeConfig.color)} />
            <div className={cn('text-sm font-bold', regimeConfig.color)}>{regimeConfig.label}</div>
            <div className="text-xs text-muted-foreground">حالة السوق</div>
            <Progress value={overview.regimeConfidence} className="h-1 mt-1" />
          </div>

          {/* Stocks Analyzed */}
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold">{overview.totalStocks || 0}</div>
            <div className="text-xs text-muted-foreground">سهم محلل</div>
          </div>

          {/* Recent Signals */}
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold text-primary">{overview.recentSignals || 0}</div>
            <div className="text-xs text-muted-foreground">إشارة جديدة</div>
          </div>

          {/* Average Score */}
          <div className="rounded-lg border p-3 text-center">
            <div className={cn(
              'text-2xl font-bold',
              overview.avgScore >= 70 ? 'text-green-600' :
              overview.avgScore >= 50 ? 'text-yellow-600' : 'text-red-600'
            )}>
              {Math.round(overview.avgScore || 0)}%
            </div>
            <div className="text-xs text-muted-foreground">متوسط الدرجة</div>
          </div>
        </div>

        {/* 6 Phases Preview */}
        <div className="mt-4 pt-3 border-t">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">المراحل الست</span>
            <Badge variant="outline" className="text-[10px]">6 Phases</Badge>
          </div>
          <div className="flex gap-1">
            {['الحالة', 'الأطر', 'الحجم', 'الأخبار', 'الدرجة', 'الشخصيات'].map((phase, i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 text-center py-1 px-0.5 rounded text-[10px]',
                  i < 4 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}
              >
                {phase}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

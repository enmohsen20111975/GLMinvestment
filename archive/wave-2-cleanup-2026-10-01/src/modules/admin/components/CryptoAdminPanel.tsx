'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  RefreshCw, Activity, TrendingUp, TrendingDown, Target,
  Zap, DollarSign, Coins, BarChart3, Brain, CheckCircle2,
  XCircle, Clock, Loader2, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface FlowScore {
  symbol: string;
  name: string;
  price_usd: number;
  change_24h: number;
  change_7d: number;
  flow_score: number;
  label: string;
  label_en: string;
  color: string;
  action: string;
  action_en: string;
  position_size: number;
  stop_loss: number;
  target: number;
  volume_score: number;
  momentum_score: number;
  market_cap_score: number;
  trend_score: number;
}

interface ExplosiveScore {
  symbol: string;
  name: string;
  price_usd: number;
  change_24h: number;
  explosive_score: number;
  label: string;
  label_en: string;
  color: string;
  pattern: string;
  pattern_en: string;
  volume_ratio: number;
  action: string;
  position_size: number;
  stop_loss: number;
  target: number;
  excluded: boolean;
  exclusion_reason: string;
}

interface PerformanceStats {
  total_predictions: number;
  active: number;
  target_hit: number;
  stopped: number;
  expired: number;
  closed_total: number;
  win_rate: number;
}

function formatPrice(price: number): string {
  if (price >= 1) return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return '$' + price.toFixed(4);
  return '$' + price.toFixed(8);
}

function formatVolume(vol: number): string {
  if (vol >= 1e9) return '$' + (vol / 1e9).toFixed(2) + 'B';
  if (vol >= 1e6) return '$' + (vol / 1e6).toFixed(2) + 'M';
  if (vol >= 1e3) return '$' + (vol / 1e3).toFixed(2) + 'K';
  return '$' + vol.toFixed(0);
}

export function CryptoAdminPanel() {
  const [tab, setTab] = useState('flow');
  const [flowData, setFlowData] = useState<FlowScore[]>([]);
  const [explosiveData, setExplosiveData] = useState<ExplosiveScore[]>([]);
  const [performance, setPerformance] = useState<PerformanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningCycle, setRunningCycle] = useState(false);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [flowRes, explosiveRes, perfRes] = await Promise.allSettled([
        fetch('/api/crypto/flow/top?limit=20').then(r => r.json()),
        fetch('/api/crypto/explosive/top?limit=20').then(r => r.json()),
        fetch('/api/crypto/performance').then(r => r.json()),
      ]);

      if (flowRes.status === 'fulfilled' && flowRes.value.success) {
        setFlowData(flowRes.value.data || []);
      }
      if (explosiveRes.status === 'fulfilled' && explosiveRes.value.success) {
        setExplosiveData(explosiveRes.value.data || []);
      }
      if (perfRes.status === 'fulfilled' && perfRes.value.success) {
        setPerformance(perfRes.value.stats || null);
      }
    } catch (e) {
      console.error('Crypto admin fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const runDailyCycle = async () => {
    setRunningCycle(true);
    try {
      const res = await fetch('/api/crypto/daily-cycle', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success('اكتملت الدورة اليومية للكريبتو');
        fetchData(true);
      } else {
        toast.error('فشل تشغيل الدورة');
      }
    } catch (e) {
      toast.error('خطأ في تشغيل الدورة');
    } finally {
      setRunningCycle(false);
    }
  };

  const generatePredictions = async () => {
    try {
      const res = await fetch('/api/crypto/generate-predictions', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(`تم توليد ${data.generated || 0} توقع`);
        fetchData(true);
      }
    } catch (e) {
      toast.error('فشل توليد التوقعات');
    }
  };

  const closePositions = async () => {
    try {
      const res = await fetch('/api/crypto/close-positions', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const c = data.closed || {};
        toast.success(`إغلاق: ${c.TARGET_HIT || 0} هدف، ${c.STOPPED || 0} وقف، ${c.STILL_PENDING || 0} مفتوحة`);
        fetchData(true);
      }
    } catch (e) {
      toast.error('فشل إغلاق الصفقات');
    }
  };

  const runLearning = async () => {
    try {
      const res = await fetch('/api/crypto/learning?days=30', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(`معدل النجاح: ${data.win_rate || 0}% | P&L: ${data.avg_pnl_pct || 0}%`);
      }
    } catch (e) {
      toast.error('فشل التعلم الذاتي');
    }
  };

  const colorMap: Record<string, string> = {
    red: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30',
    orange: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30',
    gray: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-950/30',
    slate: 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/30',
    green: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30',
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30',
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header with actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins className="h-6 w-6 text-orange-500" />
          <h2 className="text-xl font-bold">إدارة العملات الرقمية</h2>
          {performance && (
            <Badge variant="outline" className="gap-1">
              <Target className="h-3 w-3" />
              {performance.win_rate}% نجاح
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => fetchData(true)} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            تحديث
          </Button>
          <Button size="sm" variant="outline" onClick={generatePredictions}>
            <Zap className="h-4 w-4" /> توقعات
          </Button>
          <Button size="sm" variant="outline" onClick={closePositions}>
            <XCircle className="h-4 w-4" /> إغلاق
          </Button>
          <Button size="sm" variant="outline" onClick={runLearning}>
            <Brain className="h-4 w-4" /> تعلم
          </Button>
          <Button size="sm" onClick={runDailyCycle} disabled={runningCycle}>
            {runningCycle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            دورة كاملة
          </Button>
        </div>
      </div>

      {/* Performance stats */}
      {performance && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">إجمالي التوقعات</div>
            <div className="text-xl font-bold">{performance.total_predictions}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">نشطة</div>
            <div className="text-xl font-bold text-blue-500">{performance.active}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">حققت الهدف</div>
            <div className="text-xl font-bold text-emerald-500">{performance.target_hit}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">وقفت</div>
            <div className="text-xl font-bold text-red-500">{performance.stopped}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">منتهية</div>
            <div className="text-xl font-bold text-amber-500">{performance.expired}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">معدل النجاح</div>
            <div className="text-xl font-bold text-emerald-500">{performance.win_rate}%</div>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="flow">نقاط التدفق</TabsTrigger>
          <TabsTrigger value="explosive">القنابل</TabsTrigger>
        </TabsList>

        {/* Flow Scores */}
        <TabsContent value="flow" className="space-y-2">
          {loading ? (
            <Skeleton className="h-96" />
          ) : flowData.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">لا توجد بيانات</CardContent></Card>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {flowData.map((coin) => (
                <Card key={coin.symbol} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn('rounded-lg px-2 py-1 text-lg font-bold', colorMap[coin.color] || colorMap.gray)}>
                        {coin.flow_score}
                      </div>
                      <div>
                        <div className="font-bold">{coin.symbol}</div>
                        <div className="text-xs text-muted-foreground">{coin.name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-left">
                        <div className="font-semibold">{formatPrice(coin.price_usd)}</div>
                        <div className={cn('text-xs', coin.change_24h >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                          {coin.change_24h >= 0 ? '+' : ''}{coin.change_24h.toFixed(2)}%
                        </div>
                      </div>
                      <Badge className={cn(colorMap[coin.color] || colorMap.gray, 'border-0')}>
                        {coin.label}
                      </Badge>
                      <div className="text-xs text-muted-foreground text-left">
                        <div>{coin.action}</div>
                        {coin.position_size > 0 && (
                          <div>وقف: {coin.stop_loss}% | هدف: +{coin.target}%</div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Layer scores */}
                  <div className="mt-2 flex gap-2 text-xs">
                    <span className="text-muted-foreground">Vol: {coin.volume_score}</span>
                    <span className="text-muted-foreground">Mom: {coin.momentum_score}</span>
                    <span className="text-muted-foreground">Cap: {coin.market_cap_score}</span>
                    <span className="text-muted-foreground">Trend: {coin.trend_score}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Explosive Scores */}
        <TabsContent value="explosive" className="space-y-2">
          {loading ? (
            <Skeleton className="h-96" />
          ) : explosiveData.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">لا توجد قنابل حالياً</CardContent></Card>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {explosiveData.map((coin) => (
                <Card key={coin.symbol} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn('rounded-lg px-2 py-1 text-lg font-bold', colorMap[coin.color] || colorMap.gray)}>
                        {coin.explosive_score}
                      </div>
                      <div>
                        <div className="font-bold">{coin.symbol}</div>
                        <div className="text-xs text-muted-foreground">{coin.name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-left">
                        <div className="font-semibold">{formatPrice(coin.price_usd)}</div>
                        <div className={cn('text-xs', coin.change_24h >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                          {coin.change_24h >= 0 ? '+' : ''}{coin.change_24h.toFixed(2)}%
                        </div>
                      </div>
                      <Badge variant="outline" className="gap-1">
                        {coin.pattern}
                      </Badge>
                      <Badge className={cn(colorMap[coin.color] || colorMap.gray, 'border-0')}>
                        {coin.label}
                      </Badge>
                      <div className="text-xs text-muted-foreground text-left">
                        <div>{coin.action}</div>
                        {coin.position_size > 0 && (
                          <div>وقف: {coin.stop_loss}% | هدف: +{coin.target}%</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2 text-xs">
                    <span className="text-muted-foreground">Vol: {coin.volume_ratio}x</span>
                    <span className="text-muted-foreground">Surge: {coin.volume_surge}</span>
                    <span className="text-muted-foreground">Smart: {coin.smart_money}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

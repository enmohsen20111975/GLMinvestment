'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Target, CheckCircle, XCircle, Clock,
  RefreshCw, BarChart3, Award, Zap, Loader2, Users, Shield,
  ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface ExpertStats {
  total: number;
  pending: number;
  hitTarget: number;
  stopped: number;
  closed: number;
  avgReturn: number;
  bestReturn: number;
  worstReturn: number;
  successRate: number;
}

interface ExpertByExpert {
  total: number;
  hitTarget: number;
  stopped: number;
  pending: number;
  closed: number;
  successRate: number;
  avgReturn: number;
  avgClosedReturn: number;
}

interface ExpertByType {
  total: number;
  hitTarget: number;
  stopped: number;
  pending: number;
  successRate: number;
  avgReturn: number;
}

interface PlatformStats {
  total: number;
  active: number;
  hitTarget: number;
  stopped: number;
  successRate: number;
}

interface ExpertRec {
  id: string;
  stock_symbol: string;
  stock_name_ar?: string;
  expert_name: string;
  action: string;
  recommendation_type: string;
  entry_price: number;
  entry_price_from?: number;
  entry_price_to?: number;
  target_price?: number;
  target_price_2?: number;
  investment_target?: number;
  stop_loss?: number;
  stop_loss_condition?: string;
  support_level?: number;
  resistance_level?: number;
  expected_profit_min?: number;
  expected_profit_max?: number;
  session_date?: string;
  session_type?: string;
  status: string;
  final_price?: number;
  profit_loss_percent?: number;
  hit_target: boolean;
  hit_stop_loss: boolean;
  notes?: string;
  recommendation_date: string;
}

const ACTION_AR: Record<string, string> = {
  BUY: 'شراء', SELL: 'بيع', HOLD: 'احتفاظ',
  BUY_AND_HOLD: 'شراء واحتفاظ', AVERAGE_DOWN: 'متوسط شراء',
};

const STATUS_AR: Record<string, string> = {
  PENDING: 'قيد التنفيذ', HIT_TARGET: 'حقق الهدف',
  STOPPED: 'وقف خسارة', CLOSED: 'مغلق', CANCELLED: 'ملغي',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-blue-500', HIT_TARGET: 'bg-emerald-500',
  STOPPED: 'bg-red-500', CLOSED: 'bg-gray-500',
};

const REC_TYPE_AR: Record<string, string> = {
  detailed: '📋 تفصيلية', quick: '⚡ سريعة',
};

export function RecommendationMonitoring() {
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const [retroEvaluating, setRetroEvaluating] = useState(false);
  const [expertStats, setExpertStats] = useState<ExpertStats | null>(null);
  const [expertByExpert, setExpertByExpert] = useState<Record<string, ExpertByExpert>>({});
  const [expertByType, setExpertByType] = useState<{ detailed: ExpertByType; quick: ExpertByType } | null>(null);
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [expertRecs, setExpertRecs] = useState<ExpertRec[]>([]);
  const [expandedRec, setExpandedRec] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'closed'>('all');
  // P0-v12: freshness tracking — owner complaint
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/recommendations/verify');
      const data = await res.json();
      if (data.success) {
        setExpertStats(data.expertStats);
        setExpertByExpert(data.expertByExpert || {});
        setExpertByType(data.expertByType || null);
        setPlatformStats(data.platformStats);
        setExpertRecs(data.expertRecs || []);
        setLastUpdated(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch monitoring data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // P0-v12: auto-refresh ���� 60 ثانية (loop tab visible)
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/recommendations/verify', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (error) {
      console.error('Verify failed:', error);
    } finally {
      setVerifying(false);
    }
  };

  const handleBacktest = async () => {
    setBacktesting(true);
    try {
      const res = await fetch('/api/recommendations/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days_back: 30 }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (error) {
      console.error('Backtest failed:', error);
    } finally {
      setBacktesting(false);
    }
  };

  const handleRetroEvaluate = async () => {
    setRetroEvaluating(true);
    try {
      const res = await fetch('/api/recommendations/retroactive-evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (error) {
      console.error('Retroactive evaluate failed:', error);
    } finally {
      setRetroEvaluating(false);
    }
  };

  const filteredRecs = expertRecs.filter(r => {
    if (filter === 'pending') return r.status === 'PENDING';
    if (filter === 'closed') return r.status !== 'PENDING';
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-4" dir="rtl">
        <Card><CardContent className="p-6"><div className="animate-pulse space-y-4">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}</div></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header Actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            مراقبة التحليلات
          </h2>
          {lastUpdated && (
            <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" />
              آخر تحديث: {lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
            </Badge>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleRetroEvaluate} disabled={retroEvaluating} className="gap-1 border-emerald-400 text-emerald-600 hover:bg-emerald-50">
            {retroEvaluating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            تقييم تاريخي
          </Button>
          <Button variant="outline" size="sm" onClick={handleVerify} disabled={verifying} className="gap-1">
            {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            تحقق من الأسعار
          </Button>
          <Button size="sm" onClick={handleBacktest} disabled={backtesting} className="gap-1 bg-purple-600 hover:bg-purple-700">
            {backtesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
            اختبار شهر سابق
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-blue-600">{expertStats?.total || 0}</p>
          <p className="text-xs text-muted-foreground">إجمالي الخبراء</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-amber-600">{expertStats?.pending || 0}</p>
          <p className="text-xs text-muted-foreground">قيد التنفيذ</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-emerald-600">{expertStats?.hitTarget || 0}</p>
          <p className="text-xs text-muted-foreground">حققت الهدف</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-red-600">{expertStats?.stopped || 0}</p>
          <p className="text-xs text-muted-foreground">وقف خسارة</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-purple-600">{expertStats?.successRate.toFixed(0) || 0}%</p>
          <p className="text-xs text-muted-foreground">نسبة النجاح</p>
        </Card>
        <Card className="p-3 text-center">
          <p className={cn("text-2xl font-bold", (expertStats?.avgReturn || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>
            {(expertStats?.avgReturn || 0).toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground">متوسط العائد</p>
        </Card>
      </div>

      <Tabs defaultValue="experts" dir="rtl">
        <TabsList className="w-full">
          <TabsTrigger value="experts" className="flex-1 gap-1"><Users className="w-3.5 h-3.5" /> أداء الخبراء</TabsTrigger>
          <TabsTrigger value="expert-recs" className="flex-1 gap-1"><Target className="w-3.5 h-3.5" /> تحليلات الخبراء</TabsTrigger>
          <TabsTrigger value="platform" className="flex-1 gap-1"><BarChart3 className="w-3.5 h-3.5" /> تحليلات الموقع</TabsTrigger>
        </TabsList>

        {/* Expert Performance */}
        <TabsContent value="experts" className="space-y-4">
          {/* By Expert */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="w-4 h-4 text-yellow-500" />
                أداء الخبراء
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(expertByExpert).length === 0 ? (
                <p className="text-center text-muted-foreground py-4">لا توجد بيانات خبراء</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(expertByExpert)
                    .sort(([, a], [, b]) => b.successRate - a.successRate)
                    .map(([name, stats]) => (
                    <div key={name} className="p-3 rounded-lg border space-y-2">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm">
                          {name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{name}</div>
                          <div className="text-xs text-muted-foreground">
                            {stats.total} تحليل • {stats.hitTarget} نجح • {stats.stopped} خسارة • {stats.pending} معلق
                          </div>
                        </div>
                        <div className="text-left space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">نجاح:</span>
                            <Progress value={stats.successRate} className="w-20 h-2" />
                            <span className={cn("text-sm font-bold", stats.successRate >= 50 ? "text-emerald-600" : "text-red-600")}>
                              {stats.successRate.toFixed(0)}%
                            </span>
                          </div>
                          <div className="text-xs">
                            متوسط عائد: <span className={cn("font-bold", (stats.avgClosedReturn ?? stats.avgReturn) >= 0 ? "text-emerald-600" : "text-red-600")}>
                              {(stats.avgClosedReturn ?? stats.avgReturn).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                      {(stats.hitTarget + stats.stopped) > 0 && (
                        <div className="flex gap-1">
                          {Array.from({ length: Math.min(stats.hitTarget + stats.stopped, 20) }, (_, i) => (
                            <div
                              key={i}
                              className={cn(
                                "w-2 h-4 rounded-sm",
                                i < stats.hitTarget ? "bg-emerald-500" : "bg-red-500"
                              )}
                            />
                          ))}
                          {stats.hitTarget + stats.stopped > 20 && (
                            <span className="text-xs text-muted-foreground">+{stats.hitTarget + stats.stopped - 20}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* By Type */}
          {expertByType && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card className="border-emerald-200 dark:border-emerald-900">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">📋</span>
                    <span className="font-bold">تفصيلية</span>
                    <Badge variant="secondary">{expertByType.detailed.total}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div><p className="font-bold text-amber-600">{expertByType.detailed.pending}</p><p className="text-[10px] text-muted-foreground">قيد التنفيذ</p></div>
                    <div><p className="font-bold text-emerald-600">{expertByType.detailed.hitTarget}</p><p className="text-[10px] text-muted-foreground">حققت الهدف</p></div>
                    <div><p className="font-bold text-red-600">{expertByType.detailed.stopped}</p><p className="text-[10px] text-muted-foreground">وقف خسارة</p></div>
                  </div>
                  {expertByType.detailed.successRate > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">نسبة النجاح:</span>
                      <Progress value={expertByType.detailed.successRate} className="flex-1 h-2" />
                      <span className={cn("text-xs font-bold", expertByType.detailed.successRate >= 50 ? "text-emerald-600" : "text-red-600")}>
                        {expertByType.detailed.successRate.toFixed(0)}%
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card className="border-purple-200 dark:border-purple-900">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">⚡</span>
                    <span className="font-bold">سريعة (T+0)</span>
                    <Badge variant="secondary">{expertByType.quick.total}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div><p className="font-bold text-amber-600">{expertByType.quick.pending}</p><p className="text-[10px] text-muted-foreground">قيد التنفيذ</p></div>
                    <div><p className="font-bold text-emerald-600">{expertByType.quick.hitTarget}</p><p className="text-[10px] text-muted-foreground">حققت الهدف</p></div>
                    <div><p className="font-bold text-red-600">{expertByType.quick.stopped}</p><p className="text-[10px] text-muted-foreground">وقف خسارة</p></div>
                  </div>
                  {expertByType.quick.successRate > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">نسبة النجاح:</span>
                      <Progress value={expertByType.quick.successRate} className="flex-1 h-2" />
                      <span className={cn("text-xs font-bold", expertByType.quick.successRate >= 50 ? "text-emerald-600" : "text-red-600")}>
                        {expertByType.quick.successRate.toFixed(0)}%
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Expert Recommendations List */}
        <TabsContent value="expert-recs" className="space-y-3">
          <div className="flex gap-2">
            {(['all', 'pending', 'closed'] as const).map(f => (
              <Button key={f} variant={filter === f ? 'default' : 'ghost'} size="sm" onClick={() => setFilter(f)} className="text-xs">
                {f === 'all' ? 'الكل' : f === 'pending' ? 'قيد التنفيذ' : 'مغلقة'}
              </Button>
            ))}
          </div>

          {filteredRecs.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <Target className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>لا توجد تحليلات</p>
            </CardContent></Card>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-2">
                {filteredRecs.map(rec => (
                  <Card key={rec.id} className={cn(
                    "transition-colors",
                    rec.recommendation_type === 'quick' ? 'border-purple-200 dark:border-purple-900' : '',
                    rec.status === 'HIT_TARGET' ? 'border-emerald-200 dark:border-emerald-900' : '',
                    rec.status === 'STOPPED' ? 'border-red-200 dark:border-red-900' : '',
                  )}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedRec(expandedRec === rec.id ? null : rec.id)}>
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{rec.stock_symbol}</span>
                              {rec.stock_name_ar && <span className="text-xs text-muted-foreground">{rec.stock_name_ar}</span>}
                              <Badge variant="outline" className={cn("text-[10px]", rec.recommendation_type === 'quick' ? 'border-purple-400 text-purple-600' : '')}>
                                {REC_TYPE_AR[rec.recommendation_type] || rec.recommendation_type}
                              </Badge>
                              <Badge className={cn("text-white text-[10px]", STATUS_COLORS[rec.status] || 'bg-gray-400')}>
                                {STATUS_AR[rec.status] || rec.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <span>{rec.expert_name}</span>
                              <span>•</span>
                              <span>{ACTION_AR[rec.action] || rec.action}</span>
                              {rec.session_date && <><span>•</span><span>{rec.session_date}</span></>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">الدخول</div>
                            <div className="font-mono">{rec.entry_price_from && rec.entry_price_to ? `${rec.entry_price_from}-${rec.entry_price_to}` : rec.entry_price.toFixed(2)}</div>
                          </div>
                          {rec.target_price && (
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">هدف 1</div>
                              <div className="font-mono text-emerald-600">{rec.target_price.toFixed(2)}</div>
                            </div>
                          )}
                          {rec.stop_loss && (
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">ستوب</div>
                              <div className="font-mono text-red-600">{rec.stop_loss.toFixed(2)}</div>
                            </div>
                          )}
                          {rec.profit_loss_percent != null && (
                            <div className={cn("font-bold text-lg", rec.profit_loss_percent >= 0 ? "text-emerald-600" : "text-red-600")}>
                              {rec.profit_loss_percent >= 0 ? '+' : ''}{rec.profit_loss_percent.toFixed(1)}%
                            </div>
                          )}
                          {expandedRec === rec.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>

                      {expandedRec === rec.id && (
                        <div className="mt-3 pt-3 border-t space-y-2 text-sm">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {rec.target_price_2 && <div><span className="text-muted-foreground">هدف 2:</span> <span className="font-mono text-emerald-500">{rec.target_price_2.toFixed(2)}</span></div>}
                            {rec.investment_target && <div><span className="text-muted-foreground">استثماري:</span> <span className="font-mono text-blue-600">{rec.investment_target.toFixed(2)}</span></div>}
                            {rec.support_level && <div><span className="text-muted-foreground">دعم:</span> <span className="font-mono">{rec.support_level.toFixed(2)}</span></div>}
                            {rec.resistance_level && <div><span className="text-muted-foreground">مقاومة:</span> <span className="font-mono">{rec.resistance_level.toFixed(2)}</span></div>}
                            {rec.expected_profit_min && <div><span className="text-muted-foreground">ربح أدنى:</span> {rec.expected_profit_min}%</div>}
                            {rec.expected_profit_max && <div><span className="text-muted-foreground">ربح أقصى:</span> {rec.expected_profit_max}%</div>}
                            {rec.expected_profit_investment && <div><span className="text-muted-foreground">ربح استثماري:</span> {rec.expected_profit_investment}%</div>}
                            {rec.stop_loss_condition && <div><span className="text-muted-foreground">شرط الاستوب:</span> {rec.stop_loss_condition}</div>}
                            {rec.final_price && <div><span className="text-muted-foreground">سعر الإغلاق:</span> <span className="font-mono">{rec.final_price.toFixed(2)}</span></div>}
                            {rec.expected_duration && <div><span className="text-muted-foreground">المدة:</span> {rec.expected_duration}</div>}
                          </div>
                          {rec.entry_condition && <div><span className="text-muted-foreground">شرط الدخول:</span> {rec.entry_condition}</div>}
                          {rec.notes && <div className="p-2 bg-muted rounded text-xs">{rec.notes}</div>}
                          <div className="text-xs text-muted-foreground">
                            {new Date(rec.recommendation_date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })}
                            {rec.session_type && ` • ${rec.session_type}`}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        {/* Platform Recommendations */}
        <TabsContent value="platform" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-500" />
                تحليلات الموقع (تحليل آلي)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {platformStats && platformStats.total > 0 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20">
                      <p className="text-2xl font-bold text-blue-600">{platformStats.total}</p>
                      <p className="text-xs text-muted-foreground">إجمالي</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20">
                      <p className="text-2xl font-bold text-amber-600">{platformStats.active}</p>
                      <p className="text-xs text-muted-foreground">نشطة</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20">
                      <p className="text-2xl font-bold text-emerald-600">{platformStats.hitTarget}</p>
                      <p className="text-xs text-muted-foreground">حققت الهدف</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950/20">
                      <p className="text-2xl font-bold text-red-600">{platformStats.stopped}</p>
                      <p className="text-xs text-muted-foreground">وقف خسارة</p>
                    </div>
                  </div>
                  {platformStats.total > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">نسبة النجاح:</span>
                      <Progress value={platformStats.total > 0 ? (platformStats.hitTarget / platformStats.total) * 100 : 0} className="flex-1 h-3" />
                      <span className="text-sm font-bold">{((platformStats.hitTarget / platformStats.total) * 100).toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-muted-foreground mb-3">لا توجد تحليلات موقع بعد</p>
                  <Button onClick={handleBacktest} disabled={backtesting} className="gap-1 bg-purple-600 hover:bg-purple-700">
                    {backtesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                    إنشاء تحليلات شهر سابق
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

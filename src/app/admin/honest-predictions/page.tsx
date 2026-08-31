'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Target, Shield, Trophy, Activity,
  RefreshCw, Brain, Zap, AlertTriangle, CheckCircle2, XCircle,
  Clock, BarChart3, CandlestickChart, Database, Lightbulb,
  Filter, Download, PlayCircle, Settings, ChevronDown, ChevronUp, Info,
  PieChart, List, ChartLine,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@/components/ui/tooltip';
import {
  AreaChart, Area, PieChart as RePieChart, Pie, Cell,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as ReTooltip, Legend,
  LineChart, Line, RadialBarChart, RadialBar,
} from 'recharts';
import { cn } from '@/lib/utils';
import { TopTradesImageCard, type TopTrade } from '@/components/market/TopTradesImageCard';
import { StockLeagueImageCard } from '@/components/market/StockLeagueImageCard';

// ============================================================================
// TYPES
// ============================================================================

interface Stats {
  total_predictions: number;
  closed_predictions: number;
  target_hits: number;
  stop_hits: number;
  profit_taken: number;
  expired: number;
  pending: number;
  buy_signals: number;
  sell_signals: number;
  real_win_rate: number;
  avg_return: number | null;
  avg_holding_days: number | null;
  avg_max_profit: number | null;
  avg_max_loss: number | null;
  avg_risk_reward: number | null;
  avg_confidence: number | null;
  sr_adoption_rate: number;
  candlestick_adoption_rate: number;
  date_range: { earliest: string; latest: string };
  markets_covered: string[];
}

interface MarketStat {
  market: string;
  total: number;
  wins: number;
  losses: number;
  expired: number;
  pending: number;
  win_rate: number;
  avg_return: number | null;
  sr_adoption: number;
  candle_adoption: number;
}

interface MonthlyStat {
  month: string;
  net_pl: number;
  closed: number;
  wins: number;
  win_rate: number;
}

interface CumulativePoint {
  date: string;
  cumulative_return: number;
  closed: number;
}

interface PatternStat {
  name: string;
  count: number;
  wins: number;
  losses: number;
  win_rate: number;
}

interface Prediction {
  id: string;
  stock_symbol: string;
  stock_name_ar: string | null;
  signal_type: string;
  market: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  maestro_score: number | null;
  technical_score: number | null;
  fundamental_score: number | null;
  prediction_date: string;
  status: string;
  final_price: number | null;
  profit_loss_percent: number | null;
  actual_return: number | null;
  hit_target: boolean;
  hit_stop_loss: boolean;
  days_to_target: number | null;
  holding_days: number | null;
  evaluation_date: string | null;
  exit_reason: string | null;
  max_profit_percent: number | null;
  max_loss_percent: number | null;
  risk_reward: number | null;
  analysis_methods: string[];
  reasons: string[];
  candle_patterns: { name: string; name_ar: string; type: string; strength: number }[];
  trend_direction: string | null;
  rsi_value: number | null;
  ma20_value: number | null;
  ma50_value: number | null;
  macd_histogram: number | null;
  sr_zone: string | null;
  sr_support: number | null;
  sr_resistance: number | null;
  atr_value: number | null;
  volume_trend: string | null;
  volume_spike: boolean;
  pe_ratio: number | null;
  roe: number | null;
  dividend_yield: number | null;
  profit_margin: number | null;
  sector: string | null;
  persona: string | null;
  change_1m: number | null;
  bollinger_width: number | null;
  data_source: string | null;
}

interface Lesson {
  type: string;
  category: string;
  rule: string;
  evidence: string;
  failure_rate: number;
  sample_size: number;
  recommendation: string;
  created_at?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  TARGET_HIT: { label: 'حقق الهدف', color: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30', icon: <Trophy className="h-3 w-3" /> },
  STOPPED: { label: 'ضرب وقف الخسارة', color: 'bg-red-500/15 text-red-600 border-red-500/30', icon: <XCircle className="h-3 w-3" /> },
  EXPIRED: { label: 'انتهت المدة', color: 'bg-amber-500/15 text-amber-600 border-amber-500/30', icon: <Clock className="h-3 w-3" /> },
  PENDING: { label: 'قيد التنفيذ', color: 'bg-blue-500/15 text-blue-600 border-blue-500/30', icon: <Clock className="h-3 w-3" /> },
  CLOSED: { label: 'مغلقة', color: 'bg-slate-500/15 text-slate-600 border-slate-500/30', icon: <CheckCircle2 className="h-3 w-3" /> },
};

const MARKET_NAMES: Record<string, string> = {
  TADAWUL: 'السعودية',
  EGX: 'مصر',
  KSE: 'الكويت',
  QSE: 'قطر',
  US: 'أمريكا',
  INDICES: 'المؤشرات',
  FOREX: 'العملات',
  COMMODITIES: 'الذهب والمعادن',
  CRYPTO: 'الرقمية',
};

function formatPercent(val: number | null, withSign = true): string {
  if (val === null || val === undefined) return '—';
  const sign = withSign && val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

function formatPrice(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return val.toFixed(2);
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function HonestPredictionsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [byMarket, setByMarket] = useState<MarketStat[]>([]);
  const [patterns, setPatterns] = useState<PatternStat[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState<MonthlyStat[]>([]);
  const [cumulativeReturns, setCumulativeReturns] = useState<CumulativePoint[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testReport, setTestReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [learning, setLearning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [viewMode, setViewMode] = useState<'charts' | 'table'>('charts');

  // TOP-TRADES-037: أفضل صفقات الشهر (للـ Image Card الإعلانية)
  const [topTrades, setTopTrades] = useState<TopTrade[]>([]);

  // Filters
  const [marketFilter, setMarketFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [signalFilter, setSignalFilter] = useState('all');
  const [sortBy, setSortBy] = useState('prediction_date');

  // Advanced Settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dynamicParams, setDynamicParams] = useState<any>(null);
  const [dynamicSource, setDynamicSource] = useState<string>('defaults');

  const fetchDynamicParams = useCallback(async () => {
    try {
      // GHOST-BUSTER-024: cache: 'no-store' + cache buster عشان نمنع Next.js
      // والمتصفح من تخزين الـ response القديم (سبب ظهور البيانات الوهمية)
      const res = await fetch(`/api/admin/generate-historical-predictions?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
      });
      const data = await res.json();
      if (data.success && data.params) {
        setDynamicParams(data.params);
        setDynamicSource(data.source || 'defaults');
        setAtrPeriod(data.params.atrPeriod ?? 14);
        setSwingLookback(data.params.swingLookback ?? 20);
        setRsiOverbought(data.params.rsiOverbought ?? 75);
        setRsiOversold(data.params.rsiOversold ?? 25);
        setMinRiskReward(data.params.minRiskReward ?? 1.5);
        setExitSignalThreshold(data.params.exitSignalThreshold ?? 60);
      }
    } catch { /* ignore */ }
  }, []);

  const [startDate, setStartDate] = useState('2025-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [tickersPerMarket, setTickersPerMarket] = useState(10);
  const [sampleEveryDays, setSampleEveryDays] = useState(7);
  const [clearExisting, setClearExisting] = useState(true);
  const [atrPeriod, setAtrPeriod] = useState(14);
  const [swingLookback, setSwingLookback] = useState(20);
  const [rsiOverbought, setRsiOverbought] = useState(75);
  const [rsiOversold, setRsiOversold] = useState(25);
  const [minRiskReward, setMinRiskReward] = useState(1.5);
  const [exitSignalThreshold, setExitSignalThreshold] = useState(60);

  useEffect(() => { fetchDynamicParams(); }, [fetchDynamicParams]);

  const fetchStats = useCallback(async () => {
    try {
      // GHOST-BUSTER-024: cache: 'no-store' + cache buster
      const res = await fetch(`/api/predictions/honest-tracking/stats?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
      });
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setByMarket(data.by_market || []);
        setPatterns(data.candlestick_patterns || []);
        setLessons(data.lessons || []);
        // HONEST-V2: new chart datasets
        setMonthlyBreakdown(data.monthly_breakdown || []);
        setCumulativeReturns(data.cumulative_returns || []);
      }
    } catch (e) {
      console.error('Stats error:', e);
    }
  }, []);

  const fetchPredictions = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        market: marketFilter,
        status: statusFilter,
        signal: signalFilter,
        sortBy,
        limit: '100',
        // GHOST-BUSTER-024: cache buster عشان نكسر browser/Next.js cache
        _t: String(Date.now()),
      });
      const res = await fetch(`/api/predictions/honest-tracking/list?${params}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
      });
      const data = await res.json();
      if (data.success) {
        setPredictions(data.predictions);
      }
    } catch (e) {
      console.error('Predictions error:', e);
    }
  }, [marketFilter, statusFilter, signalFilter, sortBy]);

  const fetchLessons = useCallback(async () => {
    try {
      await fetchStats();
    } catch (e) {
      console.error('Lessons error:', e);
    }
  }, [fetchStats]);

  const fetchTopTrades = useCallback(async () => {
    try {
      // GHOST-BUSTER-024: cache: 'no-store' + cache buster
      const res = await fetch(`/api/prediction-performance?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
      });
      const data = await res.json();
      if (data.success && data.top_monthly_trades) {
        setTopTrades(data.top_monthly_trades);
      }
    } catch (e) {
      // silent — top trades is optional
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchPredictions(), fetchTopTrades()]);
    setLoading(false);
  }, [fetchStats, fetchPredictions, fetchTopTrades]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // GHOST-BUSTER-024: Auto-refresh كل 5 دقايق (300000ms) عشان لو الـ DB اتغير
  // الشاشة بتتحول فوراً بدون ما المستخدم يعمل refresh يدوي.
  // ده بيتطابق مع متطلب العميل: "الواجهة لازم تسحب API كل 5 دقايق cache: 'no-store'".
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchAll();
    }, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(intervalId);
  }, [fetchAll]);

  // Actions
  const handleGenerate = async () => {
    setGenerating(true);
    toast.info('بدأ توليد التوقعات التاريخية الحقيقية لكل الأسواق...');
    try {
      const res = await fetch('/api/admin/generate-historical-predictions', {
        method: 'POST',
        // GHOST-BUSTER-024: no-store حتى لطلبات POST
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          tickersPerMarket,
          clearExisting,
          sampleEveryDays,
          markets: ['EGX', 'TADAWUL', 'KSE', 'QSE'],
          technicalParams: {
            atrPeriod,
            swingLookback,
            rsiOverbought,
            rsiOversold,
            minRiskReward,
            exitSignalThreshold,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`تم توليد ${data.stats.total_predictions} توقع حقيقي عبر ${data.stats.markets_covered.length} سوق — نسبة الفوز الحقيقية ${data.stats.real_win_rate}%`);
        fetchAll();
      } else {
        toast.error(`فشل التوليد: ${data.error}`);
      }
    } catch (e: any) {
      toast.error(`خطأ: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    toast.info('بدأ التحقق من جميع التوقعات المعلقة (حتى 10000)...');
    try {
      const res = await fetch('/api/predictions/honest-tracking/verify-pending', {
        method: 'POST',
        // GHOST-BUSTER-024: no-store
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
        // HONEST-V2: bumped from 200 → 10000 so ALL pending trades are
        // processed in a single click (matches the user's "close trades
        // aggressively" requirement).
        body: JSON.stringify({ limit: 10000 }),
      });
      const data = await res.json();
      if (data.success) {
        const r = data.results;
        const profitTaken = r.profit_taken || 0;
        toast.success(`تم التحقق من ${r.checked} توقع — ${r.target_hits} حققت الهدف، ${r.stopped} ضرب وقف الخسارة، ${profitTaken} جني أرباح، ${r.expired} انتهت`);
        fetchAll();
        // HONEST-V2: auto-learn from wins/losses immediately after verify
        // so the LearningEngine is always up-to-date with the latest outcomes.
        setTimeout(() => {
          handleLearn(true);
        }, 800);
      } else {
        toast.error(`فشل التحقق: ${data.error}`);
      }
    } catch (e: any) {
      toast.error(`خطأ: ${e.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleLearn = async (fromVerify = false) => {
    setLearning(true);
    if (!fromVerify) toast.info('بدأ التحليل والتعلم من الأخطاء...');
    try {
      const res = await fetch('/api/predictions/honest-tracking/learn-from-errors', {
        method: 'POST',
        // GHOST-BUSTER-024: no-store
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
        body: JSON.stringify({ market: 'all' }),
      });
      const data = await res.json();
      if (data.success) {
        // HONEST-V2: learn-from-errors returns `lessons` (array) directly,
        // not `summary.lessons_extracted`. Fix the field name.
        const count = Array.isArray(data.lessons) ? data.lessons.length : 0;
        toast.success(`تم استخراج ${count} درس من تحليل التوقعات المغلقة${fromVerify ? ' (تلقائي بعد التحقق)' : ''}`);
        fetchLessons();
      } else {
        toast.error(`فشل التعلم: ${data.error}`);
      }
    } catch (e: any) {
      toast.error(`خطأ: ${e.message}`);
    } finally {
      setLearning(false);
    }
  };

  const handleFullTest = async () => {
    setTesting(true);
    setTestReport(null);
    toast.info('جارٍ الاختبار الكامل: توليد + تحقق + تعلم + Python cycle...');
    try {
      const res = await fetch('/api/admin/generate-historical-predictions', {
        method: 'POST',
        // GHOST-BUSTER-024: no-store
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          tickersPerMarket,
          clearExisting,
          sampleEveryDays,
          markets: ['EGX', 'TADAWUL', 'KSE', 'QSE'],
          technicalParams: {
            atrPeriod,
            swingLookback,
            rsiOverbought,
            rsiOversold,
            minRiskReward,
            exitSignalThreshold,
          },
          runFullTest: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestReport(data);
        toast.success(`الاختبار الكامل اكتمل: ${data.message}`);
        fetchAll();
      } else {
        toast.error(`فشل الاختبار الكامل: ${data.error}`);
      }
    } catch (e: any) {
      toast.error(`خطأ في الاختبار: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <RefreshCw className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">جارٍ تحميل التوقعات الحقيقية...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Target className="h-7 w-7 text-primary" />
            التوقعات الحقيقية — تتبّع صادق
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            كل توقع مبني على تحليل فني + شموع يابانية + دعوم/مقاومات، ومتأكد من الأسعار الفعلية. لا توجد بيانات مصطنعة.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleGenerate} disabled={generating} variant="default" size="sm">
            {generating ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : <Zap className="h-4 w-4 ml-2" />}
            {generating ? 'جارٍ التوليد...' : 'توليد التوقعات'}
          </Button>
          <Button onClick={handleVerify} disabled={verifying} variant="outline" size="sm">
            {verifying ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : <RefreshCw className="h-4 w-4 ml-2" />}
            {verifying ? 'جارٍ التحقق...' : 'تحقق من المعلقة'}
          </Button>
          <Button onClick={handleLearn} disabled={learning} variant="outline" size="sm">
            {learning ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : <Brain className="h-4 w-4 ml-2" />}
            {learning ? 'جارٍ التحليل...' : 'تعلّم من الأخطاء'}
          </Button>
          <Button onClick={handleFullTest} disabled={testing} variant="default" size="sm">
            {testing ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : <PlayCircle className="h-4 w-4 ml-2" />}
            {testing ? 'جارٍ الاختبار الكامل...' : ' اختبار كامل'}
          </Button>
        </div>
      </div>

      {/* TOP-TRADES-037 + STOCK-LEAGUE-038: Image Cards للنشر الإعلاني */}
      <div className="flex flex-col lg:flex-row gap-6 justify-center items-start">
        <TopTradesImageCard trades={topTrades} />
        <StockLeagueImageCard />
      </div>

      {/* Advanced Settings Panel */}
      <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Settings className="h-4 w-4" />
              ⚙️ إعدادات متقدمة
              {settingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          {!settingsOpen && (
            <span className="text-xs text-muted-foreground">
              {startDate} → {endDate} | {tickersPerMarket} أسهم/سوق | كل {sampleEveryDays} يوم
            </span>
          )}
        </div>
        <CollapsibleContent>
          <Card className="mt-3 border-emerald-500/20 bg-muted/30">
            <CardContent className="p-4 md:p-6 space-y-6">
              {/* Prediction Period */}
              <div>
                <h3 className="text-sm font-semibold text-emerald-600 mb-3 flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  فترة التوقعات
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="startDate" className="text-sm">تاريخ البداية</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>Start Date — beginning of the analysis period</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="endDate" className="text-sm">تاريخ النهاية</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>End Date — end of the analysis period (default: today)</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Analysis Settings */}
              <div>
                <h3 className="text-sm font-semibold text-emerald-600 mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  إعدادات التحليل
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">عدد الأسهم لكل سوق</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>Tickers Per Market — number of stocks analyzed per market</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <span className="text-sm font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded">{tickersPerMarket}</span>
                    </div>
                    <Slider
                      value={[tickersPerMarket]}
                      onValueChange={(v) => setTickersPerMarket(v[0])}
                      min={5}
                      max={30}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>5</span>
                      <span>30</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">فترة أخذ العينات بالأيام</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>Sample Every Days — interval between analysis snapshots</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <span className="text-sm font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded">{sampleEveryDays}</span>
                    </div>
                    <Slider
                      value={[sampleEveryDays]}
                      onValueChange={(v) => setSampleEveryDays(v[0])}
                      min={1}
                      max={30}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1</span>
                      <span>30</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="clearExisting" className="text-sm">مسح البيانات الموجودة</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>Clear Existing — remove all previous predictions before generating new ones</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Switch
                    id="clearExisting"
                    checked={clearExisting}
                    onCheckedChange={setClearExisting}
                  />
                </div>
              </div>

              <Separator />

              {/* Dynamic Params Summary */}
              {dynamicParams && (
                <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/40">
                  <Brain className="h-4 w-4 text-emerald-600" />
                  <div className="text-xs">
                    <span className="font-semibold">معاملات ديناميكية:</span>{' '}
                    <span className="text-muted-foreground">
                      {dynamicSource === 'market-regime'
                        ? `معدلة تلقائياً بناءً على السوق (RSI=${dynamicParams.meta?.avgRsi ?? '-'}، تقلب=${dynamicParams.meta?.avgAtrPct ?? '-'}%)`
                        : 'قيم افتراضية'}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchDynamicParams}
                    className="h-7 px-2"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {/* Technical Analysis Parameters */}
              <div>
                <h3 className="text-sm font-semibold text-emerald-600 mb-3 flex items-center gap-2">
                  <CandlestickChart className="h-4 w-4" />
                  معاملات التحليل الفني
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="atrPeriod" className="text-sm">فترة ATR</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>ATR Period — Average True Range calculation period</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="atrPeriod"
                      type="number"
                      min={1}
                      max={100}
                      value={atrPeriod}
                      onChange={(e) => setAtrPeriod(Number(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="swingLookback" className="text-sm">فترة البحث عن القمم</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>Swing Lookback Period — bars to look back for swing high/low detection</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="swingLookback"
                      type="number"
                      min={1}
                      max={100}
                      value={swingLookback}
                      onChange={(e) => setSwingLookback(Number(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="rsiOverbought" className="text-sm">عتبة تشبع الشراء RSI</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>RSI Overbought Threshold — RSI level signaling overbought conditions</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="rsiOverbought"
                      type="number"
                      min={50}
                      max={100}
                      value={rsiOverbought}
                      onChange={(e) => setRsiOverbought(Number(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="rsiOversold" className="text-sm">عتبة تشبع البيع RSI</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>RSI Oversold Threshold — RSI level signaling oversold conditions</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="rsiOversold"
                      type="number"
                      min={0}
                      max={50}
                      value={rsiOversold}
                      onChange={(e) => setRsiOversold(Number(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="minRiskReward" className="text-sm">الحد الأدنى لنسبة العائد/المخاطرة</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>Min Risk/Reward Ratio — minimum R:R to accept a trade signal</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="minRiskReward"
                      type="number"
                      min={0.5}
                      max={10}
                      step={0.1}
                      value={minRiskReward}
                      onChange={(e) => setMinRiskReward(Number(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="exitSignalThreshold" className="text-sm">عتبة إشارة الخروج (قمة الخول)</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>Exit Signal Threshold — confidence threshold for exit signal generation</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      id="exitSignalThreshold"
                      type="number"
                      min={0}
                      max={100}
                      value={exitSignalThreshold}
                      onChange={(e) => setExitSignalThreshold(Number(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Summary Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">إجمالي التوقعات</span>
                <Database className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">{stats.total_predictions}</div>
              <div className="text-xs text-muted-foreground mt-1">{stats.markets_covered.length} أسواق</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">نسبة الفوز الحقيقية</span>
                <Trophy className="h-4 w-4 text-emerald-500" />
              </div>
              <div className={cn('text-2xl font-bold', stats.real_win_rate >= 50 ? 'text-emerald-600' : stats.real_win_rate >= 35 ? 'text-amber-600' : 'text-red-600')}>
                {stats.real_win_rate}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">{stats.target_hits} فوز / {stats.closed_predictions} مغلق</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">العائد المتوسط</span>
                <TrendingUp className="h-4 w-4 text-blue-500" />
              </div>
              <div className={cn('text-2xl font-bold', (stats.avg_return ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                {formatPercent(stats.avg_return)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">لكل صفقة مغلقة</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">قيد التنفيذ</span>
                <Clock className="h-4 w-4 text-blue-500" />
              </div>
              <div className="text-2xl font-bold">{stats.pending}</div>
              <div className="text-xs text-muted-foreground mt-1">بانتظار النتيجة</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">اعتماد S/R</span>
                <Shield className="h-4 w-4 text-purple-500" />
              </div>
              <div className="text-2xl font-bold">{stats.sr_adoption_rate}%</div>
              <div className="text-xs text-muted-foreground mt-1">دعوم ومقاومات</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">اعتماد الشموع</span>
                <CandlestickChart className="h-4 w-4 text-orange-500" />
              </div>
              <div className="text-2xl font-bold">{stats.candlestick_adoption_rate}%</div>
              <div className="text-xs text-muted-foreground mt-1">شموع يابانية</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detailed Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { label: 'BUY', value: stats.buy_signals, color: 'text-emerald-600' },
            { label: 'SELL', value: stats.sell_signals, color: 'text-red-600' },
            { label: 'حقق الهدف', value: stats.target_hits, color: 'text-emerald-600' },
            { label: 'وقف الخسارة', value: stats.stop_hits, color: 'text-red-600' },
            { label: 'جني أرباح', value: stats.profit_taken ?? 0, color: 'text-emerald-600' },
            { label: 'متوسط R/R', value: stats.avg_risk_reward?.toFixed(2) ?? '—', color: 'text-amber-600' },
            { label: 'أقصى ربح', value: formatPercent(stats.avg_max_profit, false), color: 'text-emerald-600' },
            { label: 'انتهت', value: stats.expired, color: 'text-amber-600' },
          ].map((s, i) => (
            <div key={i} className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className={cn('font-bold text-sm md:text-base', s.color)}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {testReport && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-blue-500" />
              تقرير الاختبار الكامل للنظام
            </CardTitle>
            <CardDescription>
              TS Generation + Verify + Learn + Python Cycle — {testReport.timestamp ? new Date(testReport.timestamp).toLocaleString('ar-EG') : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">التوليد (Historical)</div>
                <div className="text-sm font-bold">{testReport.generation?.generated ?? '—'} توقع</div>
                <div className="text-xs text-muted-foreground">Scan: {testReport.generation?.tickers_scanned ?? '—'} | Skip: {testReport.generation?.tickers_skipped ?? '—'}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">التنفيذ (Verify)</div>
                <div className="text-sm font-bold">{testReport.verify?.checked ?? '—'} تم فحصه</div>
                <div className="text-xs text-muted-foreground">هدف: {testReport.verify?.target_hits ?? 0} | وقف: {testReport.verify?.stopped ?? 0} | جني أرباح: {testReport.verify?.profit_taken ?? 0}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">التعلم (Lessons)</div>
                <div className="text-sm font-bold">{testReport.lessons_extracted ?? '—'} درس</div>
                <div className="text-xs text-muted-foreground">نسبة الفوز: {testReport.stats?.real_win_rate ?? '—'}%</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Python Backend + AI</div>
                <div className="text-sm font-bold">{testReport.python_test?.closer?.success ? '✅ Daily Closer' : '❌ Daily Closer'}</div>
                <div className="text-sm font-bold">{testReport.python_test?.learning?.success ? '✅ Learning Engine' : '❌ Learning Engine'}</div>
                <div className="text-xs text-muted-foreground">AI: {testReport.python_test?.ai_status?.ollama?.available ? `✅ Ollama (${testReport.python_test.ai_status.ollama.models?.join(',') || ''})` : '❌ غير متاح'}</div>
              </div>
            </div>
            {testReport.python_test?.errors?.length > 0 && (
              <div className="mt-3 text-xs text-red-600 bg-red-500/10 p-2 rounded">
                أخطاء Python: {testReport.python_test.errors.join(' | ')}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* View Mode Toggle */}
      <div className="flex items-center gap-2">
  <Button variant={viewMode === 'charts' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('charts')}>
    <PieChart className="h-4 w-4 ml-2" />
    رسوم بيانية
  </Button>
  <Button variant={viewMode === 'table' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('table')}>
    <List className="h-4 w-4 ml-2" />
    جدول تفصيلي
  </Button>
</div>

{/* ======== CHARTS VIEW ======== */}
{viewMode === 'charts' && stats && (
  <>
    {/* Win Rate Gauge + Status Distribution */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <PieChart className="h-5 w-5" />
            توزيع النتائج
          </CardTitle>
          <CardDescription>هدف / وقف / انتهاء / معلقة</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <RePieChart>
              <Pie data={[
                { name: 'حقق الهدف', value: stats.target_hits, fill: '#10b981' },
                { name: 'وقف الخسارة', value: stats.stop_hits, fill: '#ef4444' },
                { name: 'انتهت', value: stats.expired, fill: '#f59e0b' },
                { name: 'معلقة', value: stats.pending, fill: '#3b82f6' },
              ].filter(d => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                <Cell fill="#10b981" />
                <Cell fill="#ef4444" />
                <Cell fill="#f59e0b" />
                <Cell fill="#3b82f6" />
              </Pie>
              <ReTooltip />
            </RePieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5" />
            الأداء حسب السوق
          </CardTitle>
          <CardDescription>نسبة الفوز لكل سوق</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byMarket.filter(m => m.total > 0)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} />
              <YAxis type="category" dataKey="market" tickFormatter={(v) => MARKET_NAMES[v] || v} width={70} />
              <ReTooltip formatter={(val: any, name: string) => [`${val}%`, name === 'win_rate' ? 'نسبة الفوز' : '']} />
              <Bar dataKey="win_rate" fill="#10b981" radius={[0, 4, 4, 0]} name="نسبة الفوز %" />
              <Bar dataKey="sr_adoption" fill="#8884d8" radius={[0, 4, 4, 0]} name="اعتماد S/R %" />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {byMarket.filter(m => m.total > 0).map(m => (
              <div key={m.market} className="flex items-center justify-between text-xs bg-muted/30 p-1.5 rounded">
                <span className="font-medium">{MARKET_NAMES[m.market] || m.market}</span>
                <span className={cn('font-bold', m.avg_return && m.avg_return > 0 ? 'text-emerald-600' : 'text-red-600')}>
                  {formatPercent(m.avg_return)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>

    {/* Returns Distribution + Candlestick Patterns */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ChartLine className="h-5 w-5" />
            توزيع العوائد (%)
          </CardTitle>
          <CardDescription>توزيع العوائد للصفقات المغلقة</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={(() => {
              const buckets: Record<string, number> = { '-20+': 0, '-20~-10': 0, '-10~-5': 0, '-5~0': 0, '0~+5': 0, '+5~+10': 0, '+10~+20': 0, '+20+': 0 };
              predictions.filter(p => p.actual_return !== null).forEach(p => {
                const r = p.actual_return!;
                if (r < -20) buckets['-20+']++;
                else if (r < -10) buckets['-20~-10']++;
                else if (r < -5) buckets['-10~-5']++;
                else if (r < 0) buckets['-5~0']++;
                else if (r < 5) buckets['0~+5']++;
                else if (r < 10) buckets['+5~+10']++;
                else if (r < 20) buckets['+10~+20']++;
                else buckets['+20+']++;
              });
              return Object.entries(buckets).map(([k, v]) => ({ range: k, count: v }));
            })()}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" fontSize={11} />
              <YAxis />
              <ReTooltip />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {(() => {
                  const ranges = ['-20+', '-20~-10', '-10~-5', '-5~0', '0~+5', '+5~+10', '+10~+20', '+20+'];
                  return ranges.map((r) => <Cell key={r} fill={r.startsWith('-') ? '#ef4444' : '#10b981'} />);
                })()}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CandlestickChart className="h-5 w-5 text-orange-500" />
            أداء الشموع اليابانية
          </CardTitle>
          <CardDescription>نسبة نجاح كل نموذج</CardDescription>
        </CardHeader>
        <CardContent>
          {patterns.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={patterns.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} />
                <YAxis type="category" dataKey="name" tickFormatter={(v) => {
                  const map: Record<string, string> = { DOJI: 'دوجي', HAMMER: 'شاكوش', BULLISH_ENGULFING: 'ابتلاع صاعد', BEARISH_ENGULFING: 'ابتلاع هابط', MORNING_STAR: 'نجمة الصباح' };
                  return map[v] || v;
                }} width={90} fontSize={11} />
                <ReTooltip formatter={(val: any) => [`${val}%`, 'نسبة النجاح']} />
                <Bar dataKey="win_rate" fill="#f97316" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-60 text-muted-foreground text-sm">
              لا توجد أنماط شموع مكتشفة بعد. قم بتوليد التوقعات لتحليل الشموع.
            </div>
          )}
        </CardContent>
      </Card>
    </div>

    {/* R:R Distribution + Analysis Methods */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5" />
            توزيع R:R للصفقات
          </CardTitle>
          <CardDescription>
            <span className="text-emerald-600">أخضر = R:R ≥ 2</span> | <span className="text-amber-600">أصفر = 1.5-2</span> | <span className="text-red-600">أحمر = &lt; 1.5</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const rrData = [
              { name: 'R:R ≥ 2 (ممتاز)', value: predictions.filter(p => (p.risk_reward ?? 0) >= 2).length, color: '#10b981' },
              { name: 'R:R 1.5-2 (جيد)', value: predictions.filter(p => (p.risk_reward ?? 0) >= 1.5 && (p.risk_reward ?? 0) < 2).length, color: '#f59e0b' },
              { name: 'R:R < 1.5 (ضعيف)', value: predictions.filter(p => (p.risk_reward ?? 0) > 0 && (p.risk_reward ?? 0) < 1.5).length, color: '#ef4444' },
            ];
            return (
              <ResponsiveContainer width="100%" height={280}>
                <RePieChart>
                  <Pie data={rrData.filter(d => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}>
                    {rrData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <ReTooltip />
                </RePieChart>
              </ResponsiveContainer>
            );
          })()}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-purple-500" />
            طرق التحليل المستخدمة
          </CardTitle>
          <CardDescription>عدد التوقعات حسب طريقة التحليل</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={(() => {
              const methodCounts: Record<string, number> = {};
              predictions.forEach(p => {
                p.analysis_methods?.forEach(m => {
                  methodCounts[m] = (methodCounts[m] || 0) + 1;
                });
              });
              return Object.entries(methodCounts)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 15);
            })()} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={100} fontSize={11} />
              <ReTooltip />
              <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>

    {/* HONEST-V2: New charts — P/L Over Time + Signal Distribution */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ChartLine className="h-5 w-5 text-emerald-500" />
            العائد التراكمي عبر الزمن
          </CardTitle>
          <CardDescription>
            صافي العائد المتراكم لكل الصفقات المغلقة حسب تاريخ الخروج — إجمالي {cumulativeReturns.length} نقطة
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cumulativeReturns.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={cumulativeReturns}>
                <defs>
                  <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cumGradNeg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" fontSize={10} tickFormatter={(v) => String(v).slice(5)} />
                <YAxis fontSize={11} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <ReTooltip
                  contentStyle={{ direction: 'ltr', textAlign: 'left' }}
                  formatter={(val: any, name: string) => [`${Number(val).toFixed(2)}%`, name === 'cumulative_return' ? 'العائد التراكمي' : '']}
                  labelFormatter={(l) => `التاريخ: ${l}`}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative_return"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#cumGrad)"
                  name="cumulative_return"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-60 text-muted-foreground text-sm">
              لا توجد بيانات للعوائد بعد. اضغط "توليد التوقعات" ثم "تحقق من المعلقة" لعرض العائد التراكمي.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <PieChart className="h-5 w-5" />
            توزيع الإشارات
          </CardTitle>
          <CardDescription>شراء vs بيع</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <RePieChart>
              <Pie
                data={[
                  { name: 'شراء (BUY)', value: stats?.buy_signals || 0, fill: '#10b981' },
                  { name: 'بيع (SELL)', value: stats?.sell_signals || 0, fill: '#ef4444' },
                ].filter(d => d.value > 0)}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
              >
                <Cell fill="#10b981" />
                <Cell fill="#ef4444" />
              </Pie>
              <ReTooltip />
            </RePieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5 text-emerald-500" />
            الأداء الشهري
          </CardTitle>
          <CardDescription>صافي العائد ونسبة الفوز لكل شهر</CardDescription>
        </CardHeader>
        <CardContent>
          {monthlyBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => `${v}%`} />
                <ReTooltip
                  contentStyle={{ direction: 'ltr', textAlign: 'left' }}
                  formatter={(val: any, name: string) => {
                    if (name === 'net_pl') return [`${Number(val).toFixed(2)}%`, 'صافي العائد'];
                    if (name === 'win_rate') return [`${Number(val).toFixed(1)}%`, 'نسبة الفوز'];
                    return [val, name];
                  }}
                />
                <Bar dataKey="net_pl" radius={[4, 4, 0, 0]} name="net_pl">
                  {monthlyBreakdown.map((m, i) => (
                    <Cell key={i} fill={m.net_pl >= 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-60 text-muted-foreground text-sm">
              لا توجد بيانات شهرية بعد
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  </>
)}

{/* ======== TABLE VIEW ======== */}
{viewMode === 'table' && (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    {/* By Market Table */}
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BarChart3 className="h-5 w-5" />
          الأداء حسب السوق
        </CardTitle>
        <CardDescription>نسبة الفوز والعائد لكل سوق — حقيقي 100%</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-80">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>السوق</TableHead>
                <TableHead className="text-center">الإجمالي</TableHead>
                <TableHead className="text-center">فوز</TableHead>
                <TableHead className="text-center">خسارة</TableHead>
                <TableHead className="text-center">معلقة</TableHead>
                <TableHead className="text-center">نسبة الفوز</TableHead>
                <TableHead className="text-center">العائد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byMarket.map((m) => (
                <TableRow key={m.market}>
                  <TableCell className="font-medium">{MARKET_NAMES[m.market] || m.market}</TableCell>
                  <TableCell className="text-center">{m.total}</TableCell>
                  <TableCell className="text-center text-emerald-600 font-medium">{m.wins}</TableCell>
                  <TableCell className="text-center text-red-600 font-medium">{m.losses}</TableCell>
                  <TableCell className="text-center text-blue-600">{m.pending}</TableCell>
                  <TableCell className="text-center">
                    <span className={cn('font-bold', m.win_rate >= 50 ? 'text-emerald-600' : m.win_rate >= 35 ? 'text-amber-600' : 'text-red-600')}>
                      {m.win_rate}%
                    </span>
                  </TableCell>
                  <TableCell className={cn('text-center font-medium', (m.avg_return ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {formatPercent(m.avg_return)}
                  </TableCell>
                </TableRow>
              ))}
              {byMarket.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    لا توجد بيانات. اضغط "توليد التوقعات" لبدء التحليل.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>

    {/* Candlestick Patterns Performance */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CandlestickChart className="h-5 w-5 text-orange-500" />
          أداء الشموع اليابانية
        </CardTitle>
        <CardDescription>نسبة نجاح كل نموذج</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-80">
          <div className="space-y-2">
            {patterns.slice(0, 12).map((p) => (
              <div key={p.name} className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.count} مرة</div>
                </div>
                <div className="text-left">
                  <div className={cn('font-bold text-sm', p.win_rate >= 50 ? 'text-emerald-600' : p.win_rate >= 30 ? 'text-amber-600' : 'text-red-600')}>
                    {p.win_rate}%
                  </div>
                  <div className="text-xs text-muted-foreground">{p.wins}ف / {p.losses}خ</div>
                </div>
              </div>
            ))}
            {patterns.length === 0 && (
              <div className="text-center text-muted-foreground py-8 text-sm">
                لا توجد أنماط مكتشفة بعد
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  </div>
)}

      {/* Lessons Learned */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-purple-500" />
            الدروس المستفادة من الأخطاء
          </CardTitle>
          <CardDescription>
            تحليل حقيقي لأسباب الفشل — {lessons.length} درس مستخرج
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lessons.length === 0 ? (
            <div className="text-center py-8">
              <Lightbulb className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground mb-3">لم يتم استخراج دروس بعد</p>
              <Button onClick={handleLearn} disabled={learning} variant="outline" size="sm">
                <Brain className="h-4 w-4 ml-2" />
                ابدأ التعلم من الأخطاء
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {lessons.map((lesson, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={cn(
                    'p-3 rounded-lg border',
                    lesson.failure_rate > 70 ? 'border-red-500/30 bg-red-500/5' :
                    lesson.failure_rate > 50 ? 'border-amber-500/30 bg-amber-500/5' :
                    'border-emerald-500/30 bg-emerald-500/5'
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <Badge variant="outline" className="text-xs">{lesson.category}</Badge>
                    <span className={cn('text-xs font-bold',
                      lesson.failure_rate > 70 ? 'text-red-600' :
                      lesson.failure_rate > 50 ? 'text-amber-600' :
                      'text-emerald-600'
                    )}>
                      {lesson.failure_rate}% فشل
                    </span>
                  </div>
                  <p className="text-sm font-medium mb-1">{lesson.rule}</p>
                  <p className="text-xs text-muted-foreground mb-2">{lesson.evidence}</p>
                  <div className="flex items-start gap-1 text-xs">
                    <Lightbulb className="h-3 w-3 mt-0.5 text-yellow-500 shrink-0" />
                    <span>{lesson.recommendation}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters + Predictions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Filter className="h-5 w-5" />
            قائمة التوقعات (تفاصيل كاملة)
          </CardTitle>
          <CardDescription>كل توقع مع الأسباب، الأنماط، والنتيجة الفعلية</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <Select value={marketFilter} onValueChange={setMarketFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="السوق" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأسواق</SelectItem>
                <SelectItem value="TADAWUL">السعودية</SelectItem>
                <SelectItem value="EGX">مصر</SelectItem>
                <SelectItem value="KSE">الكويت</SelectItem>
                <SelectItem value="QSE">قطر</SelectItem>
                <SelectItem value="US">أمريكا</SelectItem>
                <SelectItem value="INDICES">المؤشرات</SelectItem>
                <SelectItem value="FOREX">العملات</SelectItem>
                <SelectItem value="COMMODITIES">الذهب</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="الحالة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="TARGET_HIT">حقق الهدف</SelectItem>
                <SelectItem value="STOPPED">وقف الخسارة</SelectItem>
                <SelectItem value="EXPIRED">انتهت المدة</SelectItem>
                <SelectItem value="PENDING">قيد التنفيذ</SelectItem>
              </SelectContent>
            </Select>
            <Select value={signalFilter} onValueChange={setSignalFilter}>
              <SelectTrigger className="w-32"><SelectValue placeholder="الإشارة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="BUY">شراء</SelectItem>
                <SelectItem value="SELL">بيع</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-40"><SelectValue placeholder="ترتيب" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="prediction_date">التاريخ</SelectItem>
                <SelectItem value="profit_loss_percent">العائد</SelectItem>
                <SelectItem value="confidence">الثقة</SelectItem>
                <SelectItem value="risk_reward">R/R</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <ScrollArea className="max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>السهم</TableHead>
                  <TableHead>السوق</TableHead>
                  <TableHead>الإشارة</TableHead>
                  <TableHead className="text-right">الدخول</TableHead>
                  <TableHead className="text-right">الهدف</TableHead>
                  <TableHead className="text-right">وقف الخسارة</TableHead>
                  <TableHead className="text-center">R/R</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-right">العائد</TableHead>
                  <TableHead>الأدلة والأنماط</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {predictions.map((p) => {
                  const statusCfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.PENDING;
                  const isExpanded = expandedId === p.id;
                  const rr = p.risk_reward;
                  const rrColor = rr === null ? 'text-muted-foreground' : rr >= 2 ? 'text-emerald-600' : rr >= 1.5 ? 'text-amber-600' : 'text-red-600';
                  return (
                    <React.Fragment key={p.id}>
                      <TableRow
                        className={cn('cursor-pointer hover:bg-muted/50 transition-colors', isExpanded && 'bg-muted/40')}
                        onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      >
                        <TableCell className="text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {p.prediction_date?.split(' ')[0]}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          <div>{p.stock_symbol}</div>
                          {p.stock_name_ar && p.stock_name_ar !== p.stock_symbol && (
                            <div className="text-xs text-muted-foreground">{p.stock_name_ar}</div>
                          )}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{MARKET_NAMES[p.market] || p.market}</Badge></TableCell>
                        <TableCell>
                          <Badge variant={p.signal_type === 'BUY' ? 'default' : 'destructive'} className="text-xs">
                            {p.signal_type === 'BUY' ? 'شراء' : 'بيع'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatPrice(p.entry_price)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-emerald-600">{formatPrice(p.target_price)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-red-600">{formatPrice(p.stop_loss)}</TableCell>
                        <TableCell className={cn('text-center font-mono text-xs font-bold', rrColor)}>
                          {rr?.toFixed(2) ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-xs', statusCfg.color)}>
                            {statusCfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className={cn('text-right font-mono text-xs font-bold',
                          (p.profit_loss_percent ?? 0) > 0 ? 'text-emerald-600' : (p.profit_loss_percent ?? 0) < 0 ? 'text-red-600' : 'text-muted-foreground'
                        )}>
                          {formatPercent(p.profit_loss_percent)}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <div className="flex flex-wrap gap-1">
                            {p.candle_patterns && p.candle_patterns.length > 0 && p.candle_patterns.slice(0, 1).map((pat, i) => (
                              <Badge key={i} variant="outline" className={cn('text-xs',
                                pat.type === 'bullish' ? 'bg-emerald-500/10 text-emerald-600' :
                                pat.type === 'bearish' ? 'bg-red-500/10 text-red-600' :
                                'bg-slate-500/10'
                              )}>
                                {pat.name_ar}
                              </Badge>
                            ))}
                            {p.trend_direction && (
                              <Badge variant="outline" className={cn('text-xs',
                                p.trend_direction === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-600' :
                                p.trend_direction === 'BEARISH' ? 'bg-red-500/10 text-red-600' : ''
                              )}>
                                {p.trend_direction === 'BULLISH' ? 'صاعد' : p.trend_direction === 'BEARISH' ? 'هابط' : 'عرضي'}
                              </Badge>
                            )}
                            {p.rsi_value !== null && (
                              <Badge variant="outline" className={cn('text-xs',
                                p.rsi_value > 70 ? 'bg-red-500/10 text-red-600' :
                                p.rsi_value < 30 ? 'bg-emerald-500/10 text-emerald-600' : ''
                              )}>
                                RSI {p.rsi_value.toFixed(0)}
                              </Badge>
                            )}
                            {p.persona && (
                              <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-600">
                                {p.persona === 'gambler' ? '🎯 مضارب' : p.persona === 'investor' ? '💼 مستثمر' : '⚖️ متوازن'}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/20 border-b-2 border-muted">
                          <TableCell colSpan={11} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                              {/* Trade Setup */}
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                                  <Target className="h-3 w-3" />
                                  إعداد الصفقة
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">سعر الدخول:</span>
                                    <span className="font-mono font-medium">{formatPrice(p.entry_price)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">الهدف:</span>
                                    <span className="font-mono font-medium text-emerald-600">{formatPrice(p.target_price)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">وقف الخسارة:</span>
                                    <span className="font-mono font-medium text-red-600">{formatPrice(p.stop_loss)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">نسبة R/R:</span>
                                    <span className={cn('font-mono font-bold', rrColor)}>{rr?.toFixed(2) ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">ATR:</span>
                                    <span className="font-mono">{p.atr_value?.toFixed(3) ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">الثقة (Maestro):</span>
                                    <span className="font-mono font-medium">{p.maestro_score?.toFixed(0) ?? p.confidence?.toFixed(0) ?? '—'}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Technical Indicators */}
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                                  <BarChart3 className="h-3 w-3" />
                                  المؤشرات الفنية
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">RSI(14):</span>
                                    <span className={cn('font-mono font-medium', p.rsi_value === null ? '' : p.rsi_value > 70 ? 'text-red-600' : p.rsi_value < 30 ? 'text-emerald-600' : '')}>
                                      {p.rsi_value?.toFixed(1) ?? '—'}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">MA20:</span>
                                    <span className="font-mono">{p.ma20_value?.toFixed(2) ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">MA50:</span>
                                    <span className="font-mono">{p.ma50_value?.toFixed(2) ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">MACD:</span>
                                    <span className={cn('font-mono', p.macd_histogram === null ? '' : p.macd_histogram > 0 ? 'text-emerald-600' : 'text-red-600')}>
                                      {p.macd_histogram?.toFixed(3) ?? '—'}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Bollinger Width:</span>
                                    <span className="font-mono">{p.bollinger_width?.toFixed(3) ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">حجم التداول:</span>
                                    <span className="font-medium">{p.volume_trend === 'increasing' ? '📊 متزايد' : p.volume_trend === 'spike' ? '⚡ ارتفاع حاد' : p.volume_trend === 'decreasing' ? '📉 متناقص' : p.volume_trend ?? '—'}</span>
                                  </div>
                                </div>
                              </div>

                              {/* S/R + Candlestick */}
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                                  <Shield className="h-3 w-3" />
                                  الدعوم والمقاومات والشموع
                                </h4>
                                <div className="space-y-1 text-xs">
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">الدعم:</span>
                                    <span className="font-mono text-emerald-600">{p.sr_support?.toFixed(2) ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">المقاومة:</span>
                                    <span className="font-mono text-red-600">{p.sr_resistance?.toFixed(2) ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">الاتجاه:</span>
                                    <span className={cn('font-medium', p.trend_direction === 'BULLISH' ? 'text-emerald-600' : p.trend_direction === 'BEARISH' ? 'text-red-600' : '')}>
                                      {p.trend_direction === 'BULLISH' ? 'صاعد 📈' : p.trend_direction === 'BEARISH' ? 'هابط 📉' : 'عرضي ↔'}
                                    </span>
                                  </div>
                                  {p.candle_patterns && p.candle_patterns.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 pt-1">
                                      {p.candle_patterns.map((pat, i) => (
                                        <Badge key={i} variant="outline" className={cn('text-xs',
                                          pat.type === 'bullish' ? 'bg-emerald-500/10 text-emerald-600' :
                                          pat.type === 'bearish' ? 'bg-red-500/10 text-red-600' :
                                          'bg-slate-500/10'
                                        )}>
                                          {pat.name_ar} ({pat.name})
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground">لا يوجد نموذج شموع مميز</div>
                                  )}
                                </div>
                              </div>

                              {/* Outcome + Fundamental */}
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                                  <Trophy className="h-3 w-3" />
                                  النتيجة والتحليل الأساسي
                                </h4>
                                <div className="space-y-1 text-xs">
                                  {p.status === 'PENDING' ? (
                                    <div className="text-xs text-amber-600 bg-amber-500/10 rounded p-2 text-center">
                                      ⏳ قيد التنفيذ — بانتظار النتيجة
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">سعر الخروج:</span>
                                        <span className="font-mono font-medium">{formatPrice(p.final_price)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">العائد الفعلي:</span>
                                        <span className={cn('font-mono font-bold', (p.actual_return ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600')}>
                                          {formatPercent(p.actual_return)}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">أقصى ربح:</span>
                                        <span className="font-mono text-emerald-600">{formatPercent(p.max_profit_percent, false)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">مدة التداول:</span>
                                        <span className="font-medium">{p.holding_days ?? 0} يوم</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">سبب الخروج:</span>
                                        <span className="font-medium text-xs" title={p.exit_reason ?? ''}>{p.exit_reason ?? '—'}</span>
                                      </div>
                                    </>
                                  )}
                                  <Separator className="my-2" />
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">P/E:</span>
                                    <span className="font-mono">{p.pe_ratio?.toFixed(1) ?? '—'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">ROE:</span>
                                    <span className="font-mono">{p.roe?.toFixed(1) ?? '—'}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">التوزيعات:</span>
                                    <span className="font-mono">{p.dividend_yield?.toFixed(2) ?? '—'}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">هامش الربح:</span>
                                    <span className="font-mono">{p.profit_margin?.toFixed(1) ?? '—'}%</span>
                                  </div>
                                </div>
                              </div>

                              {/* Reasons (full width) */}
                              {p.reasons && p.reasons.length > 0 && (
                                <div className="md:col-span-2 lg:col-span-4 space-y-2">
                                  <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                                    <Lightbulb className="h-3 w-3" />
                                    أسباب القرار ({p.reasons.length})
                                  </h4>
                                  <div className="flex flex-wrap gap-1.5">
                                    {p.reasons.map((r, i) => (
                                      <Badge key={i} variant="outline" className="text-xs bg-muted/50">
                                        {r}
                                      </Badge>
                                    ))}
                                  </div>
                                  {p.sector && (
                                    <div className="text-xs text-muted-foreground mt-2">
                                      القطاع: <span className="font-medium">{p.sector}</span>
                                      {p.persona && (
                                        <span className="mr-3">شخصية Maestro: <span className="font-medium">
                                          {p.persona === 'gambler' ? '🎯 مضارب' : p.persona === 'investor' ? '💼 مستثمر' : '⚖️ متوازن'}
                                        </span></span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
                {predictions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                      لا توجد توقعات. اضغط "توليد التوقعات" لبدء التحليل الحقيقي.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Footer note */}
      <div className="text-center text-xs text-muted-foreground pb-6">
        ✅ نظام تتبّع صادق 100% — كل البيانات من الأسعار الفعلية عبر {stats?.markets_covered?.length || 4} أسواق، لا Math.random، لا نسب فوز مصطنعة.
        <br />
        تحليل فني + مالي + أساسي + شموع يابانية + دعوم/مقاومات + حجم تداول
        <br />
        آخر تحديث: {stats?.date_range?.latest || '—'}
      </div>
    </div>
  );
}

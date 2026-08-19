'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, RefreshCw, Download, Filter, Calendar, Clock,
  ArrowUpDown, TrendingUp, TrendingDown, Wallet, Trophy, Users,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, Cell,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Persona = 'all' | 'investor' | 'gambler' | 'general';
type PlFilter = 'all' | 'profit' | 'loss' | 'pending' | 'closed';
type SortKey = 'date_desc' | 'date_asc' | 'return_desc' | 'return_asc' | 'days_desc' | 'days_asc' | 'potential_desc';

interface Prediction {
  id: string;
  source: string;
  ticker: string;
  name_ar: string | null;
  recommendation: string;
  recommendation_ar: string | null;
  confidence: number | null;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  market: string;
  persona: Persona;
  master_score: number | null;
  // P29-V20-CREDIBILITY: مؤشرات العقل الجديد
  technical_score?: number | null;
  v20_score?: number | null;
  smc_score?: number | null;
  dip_buy_qualified?: boolean;
  dip_buy_reason?: string;
  fusion_ready?: boolean;
  status: 'TARGET_HIT' | 'STOPPED' | 'EXPIRED' | 'PROFIT_TAKEN' | 'PENDING';
  actual_return: number | null;
  highest_price: number | null;
  highest_date: string | null;
  days_to_highest: number | null;
  profit_at_highest: number | null;
  lowest_price: number | null;
  days_to_lowest: number | null;
  profit_at_lowest: number | null;
  best_price: number | null;
  best_date: string | null;
  days_to_best: number | null;
  profit_at_best: number | null;
  outcome_date: string | null;
  days_to_result: number | null;
  final_price: number | null;
  is_closed: boolean;
  days_held: number;
  recommendation_date: string | null;
  created_at: string | null;
}

interface Summary {
  total: number;
  closed: number;
  target_hit: number;
  stopped: number;
  expired: number;
  active: number;
  win_rate: number;
  avg_profit: number;
  avg_loss: number;
  total_profit: number;
  total_loss: number;
  net_pl: number;
  best_opportunity: { ticker: string; profit_at_best: number | null; days_to_best: number | null } | null;
  by_market: Record<string, { total: number; target_hit: number; stopped: number; active: number; win_rate: number }>;
}

interface DailyPlPoint { date: string; daily: number; cumulative: number; wins: number; losses: number; }

const MARKET_FLAGS: Record<string, { flag: string; name_ar: string }> = {
  EGX: { flag: '🇪🇬', name_ar: 'مصر' },
  TADAWUL: { flag: '🇸🇦', name_ar: 'سعودية' },
  KSE: { flag: '🇰🇼', name_ar: 'كويت' },
  QSE: { flag: '🇶🇦', name_ar: 'قطر' },
};

const PERSONA_LABELS: Record<Persona, string> = {
  all: 'الكل',
  investor: '🏦 المستثمر',
  gambler: '🎲 المضارب',
  general: '🎯 عام',
};

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function formatReturn(val: number | null): string {
  if (val === null || val === undefined) return '—';
  const n = Number(val);
  if (!isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function formatPrice(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return Number(val).toFixed(2);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateStr.slice(0, 10);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  } catch {
    return dateStr.slice(0, 10);
  }
}

function formatDayShort(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getDate()}/${d.getMonth() + 1}`;
  } catch { return dateStr; }
}

function statusIcon(status: Prediction['status']) {
  switch (status) {
    case 'TARGET_HIT': return '🎯';
    case 'PROFIT_TAKEN': return '💰';
    case 'STOPPED': return '🛑';
    case 'EXPIRED': return '⚠️';
    default: return '⏳';
  }
}

function statusLabel(status: Prediction['status']) {
  switch (status) {
    case 'TARGET_HIT': return 'تم الهدف';
    case 'PROFIT_TAKEN': return 'ربح فني';
    case 'STOPPED': return 'وقف';
    case 'EXPIRED': return 'منتهي';
    default: return 'مفتوح';
  }
}

function rowBg(status: Prediction['status']) {
  switch (status) {
    case 'TARGET_HIT': return 'bg-emerald-50 dark:bg-emerald-950/30';
    case 'PROFIT_TAKEN': return 'bg-teal-50 dark:bg-teal-950/30';
    case 'STOPPED': return 'bg-red-50 dark:bg-red-950/30';
    case 'EXPIRED': return 'bg-yellow-50 dark:bg-yellow-950/30';
    default: return 'bg-gray-50/50 dark:bg-gray-900/20';
  }
}

function returnColor(val: number | null): string {
  if (val === null) return 'text-gray-400';
  if (val >= 0) return 'text-emerald-700 dark:text-emerald-400';
  return 'text-red-700 dark:text-red-400';
}

function daysColor(days: number | null, isClosed: boolean): string {
  if (days === null || days === undefined) return 'text-gray-400';
  if (!isClosed) return 'text-blue-600 dark:text-blue-400';
  if (days <= 7) return 'text-emerald-600 dark:text-emerald-400';
  if (days <= 21) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-orange-600 dark:text-orange-400';
}

function personaBadge(persona: Persona): string {
  switch (persona) {
    case 'investor': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400';
    case 'gambler': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400';
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400';
  }
}

function isBuySignal(rec: string): boolean {
  return ['BUY', 'STRONG_BUY', 'ACCUMULATE', 'شراء', 'شراء قوي', 'تجميع'].includes(rec);
}

export function PredictionCredibilityTable() {
  const [data, setData] = useState<{ predictions: Prediction[]; summary: Summary | null; daily_pl: DailyPlPoint[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('month');
  const [selectedMarket, setSelectedMarket] = useState('');
  const [selectedPersona, setSelectedPersona] = useState<Persona>('all');
  const [plFilter, setPlFilter] = useState<PlFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date_desc');
  const tableRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const autoTriggered = useRef(false);
  const [generating, setGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month: timeFilter === 'all' ? '' : selectedMonth, limit: '2000', min_score: '0' });
      if (selectedMarket) params.set('market', selectedMarket);
      if (selectedPersona !== 'all') params.set('persona', selectedPersona);
      const res = await fetch(`/api/predictions/credibility?${params}`);
      const json = await res.json();
      setData({ predictions: json.predictions || [], summary: json.summary || null, daily_pl: json.daily_pl || [] });
      
      // 🧠 الخبير: لو مفيش توقعات والعميل مش مفرز بفلاتر خاصة، طلب توليد فوري من Python
      const totalPreds = (json.predictions || []).length;
      const isUnfilteredQuery = timeFilter === 'month' && !selectedMarket && selectedPersona === 'all';
      if (totalPreds === 0 && isUnfilteredQuery && !autoTriggered.current) {
        autoTriggered.current = true;
        setGenerating(true);
        try {
          // طلب من Python analyzer يولّد توقعات
          await fetch('/api/python/analyzer/trigger?XTransformPort=8010', { method: 'POST' }).catch(() => {});
          // انتظر شوية ثم أعد التحميل
          setTimeout(async () => {
            try {
              const res2 = await fetch(`/api/predictions/credibility?${params}`);
              const json2 = await res2.json();
              setData({ predictions: json2.predictions || [], summary: json2.summary || null, daily_pl: json2.daily_pl || [] });
            } catch {}
            setGenerating(false);
          }, 15000);
        } catch {}
      }
    } catch (err) {
      console.error('Error fetching credibility data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, timeFilter, selectedMarket, selectedPersona]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const visiblePredictions = useMemo(() => {
    if (!data?.predictions) return [];
    let arr = [...data.predictions];

    // Time filter - read prediction_date || recommendation_date
    if (timeFilter === 'today') {
      const todayStr = new Date().toISOString().slice(0, 10);
      arr = arr.filter((p) => (p.prediction_date || p.recommendation_date || '').slice(0, 10) === todayStr);
    } else if (timeFilter === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      arr = arr.filter((p) => (p.prediction_date || p.recommendation_date || '').slice(0, 10) >= weekAgo);
    }

    switch (plFilter) {
      case 'profit': arr = arr.filter((p) => p.is_closed && p.actual_return !== null && Number(p.actual_return) >= 0); break;
      case 'loss': arr = arr.filter((p) => p.is_closed && p.actual_return !== null && Number(p.actual_return) < 0); break;
      case 'pending': arr = arr.filter((p) => !p.is_closed); break;
      case 'closed': arr = arr.filter((p) => p.is_closed); break;
    }
    const byReturn = (a: Prediction, b: Prediction) => (Number(a.actual_return ?? -Infinity) - Number(b.actual_return ?? -Infinity));
    const byDate = (a: Prediction, b: Prediction) => String(a.prediction_date || a.recommendation_date || '').localeCompare(String(b.prediction_date || b.recommendation_date || ''));
    const byDays = (a: Prediction, b: Prediction) => (a.days_to_result ?? a.days_held ?? 0) - (b.days_to_result ?? b.days_held ?? 0);
    const byPotential = (a: Prediction, b: Prediction) => (b.profit_at_best ?? -Infinity) - (a.profit_at_best ?? -Infinity);
    switch (sortKey) {
      case 'date_asc': arr.sort(byDate); break;
      case 'date_desc': arr.sort(byDate).reverse(); break;
      case 'return_asc': arr.sort(byReturn); break;
      case 'return_desc': arr.sort(byReturn).reverse(); break;
      case 'days_asc': arr.sort(byDays); break;
      case 'days_desc': arr.sort(byDays).reverse(); break;
      case 'potential_desc': arr.sort(byPotential); break;
    }
    return arr;
  }, [data, timeFilter, plFilter, sortKey]);

  const exportPng = async (target: 'table' | 'chart') => {
    const el = target === 'table' ? tableRef.current : chartRef.current;
    if (!el) return;
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
      const link = document.createElement('a');
      link.download = `${target === 'table' ? 'credibility' : 'pl-chart'}-${selectedMonth}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) { console.error('Export failed:', err); }
  };

  const monthLabel = (() => { const [y, m] = selectedMonth.split('-'); return `${MONTHS_AR[parseInt(m) - 1]} ${y}`; })();

  if (loading && !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground">جاري تحليل التوقعات ومطابقتها مع الأسعار الفعلية...</p>
        </div>
      </div>
    );
  }

  const summary = data?.summary;
  const dailyPl = data?.daily_pl ?? [];
  const chartHasData = dailyPl.length > 0;
  const finalCumulative = chartHasData ? dailyPl[dailyPl.length - 1].cumulative : 0;
  const bestDay = chartHasData ? dailyPl.reduce((a, b) => (b.daily > a.daily ? b : a)) : null;
  const worstDay = chartHasData ? dailyPl.reduce((a, b) => (b.daily < a.daily ? b : a)) : null;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-emerald-500" />
            جدول متابعة التوقعات — {monthLabel}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            مطابقة كل توقع مع الأسعار الفعلية — أعلى سعر بعد الدخول، عدد الأيام، الربح الفعلي
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 ml-1" />تحديث</Button>
          <Button variant="outline" size="sm" onClick={() => exportPng('table')}><Download className="w-4 h-4 ml-1" />تصدير</Button>
        </div>
      </div>

      {/* Persona filter (investor / gambler / all) */}
      <div className="flex flex-wrap items-center gap-2">
        <Users className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground ml-1">نوع البرسونا:</span>
        {(['all', 'investor', 'gambler', 'general'] as Persona[]).map((p) => (
          <Button key={p} variant={selectedPersona === p ? 'default' : 'outline'} size="sm" onClick={() => setSelectedPersona(p)} className="text-xs">
            {PERSONA_LABELS[p]}
          </Button>
        ))}
      </div>

      {/* Filters: Time Range + month + market */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Clock className="w-4 h-4 text-muted-foreground ml-1" />
          <span className="text-xs text-muted-foreground ml-1">الفترة الزمنيّة:</span>
          {([['month', 'هذا الشهر'], ['week', 'هذا الأسبوع'], ['today', 'اليوم'], ['all', 'الكل (جميع التوصيات)']] as const).map(([k, label]) => (
            <Button
              key={k}
              variant={timeFilter === k ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTimeFilter(k)}
              className="text-xs font-semibold"
            >
              {label}
            </Button>
          ))}
        </div>
        {timeFilter === 'month' && (
          <div className="flex items-center gap-2 border-r pr-3 border-border">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-background font-mono" />
          </div>
        )}
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-muted-foreground ml-1" />
          <span className="text-xs text-muted-foreground ml-1">السوق:</span>
          {['', 'EGX', 'TADAWUL', 'KSE', 'QSE'].map((m) => (
            <Button key={m || 'all'} variant={selectedMarket === m ? 'default' : 'outline'} size="sm" onClick={() => setSelectedMarket(m)} className="text-xs">
              {m ? `${MARKET_FLAGS[m]?.flag || ''} ${MARKET_FLAGS[m]?.name_ar || m}` : 'الكل'}
            </Button>
          ))}
        </div>
      </div>

      {/* Filters: P/L + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Wallet className="w-4 h-4 text-muted-foreground ml-1" />
          <span className="text-xs text-muted-foreground ml-1">النتيجة:</span>
          {([['all','الكل'],['profit','🎯 الأرباح'],['loss','🛑 الخسائر'],['pending','⏳ مفتوحة'],['closed','✅ مغلقة']] as [PlFilter,string][]).map(([k,l]) => (
            <Button key={k} variant={plFilter === k ? 'default' : 'outline'} size="sm" onClick={() => setPlFilter(k)} className="text-xs">{l}</Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <ArrowUpDown className="w-4 h-4 text-muted-foreground ml-1" />
          <span className="text-xs text-muted-foreground ml-1">ترتيب:</span>
          {([['date_desc','الأحدث'],['date_asc','الأقدم'],['return_desc','أعلى ربح'],['return_asc','أعلى خسارة'],['potential_desc','أعلى فرصة'],['days_desc','أطول مدة'],['days_asc','أقصر مدة']] as [SortKey,string][]).map(([k,l]) => (
            <Button key={k} variant={sortKey === k ? 'default' : 'outline'} size="sm" onClick={() => setSortKey(k)} className="text-xs">{l}</Button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground mr-auto">عرض {visiblePredictions.length} من {data?.predictions?.length ?? 0} توقع</div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card className="border-emerald-200 dark:border-emerald-800/50"><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">توقعات الشهر</p><p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{summary.total}</p></CardContent></Card>
          <Card className="border-blue-200 dark:border-blue-800/50"><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">نسبة النجاح</p><p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{summary.win_rate.toFixed(1)}%</p></CardContent></Card>
          <Card className="border-green-200 dark:border-green-800/50"><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">متوسط الربح</p><p className="text-2xl font-bold text-green-600 dark:text-green-400">+{summary.avg_profit.toFixed(1)}%</p></CardContent></Card>
          <Card className="border-red-200 dark:border-red-800/50"><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">متوسط الخسارة</p><p className="text-2xl font-bold text-red-600 dark:text-red-400">{summary.avg_loss.toFixed(1)}%</p></CardContent></Card>
          <Card className={cn('border', summary.net_pl >= 0 ? 'border-emerald-300 dark:border-emerald-700' : 'border-red-300 dark:border-red-700')}><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">صافي المكسب/الخسارة</p><p className={cn('text-2xl font-bold', summary.net_pl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>{summary.net_pl >= 0 ? '+' : ''}{summary.net_pl.toFixed(1)}%</p></CardContent></Card>
          <Card className="border-muted"><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">مفتوحة / مغلقة</p><p className="text-2xl font-bold"><span className="text-blue-500">{summary.active}</span><span className="text-muted-foreground mx-1">/</span><span>{summary.closed}</span></p></CardContent></Card>
        </div>
      )}

      {/* Best opportunity highlight */}
      {summary?.best_opportunity && (
        <Card className="border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-3 flex items-center gap-3">
            <Trophy className="w-5 h-5 text-amber-500" />
            <span className="text-sm">أفضل فرصة الشهر:</span>
            <span className="font-bold">{summary.best_opportunity.ticker}</span>
            {summary.best_opportunity.profit_at_best !== null && (
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">+{summary.best_opportunity.profit_at_best.toFixed(1)}%</span>
            )}
            {summary.best_opportunity.days_to_best !== null && (
              <span className="text-xs text-muted-foreground">خلال {summary.best_opportunity.days_to_best} يوم</span>
            )}
          </CardContent>
        </Card>
      )}

      {/* P/L chart */}
      <div ref={chartRef} className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-500" /><h3 className="font-bold">الرسم البياني للمكسب والخسارة بالأيام</h3></div>
          <div className="flex items-center gap-2">
            {chartHasData && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>المجموع التراكمي: <span className={cn('font-bold', finalCumulative >= 0 ? 'text-emerald-600' : 'text-red-600')}>{finalCumulative >= 0 ? '+' : ''}{finalCumulative.toFixed(1)}%</span></span>
                {bestDay && <span>أفضل يوم: <span className="font-bold text-emerald-600">+{bestDay.daily.toFixed(1)}%</span></span>}
                {worstDay && <span>أسوأ يوم: <span className="font-bold text-red-600">{worstDay.daily.toFixed(1)}%</span></span>}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => exportPng('chart')} className="text-xs"><Download className="w-3.5 h-3.5 ml-1" />تصدير</Button>
          </div>
        </div>
        {chartHasData ? (
          <>
          {finalCumulative < 0 && (
            <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3 flex items-start gap-2">
              <TrendingDown className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="text-xs">
                <span className="font-bold text-red-600">النظام خسران في الفترة دي.</span>{' '}
                <span className="text-muted-foreground">
                  الأرقام تحت الصفر = خسارة. الأعمدة الحمراء = أيام خسارة، الخضراء = أيام ربح.
                  تم تفعيل فلتر الخبير لتقليل الخسائر في التوقعات الجديدة.
                </span>
              </div>
            </div>
          )}
          {finalCumulative >= 0 && (
            <div className="mb-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div className="text-xs">
                <span className="font-bold text-emerald-600">النظام ربحان في الفترة دي.</span>{' '}
                <span className="text-muted-foreground">
                  الأعمدة الحمراء = أيام خسارة، الخضراء = أيام ربح.
                </span>
              </div>
            </div>
          )}
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyPl} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tickFormatter={formatDayShort} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, direction: 'rtl' }} labelFormatter={(l) => `يوم ${formatDayShort(String(l))}`} formatter={(value: number, name: string) => [`${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`, name === 'daily' ? 'مكسب/خسارة اليوم' : 'المجموع التراكمي']} />
                <Legend formatter={(v) => (v === 'daily' ? 'يومي' : 'تراكمي')} wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="currentColor" className="text-muted-foreground" />
                <Bar dataKey="daily" radius={[3, 3, 0, 0]} name="daily">
                  {dailyPl.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.daily >= 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="cumulative" stroke={finalCumulative >= 0 ? '#10b981' : '#ef4444'} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} name="cumulative" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          </>
        ) : (
          <div className="h-48 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
            <TrendingDown className="w-10 h-10 opacity-30" />
            <p className="text-sm">لا توجد نتائج مغلقة لهذا الشهر بعد — سيظهر الرسم البياني تلقائيًا عند تحقق نتائج التوقعات.</p>
            <p className="text-xs">التوقعات المفتوحة الحالية: {summary?.active ?? 0}</p>
          </div>
        )}
      </div>

      {/* Predictions table */}
      <div ref={tableRef} className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-right py-3 px-2 font-medium text-muted-foreground">التاريخ</th>
                <th className="text-right py-3 px-2 font-medium text-muted-foreground">الشخصية</th>
                <th className="text-right py-3 px-2 font-medium text-muted-foreground">السهم</th>
                <th className="text-center py-3 px-2 font-medium text-muted-foreground">الإشارة</th>
                <th className="text-right py-3 px-2 font-medium text-muted-foreground">الدخول</th>
                <th className="text-right py-3 px-2 font-medium text-muted-foreground">الهدف</th>
                <th className="text-right py-3 px-2 font-medium text-muted-foreground">الوقف</th>
                <th className="text-center py-3 px-2 font-medium text-muted-foreground" title="V20 Fusion Score">V20</th>
                <th className="text-center py-3 px-2 font-medium text-muted-foreground" title="شراء ذكي وقت الهبوط">🔥 Dip</th>
                <th className="text-right py-3 px-2 font-medium text-muted-foreground">أفضل سعر</th>
                <th className="text-center py-3 px-2 font-medium text-muted-foreground">أيام للأفضل</th>
                <th className="text-right py-3 px-2 font-medium text-muted-foreground">ربح الفرصة</th>
                <th className="text-center py-3 px-2 font-medium text-muted-foreground">النتيجة</th>
                <th className="text-right py-3 px-2 font-medium text-muted-foreground">العائد الفعلي</th>
                <th className="text-center py-3 px-2 font-medium text-muted-foreground">أيام للنتيجة</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {visiblePredictions.length === 0 ? (
                  <tr><td colSpan={15} className="py-12 text-center text-muted-foreground">لا توجد توقعات مطابقة لهذه الفلترة</td></tr>
                ) : (
                  visiblePredictions.map((p, i) => (
                    <motion.tr
                      key={p.id || i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.015, 0.4) }}
                      className={cn('border-b transition-colors hover:bg-muted/50', rowBg(p.status))}
                    >
                      <td className="py-2 px-2 tabular-nums text-muted-foreground">{formatDate(p.recommendation_date || p.created_at)}</td>
                      <td className="py-2 px-2">
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', personaBadge(p.persona))}>
                          {p.persona === 'investor' ? 'مستثمر' : p.persona === 'gambler' ? 'مضارب' : 'عام'}
                        </span>
                      </td>
                      <td className="py-2 px-2"><span className="font-bold">{p.ticker}</span></td>
                      <td className="py-2 px-2 text-center">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                          isBuySignal(p.recommendation) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                          : p.recommendation === 'HOLD' || p.recommendation === 'انتظار' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400')}>
                          {p.recommendation_ar || p.recommendation}
                        </span>
                      </td>
                      <td className="py-2 px-2 tabular-nums">{formatPrice(p.entry_price)}</td>
                      <td className="py-2 px-2 tabular-nums">{formatPrice(p.target_price)}</td>
                      <td className="py-2 px-2 tabular-nums">{formatPrice(p.stop_loss)}</td>
                      <td className="py-2 px-2 text-center tabular-nums">
                        {p.v20_score != null ? (
                          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold',
                            p.v20_score >= 70 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                            : p.v20_score >= 50 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')}>
                            {Math.round(p.v20_score)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {p.dip_buy_qualified ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400" title={p.dip_buy_reason || 'شراء ذكي وقت الهبوط'}>
                            🔥 نعم
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={cn('py-2 px-2 tabular-nums font-medium', returnColor(p.profit_at_best))}>{formatPrice(p.best_price)}</td>
                      <td className={cn('py-2 px-2 text-center tabular-nums', daysColor(p.days_to_best, true))}>{p.days_to_best ?? '—'}</td>
                      <td className={cn('py-2 px-2 tabular-nums font-bold', returnColor(p.profit_at_best))}>{formatReturn(p.profit_at_best)}</td>
                      <td className="py-2 px-2 text-center"><span className="text-sm">{statusIcon(p.status)} {statusLabel(p.status)}</span></td>
                      <td className={cn('py-2 px-2 tabular-nums font-medium', returnColor(p.actual_return))}>{formatReturn(p.actual_return)}</td>
                      <td className={cn('py-2 px-2 text-center tabular-nums font-medium', daysColor(p.days_to_result, p.is_closed))}>
                        {p.days_to_result !== null ? <span>{p.days_to_result}<span className="text-[10px] text-muted-foreground mr-0.5">يوم</span></span> : '—'}
                      </td>
                    </motion.tr>
                  ))
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>

      {/* By market */}
      {summary && summary.by_market && Object.keys(summary.by_market).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(summary.by_market).map(([mkt, info]) => (
            <Card key={mkt} className="border-muted"><CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2"><span>{MARKET_FLAGS[mkt]?.flag || '🌍'}</span><span className="font-medium text-sm">{MARKET_FLAGS[mkt]?.name_ar || mkt}</span></div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>الإجمالي</span><span className="font-medium text-foreground">{info.total}</span></div>
                <div className="flex justify-between"><span>🎯 نجح</span><span className="font-medium text-emerald-600">{info.target_hit}</span></div>
                <div className="flex justify-between"><span>🛑 وقف</span><span className="font-medium text-red-600">{info.stopped}</span></div>
                <div className="flex justify-between"><span>نسبة النجاح</span><span className="font-medium">{info.win_rate.toFixed(1)}%</span></div>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border-t pt-4">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-50 dark:bg-emerald-950/30 border" /> تم تحقيق الهدف</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-50 dark:bg-red-950/30 border" /> وقف خسارة</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-50 dark:bg-yellow-950/30 border" /> منتهي الصلاحية</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-50 dark:bg-gray-900/20 border" /> مفتوح</span>
        <span className="flex items-center gap-1 mr-auto">
          <span className="text-blue-500">●</span> أيام الانتظار (مفتوح) ·
          <span className="text-emerald-500">●</span> ≤7 أيام ·
          <span className="text-yellow-500">●</span> 8-21 يوم ·
          <span className="text-orange-500">●</span> {'>'}21 يوم
        </span>
      </div>
    </div>
  );
}

export default PredictionCredibilityTable;

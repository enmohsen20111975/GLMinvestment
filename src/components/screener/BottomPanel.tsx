'use client';

/**
 * BottomPanel — لوحة سفلية بتبويبات 3:
 *
 * 1. "المسح" (Screener) — فلترة الأسهم بمعايير:
 *    price range, volume range, change % range, sector, RSI range
 * 2. "التفاصيل" (Details) — تفاصيل السهم المختار: OHLC, Volume, Market cap, P/E, Sector
 * 3. "الأخبار" (News) — آخر أخبار السهم المختار
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Filter,
  Newspaper,
  Info,
  Search,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  calcRSI,
  formatMarketCap,
  formatPrice,
  formatVolume,
  type OhlcvPoint,
} from './chartIndicators';

// ─── الأنواع ──────────────────────────────────────────────────────────────

export interface ScreenerStock {
  ticker: string;
  name: string;
  name_ar: string;
  sector?: string | null;
  current_price?: number | null;
  price_change?: number | null;
  volume?: number | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  history?: OhlcvPoint[];
}

export interface BottomPanelProps {
  stocks: ScreenerStock[];
  selectedTicker: string | null;
  onSelectTicker: (ticker: string) => void;
  onAddToChart: (ticker: string) => void;
  onOpenDetail: (ticker: string) => void;
}

interface StockDetail {
  ticker: string;
  name?: string;
  name_ar?: string;
  sector?: string | null;
  current_price?: number | null;
  price_change?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  eps?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
}

interface NewsItem {
  title?: string;
  summary?: string;
  url?: string;
  source?: string;
  timestamp?: string | number | null;
  date?: string;
}

// ─── تبويب: المسح (Screener) ──────────────────────────────────────────────

interface ScreenerFilters {
  priceMin: number;
  priceMax: number;
  changeMin: number;
  changeMax: number;
  volumeMin: number;
  rsiMin: number;
  rsiMax: number;
  rsiPreset: 'all' | 'oversold' | 'neutral' | 'overbought' | 'momentum';
  peMin: number;
  peMax: number;
  pePreset: 'all' | 'undervalued' | 'fair' | 'growth';
  sector: string;
  strategyPreset: 'all' | 'explosive' | 'oversold_dip' | 'super_trend' | 'dividend_champions';
}

const DEFAULT_FILTERS: ScreenerFilters = {
  priceMin: 0,
  priceMax: 10000,
  changeMin: -20,
  changeMax: 20,
  volumeMin: 0,
  rsiMin: 0,
  rsiMax: 100,
  rsiPreset: 'all',
  peMin: 0,
  peMax: 100,
  pePreset: 'all',
  sector: '',
  strategyPreset: 'all',
};

function ScreenerTab({
  stocks,
  onSelectTicker,
  onAddToChart,
  onOpenDetail,
}: {
  stocks: ScreenerStock[];
  onSelectTicker: (ticker: string) => void;
  onAddToChart: (ticker: string) => void;
  onOpenDetail: (ticker: string) => void;
}) {
  const [filters, setFilters] = useState<ScreenerFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');

  // حساب RSI لكل سهم
  const stocksWithRSI = useMemo(() => {
    return stocks.map((s) => {
      const closes = s.history?.map((p) => p.close) || [];
      const rsiArr = calcRSI(closes, 14);
      const lastRsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : null;
      return { ...s, _rsi: lastRsi };
    });
  }, [stocks]);

  // قائمة القطاعات
  const sectors = useMemo(() => {
    const set = new Set<string>();
    stocks.forEach((s) => s.sector && set.add(s.sector));
    return Array.from(set).sort();
  }, [stocks]);

  // تطبييق الاستراتيجيات الجاهزة
  const applyStrategyPreset = (preset: ScreenerFilters['strategyPreset']) => {
    if (filters.strategyPreset === preset) {
      setFilters(DEFAULT_FILTERS);
      toast.info('تمت إعادة تعيين الاستراتيجية');
      return;
    }

    switch (preset) {
      case 'explosive':
        setFilters({
          ...DEFAULT_FILTERS,
          changeMin: 1,
          rsiMin: 50,
          rsiMax: 72,
          volumeMin: 100_000,
          strategyPreset: 'explosive',
        });
        toast.success('🎯 تم تفعيل استراتيجية: قنابل الانطلاق والزخم');
        break;
      case 'oversold_dip':
        setFilters({
          ...DEFAULT_FILTERS,
          rsiMin: 0,
          rsiMax: 35,
          changeMax: 0,
          rsiPreset: 'oversold',
          strategyPreset: 'oversold_dip',
        });
        toast.success('🛡️ تم تفعيل استراتيجية: ارتداد القاع التشبع البيعي');
        break;
      case 'super_trend':
        setFilters({
          ...DEFAULT_FILTERS,
          changeMin: 2,
          rsiMin: 55,
          rsiMax: 100,
          strategyPreset: 'super_trend',
        });
        toast.success('⚡ تم تفعيل استراتيجية: أسهم القوة والاتجاه الصاعد');
        break;
      case 'dividend_champions':
        setFilters({
          ...DEFAULT_FILTERS,
          peMin: 0,
          peMax: 15,
          volumeMin: 50_000,
          pePreset: 'undervalued',
          strategyPreset: 'dividend_champions',
        });
        toast.success('💰 تم تفعيل استراتيجية: الأسهم الرخيصة والتوزيعات');
        break;
      default:
        setFilters(DEFAULT_FILTERS);
        toast.info('تمت إعادة تعيين الاستراتيجية');
        break;
    }
  };

  // تطبيق الفلاتر المتقدمة
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return stocksWithRSI.filter((s) => {
      const price = s.current_price ?? 0;
      const change = s.price_change ?? 0;
      const volume = s.volume ?? 0;
      const rsi = s._rsi ?? 50;
      const pe = s.pe_ratio ?? 0;

      if (price < filters.priceMin || price > filters.priceMax) return false;
      if (change < filters.changeMin || change > filters.changeMax) return false;
      if (volume < filters.volumeMin) return false;

      // RSI preset / manual filter
      if (filters.rsiPreset === 'oversold' && rsi >= 35) return false;
      if (filters.rsiPreset === 'neutral' && (rsi < 35 || rsi > 65)) return false;
      if (filters.rsiPreset === 'overbought' && rsi <= 65) return false;
      if (filters.rsiPreset === 'momentum' && (rsi < 50 || rsi > 72)) return false;
      if (rsi < filters.rsiMin || rsi > filters.rsiMax) return false;

      // P/E ratio filter
      if (filters.pePreset === 'undervalued' && pe > 12) return false;
      if (filters.pePreset === 'fair' && (pe < 12 || pe > 25)) return false;
      if (filters.pePreset === 'growth' && pe <= 25) return false;
      if (pe > 0 && (pe < filters.peMin || pe > filters.peMax)) return false;

      if (filters.sector && s.sector !== filters.sector) return false;
      if (
        q &&
        !(
          s.ticker.toLowerCase().includes(q) ||
          (s.name_ar || '').toLowerCase().includes(q) ||
          (s.name || '').toLowerCase().includes(q)
        )
      ) {
        return false;
      }
      return true;
    });
  }, [stocksWithRSI, filters, search]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.strategyPreset !== 'all') count++;
    if (filters.sector) count++;
    if (filters.rsiPreset !== 'all' || filters.rsiMin > 0 || filters.rsiMax < 100) count++;
    if (filters.pePreset !== 'all' || filters.peMin > 0 || filters.peMax < 100) count++;
    if (filters.priceMin > 0 || filters.priceMax < 10000) count++;
    if (filters.changeMin > -20 || filters.changeMax < 20) count++;
    if (filters.volumeMin > 0) count++;
    if (search.trim()) count++;
    return count;
  }, [filters, search]);

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearch('');
    toast.info('تمت إعادة تعيين جميع الفلاتر');
  };

  return (
    <div className="flex flex-col md:flex-row gap-3 h-full dir-rtl">
      {/* الفلاتر الفائقة Sidebar — متوافقة 100% مع الوضع الفاتح والداكن */}
      <div className="md:w-72 shrink-0 border-l border-border p-3 space-y-4 overflow-y-auto bg-card text-card-foreground backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <h4 className="text-xs font-bold text-foreground">الماكس فلاتر (Pro Screener)</h4>
            {activeFiltersCount > 0 && (
              <Badge variant="default" className="bg-purple-600 text-white text-[9px] px-1.5 py-0.2">
                {activeFiltersCount}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
            onClick={resetFilters}
          >
            إعادة تعيين
          </Button>
        </div>

        {/* استراتيجيات الصيد بنقرة واحدة */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-purple-700 dark:text-purple-300 block">🎯 استراتيجيات الصيد الآلي:</label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => applyStrategyPreset('explosive')}
              className={`p-1.5 rounded-lg text-[10px] font-bold transition-all border text-right flex items-center justify-between ${
                filters.strategyPreset === 'explosive'
                  ? 'bg-purple-600 text-white border-purple-400 shadow-md shadow-purple-600/30'
                  : 'bg-muted/50 border-border text-foreground hover:bg-muted'
              }`}
            >
              <span>🎯 قنابل الانطلاق</span>
            </button>
            <button
              onClick={() => applyStrategyPreset('oversold_dip')}
              className={`p-1.5 rounded-lg text-[10px] font-bold transition-all border text-right flex items-center justify-between ${
                filters.strategyPreset === 'oversold_dip'
                  ? 'bg-teal-600 text-white border-teal-400 shadow-md shadow-blue-600/30'
                  : 'bg-muted/50 border-border text-foreground hover:bg-muted'
              }`}
            >
              <span>🛡️ ارتداد القاع</span>
            </button>
            <button
              onClick={() => applyStrategyPreset('super_trend')}
              className={`p-1.5 rounded-lg text-[10px] font-bold transition-all border text-right flex items-center justify-between ${
                filters.strategyPreset === 'super_trend'
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow-md shadow-emerald-600/30'
                  : 'bg-muted/50 border-border text-foreground hover:bg-muted'
              }`}
            >
              <span>⚡ اتجاه صاعد</span>
            </button>
            <button
              onClick={() => applyStrategyPreset('dividend_champions')}
              className={`p-1.5 rounded-lg text-[10px] font-bold transition-all border text-right flex items-center justify-between ${
                filters.strategyPreset === 'dividend_champions'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-md shadow-amber-600/30'
                  : 'bg-muted/50 border-border text-foreground hover:bg-muted'
              }`}
            >
              <span>💰 رخيص وتوزيعات</span>
            </button>
          </div>
        </div>

        {/* بحث نصي */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">بحث بالاسم أو الرمز</label>
          <div className="relative">
            <Search className="absolute right-2.5 top-2 w-3 h-3 text-muted-foreground" />
            <Input
              placeholder="ابحث بـ COMI, فوري..."
              className="h-7 pr-7 text-[11px] bg-background border-border text-foreground placeholder:text-muted-foreground"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* القطاع */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">القطاع</label>
          <select
            className="w-full h-7 px-2 text-[11px] rounded-md border border-border bg-background text-foreground focus:outline-none focus:border-purple-500"
            value={filters.sector}
            onChange={(e) => setFilters((f) => ({ ...f, sector: e.target.value }))}
          >
            <option value="">جميع القطاعات ({sectors.length})</option>
            {sectors.map((sec) => (
              <option key={sec} value={sec}>
                {sec}
              </option>
            ))}
          </select>
        </div>

        {/* مؤشر RSI الفني والجاهز */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>مؤشر RSI الفني:</span>
            <span className="text-foreground font-semibold" dir="ltr">
              {filters.rsiMin.toFixed(0)} — {filters.rsiMax.toFixed(0)}
            </span>
          </div>
          <div className="flex gap-1">
            {[
              { id: 'all', label: 'الكل' },
              { id: 'oversold', label: 'تشبع بيعي (<35)' },
              { id: 'momentum', label: 'زخم (50-70)' },
              { id: 'overbought', label: 'تشبع شرائي (>65)' },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    rsiPreset: preset.id as any,
                    rsiMin: preset.id === 'oversold' ? 0 : preset.id === 'momentum' ? 50 : 0,
                    rsiMax: preset.id === 'oversold' ? 35 : preset.id === 'momentum' ? 70 : 100,
                  }))
                }
                className={`flex-1 py-1 text-[9px] font-bold rounded border transition-all ${
                  filters.rsiPreset === preset.id
                    ? 'bg-purple-600 text-white border-purple-400'
                    : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Slider
            value={[filters.rsiMin, filters.rsiMax]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => setFilters((f) => ({ ...f, rsiMin: v[0], rsiMax: v[1], rsiPreset: 'all' }))}
            className="mt-2"
          />
        </div>

        {/* مضاعف الربحية P/E Valuation */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>مضاعف الربحية (P/E Ratio):</span>
            <span className="text-foreground font-semibold" dir="ltr">
              {filters.pePreset === 'undervalued' ? '< 12' : filters.pePreset === 'fair' ? '12 - 25' : 'الكل'}
            </span>
          </div>
          <div className="flex gap-1">
            {[
              { id: 'all', label: 'الكل' },
              { id: 'undervalued', label: 'رخيص (<12)' },
              { id: 'fair', label: 'عادل (12-25)' },
              { id: 'growth', label: 'نمو (>25)' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setFilters((f) => ({ ...f, pePreset: p.id as any }))}
                className={`flex-1 py-1 text-[9px] font-bold rounded border transition-all ${
                  filters.pePreset === p.id
                    ? 'bg-emerald-600 text-white border-emerald-400'
                    : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* نطاق السعر */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">
            السعر (EGP):{' '}
            <span className="text-foreground font-semibold" dir="ltr">
              {filters.priceMin.toFixed(0)} — {filters.priceMax.toFixed(0)}
            </span>
          </label>
          <Slider
            value={[filters.priceMin, filters.priceMax]}
            min={0}
            max={1000}
            step={1}
            onValueChange={(v) => setFilters((f) => ({ ...f, priceMin: v[0], priceMax: v[1] }))}
            className="mt-2"
          />
        </div>

        {/* نطاق التغير % */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">
            التغير اليومي %:{' '}
            <span className="text-foreground font-semibold" dir="ltr">
              {filters.changeMin.toFixed(0)}% — {filters.changeMax.toFixed(0)}%
            </span>
          </label>
          <Slider
            value={[filters.changeMin, filters.changeMax]}
            min={-20}
            max={20}
            step={0.5}
            onValueChange={(v) => setFilters((f) => ({ ...f, changeMin: v[0], changeMax: v[1] }))}
            className="mt-2"
          />
        </div>

        {/* الحد الأدنى للحجم */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">
            أدنى حجم تداول:{' '}
            <span className="text-foreground font-semibold" dir="ltr">
              {formatVolume(filters.volumeMin)}
            </span>
          </label>
          <Slider
            value={[filters.volumeMin]}
            min={0}
            max={10_000_000}
            step={100_000}
            onValueChange={(v) => setFilters((f) => ({ ...f, volumeMin: v[0] }))}
            className="mt-2"
          />
        </div>

        <div className="pt-2 border-t border-border flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">نتائج البحث:</span>
          <Badge variant="default" className="bg-purple-600 font-bold text-white text-[11px] px-2 py-0.5">
            {filtered.length} سهم من أصل {stocks.length}
          </Badge>
        </div>
      </div>

      {/* جدول النتائج */}
      <div className="flex-1 min-w-0">
        <ScrollArea className="h-full max-h-72">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] h-8">الرمز</TableHead>
                <TableHead className="text-[10px] h-8 hidden sm:table-cell">الاسم</TableHead>
                <TableHead className="text-[10px] h-8 hidden md:table-cell">القطاع</TableHead>
                <TableHead className="text-[10px] h-8 text-left">السعر</TableHead>
                <TableHead className="text-[10px] h-8 text-center">التغير%</TableHead>
                <TableHead className="text-[10px] h-8 text-left hidden lg:table-cell">الحجم</TableHead>
                <TableHead className="text-[10px] h-8 text-center hidden lg:table-cell">RSI</TableHead>
                <TableHead className="text-[10px] h-8 text-center">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">
                    <AlertCircle className="w-4 h-4 mx-auto mb-1 opacity-50" />
                    لا توجد نتائج مطابقة للفلاتر
                  </TableCell>
                </TableRow>
              ) : (
                filtered.slice(0, 50).map(s => {
                  const isUp = (s.price_change ?? 0) >= 0;
                  const rsi = s._rsi;
                  return (
                    <TableRow
                      key={s.ticker}
                      className="cursor-pointer hover:bg-muted/40 h-8"
                      onClick={() => onSelectTicker(s.ticker)}
                    >
                      <TableCell className="text-xs font-bold py-1">{s.ticker}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden sm:table-cell py-1 max-w-[120px] truncate">
                        {s.name_ar || s.name}
                      </TableCell>
                      <TableCell className="text-[10px] hidden md:table-cell py-1">
                        {s.sector ? <Badge variant="outline" className="text-[8px] px-1 py-0">{s.sector}</Badge> : '—'}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-left py-1" dir="ltr">
                        {formatPrice(s.current_price ?? 0)}
                      </TableCell>
                      <TableCell className="text-center py-1">
                        <span className={cn(
                          'text-[10px] font-semibold inline-flex items-center gap-0.5',
                          isUp ? 'text-emerald-600' : 'text-rose-600'
                        )} dir="ltr">
                          {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                          {(s.price_change ?? 0).toFixed(2)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-[10px] tabular-nums text-left hidden lg:table-cell py-1" dir="ltr">
                        {formatVolume(s.volume ?? 0)}
                      </TableCell>
                      <TableCell className="text-center py-1">
                        {rsi !== null ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[9px] px-1 py-0',
                              rsi >= 70 ? 'border-rose-500 text-rose-600' :
                              rsi <= 30 ? 'border-emerald-500 text-emerald-600' :
                              'text-muted-foreground'
                            )}
                          >
                            {rsi.toFixed(0)}
                          </Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-center py-1">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[9px] text-emerald-600 hover:text-emerald-700"
                            onClick={(e) => { e.stopPropagation(); onAddToChart(s.ticker); }}
                          >
                            + شارت
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-6 h-6 text-muted-foreground hover:text-foreground"
                            onClick={(e) => { e.stopPropagation(); onOpenDetail(s.ticker); }}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  );
}

// ─── تبويب: التفاصيل (Details) ────────────────────────────────────────────

function DetailsTab({ ticker }: { ticker: string | null }) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/stocks/${ticker}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          // شكل البيانات يمكن أن يكون json.stock أو json.data أو json مباشرة
          const d = json.stock || json.data || json;
          setDetail({ ticker, ...d });
        } else {
          throw new Error(json.error || 'فشل التحميل');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'خطأ غير معروف');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [ticker]);

  if (!ticker) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Info className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs">اختر سهمًا من الشاشة أو قائمة المراقبة لعرض التفاصيل</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-destructive">
        <AlertCircle className="w-6 h-6 mb-2 opacity-50" />
        <p className="text-xs">{error}</p>
      </div>
    );
  }

  if (!detail) return null;

  const isUp = (detail.price_change ?? 0) >= 0;

  const rows: { label: string; value: string; dir?: 'ltr' | 'rtl'; tone?: 'up' | 'down' | 'neutral' }[] = [
    { label: 'السعر الحالي', value: formatPrice(detail.current_price ?? null), dir: 'ltr', tone: 'neutral' },
    { label: 'التغير %', value: `${(detail.price_change ?? 0).toFixed(2)}%`, dir: 'ltr', tone: isUp ? 'up' : 'down' },
    { label: 'الافتتاح', value: formatPrice(detail.open ?? null), dir: 'ltr' },
    { label: 'الأعلى', value: formatPrice(detail.high ?? null), dir: 'ltr', tone: 'up' },
    { label: 'الأدنى', value: formatPrice(detail.low ?? null), dir: 'ltr', tone: 'down' },
    { label: 'الإغلاق السابق', value: formatPrice(detail.close ?? null), dir: 'ltr' },
    { label: 'القطاع', value: detail.sector || '—' },
    { label: 'الحجم', value: formatVolume(detail.volume ?? null), dir: 'ltr' },
    { label: 'القيمة السوقية', value: formatMarketCap(detail.market_cap ?? null), dir: 'ltr' },
    { label: 'P/E', value: detail.pe_ratio !== null && detail.pe_ratio !== undefined ? detail.pe_ratio.toFixed(2) : '—', dir: 'ltr' },
    { label: 'EPS', value: detail.eps !== null && detail.eps !== undefined ? detail.eps.toFixed(2) : '—', dir: 'ltr' },
    { label: 'أعلى 52 أسبوع', value: formatPrice(detail.high_52w ?? null), dir: 'ltr', tone: 'up' },
    { label: 'أدنى 52 أسبوع', value: formatPrice(detail.low_52w ?? null), dir: 'ltr', tone: 'down' },
  ];

  return (
    <div className="p-3">
      {/* رأس التفاصيل */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
        <h3 className="font-bold text-sm text-foreground">
          {detail.name_ar || detail.name || ticker}
        </h3>
        <Badge variant="outline" className="text-[10px]">{ticker}</Badge>
        {detail.sector && (
          <Badge variant="secondary" className="text-[9px]">{detail.sector}</Badge>
        )}
      </div>

      {/* شبكة التفاصيل */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {rows.map((r, i) => (
          <div key={i} className="border border-border rounded-md p-2 bg-muted/10">
            <div className="text-[9px] text-muted-foreground mb-0.5">{r.label}</div>
            <div
              className={cn(
                'text-sm font-bold tabular-nums',
                r.tone === 'up' && 'text-emerald-600',
                r.tone === 'down' && 'text-rose-600',
                (!r.tone || r.tone === 'neutral') && 'text-foreground'
              )}
              dir={r.dir || 'rtl'}
            >
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── تبويب: الأخبار (News) ────────────────────────────────────────────────

function NewsTab({ ticker }: { ticker: string | null }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) {
      setNews([]);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/stocks/${ticker}/news?limit=20`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        // شكل محتمل: json.news / json.data / json.items / json مباشرة كمصفوفة
        const items: NewsItem[] =
          json.news || json.data || json.items ||
          (Array.isArray(json) ? json : []);
        setNews(items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'خطأ غير معروف');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [ticker]);

  if (!ticker) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Newspaper className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs">اختر سهمًا لعرض آخر أخباره</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-destructive">
        <AlertCircle className="w-6 h-6 mb-2 opacity-50" />
        <p className="text-xs">{error}</p>
      </div>
    );
  }

  if (news.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Newspaper className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs">لا توجد أخبار متاحة لهذا السهم</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full max-h-72">
      <div className="divide-y divide-border">
        {news.map((item, i) => {
          const date = item.timestamp
            ? new Date(typeof item.timestamp === 'number'
                ? item.timestamp * 1000
                : item.timestamp).toLocaleDateString('ar-EG', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                })
            : item.date || '';
          return (
            <a
              key={i}
              href={item.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-2.5 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-start gap-2">
                <Newspaper className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-semibold text-foreground line-clamp-2 mb-0.5">
                    {item.title || 'بدون عنوان'}
                  </h4>
                  {item.summary && (
                    <p className="text-[10px] text-muted-foreground line-clamp-2">
                      {item.summary}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {item.source && (
                      <Badge variant="outline" className="text-[8px] px-1 py-0">
                        {item.source}
                      </Badge>
                    )}
                    {date && (
                      <span className="text-[9px] text-muted-foreground">{date}</span>
                    )}
                  </div>
                </div>
                {item.url && (
                  <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 mt-1" />
                )}
              </div>
            </a>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ─── المكوّن الرئيسي ──────────────────────────────────────────────────────

export function BottomPanel({
  stocks,
  selectedTicker,
  onSelectTicker,
  onAddToChart,
  onOpenDetail,
}: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState('screener');
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Card className="border border-border bg-card overflow-hidden flex flex-col">
      {/* رأس اللوحة */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/20">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <TabsList className="bg-transparent p-0 h-7 gap-1">
            <TabsTrigger
              value="screener"
              className="text-[11px] h-6 px-2.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <Filter className="w-3 h-3 ml-1" />
              المسح
            </TabsTrigger>
            <TabsTrigger
              value="details"
              className="text-[11px] h-6 px-2.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <Info className="w-3 h-3 ml-1" />
              التفاصيل
              {selectedTicker && (
                <Badge variant="secondary" className="text-[8px] px-1 py-0 mr-1">
                  {selectedTicker}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="news"
              className="text-[11px] h-6 px-2.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <Newspaper className="w-3 h-3 ml-1" />
              الأخبار
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2"
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? 'توسيع' : 'طي'}
        </Button>
      </div>

      {/* محتوى التبويبات */}
      {!collapsed && (
        <div className="h-72 md:h-64">
          {activeTab === 'screener' && (
            <ScreenerTab
              stocks={stocks}
              onSelectTicker={onSelectTicker}
              onAddToChart={onAddToChart}
              onOpenDetail={onOpenDetail}
            />
          )}
          {activeTab === 'details' && <DetailsTab ticker={selectedTicker} />}
          {activeTab === 'news' && <NewsTab ticker={selectedTicker} />}
        </div>
      )}
    </Card>
  );
}

export default BottomPanel;

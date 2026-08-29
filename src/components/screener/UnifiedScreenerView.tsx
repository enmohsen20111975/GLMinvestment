'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  RefreshCw, Download, Filter, Search, AlertTriangle,
  TrendingUp, TrendingDown, Zap, ChevronUp, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScreenerStock {
  ticker: string; name: string; name_ar: string; market: string; sector: string;
  current_price: number; change_percent: number; volume: number;
  market_cap: number; pe_ratio: number | null; roe: number | null;
  dividend_yield: number | null; ma_50: number | null; ma_200: number | null;
  rsi: number | null; trend: string; signal: number | null; beta: number | null;
  high_52w: number | null; low_52w: number | null; avg_volume: number;
  turnover_egp: number; volume_surge: boolean; above_ma_50: boolean;
  above_ma_200: boolean; distance_from_52w_high: number | null;
  distance_from_52w_low: number | null;
}

interface ScreenerResponse {
  success: boolean; stocks: ScreenerStock[]; total: number; sectors: string[];
  summary: { total: number; advancers: number; decliners: number; avg_change: number;
            total_turnover: number; volume_surge_count: number; };
  error?: string; hint?: string;
}

interface TopPerformerStock {
  ticker: string; name: string; name_ar: string | null; sector: string | null;
  market: string; start_price: number; end_price: number; change_pct: number;
  period_days: number; start_volume: number; end_volume: number;
}

interface TopPerformersResponse {
  success: boolean; period: string; direction: string; results: TopPerformerStock[];
  summary: { total_stocks: number; gainers: number; losers: number; avg_change: number;
             best_performer: TopPerformerStock | null; worst_performer: TopPerformerStock | null; };
  error?: string; hint?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dec = 2): string {
  if (n === null || n === undefined || isNaN(n as number)) return '—';
  return (n as number).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function chgColor(c: number): string {
  if (c > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (c < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

type SortField = 'ticker' | 'change_percent' | 'volume' | 'market_cap' | 'pe_ratio' |
                 'roe' | 'rsi' | 'turnover_egp' | 'dividend_yield' | 'high_52w' | 'current_price';

const PERIODS = [
  { value: '1d', label: 'يوم' }, { value: '7d', label: 'أسبوع' },
  { value: '15d', label: '15 يوم' }, { value: '1m', label: 'شهر' },
  { value: '3m', label: '3 شهور' }, { value: '6m', label: '6 شهور' },
  { value: 'YTD', label: 'من أول السنة' }, { value: '1y', label: 'عام' },
];

// ─── Advanced Screener Tab ────────────────────────────────────────────────────

function AdvancedScreenerTab() {
  const [market, setMarket] = useState('EGX');
  const [sector, setSector] = useState('ALL');
  const [sortBy, setSortBy] = useState<SortField>('turnover_egp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState(100);
  const [search, setSearch] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minTurnover, setMinTurnover] = useState('');
  const [trendFilter, setTrendFilter] = useState('all');
  const [aboveMa, setAboveMa] = useState('all');
  const [rsiOversold, setRsiOversold] = useState(false);
  const [rsiOverbought, setRsiOverbought] = useState(false);
  const [volumeSurge, setVolumeSurge] = useState(false);
  const [nearHigh, setNearHigh] = useState(false);
  const [nearLow, setNearLow] = useState(false);

  const [data, setData] = useState<ScreenerResponse | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ market, sort: sortBy, order: sortOrder, limit: String(limit) });
      if (sector !== 'ALL') p.set('sector', sector);
      if (minPrice) p.set('min_price', minPrice);
      if (maxPrice) p.set('max_price', maxPrice);
      if (minTurnover) p.set('min_turnover', minTurnover);
      if (trendFilter !== 'all') p.set('trend', trendFilter);
      if (aboveMa !== 'all') p.set('above_ma', aboveMa);
      if (rsiOversold) p.set('rsi_oversold', '1');
      if (rsiOverbought) p.set('rsi_overbought', '1');
      if (volumeSurge) p.set('volume_surge', '1');
      if (nearHigh) p.set('near_52w_high', '1');
      if (nearLow) p.set('near_52w_low', '1');

      const res = await fetch(`/api/screener/advanced?${p}`, { cache: 'no-store' });
      const json: ScreenerResponse = await res.json();
      if (json.success) { setData(json); setSectors(json.sectors || []); }
      else setError(json.error || json.hint || 'فشل تحميل البيانات');
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ في الاتصال'); }
    finally { setLoading(false); }
  }, [market, sector, sortBy, sortOrder, limit, minPrice, maxPrice, minTurnover,
        trendFilter, aboveMa, rsiOversold, rsiOverbought, volumeSurge, nearHigh, nearLow]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!data?.stocks) return [];
    if (!search.trim()) return data.stocks;
    const q = search.toUpperCase();
    return data.stocks.filter(s => s.ticker.includes(q) || s.name.toUpperCase().includes(q) || s.name_ar.includes(search));
  }, [data, search]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) setSortOrder(o => o === 'desc' ? 'asc' : 'desc');
    else { setSortBy(field); setSortOrder('desc'); }
  };

  const SortHead = ({ field, label, cls }: { field: SortField; label: string; cls?: string }) => (
    <TableHead className={cn('text-right cursor-pointer hover:bg-muted/50 select-none', cls)} onClick={() => handleSort(field)}>
      <span className="inline-flex items-center gap-1">{label}
        {sortBy === field && <span className="text-[10px]">{sortOrder === 'desc' ? '▼' : '▲'}</span>}
      </span>
    </TableHead>
  );

  const exportCSV = () => {
    if (!filtered.length) return;
    const headers = ['Ticker','Name','Sector','Price','Change%','Volume','Turnover','MarketCap','PE','ROE','Dividend%','RSI','MA50','MA200','52wHigh','52wLow','DistHigh%','VolSurge'];
    const rows = filtered.map(s => [s.ticker,s.name,s.sector,s.current_price,s.change_percent,s.volume,s.turnover_egp,s.market_cap,s.pe_ratio,s.roe,s.dividend_yield,s.rsi,s.ma_50,s.ma_200,s.high_52w,s.low_52w,s.distance_from_52w_high,s.volume_surge]);
    const csv = [headers,...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `screener_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const activeFilters = [sector !== 'ALL', minPrice, maxPrice, minTurnover, trendFilter !== 'all',
    aboveMa !== 'all', rsiOversold, rsiOverbought, volumeSurge, nearHigh, nearLow].filter(Boolean).length;

  if (loading && !data) return <div className="p-8 text-center text-muted-foreground"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />جاري تحميل الأسهم...</div>;
  if (error) return <Card className="border-rose-500/30"><CardContent className="p-4 text-center"><AlertTriangle className="w-6 h-6 mx-auto mb-2 text-rose-500" /><div className="text-sm text-rose-700">{error}</div><Button variant="outline" size="sm" onClick={fetchData} className="mt-3"><RefreshCw className="w-3.5 h-3.5 mr-1" />إعادة</Button></CardContent></Card>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      {/* Filters bar */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div><Label className="text-[10px]">السوق</Label><Select value={market} onValueChange={setMarket}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EGX">مصر</SelectItem><SelectItem value="ALL">الكل</SelectItem></SelectContent></Select></div>
            <div><Label className="text-[10px]">القطاع</Label><Select value={sector} onValueChange={v => setSector(v === 'ALL' ? 'ALL' : v)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">كل القطاعات</SelectItem>{sectors.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[10px]">ترتيب</Label><Select value={sortBy} onValueChange={(v) => setSortBy(v as SortField)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="turnover_egp">التداول</SelectItem><SelectItem value="change_percent">التغير</SelectItem><SelectItem value="volume">الحجم</SelectItem><SelectItem value="market_cap">القيمة السوقية</SelectItem><SelectItem value="pe_ratio">P/E</SelectItem><SelectItem value="roe">ROE</SelectItem><SelectItem value="rsi">RSI</SelectItem><SelectItem value="dividend_yield">التوزيع</SelectItem><SelectItem value="current_price">السعر</SelectItem></SelectContent></Select></div>
            <div><Label className="text-[10px]">حد</Label><Select value={String(limit)} onValueChange={v => setLimit(Number(v))}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem><SelectItem value="200">200</SelectItem><SelectItem value="500">500</SelectItem></SelectContent></Select></div>
            <div><Label className="text-[10px]">سعر من</Label><Input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} className="h-8 text-xs" placeholder="0" /></div>
            <div><Label className="text-[10px]">سعر إلى</Label><Input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} className="h-8 text-xs" placeholder="∞" /></div>
          </div>
          {/* Toggle filters */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button onClick={() => setTrendFilter(trendFilter === 'up' ? 'all' : 'up')} className={cn('px-2 py-1 rounded text-[10px] border', trendFilter === 'up' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-muted/30 text-muted-foreground')}>صاعد</button>
            <button onClick={() => setTrendFilter(trendFilter === 'down' ? 'all' : 'down')} className={cn('px-2 py-1 rounded text-[10px] border', trendFilter === 'down' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-muted/30 text-muted-foreground')}>هابط</button>
            <button onClick={() => setAboveMa(aboveMa === '50' ? 'all' : '50')} className={cn('px-2 py-1 rounded text-[10px] border', aboveMa === '50' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-muted/30 text-muted-foreground')}>فوق MA50</button>
            <button onClick={() => setAboveMa(aboveMa === '200' ? 'all' : '200')} className={cn('px-2 py-1 rounded text-[10px] border', aboveMa === '200' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-muted/30 text-muted-foreground')}>فوق MA200</button>
            <button onClick={() => setRsiOversold(!rsiOversold)} className={cn('px-2 py-1 rounded text-[10px] border', rsiOversold ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-muted/30 text-muted-foreground')}>RSI&lt;30</button>
            <button onClick={() => setRsiOverbought(!rsiOverbought)} className={cn('px-2 py-1 rounded text-[10px] border', rsiOverbought ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-muted/30 text-muted-foreground')}>RSI&gt;70</button>
            <button onClick={() => setVolumeSurge(!volumeSurge)} className={cn('px-2 py-1 rounded text-[10px] border flex items-center gap-0.5', volumeSurge ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-muted/30 text-muted-foreground')}><Zap className="w-2.5 h-2.5" />انفجار سيولة</button>
            <button onClick={() => setNearHigh(!nearHigh)} className={cn('px-2 py-1 rounded text-[10px] border', nearHigh ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-muted/30 text-muted-foreground')}>قرب القمة</button>
            <button onClick={() => setNearLow(!nearLow)} className={cn('px-2 py-1 rounded text-[10px] border', nearLow ? 'bg-red-50 border-red-200 text-red-700' : 'bg-muted/30 text-muted-foreground')}>قرب القاع</button>
          </div>
          {/* Search + actions */}
          <div className="flex gap-2 mt-2">
            <div className="relative flex-1"><Search className="absolute right-2 top-2 w-4 h-4 text-muted-foreground" /><Input placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)} className="pr-8 h-8 text-xs" /></div>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length} className="h-8 text-xs gap-1"><Download className="w-3 h-3" />CSV</Button>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="h-8 text-xs gap-1"><RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />تحديث</Button>
          </div>
          {activeFilters > 0 && <div className="mt-1"><Badge variant="secondary" className="text-[10px]">{activeFilters} فلتر نشط</Badge></div>}
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-2">
        <Card><CardContent className="p-2"><div className="text-[10px] text-muted-foreground">النتائج</div><div className="text-base font-bold">{filtered.length}</div></CardContent></Card>
        <Card><CardContent className="p-2"><div className="text-[10px] text-muted-foreground flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5 text-emerald-500" />صاعد</div><div className="text-base font-bold text-emerald-600">{filtered.filter(s => s.change_percent > 0).length}</div></CardContent></Card>
        <Card><CardContent className="p-2"><div className="text-[10px] text-muted-foreground flex items-center gap-1"><TrendingDown className="w-2.5 h-2.5 text-red-500" />هابط</div><div className="text-base font-bold text-red-600">{filtered.filter(s => s.change_percent < 0).length}</div></CardContent></Card>
        <Card><CardContent className="p-2"><div className="text-[10px] text-muted-foreground flex items-center gap-1"><Zap className="w-2.5 h-2.5 text-amber-500" />سيولة</div><div className="text-base font-bold text-amber-600">{filtered.filter(s => s.volume_surge).length}</div></CardContent></Card>
      </div>

      {/* Table */}
      <Card><CardContent className="p-0">
        <div className="max-h-[600px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <SortHead field="ticker" label="السهم" />
                <SortHead field="current_price" label="السعر" cls="w-20" />
                <SortHead field="change_percent" label="التغير" cls="w-20" />
                <SortHead field="volume" label="الحجم" cls="w-20" />
                <SortHead field="turnover_egp" label="التداول" cls="w-24" />
                <SortHead field="market_cap" label="قيمة سوقية" cls="w-24" />
                <SortHead field="pe_ratio" label="P/E" cls="w-16" />
                <SortHead field="roe" label="ROE" cls="w-16" />
                <SortHead field="dividend_yield" label="توزيع" cls="w-16" />
                <SortHead field="rsi" label="RSI" cls="w-16" />
                <TableHead className="text-right w-20">MA</TableHead>
                <TableHead className="text-right w-20">52w</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">لا توجد نتائج</TableCell></TableRow>
              ) : filtered.map(s => (
                <TableRow key={s.ticker} className="hover:bg-muted/50">
                  <TableCell>
                    <div className="font-mono font-bold text-xs">{s.ticker}</div>
                    <div className="text-[10px] text-muted-foreground truncate max-w-[120px]">{s.name_ar || s.name}</div>
                    <div className="text-[10px] text-muted-foreground">{s.sector}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{fmt(s.current_price)}</TableCell>
                  <TableCell className={cn('font-mono text-xs font-bold', chgColor(s.change_percent))}>{s.change_percent > 0 ? '+' : ''}{fmt(s.change_percent)}%</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{fmtVol(s.volume)}{s.volume_surge && <Zap className="inline w-2.5 h-2.5 text-amber-500 ml-0.5" />}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{fmtVol(s.turnover_egp)}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{fmtVol(s.market_cap)}</TableCell>
                  <TableCell className="font-mono text-xs">{s.pe_ratio !== null ? fmt(s.pe_ratio, 1) : '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{s.roe !== null ? fmt(s.roe, 1) : '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{s.dividend_yield !== null ? fmt(s.dividend_yield, 1) : '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{s.rsi !== null ? fmt(s.rsi, 0) : '—'}</TableCell>
                  <TableCell><div className="flex gap-0.5"><Badge variant={s.above_ma_50 ? 'default' : 'outline'} className="text-[8px] px-1">50</Badge><Badge variant={s.above_ma_200 ? 'default' : 'outline'} className="text-[8px] px-1">200</Badge></div></TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{s.distance_from_52w_high !== null ? `${fmt(s.distance_from_52w_high, 0)}%` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent></Card>
    </div>
  );
}

// ─── Top Performers Tab ──────────────────────────────────────────────────────

function TopPerformersTab() {
  const [period, setPeriod] = useState('1m');
  const [direction, setDirection] = useState('both');
  const [limit, setLimit] = useState(20);
  const [data, setData] = useState<TopPerformersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ period, direction, market: 'EGX', limit: String(limit) });
      const res = await fetch(`/api/stocks/top-performers?${p}`, { cache: 'no-store' });
      const json: TopPerformersResponse = await res.json();
      if (json.success) setData(json); else setError(json.error || json.hint || 'فشل');
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
  }, [period, direction, limit]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading && !data) return <div className="p-8 text-center text-muted-foreground"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />جاري تحميل...</div>;
  if (error) return <Card className="border-rose-500/30"><CardContent className="p-4 text-center"><AlertTriangle className="w-6 h-6 mx-auto mb-2 text-rose-500" /><div className="text-sm text-rose-700">{error}</div><Button variant="outline" size="sm" onClick={fetchData} className="mt-3"><RefreshCw className="w-3.5 h-3.5 mr-1" />إعادة</Button></CardContent></Card>;
  if (!data) return null;

  const results = data.results || [];
  const summary = data.summary;

  return (
    <div className="space-y-3">
      {/* Period + direction selectors */}
      <Card><CardContent className="p-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div><Label className="text-[10px]">الفترة</Label><Select value={period} onValueChange={setPeriod}><SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger><SelectContent>{PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-[10px]">النوع</Label><Select value={direction} onValueChange={setDirection}><SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="both">أعلى وأدنى</SelectItem><SelectItem value="gainers">أعلى الأرباح</SelectItem><SelectItem value="losers">أعلى الخسائر</SelectItem></SelectContent></Select></div>
          <div><Label className="text-[10px]">عدد</Label><Select value={String(limit)} onValueChange={v => setLimit(Number(v))}><SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="10">10</SelectItem><SelectItem value="20">20</SelectItem><SelectItem value="50">50</SelectItem></SelectContent></Select></div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="h-8 text-xs gap-1"><RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />تحديث</Button>
        </div>
      </CardContent></Card>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2">
        <Card><CardContent className="p-2"><div className="text-[10px] text-muted-foreground">الإجمالي</div><div className="text-base font-bold">{summary.total_stocks}</div></CardContent></Card>
        <Card><CardContent className="p-2"><div className="text-[10px] text-muted-foreground flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5 text-emerald-500" />رابح</div><div className="text-base font-bold text-emerald-600">{summary.gainers}</div></CardContent></Card>
        <Card><CardContent className="p-2"><div className="text-[10px] text-muted-foreground flex items-center gap-1"><TrendingDown className="w-2.5 h-2.5 text-red-500" />خاسر</div><div className="text-base font-bold text-red-600">{summary.losers}</div></CardContent></Card>
        <Card><CardContent className="p-2"><div className="text-[10px] text-muted-foreground">متوسط</div><div className={cn('text-base font-bold font-mono', summary.avg_change >= 0 ? 'text-emerald-600' : 'text-red-600')}>{summary.avg_change >= 0 ? '+' : ''}{summary.avg_change}%</div></CardContent></Card>
      </div>

      {/* Best + Worst */}
      {(summary.best_performer || summary.worst_performer) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {summary.best_performer && (
            <Card className="border-emerald-500/30 bg-emerald-500/5"><CardContent className="p-2">
              <div className="flex items-center justify-between"><div><div className="font-mono font-bold text-sm">{summary.best_performer.ticker}</div><div className="text-[10px] text-muted-foreground truncate max-w-[150px]">{summary.best_performer.name_ar || summary.best_performer.name}</div></div>
              <div className="text-emerald-600 font-mono font-bold text-lg">+{summary.best_performer.change_pct}%</div></div>
            </CardContent></Card>
          )}
          {summary.worst_performer && (
            <Card className="border-red-500/30 bg-red-500/5"><CardContent className="p-2">
              <div className="flex items-center justify-between"><div><div className="font-mono font-bold text-sm">{summary.worst_performer.ticker}</div><div className="text-[10px] text-muted-foreground truncate max-w-[150px]">{summary.worst_performer.name_ar || summary.worst_performer.name}</div></div>
              <div className="text-red-600 font-mono font-bold text-lg">{summary.worst_performer.change_pct}%</div></div>
            </CardContent></Card>
          )}
        </div>
      )}

      {/* Table */}
      <Card><CardContent className="p-0">
        <div className="max-h-[600px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10"><TableRow>
              <TableHead className="text-right">السهم</TableHead><TableHead className="text-right w-20">سعر بداية</TableHead>
              <TableHead className="text-right w-20">سعر نهاية</TableHead><TableHead className="text-right w-20">التغير</TableHead>
              <TableHead className="text-right w-16">أيام</TableHead><TableHead className="text-right w-20">حجم</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {results.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">لا توجد نتائج</TableCell></TableRow> :
              results.map(s => (
                <TableRow key={`${s.ticker}-${s.start_date}`} className="hover:bg-muted/50">
                  <TableCell><div className="font-mono font-bold text-xs">{s.ticker}</div><div className="text-[10px] text-muted-foreground truncate max-w-[150px]">{s.name_ar || s.name}</div>{s.sector && <div className="text-[10px] text-muted-foreground">{s.sector}</div>}</TableCell>
                  <TableCell className="font-mono text-xs">{fmt(s.start_price)}</TableCell>
                  <TableCell className="font-mono text-xs">{fmt(s.end_price)}</TableCell>
                  <TableCell className={cn('font-mono text-xs font-bold', chgColor(s.change_pct))}>{s.change_pct >= 0 ? '+' : ''}{fmt(s.change_pct)}%</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{s.period_days}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{fmtVol(s.end_volume)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent></Card>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function UnifiedScreenerView() {
  return (
    <div className="space-y-3 p-3 md:p-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Filter className="w-4 h-4 text-emerald-600" />ماسح الأسهم</h1>
          <p className="text-xs text-muted-foreground mt-0.5">فلترة الأسهم بمعايير متقدمة + أعلى الأرباح/الخسائر في فترات متعددة</p>
        </div>
      </div>
      <Tabs defaultValue="screener" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="screener" className="text-xs gap-1"><Filter className="w-3 h-3" />فلترة بالمعايير</TabsTrigger>
          <TabsTrigger value="performers" className="text-xs gap-1"><TrendingUp className="w-3 h-3" />أعلى الأرباح/الخسائر</TabsTrigger>
        </TabsList>
        <TabsContent value="screener" className="mt-3"><AdvancedScreenerTab /></TabsContent>
        <TabsContent value="performers" className="mt-3"><TopPerformersTab /></TabsContent>
      </Tabs>
    </div>
  );
}

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Download,
  Filter,
  Zap,
  Target,
  Thermometer,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScreenerStock {
  ticker: string;
  name: string;
  name_ar: string;
  market: string;
  sector: string;
  current_price: number;
  change_percent: number;
  volume: number;
  market_cap: number;
  pe_ratio: number | null;
  roe: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi: number | null;
  trend: string | null;
  signal: number | null;
  beta: number | null;
  high_52w: number | null;
  low_52w: number | null;
  above_ma_50: boolean;
  above_ma_200: boolean;
  distance_from_52w_high: number | null;
  distance_from_52w_low: number | null;
  momentum_score: number;
  correction_status: string;
  volume_surge: boolean;
}

interface ScreenerResponse {
  success: boolean;
  data: ScreenerStock[];
  total: number;
  sectors: string[];
  filters?: Record<string, unknown>;
  error?: string;
}

// ─── Correction Status Helpers ───────────────────────────────────────────────

const CORRECTION_STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  in_correction: { label: 'في تصحيح', color: 'text-red-600 bg-red-50 dark:bg-red-950', icon: '📉' },
  pulling_back: { label: 'يرتد', color: 'text-orange-600 bg-orange-50 dark:bg-orange-950', icon: '↩️' },
  neutral: { label: 'محايد', color: 'text-gray-600 bg-gray-50 dark:bg-gray-800', icon: '➡️' },
  near_high: { label: 'قرب القمة', color: 'text-blue-600 bg-blue-50 dark:bg-blue-950', icon: '🎯' },
  breakout: { label: 'اختراق', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950', icon: '🚀' },
  overbought: { label: 'تشبع شرائي', color: 'text-purple-600 bg-purple-50 dark:bg-purple-950', icon: '🔥' },
  oversold: { label: 'تشبع بيعي', color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950', icon: '❄️' },
};

function getCorrectionBadge(status: string) {
  const config = CORRECTION_STATUS_MAP[status] || CORRECTION_STATUS_MAP.neutral;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', config.color)}>
      <span>{config.icon}</span>
      {config.label}
    </span>
  );
}

// ─── Mini Sparkline (real price data) ────────────────────────────────────────

interface SparklineData {
  prices: number[];
  change_pct: number;
}

function MiniSparkline({ ticker }: { ticker: string }) {
  const [data, setData] = useState<SparklineData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stocks/sparkline?ticker=${encodeURIComponent(ticker)}&days=30`)
      .then(res => res.json())
      .then(json => {
        if (!cancelled && json.success && json.prices?.length > 1) {
          setData({ prices: json.prices, change_pct: json.change_pct });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) return <div className="w-20 h-8 bg-muted/30 animate-pulse rounded" />;
  if (!data) return <span className="text-xs text-muted-foreground">—</span>;

  const max = Math.max(...data.prices);
  const min = Math.min(...data.prices);
  const range = max - min || 1;
  const points = data.prices.map((p, i) => {
    const x = (i / (data.prices.length - 1)) * 80;
    const y = 20 - ((p - min) / range) * 18;
    return `${x},${y}`;
  }).join(' ');

  const isUp = data.change_pct >= 0;
  const color = isUp ? '#10b981' : '#ef4444';

  return (
    <div className="flex items-center gap-1">
      <svg width="80" height="20" className="overflow-visible">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={cn('text-xs font-mono', isUp ? 'text-emerald-600' : 'text-red-600')}>
        {isUp ? '+' : ''}{data.change_pct.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Sector Performance Comparison ──────────────────────────────────────────

function SectorComparison({ stockSector, stockChange }: { stockSector: string; stockChange: number }) {
  const [sectorAvg, setSectorAvg] = useState<number | null>(null);

  useEffect(() => {
    if (!stockSector) return;
    fetch(`/api/stocks/screener?market=EGX&sector=${encodeURIComponent(stockSector)}&limit=500&sort=change_percent&order=desc`)
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data?.length > 0) {
          const avg = json.data.reduce((s: number, r: ScreenerStock) => s + r.change_percent, 0) / json.data.length;
          setSectorAvg(avg);
        }
      })
      .catch(() => {});
  }, [stockSector]);

  if (sectorAvg === null) return <span className="text-xs text-muted-foreground">—</span>;
  const diff = stockChange - sectorAvg;
  const isOutperform = diff > 0;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">
        القطاع: <span className={sectorAvg >= 0 ? 'text-emerald-600 font-mono' : 'text-red-600 font-mono'}>
          {sectorAvg >= 0 ? '+' : ''}{sectorAvg.toFixed(2)}%
        </span>
      </span>
      <span className={cn('text-xs font-mono', isOutperform ? 'text-emerald-600' : 'text-red-600')}>
        {isOutperform ? '▲' : '▼'} {Math.abs(diff).toFixed(2)}% {isOutperform ? 'أقوى' : 'أضعف'}
      </span>
    </div>
  );
}

// ─── Format Helpers ──────────────────────────────────────────────────────────

function formatNumber(n: number | null, decimals = 2): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function getChangeColor(change: number): string {
  if (change > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (change < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function StockScreener() {
  // Filters state
  const [market, setMarket] = useState('EGX');
  const [sector, setSector] = useState('ALL');
  const [sort, setSort] = useState('change_percent');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState(100);
  const [trend, setTrend] = useState('all');
  const [aboveMa, setAboveMa] = useState('all');
  const [correctionStatus, setCorrectionStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Data state
  const [stocks, setStocks] = useState<ScreenerStock[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch screener data
  const fetchScreener = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        market,
        sort,
        order,
        limit: String(limit),
      });
      if (sector !== 'ALL') params.set('sector', sector);
      if (trend !== 'all') params.set('trend', trend);
      if (aboveMa !== 'all') params.set('above_ma', aboveMa);
      if (correctionStatus !== 'all') params.set('correction_status', correctionStatus);

      const res = await fetch(`/api/stocks/screener?${params}`);
      const json: ScreenerResponse = await res.json();

      if (json.success) {
        setStocks(json.data);
        setSectors(json.sectors || []);
      } else {
        setError(json.error || 'فشل تحميل البيانات');
        toast.error(json.error || 'فشل تحميل البيانات');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطأ في الاتصال';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [market, sector, sort, order, limit, trend, aboveMa, correctionStatus]);

  useEffect(() => {
    fetchScreener();
  }, [fetchScreener]);

  // Client-side search filter
  const filteredStocks = useMemo(() => {
    if (!searchQuery.trim()) return stocks;
    const q = searchQuery.toUpperCase();
    return stocks.filter(s =>
      s.ticker.includes(q) ||
      s.name.toUpperCase().includes(q) ||
      s.name_ar.includes(searchQuery)
    );
  }, [stocks, searchQuery]);

  // Export to CSV
  const exportCSV = () => {
    const headers = ['Ticker', 'Name', 'Sector', 'Price', 'Change%', 'Volume', 'RSI', 'Trend', 'CorrectionStatus', 'Momentum'];
    const rows = filteredStocks.map(s => [
      s.ticker, s.name, s.sector,
      s.current_price, s.change_percent, s.volume,
      s.rsi ?? '', s.trend ?? '', s.correction_status, s.momentum_score,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screener_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`تم تصدير ${filteredStocks.length} سهم`);
  };

  return (
    <div className="space-y-4 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-600" />
            ماسح الأسهم المتقدم
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            فرز الأسهم بفلاتر متقدمة — تصحيح، زخم، تشبع، مقارنة بالقطاع
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filteredStocks.length} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />
            تصدير CSV
          </Button>
          <Button variant="outline" size="sm" onClick={fetchScreener} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            تحديث
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            الفلاتر
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Market */}
            <div>
              <Label className="text-xs">السوق</Label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EGX">البورصة المصرية</SelectItem>
                  <SelectItem value="ALL">الكل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sector */}
            <div>
              <Label className="text-xs">القطاع</Label>
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">كل القطاعات</SelectItem>
                  {sectors.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sort */}
            <div>
              <Label className="text-xs">ترتيب بـ</Label>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="change_percent">نسبة التغير</SelectItem>
                  <SelectItem value="volume">الحجم</SelectItem>
                  <SelectItem value="momentum">الزخم</SelectItem>
                  <SelectItem value="rsi">RSI</SelectItem>
                  <SelectItem value="market_cap">القيمة السوقية</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Order */}
            <div>
              <Label className="text-xs">الاتجاه</Label>
              <Select value={order} onValueChange={(v) => setOrder(v as 'asc' | 'desc')}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">تنازلي (الأعلى أولاً)</SelectItem>
                  <SelectItem value="asc">تصاعدي (الأقل أولاً)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Trend */}
            <div>
              <Label className="text-xs">الاتجاه</Label>
              <Select value={trend} onValueChange={setTrend}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="up">صاعد فقط</SelectItem>
                  <SelectItem value="down">هابط فقط</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Above MA */}
            <div>
              <Label className="text-xs">فوق المتوسط</Label>
              <Select value={aboveMa} onValueChange={setAboveMa}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="50">فوق MA50</SelectItem>
                  <SelectItem value="200">فوق MA200</SelectItem>
                  <SelectItem value="both">فوق الاثنين</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Correction Status */}
            <div>
              <Label className="text-xs">حالة التصحيح</Label>
              <Select value={correctionStatus} onValueChange={setCorrectionStatus}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="in_correction">في تصحيح</SelectItem>
                  <SelectItem value="pulling_back">يرتد</SelectItem>
                  <SelectItem value="breakout">اختراق</SelectItem>
                  <SelectItem value="near_high">قرب القمة</SelectItem>
                  <SelectItem value="overbought">تشبع شرائي</SelectItem>
                  <SelectItem value="oversold">تشبع بيعي</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Limit */}
            <div>
              <Label className="text-xs">عدد النتائج</Label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Search */}
          <div className="mt-3">
            <div className="relative">
              <Search className="absolute right-2 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو الرمز..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-8 h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">إجمالي النتائج</div>
            <div className="text-xl font-bold">{filteredStocks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">صاعدة</div>
            <div className="text-xl font-bold text-emerald-600">
              {filteredStocks.filter(s => s.change_percent > 0).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">هابطة</div>
            <div className="text-xl font-bold text-red-600">
              {filteredStocks.filter(s => s.change_percent < 0).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">انفجار سيولة</div>
            <div className="text-xl font-bold text-amber-600">
              {filteredStocks.filter(s => s.volume_surge).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              جاري التحميل...
            </div>
          ) : error ? (
            <div className="p-8 text-center text-red-600">
              <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
              {error}
            </div>
          ) : filteredStocks.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
              لا توجد نتائج مطابقة
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-right">السهم</TableHead>
                    <TableHead className="text-right">السعر</TableHead>
                    <TableHead className="text-right">التغير</TableHead>
                    <TableHead className="text-right">الرسم البياني (30 يوم)</TableHead>
                    <TableHead className="text-right">الحجم</TableHead>
                    <TableHead className="text-right">RSI</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">الزخم</TableHead>
                    <TableHead className="text-right">من القمة</TableHead>
                    <TableHead className="text-right">مقارنة بالقطاع</TableHead>
                    <TableHead className="text-right">المتوسطات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStocks.map((s) => (
                    <TableRow key={s.ticker} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="font-mono font-bold text-sm">{s.ticker}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                          {s.name_ar || s.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.sector}</div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {formatNumber(s.current_price)}
                      </TableCell>
                      <TableCell className={cn('font-mono text-sm font-medium', getChangeColor(s.change_percent))}>
                        {s.change_percent > 0 ? '+' : ''}{formatNumber(s.change_percent)}%
                      </TableCell>
                      <TableCell>
                        <MiniSparkline ticker={s.ticker} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatVolume(s.volume)}
                        {s.volume_surge && <Zap className="inline w-3 h-3 text-amber-500 mr-1" />}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {s.rsi !== null ? formatNumber(s.rsi, 0) : '—'}
                      </TableCell>
                      <TableCell>
                        {getCorrectionBadge(s.correction_status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className={cn(
                            'font-mono text-xs font-bold',
                            s.momentum_score > 5 ? 'text-emerald-600' :
                            s.momentum_score < 0 ? 'text-red-600' : 'text-muted-foreground'
                          )}>
                            {s.momentum_score > 0 ? '+' : ''}{formatNumber(s.momentum_score, 1)}
                          </span>
                          {s.momentum_score > 5 && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                          {s.momentum_score < 0 && <TrendingDown className="w-3 h-3 text-red-500" />}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.distance_from_52w_high !== null
                          ? `${formatNumber(s.distance_from_52w_high, 1)}%`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <SectorComparison stockSector={s.sector} stockChange={s.change_percent} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Badge variant={s.above_ma_50 ? 'default' : 'outline'} className="text-xs px-1.5">
                            50
                          </Badge>
                          <Badge variant={s.above_ma_200 ? 'default' : 'outline'} className="text-xs px-1.5">
                            200
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

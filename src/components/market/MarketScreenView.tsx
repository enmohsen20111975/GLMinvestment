'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search, TrendingUp, TrendingDown, ArrowUpDown, X, ChevronLeft,
  Activity, BarChart3, Target, Zap, LineChart, Shield, Percent,
  CircleDot, ArrowUpRight, ArrowDownRight, Minus, RefreshCw, Eye,
  Gauge, CandlestickChart, Layers, Award, MoveRight, Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { useAppStore } from '@/lib/store';

// ═══════════════════════════════════════════════════════════════════════
// TYPES — match API response from /api/market-screen
// ═══════════════════════════════════════════════════════════════════════

// Overview API response
interface MarketOverviewResponse {
  indices: MarketIndexItem[];
  topGainers: StockBrief[];
  topLosers: StockBrief[];
  topVolume: StockBrief[];
  sectorPerformance: SectorPerf[];
  marketSummary: {
    totalStocks: number;
    gainers: number;
    losers: number;
    unchanged: number;
    totalVolume: number;
    avgChange: number;
  };
}

interface MarketIndexItem {
  symbol: string;
  name: string | null;
  name_ar: string | null;
  current_value: number | null;
  previous_close: number | null;
  change: number | null;
  change_percent: number | null;
}

interface StockBrief {
  ticker: string;
  name: string | null;
  name_ar: string | null;
  market: string | null;
  sector: string | null;
  price: number | null;
  change_percent: number | null;
  volume: string | number | null;
  market_cap: string | number | null;
}

interface SectorPerf {
  sector: string;
  avg_change: number;
  stock_count: number;
}

// Stocks list API response
interface StocksListResponse {
  stocks: StockScreenerRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface StockScreenerRow {
  ticker: string;
  name: string | null;
  name_ar: string | null;
  market: string | null;
  sector: string | null;
  price: number | null;
  change_percent: number | null;
  volume: string | number | null;
  market_cap: string | number | null;
  rsi: number | null;
  pe_ratio: number | null;
  pb_ratio: number | null;
  ps_ratio: number | null;
  eps: number | null;
  dividend_yield: number | null;
  beta: number | null;
  high_52w: number | null;
  low_52w: number | null;
  ma_50: number | null;
  ma_200: number | null;
  signal: string | null;
  trend: string | null;
  support: number | null;
  resistance: number | null;
  is_egx30: boolean;
  is_egx70: boolean;
  is_egx100: boolean;
  perf_1w: number | null;
  perf_1m: number | null;
  perf_3m: number | null;
  perf_6m: number | null;
  perf_ytd: number | null;
  perf_1y: number | null;
  volatility_1w: number | null;
  volatility_1m: number | null;
  technical_rating: string | null;
  ma_rating: string | null;
  oscillators_rating: string | null;
  macd: number | null;
  stoch: number | null;
  adx: number | null;
  atr: number | null;
  peg_ratio: number | null;
  pcf_ratio: number | null;
  pfcf_ratio: number | null;
  ev: number | null;
  ev_revenue: number | null;
  ev_ebitda: number | null;
  recommendation: string | null;
  composite_score: number | null;
  risk_level: string | null;
}

// Stock detail API response
interface StockDetailResponse {
  basic: {
    symbol: string;
    name: string | null;
    name_ar: string | null;
    market: string | null;
    sector: string | null;
    industry: string | null;
    price: number | null;
    change_percent: number | null;
    volume: string | number | null;
    market_cap: string | number | null;
    previous_close: number | null;
    open_price: number | null;
    high_price: number | null;
    low_price: number | null;
    is_active: boolean;
    is_egx30: boolean;
    is_egx70: boolean;
    is_egx100: boolean;
    logo_url: string | null;
    analyst_rating: string | null;
    last_update: string | null;
  };
  priceData: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    previous_close: number | null;
    high_52w: number | null;
    low_52w: number | null;
    support: number | null;
    resistance: number | null;
  };
  technicals: {
    rsi: number | null;
    macd: number | null;
    adx: number | null;
    atr: number | null;
    stoch: number | null;
    ma_50: number | null;
    ma_200: number | null;
    technical_rating: string | null;
    ma_rating: string | null;
    oscillators_rating: string | null;
    trend: string | null;
    momentum: number | null;
    signal: string | null;
    beta: number | null;
  };
  fundamentals: {
    pe: number | null;
    pb: number | null;
    ps: number | null;
    eps: number | null;
    roe: number | null;
    roa: number | null;
    debt_to_equity: number | null;
    current_ratio: number | null;
    book_value_per_share: number | null;
    dividend_yield: number | null;
    profit_margin: number | null;
  };
  performance: {
    perf_1w: number | null;
    perf_1m: number | null;
    perf_3m: number | null;
    perf_6m: number | null;
    perf_ytd: number | null;
    perf_1y: number | null;
    perf_5y: number | null;
    perf_10y: number | null;
    perf_all: number | null;
    volatility_1w: number | null;
    volatility_1m: number | null;
  };
  valuation: {
    pe_ratio: number | null;
    peg_ratio: number | null;
    ps_ratio: number | null;
    pb_ratio: number | null;
    pcf_ratio: number | null;
    pfcf_ratio: number | null;
    ev: number | null;
    ev_revenue: number | null;
    ev_ebit: number | null;
    ev_ebitda: number | null;
  };
  profitability: {
    gross_margin: number | null;
    operating_margin: number | null;
    pretax_margin: number | null;
    net_margin: number | null;
    fcf_margin: number | null;
    roa: number | null;
    roe: number | null;
    roc: number | null;
  };
  dividends: {
    dps_ttm: number | null;
    dps_fy: number | null;
    div_yield: number | null;
    div_yield_fwd: number | null;
    payout_ratio: number | null;
    dps_growth: number | null;
    cont_div: number | null;
    cont_div_growth: number | null;
  };
  incomeStatement: {
    revenue: number | null;
    revenue_growth: number | null;
    gross_profit: number | null;
    operating_income: number | null;
    net_income: number | null;
    eps_basic: number | null;
    eps_diluted: number | null;
    fiscal_period: string | null;
    fiscal_end: string | null;
  };
  balanceSheet: {
    total_assets: number | null;
    total_liabilities: number | null;
    total_equity: number | null;
    shares_outstanding: number | null;
    shares_float: number | null;
    current_assets: number | null;
    current_liabilities: number | null;
    cash: number | null;
    debt: number | null;
  };
  cashFlow: {
    operating_cf: number | null;
    investing_cf: number | null;
    financing_cf: number | null;
    free_cf: number | null;
  };
  analysis: {
    recommendation: string | null;
    composite_score: number | null;
    target_price: number | null;
    stop_loss: number | null;
    confidence: number | null;
    risk_level: string | null;
    momentum_score: number | null;
    upside_potential: number | null;
    is_tradeable: boolean;
    volume_trend: string | null;
    price_strength: number | null;
    technical_score: number | null;
    fundamental_score: number | null;
    master_score: number | null;
  } | null;
  insights: {
    entryOpportunity: boolean;
    exitOpportunity: boolean;
    priceVsMA50: 'above' | 'below' | 'at';
    priceVsMA200: 'above' | 'below' | 'at';
    momentumDirection: 'bullish' | 'bearish' | 'neutral';
    fairValueGap: number | null;
    volatilityLevel: 'low' | 'medium' | 'high';
    dividendSafety: 'safe' | 'moderate' | 'at_risk' | 'unknown';
  };
  priceHistory: { date: string; open: number; high: number; low: number; close: number; volume: number | string }[];
}

type MarketTab = 'EGX' | 'TADAWUL' | 'KSE' | 'QSE';
type SortField = 'ticker' | 'change_percent' | 'volume' | 'market_cap' | 'rsi' | 'pe_ratio' | 'dividend_yield';
type SortDir = 'asc' | 'desc';

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════
const fmt = (n: number | null | undefined, decimals = 2): string => {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('ar-EG', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const fmtPct = (n: number | null | undefined): string => {
  if (n == null || isNaN(n)) return '—';
  if (n === 0) return '0.00%';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
};

const fmtVol = (v: string | number | null | undefined): string => {
  if (v == null) return '—';
  const s = String(v).replace(/[^\d.]/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return String(v);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
};

const changeColor = (n: number | null | undefined): string => {
  if (n == null || n === 0) return 'text-muted-foreground';
  return n > 0 ? 'text-emerald-500' : 'text-red-500';
};

const changeBg = (n: number | null | undefined): string => {
  if (n == null || n === 0) return 'bg-muted/50';
  return n > 0 ? 'bg-emerald-500/10' : 'bg-red-500/10';
};

const MARKET_LABELS: Record<MarketTab, string> = {
  EGX: 'البورصة المصرية',
  TADAWUL: 'السوق السعودي',
  KSE: 'بورصة الكويت',
  QSE: 'بورصة قطر',
};

const TECH_RATING_COLORS: Record<string, string> = {
  'شراء قوي': 'bg-emerald-500 text-white',
  'شراء': 'bg-emerald-500/80 text-white',
  'محايد': 'bg-yellow-500/80 text-white',
  'بيع': 'bg-red-500/80 text-white',
  'بيع قوي': 'bg-red-500 text-white',
  'Strong Buy': 'bg-emerald-500 text-white',
  'Buy': 'bg-emerald-500/80 text-white',
  'Neutral': 'bg-yellow-500/80 text-white',
  'Sell': 'bg-red-500/80 text-white',
  'Strong Sell': 'bg-red-500 text-white',
};

const SIGNAL_COLORS: Record<string, string> = {
  'BUY': 'bg-emerald-500 text-white',
  'STRONG_BUY': 'bg-emerald-600 text-white',
  'SELL': 'bg-red-500 text-white',
  'STRONG_SELL': 'bg-red-600 text-white',
  'HOLD': 'bg-yellow-500 text-white',
  'NEUTRAL': 'bg-muted text-muted-foreground',
  'ACCUMULATE': 'bg-emerald-500/70 text-white',
};

const SORT_LABELS: Record<SortField, string> = {
  ticker: 'الرمز',
  change_percent: 'التغير%',
  volume: 'الحجم',
  market_cap: 'القيمة السوقية',
  rsi: 'RSI',
  pe_ratio: 'م/ر',
  dividend_yield: 'عائد التوزيع',
};

// Map component sort field to API sort param
const SORT_API_MAP: Record<SortField, string> = {
  ticker: 'ticker',
  change_percent: 'change',
  volume: 'volume',
  market_cap: 'market_cap',
  rsi: 'rsi',
  pe_ratio: 'pe',
  dividend_yield: 'pe',
};

// ═══════════════════════════════════════════════════════════════════════
// SKELETON
// ═══════════════════════════════════════════════════════════════════════
function OverviewSkeleton() {
  return (
    <div className="space-y-4 p-3 md:p-4" dir="rtl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// OVERVIEW HEADER
// ═══════════════════════════════════════════════════════════════════════
function MarketOverviewHeader({ data, onRefresh }: { data: MarketOverviewResponse | null; onRefresh: () => void }) {
  if (!data) return null;

  const s = data.marketSummary;

  return (
    <div className="space-y-3">
      {/* Index Cards */}
      {data.indices.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {data.indices.map(idx => (
            <Card key={idx.symbol} className="py-2">
              <CardContent className="px-3 py-1">
                <p className="text-[10px] text-muted-foreground font-medium">{idx.name || idx.symbol}</p>
                <p className="text-sm font-bold font-mono">{fmt(idx.current_value, 1)}</p>
                <p className={`text-[10px] font-medium ${changeColor(idx.change_percent)}`}>
                  {fmtPct(idx.change_percent)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <MiniStat label="إجمالي الأسهم" value={s.totalStocks} />
        <MiniStat label="المرتفعة" value={s.gainers} color="text-emerald-500" />
        <MiniStat label="المنخفضة" value={s.losers} color="text-red-500" />
        <MiniStat label="بدون تغير" value={s.unchanged} />
        <MiniStat label="إجمالي الحجم" value={fmtVol(s.totalVolume)} />
        <MiniStat label="متوسط التغير" value={fmtPct(s.avgChange)} color={changeColor(s.avgChange)} />
      </div>

      {/* Sector Performance */}
      {data.sectorPerformance.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-primary" /> أداء القطاعات
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <ScrollArea className="max-h-40">
              <div className="space-y-1">
                {data.sectorPerformance.slice(0, 12).map(sp => (
                  <div key={sp.sector} className="flex items-center justify-between py-1 text-xs">
                    <span className="text-muted-foreground truncate max-w-[150px]">{sp.sector}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">({sp.stock_count})</span>
                      <span className={`font-mono font-medium ${changeColor(sp.avg_change)}`}>
                        {fmtPct(sp.avg_change)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Refresh */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onRefresh} className="text-xs">
          <RefreshCw className="h-3 w-3 ml-1" /> تحديث
        </Button>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <Card className="py-1">
      <CardContent className="px-2 py-1 text-center">
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className={`text-sm font-bold font-mono ${color || ''}`}>{typeof value === 'number' ? value.toLocaleString('ar-EG') : value}</p>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STOCK SCREENER GRID
// ═══════════════════════════════════════════════════════════════════════
function StockScreenerGrid({
  stocks, total, page, totalPages, sortBy, sortDir, search,
  onSort, onSearch, onPageChange, onSelectStock,
}: {
  stocks: StockScreenerRow[];
  total: number;
  page: number;
  totalPages: number;
  sortBy: SortField;
  sortDir: SortDir;
  search: string;
  onSort: (f: SortField) => void;
  onSearch: (q: string) => void;
  onPageChange: (p: number) => void;
  onSelectStock: (ticker: string) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Search + Sort */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="ابحث بالرمز أو الاسم..."
            value={search}
            onChange={e => onSearch(e.target.value)}
            className="pr-8 text-sm"
            dir="rtl"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {(Object.keys(SORT_LABELS) as SortField[]).map(f => (
            <Button
              key={f}
              variant={sortBy === f ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => onSort(f)}
            >
              {SORT_LABELS[f]}
              {sortBy === f && (sortDir === 'asc' ? ' ↑' : ' ↓')}
            </Button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground">
        {total.toLocaleString('ar-EG')} سهم · صفحة {page} من {totalPages}
      </p>

      {/* Table */}
      <div className="overflow-x-auto -mx-3 px-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2 px-1 text-right font-medium">الرمز</th>
              <th className="py-2 px-1 text-right font-medium hidden md:table-cell">الاسم</th>
              <th className="py-2 px-1 text-right font-medium">السعر</th>
              <th className="py-2 px-1 text-right font-medium">التغير%</th>
              <th className="py-2 px-1 text-right font-medium hidden sm:table-cell">الحجم</th>
              <th className="py-2 px-1 text-right font-medium hidden lg:table-cell">RSI</th>
              <th className="py-2 px-1 text-right font-medium hidden lg:table-cell">MA</th>
              <th className="py-2 px-1 text-right font-medium hidden md:table-cell">الاتجاه</th>
              <th className="py-2 px-1 text-right font-medium hidden lg:table-cell">إشارة</th>
              <th className="py-2 px-1 text-right font-medium hidden xl:table-cell">أداء شهر</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map(s => (
              <tr
                key={s.ticker}
                className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                onClick={() => onSelectStock(s.ticker)}
              >
                <td className="py-2 px-1 font-mono font-bold">{s.ticker}</td>
                <td className="py-2 px-1 text-muted-foreground truncate max-w-[120px] hidden md:table-cell">
                  {s.name_ar || s.name}
                </td>
                <td className="py-2 px-1 font-mono">{fmt(s.price)}</td>
                <td className="py-2 px-1">
                  <span className={`font-mono font-medium ${changeColor(s.change_percent)}`}>
                    {fmtPct(s.change_percent)}
                  </span>
                </td>
                <td className="py-2 px-1 font-mono hidden sm:table-cell">{fmtVol(s.volume)}</td>
                <td className="py-2 px-1 font-mono hidden lg:table-cell">
                  {s.rsi != null ? (
                    <span className={s.rsi < 30 ? 'text-emerald-500' : s.rsi > 70 ? 'text-red-500' : ''}>
                      {s.rsi.toFixed(0)}
                    </span>
                  ) : '—'}
                </td>
                <td className="py-2 px-1 hidden lg:table-cell">
                  {s.ma_rating ? (
                    <Badge variant="outline" className="text-[10px] px-1 py-0">{s.ma_rating}</Badge>
                  ) : '—'}
                </td>
                <td className="py-2 px-1 hidden md:table-cell">
                  {s.trend ? (
                    <Badge className={`${changeBg(s.trend === 'uptrend' ? 1 : s.trend === 'downtrend' ? -1 : 0)} text-[10px] px-1 py-0`}>
                      {s.trend === 'uptrend' ? '↑ صاعد' : s.trend === 'downtrend' ? '↓ هابط' : '→ ثابت'}
                    </Badge>
                  ) : '—'}
                </td>
                <td className="py-2 px-1 hidden lg:table-cell">
                  {s.signal ? (
                    <Badge className={`${SIGNAL_COLORS[s.signal] || 'bg-muted'} text-[10px] px-1 py-0`}>
                      {s.signal}
                    </Badge>
                  ) : '—'}
                </td>
                <td className="py-2 px-1 hidden xl:table-cell">
                  <span className={`font-mono ${changeColor(s.perf_1m)}`}>{fmtPct(s.perf_1m)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center gap-2 items-center">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          السابق
        </Button>
        <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          التالي
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STOCK DEEP-DIVE PANEL — now using StockDetailResponse directly
// ═══════════════════════════════════════════════════════════════════════
function StockDeepDive({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [detail, setDetail] = useState<StockDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/market-screen?type=stock&symbol=${encodeURIComponent(symbol)}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (d.error) {
          setError(d.error);
          setDetail(null);
        } else {
          setDetail(d);
        }
      })
      .catch(err => {
        setError(err.message);
        setDetail(null);
      })
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="p-4 space-y-3" dir="rtl">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" onClick={onClose}><ChevronLeft className="h-4 w-4" /></Button>
          <Skeleton className="h-6 w-32" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (error || !detail?.basic) {
    return (
      <div className="p-4 text-center" dir="rtl">
        <Button variant="ghost" size="sm" onClick={onClose} className="mb-4">
          <ChevronLeft className="h-4 w-4 ml-1" /> رجوع
        </Button>
        <p className="text-muted-foreground">{error || 'لم يتم العثور على بيانات السهم'}</p>
      </div>
    );
  }

  const b = detail.basic;
  const pd = detail.priceData;
  const tech = detail.technicals;
  const fund = detail.fundamentals;
  const perf = detail.performance;
  const val = detail.valuation;
  const prof = detail.profitability;
  const div = detail.dividends;
  const inc = detail.incomeStatement;
  const bs = detail.balanceSheet;
  const cf = detail.cashFlow;
  const ins = detail.insights;
  const ana = detail.analysis;
  const hist = detail.priceHistory;

  // Computed momentum direction in Arabic
  const momentumDirAr = ins.momentumDirection === 'bullish' ? 'صاعد' : ins.momentumDirection === 'bearish' ? 'هابط' : 'محايد';
  const momentumStrength = tech.rsi != null ? (ins.momentumDirection === 'bullish' ? Math.min(100, tech.rsi) : ins.momentumDirection === 'bearish' ? Math.min(100, 100 - tech.rsi) : 50) : 50;

  return (
    <div className="p-3 md:p-4 space-y-3" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-bold">{b.symbol}</h2>
            <p className="text-xs text-muted-foreground">{b.name_ar || b.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tech.technical_rating && (
            <Badge className={`${TECH_RATING_COLORS[tech.technical_rating] || 'bg-muted'} text-xs`}>
              {tech.technical_rating}
            </Badge>
          )}
          {b.sector && <Badge variant="outline" className="text-xs">{b.sector}</Badge>}
          {ana?.recommendation && (
            <Badge className={`${SIGNAL_COLORS[ana.recommendation] || 'bg-muted'} text-xs`}>
              {ana.recommendation}
            </Badge>
          )}
        </div>
      </div>

      {/* a. Price & Trading Card */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Target className="h-4 w-4 text-primary" /> السعر والتداول
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          {/* Current price */}
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold">{fmt(b.price)}</span>
            <span className={`text-sm font-bold ${changeColor(b.change_percent)}`}>
              {fmtPct(b.change_percent)}
            </span>
          </div>

          {/* Entry / Exit opportunities */}
          <div className="flex gap-2 flex-wrap">
            {ins.entryOpportunity && (
              <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30 text-xs">
                <Zap className="h-3 w-3 ml-1" /> فرصة دخول — السعر قرب أدنى مستوى
              </Badge>
            )}
            {ins.exitOpportunity && (
              <Badge className="bg-red-500/20 text-red-500 border-red-500/30 text-xs">
                <Target className="h-3 w-3 ml-1" /> فرصة بيع — السعر قرب أعلى مستوى
              </Badge>
            )}
          </div>

          {/* 52-week range bar */}
          {pd.high_52w != null && pd.low_52w != null && pd.high_52w > pd.low_52w && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>أدنى 52 أسبوع: {fmt(pd.low_52w)}</span>
                <span>أعلى 52 أسبوع: {fmt(pd.high_52w)}</span>
              </div>
              <div className="relative h-3 bg-gradient-to-l from-emerald-500/30 via-yellow-500/20 to-red-500/30 rounded-full">
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-4 w-1 bg-primary rounded-full"
                  style={{ right: `${Math.max(2, Math.min(98, ((b.price || 0) - pd.low_52w) / (pd.high_52w - pd.low_52w) * 100))}%` }}
                />
              </div>
              <div className="text-center text-[10px] text-muted-foreground">
                السعر الحالي في {(((b.price || 0) - pd.low_52w) / (pd.high_52w - pd.low_52w) * 100).toFixed(0)}% من النطاق
              </div>
            </div>
          )}

          {/* Support / Resistance / Volume */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <InfoItem label="الدعم" value={fmt(pd.support)} />
            <InfoItem label="المقاومة" value={fmt(pd.resistance)} />
            <InfoItem label="الحجم" value={fmtVol(b.volume)} />
            <InfoItem label="القيمة السوقية" value={fmtVol(b.market_cap)} />
          </div>
        </CardContent>
      </Card>

      {/* b. Moving Averages Card */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <LineChart className="h-4 w-4 text-primary" /> المتوسطات المتحركة
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* MA50 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">MA50</span>
                <span className="text-xs font-mono">{fmt(tech.ma_50)}</span>
              </div>
              {tech.ma_50 != null && b.price != null && (
                <div className={`flex items-center gap-1 text-xs font-medium ${ins.priceVsMA50 === 'above' ? 'text-emerald-500' : ins.priceVsMA50 === 'below' ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {ins.priceVsMA50 === 'above' ? <><ArrowUpRight className="h-3 w-3" /> السعر فوق MA50</> : ins.priceVsMA50 === 'below' ? <><ArrowDownRight className="h-3 w-3" /> السعر تحت MA50</> : 'السعر قريب من MA50'}
                </div>
              )}
            </div>

            {/* MA200 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">MA200</span>
                <span className="text-xs font-mono">{fmt(tech.ma_200)}</span>
              </div>
              {tech.ma_200 != null && b.price != null && (
                <div className={`flex items-center gap-1 text-xs font-medium ${ins.priceVsMA200 === 'above' ? 'text-emerald-500' : ins.priceVsMA200 === 'below' ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {ins.priceVsMA200 === 'above' ? <><ArrowUpRight className="h-3 w-3" /> السعر فوق MA200</> : ins.priceVsMA200 === 'below' ? <><ArrowDownRight className="h-3 w-3" /> السعر تحت MA200</> : 'السعر قريب من MA200'}
                </div>
              )}
            </div>
          </div>

          {/* Crossover signal */}
          {tech.ma_50 != null && tech.ma_200 != null && (
            <div className={`p-2 rounded-lg text-xs text-center font-medium ${
              tech.ma_50 > tech.ma_200 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'
            }`}>
              {tech.ma_50 > tech.ma_200 ? '✨ تقاطع ذهبي (MA50 > MA200)' : '💀 تقاطع مميت (MA50 < MA200)'}
            </div>
          )}

          {/* MA Rating */}
          {tech.ma_rating && (
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs text-muted-foreground">تقييم المتوسطات:</span>
              <Badge className={`${TECH_RATING_COLORS[tech.ma_rating] || 'bg-muted'} text-xs px-2 py-0.5`}>
                {tech.ma_rating}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* c. Technical Indicators Card */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-primary" /> المؤشرات الفنية
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-4">
          {/* RSI Gauge */}
          {tech.rsi != null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">RSI (14)</span>
                <span className={`font-bold ${tech.rsi < 30 ? 'text-emerald-500' : tech.rsi > 70 ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {tech.rsi.toFixed(1)}
                </span>
              </div>
              <div className="relative h-6 bg-muted rounded-full overflow-hidden">
                <div className="absolute inset-y-0 right-0 w-[30%] bg-red-500/10" />
                <div className="absolute inset-y-0 left-0 w-[30%] bg-emerald-500/10" />
                <div
                  className="absolute top-0 h-full w-0.5 bg-primary"
                  style={{ right: `${Math.max(1, Math.min(99, tech.rsi))}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary border-2 border-background"
                  style={{ right: `calc(${Math.max(1, Math.min(99, tech.rsi))}% - 6px)` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span className="text-emerald-500">تشبع بيعي {'<'}30</span>
                <span>محايد</span>
                <span className="text-red-500">تشبع شرائي {'>'}70</span>
              </div>
            </div>
          )}

          {/* MACD */}
          {tech.macd != null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">MACD</span>
                <span className={`text-xs font-mono ${tech.macd > 0 ? 'text-emerald-500' : 'text-red-500'}`}>{fmt(tech.macd)}</span>
              </div>
              <div className={`text-xs font-medium ${tech.macd > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {tech.macd > 0 ? '📈 إشارة شراء (MACD > 0)' : '📉 إشارة بيع (MACD < 0)'}
              </div>
            </div>
          )}

          {/* Other indicators grid */}
          <div className="grid grid-cols-2 gap-2">
            <InfoItem label="ADX (قوة الاتجاه)" value={tech.adx ? `${tech.adx.toFixed(0)} (${tech.adx > 25 ? 'قوي' : 'ضعيف'})` : '—'} />
            <InfoItem label="ATR (التذبذب)" value={tech.atr ? fmt(tech.atr) : '—'} />
            <InfoItem label="Stochastic" value={tech.stoch ? tech.stoch.toFixed(1) : '—'} />
            <InfoItem label="Beta" value={tech.beta ? tech.beta.toFixed(2) : '—'} />
          </div>

          {/* Technical Rating Badge */}
          {tech.technical_rating && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">التقييم الفني:</span>
              <Badge className={`${TECH_RATING_COLORS[tech.technical_rating] || 'bg-muted'} text-sm px-3 py-1`}>
                <Award className="h-3.5 w-3.5 ml-1" /> {tech.technical_rating}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* d. Momentum Direction Card */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-primary" /> اتجاه الزخم
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          <div className="flex items-center justify-center gap-3 py-2">
            <span className="text-3xl">
              {ins.momentumDirection === 'bullish' ? '📈' : ins.momentumDirection === 'bearish' ? '📉' : '➡️'}
            </span>
            <span className={`text-xl font-bold ${ins.momentumDirection === 'bullish' ? 'text-emerald-500' : ins.momentumDirection === 'bearish' ? 'text-red-500' : 'text-muted-foreground'}`}>
              {momentumDirAr}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">قوة الإشارة</span>
              <span className="font-mono">{momentumStrength.toFixed(0)}%</span>
            </div>
            <Progress value={momentumStrength} className={`h-2 ${ins.momentumDirection === 'bullish' ? '[&>div]:bg-emerald-500' : ins.momentumDirection === 'bearish' ? '[&>div]:bg-red-500' : ''}`} />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            مبني على RSI + MACD + الاتجاه
          </p>
        </CardContent>
      </Card>

      {/* e. Performance Card */}
      {perf && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4 text-primary" /> الأداء
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {[
              { key: 'perf_1w' as const, label: 'أسبوع' },
              { key: 'perf_1m' as const, label: 'شهر' },
              { key: 'perf_3m' as const, label: '3 أشهر' },
              { key: 'perf_6m' as const, label: '6 أشهر' },
              { key: 'perf_ytd' as const, label: 'منذ بداية العام' },
              { key: 'perf_1y' as const, label: 'سنة' },
            ].map(p => {
              const val = perf[p.key];
              return (
                <div key={p.key} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-24 shrink-0">{p.label}</span>
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden relative">
                    {val != null && (
                      <div
                        className={`h-full rounded-full absolute top-0 ${val > 0 ? 'bg-emerald-500 right-1/2' : 'bg-red-500 left-1/2'}`}
                        style={{ width: `${Math.min(50, Math.abs(val))}%` }}
                      />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-[10px] font-bold ${val != null ? changeColor(val) : 'text-muted-foreground'}`}>
                        {fmtPct(val)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Volatility */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <InfoItem label="تذبذب أسبوعي" value={perf.volatility_1w != null ? fmtPct(perf.volatility_1w) : '—'} />
              <InfoItem label="تذبذب شهري" value={perf.volatility_1m != null ? fmtPct(perf.volatility_1m) : '—'} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* f. Valuation Card */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Percent className="h-4 w-4 text-primary" /> التقييم
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <RatioItem label="م/ر (P/E)" value={val.pe_ratio} />
            <RatioItem label="م/ج (P/B)" value={val.pb_ratio} />
            <RatioItem label="م/م (P/S)" value={val.ps_ratio} />
            <RatioItem label="PEG" value={val.peg_ratio} />
            <RatioItem label="م/التدفق النقدي" value={val.pcf_ratio} />
            <RatioItem label="م/التدفق الحر" value={val.pfcf_ratio} />
            <InfoItem label="القيمة العادلة (سعر الهدف)" value={ana?.target_price ? fmt(ana.target_price) : '—'} />
            <InfoItem label="فجوة القيمة العادلة" value={ins.fairValueGap != null ? fmtPct(ins.fairValueGap) : '—'} />
            <InfoItem label="EV/EBITDA" value={val.ev_ebitda != null ? fmt(val.ev_ebitda) : '—'} />
          </div>
        </CardContent>
      </Card>

      {/* g. Fundamentals Card */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Shield className="h-4 w-4 text-primary" /> الأساسيات
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <RatioItem label="العائد على حقوق الملكية (ROE)" value={fund.roe} suffix="%" />
            <RatioItem label="العائد على الأصول (ROA)" value={fund.roa} suffix="%" />
            <RatioItem label="هامش الربح" value={fund.profit_margin} suffix="%" />
            <RatioItem label="الدين/حقوق الملكية" value={fund.debt_to_equity} />
            <RatioItem label="نسبة التداول" value={fund.current_ratio} />
            <InfoItem label="ربحية السهم (EPS)" value={fund.eps ? fmt(fund.eps) : '—'} />
            <InfoItem label="القيمة الدفترية/سهم" value={fund.book_value_per_share ? fmt(fund.book_value_per_share) : '—'} />
            <InfoItem label="القطاع" value={b.sector || '—'} />
            <InfoItem label="بيتا" value={tech.beta ? tech.beta.toFixed(2) : '—'} />
          </div>

          {/* Profitability sub-section */}
          {prof && (prof.gross_margin != null || prof.operating_margin != null || prof.net_margin != null) && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs font-medium mb-2 text-muted-foreground">الربحية</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <RatioItem label="هامش إجمالي" value={prof.gross_margin} suffix="%" />
                <RatioItem label="هامش تشغيلي" value={prof.operating_margin} suffix="%" />
                <RatioItem label="هامش صافي" value={prof.net_margin} suffix="%" />
                <RatioItem label="هامش التدفق الحر" value={prof.fcf_margin} suffix="%" />
                <RatioItem label="ROC" value={prof.roc} suffix="%" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* h. Dividends Card */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <CandlestickChart className="h-4 w-4 text-primary" /> التوزيعات
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="grid grid-cols-2 gap-3">
            <RatioItem label="عائد التوزيع" value={div.div_yield} suffix="%" />
            <RatioItem label="عائد التوزيع المتوقع" value={div.div_yield_fwd} suffix="%" />
            <InfoItem label="معدل التوزيع" value={div.payout_ratio != null ? `${(div.payout_ratio * 100).toFixed(1)}%` : '—'} />
            <InfoItem label="نمو التوزيع" value={div.dps_growth != null ? fmtPct(div.dps_growth) : '—'} />
            <InfoItem label="التوزيعات المتتالية" value={div.cont_div != null ? String(div.cont_div) : '—'} />
            <InfoItem label="أمان التوزيع" value={
              ins.dividendSafety === 'safe' ? '✅ آمن' :
              ins.dividendSafety === 'moderate' ? '⚠️ متوسط' :
              ins.dividendSafety === 'at_risk' ? '🔴 معرض للخطر' : '—'
            } />
          </div>
        </CardContent>
      </Card>

      {/* i. Financial Data (Income/Balance/Cash Flow) — NEW */}
      {(inc.revenue != null || bs.total_assets != null || cf.operating_cf != null) && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-primary" /> البيانات المالية
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-3">
            {/* Income Statement */}
            {inc.revenue != null && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">قائمة الدخل</p>
                <div className="grid grid-cols-2 gap-2">
                  <InfoItem label="الإيرادات" value={fmtVol(inc.revenue)} />
                  <InfoItem label="نمو الإيرادات" value={inc.revenue_growth != null ? fmtPct(inc.revenue_growth) : '—'} />
                  <InfoItem label="إجمالي الربح" value={inc.gross_profit ? fmtVol(inc.gross_profit) : '—'} />
                  <InfoItem label="الدخل التشغيلي" value={inc.operating_income ? fmtVol(inc.operating_income) : '—'} />
                  <InfoItem label="صافي الدخل" value={inc.net_income ? fmtVol(inc.net_income) : '—'} />
                </div>
              </div>
            )}

            {/* Balance Sheet */}
            {bs.total_assets != null && (
              <div className="pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-1">الميزانية العمومية</p>
                <div className="grid grid-cols-2 gap-2">
                  <InfoItem label="إجمالي الأصول" value={fmtVol(bs.total_assets)} />
                  <InfoItem label="إجمالي الخصوم" value={bs.total_liabilities ? fmtVol(bs.total_liabilities) : '—'} />
                  <InfoItem label="حقوق الملكية" value={bs.total_equity ? fmtVol(bs.total_equity) : '—'} />
                  <InfoItem label="الأسهم القائمة" value={bs.shares_outstanding ? fmtVol(bs.shares_outstanding) : '—'} />
                  <InfoItem label="النقد" value={bs.cash ? fmtVol(bs.cash) : '—'} />
                  <InfoItem label="الدين" value={bs.debt ? fmtVol(bs.debt) : '—'} />
                </div>
              </div>
            )}

            {/* Cash Flow */}
            {cf.operating_cf != null && (
              <div className="pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-1">التدفقات النقدية</p>
                <div className="grid grid-cols-2 gap-2">
                  <InfoItem label="التدفق التشغيلي" value={fmtVol(cf.operating_cf)} />
                  <InfoItem label="التدفق الاستثماري" value={cf.investing_cf ? fmtVol(cf.investing_cf) : '—'} />
                  <InfoItem label="التدفق التمويلي" value={cf.financing_cf ? fmtVol(cf.financing_cf) : '—'} />
                  <InfoItem label="التدفق الحر" value={cf.free_cf ? fmtVol(cf.free_cf) : '—'} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* j. Analysis Summary */}
      {ana && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Award className="h-4 w-4 text-primary" /> التحليل الشامل
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <InfoItem label="التوصية" value={
                <Badge className={`${SIGNAL_COLORS[ana.recommendation || ''] || 'bg-muted'} text-xs`}>
                  {ana.recommendation || '—'}
                </Badge>
              } />
              <InfoItem label="النتيجة المركبة" value={ana.composite_score != null ? `${ana.composite_score}/100` : '—'} />
              <InfoItem label="مستوى المخاطرة" value={ana.risk_level || '—'} />
              <InfoItem label="سعر الهدف" value={ana.target_price ? fmt(ana.target_price) : '—'} />
              <InfoItem label="وقف الخسارة" value={ana.stop_loss ? fmt(ana.stop_loss) : '—'} />
              <InfoItem label="الثقة" value={ana.confidence != null ? `${ana.confidence}%` : '—'} />
              <InfoItem label="درجة الزخم" value={ana.momentum_score != null ? `${ana.momentum_score}` : '—'} />
              <InfoItem label="الإمكانية الصعودية" value={ana.upside_potential != null ? fmtPct(ana.upside_potential) : '—'} />
              <InfoItem label="قابلية التداول" value={ana.is_tradeable ? '✅ نعم' : '❌ لا'} />
              <InfoItem label="اتجاه الحجم" value={ana.volume_trend || '—'} />
              <InfoItem label="قوة السعر" value={ana.price_strength != null ? `${ana.price_strength}` : '—'} />
              <InfoItem label="الدرجة الفنية" value={ana.technical_score != null ? `${ana.technical_score}` : '—'} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* k. Price History Mini Chart */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <LineChart className="h-4 w-4 text-primary" /> الرسم البياني ({hist?.length || 0} يوم)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          {!hist || hist.length < 2 ? (
            <p className="text-xs text-muted-foreground text-center py-6">لا تتوفر بيانات تاريخية كافية</p>
          ) : (
            <PriceChart data={hist} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Price Chart SVG ──────────────────────────────────────────────
function PriceChart({ data }: { data: { date: string; open: number; high: number; low: number; close: number; volume: number | string }[] }) {
  const closes = data.map(h => h.close).filter(c => c != null);
  if (closes.length < 2) return <p className="text-xs text-muted-foreground text-center py-6">بيانات غير كافية</p>;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const w = 400;
  const h = 120;
  const padding = 4;

  const points = closes.map((c, i) => {
    const x = padding + (i / (closes.length - 1)) * (w - padding * 2);
    const y = h - padding - ((c - min) / range) * (h - padding * 2);
    return `${x},${y}`;
  });

  const linePath = `M${points.join(' L')}`;
  const areaPath = `${linePath} L${padding + (w - padding * 2)},${h - padding} L${padding},${h - padding} Z`;

  const isUp = closes[closes.length - 1] >= closes[0];
  const strokeColor = isUp ? '#10b981' : '#ef4444';
  const fillColor = isUp ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ direction: 'ltr' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(frac => (
          <line key={frac} x1={padding} y1={padding + frac * (h - padding * 2)}
            x2={w - padding} y2={padding + frac * (h - padding * 2)}
            stroke="currentColor" strokeOpacity={0.08} strokeWidth={0.5} />
        ))}
        <path d={areaPath} fill={fillColor} />
        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={1.5} strokeLinejoin="round" />
        <text x={w - padding} y={padding + 4} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity={0.4}>
          {fmt(max, 1)}
        </text>
        <text x={w - padding} y={h - padding} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity={0.4}>
          {fmt(min, 1)}
        </text>
      </svg>
    </div>
  );
}

// ─── Shared Sub-components ────────────────────────────────────────
function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="text-xs font-medium">{value}</div>
    </div>
  );
}

function RatioItem({ label, value, suffix = '' }: { label: string; value: number | null | undefined; suffix?: string }) {
  return (
    <InfoItem
      label={label}
      value={value != null ? `${fmt(value, value >= 100 ? 0 : 2)}${suffix}` : '—'}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
export function MarketScreenView() {
  const [activeMarket, setActiveMarket] = useState<MarketTab>('EGX');
  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null);
  const [stocks, setStocks] = useState<StockScreenerRow[]>([]);
  const [stocksTotal, setStocksTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState<SortField>('ticker');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stocksLoading, setStocksLoading] = useState(true);

  // Fetch overview — API returns data directly (no .success wrapper)
  const fetchOverview = useCallback(() => {
    fetch(`/api/market-screen?type=overview&market=${activeMarket}`)
      .then(r => r.json())
      .then(d => {
        if (d.marketSummary) {
          setOverview(d);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeMarket]);

  // Fetch stocks list — API uses pageSize, sort, order params
  const fetchStocks = useCallback(() => {
    setStocksLoading(true);
    const params = new URLSearchParams({
      type: 'stocks',
      market: activeMarket,
      page: String(page),
      pageSize: '50',
      sort: SORT_API_MAP[sortBy] || 'ticker',
      order: sortDir,
    });
    if (search) params.set('search', search);
    fetch(`/api/market-screen?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.stocks) {
          setStocks(d.stocks);
          setStocksTotal(d.pagination?.total || 0);
          setTotalPages(d.pagination?.totalPages || 1);
        }
      })
      .catch(() => {})
      .finally(() => setStocksLoading(false));
  }, [activeMarket, page, sortBy, sortDir, search]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => { fetchStocks(); }, [fetchStocks]);

  // Reset page when market or search changes
  useEffect(() => { setPage(1); }, [activeMarket, search]);

  const handleSort = useCallback((field: SortField) => {
    setSortBy(prev => {
      if (prev === field) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
      } else {
        setSortDir('desc');
      }
      return field;
    });
  }, []);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    setPage(1);
  }, []);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchOverview();
      fetchStocks();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchOverview, fetchStocks]);

  // If a stock is selected, show deep-dive panel
  if (selectedTicker) {
    return <StockDeepDive symbol={selectedTicker} onClose={() => setSelectedTicker(null)} />;
  }

  if (loading) return <OverviewSkeleton />;

  return (
    <div className="space-y-4 p-3 md:p-4" dir="rtl">
      {/* Page Title */}
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold">شاشة السوق</h1>
        <Badge variant="outline" className="text-[10px]">
          <Clock className="h-3 w-3 ml-1" />
          {new Date().toLocaleTimeString('ar-EG')}
        </Badge>
      </div>

      {/* Market Tabs */}
      <Tabs value={activeMarket} onValueChange={v => setActiveMarket(v as MarketTab)}>
        <TabsList className="grid w-full grid-cols-4 max-w-md">
          <TabsTrigger value="EGX">EGX</TabsTrigger>
          <TabsTrigger value="TADAWUL">تداول</TabsTrigger>
          <TabsTrigger value="KSE">الكويت</TabsTrigger>
          <TabsTrigger value="QSE">قطر</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Overview Header */}
      <MarketOverviewHeader data={overview} onRefresh={() => { fetchOverview(); fetchStocks(); }} />

      {/* Top Gainers/Losers */}
      {overview && (overview.topGainers?.length > 0 || overview.topLosers?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Top Gainers */}
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-1.5 text-emerald-500">
                <TrendingUp className="h-4 w-4" /> الأكثر ارتفاعاً
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="space-y-1.5">
                {overview.topGainers?.map(s => (
                  <div key={s.ticker} className="flex items-center justify-between py-1 cursor-pointer hover:bg-muted/50 rounded px-1"
                    onClick={() => setSelectedTicker(s.ticker)}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold">{s.ticker}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[100px]">{s.name_ar || s.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono">{fmt(s.price)}</span>
                      <Badge className="bg-emerald-500/10 text-emerald-500 text-[10px] px-1.5 py-0">
                        {fmtPct(s.change_percent)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Losers */}
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-1.5 text-red-500">
                <TrendingDown className="h-4 w-4" /> الأكثر انخفاضاً
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="space-y-1.5">
                {overview.topLosers?.map(s => (
                  <div key={s.ticker} className="flex items-center justify-between py-1 cursor-pointer hover:bg-muted/50 rounded px-1"
                    onClick={() => setSelectedTicker(s.ticker)}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold">{s.ticker}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[100px]">{s.name_ar || s.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono">{fmt(s.price)}</span>
                      <Badge className="bg-red-500/10 text-red-500 text-[10px] px-1.5 py-0">
                        {fmtPct(s.change_percent)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      {/* Stock Screener Grid */}
      {stocksLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <StockScreenerGrid
          stocks={stocks}
          total={stocksTotal}
          page={page}
          totalPages={totalPages}
          sortBy={sortBy}
          sortDir={sortDir}
          search={search}
          onSort={handleSort}
          onSearch={handleSearch}
          onPageChange={setPage}
          onSelectStock={setSelectedTicker}
        />
      )}
    </div>
  );
}

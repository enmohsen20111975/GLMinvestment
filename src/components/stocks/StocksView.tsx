'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Stock } from '@/types';
import { useAppStore } from '@/lib/store';
import { Header } from '@/components/layout/Header';
import { StockDetail } from './StockDetail';
import { ShareButton } from '@/components/share/ShareButton';
import { cn, safeNum } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  LayoutGrid,
  List,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Filter,
  Zap,
} from 'lucide-react';
import { StockSelector } from './StockSelector';

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTORS = [
  'الكل',
  'Financials',
  'Basic Materials',
  'Real Estate',
  'Consumer Goods',
  'Industrials',
  'Food & Beverage',
  'Technology',
  'Consumer Services',
  'Healthcare',
  'Energy',
  'Telecommunications',
];

const INDEX_FILTERS = [
  { key: 'all', label: 'الكل' },
  { key: 'egx30', label: 'EGX 30' },
  { key: 'egx70', label: 'EGX 70' },
  { key: 'egx100', label: 'EGX 100' },
];

const SORT_OPTIONS = [
  { key: 'change-desc', label: 'التغير % (الأعلى أولاً)' },
  { key: 'change-asc', label: 'التغير % (الأقل أولاً)' },
  { key: 'price-desc', label: 'السعر (الأعلى أولاً)' },
  { key: 'price-asc', label: 'السعر (الأقل أولاً)' },
  { key: 'volume-desc', label: 'الحجم (الأعلى أولاً)' },
  { key: 'marketcap-desc', label: 'القيمة السوقية (الأعلى أولاً)' },
  { key: 'pe-asc', label: 'مكرر الربحية (الأقل أولاً)' },
  { key: 'name-asc', label: 'الاسم (أبجدياً)' },
];

const PRICE_RANGE_OPTIONS = [
  { key: 'all', label: 'كل الأسعار' },
  { key: 'under-10', label: 'أقل من 10 ج.م' },
  { key: '10-50', label: '10 - 50 ج.م' },
  { key: '50-100', label: '50 - 100 ج.م' },
  { key: 'over-100', label: 'أكثر من 100 ج.م' },
];

const CHANGE_FILTER_OPTIONS = [
  { key: 'all', label: 'الكل' },
  { key: 'gainers', label: 'المرتفعة فقط' },
  { key: 'losers', label: 'المنخفضة فقط' },
  { key: 'unchanged', label: 'الثابتة فقط' },
];

type ViewMode = 'list' | 'card';

const PAGE_SIZE = 15;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(2) + 'M';
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'K';
  return vol.toString();
}

function formatMarketCap(cap: number): string {
  if (cap >= 1_000_000_000) return (cap / 1_000_000_000).toFixed(1) + 'B';
  if (cap >= 1_000_000) return (cap / 1_000_000).toFixed(1) + 'M';
  return cap.toLocaleString();
}

// ─── Skeleton Components ──────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="hidden md:block">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0 px-4">
          <Skeleton className="h-5 w-14 flex-shrink-0" />
          <Skeleton className="h-5 w-28 flex-1" />
          <Skeleton className="h-5 w-20 flex-shrink-0" />
          <Skeleton className="h-5 w-16 flex-shrink-0" />
          <Skeleton className="h-5 w-16 flex-shrink-0" />
          <Skeleton className="h-5 w-20 flex-shrink-0" />
          <Skeleton className="h-5 w-16 flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-52 w-full rounded-xl" />
      ))}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-28 rounded-lg" />
      ))}
    </div>
  );
}

// ─── Overview Summary Bar ─────────────────────────────────────────────────────

function OverviewSummary({
  total,
  gainers,
  losers,
  unchanged,
  avgChange,
}: {
  total: number;
  gainers: number;
  losers: number;
  unchanged: number;
  avgChange: number;
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">الإجمالي</span>
        <span className="text-sm font-bold">{total}</span>
      </div>
      <div className="flex items-center gap-1.5 bg-emerald-500/10 rounded-lg px-3 py-1.5">
        <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">المرتفعة</span>
        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{gainers}</span>
      </div>
      <div className="flex items-center gap-1.5 bg-red-500/10 rounded-lg px-3 py-1.5">
        <TrendingDown className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
        <span className="text-xs font-medium text-red-700 dark:text-red-400">المنخفضة</span>
        <span className="text-sm font-bold text-red-600 dark:text-red-400">{losers}</span>
      </div>
      <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
        <Minus className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">الثابتة</span>
        <span className="text-sm font-bold">{unchanged}</span>
      </div>
      <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">متوسط التغير</span>
        <span
          className={cn(
            'text-sm font-bold tabular-nums',
            avgChange > 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : avgChange < 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-muted-foreground'
          )}
        >
          {avgChange >= 0 ? '+' : ''}
          {avgChange.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

// ─── Stock Card Component ─────────────────────────────────────────────────────

function StockCard({
  stock,
  onClick,
}: {
  stock: Stock;
  onClick: () => void;
}) {
  const change = stock.price_change || 0;
  const isPositive = change > 0;
  const isNegative = change < 0;
  const isNeutral = change === 0;

  // Mini bar: position of current price between high and low of the day
  const high = safeNum(stock.high_price);
  const low = safeNum(stock.low_price);
  const priceRange = high - low;
  const pricePosition = priceRange > 0 ? ((safeNum(stock.current_price) - low) / priceRange) * 100 : 50;

  return (
    <Card
      className="cursor-pointer group hover:shadow-md transition-all duration-200 hover:border-emerald-200 dark:hover:border-emerald-800/50 py-0 gap-0"
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Header: Ticker + Name + Indexes */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-base text-emerald-700 dark:text-emerald-400">
                {stock.ticker}
              </span>
              <div className="flex gap-1">
                {stock.egx30_member && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
                    30
                  </span>
                )}
                {stock.egx70_member && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                    70
                  </span>
                )}
                {stock.egx100_member && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 font-medium">
                    100
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground truncate mb-1" dir="rtl">
              {stock.name_ar}
            </p>
            <Badge variant="secondary" className="text-[10px] font-normal">
              {stock.sector}
            </Badge>
          </div>
          <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
            <ShareButton
              iconOnly
              variant="ghost"
              size="icon"
              stockData={{
                ticker: stock.ticker,
                name: stock.name,
                nameAr: stock.name_ar,
                price: stock.current_price,
                change: stock.price_change ?? undefined,
                sector: stock.sector,
              }}
            />
          </div>
        </div>

        {/* Price + Change */}
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-2xl font-bold tabular-nums tracking-tight">
              {safeNum(stock.current_price).toFixed(2)}
            </p>
            <p className="text-[10px] text-muted-foreground">جنيه مصري</p>
          </div>
          <div
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-bold tabular-nums',
              isPositive && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              isNegative && 'bg-red-500/10 text-red-600 dark:text-red-400',
              isNeutral && 'bg-muted text-muted-foreground'
            )}
          >
            {isPositive ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : isNegative ? (
              <TrendingDown className="w-3.5 h-3.5" />
            ) : (
              <Minus className="w-3.5 h-3.5" />
            )}
            {change >= 0 ? '+' : ''}
            {safeNum(change).toFixed(2)}%
          </div>
        </div>

        {/* Mini Price Bar */}
        <div className="mb-3">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden relative">
            <div
              className={cn(
                'absolute top-0 h-full rounded-full transition-all',
                isPositive
                  ? 'bg-gradient-to-l from-emerald-400 to-emerald-500'
                  : isNegative
                    ? 'bg-gradient-to-l from-red-400 to-red-500'
                    : 'bg-muted-foreground/30'
              )}
              style={{ width: `${Math.min(100, Math.max(0, pricePosition))}%` }}
            />
          </div>
          <div className="flex justify-between mt-0.5 text-[9px] text-muted-foreground tabular-nums">
            <span>{safeNum(low).toFixed(1)}</span>
            <span>{safeNum(high).toFixed(1)}</span>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">الحجم</p>
            <p className="text-xs font-semibold tabular-nums">{formatVolume(stock.volume)}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">مكرر الربحية</p>
            <p className="text-xs font-semibold tabular-nums">
              {stock.pe_ratio > 0 ? stock.pe_ratio.toFixed(1) : '—'}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">القيمة السوقية</p>
            <p className="text-xs font-semibold tabular-nums">{formatMarketCap(stock.market_cap)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Mobile Row Component ─────────────────────────────────────────────────────

function MobileStockRow({
  stock,
  onClick,
}: {
  stock: Stock;
  onClick: () => void;
}) {
  const change = stock.price_change || 0;
  const isPositive = change > 0;
  const isNegative = change < 0;

  return (
    <div
      className="p-4 active:bg-muted/50 cursor-pointer border-b border-border/50 last:border-0"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-sm text-emerald-700 dark:text-emerald-400">
              {stock.ticker}
            </span>
            <div className="flex gap-1">
              {stock.egx30_member && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
                  30
                </span>
              )}
              {stock.egx70_member && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  70
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground truncate mb-0.5" dir="rtl">
            {stock.name_ar}
          </p>
          <span className="text-[11px] text-muted-foreground">{stock.sector}</span>
        </div>
        <div className="text-left flex-shrink-0">
          <p className="font-bold text-sm tabular-nums">
            {safeNum(stock.current_price).toFixed(2)}
          </p>
          <p
            className={cn(
              'text-xs font-medium tabular-nums flex items-center gap-0.5 justify-end',
              isPositive
                ? 'text-emerald-600 dark:text-emerald-400'
                : isNegative
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-muted-foreground'
            )}
          >
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : isNegative ? (
              <TrendingDown className="w-3 h-3" />
            ) : (
              <Minus className="w-3 h-3" />
            )}
            {change >= 0 ? '+' : ''}
            {safeNum(change).toFixed(2)}%
          </p>
        </div>
        <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
          <ShareButton
            iconOnly
            variant="ghost"
            size="icon"
            stockData={{
              ticker: stock.ticker,
              name: stock.name,
              nameAr: stock.name_ar,
              price: stock.current_price,
              change: stock.price_change ?? undefined,
              sector: stock.sector,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main StocksView Component ────────────────────────────────────────────────

export function StocksView() {
  const {
    selectedTicker,
    currentView,
    stocks,
    isLoading,
    loadStocks,
    loadStockDetail,
  } = useAppStore();

  const showDetail = selectedTicker !== null && currentView === 'stock-detail';

  // ── Local filter / sort / view state ──
  const [localSearch, setLocalSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedSector, setSelectedSector] = useState('الكل');
  const [selectedIndex, setSelectedIndex] = useState('all');
  const [selectedSort, setSelectedSort] = useState('change-desc');
  const [priceRange, setPriceRange] = useState('all');
  const [changeFilter, setChangeFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  // ── Load stocks on mount ──
  useEffect(() => {
    loadStocks('');
  }, [loadStocks]);

  // ── Debounced search ──
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(localSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch]);

  // ── Filtered stocks ──
  const filteredStocks = useMemo(() => {
    return stocks.filter((stock) => {
      // Search filter
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const matchesSearch =
          stock.ticker.toLowerCase().includes(q) ||
          stock.name.toLowerCase().includes(q) ||
          stock.name_ar.includes(q);
        if (!matchesSearch) return false;
      }

      // Sector filter
      if (selectedSector !== 'الكل' && stock.sector !== selectedSector) {
        return false;
      }

      // Index filter
      if (selectedIndex === 'egx30' && !stock.egx30_member) return false;
      if (selectedIndex === 'egx70' && !stock.egx70_member) return false;
      if (selectedIndex === 'egx100' && !stock.egx100_member) return false;

      // Price range filter
      const price = safeNum(stock.current_price);
      if (priceRange === 'under-10' && price >= 10) return false;
      if (priceRange === '10-50' && (price < 10 || price > 50)) return false;
      if (priceRange === '50-100' && (price < 50 || price > 100)) return false;
      if (priceRange === 'over-100' && price <= 100) return false;

      // Change filter
      const change = stock.price_change ?? 0;
      if (changeFilter === 'gainers' && change <= 0) return false;
      if (changeFilter === 'losers' && change >= 0) return false;
      if (changeFilter === 'unchanged' && change !== 0) return false;

      return true;
    });
  }, [stocks, debouncedSearch, selectedSector, selectedIndex, priceRange, changeFilter]);

  // ── Sorted stocks ──
  const sortedStocks = useMemo(() => {
    const sorted = [...filteredStocks];
    switch (selectedSort) {
      case 'change-desc':
        sorted.sort((a, b) => (b.price_change ?? 0) - (a.price_change ?? 0));
        break;
      case 'change-asc':
        sorted.sort((a, b) => (a.price_change ?? 0) - (b.price_change ?? 0));
        break;
      case 'price-desc':
        sorted.sort((a, b) => safeNum(b.current_price) - safeNum(a.current_price));
        break;
      case 'price-asc':
        sorted.sort((a, b) => safeNum(a.current_price) - safeNum(b.current_price));
        break;
      case 'volume-desc':
        sorted.sort((a, b) => safeNum(b.volume) - safeNum(a.volume));
        break;
      case 'marketcap-desc':
        sorted.sort((a, b) => safeNum(b.market_cap) - safeNum(a.market_cap));
        break;
      case 'pe-asc':
        sorted.sort((a, b) => {
          const peA = a.pe_ratio > 0 ? a.pe_ratio : Infinity;
          const peB = b.pe_ratio > 0 ? b.pe_ratio : Infinity;
          return peA - peB;
        });
        break;
      case 'name-asc':
        sorted.sort((a, b) => a.name_ar.localeCompare(b.name_ar, 'ar'));
        break;
    }
    return sorted;
  }, [filteredStocks, selectedSort]);

  // ── Summary stats (from filtered stocks) ──
  const summaryStats = useMemo(() => {
    const total = filteredStocks.length;
    let gainers = 0;
    let losers = 0;
    let unchanged = 0;
    let changeSum = 0;
    let changeCount = 0;

    for (const stock of filteredStocks) {
      const change = stock.price_change ?? 0;
      if (change > 0) gainers++;
      else if (change < 0) losers++;
      else unchanged++;
      if (stock.price_change !== null) {
        changeSum += change;
        changeCount++;
      }
    }

    const avgChange = changeCount > 0 ? changeSum / changeCount : 0;

    return { total, gainers, losers, unchanged, avgChange };
  }, [filteredStocks]);

  // ── Pagination ──
  const totalPages = Math.max(1, Math.ceil(sortedStocks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedStocks = sortedStocks.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  // ── Handlers ──
  const handleRowClick = useCallback(
    (ticker: string) => {
      loadStockDetail(ticker);
    },
    [loadStockDetail]
  );

  const resetPage = useCallback(() => setPage(1), []);

  const handleSectorChange = useCallback((value: string) => {
    setSelectedSector(value);
    setPage(1);
  }, []);

  const handleIndexChange = useCallback((key: string) => {
    setSelectedIndex(key);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setLocalSearch(value);
    setPage(1);
  }, []);

  const handleClearSearch = useCallback(() => {
    setLocalSearch('');
    setDebouncedSearch('');
    setPage(1);
  }, []);

  const handleSortChange = useCallback((value: string) => {
    setSelectedSort(value);
    setPage(1);
  }, []);

  const handlePriceRangeChange = useCallback((value: string) => {
    setPriceRange(value);
    setPage(1);
  }, []);

  const handleChangeFilterChange = useCallback((value: string) => {
    setChangeFilter(value);
    setPage(1);
  }, []);

  const handleResetFilters = useCallback(() => {
    setLocalSearch('');
    setDebouncedSearch('');
    setSelectedSector('الكل');
    setSelectedIndex('all');
    setSelectedSort('change-desc');
    setPriceRange('all');
    setChangeFilter('all');
    setPage(1);
  }, []);

  const isInitialLoading = isLoading && stocks.length === 0;

  const hasActiveFilters =
    selectedSector !== 'الكل' ||
    selectedIndex !== 'all' ||
    priceRange !== 'all' ||
    changeFilter !== 'all' ||
    localSearch.length > 0;

  // ── Detail View ──
  if (showDetail) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header
          title="تفاصيل السهم"
        />
        <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
          <StockDetail />
        </main>
      </div>
    );
  }

  // ── Stocks List / Card View ──
  return (
    <div className="flex flex-col min-h-screen" dir="rtl">
      <Header
        title="الأسهم"
        subtitle="تصفح جميع الأسهم المتداولة في البورصة المصرية"
      />
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full space-y-4">
        {/* ── Quick Stock Lookup ── */}
        <Card className="py-0 gap-0">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-semibold">بحث سريع عن سهم</span>
            </div>
            <StockSelector
              placeholder="ابحث بالرمز (مثال: CIBC) أو بالاسم العربي..."
            />
          </CardContent>
        </Card>

        {/* ── Search + View Toggle + Sort ── */}
        <Card className="py-0 gap-0">
          <CardContent className="p-4 space-y-3">
            {/* Row 1: Search, View Toggle, Sort, Filter Toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={localSearch}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="ابحث بالاسم أو الرمز..."
                  className="pr-10 h-9"
                  dir="rtl"
                />
                {localSearch && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-6"
                    onClick={handleClearSearch}
                  >
                    ×
                  </Button>
                )}
              </div>

              {/* Sort */}
              <Select value={selectedSort} onValueChange={handleSortChange}>
                <SelectTrigger className="w-auto min-w-[170px] h-9 text-xs" size="sm">
                  <ArrowUpDown className="w-3.5 h-3.5 ml-1 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.key} value={opt.key} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Filter Toggle */}
              <Button
                variant={showFilters ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'h-9 gap-1.5 text-xs',
                  showFilters && 'bg-emerald-600 hover:bg-emerald-700'
                )}
                onClick={() => setShowFilters((prev) => !prev)}
              >
                <Filter className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">تصفية</span>
                {hasActiveFilters && (
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                )}
              </Button>

              {/* View Toggle */}
              <div className="flex items-center border rounded-md overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'p-2 transition-colors',
                    viewMode === 'list'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-background text-muted-foreground hover:bg-muted'
                  )}
                  title="عرض القائمة"
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('card')}
                  className={cn(
                    'p-2 transition-colors',
                    viewMode === 'card'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-background text-muted-foreground hover:bg-muted'
                  )}
                  title="عرض البطاقات"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Row 2: Filters (collapsible) */}
            {showFilters && (
              <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-border/50">
                {/* Sector */}
                <Select value={selectedSector} onValueChange={handleSectorChange}>
                  <SelectTrigger className="w-auto min-w-[130px] h-8 text-xs" size="sm">
                    <SelectValue placeholder="القطاع" />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTORS.map((sector) => (
                      <SelectItem key={sector} value={sector} className="text-xs">
                        {sector}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Index Chips */}
                <div className="flex gap-1.5 flex-wrap">
                  {INDEX_FILTERS.map((filter) => (
                    <button
                      key={filter.key}
                      onClick={() => handleIndexChange(filter.key)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border',
                        selectedIndex === filter.key
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-background text-muted-foreground border-border hover:bg-muted'
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                {/* Price Range */}
                <Select value={priceRange} onValueChange={handlePriceRangeChange}>
                  <SelectTrigger className="w-auto min-w-[130px] h-8 text-xs" size="sm">
                    <SelectValue placeholder="نطاق السعر" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRICE_RANGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Change Filter */}
                <Select value={changeFilter} onValueChange={handleChangeFilterChange}>
                  <SelectTrigger className="w-auto min-w-[130px] h-8 text-xs" size="sm">
                    <SelectValue placeholder="التغير" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANGE_FILTER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Reset */}
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground hover:text-foreground"
                    onClick={handleResetFilters}
                  >
                    إعادة تعيين
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Overview Summary Bar ── */}
        {isInitialLoading ? (
          <SummarySkeleton />
        ) : (
          <OverviewSummary
            total={summaryStats.total}
            gainers={summaryStats.gainers}
            losers={summaryStats.losers}
            unchanged={summaryStats.unchanged}
            avgChange={summaryStats.avgChange}
          />
        )}

        {/* ── Stock Content ── */}
        {isInitialLoading ? (
          viewMode === 'card' ? (
            <CardGridSkeleton />
          ) : (
            <Card className="py-0 overflow-hidden">
              <CardContent className="p-4">
                <TableSkeleton />
              </CardContent>
            </Card>
          )
        ) : paginatedStocks.length === 0 ? (
          <Card className="py-0 overflow-hidden">
            <CardContent className="p-12 text-center">
              <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">
                لا توجد أسهم مطابقة للبحث
              </p>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 text-xs"
                  onClick={handleResetFilters}
                >
                  إعادة تعيين الفلاتر
                </Button>
              )}
            </CardContent>
          </Card>
        ) : viewMode === 'card' ? (
          /* ── Card Grid View ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {paginatedStocks.map((stock) => (
              <StockCard
                key={stock.ticker}
                stock={stock}
                onClick={() => handleRowClick(stock.ticker)}
              />
            ))}
          </div>
        ) : (
          /* ── List / Table View ── */
          <Card className="py-0 overflow-hidden">
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-right font-semibold text-xs">الرمز</TableHead>
                      <TableHead className="text-right font-semibold text-xs">الاسم</TableHead>
                      <TableHead className="text-left font-semibold text-xs">السعر</TableHead>
                      <TableHead className="text-left font-semibold text-xs">التغيير</TableHead>
                      <TableHead className="text-left font-semibold text-xs">الحجم</TableHead>
                      <TableHead className="text-right font-semibold text-xs">القيمة السوقية</TableHead>
                      <TableHead className="text-left font-semibold text-xs">مكرر الربحية</TableHead>
                      <TableHead className="text-center font-semibold text-xs">المؤشرات</TableHead>
                      <TableHead className="text-center font-semibold text-xs w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedStocks.map((stock) => {
                      const change = stock.price_change || 0;
                      const isPositive = change > 0;
                      const isNegative = change < 0;
                      const isNeutral = change === 0;
                      return (
                        <TableRow
                          key={stock.ticker}
                          className="cursor-pointer group"
                          onClick={() => handleRowClick(stock.ticker)}
                        >
                          <TableCell>
                            <span className="font-bold text-sm text-emerald-700 dark:text-emerald-400">
                              {stock.ticker}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[160px] truncate text-sm" dir="rtl">
                              {stock.name_ar}
                            </div>
                          </TableCell>
                          <TableCell className="text-left">
                            <span className="font-semibold text-sm tabular-nums">
                              {safeNum(stock.current_price).toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="text-left">
                            <div
                              className={cn(
                                'flex items-center gap-1 justify-end text-sm font-medium tabular-nums',
                                isPositive
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : isNegative
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-muted-foreground'
                              )}
                            >
                              {isPositive ? (
                                <TrendingUp className="w-3.5 h-3.5" />
                              ) : isNegative ? (
                                <TrendingDown className="w-3.5 h-3.5" />
                              ) : (
                                <Minus className="w-3.5 h-3.5" />
                              )}
                              {change >= 0 ? '+' : ''}
                              {safeNum(change).toFixed(2)}%
                            </div>
                          </TableCell>
                          <TableCell className="text-left">
                            <span className="text-sm text-muted-foreground tabular-nums">
                              {formatVolume(stock.volume)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatMarketCap(stock.market_cap)}
                            </span>
                          </TableCell>
                          <TableCell className="text-left">
                            <span className="text-xs tabular-nums">
                              {stock.pe_ratio > 0 ? stock.pe_ratio.toFixed(1) : '—'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1 flex-wrap">
                              {stock.egx30_member && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
                                  30
                                </span>
                              )}
                              {stock.egx70_member && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                                  70
                                </span>
                              )}
                              {stock.egx100_member && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 font-medium">
                                  100
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div onClick={(e) => e.stopPropagation()}>
                              <ShareButton
                                iconOnly
                                variant="ghost"
                                size="icon"
                                stockData={{
                                  ticker: stock.ticker,
                                  name: stock.name,
                                  nameAr: stock.name_ar,
                                  price: stock.current_price,
                                  change: stock.price_change ?? undefined,
                                  sector: stock.sector,
                                }}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile List */}
              <div className="md:hidden divide-y divide-border/50">
                {paginatedStocks.map((stock) => (
                  <MobileStockRow
                    key={stock.ticker}
                    stock={stock}
                    onClick={() => handleRowClick(stock.ticker)}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
                  <span className="text-xs text-muted-foreground">
                    صفحة {safePage} من {totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                      className="h-8 px-3"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <div className="flex gap-1">
                      {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                        let pageNum: number;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (safePage <= 3) {
                          pageNum = i + 1;
                        } else if (safePage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = safePage - 2 + i;
                        }
                        return (
                          <Button
                            key={pageNum}
                            variant={safePage === pageNum ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setPage(pageNum)}
                            className={cn(
                              'h-8 w-8 p-0 text-xs',
                              safePage === pageNum && 'bg-emerald-600 hover:bg-emerald-700'
                            )}
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage === totalPages}
                      className="h-8 px-3"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          </Card>
        )}
      </main>
    </div>
  );
}

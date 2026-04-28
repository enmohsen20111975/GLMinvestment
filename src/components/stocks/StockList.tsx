'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  BarChart3,
} from 'lucide-react';
import { ShareButton } from '@/components/share/ShareButton';
import { useAppStore } from '@/lib/store';
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

const PAGE_SIZE = 10;

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(2) + 'M';
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'K';
  return vol.toString();
}

function StockRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      <Skeleton className="h-5 w-14 flex-shrink-0" />
      <Skeleton className="h-5 w-28 flex-1" />
      <Skeleton className="h-5 w-20 flex-shrink-0" />
      <Skeleton className="h-5 w-16 flex-shrink-0" />
      <Skeleton className="h-5 w-16 flex-shrink-0" />
      <div className="hidden md:block flex-shrink-0"><Skeleton className="h-5 w-20" /></div>
      <div className="hidden lg:block flex-shrink-0"><Skeleton className="h-5 w-16" /></div>
    </div>
  );
}

export function StockList() {
  const {
    stocks,
    isLoading,
    loadStocks,
    loadStockDetail,
    searchQuery,
  } = useAppStore();

  const [localSearch, setLocalSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSector, setSelectedSector] = useState('الكل');
  const [selectedIndex, setSelectedIndex] = useState('all');
  const [page, setPage] = useState(1);

  // Load all stocks on mount (no query to get full list)
  useEffect(() => {
    loadStocks('');
  }, [loadStocks]);

  // Debounced search via effect (sets state in timeout callback - allowed)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(localSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch]);

  // Filter stocks (derived from store + local filters)
  const filteredStocks = stocks.filter((stock) => {
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

    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filteredStocks.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const paginatedStocks = filteredStocks.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const handleRowClick = useCallback(
    (ticker: string) => {
      loadStockDetail(ticker);
    },
    [loadStockDetail]
  );

  // Reset page when filters change (called from event handlers, not effects)
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

  const isInitialLoading = isLoading && stocks.length === 0;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Search & Filters Bar */}
      <Card className="py-4">
        <CardContent className="space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={localSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="ابحث بالاسم أو الرمز..."
              className="pr-10 h-10"
              dir="rtl"
            />
            {localSearch && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={handleClearSearch}
              >
                ×
              </Button>
            )}
          </div>

          {/* Filter Row */}
          <div className="flex flex-wrap gap-3 items-center">
            {/* Sector Filter */}
            <Select value={selectedSector} onValueChange={handleSectorChange}>
              <SelectTrigger className="w-auto min-w-[140px]" size="sm">
                <SelectValue placeholder="القطاع" />
              </SelectTrigger>
              <SelectContent>
                {SECTORS.map((sector) => (
                  <SelectItem key={sector} value={sector}>
                    {sector}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Index Filter Chips */}
            <div className="flex gap-2 flex-wrap">
              {INDEX_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  onClick={() => handleIndexChange(filter.key)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                    selectedIndex === filter.key
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted'
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* Results count */}
            <span className="text-xs text-muted-foreground mr-auto">
              {filteredStocks.length} سهم
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Stock Table */}
      <Card className="py-0 overflow-hidden">
        {isInitialLoading ? (
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <StockRowSkeleton key={i} />
            ))}
          </CardContent>
        ) : paginatedStocks.length === 0 ? (
          <CardContent className="p-12 text-center">
            <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              لا توجد أسهم مطابقة للبحث
            </p>
          </CardContent>
        ) : (
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
                    <TableHead className="text-right font-semibold text-xs">القطاع</TableHead>
                    <TableHead className="text-center font-semibold text-xs">المؤشرات</TableHead>
                    <TableHead className="text-center font-semibold text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedStocks.map((stock) => {
                    const change = stock.price_change || 0;
                    const isPositive = change >= 0;
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
                                : 'text-red-600 dark:text-red-400'
                            )}
                          >
                            {isPositive ? (
                              <TrendingUp className="w-3.5 h-3.5" />
                            ) : (
                              <TrendingDown className="w-3.5 h-3.5" />
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
                          <Badge variant="secondary" className="text-xs font-normal">
                            {stock.sector}
                          </Badge>
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
                                change: stock.price_change,
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

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-border">
              {paginatedStocks.map((stock) => {
                const change = stock.price_change || 0;
                const isPositive = change >= 0;
                return (
                  <div
                    key={stock.ticker}
                    className="p-4 active:bg-muted/50 cursor-pointer"
                    onClick={() => handleRowClick(stock.ticker)}
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
                        <p className="text-xs text-muted-foreground truncate" dir="rtl">
                          {stock.name_ar}
                        </p>
                        <span className="text-[11px] text-muted-foreground">
                          {stock.sector}
                        </span>
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
                              : 'text-red-600 dark:text-red-400'
                          )}
                        >
                          {isPositive ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : (
                            <TrendingDown className="w-3 h-3" />
                          )}
                          {change >= 0 ? '+' : ''}
                          {safeNum(change).toFixed(2)}%
                        </p>
                      </div>
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
                            change: stock.price_change,
                            sector: stock.sector,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
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
        )}
      </Card>
    </div>
  );
}

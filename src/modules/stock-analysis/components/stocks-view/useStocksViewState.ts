/**
 * stocks-view/useStocksViewState.ts
 * ============================================================================
 * F-Phase3-Split-StocksView: container state + effects + derived data + handlers.
 *
 * قبل كده: كل الـ state / effects / memos / handlers كانوا inline في
 * StocksView.tsx (lines 873-1691, ~820 LOC).
 * دلوقتي: مستخرجين هنا → الـ container StocksView.tsx بقا render-only (<500 LOC).
 *
 * Behaviour preservation:
 *   - All useEffect dependencies match the original (including the
 *     eslint-disable-line react-hooks/exhaustive-deps on the market-change
 *     effect — original line 951).
 *   - All useMemo dependency arrays match the original.
 *   - All useCallback dependency arrays match the original.
 * ============================================================================
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Stock } from '@/types';
import { useAppStore } from '@/lib/store';
import { useStocksViewData } from '@/hooks/useStocksViewData';
import { safeNum } from '@/lib/utils';
import { GUEST_STOCK_LIMIT, PAGE_SIZE } from './constants';
import type { QuickFilterKey, StockTab } from './types';

export interface StocksViewState {
  // ── From store ──
  selectedTicker: string | null;
  currentView: string;
  stocks: Stock[];
  isLoading: boolean;
  currentMarket: string;
  isAuthenticated: boolean;
  loadStockDetail: (ticker: string) => void;

  // ── Derived ──
  isEGX: boolean;
  isCrypto: boolean;
  currencyLabel: string;
  showDetail: boolean;

  // ── UI state ──
  stockTab: StockTab;
  setStockTab: (t: StockTab) => void;
  localSearch: string;
  debouncedSearch: string;
  selectedSector: string;
  selectedIndex: string;
  priceRange: string;
  changeFilter: string;
  showFilters: boolean;
  setShowFilters: React.Dispatch<React.SetStateAction<boolean>>;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  selectedPreset: string;
  setSelectedPreset: React.Dispatch<React.SetStateAction<string>>;
  presetPeriod: string;
  setPresetPeriod: React.Dispatch<React.SetStateAction<string>>;

  // ── Advanced filters ──
  selectedSectors: string[];
  priceMin: string;
  priceMax: string;
  changeMin: string;
  changeMax: string;
  setPriceMin: (v: string) => void;
  setPriceMax: (v: string) => void;
  setChangeMin: (v: string) => void;
  setChangeMax: (v: string) => void;

  // ── Preset data (from useStocksViewData hook) ──
  presetData: Array<Record<string, unknown>>;
  presetLoading: boolean;
  presetScanDate: string | null;

  // ── Derived data ──
  filteredStocks: Stock[];
  sortedStocks: Stock[];
  isPresetMode: boolean;
  presetDisplayData: Array<Record<string, unknown>>;
  filteredPresetData: Array<Record<string, unknown>>;
  summaryStats: {
    total: number;
    gainers: number;
    losers: number;
    unchanged: number;
    avgChange: number;
  };
  baseData: Array<Stock | Record<string, unknown>>;
  displayData: Array<Stock | Record<string, unknown>>;
  totalPages: number;
  safePage: number;
  paginatedStocks: Array<Stock | Record<string, unknown>>;

  // ── Handlers ──
  handleRowClick: (ticker: string) => void;
  resetPage: () => void;
  handleSectorChange: (value: string) => void;
  handleIndexChange: (key: string) => void;
  handleSearchChange: (value: string) => void;
  handleClearSearch: () => void;
  handlePriceRangeChange: (value: string) => void;
  handleChangeFilterChange: (value: string) => void;
  handleResetFilters: () => void;
  handleToggleSector: (sector: string) => void;
  handleResetAdvanced: () => void;
  handlePresetSelect: (preset: string) => void;
  handleQuickFilter: (key: QuickFilterKey) => void;

  // ── Flags / extra memos ──
  activeQuickFilter: QuickFilterKey;
  isInitialLoading: boolean;
  hasActiveFilters: boolean;
  availableSectors: string[];
}

export function useStocksViewState(): StocksViewState {
  const {
    selectedTicker,
    currentView,
    stocks,
    isLoading,
    loadStocks,
    loadCryptoList,
    refreshLivePrices,
    loadStockDetail,
    currentMarket,
    isAuthenticated,
  } = useAppStore();

  const isEGX = currentMarket === 'EGX';
  const isCrypto = currentMarket === 'CRYPTO';
  const currencyLabel = isCrypto ? '$' : 'ج.م';
  const showDetail = selectedTicker !== null && currentView === 'stock-detail';

  // ── Local filter / sort / view state ──
  const [stockTab, setStockTab] = useState<StockTab>('stocks');
  const [localSearch, setLocalSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSector, setSelectedSector] = useState('الكل');
  const [selectedIndex, setSelectedIndex] = useState('all');
  const [priceRange, setPriceRange] = useState('all');
  const [changeFilter, setChangeFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedPreset, setSelectedPreset] = useState('all');
  const [presetPeriod, setPresetPeriod] = useState('1d');

  // ── Advanced filter state ──
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [changeMin, setChangeMin] = useState('');
  const [changeMax, setChangeMax] = useState('');

  const { presetData, presetLoading, presetScanDate } = useStocksViewData({
    selectedPreset,
    presetPeriod,
    currentMarket,
  });

  // ── Load stocks on mount + reload when market changes ──
  useEffect(() => {
    if (isCrypto) {
      loadCryptoList();
    } else {
      loadStocks('');
    }
    // Reset EGX-specific filters when switching markets
    setSelectedIndex('all');
    setSelectedSector('الكل');
    setLocalSearch('');
    setDebouncedSearch('');
    setSelectedSectors([]);
    setPriceMin('');
    setPriceMax('');
    setChangeMin('');
    setChangeMax('');
    setSelectedPreset('all');
    setStockTab('stocks');
    setPage(1);
  }, [loadStocks, loadCryptoList, currentMarket]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-refresh live prices every 30 seconds (EGX only) ──
  useEffect(() => {
    if (!isEGX) return;
    const interval = setInterval(() => {
      refreshLivePrices();
    }, 30000);
    return () => clearInterval(interval);
  }, [refreshLivePrices, isEGX]);

  // ── Crypto auto-refresh: reload full coin list every 60 seconds ──
  useEffect(() => {
    if (!isCrypto) return;
    const interval = setInterval(() => {
      loadCryptoList();
    }, 60000);
    return () => clearInterval(interval);
  }, [loadCryptoList, isCrypto]);

  // ── Debounced search ──
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(localSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch]);

  // ── Filtered stocks ──
  const filteredStocks = useMemo(() => {
    // FIX (BRAVO-DISASTER 2026-10-28): `stock.ticker` could be string — coerce to boolean
    const validStocks = stocks.filter((stock): stock is Stock => stock != null && Boolean(stock.ticker));

    const pMin = priceMin !== '' ? Number(priceMin) : null;
    const pMax = priceMax !== '' ? Number(priceMax) : null;
    const cMin = changeMin !== '' ? Number(changeMin) : null;
    const cMax = changeMax !== '' ? Number(changeMax) : null;

    return validStocks.filter((stock) => {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const matchesSearch =
          stock.ticker.toLowerCase().includes(q) ||
          stock.name.toLowerCase().includes(q) ||
          stock.name_ar.includes(q);
        if (!matchesSearch) return false;
      }

      if (selectedSector !== 'الكل' && stock.sector !== selectedSector) return false;
      if (selectedSectors.length > 0 && !selectedSectors.includes(stock.sector || '')) return false;
      if (selectedIndex === 'egx30' && !stock.egx30_member) return false;
      if (selectedIndex === 'egx70' && !stock.egx70_member) return false;
      if (selectedIndex === 'egx100' && !stock.egx100_member) return false;

      const price = safeNum(stock.current_price);
      if (priceRange === 'under-10' && price >= 10) return false;
      if (priceRange === '10-50' && (price < 10 || price > 50)) return false;
      if (priceRange === '50-100' && (price < 50 || price > 100)) return false;
      if (priceRange === 'over-100' && price <= 100) return false;

      if (pMin !== null && Number.isFinite(pMin) && price < pMin) return false;
      if (pMax !== null && Number.isFinite(pMax) && price > pMax) return false;

      const change = stock.price_change ?? 0;
      if (changeFilter === 'gainers' && change <= 0) return false;
      if (changeFilter === 'losers' && change >= 0) return false;
      if (changeFilter === 'unchanged' && change !== 0) return false;

      if (cMin !== null && Number.isFinite(cMin) && change < cMin) return false;
      if (cMax !== null && Number.isFinite(cMax) && change > cMax) return false;

      return true;
    });
  }, [stocks, debouncedSearch, selectedSector, selectedSectors, selectedIndex, priceRange, changeFilter, priceMin, priceMax, changeMin, changeMax]);

  // ── Sorted stocks (priority-based for search; otherwise rely on UnifiedTable initialSort) ──
  const sortedStocks = useMemo(() => {
    if (!debouncedSearch) return filteredStocks;
    const sorted = [...filteredStocks];
    const q = debouncedSearch.trim().toLowerCase();
    sorted.sort((a, b) => {
      const aTicker = (a.ticker || '').toLowerCase();
      const bTicker = (b.ticker || '').toLowerCase();
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aNameAr = a.name_ar || '';
      const bNameAr = b.name_ar || '';

      if (aTicker === q && bTicker !== q) return -1;
      if (bTicker === q && aTicker !== q) return 1;

      const aStartsTicker = aTicker.startsWith(q);
      const bStartsTicker = bTicker.startsWith(q);
      if (aStartsTicker && !bStartsTicker) return -1;
      if (!aStartsTicker && bStartsTicker) return 1;

      const aInTicker = aTicker.includes(q);
      const bInTicker = bTicker.includes(q);
      if (aInTicker && !bInTicker) return -1;
      if (!aInTicker && bInTicker) return 1;

      const aStartsName = aName.startsWith(q) || aNameAr.startsWith(q);
      const bStartsName = bName.startsWith(q) || bNameAr.startsWith(q);
      if (aStartsName && !bStartsName) return -1;
      if (!aStartsName && bStartsName) return 1;

      return 0;
    });
    return sorted;
  }, [filteredStocks, debouncedSearch]);

  const isPresetMode = selectedPreset !== 'all';
  const presetDisplayData = useMemo(() => {
    if (!isPresetMode) return [];
    return presetData;
  }, [isPresetMode, presetData]);

  // ── Summary stats ──
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

  // ── Apply filters to preset data too ──
  const filteredPresetData = useMemo(() => {
    if (!isPresetMode || presetDisplayData.length === 0) return [];

    const pMin = priceMin !== '' ? Number(priceMin) : null;
    const pMax = priceMax !== '' ? Number(priceMax) : null;
    const cMin = changeMin !== '' ? Number(changeMin) : null;
    const cMax = changeMax !== '' ? Number(changeMax) : null;

    return presetDisplayData.filter((stock: Record<string, unknown>) => {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        // FIX (BRAVO-DISASTER 2026-10-28): coerce to string before .toLowerCase() — Record<string, unknown> doesn't know types
        const ticker = String(stock.ticker || '').toLowerCase();
        const name = String(stock.name || '').toLowerCase();
        const name_ar = String(stock.name_ar || '');
        if (!ticker.includes(q) && !name.includes(q) && !name_ar.includes(q)) return false;
      }
      if (selectedSector !== 'الكل' && stock.sector !== selectedSector) return false;
      if (selectedSectors.length > 0 && !selectedSectors.includes(String(stock.sector || ''))) return false;
      if (selectedIndex === 'egx30' && !stock.egx30_member) return false;
      if (selectedIndex === 'egx70' && !stock.egx70_member) return false;
      if (selectedIndex === 'egx100' && !stock.egx100_member) return false;
      const price = Number(stock.current_price || stock.price || 0);
      if (priceRange === 'under-10' && price >= 10) return false;
      if (priceRange === '10-50' && (price < 10 || price > 50)) return false;
      if (priceRange === '50-100' && (price < 50 || price > 100)) return false;
      if (priceRange === 'over-100' && price <= 100) return false;
      if (pMin !== null && Number.isFinite(pMin) && price < pMin) return false;
      if (pMax !== null && Number.isFinite(pMax) && price > pMax) return false;
      const change = Number(stock.change_1d ?? stock.price_change ?? stock.change ?? 0);
      if (changeFilter === 'gainers' && change <= 0) return false;
      if (changeFilter === 'losers' && change >= 0) return false;
      if (changeFilter === 'unchanged' && change !== 0) return false;
      if (cMin !== null && Number.isFinite(cMin) && change < cMin) return false;
      if (cMax !== null && Number.isFinite(cMax) && change > cMax) return false;
      return true;
    });
  }, [isPresetMode, presetDisplayData, debouncedSearch, selectedSector, selectedSectors, selectedIndex, priceRange, priceMin, priceMax, changeMin, changeMax, changeFilter]);

  // ── Pagination ──
  const baseData = isPresetMode ? filteredPresetData : sortedStocks;
  const displayData = !isAuthenticated ? baseData.slice(0, GUEST_STOCK_LIMIT) : baseData;
  const totalPages = Math.max(1, Math.ceil(displayData.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedStocks = displayData.slice(
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
    setSelectedSectors([]);
    setSelectedIndex('all');
    setPriceRange('all');
    setChangeFilter('all');
    setPriceMin('');
    setPriceMax('');
    setChangeMin('');
    setChangeMax('');
    setPage(1);
  }, []);

  const handleToggleSector = useCallback((sector: string) => {
    setSelectedSectors((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]
    );
    setPage(1);
  }, []);

  const handleResetAdvanced = useCallback(() => {
    setSelectedSectors([]);
    setPriceMin('');
    setPriceMax('');
    setChangeMin('');
    setChangeMax('');
    setPage(1);
  }, []);

  const handlePresetSelect = useCallback((preset: string) => {
    setSelectedPreset(preset);
    setPresetPeriod('1d');
    setPage(1);
  }, []);

  const handleQuickFilter = useCallback((key: QuickFilterKey) => {
    setPage(1);
    if (key === 'all') {
      setSelectedIndex('all');
      setSelectedPreset('all');
    } else if (key === 'egx30' || key === 'egx70') {
      setSelectedIndex(key);
      setSelectedPreset('all');
    } else {
      setSelectedPreset(key);
      setSelectedIndex('all');
      setPresetPeriod('1d');
    }
  }, []);

  const activeQuickFilter: QuickFilterKey = useMemo(() => {
    if (selectedPreset === 'top_gainers') return 'top_gainers';
    if (selectedPreset === 'top_losers') return 'top_losers';
    if (selectedPreset === 'most_active') return 'most_active';
    if (selectedIndex === 'egx30') return 'egx30';
    if (selectedIndex === 'egx70') return 'egx70';
    return 'all';
  }, [selectedPreset, selectedIndex]);

  const isInitialLoading = isLoading && stocks.length === 0;

  const hasActiveFilters =
    selectedSector !== 'الكل' ||
    selectedSectors.length > 0 ||
    selectedIndex !== 'all' ||
    priceRange !== 'all' ||
    changeFilter !== 'all' ||
    priceMin !== '' ||
    priceMax !== '' ||
    changeMin !== '' ||
    changeMax !== '' ||
    localSearch.length > 0;

  const availableSectors = useMemo(() => {
    const set = new Set<string>();
    for (const s of stocks) {
      if (s && s.sector) set.add(s.sector);
    }
    return Array.from(set).sort((a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ar'));
  }, [stocks]);

  return {
    selectedTicker,
    currentView,
    stocks,
    isLoading,
    currentMarket,
    isAuthenticated,
    loadStockDetail,
    isEGX,
    isCrypto,
    currencyLabel,
    showDetail,
    stockTab,
    setStockTab,
    localSearch,
    debouncedSearch,
    selectedSector,
    selectedIndex,
    priceRange,
    changeFilter,
    showFilters,
    setShowFilters,
    page,
    setPage,
    selectedPreset,
    setSelectedPreset,
    presetPeriod,
    setPresetPeriod,
    selectedSectors,
    priceMin,
    priceMax,
    changeMin,
    changeMax,
    setPriceMin,
    setPriceMax,
    setChangeMin,
    setChangeMax,
    presetData,
    presetLoading,
    presetScanDate,
    filteredStocks,
    sortedStocks,
    isPresetMode,
    presetDisplayData,
    filteredPresetData,
    summaryStats,
    baseData,
    displayData,
    totalPages,
    safePage,
    paginatedStocks,
    handleRowClick,
    resetPage,
    handleSectorChange,
    handleIndexChange,
    handleSearchChange,
    handleClearSearch,
    handlePriceRangeChange,
    handleChangeFilterChange,
    handleResetFilters,
    handleToggleSector,
    handleResetAdvanced,
    handlePresetSelect,
    handleQuickFilter,
    activeQuickFilter,
    isInitialLoading,
    hasActiveFilters,
    availableSectors,
  };
}

'use client';

/**
 * MultiChartScreener — شاشة متعددة الشارتلات شبيهة بـ TradingView.
 *
 * المكوّنات الأساسية:
 *  - TopToolbar: بحث سريع + selector للسوق + selector للـ timeframe + أزرار + selector للأعمدة
 *  - WatchlistSidebar (يمين، collapsible): قائمة مراقبة بـ sparklines + بحث + قطاعات
 *  - ChartsGrid: شبكة من ChartCard قابلة للسحب وإعادة الترتيب + resizable
 *  - BottomPanel: 3 تبويبات (المسح / التفاصيل / الأخبار)
 *
 * كل البيانات تأتي من APIs:
 *  - GET /api/stocks?market={M}&limit=500
 *  - GET /api/stocks/{ticker}/history?days={N}
 *  - GET /api/stocks/{ticker}
 *  - GET /api/stocks/{ticker}/news
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  LayoutGrid,
  Save,
  RefreshCw,
  Plus,
  Search,
  Columns,
  Trash2,
  PanelRightOpen,
  PanelRightClose,
  X,
  BarChart3,
  ExternalLink,
  Filter,
  Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useAppStore, MARKET_NAMES_AR, type MarketType } from '@/lib/store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ChartCard } from './ChartCard';
import { WatchlistSidebar, type WatchlistStock } from './WatchlistSidebar';
import { BottomPanel } from './BottomPanel';
import { ComparisonChartCard } from './ComparisonChartCard';
import { TradingViewChart } from '@/components/stocks/TradingViewChart';
import type { OhlcvPoint } from './chartIndicators';

// ─── الثوابت والـ Presets ──────────────────────────────────────────────────

const TIMEFRAMES = [
  { key: '1W', label: 'أسبوع', days: 7 },
  { key: '1M', label: 'شهر', days: 30 },
  { key: '3M', label: '3 أشهر', days: 90 },
  { key: '6M', label: '6 أشهر', days: 180 },
  { key: '1Y', label: 'سنة', days: 365 },
] as const;

// أسهم مصرية فقط — الأسواق الأخرى (سعودي/كويت/قطر) بتظهر tickers رقمية
// مش مدعومة كويس في الـ EGX-only screener، فبنسيبها فاضية.
const DEFAULT_STOCKS_BY_MARKET: Record<MarketType, string[]> = {
  EGX: ['COMI', 'FWRY', 'EFID', 'HRHO'],
  TADAWUL: [],
  KSE: [],
  QSE: [],
  CRYPTO: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'],
};

/**
 * يتحقق إذا كان الـ ticker تابع لسوق غير EGX.
 * الأسهم السعودية (TADAWUL) بتستخدم tickers رقمية بالكامل (مثل 1120, 2222).
 * بعض الأسواق الخليجية الأخرى ممكن تستخدم بادئات رقمية كمان.
 * نعتبر أي ticker مكون من أرقام فقط كسهم غير مصري.
 */
function isNonEgxTicker(ticker: string): boolean {
  return /^\d+$/.test(ticker);
}

/** ينقّي قائمة الأسهم ليُبقي فقط على الأسهم المصرية (EGX). */
function filterEgxOnly<T extends { ticker: string }>(stocks: T[]): T[] {
  return stocks.filter(s => !isNonEgxTicker(s.ticker));
}

const MARKET_OPTIONS: { value: MarketType; label: string }[] = [
  { value: 'EGX', label: 'البورصة المصرية' },
  { value: 'TADAWUL', label: 'السوق السعودي' },
  { value: 'KSE', label: 'بورصة الكويت' },
  { value: 'QSE', label: 'بورصة قطر' },
];

// ─── أنواع البيانات الداخلية ──────────────────────────────────────────────

interface StockListItem {
  ticker: string;
  name: string;
  name_ar: string;
  sector?: string | null;
  current_price?: number | null;
  price_change?: number | null;
  volume?: number | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
}

// ─── Sortable Chart Wrapper ────────────────────────────────────────────────

interface SortableChartProps {
  ticker: string;
  renderCard: (handleProps: Record<string, unknown>) => React.ReactNode;
}

function SortableChart({ ticker, renderCard }: SortableChartProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ticker });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    height: '100%',
  };

  return (
    <div ref={setNodeRef} style={style} className="h-full">
      {renderCard({ ...attributes, ...listeners } as Record<string, unknown>)}
    </div>
  );
}

// ─── المكوّن الرئيسي ──────────────────────────────────────────────────────

export function MultiChartScreener() {
  const { currentMarket, setCurrentMarket, setCurrentView, setSelectedTicker } = useAppStore();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // ─── الحالة (State) ──
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [allStocks, setAllStocks] = useState<StockListItem[]>([]);
  const [watchlistHistories, setWatchlistHistories] = useState<Record<string, OhlcvPoint[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [timeframe, setTimeframe] = useState<string>('6M');
  const [chartType, setChartType] = useState<'area' | 'candlestick'>('candlestick');
  const [columns, setColumns] = useState<number>(2);
  const [loadingStocks, setLoadingStocks] = useState(true);
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(false);
  const [selectedTickerInPanel, setSelectedTickerInPanel] = useState<string | null>(null);
  const [maximizedTicker, setMaximizedTicker] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'compare'>('grid');
  const [chartTicker, setChartTicker] = useState<string | null>(null);

  // مرجع لتتبع الـ histories قيد التحميل (لتجنب التكرار)
  const historiesLoadingRef = useRef<Set<string>>(new Set());

  // ─── تحميل التخطيط من LocalStorage أو الافتراضي ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const layoutKey = `screener_stocks_${currentMarket}`;
    const colsKey = `screener_columns_${currentMarket}`;
    const savedTickers = localStorage.getItem(layoutKey);
    const savedCols = localStorage.getItem(colsKey);
    const savedCollapse = localStorage.getItem('screener_watchlist_collapsed');
    const savedViewMode = localStorage.getItem('screener_view_mode');

    if (savedTickers) {
      try {
        const arr = JSON.parse(savedTickers);
        if (Array.isArray(arr) && arr.length > 0) {
          setSelectedTickers(arr);
        } else {
          setSelectedTickers(DEFAULT_STOCKS_BY_MARKET[currentMarket] || []);
        }
      } catch {
        setSelectedTickers(DEFAULT_STOCKS_BY_MARKET[currentMarket] || []);
      }
    } else {
      setSelectedTickers(DEFAULT_STOCKS_BY_MARKET[currentMarket] || []);
    }
    if (savedCols) {
      const c = parseInt(savedCols, 10);
      if ([1, 2, 3, 4].includes(c)) setColumns(c);
    }
    if (savedCollapse === 'true') setWatchlistCollapsed(true);
    if (savedViewMode === 'compare' || savedViewMode === 'grid') {
      setViewMode(savedViewMode);
    }
    // إعادة تعيين السهم المختار عند تغيير السوق
    setSelectedTickerInPanel(null);
    setMaximizedTicker(null);
  }, [currentMarket]);

  // ─── تحميل قائمة الأسهم ──
  useEffect(() => {
    let cancelled = false;
    async function loadStocks() {
      setLoadingStocks(true);
      try {
        // بنمرّر market=EGX (أو السوق الحالي) بشكل صريح في الـ query string
        const params = new URLSearchParams({
          market: currentMarket,
          limit: '500',
        });
        const res = await fetch(`/api/stocks?${params.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.success && Array.isArray(json.stocks)) {
          // الـ API أحيانًا بيرجّع أسهم من كل الأسواق رغم تمرير market=EGX،
          // فبنفلتر في الـ frontend عشان نتأكد إننا بنعرض أسهم مصرية بس
          // (بنشيل أي ticker رقمي بالكامل — ده شكل tickers السعودية/الخليجية).
          setAllStocks(filterEgxOnly(json.stocks as StockListItem[]));
        } else {
          setAllStocks([]);
        }
      } catch {
        if (!cancelled) toast.error('فشل تحميل قائمة الأسهم');
      } finally {
        if (!cancelled) setLoadingStocks(false);
      }
    }
    loadStocks();
    return () => { cancelled = true; };
  }, [currentMarket]);

  // ─── تحميل بيانات Sparkline لأسهم القائمة (بشكل lazy في الخلفية) ──
  useEffect(() => {
    if (allStocks.length === 0) return;
    let cancelled = false;
    async function loadHistories() {
      // نأخذ أول 40 سهم فقط لتسريع التحميل
      const tickersToLoad = allStocks.slice(0, 40)
        .map(s => s.ticker)
        .filter(t => !watchlistHistories[t] && !historiesLoadingRef.current.has(t));
      if (tickersToLoad.length === 0) return;
      tickersToLoad.forEach(t => historiesLoadingRef.current.add(t));

      // تحميل متوازي محدود (5 في المرة)
      const batchSize = 5;
      for (let i = 0; i < tickersToLoad.length; i += batchSize) {
        if (cancelled) return;
        const batch = tickersToLoad.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async t => {
            try {
              const res = await fetch(`/api/stocks/${t}/history?days=30`);
              if (!res.ok) return { t, data: [] as OhlcvPoint[] };
              const json = await res.json();
              if (json.success && Array.isArray(json.data)) {
                const sorted = [...json.data].sort(
                  (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
                );
                return { t, data: sorted };
              }
              return { t, data: [] as OhlcvPoint[] };
            } catch {
              return { t, data: [] as OhlcvPoint[] };
            }
          })
        );
        if (cancelled) return;
        setWatchlistHistories(prev => {
          const next = { ...prev };
          results.forEach(({ t, data }) => {
            next[t] = data;
          });
          return next;
        });
      }
    }
    loadHistories();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStocks]);

  // ─── حفظ التخطيط ──
  const handleSaveLayout = () => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`screener_stocks_${currentMarket}`, JSON.stringify(selectedTickers));
    localStorage.setItem(`screener_columns_${currentMarket}`, String(columns));
    toast.success('تم حفظ التخطيط الحالي بنجاح');
  };

  // ─── مشاركة النتائج ──
  const handleShareResults = () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tickers', selectedTickers.join(','));
    navigator.clipboard.writeText(url.toString());
    toast.success('تم نسخ رابط النتائج للحافظة');
  };

  // ─── الفلاتر المتقدمة ──
  const handleOpenFilters = () => {
    toast.info('تم فتح واجهة الفلاتر المتقدمة (قيد التطوير: سيتم ربطها بالمؤشرات)');
    // يمكن لاحقاً إضافة حالة لفتح Modal يحتوي على فلاتر RSI و MACD
  };

  // ─── إضافة سهم للشاشة ──
  const handleAddStock = (ticker: string) => {
    const formatted = ticker.toUpperCase();
    if (selectedTickers.includes(formatted)) {
      toast.error('السهم موجود بالفعل في الشاشة');
      return;
    }
    setSelectedTickers(prev => [...prev, formatted]);
    setSearchQuery('');
    setShowSuggestions(false);
    toast.success(`تمت إضافة ${formatted} للشاشة`);
  };

  // ─── حذف سهم من الشاشة ──
  const handleRemoveStock = (ticker: string) => {
    setSelectedTickers(prev => prev.filter(t => t !== ticker));
    if (selectedTickerInPanel === ticker) setSelectedTickerInPanel(null);
    if (maximizedTicker === ticker) setMaximizedTicker(null);
    toast.info(`تم حذف ${ticker} من الشاشة`);
  };

  // ─── إعادة التعيين للوضع الافتراضي ──
  const handleResetDefault = () => {
    setSelectedTickers(DEFAULT_STOCKS_BY_MARKET[currentMarket] || []);
    setColumns(2);
    toast.info('تمت إعادة تعيين الشاشة للوضع الافتراضي (2×2)');
  };

  // ─── مسح كل الشاشات ──
  const handleClearAll = () => {
    setSelectedTickers([]);
    setMaximizedTicker(null);
    toast.warning('تم مسح جميع الشاشات');
  };

  // ─── التنقل لتفاصيل السهم ──
  const handleNavigateDetail = (ticker: string) => {
    setSelectedTicker(ticker);
    setCurrentView('stock-detail');
  };

  // ─── تبديل طي قائمة المراقبة ──
  const handleToggleWatchlist = () => {
    const next = !watchlistCollapsed;
    setWatchlistCollapsed(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('screener_watchlist_collapsed', String(next));
    }
  };

  // ─── تبديل طريقة العرض (شبكة / مقارنة) ──
  const handleToggleViewMode = (mode: 'grid' | 'compare') => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('screener_view_mode', mode);
    }
  };

  // ─── تبديل تكبير بطاقة ──
  const handleToggleMaximize = (ticker: string) => {
    setMaximizedTicker(prev => (prev === ticker ? null : ticker));
  };

  // ─── فتح شارت تفصيلي (TradingViewChart) ──
  const handleOpenChart = (ticker: string) => {
    setChartTicker(ticker);
  };

  const handleCloseChart = () => {
    setChartTicker(null);
  };

  // ─── DnD Sensors ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ─── نهاية السحب ──
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSelectedTickers(prev => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  // ─── فلترة اقتراحات البحث ──
  const filteredSuggestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [];
    return allStocks
      .filter(stock =>
        stock.ticker.toLowerCase().includes(q) ||
        (stock.name || '').toLowerCase().includes(q) ||
        (stock.name_ar || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [allStocks, searchQuery]);

  // ─── بيانات الأسهم في الشاشة ──
  const gridStocks = useMemo(
    () =>
      selectedTickers.map(ticker => {
        const stockObj = allStocks.find(s => s.ticker === ticker);
        return {
          ticker,
          name: stockObj?.name || ticker,
          nameAr: stockObj?.name_ar || ticker,
          sector: stockObj?.sector,
          currentPrice: stockObj?.current_price || 0,
          priceChange: stockObj?.price_change || 0,
        };
      }),
    [selectedTickers, allStocks]
  );

  // ─── أسهم قائمة المراقبة (مع sparkline data) ──
  const watchlistStocks: WatchlistStock[] = useMemo(
    () =>
      allStocks.map(s => ({
        ticker: s.ticker,
        name: s.name,
        name_ar: s.name_ar,
        sector: s.sector,
        current_price: s.current_price,
        price_change: s.price_change,
        history: watchlistHistories[s.ticker],
      })),
    [allStocks, watchlistHistories]
  );

  // ─── بيانات الـ BottomPanel (نفس شكل allStocks + history) ──
  const screenerStocks = useMemo(
    () =>
      allStocks.map(s => ({
        ...s,
        history: watchlistHistories[s.ticker],
      })),
    [allStocks, watchlistHistories]
  );

  const tf = TIMEFRAMES.find(t => t.key === timeframe);
  const tfDays = tf ? tf.days : 180;

  // ─── عرض سهم واحد مكبّر ──
  if (maximizedTicker) {
    const stock = gridStocks.find(s => s.ticker === maximizedTicker);
    if (stock) {
      return (
        <div className="flex flex-col gap-4 p-4 md:p-6 h-screen" dir="rtl">
          {/* رأس مختصر */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-bold text-foreground">
                عرض موسّع: {stock.nameAr || stock.name}
              </h2>
              <Badge variant="outline" className="text-[10px]">{stock.ticker}</Badge>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setMaximizedTicker(null)}
              >
                <X className="w-3.5 h-3.5" />
                خروج من العرض الموسّع
              </Button>
              <Button
                variant="default"
                size="sm"
                className="gap-1.5"
                onClick={() => handleOpenChart(stock.ticker)}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                شارت تفصيلي
              </Button>
            </div>
          </div>
          {/* الشارت المكبّر */}
          <div className="flex-1 min-h-0">
            <TradingViewChart
              ticker={stock.ticker}
              stockName={stock.nameAr || stock.name}
              height={window.innerHeight - 160}
            />
          </div>
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3 md:p-4" dir="rtl">
      {/* ─── الرأس الرئيسي ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <LayoutGrid className="w-5 h-5 md:w-6 md:h-6 text-emerald-500" />
            الشاشات المتعددة ومقارنة الأسعار
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            تتبع ومقارنة حركة الأسعار لعدة أسهم معًا في لوحة تحكم موحدة (سوق: {MARKET_NAMES_AR[currentMarket]})
          </p>
        </div>

        {/* أزرار التحكم العلوية */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={handleOpenFilters}>
            <Filter className="w-3.5 h-3.5 text-blue-500" />
            فلاتر
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={handleShareResults}>
            <Share2 className="w-3.5 h-3.5 text-green-500" />
            مشاركة
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={handleSaveLayout}>
            <Save className="w-3.5 h-3.5" />
            حفظ التخطيط
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-9 text-muted-foreground" onClick={handleResetDefault}>
            <RefreshCw className="w-3.5 h-3.5" />
            الافتراضي
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-rose-500 hover:text-rose-600 hover:bg-rose-500/5"
            onClick={handleClearAll}
            disabled={selectedTickers.length === 0}
          >
            <Trash2 className="w-3.5 h-3.5 ml-1" />
            مسح الكل
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={handleToggleWatchlist}
            title={watchlistCollapsed ? 'إظهار قائمة المراقبة' : 'إخفاء قائمة المراقبة'}
          >
            {watchlistCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* ─── شريط الأدوات العلوي ─── */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between p-2.5 rounded-xl border border-border bg-muted/20">
        {/* البحث السريع + selector للسوق */}
        <div className="flex items-center gap-2 flex-1 max-w-2xl">
          {/* Selector للسوق */}
          <select
            className="h-9 px-2.5 text-xs rounded-lg border border-border bg-card font-medium text-foreground shrink-0"
            value={currentMarket}
            onChange={e => setCurrentMarket(e.target.value as MarketType)}
            title="السوق"
          >
            {MARKET_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* بحث سريع مع autocomplete */}
          <div className="relative flex-1">
            <div className="relative">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="ابحث بالرمز أو الاسم لإضافة سهم للشاشة..."
                className="pr-9 h-9 text-xs"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && filteredSuggestions.length > 0) {
                    handleAddStock(filteredSuggestions[0].ticker);
                  } else if (e.key === 'Escape') {
                    setShowSuggestions(false);
                  }
                }}
              />
              {searchQuery && (
                <button
                  className="absolute left-2 top-2 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSearchQuery(''); setShowSuggestions(false); }}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* قائمة الاقتراحات */}
            {showSuggestions && searchQuery && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSuggestions(false)} />
                <div className="absolute right-0 left-0 mt-1 z-50 rounded-lg border border-border bg-popover shadow-xl max-h-72 overflow-y-auto p-1">
                  {filteredSuggestions.length > 0 ? (
                    filteredSuggestions.map(stock => {
                      const alreadyAdded = selectedTickers.includes(stock.ticker);
                      return (
                        <button
                          key={stock.ticker}
                          onClick={() => handleAddStock(stock.ticker)}
                          className="w-full text-right px-3 py-2 text-xs rounded hover:bg-accent hover:text-accent-foreground flex items-center justify-between transition-colors min-h-[36px] disabled:opacity-50"
                          disabled={alreadyAdded}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-foreground">{stock.ticker}</span>
                            <span className="text-muted-foreground truncate max-w-[150px]">{stock.name_ar}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {stock.sector && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0">{stock.sector}</Badge>
                            )}
                            {alreadyAdded ? (
                              <span className="text-[9px] text-emerald-600">مضاف ✓</span>
                            ) : (
                              <Plus className="w-3 h-3 text-muted-foreground" />
                            )}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="p-3 text-center text-xs text-muted-foreground">
                      {loadingStocks ? 'جاري البحث...' : 'لا توجد نتائج مطابقة'}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* زر إضافة سهم */}
          <Button
            variant="default"
            size="sm"
            className="h-9 gap-1.5 shrink-0"
            onClick={() => {
              if (filteredSuggestions.length > 0) {
                handleAddStock(filteredSuggestions[0].ticker);
              } else if (searchQuery.trim()) {
                handleAddStock(searchQuery.trim().toUpperCase());
              } else {
                toast.info('اكتب رمز أو اسم سهم أولًا');
              }
            }}
            title="أضف للشاشة"
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة
          </Button>
        </div>

        {/* إعدادات الشارت */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* الفترة الزمنية */}
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground font-medium hidden sm:inline">الفترة:</span>
            <div className="flex rounded-lg border border-border bg-card p-0.5">
              {TIMEFRAMES.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTimeframe(t.key)}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-all font-medium text-[11px]',
                    timeframe === t.key
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* طريقة العرض */}
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground font-medium hidden sm:inline">طريقة العرض:</span>
            <div className="flex rounded-lg border border-border bg-card p-0.5">
              <button
                onClick={() => handleToggleViewMode('grid')}
                className={cn(
                  'px-2.5 py-1 rounded-md transition-all font-medium text-[11px]',
                  viewMode === 'grid'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                شبكة
              </button>
              <button
                onClick={() => handleToggleViewMode('compare')}
                className={cn(
                  'px-2.5 py-1 rounded-md transition-all font-medium text-[11px]',
                  viewMode === 'compare'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                مقارنة
              </button>
            </div>
          </div>

          {/* نمط الشارت (مخفي في وضع المقارنة) */}
          {viewMode === 'grid' && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground font-medium hidden sm:inline">النمط:</span>
              <div className="flex rounded-lg border border-border bg-card p-0.5">
                <button
                  onClick={() => setChartType('candlestick')}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-all font-medium text-[11px]',
                    chartType === 'candlestick'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  شموع
                </button>
                <button
                  onClick={() => setChartType('area')}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-all font-medium text-[11px]',
                    chartType === 'area'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  مساحة
                </button>
              </div>
            </div>
          )}

          {/* عدد الأعمدة (مخفي في وضع المقارنة) */}
          {viewMode === 'grid' && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground font-medium hidden sm:inline">أعمدة:</span>
              <div className="flex rounded-lg border border-border bg-card p-0.5">
                {[1, 2, 3, 4].map(col => (
                  <button
                    key={col}
                    onClick={() => setColumns(col)}
                    className={cn(
                      'w-7 h-6 flex items-center justify-center rounded-md transition-all font-bold text-[11px]',
                      columns === col
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    title={`${col} عمود`}
                  >
                    {col}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── المحتوى الرئيسي: قائمة المراقبة + الشاشات ─── */}
      <div className="flex flex-row-reverse gap-3 min-h-[80vh]">
        {/* قائمة المراقبة */}
        <WatchlistSidebar
          stocks={watchlistStocks}
          isCollapsed={watchlistCollapsed}
          onToggleCollapse={handleToggleWatchlist}
          onAddToChart={handleAddStock}
          onOpenDetail={ticker => setSelectedTickerInPanel(ticker)}
          addedTickers={selectedTickers}
          loading={loadingStocks}
        />

        {/* شبكة الشارتلات أو شارت المقارنة */}
        <div className="flex-1 min-w-0">
          {viewMode === 'compare' ? (
            <ComparisonChartCard
              tickers={selectedTickers}
              allStocks={allStocks}
              timeframe={timeframe}
              timeframeDays={tfDays}
              isDark={isDark}
              onRemoveTicker={handleRemoveStock}
              onAddTicker={handleAddStock}
              onClearAll={handleClearAll}
            />
          ) : gridStocks.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={e => setActiveDragId(e.active.id as string)}
              onDragCancel={() => setActiveDragId(null)}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={selectedTickers} strategy={rectSortingStrategy}>
                <div
                  className={cn(
                    'grid gap-3 h-full',
                    columns === 1 && 'grid-cols-1',
                    columns === 2 && 'grid-cols-1 md:grid-cols-2',
                    columns === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
                    columns === 4 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                  )}
                  style={{ minHeight: '600px' }}
                  onDragOver={e => {
                    // دعم السحب من قائمة المراقبة (HTML5 drag) إلى الشاشة
                    const ticker = e.dataTransfer?.getData('text/plain');
                    if (ticker) {
                      e.preventDefault();
                    }
                  }}
                  onDrop={e => {
                    const ticker = e.dataTransfer?.getData('text/plain');
                    if (ticker) {
                      e.preventDefault();
                      handleAddStock(ticker);
                    }
                  }}
                >
                  {gridStocks.map(stock => (
                    <SortableChart
                      key={stock.ticker}
                      ticker={stock.ticker}
                      renderCard={handleProps => (
                        <div className="h-[500px]">
                        <ChartCard
                          ticker={stock.ticker}
                          name={stock.name}
                          nameAr={stock.nameAr}
                          sector={stock.sector}
                          currentPrice={stock.currentPrice}
                          priceChange={stock.priceChange}
                          timeframe={timeframe}
                          timeframeDays={tfDays}
                          chartType={chartType}
                          isDark={isDark}
                          onRemove={() => handleRemoveStock(stock.ticker)}
                          onNavigate={() => handleNavigateDetail(stock.ticker)}
                          onToggleMaximize={() => handleToggleMaximize(stock.ticker)}
                          onSelect={() => setSelectedTickerInPanel(stock.ticker)}
                          onOpenChart={() => handleOpenChart(stock.ticker)}
                          draggableHandleProps={handleProps}
                        />
                        </div>
                      )}
                    />
                  ))}
                </div>
              </SortableContext>
              <DragOverlay>
                {activeDragId ? (
                  <div className="opacity-80 rotate-2">
                    <Badge variant="secondary" className="text-xs px-2 py-1">
                      {activeDragId}
                    </Badge>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <Card className="flex flex-col items-center justify-center p-12 border-dashed border-2 border-border/80 text-muted-foreground text-center h-full min-h-[400px]">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
                <LayoutGrid className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <h3 className="font-bold text-sm text-foreground mb-1">الشاشة فارغة حاليًا</h3>
              <p className="text-xs max-w-sm mb-4">
                استخدم شريط البحث بالأعلى أو اسحب سهمًا من قائمة المراقبة لإضافته للشاشة والبدء في تتبع الأسعار ومقارنتها.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="default" onClick={handleResetDefault} className="h-8 text-xs font-semibold">
                  إضافة الأسهم الافتراضية
                </Button>
                {allStocks.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddStock(allStocks[0].ticker)}
                    className="h-8 text-xs"
                  >
                    إضافة أول سهم متاح
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* ─── اللوحة السفلية ─── */}
      <BottomPanel
        stocks={screenerStocks}
        selectedTicker={selectedTickerInPanel}
        onSelectTicker={setSelectedTickerInPanel}
        onAddToChart={handleAddStock}
        onOpenDetail={handleNavigateDetail}
      />

      {/* Badge عدد الشاشات في الزاوية */}
      {selectedTickers.length > 0 && (
        <div className="fixed bottom-4 right-4 z-30">
          <Badge variant="default" className="text-[10px] px-2 py-1 shadow-lg">
            <Columns className="w-3 h-3 ml-1" />
            {selectedTickers.length} شاشة — {columns}×{Math.ceil(selectedTickers.length / columns)}
          </Badge>
        </div>
      )}

      {/* شارت تفصيلي منبثق */}
      {chartTicker && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col" dir="rtl">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-500" />
              <h3 className="text-sm font-bold text-foreground">
                شارت تفصيلي: {chartTicker}
              </h3>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleNavigateDetail(chartTicker)}
                className="gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                تفاصيل السهم
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCloseChart}
                title="إغلاق"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <TradingViewChart
              ticker={chartTicker}
              height={window.innerHeight - 100}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default MultiChartScreener;

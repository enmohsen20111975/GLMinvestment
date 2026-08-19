'use client';

/**
 * LiveStocksTable — جدول الأسهم الحية (Trading Terminal)
 * =========================================================
 * جدول تداول حي يجلب البيانات من `/api/market-pulse` كل 15 ثانية.
 *
 * الميزات:
 *  - يدمج gainers + losers + most_active في قائمة موحّدة (dedupe بالـ ticker)
 *  - ترتيب افتراضي: change_percent تنازلي (الرابحون في الأعلى، الخاسرون في الأسفل)
 *  - وميض الصفوف: أخضر عند ارتفاع السعر، أحمر عند الانخفاض (لمدة 1 ثانية)
 *  - أسهم تغيّر الترتيب: ↑ أخضر عند الصعود، ↓ أحمر عند الهبوط
 *  - مربع بحث (ticker / name / name_ar)
 *  - فلتر بالقطاع (Dropdown)
 *  - خيارات الترتيب: change% / price / volume / RSI
 *  - مؤشر "مباشر" نابض + آخر تحديث
 *  - تقسيم لصفحات (50 سهماً لكل صفحة) للأداء
 *  - حالة الخطأ: عرض آخر بيانات مع شارة "انقطاع الاتصال"
 *  - حالة التحميل: skeleton
 *
 * RTL كامل. ألوان emerald / rose / amber / slate فقط (لا أزرق/إنديغو).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  WifiOff,
  Zap,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ============================================================
// Types — مطابقة لـ /api/market-pulse
// ============================================================

interface StockMover {
  ticker: string;
  name: string;
  name_ar: string;
  current_price: number;
  change_percent: number;
  volume: number;
  sector: string;
  rsi: number | null;
  pe_ratio: number | null;
  market_cap: number | null;
}

interface MarketPulsePayload {
  gainers?: StockMover[];
  losers?: StockMover[];
  most_active?: StockMover[];
  latest_update?: string;
  cairo_time?: string;
  market_status?: 'OPEN' | 'CLOSED';
  is_trading_hours?: boolean;
}

interface ApiResponse {
  success?: boolean;
  data?: MarketPulsePayload;
  error?: string;
}

type SortKey = 'change' | 'price' | 'volume' | 'rsi';
type FlashDir = 'up' | 'down' | null;

// ============================================================
// Helpers
// ============================================================

const numberFmt2 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const intFmt = new Intl.NumberFormat('en-US');

function fmtNum(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (decimals === 0) return intFmt.format(Math.round(value));
  return numberFmt2.format(value);
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${numberFmt2.format(value)}%`;
}

function fmtVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return intFmt.format(value);
}

/** "منذ X ثانية/دقيقة" */
function relTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';
  let diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 0) diffSec = 0;
  if (diffSec < 60) return `منذ ${diffSec} ثانية`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    if (diffMin === 1) return 'منذ دقيقة';
    if (diffMin <= 10) return `منذ ${diffMin} دقائق`;
    return `منذ ${diffMin} دقيقة`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return 'منذ ساعة';
  if (diffHr <= 10) return `منذ ${diffHr} ساعات`;
  return `منذ ${diffHr} ساعة`;
}

/** يحوّل تاريخ "2026-07-12 13:10:47" إلى كائن تاريخ صالح. */
function parseServerDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Python قد يرجع "YYYY-MM-DD HH:MM:SS" بدون TZ؛ نُلحقها بـ UTC ثم نتركها.
  // عرض الوقت فقط نصياً لذا يكفي أن يكون قابلاً للحساب النسبي.
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** يدمج قوائم gainers/losers/most_active مع إزالة التكرار بالـ ticker. */
function mergeStocks(payload: MarketPulsePayload): StockMover[] {
  const map = new Map<string, StockMover>();
  const lists = [
    payload.most_active ?? [],
    payload.gainers ?? [],
    payload.losers ?? [],
  ];
  for (const list of lists) {
    for (const s of list) {
      if (!s || !s.ticker) continue;
      const existing = map.get(s.ticker);
      if (!existing) {
        map.set(s.ticker, s);
      } else {
        // نأخذ أكثر المعلومات اكتمالاً (sector، rsi ...)
        map.set(s.ticker, {
          ...existing,
          ...s,
          // لكن نحافظ على أعلى مستوى من البيانات إن كان أحدهما ناقصاً
          sector: existing.sector || s.sector,
          name_ar: existing.name_ar || s.name_ar,
          rsi: existing.rsi ?? s.rsi,
        });
      }
    }
  }
  return Array.from(map.values());
}

// ============================================================
// Row component
// ============================================================

function RsiCell({ rsi }: { rsi: number | null }) {
  if (rsi === null || rsi === undefined || Number.isNaN(rsi)) {
    return <span className="text-slate-300 dark:text-slate-600">—</span>;
  }
  let cls = 'text-slate-600 dark:text-slate-300';
  let label = '';
  if (rsi >= 70) {
    cls = 'text-rose-600 dark:text-rose-400';
    label = 'تشبع شرائي';
  } else if (rsi <= 30) {
    cls = 'text-emerald-600 dark:text-emerald-400';
    label = 'تشبع بيعي';
  }
  return (
    <div className="flex flex-col" dir="ltr">
      <span className={cn('text-xs font-semibold tabular-nums', cls)}>
        {rsi.toFixed(1)}
      </span>
      {label && (
        <span className={cn('text-[9px] font-medium', cls)}>{label}</span>
      )}
    </div>
  );
}

interface RowProps {
  stock: StockMover;
  rank: number; // 1-based within current sort view
  rankDelta: number; // +N إذا صعد، -N إذا هبط، 0 إذا بلا تغيير
  flash: FlashDir;
}

function StockRow({ stock, rank, rankDelta, flash }: RowProps) {
  const up = (stock.change_percent ?? 0) >= 0;
  const flashCls =
    flash === 'up'
      ? 'bg-emerald-100/70 dark:bg-emerald-950/40'
      : flash === 'down'
        ? 'bg-rose-100/70 dark:bg-rose-950/40'
        : '';

  return (
    <TableRow
      className={cn(
        'transition-colors duration-300',
        flashCls,
        // توهج خفيف على الحافة اليمنى (RTL) عند الوميض
        flash === 'up' &&
          'shadow-[inset_3px_0_0_0_rgba(16,185,129,0.6)]',
        flash === 'down' && 'shadow-[inset_3px_0_0_0_rgba(244,63,94,0.6)]',
      )}
    >
      {/* الترتيب + سهم التحرك */}
      <TableCell className="w-[44px] text-center">
        <div className="flex items-center justify-center gap-0.5">
          <span className="text-[10px] font-medium tabular-nums text-slate-400 dark:text-slate-500">
            {rank}
          </span>
          {rankDelta > 0 && (
            <span className="inline-flex items-center text-emerald-500" title={`صعد ${rankDelta} مراكز`}>
              <ArrowUp className="h-3 w-3" />
              <span className="text-[9px] font-bold tabular-nums">{rankDelta}</span>
            </span>
          )}
          {rankDelta < 0 && (
            <span className="inline-flex items-center text-rose-500" title={`هبط ${Math.abs(rankDelta)} مراكز`}>
              <ArrowDown className="h-3 w-3" />
              <span className="text-[9px] font-bold tabular-nums">{Math.abs(rankDelta)}</span>
            </span>
          )}
        </div>
      </TableCell>

      {/* السهم */}
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm font-bold text-slate-900 dark:text-white">
            {stock.ticker}
          </span>
          {(stock.name_ar || stock.name) && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500 line-clamp-1">
              {stock.name_ar || stock.name}
            </span>
          )}
        </div>
      </TableCell>

      {/* السعر */}
      <TableCell className="text-right" dir="ltr">
        <span className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
          {fmtNum(stock.current_price)}
        </span>
      </TableCell>

      {/* التغير % — بخلفية ملوّنة */}
      <TableCell>
        <span
          className={cn(
            'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums',
            up
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
          )}
          dir="ltr"
        >
          {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {fmtPct(stock.change_percent)}
        </span>
      </TableCell>

      {/* الحجم */}
      <TableCell className="text-right" dir="ltr">
        <span className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
          {fmtVolume(stock.volume)}
        </span>
      </TableCell>

      {/* RSI */}
      <TableCell>
        <RsiCell rsi={stock.rsi} />
      </TableCell>

      {/* القطاع */}
      <TableCell>
        {stock.sector ? (
          <Badge
            variant="outline"
            className="border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            {stock.sector}
          </Badge>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ============================================================
// Loading skeleton
// ============================================================

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-6" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Main component
// ============================================================

const REFRESH_INTERVAL_MS = 15_000;
const PAGE_SIZE = 50;
const FLASH_DURATION_MS = 1100;
const RANK_DELTA_DURATION_MS = 4000;

export function LiveStocksTable() {
  const [stocks, setStocks] = useState<StockMover[]>([]);
  const [latestUpdate, setLatestUpdate] = useState<string | null>(null);
  const [cairoTime, setCairoTime] = useState<string>('');
  const [marketStatus, setMarketStatus] = useState<'OPEN' | 'CLOSED'>('CLOSED');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // بحث / فلتر / ترتيب
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('__ALL__');
  const [sortKey, setSortKey] = useState<SortKey>('change');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(0);

  // تتبع السعر السابق + الترتيب السابق (حسب change_percent) للكشف عن الحركة
  const prevPriceRef = useRef<Map<string, number>>(new Map());
  const prevRankRef = useRef<Map<string, number>>(new Map());

  // حالات الوميض + تغير الترتيب
  const [flashMap, setFlashMap] = useState<Map<string, FlashDir>>(new Map());
  const [rankDeltaMap, setRankDeltaMap] = useState<Map<string, number>>(new Map());
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const rankTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ============================================================
  // Fetch
  // ============================================================

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      const res = await fetch('/api/market-pulse', {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json: ApiResponse = await res.json();
      const payload: MarketPulsePayload | undefined =
        (json && (json.data as MarketPulsePayload | undefined)) ||
        (json as unknown as MarketPulsePayload);

      if (!payload || (json.success === false && !json.data)) {
        throw new Error(json.error ?? 'استجابة غير صالحة');
      }

      const merged = mergeStocks(payload);

      // احسب الترتيب الجديد حسب change_percent تنازلياً (ترتيب السوق الطبيعي)
      const sortedByChange = [...merged].sort(
        (a, b) => (b.change_percent ?? 0) - (a.change_percent ?? 0),
      );
      const newRankMap = new Map<string, number>();
      sortedByChange.forEach((s, i) => newRankMap.set(s.ticker, i + 1));

      // احسب الوميض + دلتا الترتيب بالمقارنة بالقيم السابقة
      const newFlash = new Map<string, FlashDir>();
      const newDeltas = new Map<string, number>();
      const newPriceMap = new Map<string, number>();

      for (const s of merged) {
        const prevPrice = prevPriceRef.current.get(s.ticker);
        if (prevPrice !== undefined && prevPrice !== s.current_price) {
          if (s.current_price > prevPrice) newFlash.set(s.ticker, 'up');
          else if (s.current_price < prevPrice) newFlash.set(s.ticker, 'down');
        }
        newPriceMap.set(s.ticker, s.current_price);

        const prevRank = prevRankRef.current.get(s.ticker);
        const newRank = newRankMap.get(s.ticker) ?? 0;
        if (prevRank !== undefined) {
          // rank أصغر = أعلى. delta موجب = صعد.
          const delta = prevRank - newRank;
          if (delta !== 0) newDeltas.set(s.ticker, delta);
        }
      }

      // حدّث الحالات
      prevPriceRef.current = newPriceMap;
      prevRankRef.current = newRankMap;
      setStocks(merged);
      setLatestUpdate(payload.latest_update ?? payload.cairo_time ?? null);
      setCairoTime(payload.cairo_time ?? '');
      setMarketStatus(payload.market_status ?? 'CLOSED');
      setError(null);

      if (newFlash.size > 0) {
        setFlashMap(newFlash);
        for (const [ticker] of newFlash) {
          const existing = flashTimers.current.get(ticker);
          if (existing) clearTimeout(existing);
          flashTimers.current.set(
            ticker,
            setTimeout(() => {
              setFlashMap((prev) => {
                const next = new Map(prev);
                next.delete(ticker);
                return next;
              });
              flashTimers.current.delete(ticker);
            }, FLASH_DURATION_MS),
          );
        }
      }

      if (newDeltas.size > 0) {
        setRankDeltaMap(newDeltas);
        for (const [ticker] of newDeltas) {
          const existing = rankTimers.current.get(ticker);
          if (existing) clearTimeout(existing);
          rankTimers.current.set(
            ticker,
            setTimeout(() => {
              setRankDeltaMap((prev) => {
                const next = new Map(prev);
                next.delete(ticker);
                return next;
              });
              rankTimers.current.delete(ticker);
            }, RANK_DELTA_DURATION_MS),
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
      setError(msg);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  }, []);

  // الجلب الأولي + التحديث الدوري
  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      flashTimers.current.forEach((t) => clearTimeout(t));
      rankTimers.current.forEach((t) => clearTimeout(t));
      flashTimers.current.clear();
      rankTimers.current.clear();
    };
  }, [fetchData]);

  // إعادة ضبط الصفحة عند تغيير الفلاتر
  useEffect(() => {
    setPage(0);
  }, [search, sectorFilter, sortKey, sortDir]);

  // ============================================================
  // القائمة المفلترة + المرتبة
  // ============================================================

  const sectors = useMemo(() => {
    const set = new Set<string>();
    for (const s of stocks) {
      if (s.sector) set.add(s.sector);
    }
    return Array.from(set).sort((a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ar'));
  }, [stocks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = stocks;
    if (q) {
      list = list.filter((s) =>
        [s.ticker, s.name, s.name_ar]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q)),
      );
    }
    if (sectorFilter !== '__ALL__') {
      list = list.filter((s) => s.sector === sectorFilter);
    }

    const sorted = [...list].sort((a, b) => {
      let av: number;
      let bv: number;
      switch (sortKey) {
        case 'price':
          av = a.current_price ?? 0;
          bv = b.current_price ?? 0;
          break;
        case 'volume':
          av = a.volume ?? 0;
          bv = b.volume ?? 0;
          break;
        case 'rsi':
          av = a.rsi ?? -1;
          bv = b.rsi ?? -1;
          break;
        case 'change':
        default:
          av = a.change_percent ?? 0;
          bv = b.change_percent ?? 0;
          break;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return sorted;
  }, [stocks, search, sectorFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    pageSafe * PAGE_SIZE,
    pageSafe * PAGE_SIZE + PAGE_SIZE,
  );

  // الترتيب المعروض داخل الجدول (مرتبط بفرز المستخدم الحالي)
  const displayRankMap = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((s, i) => m.set(s.ticker, i + 1));
    return m;
  }, [filtered]);

  // ============================================================
  // نص "آخر تحديث" يتجدد كل ثانية
  // ============================================================

  const [lastUpdateStr, setLastUpdateStr] = useState('—');
  useEffect(() => {
    setLastUpdateStr(relTime(latestUpdate));
    const id = setInterval(() => {
      setLastUpdateStr(relTime(latestUpdate));
    }, 1000);
    return () => clearInterval(id);
  }, [latestUpdate]);

  // ============================================================
  // Render
  // ============================================================

  const isOpen = marketStatus === 'OPEN';

  return (
    <div
      className="flex flex-col rounded-xl border border-slate-200 bg-card shadow-sm dark:border-slate-800"
      dir="rtl"
    >
      {/* الرأس */}
      <div className="flex flex-col gap-3 border-b border-slate-200 p-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md',
              isOpen
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400',
            )}
          >
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              جدول الأسهم الحي
            </h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              {filtered.length} سهم • {sectors.length} قطاع
            </p>
          </div>

          {/* مؤشر مباشر */}
          <div className="mr-2 flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              {isOpen && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={cn(
                  'relative inline-flex h-2 w-2 rounded-full',
                  isOpen
                    ? 'bg-emerald-500'
                    : 'bg-slate-400 dark:bg-slate-600',
                )}
              />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              {isOpen ? 'مباشر' : 'مغلق'}
            </span>
          </div>

          {error && (
            <Badge
              variant="outline"
              className="border-rose-300 bg-rose-50 text-[9px] text-rose-600 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-400"
            >
              <WifiOff className="h-2.5 w-2.5" />
              انقطاع الاتصال
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
          <span>آخر تحديث: {lastUpdateStr}</span>
          <span className="text-slate-300 dark:text-slate-600">•</span>
          <span dir="ltr" className="tabular-nums">
            {cairoTime?.split(' ')?.[1] ?? ''}
          </span>
          <button
            onClick={() => void fetchData()}
            disabled={isRefreshing}
            title="تحديث"
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            {isRefreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* أدوات التصفية */}
      <div className="flex flex-col gap-2 border-b border-slate-200 p-3 dark:border-slate-800 sm:flex-row sm:items-center sm:gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالـ ticker أو الاسم..."
            className="h-8 pr-8 text-xs"
          />
        </div>

        <Select value={sectorFilter} onValueChange={setSectorFilter}>
          <SelectTrigger size="sm" className="h-8 w-full sm:w-[180px] text-xs">
            <SelectValue placeholder="كل القطاعات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__ALL__">كل القطاعات</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={`${sortKey}:${sortDir}`}
          onValueChange={(v) => {
            const [k, d] = v.split(':');
            setSortKey(k as SortKey);
            setSortDir(d as 'desc' | 'asc');
          }}
        >
          <SelectTrigger size="sm" className="h-8 w-full sm:w-[170px] text-xs">
            <ArrowUpDown className="h-3 w-3" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="change:desc">التغير % (الأعلى)</SelectItem>
            <SelectItem value="change:asc">التغير % (الأقل)</SelectItem>
            <SelectItem value="price:desc">السعر (الأعلى)</SelectItem>
            <SelectItem value="price:asc">السعر (الأقل)</SelectItem>
            <SelectItem value="volume:desc">الحجم (الأعلى)</SelectItem>
            <SelectItem value="volume:asc">الحجم (الأقل)</SelectItem>
            <SelectItem value="rsi:desc">RSI (الأعلى)</SelectItem>
            <SelectItem value="rsi:asc">RSI (الأقل)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* الجدول */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40">
              <TableHead className="w-[44px] text-center text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                #
              </TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                السهم
              </TableHead>
              <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                السعر
              </TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                التغير %
              </TableHead>
              <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                الحجم
              </TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                RSI
              </TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                القطاع
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && stocks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="p-3">
                  <TableSkeleton />
                </TableCell>
              </TableRow>
            ) : pageItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-xs text-slate-400 dark:text-slate-500"
                >
                  لا توجد أسهم مطابقة
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((s) => (
                <StockRow
                  key={s.ticker}
                  stock={s}
                  rank={displayRankMap.get(s.ticker) ?? 0}
                  rankDelta={rankDeltaMap.get(s.ticker) ?? 0}
                  flash={flashMap.get(s.ticker) ?? null}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ترقيم الصفحات */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            عرض{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {pageSafe * PAGE_SIZE + 1}–
              {Math.min((pageSafe + 1) * PAGE_SIZE, filtered.length)}
            </span>{' '}
            من {filtered.length}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={pageSafe === 0}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              title="السابق"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="text-[10px] font-medium tabular-nums text-slate-600 dark:text-slate-300">
              {pageSafe + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={pageSafe >= totalPages - 1}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              title="التالي"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default LiveStocksTable;

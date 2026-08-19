'use client';

/**
 * WatchlistSidebar — قائمة المراقبة الجانبية (يمين الشاشة).
 *
 * الميزات:
 * - قابلة للطي (collapsible) — يُحفظ وضعها في localStorage
 * - بحث + فلترة بالاسم/الرمز/القطاع
 * - كل صف فيه: ticker, price, change%, mini sparkline (SVG)
 * - "→ شارت" زر يضيف السهم للشاشة (drag-to-chart fallback for touch)
 * - click على الصف يفتح تفاصيل السهم
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  PanelRightClose,
  TrendingUp,
  TrendingDown,
  Plus,
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPrice, type OhlcvPoint } from './chartIndicators';

// ─── الأنواع ──────────────────────────────────────────────────────────────

export interface WatchlistStock {
  ticker: string;
  name: string;
  name_ar: string;
  sector?: string | null;
  current_price?: number | null;
  price_change?: number | null;
  history?: OhlcvPoint[];
}

export interface WatchlistSidebarProps {
  stocks: WatchlistStock[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onAddToChart: (ticker: string) => void;
  onOpenDetail: (ticker: string) => void;
  addedTickers: string[]; // الأسهم الموجودة بالفعل في الشاشة
  loading?: boolean;
}

// ─── المكوّن ──────────────────────────────────────────────────────────────

export function WatchlistSidebar({
  stocks,
  isCollapsed,
  onToggleCollapse,
  onAddToChart,
  onOpenDetail,
  addedTickers,
  loading = false,
}: WatchlistSidebarProps) {
  const [query, setQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState(50);

  // Reset visible count when stocks change (e.g. market switch)
  useEffect(() => {
    setVisibleCount(50);
  }, [stocks.length]);

  // قائمة القطاعات الفريدة
  const sectors = useMemo(() => {
    const set = new Set<string>();
    stocks.forEach(s => {
      if (s.sector) set.add(s.sector);
    });
    return Array.from(set).sort();
  }, [stocks]);

  // الفلترة
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return stocks.filter(s => {
      if (sectorFilter && s.sector !== sectorFilter) return false;
      if (!q) return true;
      return (
        s.ticker.toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        (s.name_ar || '').toLowerCase().includes(q)
      );
    });
  }, [stocks, query, sectorFilter]);

  // ─── الوضع المطوي ──
  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-3 px-1 border-r border-border bg-card h-full w-12 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 rounded-md text-muted-foreground hover:text-foreground"
          onClick={onToggleCollapse}
          title="إظهار قائمة المراقبة"
        >
          <PanelRightClose className="w-4 h-4 rotate-180" />
        </Button>
        <div className="text-[9px] text-muted-foreground rotate-180" style={{ writingMode: 'vertical-rl' }}>
          قائمة المراقبة
        </div>
        <Badge variant="secondary" className="text-[9px] px-1 py-0">
          {stocks.length}
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-160px)] w-72 shrink-0 border-r border-border bg-card overflow-hidden">
      {/* رأس القائمة */}
      <div className="flex items-center justify-between p-2.5 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-center gap-1.5">
          <Star className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-bold text-foreground">قائمة المراقبة</h3>
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
            {filtered.length}/{stocks.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground"
          onClick={onToggleCollapse}
          title="إخفاء"
        >
          <PanelRightClose className="w-4 h-4" />
        </Button>
      </div>

      {/* البحث */}
      <div className="p-2 border-b border-border shrink-0">
        <div className="relative">
          <Search className="absolute right-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="بحث في القائمة..."
            className="pr-8 h-8 text-xs"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {/* فلتر القطاع */}
        {sectors.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 max-h-12 overflow-y-auto">
            <button
              onClick={() => setSectorFilter('')}
              className={cn(
                'text-[9px] px-1.5 py-0.5 rounded border transition-colors',
                !sectorFilter
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              الكل
            </button>
            {sectors.slice(0, 12).map(sec => (
              <button
                key={sec}
                onClick={() => setSectorFilter(sec === sectorFilter ? '' : sec)}
                className={cn(
                  'text-[9px] px-1.5 py-0.5 rounded border transition-colors truncate max-w-[80px]',
                  sectorFilter === sec
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
                title={sec}
              >
                {sec}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* قائمة الأسهم — scroll مع max-height عشان ما ياخدش طول الشاشة كله */}
      <div className="flex-1 min-h-0 max-h-[calc(100vh-200px)] overflow-y-auto custom-scrollbar">
        <div className="divide-y divide-border">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-2.5 py-1.5 flex items-center gap-2">
                <div className="flex-1 space-y-1">
                  <div className="h-2.5 w-14 bg-muted/40 rounded animate-pulse" />
                  <div className="h-2 w-20 bg-muted/40 rounded animate-pulse" />
                </div>
                <div className="w-14 h-5 bg-muted/40 rounded animate-pulse" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              {stocks.length === 0 ? 'لا توجد أسهم في القائمة' : 'لا نتائج مطابقة'}
            </div>
          ) : (
            filtered.slice(0, visibleCount).map(stock => {
              const isUp = (stock.price_change ?? 0) >= 0;
              const change = stock.price_change ?? 0;
              const price = stock.current_price ?? 0;
              const inChart = addedTickers.includes(stock.ticker);

              // صف مختصر: ticker + price + change% بس (+ زر إضافة عند الـ hover)
              return (
                <div
                  key={stock.ticker}
                  className="group px-2.5 py-1.5 flex items-center gap-2 hover:bg-muted/40 cursor-pointer transition-colors min-h-[32px]"
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('text/plain', stock.ticker);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onOpenDetail(stock.ticker)}
                >
                  <div className="flex-1 min-w-0 leading-tight">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-[11px] text-foreground truncate">
                        {stock.ticker}
                      </span>
                      {inChart && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="موجود في الشاشة" />
                      )}
                    </div>
                    <span className="text-[9px] text-muted-foreground truncate block max-w-[120px]">
                      {stock.name_ar || stock.name}
                    </span>
                  </div>

                  {/* السعر + التغير */}
                  <div className="text-left shrink-0">
                    <div className="text-[11px] font-bold tabular-nums text-foreground" dir="ltr">
                      {formatPrice(price)}
                    </div>
                    <div
                      className={cn(
                        'text-[9px] font-semibold flex items-center justify-end gap-0.5',
                        isUp ? 'text-emerald-600' : 'text-rose-600'
                      )}
                      dir="ltr"
                    >
                      {isUp ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
                      {isUp ? '+' : ''}
                      {!Number.isNaN(change) ? change.toFixed(1) : '0.0'}%
                    </div>
                  </div>

                  {/* زر الإضافة للشاشة — بيظهر بس عند الـ hover */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-5 h-5 rounded-md text-muted-foreground hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={e => {
                      e.stopPropagation();
                      onAddToChart(stock.ticker);
                    }}
                    title={inChart ? 'موجود في الشاشة' : 'أضف للشاشة'}
                    disabled={inChart}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              );
            })
          )}
          {/* زر "عرض المزيد" — يظهر فقط لو في نتائج مخفية */}
          {!query && !sectorFilter && filtered.length > visibleCount && (
            <button
              onClick={() => setVisibleCount(prev => prev + 50)}
              className="w-full py-2 text-center text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-t border-border"
            >
              عرض {Math.min(50, filtered.length - visibleCount)} سهم آخر من أصل {filtered.length}
            </button>
          )}
          {!query && !sectorFilter && filtered.length > 50 && visibleCount >= filtered.length && (
            <button
              onClick={() => setVisibleCount(50)}
              className="w-full py-2 text-center text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-t border-border"
            >
              عرض 50 سهماً فقط
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default WatchlistSidebar;

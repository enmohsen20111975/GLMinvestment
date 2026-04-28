'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Search, X, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Stock } from '@/types';

// ─── Props ─────────────────────────────────────────────────────────────────

interface StockSelectorProps {
  /** Callback when a stock is selected */
  onSelect?: (ticker: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show as compact (for mobile nav) */
  compact?: boolean;
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function safeNum(val: number | undefined | null): number {
  return typeof val === 'number' && !isNaN(val) ? val : 0;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function StockSelector({
  onSelect,
  placeholder = 'ابحث بالرمز أو الاسم...',
  className,
  compact = false,
}: StockSelectorProps) {
  const { stocks, loadStockDetail } = useAppStore();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Debounce search (300ms) ──
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  // ── Filter stocks ──
  const filteredStocks = useMemo(() => {
    // When no query, show first 50 stocks (sorted by volume already from API)
    if (!debouncedQuery.trim()) {
      return stocks.slice(0, 50);
    }

    const q = debouncedQuery.toLowerCase().trim();
    return stocks.filter((stock) => {
      return (
        stock.ticker.toLowerCase().includes(q) ||
        stock.name.toLowerCase().includes(q) ||
        stock.name_ar.includes(q)
      );
    }).slice(0, 30);
  }, [stocks, debouncedQuery]);

  // ── Reset highlight when query changes (computed inline) ──
  const currentHighlightIndex = query === '' ? -1 : highlightIndex;

  // ── Close dropdown when clicking outside ──
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Scroll highlighted item into view ──
  useEffect(() => {
    if (currentHighlightIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-stock-item]');
      if (items[currentHighlightIndex]) {
        items[currentHighlightIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [currentHighlightIndex]);

  // ── Handle stock selection ──
  const handleSelect = useCallback(
    (ticker: string) => {
      setQuery('');
      setDebouncedQuery('');
      setIsOpen(false);
      if (onSelect) {
        onSelect(ticker);
      } else {
        loadStockDetail(ticker);
      }
    },
    [onSelect, loadStockDetail]
  );

  // ── Keyboard navigation ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          setIsOpen(true);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((prev) =>
            prev < filteredStocks.length - 1 ? prev + 1 : 0
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((prev) =>
            prev > 0 ? prev - 1 : filteredStocks.length - 1
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (currentHighlightIndex >= 0 && filteredStocks[currentHighlightIndex]) {
            handleSelect(filteredStocks[currentHighlightIndex].ticker);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          inputRef.current?.blur();
          break;
      }
    },
    [isOpen, filteredStocks, currentHighlightIndex, handleSelect]
  );

  const handleClear = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setHighlightIndex(-1);
    inputRef.current?.focus();
  }, []);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'pr-10 pl-9',
            compact ? 'h-9 text-xs' : 'h-10 text-sm'
          )}
          dir="rtl"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute left-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown List */}
      {isOpen && (
        <div
          className="absolute top-full left-0 right-0 mt-1 z-[9999] bg-popover text-popover-foreground rounded-lg border shadow-lg max-h-80 overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150"
          ref={listRef}
        >
          {/* Header */}
          {!compact && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-[11px] text-muted-foreground font-medium">
                {debouncedQuery.trim()
                  ? `${filteredStocks.length} نتيجة`
                  : `${stocks.length > 0 ? Math.min(50, stocks.length) : 0} سهم`}
              </span>
              <span className="text-[10px] text-muted-foreground">
                ↑↓ للتنقل • Enter للاختيار
              </span>
            </div>
          )}

          {/* Results */}
          <div className="overflow-y-auto max-h-72" ref={listRef}>
            {filteredStocks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-muted-foreground">
                <Search className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm font-medium">لا توجد نتائج</p>
                <p className="text-xs mt-0.5">جرب البحث بكلمة مختلفة</p>
              </div>
            ) : (
              <div role="listbox" className="py-1">
                {filteredStocks.map((stock, idx) => (
                  <StockResultItem
                    key={stock.ticker}
                    stock={stock}
                    isHighlighted={idx === currentHighlightIndex}
                    onSelect={() => handleSelect(stock.ticker)}
                    onHover={() => setHighlightIndex(idx)}
                    compact={compact}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer hint */}
          {!compact && filteredStocks.length > 0 && debouncedQuery.trim() && (
            <div className="px-3 py-1.5 border-t border-border bg-muted/20 text-[10px] text-muted-foreground text-center">
              اضغط Enter للانتقال إلى صفحة السهم
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stock Result Item ──────────────────────────────────────────────────────

function StockResultItem({
  stock,
  isHighlighted,
  onSelect,
  onHover,
  compact,
}: {
  stock: Stock;
  isHighlighted: boolean;
  onSelect: () => void;
  onHover: () => void;
  compact: boolean;
}) {
  const change = stock.price_change ?? 0;
  const isPositive = change > 0;
  const isNegative = change < 0;

  return (
    <div
      data-stock-item
      role="option"
      aria-selected={isHighlighted}
      className={cn(
        'flex items-center gap-3 px-3 cursor-pointer transition-colors',
        isHighlighted
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-muted/50',
        compact ? 'py-2' : 'py-2.5'
      )}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      {/* Ticker + Index badges */}
      <div className="flex-shrink-0 text-left" dir="ltr">
        <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">
          {stock.ticker}
        </span>
        <div className="flex gap-1 mt-0.5">
          {stock.egx30_member && (
            <span className="text-[8px] px-1 py-0 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
              30
            </span>
          )}
          {stock.egx70_member && (
            <span className="text-[8px] px-1 py-0 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
              70
            </span>
          )}
          {stock.egx100_member && (
            <span className="text-[8px] px-1 py-0 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 font-medium">
              100
            </span>
          )}
        </div>
      </div>

      {/* Arabic Name + Sector */}
      <div className="flex-1 min-w-0" dir="rtl">
        <p className={cn(
          'truncate font-medium',
          compact ? 'text-xs' : 'text-sm'
        )}>
          {stock.name_ar}
        </p>
        {!compact && stock.sector && (
          <p className="text-[10px] text-muted-foreground truncate">
            {stock.sector}
          </p>
        )}
      </div>

      {/* Price + Change */}
      <div className="flex-shrink-0 text-left" dir="ltr">
        <p className={cn(
          'font-semibold tabular-nums',
          compact ? 'text-xs' : 'text-sm'
        )}>
          {safeNum(stock.current_price).toFixed(2)}
        </p>
        <div
          className={cn(
            'flex items-center gap-0.5 justify-end tabular-nums',
            compact ? 'text-[10px]' : 'text-xs',
            isPositive && 'text-emerald-600 dark:text-emerald-400',
            isNegative && 'text-red-600 dark:text-red-400',
            change === 0 && 'text-muted-foreground'
          )}
        >
          {isPositive ? (
            <TrendingUp className="w-2.5 h-2.5" />
          ) : isNegative ? (
            <TrendingDown className="w-2.5 h-2.5" />
          ) : (
            <Minus className="w-2.5 h-2.5" />
          )}
          {change >= 0 ? '+' : ''}
          {safeNum(change).toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

export default StockSelector;

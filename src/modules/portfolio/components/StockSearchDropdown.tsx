'use client';

/* ============================================================
   StockSearchDropdown — بحث ذكي عن الأسهم (مشترك)
   ============================================================
   P31-PORTFOLIO-SMART-MATH-RESCUE (Task 3):
   مستخرج من EnhancedPortfolioView عشان يتستخدم في BagHolderRescuePanel
   و أي شاشة تانية محتاجة بحث سهم. بيقرا من /api/stocks/search.
   ============================================================ */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface StockSearchResult {
  id: number;
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  current_price: number;
  previous_close: number;
  volume: number;
  price_change: number;
}

interface StockSearchDropdownProps {
  value: string;
  onSelect: (ticker: string, name: string, currentPrice: number) => void;
  placeholder?: string;
}

export function StockSearchDropdown({
  value,
  onSelect,
  placeholder = 'ابحث عن السهم بالاسم أو الرمز...',
}: StockSearchDropdownProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const doSearch = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
      const data = await res.json();
      setResults(data.stocks || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (val.trim().length < 1) {
      setOpen(false);
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      doSearch(val.trim());
      setOpen(true);
    }, 250);
  };

  const handleSelect = (stock: StockSearchResult) => {
    setQuery(`${stock.ticker} - ${stock.name_ar}`);
    setOpen(false);
    onSelect(stock.ticker, stock.name_ar, stock.current_price);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          dir="rtl"
          onFocus={() => { if (results.length > 0) setOpen(true); }}
        />
        {loading && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {results.map((stock) => (
            <button
              key={stock.id}
              type="button"
              className="w-full text-right px-3 py-2.5 hover:bg-accent flex items-center justify-between gap-2 transition-colors border-b last:border-b-0"
              onClick={() => handleSelect(stock)}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{stock.name_ar}</div>
                <div className="text-xs text-muted-foreground" dir="ltr">{stock.ticker} | {stock.name}</div>
              </div>
              <div className="text-left flex-shrink-0">
                <div className="text-sm font-semibold" dir="ltr">{(stock.current_price ?? 0) > 0 ? (stock.current_price ?? 0).toFixed(2) : '—'}</div>
                <div className={cn('text-xs font-medium', (stock.price_change ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                  {(stock.price_change ?? 0) >= 0 ? '+' : ''}{(stock.price_change ?? 0).toFixed(2)}%
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default StockSearchDropdown;

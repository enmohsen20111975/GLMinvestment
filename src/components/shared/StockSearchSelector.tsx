'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, X, Check, ChevronsUpDown, Plus, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StockSearchSelectorProps {
  value?: string;
  onSelectStock: (ticker: string) => void;
  placeholder?: string;
  buttonVariant?: 'outline' | 'default' | 'ghost' | 'secondary';
  buttonClassName?: string;
  icon?: React.ReactNode;
  mode?: 'select' | 'add';
  compact?: boolean;
}

function normalizeArabic(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u0652]/g, '')
    .trim();
}

export function StockSearchSelector({
  value = '',
  onSelectStock,
  placeholder = 'اختر السهم للتحليل...',
  buttonVariant = 'outline',
  buttonClassName,
  icon,
  mode = 'select',
  compact = false,
}: StockSearchSelectorProps) {
  const { stocks, currentMarket } = useAppStore();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isCrypto = currentMarket === 'CRYPTO';

  // Focus search input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
    }
  }, [open]);

  // Selected stock object
  const selectedStock = useMemo(() => {
    if (!value) return null;
    return stocks.find((s) => s.ticker.toUpperCase() === value.toUpperCase());
  }, [stocks, value]);

  // Filtered stocks list (Matches Ticker, Arabic Name, English Name)
  const filteredStocks = useMemo(() => {
    if (!searchQuery.trim()) return stocks;

    const normQuery = normalizeArabic(searchQuery);
    const rawQuery = searchQuery.trim().toLowerCase();

    return stocks.filter((s) => {
      const normTicker = (s.ticker || '').toLowerCase();
      const normNameAr = normalizeArabic(s.name_ar || '');
      const normNameEn = (s.name || '').toLowerCase();
      const normSector = normalizeArabic(s.sector || '');

      return (
        normTicker.includes(rawQuery) ||
        normNameAr.includes(normQuery) ||
        normNameEn.includes(rawQuery) ||
        normSector.includes(normQuery)
      );
    });
  }, [stocks, searchQuery]);

  // Top popular presets for quick access
  const popularTickers = isCrypto
    ? ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA']
    : ['COMI', 'PHDC', 'JUFO', 'SWDY', 'HELI', 'TMGH', 'ABUK', 'MFPC', 'ORHD', 'EKHO'];

  const handleSelect = (ticker: string) => {
    onSelectStock(ticker.toUpperCase());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={buttonVariant}
          role="combobox"
          aria-expanded={open}
          className={cn(
            'justify-between text-right font-bold transition-all',
            compact ? 'h-8 px-2 text-xs' : 'h-9 px-3 text-xs md:text-sm',
            buttonClassName
          )}
        >
          <div className="flex items-center gap-1.5 truncate">
            {icon ? (
              icon
            ) : mode === 'add' ? (
              <Plus className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            ) : (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            )}

            <span className="truncate">
              {mode === 'add' ? (
                placeholder
              ) : selectedStock ? (
                <span className="flex items-center gap-1.5">
                  <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                    {selectedStock.ticker}
                  </span>
                  <span className="text-muted-foreground font-normal text-[11px] truncate">
                    ({selectedStock.name_ar || selectedStock.name})
                  </span>
                </span>
              ) : value ? (
                <span className="font-mono font-black">{value}</span>
              ) : (
                placeholder
              )}
            </span>
          </div>

          <ChevronsUpDown className="w-3.5 h-3.5 ml-1 opacity-50 flex-shrink-0" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        dir="rtl"
        className="w-[320px] sm:w-[380px] p-0 bg-popover border-border shadow-2xl rounded-xl z-50 overflow-hidden"
        align="start"
      >
        {/* Search Header */}
        <div className="p-2.5 border-b border-border/70 bg-muted/30 space-y-2">
          <div className="relative flex items-center">
            <Search className="absolute right-3 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالرمز أو اسم السهم (مثال: COMI, التجاري)..."
              className="pr-9 pl-8 h-9 text-xs bg-background border-border font-medium shadow-inner"
              dir="rtl"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute left-2.5 p-0.5 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors"
                title="مسح البحث"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Presets Bar */}
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            <span className="text-[10px] text-muted-foreground font-bold ml-1">الأبرز:</span>
            {popularTickers.slice(0, 7).map((tk) => (
              <button
                key={`pop-${tk}`}
                onClick={() => handleSelect(tk)}
                className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-background border border-border/80 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 rounded transition-all"
              >
                {tk}
              </button>
            ))}
          </div>

          {/* Search Result Stats */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
            <span>
              {searchQuery ? `نتائج البحث (${filteredStocks.length})` : `جميع الأسهم المتاحة (${stocks.length})`}
            </span>
            {stocks.length > 0 && (
              <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                {isCrypto ? 'سوق العملات الرقمية' : 'البورصة المصرية EGX'}
              </span>
            )}
          </div>
        </div>

        {/* Scrollable Stocks List */}
        <div className="max-h-[320px] overflow-y-auto p-1 divide-y divide-border/20 custom-scrollbar">
          {filteredStocks.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground space-y-1">
              <p className="font-bold">لا توجد أسهم تطابق "{searchQuery}"</p>
              <p className="text-[10px]">تأكد من كتابة الرمز أو اسم السهم بشكل صحيح</p>
            </div>
          ) : (
            filteredStocks.map((s) => {
              const isSelected = value?.toUpperCase() === s.ticker.toUpperCase();
              return (
                <button
                  key={`stock-item-${s.ticker}`}
                  onClick={() => handleSelect(s.ticker)}
                  className={cn(
                    'w-full text-right p-2 text-xs flex items-center justify-between rounded-lg transition-colors hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20 group',
                    isSelected ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold' : ''
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-black text-xs text-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 min-w-[50px]">
                      {s.ticker}
                    </span>
                    <div className="flex flex-col truncate">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {s.name_ar || s.name}
                      </span>
                      {s.sector && (
                        <span className="text-[9px] text-muted-foreground truncate">
                          {s.sector}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {s.current_price !== undefined && s.current_price > 0 && (
                      <span className="font-mono text-[11px] font-bold text-foreground">
                        {(s.current_price ?? 0).toFixed(2)} {isCrypto ? '$' : 'ج.م'}
                      </span>
                    )}
                    {isSelected && <Check className="w-4 h-4 text-emerald-500" />}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

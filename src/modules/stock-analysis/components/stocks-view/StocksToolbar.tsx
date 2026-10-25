/**
 * stocks-view/StocksToolbar.tsx
 * ============================================================================
 * F-Phase3-Split-StocksView: the big Card containing:
 *   - Row 1: Search + Advanced Filter Toggle + Publish button
 *   - Row 2: Quick filter chips (always visible)
 *   - Row 3 (collapsible): Preset select + period + sector + index chips +
 *     price range + change filter + reset + AdvancedFilters sub-component.
 *
 * قبل كده: كل ده كان inline في StocksView render (lines 1786-2008).
 * ============================================================================
 */

'use client';

import { Search, Filter } from 'lucide-react';
import { cn, safeNum } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MARKET_NAMES_AR } from '@/lib/store';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import type { Stock } from '@/types';
import { AdvancedFilters } from './AdvancedFilters';
import {
  QUICK_FILTERS,
  PRESET_OPTIONS,
  SECTORS,
  INDEX_FILTERS,
  DEFAULT_INDEX_FILTERS,
  PRICE_RANGE_OPTIONS,
  CHANGE_FILTER_OPTIONS,
  DEFAULT_SORT_KEY,
  DEFAULT_SORT_DIR,
} from './constants';
import type { QuickFilterKey, TranslationFn } from './types';

interface StocksToolbarProps {
  localSearch: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;

  showFilters: boolean;
  setShowFilters: React.Dispatch<React.SetStateAction<boolean>>;
  hasActiveFilters: boolean;

  selectedPreset: string;
  setSelectedPreset: React.Dispatch<React.SetStateAction<string>>;
  presetPeriod: string;
  setPresetPeriod: React.Dispatch<React.SetStateAction<string>>;
  selectedSector: string;
  onSectorChange: (value: string) => void;
  selectedIndex: string;
  onIndexChange: (key: string) => void;
  priceRange: string;
  onPriceRangeChange: (value: string) => void;
  changeFilter: string;
  onChangeFilterChange: (value: string) => void;
  onResetFilters: () => void;

  activeQuickFilter: QuickFilterKey;
  onQuickFilter: (key: QuickFilterKey) => void;

  // Advanced filters
  selectedSectors: string[];
  onToggleSector: (sector: string) => void;
  priceMin: string;
  priceMax: string;
  onPriceMinChange: (v: string) => void;
  onPriceMaxChange: (v: string) => void;
  changeMin: string;
  changeMax: string;
  onChangeMinChange: (v: string) => void;
  onChangeMaxChange: (v: string) => void;
  onResetAdvanced: () => void;
  availableSectors: string[];

  // For the Publish button:
  baseData: Array<Stock | Record<string, unknown>>;
  currentMarket: string;

  // EGX/crypto flags:
  isCrypto: boolean;
  isEGX: boolean;

  // page setter (preset/period/sector/index changes reset page to 1)
  setPage: React.Dispatch<React.SetStateAction<number>>;

  // i18n
  t: TranslationFn;
}

export function StocksToolbar({
  localSearch,
  onSearchChange,
  onClearSearch,
  showFilters,
  setShowFilters,
  hasActiveFilters,
  selectedPreset,
  setSelectedPreset,
  presetPeriod,
  setPresetPeriod,
  selectedSector,
  onSectorChange,
  selectedIndex,
  onIndexChange,
  priceRange,
  onPriceRangeChange,
  changeFilter,
  onChangeFilterChange,
  onResetFilters,
  activeQuickFilter,
  onQuickFilter,
  selectedSectors,
  onToggleSector,
  priceMin,
  priceMax,
  onPriceMinChange,
  onPriceMaxChange,
  changeMin,
  changeMax,
  onChangeMinChange,
  onChangeMaxChange,
  onResetAdvanced,
  availableSectors,
  baseData,
  currentMarket,
  isCrypto,
  isEGX,
  setPage,
  t,
}: StocksToolbarProps) {
  return (
    <Card className="py-0 gap-0">
      <CardContent className="p-4 space-y-3">
        {/* Row 1: Search + Advanced Filter Toggle + Publish */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[140px] sm:min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={localSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('stocks.search.placeholder')}
              className="pr-10 h-9"
              dir="rtl"
            />
            {localSearch && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={onClearSearch}
              >
                ×
              </Button>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-9 gap-1.5 text-xs',
              showFilters && 'bg-muted text-foreground',
            )}
            onClick={() => setShowFilters((prev) => !prev)}
            title={t('stocks.filterButton.title')}
          >
            <Filter className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('stocks.filterButton.label')}</span>
            {hasActiveFilters && (
              <span className="h-2 w-2 rounded-full bg-warning" />
            )}
          </Button>

          <UnifiedPublishButton
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            title={`قائمة الأسهم — ${MARKET_NAMES_AR[currentMarket] || currentMarket}`}
            content={`قائمة الأسهم — ${MARKET_NAMES_AR[currentMarket] || currentMarket}\nعدد الأسهم المعروضة: ${baseData.length}\nالفرز الافتراضي: ${DEFAULT_SORT_KEY} ${DEFAULT_SORT_DIR}\n\n${baseData.slice(0, 15).map((s, i) => {
              const row = s as Stock & Record<string, unknown>;
              return `${i + 1}. ${row.ticker} — ${safeNum(row.last_price ?? row.close).toFixed(2)} (${safeNum(row.change_pct ?? row.change_percent).toFixed(2)}%)`;
            }).join('\n')}`}
            filename={`stocks-${currentMarket}-${Date.now()}`}
            hashtags={['أسهم', currentMarket, 'بورصة']}
            triggerLabel="نشر"
          />
        </div>

        {/* Row 2: Quick Filter Chips (always visible) */}
        <div className="flex flex-wrap gap-1.5 items-center">
          {QUICK_FILTERS.map((chip) => {
            const isActive = activeQuickFilter === chip.key;
            return (
              <button
                key={chip.key}
                onClick={() => onQuickFilter(chip.key)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
                  isActive
                    ? 'bg-profit text-white border-profit'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted',
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {/* Row 3: Advanced Filters (collapsible) */}
        {showFilters && (
          <div className="space-y-3 pt-3 border-t border-border/50">
            {/* Row 2a: preset select, period, sector dropdown, index chips, price/change buckets */}
            <div className="flex flex-wrap gap-2 items-center">
              {/* Preset Selector */}
              <Select value={selectedPreset} onValueChange={(v) => { setSelectedPreset(v); setPage(1); }}>
                <SelectTrigger className="w-auto min-w-[140px] sm:min-w-[170px] h-8 text-xs" size="sm">
                  <SelectValue placeholder="قائمة مسبقة" />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_OPTIONS.map(opt => (
                    <SelectItem key={opt.key} value={opt.key} className="text-xs">
                      <span className="ml-1">{opt.icon}</span> {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Period Selector for gainers/losers */}
              {(selectedPreset === 'top_gainers' || selectedPreset === 'top_losers') && (
                <div className="flex gap-1">
                  {[
                    { key: '1d', label: t('stocks.period.day') },
                    { key: '1w', label: t('stocks.period.week') },
                    { key: '1m', label: t('stocks.period.month') },
                  ].map(p => (
                    <button
                      key={p.key}
                      onClick={() => setPresetPeriod(p.key)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
                        presetPeriod === p.key
                          ? 'bg-profit text-white border-profit'
                          : 'bg-background text-muted-foreground border-border hover:bg-muted'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Sector (single-select — hidden for crypto) */}
              {!isCrypto && (
                <Select value={selectedSector} onValueChange={onSectorChange}>
                  <SelectTrigger className="w-auto min-w-[110px] sm:min-w-[130px] h-8 text-xs" size="sm">
                    <SelectValue placeholder={t('stocks.filters.sector')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(isEGX
                      ? SECTORS
                      : ['الكل', ...availableSectors]
                    ).map((sector) => (
                      <SelectItem key={sector} value={sector} className="text-xs">
                        {sector}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Index Chips - not for CRYPTO */}
              {currentMarket !== 'CRYPTO' && (
                <div className="flex gap-1.5 flex-wrap">
                  {(INDEX_FILTERS[currentMarket] || DEFAULT_INDEX_FILTERS).map((filter) => (
                    <button
                      key={filter.key}
                      onClick={() => onIndexChange(filter.key)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
                        selectedIndex === filter.key
                          ? 'bg-profit text-white border-profit'
                          : 'bg-background text-muted-foreground border-border hover:bg-muted'
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Price Range */}
              <Select value={priceRange} onValueChange={onPriceRangeChange}>
                <SelectTrigger className="w-auto min-w-[110px] sm:min-w-[130px] h-8 text-xs" size="sm">
                  <SelectValue placeholder={t('stocks.filters.priceRange')} />
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
              <Select value={changeFilter} onValueChange={onChangeFilterChange}>
                <SelectTrigger className="w-auto min-w-[110px] sm:min-w-[130px] h-8 text-xs" size="sm">
                  <SelectValue placeholder={t('stocks.filters.changeRange')} />
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
                  onClick={onResetFilters}
                >
                  {t('stocks.filters.reset')}
                </Button>
              )}
            </div>

            {/* Row 2b: Advanced filters (sector multi-select, price min/max, change min/max) */}
            <AdvancedFilters
              selectedSectors={selectedSectors}
              onToggleSector={onToggleSector}
              priceMin={priceMin}
              priceMax={priceMax}
              onPriceMinChange={onPriceMinChange}
              onPriceMaxChange={onPriceMaxChange}
              changeMin={changeMin}
              changeMax={changeMax}
              onChangeMinChange={onChangeMinChange}
              onChangeMaxChange={onChangeMaxChange}
              onReset={onResetAdvanced}
              availableSectors={availableSectors}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

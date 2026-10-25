/**
 * stocks-view/AdvancedFilters.tsx
 * ============================================================================
 * F-Phase3-Split-StocksView: AdvancedFilters (collapsible panel with sector
 * multi-select chips + price range + change range).
 *
 * UI-STABILITY fix (2026-09-28): wrapped in React.memo so it doesn't re-render
 * on every parent state change unrelated to its props.
 * ============================================================================
 */

import { memo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { AdvancedFiltersProps } from './types';

export const AdvancedFilters = memo(function AdvancedFilters({
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
  onReset,
  availableSectors,
}: AdvancedFiltersProps) {
  const hasAdvancedActive =
    selectedSectors.length > 0 ||
    priceMin !== '' ||
    priceMax !== '' ||
    changeMin !== '' ||
    changeMax !== '';

  return (
    <div className="space-y-3 pt-3 border-t border-border/50">
      {/* Sector multi-select chips */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">القطاع</p>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {availableSectors.map((sector) => {
            const isActive = selectedSectors.includes(sector);
            return (
              <button
                key={sector}
                onClick={() => onToggleSector(sector)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
                  isActive
                    ? 'bg-profit text-white border-profit'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted'
                )}
              >
                {sector}
              </button>
            );
          })}
          {availableSectors.length === 0 && (
            <span className="text-xs text-muted-foreground">لا توجد قطاعات متاحة</span>
          )}
        </div>
      </div>

      {/* Price range + Change range side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">نطاق السعر</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              value={priceMin}
              onChange={(e) => onPriceMinChange(e.target.value)}
              placeholder="أقل"
              className="h-8 text-xs"
              min={0}
            />
            <span className="text-xs text-muted-foreground">←</span>
            <Input
              type="number"
              inputMode="decimal"
              value={priceMax}
              onChange={(e) => onPriceMaxChange(e.target.value)}
              placeholder="أعلى"
              className="h-8 text-xs"
              min={0}
            />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">نطاق التغير %</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              value={changeMin}
              onChange={(e) => onChangeMinChange(e.target.value)}
              placeholder="أقل"
              className="h-8 text-xs"
            />
            <span className="text-xs text-muted-foreground">←</span>
            <Input
              type="number"
              inputMode="decimal"
              value={changeMax}
              onChange={(e) => onChangeMaxChange(e.target.value)}
              placeholder="أعلى"
              className="h-8 text-xs"
            />
          </div>
        </div>
      </div>

      {hasAdvancedActive && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
            onClick={onReset}
          >
            <X className="w-3.5 h-3.5 ml-1" />
            إعادة تعيين الفلاتر المتقدمة
          </Button>
        </div>
      )}
    </div>
  );
});

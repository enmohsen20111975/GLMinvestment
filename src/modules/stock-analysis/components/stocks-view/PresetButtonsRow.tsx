/**
 * stocks-view/PresetButtonsRow.tsx
 * ============================================================================
 * F-Phase3-Split-StocksView: top preset buttons row (EGX only — most_active,
 * undervalued, overvalued, top_gainers, top_losers, etc.).
 *
 * UI-STABILITY fix (2026-09-28): wrapped in React.memo so it doesn't re-render
 * on every parent state change (search, page, sort, etc.).
 * ============================================================================
 */

import { memo } from 'react';
import { LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { PRESET_BUTTONS } from './constants';
import type { PresetButtonsRowProps } from './types';

export const PresetButtonsRow = memo(function PresetButtonsRow({
  activePreset,
  onSelect,
}: PresetButtonsRowProps) {
  return (
    <Card className="py-0 gap-0">
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <LayoutGrid className="w-4 h-4 text-profit " />
          <span className="text-sm font-semibold">القوائم المُسبقة</span>
          <span className="text-xs text-muted-foreground">— اختر قائمة لعرض الأسهم المُصنّفة</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {/* "All" button — first */}
          <button
            onClick={() => onSelect('all')}
            className={cn(
              'flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border',
              activePreset === 'all'
                ? 'bg-profit text-white border-profit shadow-sm'
                : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
            )}
            aria-pressed={activePreset === 'all'}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>الكل</span>
          </button>
          {PRESET_BUTTONS.map((p) => {
            const Icon = p.icon;
            const isActive = activePreset === p.key;
            return (
              <button
                key={p.key}
                onClick={() => onSelect(p.key)}
                title={p.hint}
                aria-pressed={isActive}
                className={cn(
                  'flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border',
                  isActive
                    ? 'bg-profit text-white border-profit shadow-sm'
                    : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-white' : 'text-profit ')} />
                <span className="truncate">{p.label}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
});

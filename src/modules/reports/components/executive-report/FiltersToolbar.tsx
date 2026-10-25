/**
 * executive-report/FiltersToolbar.tsx
 * ===================================
 * Advanced filters toolbar. Quality mode + confidence threshold + outcome +
 * signal + search input + active-filter counter + reset.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Filter, Search, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CONFIDENCE_OPTIONS,
  OUTCOME_FILTER_OPTIONS,
  QUALITY_MODE_OPTIONS,
  SIGNAL_FILTER_OPTIONS,
} from './constants';
import type {
  FilterOutcome,
  FilterSignal,
  QualityMode,
} from './types';

export interface FiltersToolbarProps {
  showFilters: boolean;
  setShowFilters: (b: boolean) => void;
  activeFilterCount: number;
  onReset: () => void;
  qualityMode: QualityMode;
  setQualityMode: (q: QualityMode) => void;
  minConfidence: number;
  setMinConfidence: (n: number) => void;
  filterOutcome: FilterOutcome;
  setFilterOutcome: (o: FilterOutcome) => void;
  filterSignal: FilterSignal;
  setFilterSignal: (s: FilterSignal) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export function FiltersToolbar({
  showFilters,
  setShowFilters,
  activeFilterCount,
  onReset,
  qualityMode,
  setQualityMode,
  minConfidence,
  setMinConfidence,
  filterOutcome,
  setFilterOutcome,
  filterSignal,
  setFilterSignal,
  searchQuery,
  setSearchQuery,
}: FiltersToolbarProps) {
  return (
    <div className="bg-card/60 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-border shadow-sm space-y-3">
      {/* Header row: toggle + active count + reset */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20 transition-colors"
        >
          <Filter className="w-4 h-4" />
          فلاتر متقدمة
          {activeFilterCount > 0 && (
            <Badge className="bg-warning text-black text-xs px-1.5 py-0 min-w-[20px] h-5 flex items-center justify-center">
              {activeFilterCount}
            </Badge>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-loss hover:bg-loss/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            مسح الفلاتر ({activeFilterCount})
          </button>
        )}
      </div>

      {showFilters && (
        <div className="space-y-3 pt-1 border-t border-border">
          {/* RL-FIX-10: Quality Mode Filter — أهم فلتر (أفضل التوقعات بس) */}
          <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-xl bg-warning/5 border border-warning/20">
            <span className="text-xs font-bold text-warning flex-shrink-0 w-16 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              الجودة:
            </span>
            {QUALITY_MODE_OPTIONS.map((opt) => (
              <button
                key={`qfilter-${opt.value}`}
                onClick={() => setQualityMode(opt.value)}
                title={opt.desc}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1',
                  qualityMode === opt.value
                    ? 'bg-warning text-black border-warning shadow-sm'
                    : 'bg-card/80 hover:bg-muted text-muted-foreground border-border',
                )}
              >
                <span>{opt.emoji}</span>
                {opt.label}
              </button>
            ))}
            <span className="text-xs text-muted-foreground mr-auto">
              {qualityMode === 'top_picks'
                ? '5 توقعات/يوم لكل شخصية — أرقام منطقية'
                : 'كل التوقعات — للتحليل الشامل'}
            </span>
          </div>

          {/* RL-FIX-10: Confidence Threshold Filter */}
          {qualityMode === 'top_picks' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-muted-foreground flex-shrink-0 w-16">الثقة ≥:</span>
              {CONFIDENCE_OPTIONS.map((opt) => (
                <button
                  key={`cfilter-${opt.value}`}
                  onClick={() => setMinConfidence(opt.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border',
                    minConfidence === opt.value
                      ? 'bg-profit text-white border-profit shadow-sm'
                      : 'bg-card/80 hover:bg-muted text-muted-foreground border-border',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* FEAT5-PERSONA-REMOVAL: Persona Filter UI removed — production engine
         is V40.2 balanced-only; clients must not see persona switcher
         buttons. The `filterPersona` state stays in the data layer and
         defaults to 'all' (shows every historical prediction regardless
         of legacy persona tag). */}

          {/* Outcome Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-muted-foreground flex-shrink-0 w-16">النتيجة:</span>
            {OUTCOME_FILTER_OPTIONS.map((opt) => (
              <button
                key={`ofilter-${opt.value}`}
                onClick={() => setFilterOutcome(opt.value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border',
                  filterOutcome === opt.value
                    ? cn('bg-card border-border', opt.color, 'ring-1 ring-current')
                    : 'bg-card/50 hover:bg-muted text-muted-foreground border-border',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Signal Filter + Search */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-muted-foreground flex-shrink-0 w-16">الإشارة:</span>
            {SIGNAL_FILTER_OPTIONS.map((opt) => (
              <button
                key={`sfilter-${opt.value}`}
                onClick={() => setFilterSignal(opt.value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border',
                  filterSignal === opt.value
                    ? 'bg-warning text-black border-warning'
                    : 'bg-card/80 hover:bg-muted text-muted-foreground border-border',
                )}
              >
                {opt.label}
              </button>
            ))}

            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px] mr-auto">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالرمز أو الاسم..."
                className="w-full pr-9 pl-3 py-1.5 rounded-lg text-xs font-medium bg-card/80 border border-border focus:border-warning/20 focus:ring-1 focus:ring-warning/30 outline-none transition-colors text-foreground placeholder:text-muted-foreground"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

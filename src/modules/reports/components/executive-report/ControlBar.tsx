/**
 * executive-report/ControlBar.tsx
 * ================================
 * Top control bar: branding badge + timeframe label + unique-stock count +
 * Refresh / Export PNG / Publish / Back buttons.
 *
 * Also renders the Timeframe Selector pill row below the control bar.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3,
  ChevronLeft,
  Clock,
  Download,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { TIMEFRAME_OPTIONS } from './constants';
import type { ReportTimeframe } from './types';

export interface ControlBarProps {
  market: string;
  timeframeLabel: string;
  uniqueStockCount: number;
  totalPredictionCount: number;
  days: ReportTimeframe;
  setDays: (d: ReportTimeframe) => void;
  refreshing: boolean;
  exporting: boolean;
  loading: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onClose?: () => void;
  reportShareText: string;
  reportContainerRef: React.RefObject<HTMLDivElement>;
}

export function ControlBar({
  market,
  timeframeLabel,
  uniqueStockCount,
  totalPredictionCount,
  days,
  setDays,
  refreshing,
  exporting,
  loading,
  onRefresh,
  onExport,
  onClose,
  reportShareText,
  reportContainerRef,
}: ControlBarProps) {
  return (
    <>
      {/* ════════════════ Control Bar ════════════════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/60 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-border shadow-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 font-bold gap-1 text-xs">
              <Layers className="w-3.5 h-3.5" />
              ملخص الأداء
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">{timeframeLabel}</span>
            <span className="text-xs text-muted-foreground">
              · {uniqueStockCount} سهم فريد
              {totalPredictionCount > uniqueStockCount && (
                <span className="text-muted-foreground">
                  {' '}
                  ({totalPredictionCount} توقع · 3 شخصيات/سهم)
                </span>
              )}
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-black text-foreground mt-2 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-warning flex-shrink-0" />
            <span>ملخص أداء التوقعات</span>
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="h-10 px-4 text-sm font-bold"
          >
            <RefreshCw className={cn('w-4 h-4 ml-1.5 text-profit', refreshing && 'animate-spin')} />
            تحديث
          </Button>

          <Button
            onClick={onExport}
            disabled={exporting || loading}
            size="sm"
            className="h-10 px-4 text-sm font-bold from-warning to-warning hover:from-warning hover:to-warning text-black shadow-lg shadow-amber-500/20"
          >
            <Download className="w-4 h-4 ml-1.5" />
            تصدير PNG 📸
          </Button>

          <UnifiedPublishButton
            content={reportShareText}
            title={`ملخص أداء التوقعات — ${market} · ${timeframeLabel}`}
            image={reportContainerRef}
            filename={`executive_report_${market}_${new Date().toISOString().split('T')[0]}`}
            hashtags={['EGX', 'بورصة', 'توقعات']}
            variant="outline"
            size="sm"
          />

          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="h-10 px-3 text-sm flex-shrink-0">
              <ChevronLeft className="w-4 h-4 ml-1" /> رجوع
            </Button>
          )}
        </div>
      </div>

      {/* ════════════════ Timeframe Selector ════════════════ */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1.5 no-scrollbar">
        <span className="text-sm font-bold text-muted-foreground ml-1 flex-shrink-0">الفترة:</span>
        {TIMEFRAME_OPTIONS.map((opt) => (
          <button
            key={`tf-${opt.value}`}
            onClick={() => setDays(opt.value)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-1.5 border flex-shrink-0 whitespace-nowrap',
              days === opt.value
                ? 'from-warning to-warning text-black border-warning shadow-md shadow-amber-500/30'
                : 'bg-card/80 hover:bg-muted text-muted-foreground border-border',
            )}
          >
            <Clock className="w-3.5 h-3.5" />
            {opt.label}
          </button>
        ))}
      </div>
    </>
  );
}

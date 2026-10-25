/**
 * executive-report/MissedOppCard.tsx
 * ==================================
 * Card listing missed opportunities / false positives / correct calls from the
 * `/api/predictions/honest-tracking/missed-opportunities` endpoint.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, fmtPrice } from '@/lib/utils';
import { MISSED_OPP_ACCENTS } from './constants';
import { signalBadgeClass } from './helpers';
import type { MissedOpportunityItem } from './types';

export interface MissedOppCardProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: 'amber' | 'rose' | 'emerald' | 'teal';
  items?: MissedOpportunityItem[];
  loading: boolean;
}

export function MissedOppCard({
  title,
  subtitle,
  icon,
  accent,
  items,
  loading,
}: MissedOppCardProps) {
  const a = MISSED_OPP_ACCENTS[accent];
  const list = (items || []).slice(0, 8);
  const count = items?.length ?? 0;

  return (
    <div className={cn('relative bg-card p-5 rounded-2xl border space-y-3 overflow-hidden', a.ring)}>
      <div className={cn('absolute top-0 right-0 w-1.5 h-full', a.bar)} />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <div className="min-w-0">
            <h4 className="text-sm sm:text-base font-bold text-foreground truncate">{title}</h4>
            <p className="text-xs sm:text-xs text-muted-foreground truncate">{subtitle}</p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn('text-xs flex-shrink-0', a.value, a.ring, 'bg-transparent')}
        >
          {count} سهم
        </Badge>
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={`mo-sk-${i}`} className="h-14 w-full bg-card rounded-lg" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">لا توجد بيانات</div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {list.map((item) => {
            const change = Number(item.pct_change ?? 0);
            const changePositive = change >= 0;
            return (
              <div
                key={`mo-${item.id}-${item.ticker}`}
                className="bg-muted p-3 rounded-lg border border-white/10 hover:border-white/25 transition-colors flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-black text-foreground text-sm font-mono flex-shrink-0">
                      {item.ticker}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn('text-xs px-1.5 py-0', signalBadgeClass(item.signal))}
                    >
                      {item.signal}
                    </Badge>
                  </div>
                  <span
                    className={cn(
                      'font-black text-sm sm:text-base flex-shrink-0',
                      changePositive ? 'text-profit' : 'text-loss',
                    )}
                  >
                    {changePositive ? '+' : ''}
                    {(change ?? 0).toFixed(2)}%
                  </span>
                </div>
                {item.name && <p className="text-xs text-foreground truncate">{item.name}</p>}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-white/5">
                  <span className="font-mono">
                    {fmtPrice(item.entry_price)} → {fmtPrice(item.current_price)}
                  </span>
                  {item.prediction_date && (
                    <span className="text-muted-foreground font-mono">
                      {String(item.prediction_date).slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

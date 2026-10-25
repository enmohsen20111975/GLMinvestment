/**
 * executive-report/HighlightCard.tsx
 * ==================================
 * Card listing the top N items (gains / losses / fastest / trailing profit) —
 * each item rendered as a small tile with ticker, % return, and metadata.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { HighlightItem } from './types';

export interface HighlightCardProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accentBorder: string;
  items: HighlightItem[];
  placeholder: string;
}

export function HighlightCard({
  title,
  subtitle,
  icon,
  accentBorder,
  items,
  placeholder,
}: HighlightCardProps) {
  return (
    <div className={cn('bg-card p-6 rounded-2xl border space-y-4', accentBorder)}>
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-base sm:text-lg font-bold text-foreground">{title}</h3>
        </div>
        <Badge variant="outline" className="text-xs text-foreground border-white/20 bg-white/5">
          {subtitle}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.length > 0 ? (
          items.map((item, idx) => (
            <div
              key={`${title}-${item.ticker}-${idx}`}
              className="bg-muted p-4 rounded-xl border border-white/10 hover:border-white/25 transition-colors flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-foreground text-base font-mono">{item.ticker}</span>
                <span className={cn('font-black text-lg', item.accentText)}>
                  {item.returnPct >= 0 ? '+' : ''}
                  {(item.returnPct ?? 0).toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-foreground truncate">{item.nameAr || item.ticker}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-white/5">
                <span>{item.meta}</span>
                <span className="font-bold text-foreground">{item.rightMeta}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-2 text-center py-8 text-muted-foreground text-sm">
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}

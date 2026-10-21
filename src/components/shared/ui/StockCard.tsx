'use client';

/**
 * StockCard — Unified stock/asset card
 * ====================================================================
 * Per ALPHA Mission Directive 2026-10-20.
 *
 * Dumb presentational component: receives all data via props.
 * NO calculations in the frontend (per owner directive).
 *
 * Variants:
 *   - 'compact'  — ticker + name + price + trend (for grids/lists)
 *   - 'detailed' — adds sector + signal badge + stage + R/R (for tables/cards)
 *
 * @example
 * <StockCard
 *   ticker="ABUK"
 *   nameAr="أبو قير للأسمدة"
 *   price={125.50}
 *   change={2.5}
 *   sector="الأسمدة"
 *   variant="compact"
 * />
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { StockIconMini } from '@/modules/stock-analysis/components/StockIcon';
import { TrendIndicator } from './TrendIndicator';
import { FinancialBadge } from './FinancialBadge';

export interface StockCardProps {
  /** Ticker symbol. */
  ticker: string;
  /** Arabic name. */
  nameAr?: string;
  /** English name. */
  name?: string;
  /** Current price. */
  price?: number | null;
  /** Price change (percent or value). */
  change?: number | null;
  /** Format for the change display. default: 'percent'. */
  changeFormat?: 'percent' | 'value';
  /** Sector name (for detailed variant). */
  sector?: string | null;
  /** Signal/trading recommendation (for detailed variant). */
  signal?: string | null;
  /** Arabic signal label. */
  signalAr?: string | null;
  /** Movement stage (for detailed variant). */
  stage?: string | null;
  /** Arabic stage label. */
  stageAr?: string | null;
  /** Risk/Reward ratio (for detailed variant). */
  riskReward?: number | null;
  /** Logo URL from API. */
  logoUrl?: string | null;
  /** Card variant. default: 'compact'. */
  variant?: 'compact' | 'detailed';
  /** Click handler. */
  onClick?: () => void;
  /** Extra className. */
  className?: string;
}

export function StockCard({
  ticker,
  nameAr,
  name,
  price,
  change,
  changeFormat = 'percent',
  sector,
  signal,
  signalAr,
  stage,
  stageAr,
  riskReward,
  logoUrl,
  variant = 'compact',
  onClick,
  className,
}: StockCardProps) {
  const cleanTicker = (ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
  const displayName = nameAr || name || cleanTicker;

  if (variant === 'compact') {
    return (
      <Card
        className={cn('border-border hover:border-primary/30 transition-colors cursor-pointer', className)}
        onClick={onClick}
      >
        <CardContent className="p-3 flex items-center gap-3">
          <StockIconMini
            ticker={cleanTicker}
            name={displayName}
            sector={sector}
            logoUrl={logoUrl}
            className="w-8 h-8"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sm truncate">{cleanTicker}</span>
              <span className="font-mono text-sm font-bold tabular-nums">
                {price != null ? price.toFixed(2) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground truncate">{displayName}</span>
              {change != null && (
                <TrendIndicator value={change} format={changeFormat} size="xs" />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Detailed variant
  return (
    <Card
      className={cn('border-border hover:border-primary/30 transition-colors cursor-pointer', className)}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: icon + ticker + name */}
        <div className="flex items-center gap-3">
          <StockIconMini
            ticker={cleanTicker}
            name={displayName}
            sector={sector}
            logoUrl={logoUrl}
            className="w-10 h-10"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base">{cleanTicker}</span>
              {signal && (
                <FinancialBadge status={signal} label={signalAr || undefined} size="xs" />
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{displayName}</p>
            {sector && (
              <p className="text-[10px] text-muted-foreground/70 truncate">{sector}</p>
            )}
          </div>
        </div>

        {/* Price + change */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] text-muted-foreground">السعر</span>
            <div className="font-mono text-lg font-bold tabular-nums">
              {price != null ? price.toFixed(2) : '—'}
            </div>
          </div>
          {change != null && (
            <TrendIndicator value={change} format={changeFormat} size="md" />
          )}
        </div>

        {/* Footer: stage + R/R */}
        {(stage || riskReward != null) && (
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            {stage && (
              <FinancialBadge tone="warning" label={stageAr || stage} size="xs" icon={stage ? '🛡️' : undefined} />
            )}
            {riskReward != null && (
              <span className="text-[10px] text-muted-foreground">
                R/R: <span className={cn('font-bold tabular-nums', riskReward >= 1.8 ? 'text-profit' : 'text-warning')}>
                  {riskReward.toFixed(2)}
                </span>
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default StockCard;

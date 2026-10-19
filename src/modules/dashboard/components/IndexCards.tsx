'use client';

import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useAppStore, type MarketType } from '@/lib/store';
import { Card, CardContent } from '@/components/ui/card';
import { cn, safeNum } from '@/lib/utils';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import type { MarketIndex } from '@/types';

/**
 * MARKET-INDICES-SYSTEM
 * ----------------------
 * IndexCards is now market-aware: each market displays its OWN indices.
 *
 * Color map is keyed by index `symbol` first, with a per-market fallback palette
 * so cards stay visually distinct even if a new symbol appears.
 */

// Per-index accent palette (overrides market defaults when symbol matches)
const INDEX_COLOR_MAP: Record<string, { accent: string; ring: string; text: string }> = {
  // EGX
  EGX30:    { accent: 'bg-profit', ring: 'ring-profit/20', text: 'text-profit dark:text-profit' },
  EGX70:    { accent: 'bg-warning',   ring: 'ring-warning/20',   text: 'text-warning dark:text-warning' },
  EGX100:   { accent: 'bg-whale',    ring: 'ring-whale/20',    text: 'text-whale dark:text-whale' },
  EGX50:    { accent: 'bg-cyan-500',    ring: 'ring-cyan-500/20',    text: 'text-cyan-600 dark:text-cyan-400' },
  EGX33:    { accent: 'bg-loss',    ring: 'ring-loss/20',    text: 'text-loss dark:text-loss' },
  // US
  '^GSPC':  { accent: 'bg-primary',    ring: 'ring-primary/20',    text: 'text-primary dark:text-primary' },
  '^IXIC':  { accent: 'bg-violet-500',  ring: 'ring-violet-500/20',  text: 'text-violet-600 dark:text-violet-400' },
  '^DJI':   { accent: 'bg-indigo-500',  ring: 'ring-indigo-500/20',  text: 'text-indigo-600 dark:text-indigo-400' },
  // CRYPTO
  'BTC.D':        { accent: 'bg-orange-500', ring: 'ring-orange-500/20', text: 'text-orange-600 dark:text-orange-400' },
  TOTAL_MCAP:     { accent: 'bg-purple-500', ring: 'ring-purple-500/20', text: 'text-purple-600 dark:text-purple-400' },
  FNG:            { accent: 'bg-pink-500',   ring: 'ring-pink-500/20',   text: 'text-pink-600 dark:text-pink-400' },
  // TADAWUL
  '^TASI.SR':       { accent: 'bg-success',   ring: 'ring-success/20',   text: 'text-success dark:text-success' },
  TADAWUL_COMPOSITE: { accent: 'bg-lime-600',    ring: 'ring-lime-500/20',    text: 'text-lime-600 dark:text-lime-400' },
  // KSE / QSE composites
  KSE_COMPOSITE: { accent: 'bg-sky-600',     ring: 'ring-sky-500/20',     text: 'text-sky-600 dark:text-sky-400' },
  QSE_COMPOSITE: { accent: 'bg-fuchsia-600',  ring: 'ring-fuchsia-500/20', text: 'text-fuchsia-600 dark:text-fuchsia-400' },
};

// Per-market fallback palette (cycled for multi-index markets)
const MARKET_PALETTE: Record<MarketType, Array<{ accent: string; ring: string; text: string }>> = {
  EGX: [
    { accent: 'bg-profit', ring: 'ring-profit/20', text: 'text-profit dark:text-profit' },
    { accent: 'bg-warning',   ring: 'ring-warning/20',   text: 'text-warning dark:text-warning' },
    { accent: 'bg-whale',    ring: 'ring-whale/20',    text: 'text-whale dark:text-whale' },
    { accent: 'bg-cyan-500',    ring: 'ring-cyan-500/20',    text: 'text-cyan-600 dark:text-cyan-400' },
  ],
  US: [
    { accent: 'bg-primary',    ring: 'ring-primary/20',    text: 'text-primary dark:text-primary' },
    { accent: 'bg-violet-500',  ring: 'ring-violet-500/20',  text: 'text-violet-600 dark:text-violet-400' },
    { accent: 'bg-indigo-500',  ring: 'ring-indigo-500/20',  text: 'text-indigo-600 dark:text-indigo-400' },
  ],
  CRYPTO: [
    { accent: 'bg-orange-500', ring: 'ring-orange-500/20', text: 'text-orange-600 dark:text-orange-400' },
    { accent: 'bg-purple-500', ring: 'ring-purple-500/20', text: 'text-purple-600 dark:text-purple-400' },
    { accent: 'bg-pink-500',   ring: 'ring-pink-500/20',   text: 'text-pink-600 dark:text-pink-400' },
  ],
  TADAWUL: [
    { accent: 'bg-success', ring: 'ring-success/20', text: 'text-success dark:text-success' },
    { accent: 'bg-lime-600',  ring: 'ring-lime-500/20',  text: 'text-lime-600 dark:text-lime-400' },
  ],
  KSE: [
    { accent: 'bg-sky-600', ring: 'ring-sky-500/20', text: 'text-sky-600 dark:text-sky-400' },
  ],
  QSE: [
    { accent: 'bg-fuchsia-600', ring: 'ring-fuchsia-500/20', text: 'text-fuchsia-600 dark:text-fuchsia-400' },
  ],
};

function IndexSymbolBadge({ symbol }: { symbol: string }) {
  const match = symbol.match(/(\d+)/);
  const number = match ? match[1] : '';
  // For Yahoo symbols (start with ^), strip the caret for display
  const displayNumber = number || (symbol.startsWith('^') ? symbol.slice(1, 4) : '');

  return (
    <div className="absolute -left-2 -bottom-1 text-7xl font-black opacity-[0.04] leading-none select-none pointer-events-none">
      <span className="text-8xl">{displayNumber}</span>
    </div>
  );
}

function IndexCard({ index, colors }: { index: MarketIndex; colors: { accent: string; ring: string; text: string } }) {
  const isPositive = index.change >= 0;

  return (
    <Card className="relative overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow duration-200 group">
      <IndexSymbolBadge symbol={index.symbol} />
      <CardContent className="p-2.5 relative z-10">
        {/* Index identifier pill */}
        <div className="flex items-center justify-between mb-1.5">
          <span className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide',
            colors.ring,
            isPositive
              ? 'bg-profit text-profit dark:bg-profit/60 dark:text-profit'
              : 'bg-loss text-loss dark:bg-loss/60 dark:text-loss'
          )}>
            {index.symbol}
          </span>
          {isPositive ? (
            <TrendingUp className="w-3.5 h-3.5 text-profit" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-loss" />
          )}
        </div>

        {/* Index Arabic name */}
        <p className="text-[10px] font-medium text-muted-foreground mb-0.5 truncate">
          {index.name_ar}
        </p>

        {/* Current value */}
        <p className="text-base font-bold tabular-nums text-foreground mb-1">
          {index.value.toLocaleString('ar-EG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>

        {/* Change row */}
        <div className="flex items-center gap-1.5">
          <span className={cn(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums',
            isPositive
              ? 'bg-profit text-profit dark:bg-profit/50 dark:text-profit'
              : 'bg-loss text-loss dark:bg-loss/50 dark:text-loss'
          )}>
            {isPositive ? '+' : ''}
            {safeNum(index.change_percent).toFixed(2)}%
          </span>
          <span className={cn(
            'text-[11px] font-medium tabular-nums',
            isPositive
              ? 'text-profit dark:text-profit'
              : 'text-loss dark:text-loss'
          )}>
            {isPositive ? '+' : ''}
            {safeNum(index.change).toFixed(2)}
          </span>
        </div>

        <div className="mt-2 -mx-1">
          <MiniSparkline ticker={index.symbol} height={28} width={120} showArea={true} />
        </div>
      </CardContent>
    </Card>
  );
}

export function IndexCards() {
  const { marketOverview, currentMarket } = useAppStore();

  if (!marketOverview || !marketOverview.indices) return null;

  // Filter out null/undefined indices
  const validIndices = marketOverview.indices.filter((index): index is MarketIndex => index != null && Boolean(index.symbol));

  if (validIndices.length === 0) return null;

  const fallbackPalette = MARKET_PALETTE[currentMarket] || MARKET_PALETTE.EGX;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" dir="rtl">
      {validIndices.map((index, i) => {
        const colors =
          INDEX_COLOR_MAP[index.symbol] ||
          fallbackPalette[i % fallbackPalette.length];
        return <IndexCard key={index.symbol} index={index} colors={colors} />;
      })}
    </div>
  );
}

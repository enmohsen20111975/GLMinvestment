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
// SCR-001 + Rule 30: emerald/teal/amber/orange/lime/rose only — NO blue/indigo/violet/cyan/pink/purple
const INDEX_COLOR_MAP: Record<string, { accent: string; ring: string; text: string }> = {
  // EGX
  EGX30:    { accent: 'bg-emerald-500', ring: 'ring-emerald-500/20', text: 'text-emerald-500 dark:text-emerald-400' },
  EGX70:    { accent: 'bg-amber-500',   ring: 'ring-amber-500/20',   text: 'text-amber-600 dark:text-amber-400' },
  EGX100:   { accent: 'bg-teal-500',    ring: 'ring-teal-500/20',    text: 'text-teal-600 dark:text-teal-400' },
  EGX50:    { accent: 'bg-teal-400',    ring: 'ring-teal-400/20',    text: 'text-teal-600 dark:text-teal-400' },
  EGX33:    { accent: 'bg-rose-500',    ring: 'ring-rose-500/20',    text: 'text-rose-600 dark:text-rose-400' },
  // US
  '^GSPC':  { accent: 'bg-primary',    ring: 'ring-primary/20',    text: 'text-primary dark:text-slate-400' },
  '^IXIC':  { accent: 'bg-violet-500',  ring: 'ring-violet-500/20',  text: 'text-violet-600 dark:text-violet-400' },
  '^DJI':   { accent: 'bg-emerald-500',  ring: 'ring-emerald-500/20',  text: 'text-emerald-600 dark:text-emerald-400' },
  // CRYPTO
  'BTC.D':        { accent: 'bg-orange-500', ring: 'ring-orange-500/20', text: 'text-orange-600 dark:text-orange-400' },
  TOTAL_MCAP:     { accent: 'bg-purple-500', ring: 'ring-purple-500/20', text: 'text-purple-600 dark:text-purple-400' },
  FNG:            { accent: 'bg-pink-500',   ring: 'ring-pink-500/20',   text: 'text-pink-600 dark:text-pink-400' },
  // US — Rule 30: replaced blue/violet/indigo with emerald/amber/teal shades
  '^GSPC':  { accent: 'bg-emerald-500', ring: 'ring-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400' },
  '^IXIC':  { accent: 'bg-amber-500',   ring: 'ring-amber-500/20',   text: 'text-amber-600 dark:text-amber-400' },
  '^DJI':   { accent: 'bg-teal-500',    ring: 'ring-teal-500/20',    text: 'text-teal-600 dark:text-teal-400' },
  // CRYPTO — Rule 30: replaced orange/purple/pink with amber/teal/emerald
  'BTC.D':        { accent: 'bg-amber-500', ring: 'ring-amber-500/20', text: 'text-amber-600 dark:text-amber-400' },
  TOTAL_MCAP:     { accent: 'bg-teal-500',  ring: 'ring-teal-500/20',  text: 'text-teal-600 dark:text-teal-400' },
  FNG:            { accent: 'bg-emerald-500', ring: 'ring-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400' },
  // TADAWUL
  '^TASI.SR':       { accent: 'bg-emerald-600',   ring: 'ring-emerald-500/20',   text: 'text-emerald-600 dark:text-emerald-400' },
  TADAWUL_COMPOSITE: { accent: 'bg-lime-600',    ring: 'ring-lime-500/20',    text: 'text-lime-600 dark:text-lime-400' },
  // KSE / QSE composites — Rule 30: replaced sky/fuchsia with teal/amber
  KSE_COMPOSITE: { accent: 'bg-teal-600',     ring: 'ring-teal-500/20',     text: 'text-teal-600 dark:text-teal-400' },
  QSE_COMPOSITE: { accent: 'bg-amber-600',  ring: 'ring-amber-500/20', text: 'text-amber-600 dark:text-amber-400' },
};

// Per-market fallback palette (cycled for multi-index markets)
// SCR-001 + Rule 30: emerald/teal/amber only — NO blue/indigo/violet/cyan
const MARKET_PALETTE: Record<MarketType, Array<{ accent: string; ring: string; text: string }>> = {
  EGX: [
    { accent: 'bg-emerald-500', ring: 'ring-emerald-500/20', text: 'text-emerald-500 dark:text-emerald-400' },
    { accent: 'bg-amber-500',   ring: 'ring-amber-500/20',   text: 'text-amber-600 dark:text-amber-400' },
    { accent: 'bg-teal-500',    ring: 'ring-teal-500/20',    text: 'text-teal-600 dark:text-teal-400' },
    { accent: 'bg-lime-500',    ring: 'ring-lime-500/20',    text: 'text-lime-600 dark:text-lime-400' },
  ],
  US: [
    { accent: 'bg-primary',    ring: 'ring-primary/20',    text: 'text-primary dark:text-slate-400' },
    { accent: 'bg-violet-500',  ring: 'ring-violet-500/20',  text: 'text-violet-600 dark:text-violet-400' },
    { accent: 'bg-emerald-500',  ring: 'ring-emerald-500/20',  text: 'text-emerald-600 dark:text-emerald-400' },
    { accent: 'bg-emerald-500', ring: 'ring-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400' },
    { accent: 'bg-amber-500',   ring: 'ring-amber-500/20',   text: 'text-amber-600 dark:text-amber-400' },
    { accent: 'bg-teal-500',    ring: 'ring-teal-500/20',    text: 'text-teal-600 dark:text-teal-400' },
  ],
  CRYPTO: [
    { accent: 'bg-amber-500', ring: 'ring-amber-500/20', text: 'text-amber-600 dark:text-amber-400' },
    { accent: 'bg-teal-500',  ring: 'ring-teal-500/20',  text: 'text-teal-600 dark:text-teal-400' },
    { accent: 'bg-emerald-500', ring: 'ring-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400' },
  ],
  TADAWUL: [
    { accent: 'bg-emerald-600', ring: 'ring-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400' },
    { accent: 'bg-lime-600',  ring: 'ring-lime-500/20',  text: 'text-lime-600 dark:text-lime-400' },
  ],
  KSE: [
    { accent: 'bg-teal-600', ring: 'ring-teal-500/20', text: 'text-teal-600 dark:text-teal-400' },
  ],
  QSE: [
    { accent: 'bg-amber-600', ring: 'ring-amber-500/20', text: 'text-amber-600 dark:text-amber-400' },
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
    <Card className="glass-panel relative overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow duration-200 group">
      <IndexSymbolBadge symbol={index.symbol} />
      <CardContent className="p-2.5 relative z-10">
        {/* Index identifier pill */}
        <div className="flex items-center justify-between mb-1.5">
          <span className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide font-mono',
            colors.ring,
            isPositive
              ? 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
          )}>
            {index.symbol}
          </span>
          {isPositive ? (
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-red-500" />
          )}
        </div>

        {/* Index Arabic name */}
        <p className="text-[10px] font-medium text-muted-foreground mb-0.5 truncate" dir="rtl">
          {index.name_ar}
        </p>

        {/* Current value — tabular-nums + font-mono for Bloomberg feel */}
        <p className="text-base font-bold tabular-nums font-mono text-foreground mb-1">
          {index.value.toLocaleString('ar-EG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>

        {/* Change row */}
        <div className="flex items-center gap-1.5">
          <span className={cn(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums font-mono',
            isPositive
              ? 'bg-emerald-100 text-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
          )}>
            {isPositive ? '+' : ''}
            {safeNum(index.change_percent).toFixed(2)}%
          </span>
          <span className={cn(
            'text-[11px] font-medium tabular-nums font-mono',
            isPositive
              ? 'text-emerald-500 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
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

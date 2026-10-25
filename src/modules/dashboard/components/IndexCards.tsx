'use client';

import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useAppStore, type MarketType } from '@/lib/store';
import { cn, safeNum } from '@/lib/utils';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { WidgetCard } from '@/components/shared/WidgetCard';
import type { MarketIndex } from '@/types';

/**
 * MARKET-INDICES-SYSTEM
 * ----------------------
 * IndexCards is now market-aware: each market displays its OWN indices.
 *
 * Color map is keyed by index `symbol` first, with a per-market fallback palette
 * so cards stay visually distinct even if a new symbol appears.
 *
 * Adoption note (F-Phase3-Adoption-Batch1): every IndexCard tile now uses
 * <WidgetCard> instead of <Card><CardContent>. The colored symbol pill moved
 * to the `badge` slot, the trend icon to the `icon` slot (with colored bg),
 * and the Arabic name became the `title`. The decorative ghost-number
 * background (IndexSymbolBadge, ~12 LOC) was dropped — it was a 4%-opacity
 * flourish that didn't survive the unified header layout. EGX click-to-stocks
 * navigation is preserved via a wrapping <button>.
 */

// Per-index accent palette (overrides market defaults when symbol matches)
const INDEX_COLOR_MAP: Record<string, { accent: string; ring: string; text: string }> = {
  // EGX
  EGX30: { accent: 'bg-profit', ring: 'ring-profit/20', text: 'text-profit ' },
  EGX70: { accent: 'bg-warning', ring: 'ring-warning/20', text: 'text-warning ' },
  EGX100: { accent: 'bg-whale', ring: 'ring-whale/20', text: 'text-whale ' },
  EGX50: { accent: 'bg-whale', ring: 'ring-cyan-500/20', text: 'text-whale dark:text-whale' },
  EGX33: { accent: 'bg-loss', ring: 'ring-loss/20', text: 'text-loss ' },
  // US
  '^GSPC': { accent: 'bg-primary', ring: 'ring-primary/20', text: 'text-primary ' },
  '^IXIC': { accent: 'bg-violet-500', ring: 'ring-violet-500/20', text: 'text-violet-600 dark:text-violet-400' },
  '^DJI': { accent: 'bg-indigo-500', ring: 'ring-indigo-500/20', text: 'text-indigo-600 dark:text-indigo-400' },
  // CRYPTO
  'BTC.D': { accent: 'bg-warning', ring: 'ring-orange-500/20', text: 'text-warning ' },
  TOTAL_MCAP: { accent: 'bg-primary', ring: 'ring-purple-500/20', text: 'text-primary ' },
  FNG: { accent: 'bg-pink-500', ring: 'ring-pink-500/20', text: 'text-pink-600 dark:text-pink-400' },
  // TADAWUL
  '^TASI.SR': { accent: 'bg-success', ring: 'ring-success/20', text: 'text-success ' },
  TADAWUL_COMPOSITE: { accent: 'bg-lime-600', ring: 'ring-lime-500/20', text: 'text-lime-600 dark:text-lime-400' },
  // KSE / QSE composites
  KSE_COMPOSITE: { accent: 'bg-sky-600', ring: 'ring-sky-500/20', text: 'text-sky-600 dark:text-sky-400' },
  QSE_COMPOSITE: { accent: 'bg-fuchsia-600', ring: 'ring-fuchsia-500/20', text: 'text-fuchsia-600 dark:text-fuchsia-400' },
};

// Per-market fallback palette (cycled for multi-index markets)
const MARKET_PALETTE: Record<MarketType, Array<{ accent: string; ring: string; text: string }>> = {
  EGX: [
    { accent: 'bg-profit', ring: 'ring-profit/20', text: 'text-profit ' },
    { accent: 'bg-warning', ring: 'ring-warning/20', text: 'text-warning ' },
    { accent: 'bg-whale', ring: 'ring-whale/20', text: 'text-whale ' },
    { accent: 'bg-whale', ring: 'ring-cyan-500/20', text: 'text-whale dark:text-whale' },
  ],
  US: [
    { accent: 'bg-primary', ring: 'ring-primary/20', text: 'text-primary ' },
    { accent: 'bg-violet-500', ring: 'ring-violet-500/20', text: 'text-violet-600 dark:text-violet-400' },
    { accent: 'bg-indigo-500', ring: 'ring-indigo-500/20', text: 'text-indigo-600 dark:text-indigo-400' },
  ],
  CRYPTO: [
    { accent: 'bg-warning', ring: 'ring-orange-500/20', text: 'text-warning ' },
    { accent: 'bg-primary', ring: 'ring-purple-500/20', text: 'text-primary ' },
    { accent: 'bg-pink-500', ring: 'ring-pink-500/20', text: 'text-pink-600 dark:text-pink-400' },
  ],
  TADAWUL: [
    { accent: 'bg-success', ring: 'ring-success/20', text: 'text-success ' },
    { accent: 'bg-lime-600', ring: 'ring-lime-500/20', text: 'text-lime-600 dark:text-lime-400' },
  ],
  KSE: [
    { accent: 'bg-sky-600', ring: 'ring-sky-500/20', text: 'text-sky-600 dark:text-sky-400' },
  ],
  QSE: [
    { accent: 'bg-fuchsia-600', ring: 'ring-fuchsia-500/20', text: 'text-fuchsia-600 dark:text-fuchsia-400' },
  ],
};

function IndexCard({ index, colors }: { index: MarketIndex; colors: { accent: string; ring: string; text: string } }) {
  const isPositive = index.change >= 0;
  const { setCurrentView } = useAppStore();

  // ALPHA-SCREENER-UNIFY: كارت EGX30 قابل للنقر → ينقل لـ #stocks مفلتر
  const isClickable = index.symbol?.toUpperCase().includes('EGX');
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  const card = (
    <WidgetCard
      title={index.name_ar}
      icon={TrendIcon}
      iconColor={isPositive ? 'text-profit' : 'text-loss'}
      iconBg={isPositive ? 'bg-profit/10' : 'bg-loss/10'}
      iconSize="h-3.5 w-3.5"
      hideRefresh
      className="border-0 shadow-sm"
      headerClassName="pb-1 px-2.5 pt-2.5"
      titleClassName="text-xs font-medium text-muted-foreground truncate"
      contentClassName="px-2.5 pb-2.5 pt-0"
      badge={
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold tracking-wide',
            colors.ring,
            isPositive
              ? 'bg-profit/10 text-profit border border-profit/20'
              : 'bg-loss/10 text-loss border border-loss/20',
          )}
        >
          {index.symbol}
        </span>
      }
    >
      {/* Current value */}
      <p className="text-base font-bold tabular-nums text-foreground mb-1">
        {index.value.toLocaleString('ar-EG', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </p>

      {/* Change row */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-xs font-bold tabular-nums number-ticker',
            isPositive ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss',
            isPositive ? 'up' : 'down',
          )}
        >
          {isPositive ? '+' : ''}
          {safeNum(index.change_percent).toFixed(2)}%
        </span>
        <span
          className={cn(
            'text-xs font-bold tabular-nums',
            isPositive ? 'text-profit glow-profit' : 'text-loss glow-loss',
          )}
        >
          {isPositive ? '+' : ''}
          {safeNum(index.change).toFixed(2)}
        </span>
      </div>

      <div className="mt-2 -mx-1">
        <MiniSparkline ticker={index.symbol} height={28} width={120} showArea={true} />
      </div>
    </WidgetCard>
  );

  // EGX cards are clickable → navigate to stocks view. WidgetCard doesn't
  // expose onClick on its Card root, so we wrap in a <button> for those.
  if (isClickable) {
    return (
      <button
        type="button"
        onClick={() => setCurrentView('stocks' as any)}
        className="block w-full text-start cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl transition-all duration-200 hover:shadow-lg hover:ring-2 hover:ring-primary/20"
        aria-label={`عرض أسهم ${index.name_ar}`}
      >
        {card}
      </button>
    );
  }

  return card;
}

export function IndexCards() {
  const { marketOverview, currentMarket } = useAppStore();

  if (!marketOverview || !marketOverview.indices) return null;

  // Filter out null/undefined indices
  const validIndices = marketOverview.indices.filter(
    (index): index is MarketIndex => index != null && Boolean(index.symbol),
  );

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

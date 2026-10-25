/**
 * stocks-view/StockCard.tsx
 * ============================================================================
 * F-Phase3-Split-StocksView: StockCard (desktop card grid item).
 *
 * UI-STABILITY fix (2026-09-28): wrapped in React.memo so background price
 * refreshes don't re-render cards whose `stock` prop hasn't changed.
 * ============================================================================
 */

import { memo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn, safeNum } from '@/lib/utils';
import { ShareButton } from '@/components/share/ShareButton';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { FlashingPriceCell } from '@/components/shared/FlashingPriceCell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StockIconMini } from '../StockIcon';
import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher';
import { formatCleanTicker, formatVolume, formatMarketCap } from './helpers';
import type { StockCardProps } from './types';

export const StockCard = memo(function StockCard({
  stock,
  onClick,
}: StockCardProps) {
  const change = stock.price_change || 0;
  const isPositive = change > 0;
  const isNegative = change < 0;
  const isNeutral = change === 0;

  // Mini bar: position of current price between high and low of the day
  const high = safeNum(stock.high_price);
  const low = safeNum(stock.low_price);
  const priceRange = high - low;
  const pricePosition = priceRange > 0 ? ((safeNum(stock.current_price) - low) / priceRange) * 100 : 50;

  return (
    <Card
      className="cursor-pointer group hover:shadow-md transition-all duration-200 hover:border-profit dark:hover:border-profit/20 py-0 gap-0"
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Header: Icon + Ticker + Name + Indexes */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Stock Icon */}
            <StockIconMini
              ticker={stock.ticker}
              name={stock.name}
              sector={stock.sector}
              className="flex-shrink-0 mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-base text-profit ">
                  {formatCleanTicker(stock.ticker)}
                </span>
                <div className="flex gap-1">
                  {stock.egx30_member && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-profit/10 text-profit border border-profit/20 font-medium">
                      30
                    </span>
                  )}
                  {stock.egx70_member && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning dark:text-warning border border-warning/20/30 font-medium">
                      70
                    </span>
                  )}
                  {stock.egx100_member && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground dark:text-muted-foreground font-medium">
                      100
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground truncate mb-1" dir="rtl">
                {stock.name_ar}
              </p>
              <Badge variant="secondary" className="text-xs font-normal">
                {stock.sector}
              </Badge>
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
            <ShareButton
              iconOnly
              variant="ghost"
              size="icon"
              stockData={{
                ticker: stock.ticker,
                name: stock.name,
                nameAr: stock.name_ar,
                price: stock.current_price,
                change: stock.price_change ?? undefined,
                sector: stock.sector,
              }}
            />
            <StockPublisher
              data={{
                ticker: stock.ticker,
                nameAr: stock.name_ar,
                nameEn: stock.name,
                sector: stock.sector,
                currentPrice: Number(stock.current_price ?? 0),
                changePct: Number(stock.price_change ?? 0),
                peRatio: Number(stock.pe_ratio ?? 0) || undefined,
                pbRatio: Number(stock.pb_ratio ?? 0) || undefined,
                roe: Number(stock.roe ?? 0) || undefined,
                marketCap: Number(stock.market_cap ?? 0) || undefined,
                rsi: Number(stock.rsi ?? 0) || undefined,
                sma20: Number(stock.ma_50 ?? 0) || undefined,
                sma50: Number(stock.ma_50 ?? 0) || undefined,
                sma200: Number(stock.ma_200 ?? 0) || undefined,
                market: (stock.market as StockPublishData['market']) || 'EGX',
              }}
              variant="icon"
              size="sm"
            />
          </div>
        </div>

        {/* Price + Change — BLUEPRINT Phase 5: FlashingPriceCell */}
        <div className="flex items-end justify-between mb-3">
          <div>
            <FlashingPriceCell price={safeNum(stock.current_price) || null} className="text-2xl font-bold tabular-nums tracking-tight" />
            <p className="text-xs text-muted-foreground">{stock.market === 'CRYPTO' ? 'دولار' : 'جنيه مصري'}</p>
          </div>
          <div
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-bold tabular-nums',
              isPositive && 'bg-profit/10 text-profit ',
              isNegative && 'bg-loss/10 text-loss ',
              isNeutral && 'bg-muted text-muted-foreground'
            )}
          >
            {isPositive ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : isNegative ? (
              <TrendingDown className="w-3.5 h-3.5" />
            ) : (
              <Minus className="w-3.5 h-3.5" />
            )}
            {change >= 0 ? '+' : ''}
            {safeNum(change).toFixed(2)}%
          </div>
        </div>

        <div className="mb-3">
          <MiniSparkline ticker={stock.ticker} height={32} width={160} showArea />
        </div>

        {/* Mini Price Bar */}
        <div className="mb-3">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden relative">
            <div
              className={cn(
                'absolute top-0 h-full rounded-full transition-all',
                isPositive
                  ? 'from-profit to-profit'
                  : isNegative
                    ? 'from-loss to-loss'
                    : 'bg-muted-foreground/30'
              )}
              style={{ width: `${Math.min(100, Math.max(0, pricePosition))}%` }}
            />
          </div>
          <div className="flex justify-between mt-0.5 text-xs text-muted-foreground tabular-nums">
            <span>{safeNum(low).toFixed(1)}</span>
            <span>{safeNum(high).toFixed(1)}</span>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">الحجم</p>
            <p className="text-xs font-semibold tabular-nums">{formatVolume(stock.volume)}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">مكرر الربحية</p>
            <p className="text-xs font-semibold tabular-nums">
              {stock.pe_ratio > 0 ? (stock.pe_ratio ?? 0).toFixed(1) : '—'}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">القيمة السوقية</p>
            <p className="text-xs font-semibold tabular-nums">{formatMarketCap(stock.market_cap)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

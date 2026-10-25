/**
 * stocks-view/MobileStockRow.tsx
 * ============================================================================
 * F-Phase3-Split-StocksView: MobileStockRow (compact mobile list item).
 *
 * UI-STABILITY fix (2026-09-28): wrapped in React.memo so it doesn't re-render
 * when parent state that doesn't affect its props changes.
 * ============================================================================
 */

import { memo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn, safeNum } from '@/lib/utils';
import { ShareButton } from '@/components/share/ShareButton';
import { FlashingPriceCell } from '@/components/shared/FlashingPriceCell';
import { StockIconMini } from '../StockIcon';
import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher';
import { formatCleanTicker } from './helpers';
import type { MobileStockRowProps } from './types';

export const MobileStockRow = memo(function MobileStockRow({
  stock,
  onClick,
}: MobileStockRowProps) {
  const change = stock.price_change || 0;
  const isPositive = change > 0;
  const isNegative = change < 0;

  return (
    <div
      className="p-4 active:bg-muted/50 cursor-pointer border-b border-border/50 last:border-0"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Stock Icon */}
        <StockIconMini
          ticker={stock.ticker}
          name={stock.name}
          sector={stock.sector}
          className="flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-sm text-profit ">
              {formatCleanTicker(stock.ticker)}
            </span>
            <div className="flex gap-1">
              {stock.egx30_member && (
                <span className="text-xs px-1 py-0.5 rounded bg-profit/10 text-profit border border-profit/20 font-medium">
                  30
                </span>
              )}
              {stock.egx70_member && (
                <span className="text-xs px-1 py-0.5 rounded bg-warning/10 text-warning dark:text-warning border border-warning/20/30 font-medium">
                  70
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground truncate mb-0.5" dir="rtl">
            {stock.name_ar}
          </p>
          <span className="text-xs text-muted-foreground">{stock.sector}</span>
        </div>
        <div className="text-left flex-shrink-0">
          <FlashingPriceCell price={safeNum(stock.current_price) || null} className="font-bold text-sm" />
          <p
            className={cn(
              'text-xs font-medium tabular-nums flex items-center gap-0.5 justify-end',
              isPositive
                ? 'text-profit '
                : isNegative
                  ? 'text-loss '
                  : 'text-muted-foreground'
            )}
          >
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : isNegative ? (
              <TrendingDown className="w-3 h-3" />
            ) : (
              <Minus className="w-3 h-3" />
            )}
            {change >= 0 ? '+' : ''}
            {safeNum(change).toFixed(2)}%
          </p>
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
              market: (stock.market as StockPublishData['market']) || 'EGX',
            }}
            variant="icon"
            size="sm"
          />
        </div>
      </div>
    </div>
  );
});

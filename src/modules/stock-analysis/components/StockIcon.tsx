'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { getStockIconUrl, getSectorIcon, STOCK_ICON_SIZES, type StockIconProps } from '@/lib/stock-icon';

/**
 * StockIcon Component
 * 
 * Displays a stock icon from logoUrl (database TradingView URL) or /stock-icons/{ticker}.svg
 * Falls back to an elegant 2-letter avatar badge with sector indicator
 */
export function StockIcon({
 ticker,
 name,
 sector,
 logoUrl,
 size = 'md',
 className,
 ...rest
}: StockIconProps) {
 const [imageError, setImageError] = useState(false);
 // ALPHA-FIX Task 3: support both logoUrl (camelCase) and logo_url (snake_case from Python API)
 const resolvedLogoUrl = logoUrl || (rest as Record<string, unknown>).logo_url as string | null | undefined;
 const iconUrl = (!imageError && (resolvedLogoUrl || getStockIconUrl(ticker, resolvedLogoUrl))) || null;
 const sizeClass = STOCK_ICON_SIZES[size];
 const fallbackEmoji = getSectorIcon(sector);
 const cleanTicker = (ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
 
 if (!iconUrl) {
 return (
 <div 
 className={cn(
 'flex items-center justify-center rounded-lg bg-muted/60 font-bold text-foreground border border-border/40 flex-shrink-0 text-xs',
 sizeClass,
 className
 )}
 title={name ? `${cleanTicker} - ${name}` : cleanTicker}
 >
 <span>{cleanTicker.slice(0, 2) || fallbackEmoji}</span>
 </div>
 );
 }
 
 return (
 <div 
 className={cn(
 'relative flex items-center justify-center rounded-lg bg-white /20 border border-border/30 overflow-hidden flex-shrink-0',
 sizeClass,
 className
 )}
 title={name ? `${cleanTicker} - ${name}` : cleanTicker}
 >
 <img
 src={iconUrl}
 alt={name || ticker}
 className="w-full h-full object-contain p-0.5 rounded-lg"
 onError={() => setImageError(true)}
 />
 </div>
 );
}

/**
 * StockIconMini - A smaller version for table rows and list items
 */
export function StockIconMini({
 ticker,
 name,
 sector,
 logoUrl,
 className,
 ...rest
}: Omit<StockIconProps, 'size'>) {
 const [imageError, setImageError] = useState(false);
 // ALPHA-FIX Task 3: support both logoUrl and logo_url
 const resolvedLogoUrl = logoUrl || (rest as Record<string, unknown>).logo_url as string | null | undefined;
 const iconUrl = (!imageError && (resolvedLogoUrl || getStockIconUrl(ticker, resolvedLogoUrl))) || null;
 const fallbackEmoji = getSectorIcon(sector);
 const cleanTicker = (ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
 
 if (!iconUrl) {
 return (
 <div 
 className={cn(
 'w-6 h-6 rounded-full flex items-center justify-center bg-whale/10 text-whale text-xs font-bold border border-whale/20 flex-shrink-0',
 className
 )}
 title={name ? `${cleanTicker} - ${name}` : cleanTicker}
 >
 <span>{cleanTicker.slice(0, 2) || fallbackEmoji}</span>
 </div>
 );
 }
 
 return (
 <div 
 className={cn(
 'relative w-6 h-6 rounded-full flex items-center justify-center bg-white /30 overflow-hidden border border-border/40 flex-shrink-0 p-0.5',
 className
 )}
 title={name ? `${cleanTicker} - ${name}` : cleanTicker}
 >
 <img
 src={iconUrl}
 alt={name || ticker}
 className="w-full h-full object-contain rounded-full"
 onError={() => setImageError(true)}
 />
 </div>
 );
}

export default StockIcon;

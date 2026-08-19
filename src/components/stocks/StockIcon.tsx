'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { getStockIconUrl, getSectorIcon, STOCK_ICON_SIZES, type StockIconProps } from '@/lib/stock-icon';

/**
 * StockIcon Component
 * 
 * Displays a stock icon from /stock-icons/{ticker}.svg
 * Falls back to a sector-based emoji if icon doesn't exist
 */
export function StockIcon({ 
  ticker, 
  name, 
  sector, 
  size = 'md', 
  className 
}: StockIconProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  const iconUrl = getStockIconUrl(ticker);
  const sizeClass = STOCK_ICON_SIZES[size];
  const fallbackEmoji = getSectorIcon(sector);
  
  // If no icon URL or image failed to load, show fallback
  if (!iconUrl || imageError) {
    return (
      <div 
        className={cn(
          'flex items-center justify-center rounded-lg bg-muted/50 font-medium text-muted-foreground',
          sizeClass,
          className
        )}
        title={name || ticker}
      >
        <span className="text-lg">{fallbackEmoji}</span>
      </div>
    );
  }
  
  return (
    <div 
      className={cn(
        'relative flex items-center justify-center rounded-lg bg-muted/30 overflow-hidden',
        sizeClass,
        className
      )}
      title={name || ticker}
      style={{ position: "relative" as const }}
    >
      {!imageLoaded && (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
          {ticker.slice(0, 2)}
        </span>
      )}
      <Image
        src={iconUrl}
        alt={name || ticker}
        fill
        className={cn(
          'object-contain p-1 transition-opacity duration-200',
          imageLoaded ? 'opacity-100' : 'opacity-0'
        )}
        sizes={`${size === 'sm' ? 24 : size === 'md' ? 32 : 48}px`}
        onError={() => setImageError(true)}
        onLoad={() => setImageLoaded(true)}
        unoptimized // Skip Next.js image optimization for SVGs
      />
    </div>
  );
}

/**
 * StockIconMini - A smaller version for table rows
 */
export function StockIconMini({ 
  ticker, 
  name, 
  sector,
  className 
}: Omit<StockIconProps, 'size'>) {
  const [imageError, setImageError] = useState(false);
  const iconUrl = getStockIconUrl(ticker);
  const fallbackEmoji = getSectorIcon(sector);
  
  if (!iconUrl || imageError) {
    return (
      <div 
        className={cn(
          'w-8 h-8 flex items-center justify-center rounded-lg bg-muted/30',
          className
        )}
        title={name || ticker}
      >
        <span className="text-base">{fallbackEmoji}</span>
      </div>
    );
  }
  
  return (
    <div 
      className={cn(
        'relative w-8 h-8 flex items-center justify-center rounded-lg bg-muted/20 overflow-hidden',
        className
      )}
      title={name || ticker}
      style={{ position: "relative" as const }}
    >
      <Image
        src={iconUrl}
        alt={name || ticker}
        fill
        className="object-contain p-1"
        sizes="32px"
        onError={() => setImageError(true)}
        unoptimized
      />
    </div>
  );
}

export default StockIcon;

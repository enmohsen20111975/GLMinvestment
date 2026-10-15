'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { getStockIconUrl, getSectorIcon, STOCK_ICON_SIZES, type StockIconProps } from '@/lib/stock-icon';

/**
 * NewStockBadge — شارة "جديد" صغيرة فوق الأيقونة للأسهم الجديدة.
 * NEW-STOCK-DETECTION (2026-10-10): سيدي طلب تمييز الأسهم الجديدة.
 * بتظهر لو isNew=true (محسوب من created_at/listing_date في isNewStock() helper).
 */
function NewStockBadge({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const badgeSize = size === 'sm' ? 'w-3 h-3 text-[7px]' : size === 'lg' ? 'w-5 h-5 text-[9px]' : 'w-4 h-4 text-[8px]';
  return (
    <span
      className={cn(
        'absolute -top-1 -right-1 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white font-bold flex items-center justify-center shadow-lg ring-1 ring-white/60 z-10',
        badgeSize
      )}
      title="سهم جديد — لسة داخل البورصة"
    >
      ★
    </span>
  );
}

/**
 * StockIcon Component
 * 
 * Displays a stock icon from logoUrl (database TradingView URL) or /stock-icons/{ticker}.svg
 * Falls back to an elegant 2-letter avatar badge with sector indicator
 *
 * NEW-STOCK-DETECTION (2026-10-10): لو isNew=true → بعرض شارة "جديد" فوق الأيقونة.
 */
export function StockIcon({ 
  ticker, 
  name, 
  sector, 
  logoUrl,
  size = 'md', 
  className,
  isNew = false,
}: StockIconProps) {
  const [imageError, setImageError] = useState(false);
  const iconUrl = (!imageError && (logoUrl || getStockIconUrl(ticker))) || null;
  const sizeClass = STOCK_ICON_SIZES[size];
  const fallbackEmoji = getSectorIcon(sector);
  const cleanTicker = (ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
  
  if (!iconUrl) {
    return (
      <div 
        className={cn(
          'relative flex items-center justify-center rounded-lg bg-[#182030] font-bold text-stitch-on-surface border border-white/[0.06] flex-shrink-0 text-xs',
          sizeClass,
          className
        )}
        title={name ? `${cleanTicker} - ${name}${isNew ? ' (سهم جديد)' : ''}` : cleanTicker}
      >
        <span>{cleanTicker.slice(0, 2) || fallbackEmoji}</span>
        {isNew && <NewStockBadge size={size} />}
      </div>
    );
  }
  
  return (
    <div 
      className={cn(
        'relative flex items-center justify-center rounded-lg bg-[#182030] border border-white/[0.06] overflow-hidden flex-shrink-0',
        sizeClass,
        className
      )}
      title={name ? `${cleanTicker} - ${name}${isNew ? ' (سهم جديد)' : ''}` : cleanTicker}
    >
      <img
        src={iconUrl}
        alt={name || ticker}
        className="w-full h-full object-contain p-0.5 rounded-lg"
        onError={() => setImageError(true)}
      />
      {isNew && <NewStockBadge size={size} />}
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
  className 
}: Omit<StockIconProps, 'size'>) {
  const [imageError, setImageError] = useState(false);
  const iconUrl = (!imageError && (logoUrl || getStockIconUrl(ticker))) || null;
  const fallbackEmoji = getSectorIcon(sector);
  const cleanTicker = (ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
  
  if (!iconUrl) {
    return (
      <div 
        className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center bg-teal-500/10 text-teal-400 text-[10px] font-bold border border-teal-500/20 flex-shrink-0',
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
        'relative w-6 h-6 rounded-full flex items-center justify-center bg-[#182030] overflow-hidden border border-white/[0.06] flex-shrink-0 p-0.5',
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

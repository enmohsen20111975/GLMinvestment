'use client';

import React from 'react';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { useAppStore, MARKET_NAMES_AR, MarketType } from '@/lib/store';
import { Globe } from 'lucide-react';

// CRYPTO added for the unified crypto analysis view — mirrors ExchangeSelector.
// US added for the NYSE/NASDAQ market (SPY/QQQ ETF proxies for regime).
const MARKETS: MarketType[] = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO'];

interface MarketSelectorProps {
 /** حجم الزرار. default = 'default' */
 size?: 'default' | 'sm' | 'lg';
 /** عرض كامل. default = false */
 fullWidth?: boolean;
 /** إظهار الأيقونة. default = true */
 showIcon?: boolean;
}

/**
 * MarketSelector — اختيار السوق (مصر/السعودية/الكويت/قطر)
 *
 * لما المستخدم يغير السوق، كل المكونات اللي بتقرأ currentMarket من الـ store
 * هتتحديث تلقائياً (React re-render).
 */
export function MarketSelector({
 size = 'default',
 fullWidth = false,
 showIcon = true,
}: MarketSelectorProps) {
 const currentMarket = useAppStore((s) => s.currentMarket);
 const setCurrentMarket = useAppStore((s) => s.setCurrentMarket);

 const sizeClass =
 size === 'sm' ? 'h-8 text-xs' : size === 'lg' ? 'h-12 text-base' : 'h-10 text-sm';

 return (
 <Select
 value={currentMarket}
 onValueChange={(value) => setCurrentMarket(value as MarketType)}
 >
 <SelectTrigger
 className={`${sizeClass} ${fullWidth ? 'w-full' : 'w-[180px]'} font-semibold`}
 aria-label="اختيار السوق"
 >
 {showIcon && <Globe className="h-4 w-4 ml-2 text-muted-foreground" />}
 <SelectValue placeholder="اختر السوق" />
 </SelectTrigger>
 <SelectContent>
 {MARKETS.map((market) => (
 <SelectItem key={market} value={market} className="font-medium">
 {MARKET_NAMES_AR[market]}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 );
}

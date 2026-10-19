'use client';

import React from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import { useAppStore, MarketType, MARKET_NAMES_AR } from '@/lib/store';
import { Button } from '@/components/ui/button';
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Market icons/flags - Only markets with data (CRYPTO added for unified UI mirror, US added for NYSE/NASDAQ)
const MARKET_ICONS: Record<MarketType, string> = {
 EGX: '🇪🇬',
 TADAWUL: '🇸🇦',
 KSE: '🇰🇼',
 QSE: '🇶🇦',
 US: '🇺🇸',
 CRYPTO: '🪙',
};

interface ExchangeSelectorProps {
 compact?: boolean;
 className?: string;
}

export function ExchangeSelector({ compact = false, className }: ExchangeSelectorProps) {
 const { currentMarket, setCurrentMarket } = useAppStore();

 // Only show markets with actual data (CRYPTO + US added for unified UI mirror)
 const markets: MarketType[] = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO'];

 return (
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button
 variant="outline"
 size={compact ? 'sm' : 'default'}
 className={cn(
 'gap-2 justify-between min-w-[140px]',
 compact && 'h-8 text-xs px-2',
 className
 )}
 dir="rtl"
 >
 <span className="flex items-center gap-2">
 <span className="text-base">{MARKET_ICONS[currentMarket]}</span>
 {!compact && <Building2 className="w-4 h-4" />}
 <span className="truncate">{MARKET_NAMES_AR[currentMarket]}</span>
 </span>
 <ChevronDown className="w-4 h-4 mr-auto" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="start" className="min-w-[180px]" dir="rtl">
 {markets.map((market) => (
 <DropdownMenuItem
 key={market}
 onClick={() => setCurrentMarket(market)}
 className={cn(
 'cursor-pointer gap-2',
 currentMarket === market && 'bg-primary/10 text-primary'
 )}
 >
 <span className="text-base">{MARKET_ICONS[market]}</span>
 <span>{MARKET_NAMES_AR[market]}</span>
 {currentMarket === market && (
 <span className="mr-auto text-primary">✓</span>
 )}
 </DropdownMenuItem>
 ))}
 </DropdownMenuContent>
 </DropdownMenu>
 );
}

'use client';

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, Database } from 'lucide-react';
import { useRealtimeUpdates, safeToFixed } from '@/lib/ws-client';
import { useAppStore } from '@/lib/store';
import { useApiQuery } from '@/hooks/use-api-query';
import { cn } from '@/lib/utils';

interface TickerItem {
 ticker: string;
 name_ar: string;
 current_price: number;
 previous_price: number;
 price_change: number;
 volume: number;
}

interface StocksResponse {
 stocks?: Array<Record<string, unknown>>;
}

function TickerCard({ item }: { item: TickerItem }) {
 const price = Number(item.current_price) || 0;
 const change = Number(item.price_change) || 0;
 const prevPrice = Number(item.previous_price) || 0;
 const vol = Number(item.volume) || 0;

 const isPositive = change > 0;
 const isNegative = change < 0;
 const priceMoved = prevPrice !== 0 && prevPrice !== price;
 const movedUp = priceMoved && price > prevPrice;
 const movedDown = priceMoved && price < prevPrice;

 return (
 <motion.div
 className={cn(
 'flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full whitespace-nowrap border text-xs font-medium flex-shrink-0',
 'bg-card',
 isPositive ? 'border-profit/20' : isNegative ? 'border-loss/20' : 'border-border'
 )}
 animate={
 movedUp
 ? { scale: [1, 1.05, 1], borderColor: ['#22c55e'] }
 : movedDown
 ? { scale: [1, 1.05, 1], borderColor: ['#ef4444'] }
 : {}
 }
 transition={{ duration: 0.5 }}
 >
 <span className="font-bold text-foreground">{item.ticker}</span>
 <span className="text-foreground tabular-nums number-ticker">
 {safeToFixed(price)}
 </span>
 <span
 className={cn(
 'tabular-nums font-semibold number-ticker',
 isPositive ? 'text-profit glow-profit' : isNegative ? 'text-loss glow-loss' : 'text-muted-foreground',
 isPositive ? 'up' : isNegative ? 'down' : ''
 )}
 >
 {isPositive ? '+' : ''}
 {safeToFixed(change)}%
 </span>
 <span className="text-muted-foreground text-xs hidden sm:inline">
 {vol > 1000000
 ? `${safeToFixed(vol / 1000000, 1)}M`
 : vol > 1000
 ? `${safeToFixed(vol / 1000, 0)}K`
 : vol}
 </span>
 </motion.div>
 );
}

export function RealtimeTicker() {
 const { isConnected, stockPrices } = useRealtimeUpdates();
 const currentMarket = useAppStore((s) => s.currentMarket);
 const tickerRef = useRef<HTMLDivElement>(null);
 const scrollRef = useRef<number | null>(null);

 // F2.2: useApiQuery replaces manual fetch + useState.
 // Only fetch when WebSocket is NOT connected (fallback mode).
 const { data: stocksData, isLoading } = useApiQuery<StocksResponse>('/api/stocks', {
   params: { limit: 20, market: currentMarket },
   queryOptions: {
     // Only fetch as fallback when WebSocket is disconnected
     enabled: !isConnected || stockPrices.length === 0,
     refetchInterval: false, // no polling — WebSocket is primary when connected
     refetchOnWindowFocus: false,
   },
 });

 // Derive static stocks from cached query data (fallback only)
 const staticStocks: TickerItem[] = React.useMemo(() => {
   if (isConnected && stockPrices.length > 0) return [];
   if (!(stocksData as any)?.stocks?.length) return [];
   return (stocksData as any).stocks.map((s) => ({
     ticker: String(s.ticker || ''),
     name_ar: String(s.name || s.name_ar || ''),
     current_price: Number(s.current_price) || 0,
     previous_price: Number(s.previous_close) || 0,
     price_change: Number(s.change_percent) || Number(s.price_change) || 0,
     volume: Number(s.volume) || 0,
   }));
 }, [stocksData, isConnected, stockPrices]);

 // Use WebSocket data if connected, otherwise use static data
 const validStockPrices = isConnected && stockPrices.length > 0
 ? stockPrices.filter((item): item is TickerItem => item != null && Boolean(item.ticker))
 : staticStocks;

 // Auto-scroll the ticker
 useEffect(() => {
 if (!tickerRef.current || validStockPrices.length === 0) return;

 let pos = 0;
 const speed = 0.5;

 const animate = () => {
 if (!tickerRef.current) return;
 pos -= speed;
 const contentWidth = tickerRef.current.scrollWidth / 2;
 if (Math.abs(pos) >= contentWidth) {
 pos = 0;
 }
 tickerRef.current.style.transform = `translateX(${pos}px)`;
 scrollRef.current = requestAnimationFrame(animate);
 };

 scrollRef.current = requestAnimationFrame(animate);

 return () => {
 if (scrollRef.current) {
 cancelAnimationFrame(scrollRef.current);
 }
 };
 }, [validStockPrices]);

 // Don't show while loading or if no data
 if (isLoading || validStockPrices.length === 0) {
 return null;
 }

 // Duplicate items for seamless scrolling
 const duplicatedItems = [...validStockPrices, ...validStockPrices];

 return (
 <AnimatePresence>
 <motion.div
 initial={{ opacity: 0, y: -10 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -10 }}
 className="relative overflow-hidden bg-muted/50 border-b border-border"
 dir="ltr"
 >
 <div className="flex items-center h-10">
 {/* Connection indicator */}
 <div className="flex items-center gap-1.5 px-3 border-l border-border h-full bg-muted/80 flex-shrink-0" dir="rtl">
 {isConnected ? (
 <>
 <span className="relative flex h-2 w-2 live-pulse">
 <span className="relative inline-flex h-2 w-2 rounded-full bg-profit" />
 </span>
 <Wifi className="w-3 h-3 text-profit" />
 <span className="text-xs font-medium text-profit hidden xs:inline glow-profit">مباشر</span>
 </>
 ) : (
 <>
 <Database className="w-3 h-3 text-whale" />
 <span className="text-xs font-medium text-whale hidden xs:inline">بيانات</span>
 </>
 )}
 </div>

 {/* Scrolling ticker */}
 <div className="flex-1 overflow-hidden">
 <div
 ref={tickerRef}
 className="flex items-center gap-3 h-full py-1.5 px-2"
 >
 {duplicatedItems.map((item, idx) => (
 <TickerCard
 key={`${item.ticker}-${idx}`}
 item={item}
 />
 ))}
 </div>
 </div>
 </div>
 </motion.div>
 </AnimatePresence>
 );
}

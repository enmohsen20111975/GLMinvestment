'use client';

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi } from 'lucide-react';
import { useRealtimeUpdates, safeToFixed } from '@/lib/ws-client';
import { cn } from '@/lib/utils';

interface TickerItem {
  ticker: string;
  name_ar: string;
  current_price: number;
  previous_price: number;
  price_change: number;
  volume: number;
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
        'flex items-center gap-2 px-3 py-1.5 rounded-full whitespace-nowrap border text-xs font-medium flex-shrink-0',
        'bg-card',
        isPositive ? 'border-emerald-200 dark:border-emerald-800/50' : isNegative ? 'border-red-200 dark:border-red-800/50' : 'border-border'
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
      <span className="text-foreground tabular-nums">
        {safeToFixed(price)}
      </span>
      <span
        className={cn(
          'tabular-nums font-semibold',
          isPositive ? 'text-emerald-600 dark:text-emerald-400' : isNegative ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
        )}
      >
        {isPositive ? '+' : ''}
        {safeToFixed(change)}%
      </span>
      <span className="text-muted-foreground text-[10px]">
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
  const tickerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<number | null>(null);

  // Auto-scroll the ticker
  useEffect(() => {
    if (!tickerRef.current || !isConnected || stockPrices.length === 0) return;

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
  }, [isConnected, stockPrices]);

  if (!isConnected || stockPrices.length === 0) {
    return null;
  }

  // Duplicate items for seamless scrolling
  const duplicatedItems = [...stockPrices, ...stockPrices];

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
            <Wifi className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">مباشر</span>
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

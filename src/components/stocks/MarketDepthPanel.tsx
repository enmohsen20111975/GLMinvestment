'use client';

/**
 * MarketDepthPanel — عمق السوق (Order Book)
 * ===========================================
 * يعرض عمق السوق لأي سهم:
 * - Bids (طلبات الشراء) — أعلى 5
 * - Asks (طلبات البيع) — أعلى 5
 * - Spread (الفرق بين أفضل طلب شراء وأفضل طلب بيع)
 * - آخر سعر
 */

import React, { useState, useCallback } from 'react';
import { Activity, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface OrderBookEntry {
  price: number;
  volume: number;
}

interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  last_price: number;
}

export function MarketDepthPanel({ initialTicker = 'COMI' }: { initialTicker?: string }) {
  const [ticker, setTicker] = useState(initialTicker);
  const [loading, setLoading] = useState(false);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);

  const loadDepth = useCallback(async () => {
    if (!ticker.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/stocks/${ticker.toUpperCase()}/orderbook`);
      const data = await res.json();
      if (data.success || data.bids) {
        setOrderBook(data);
      } else {
        setOrderBook(null);
      }
    } catch {
      setOrderBook(null);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  React.useEffect(() => {
    loadDepth();
  }, [loadDepth]);

  const maxBidVol = orderBook?.bids?.length ? Math.max(...orderBook.bids.map(b => b.volume)) : 1;
  const maxAskVol = orderBook?.asks?.length ? Math.max(...orderBook.asks.map(a => a.volume)) : 1;

  return (
    <Card dir="rtl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-500" />
          عمق السوق (Order Book)
          <div className="flex gap-1 mr-auto">
            <Input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="السهم"
              className="w-20 h-7 text-xs"
              onKeyDown={(e) => e.key === 'Enter' && loadDepth()}
            />
            <Button size="sm" variant="outline" onClick={loadDepth} disabled={loading} className="h-7 px-2">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'تحديث'}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
          </div>
        ) : !orderBook || (!orderBook.bids?.length && !orderBook.asks?.length) ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            لا توجد بيانات عمق سوق متاحة حالياً
          </div>
        ) : (
          <div className="space-y-2">
            {/* Last Price + Spread */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">آخر سعر:</span>
                <span className="text-sm font-bold">{orderBook.last_price?.toFixed(2) || '—'}</span>
              </div>
              {orderBook.spread > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  Spread: {orderBook.spread.toFixed(2)}
                </Badge>
              )}
            </div>

            {/* Asks (sell orders) — reversed so highest is on top */}
            <div className="space-y-1">
              <div className="text-[10px] text-red-500 font-medium">طلبات البيع</div>
              {orderBook.asks?.slice(0, 5).reverse().map((ask, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div className="w-20 text-red-600">{ask.price.toFixed(2)}</div>
                  <div className="flex-1 h-4 bg-red-500/5 rounded relative overflow-hidden">
                    <div
                      className="absolute top-0 right-0 h-full bg-red-500/20"
                      style={{ width: `${(ask.volume / maxAskVol) * 100}%` }}
                    />
                    <span className="absolute top-0 left-1 leading-4 text-[10px] text-muted-foreground">
                      {ask.volume.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="border-t border-border my-1" />

            {/* Bids (buy orders) */}
            <div className="space-y-1">
              <div className="text-[10px] text-emerald-500 font-medium">طلبات الشراء</div>
              {orderBook.bids?.slice(0, 5).map((bid, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div className="w-20 text-emerald-600">{bid.price.toFixed(2)}</div>
                  <div className="flex-1 h-4 bg-emerald-500/5 rounded relative overflow-hidden">
                    <div
                      className="absolute top-0 right-0 h-full bg-emerald-500/20"
                      style={{ width: `${(bid.volume / maxBidVol) * 100}%` }}
                    />
                    <span className="absolute top-0 left-1 leading-4 text-[10px] text-muted-foreground">
                      {bid.volume.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <div className="flex items-center gap-1 text-[10px]">
                <TrendingUp className="w-3 h-3 text-emerald-500" />
                <span className="text-emerald-600">
                  شراء: {orderBook.bids?.length || 0}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <TrendingDown className="w-3 h-3 text-red-500" />
                <span className="text-red-600">
                  بيع: {orderBook.asks?.length || 0}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiQuery } from '@/hooks/use-api-query';
import {
 TrendingUp,
 TrendingDown,
 Bitcoin,
 RefreshCw,
 Target,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface CryptoData {
 id: string;
 symbol: string;
 name: string;
 current_price: number;
 price_change_percentage_24h: number;
 ath_change_percentage: number;
 recommendation?: {
 action: string;
 confidence: number;
 };
 technical_score?: number;
}

interface FearGreedData {
 value: number;
 value_classification: string;
}

function formatPrice(price: number): string {
 if (price >= 1000) return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
 return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fearGreedColor(value: number): string {
 if (value <= 20) return 'bg-loss';
 if (value <= 40) return 'bg-warning';
 if (value <= 60) return 'bg-warning';
 if (value <= 80) return 'bg-lime-500';
 return 'bg-profit';
}

function fearGreedLabel(value: number): string {
 if (value <= 20) return 'خوف شديد';
 if (value <= 40) return 'خوف';
 if (value <= 60) return 'محايد';
 if (value <= 80) return 'طمع';
 return 'طمع شديد';
}

export function CryptoSignalsWidget() {
 // F2.2 — TanStack Query migration: استبدال manual fetch + state بـ useApiQuery + useQuery.
 // Benefits: caching (60s stale), retry (2x), background refetch, no manual loading/error state.
 const { data: cryptoData, isLoading: cryptoLoading, isFetching: cryptoRefreshing, refetch: refetchCrypto } = useApiQuery<CryptoData[]>('/api/crypto', {
   queryOptions: {
     refetchInterval: 5 * 60 * 1000, // 5 min polling (was useVisibilityAwarePolling)
     refetchOnWindowFocus: false,
   },
 });

 const { data: fngData, isLoading: fngLoading } = useQuery({
   queryKey: ['fear-greed-index'],
   queryFn: async () => {
     const res = await fetch('https://api.alternative.me/fng/');
     if (!res.ok) throw new Error('Fear & Greed fetch failed');
     const json = await res.json();
     if (json?.data?.[0]) {
       return {
         value: parseInt(json.data[0].value),
         value_classification: json.data[0].value_classification,
       } as FearGreedData;
     }
     return null;
   },
   refetchInterval: 5 * 60 * 1000,
   refetchOnWindowFocus: false,
   retry: 1,
 });

 // Derive the filtered crypto list (BTC + ETH) from the cached query data.
 const cryptos = useMemo<CryptoData[]>(() => {
   if (!cryptoData) return [];
   const list = Array.isArray(cryptoData) ? cryptoData : [];
   const btc = list.find((c) => c?.symbol?.toLowerCase() === 'btc');
   const eth = list.find((c) => c?.symbol?.toLowerCase() === 'eth');
   return [btc, eth].filter(Boolean) as CryptoData[];
 }, [cryptoData]);

 const fearGreed = fngData ?? null;
 const loading = cryptoLoading || fngLoading;
 const refreshing = cryptoRefreshing;

 const handleRefresh = () => { void refetchCrypto(); };

 const getSignal = (crypto: CryptoData): 'BUY' | 'SELL' | 'HOLD' => {
 const athChange = crypto.ath_change_percentage || 0;
 if (athChange < -50) return 'BUY';
 if (athChange > 50) return 'SELL';
 return 'HOLD';
 };

 return (
 <Card className="border-border/60">
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between">
 <CardTitle className="text-sm font-semibold flex items-center gap-2">
 <div className="w-8 h-8 rounded-lg from-orange-500 to-yellow-500 flex items-center justify-center">
 <Bitcoin className="w-4 h-4 text-foreground" />
 </div>
 إشارات العملات الرقمية
 </CardTitle>
 <Button
 variant="ghost"
 size="icon"
 className="h-7 w-7"
 onClick={handleRefresh}
 disabled={refreshing}
 >
 <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
 </Button>
 </div>
 </CardHeader>

 <CardContent className="space-y-3">
 {loading ? (
 <div className="space-y-2">
 <Skeleton className="h-16 w-full" />
 <Skeleton className="h-16 w-full" />
 </div>
 ) : (
 <>
 {/* Fear & Greed Index */}
 {fearGreed && (
 <div className="p-2 rounded-lg bg-muted/50 border border-border/50">
 <div className="flex items-center justify-between mb-1.5">
 <span className="text-xs font-medium text-muted-foreground">مؤشر الخوف والطمع</span>
 <Badge className={cn('text-xs text-foreground', fearGreedColor(fearGreed.value))}>
 {fearGreed.value} - {fearGreedLabel(fearGreed.value)}
 </Badge>
 </div>
 <div className="h-1.5 rounded-full bg-muted overflow-hidden">
 <div 
 className={cn('h-full transition-all', fearGreedColor(fearGreed.value))}
 style={{ width: `${fearGreed.value}%` }}
 />
 </div>
 </div>
 )}

 {/* Crypto Cards */}
 <div className="grid grid-cols-2 gap-2">
 {cryptos.map((crypto) => {
 const signal = getSignal(crypto);
 return (
 <div
 key={crypto.id}
 className={cn(
 'p-2.5 rounded-lg border transition-all',
 signal === 'BUY' ? 'bg-profit/20 border-profit ' :
 signal === 'SELL' ? 'bg-loss/20 border-loss ' :
 'bg-warning/20 border-warning '
 )}
 >
 <div className="flex items-center justify-between mb-1">
 <span className="font-bold text-sm">{crypto.symbol?.toUpperCase()}</span>
 <Badge className={cn(
 'text-xs',
 signal === 'BUY' ? 'bg-profit text-white' :
 signal === 'SELL' ? 'bg-loss text-white' :
 'bg-warning text-white'
 )}>
 {signal === 'BUY' ? 'شراء' : signal === 'SELL' ? 'بيع' : 'انتظار'}
 </Badge>
 </div>
 <div className="text-base font-bold" dir="ltr">{formatPrice(crypto.current_price)}</div>
 <div className="flex items-center gap-1 text-xs mt-1">
 {crypto.price_change_percentage_24h >= 0 ? (
 <TrendingUp className="w-3 h-3 text-profit" />
 ) : (
 <TrendingDown className="w-3 h-3 text-loss" />
 )}
 <span className={crypto.price_change_percentage_24h >= 0 ? 'text-profit' : 'text-loss'}>
 {crypto.price_change_percentage_24h >= 0 ? '+' : ''}{crypto.price_change_percentage_24h?.toFixed(2)}%
 </span>
 </div>
 </div>
 );
 })}
 </div>

 {/* Indicator Performance */}
 <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
 <div className="flex items-center gap-1.5 mb-1.5">
 <Target className="w-3 h-3 text-primary" />
 <span className="text-xs font-medium">أداء المؤشرات المُختبرة</span>
 </div>
 <div className="grid grid-cols-3 gap-1 text-xs text-center">
 <div><span className="block font-bold text-profit">63.6%</span><span className="text-muted-foreground">VWAP</span></div>
 <div><span className="block font-bold text-profit">55.2%</span><span className="text-muted-foreground">Stoch</span></div>
 <div><span className="block font-bold text-warning">53%</span><span className="text-muted-foreground">EMA</span></div>
 </div>
 </div>

 <p className="text-xs text-muted-foreground text-center">
 ⚠️ تحليل وليس نصيحة مالية
 </p>
 </>
 )}
 </CardContent>
 </Card>
 );
}

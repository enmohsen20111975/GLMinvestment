'use client';

import React, { useState, useEffect } from 'react';
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
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';

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
 const [cryptos, setCryptos] = useState<CryptoData[]>([]);
 const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null);
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);

 const fetchData = async (showRefresh = false) => {
 if (showRefresh) setRefreshing(true);
 else setLoading(true);

 try {
 // Fetch crypto data
 const cryptoRes = await fetch('/api/crypto');
 if (cryptoRes.ok) {
 const data = await cryptoRes.json();
 if (data.success && data.data) {
 const cryptoList = Array.isArray(data.data)
 ? data.data
 : Array.isArray(data.data?.coins)
 ? data.data.coins
 : [];

 const btc = cryptoList.find((c: CryptoData) => c?.symbol?.toLowerCase() === 'btc');
 const eth = cryptoList.find((c: CryptoData) => c?.symbol?.toLowerCase() === 'eth');
 setCryptos([btc, eth].filter(Boolean) as CryptoData[]);
 }
 }

 // Fetch Fear & Greed
 const fngRes = await fetch('https://api.alternative.me/fng/');
 if (fngRes.ok) {
 const fngData = await fngRes.json();
 if (fngData.data && fngData.data[0]) {
 setFearGreed({
 value: parseInt(fngData.data[0].value),
 value_classification: fngData.data[0].value_classification,
 });
 }
 }
 } catch (e) {
 console.error('Error fetching crypto data:', e);
 } finally {
 setLoading(false);
 setRefreshing(false);
 }
 };

 useEffect(() => {
 fetchData();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // P37-PHASE-2B-4A: visibility-aware polling - pauses when the tab is hidden,
 // fires immediately when it becomes visible again.
 // Crypto is 24/7: allowOffMarket: true
 useVisibilityAwarePolling(() => { fetchData(); }, 5 * 60 * 1000, [], { market: 'CRYPTO', allowOffMarket: true });

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
 onClick={() => fetchData(true)}
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

'use client';

import React, { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Minus, Coins, ArrowUpRight, ArrowDownRight, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { MiniSparkline } from '@/components/ui/mini-sparkline';

// Market configuration
const MARKETS = [
 { code: 'EGX', name: 'مصر', flag: '🇪🇬', currency: 'EGP', currencyName: 'جنيه مصري' },
 { code: 'TADAWUL', name: 'السعودية', flag: '🇸🇦', currency: 'SAR', currencyName: 'ريال سعودي' },
 { code: 'KSE', name: 'الكويت', flag: '🇰🇼', currency: 'KWD', currencyName: 'دينار كويتي' },
 { code: 'QSE', name: 'قطر', flag: '🇶🇦', currency: 'QAR', currencyName: 'ريال قطري' },
] as const;

type MarketCode = typeof MARKETS[number]['code'];

interface Stock {
 id?: number;
 ticker?: string;
 symbol?: string;
 name: string;
 market?: string;
 current_price?: number;
 price?: number;
 change_percent: number;
 volume?: string;
 flag?: string;
 currency?: string;
}

interface GoldPriceItem {
 karat: string;
 price_per_gram: number | null;
 price_per_ounce: number | null;
}

interface GoldCountryData {
 currency: string;
 flag: string;
 name: string;
 prices: GoldPriceItem[];
}

interface Crypto {
 id?: number;
 rank: number;
 symbol: string;
 name: string;
 price_usd: number;
 price_change_24h: number;
 market_cap?: number;
}

interface ForexRate {
 currency: string;
 rate_to_usd: number | null;
 name: string;
 flag: string;
 country: string;
}

const MAJOR_CURRENCIES_INFO: Record<string, { name: string; flag: string }> = {
 USD: { name: 'دولار أمريكي', flag: '🇺🇸' },
 EUR: { name: 'يورو', flag: '🇪🇺' },
 GBP: { name: 'جنيه إسترليني', flag: '🇬🇧' },
 SAR: { name: 'ريال سعودي', flag: '🇸🇦' },
 AED: { name: 'درهم إماراتي', flag: '🇦🇪' },
 KWD: { name: 'دينار كويتي', flag: '🇰🇼' },
 QAR: { name: 'ريال قطري', flag: '🇶🇦' },
 EGP: { name: 'جنيه مصري', flag: '🇪🇬' },
 JOD: { name: 'دينار أردني', flag: '🇯🇴' },
 BHD: { name: 'دينار بحريني', flag: '🇧🇭' },
 OMR: { name: 'ريال عماني', flag: '🇴🇲' },
 CAD: { name: 'دولار كندي', flag: '🇨🇦' },
 AUD: { name: 'دولار أسترالي', flag: '🇦🇺' },
 CNY: { name: 'يوان صيني', flag: '🇨🇳' },
};

export function MultiMarketWidget() {
 const { loadStockDetail } = useAppStore();
 const [activeTab, setActiveTab] = useState('stocks');
 const [selectedMarket, setSelectedMarket] = useState<MarketCode>('EGX');

 const marketInfo = useMemo(() => {
 return MARKETS.find(m => m.code === selectedMarket) || MARKETS[0];
 }, [selectedMarket]);

 // F2.2: 4 useApiQuery hooks replace manual fetch + useState + useEffect.
 // Each query is cached + retried independently. queryKey auto-includes params.

 // 1) Stocks (depends on selectedMarket)
 const { data: stocksRaw, isLoading: loadingStocks } = useApiQuery<{ stocks?: Stock[] }>('/api/data-engine/stocks', {
   params: { market: selectedMarket, limit: 20 },
   queryOptions: { refetchOnWindowFocus: false },
 });
 const stocks = useMemo(() => stocksRaw?.stocks || [], [stocksRaw]);

 // 2) Gold
 const { data: goldRaw, isLoading: loadingGold } = useApiQuery<{ gold?: Record<string, GoldCountryData> }>('/api/data-engine/gold', {
   queryOptions: { refetchOnWindowFocus: false },
 });
 const goldData = useMemo(() => goldRaw?.gold ?? null, [goldRaw]);

 // 3) Crypto
 const { data: cryptoRaw, isLoading: loadingCrypto } = useApiQuery<Crypto[] | { data?: Crypto[]; cryptos?: Crypto[] }>('/api/data-engine/crypto', {
   params: { limit: 10 },
   queryOptions: { refetchOnWindowFocus: false },
 });
 const cryptoData = useMemo<Crypto[]>(() => {
   if (!cryptoRaw) return [];
   if (Array.isArray(cryptoRaw)) return cryptoRaw;
   return cryptoRaw.data || cryptoRaw.cryptos || [];
 }, [cryptoRaw]);

 // 4) Forex
 const { data: forexRaw, isLoading: loadingForex } = useApiQuery<{ data?: { rates?: Record<string, ForexRate> } }>('/api/data-engine/forex', {
   queryOptions: { refetchOnWindowFocus: false },
 });
 const forexRates = useMemo(() => forexRaw?.data?.rates ?? {}, [forexRaw]);

 const loadingGeneral = loadingGold || loadingCrypto || loadingForex;

 const handleStockClick = (ticker: string) => {
 if (ticker && ticker !== 'N/A') {
 loadStockDetail(ticker);
 }
 };

 const renderMarketSelector = () => (
 <div className="flex gap-1.5 p-1 bg-muted/60 rounded-xl mb-3 overflow-x-auto border">
 {MARKETS.map((market) => {
 const isSelected = selectedMarket === market.code;
 return (
 <Button
 key={market.code}
 variant={isSelected ? 'default' : 'ghost'}
 size="sm"
 className={cn(
 'text-xs h-8 px-3 rounded-lg font-medium transition-all',
 isSelected
 ? 'bg-primary text-primary-foreground shadow-sm'
 : 'hover:bg-muted text-muted-foreground hover:text-foreground'
 )}
 onClick={() => setSelectedMarket(market.code)}
 >
 <span className="ml-1.5 text-sm">{market.flag}</span>
 {market.name}
 </Button>
 );
 })}
 </div>
 );

 // 1. Stocks Tab Content
 const renderStocks = () => {
 if (loadingStocks) {
 return (
 <div className="space-y-2">
 {[1, 2, 3, 4, 5].map((i) => (
 <Skeleton key={i} className="h-14 w-full rounded-lg" />
 ))}
 </div>
 );
 }

 const uniqueStocks = stocks.filter((stock, index, self) => {
 const ticker = stock.ticker || stock.symbol;
 return index === self.findIndex(s => (s.ticker || s.symbol) === ticker);
 });

 if (uniqueStocks.length === 0) {
 return (
 <div className="text-center py-8 text-muted-foreground text-sm">
 لا توجد بيانات أسهم متاحة لسوق {marketInfo.name} حالياً
 </div>
 );
 }

 return (
 <div className="space-y-2">
 {uniqueStocks.slice(0, 10).map((stock, index) => {
 const ticker = stock.ticker || stock.symbol || 'N/A';
 const price = stock.current_price || stock.price || 0;
 const change = stock.change_percent ?? 0;
 const isPositive = change > 0;
 const isNegative = change < 0;

 return (
 <div
 key={`${ticker}-${index}`}
 onClick={() => handleStockClick(ticker)}
 className="flex items-center justify-between p-2.5 rounded-lg bg-card/60 hover:bg-muted/70 border border-border/40 transition-all cursor-pointer group"
 >
 <div className="flex items-center gap-2.5 min-w-0">
 <span className="text-base flex-shrink-0">{marketInfo.flag}</span>
 <div className="min-w-0">
 <p className="font-semibold text-sm group-hover:text-primary transition-colors truncate">
 {ticker}
 </p>
 <p className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[160px]">
 {stock.name}
 </p>
 </div>
 </div>

 <div className="flex items-center gap-3">
 {selectedMarket === 'EGX' && (
 <div className="hidden sm:block">
 <MiniSparkline ticker={ticker} height={18} width={64} showArea={false} />
 </div>
 )}
 <div className="text-left flex flex-col items-end">
 <p className="font-semibold text-sm tabular-nums">
 {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
 <span className="text-xs text-muted-foreground mr-1">{marketInfo.currency}</span>
 </p>
 <div className="flex items-center gap-1">
 {isPositive ? (
 <TrendingUp className="w-3 h-3 text-profit" />
 ) : isNegative ? (
 <TrendingDown className="w-3 h-3 text-loss" />
 ) : (
 <Minus className="w-3 h-3 text-muted-foreground" />
 )}
 <span
 className={cn(
 'text-xs font-semibold tabular-nums',
 isPositive
 ? 'text-profit '
 : isNegative
 ? 'text-loss '
 : 'text-muted-foreground'
 )}
 >
 {change >= 0 ? '+' : ''}{(change ?? 0).toFixed(2)}%
 </span>
 </div>
 </div>
 </div>
 </div>
 );
 })}
 </div>
 );
 };

 // 2. Gold Tab Content (Filtered strictly for selected market's country)
 const renderGold = () => {
 if (loadingGeneral || !goldData) {
 return (
 <div className="space-y-2">
 {[1, 2, 3, 4, 5].map((i) => (
 <Skeleton key={i} className="h-12 w-full rounded-lg" />
 ))}
 </div>
 );
 }

 const countryGold = goldData[marketInfo.name];
 if (!countryGold || !countryGold.prices || countryGold.prices.length === 0) {
 return (
 <div className="text-center py-8 text-muted-foreground text-sm">
 لا توجد بيانات أسعار ذهب متاحة لـ {marketInfo.name} حالياً
 </div>
 );
 }

 // Sort karat numbers descending (e.g. 24, 22, 21, 18, 16, 14, 10)
 const sortedPrices = [...countryGold.prices].sort((a, b) => {
 const numA = parseInt(a.karat.replace(/\D/g, '')) || 0;
 const numB = parseInt(b.karat.replace(/\D/g, '')) || 0;
 return numB - numA;
 });

 // Find 21K and 24K for gold pound and ounce calculations
 const price21k = sortedPrices.find(p => p.karat.includes('21'))?.price_per_gram;
 const price24k = sortedPrices.find(p => p.karat.includes('24'))?.price_per_gram;
 const goldPoundEstimate = price21k ? Math.round(price21k * 8) : null;
 const goldOunceEstimate = price24k ? Math.round(price24k * 31.1035) : null;

 return (
 <div className="space-y-3">
 {/* Header summary badge */}
 <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning font-medium">
 <span className="flex items-center gap-1.5">
 <Coins className="w-3.5 h-3.5 text-warning" />
 أسعار الذهب الرسمية في {marketInfo.name}
 </span>
 <span>بالـ {marketInfo.currencyName} ({marketInfo.currency})</span>
 </div>

 {/* Karats List */}
 <div className="space-y-1.5">
 {sortedPrices.map((item) => {
 const gramPrice = item.price_per_gram;
 if (!gramPrice || gramPrice <= 0) return null;

 const isKarat21 = item.karat.includes('21');
 const isKarat24 = item.karat.includes('24');

 return (
 <div
 key={item.karat}
 className={cn(
 'flex items-center justify-between p-2 rounded-lg border transition-colors',
 isKarat21
 ? 'bg-warning/10 border-warning/20'
 : isKarat24
 ? 'bg-warning/5 border-warning/20'
 : 'bg-card/60 border-border/40 hover:bg-muted/50'
 )}
 >
 <div className="flex items-center gap-2">
 <span className={cn(
 'text-sm font-semibold',
 isKarat21 ? 'text-warning ' : 'text-foreground'
 )}>
 {item.karat}
 </span>
 {isKarat21 && (
 <Badge variant="outline" className="text-xs h-4 px-1 text-warning border-warning/20 bg-warning/10">
 الأكثر تداولاً
 </Badge>
 )}
 </div>
 <div className="text-left">
 <span className="text-sm font-bold tabular-nums">
 {Math.round(gramPrice).toLocaleString()}
 </span>
 <span className="text-xs text-muted-foreground mr-1">
 {marketInfo.currency} / جرام
 </span>
 </div>
 </div>
 );
 })}
 </div>

 {/* Gold Pound & Ounce Cards */}
 <div className="grid grid-cols-2 gap-2 pt-1">
 {goldPoundEstimate && (
 <div className="p-2 rounded-lg bg-muted/50 border border-border/50 text-center">
 <p className="text-xs text-muted-foreground mb-0.5">جنيه ذهب (8ج عيار 21)</p>
 <p className="text-xs font-bold text-warning tabular-nums">
 {goldPoundEstimate.toLocaleString()} {marketInfo.currency}
 </p>
 </div>
 )}
 {goldOunceEstimate && (
 <div className="p-2 rounded-lg bg-muted/50 border border-border/50 text-center">
 <p className="text-xs text-muted-foreground mb-0.5">أوقية ذهب (31.1ج)</p>
 <p className="text-xs font-bold tabular-nums">
 {goldOunceEstimate.toLocaleString()} {marketInfo.currency}
 </p>
 </div>
 )}
 </div>
 </div>
 );
 };

 // 3. Crypto Tab Content
 const renderCrypto = () => {
 if (loadingGeneral) {
 return (
 <div className="space-y-2">
 {[1, 2, 3, 4, 5].map((i) => (
 <Skeleton key={i} className="h-12 w-full rounded-lg" />
 ))}
 </div>
 );
 }

 if (cryptoData.length === 0) {
 return (
 <div className="text-center py-8 text-muted-foreground text-sm">
 لا توجد بيانات عملات رقمية متاحة حالياً
 </div>
 );
 }

 return (
 <div className="space-y-2">
 {cryptoData.slice(0, 10).map((crypto) => {
 const change = crypto.price_change_24h ?? 0;
 const isPositive = change > 0;
 const isNegative = change < 0;

 return (
 <div
 key={crypto.symbol}
 className="flex items-center justify-between p-2.5 rounded-lg bg-card/60 hover:bg-muted/70 border border-border/40 transition-colors"
 >
 <div className="flex items-center gap-2.5">
 <Badge variant="outline" className="text-xs h-5 w-6 flex items-center justify-center p-0 font-mono text-muted-foreground">
 {crypto.rank || '#'}
 </Badge>
 <div>
 <p className="font-semibold text-sm">{crypto.symbol}</p>
 <p className="text-xs text-muted-foreground truncate max-w-[120px]">{crypto.name}</p>
 </div>
 </div>
 <div className="text-left flex flex-col items-end">
 <p className="font-semibold text-sm tabular-nums">
 ${crypto.price_usd >= 1
 ? crypto.price_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
 : crypto.price_usd.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })}
 </p>
 <div className="flex items-center gap-1">
 {isPositive ? (
 <ArrowUpRight className="w-3 h-3 text-profit" />
 ) : isNegative ? (
 <ArrowDownRight className="w-3 h-3 text-loss" />
 ) : (
 <Minus className="w-3 h-3 text-muted-foreground" />
 )}
 <span
 className={cn(
 'text-xs font-semibold tabular-nums',
 isPositive
 ? 'text-profit '
 : isNegative
 ? 'text-loss '
 : 'text-muted-foreground'
 )}
 >
 {change >= 0 ? '+' : ''}{(change ?? 0).toFixed(2)}%
 </span>
 </div>
 </div>
 </div>
 );
 })}
 </div>
 );
 };

 // 4. Forex / Currencies Tab Content (Relative to the selected market's currency)
 const renderForex = () => {
 if (loadingGeneral) {
 return (
 <div className="space-y-2">
 {[1, 2, 3, 4, 5].map((i) => (
 <Skeleton key={i} className="h-12 w-full rounded-lg" />
 ))}
 </div>
 );
 }

 // In data_engine, forex rates are stored as EGP values for 1 unit of foreign currency:
 // USD: 50.00 EGP, EUR: 59.03 EGP, GBP: 68.62 EGP, KWD: 164.71 EGP, SAR: 13.33 EGP, AED: 13.85 EGP, QAR: 13.74 EGP
 const marketCurr = marketInfo.currency;
 const baseEgpRate = marketCurr === 'EGP' ? 1 : (forexRates[marketCurr]?.rate_to_usd || 1);

 // List of currencies to compare against
 const targetCurrencies = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'EGP', 'JOD', 'BHD']
 .filter(c => c !== marketCurr);

 return (
 <div className="space-y-2.5">
 {/* Header summary */}
 <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-profit/10 border border-profit/20 text-xs text-profit font-medium">
 <span className="flex items-center gap-1.5">
 <Globe className="w-3.5 h-3.5 text-profit" />
 أسعار الصرف مقابل {marketInfo.currencyName}
 </span>
 <span>1 وحدة = بالـ {marketCurr}</span>
 </div>

 <div className="space-y-1.5">
 {targetCurrencies.map((code) => {
 const rawRateInEgp = forexRates[code]?.rate_to_usd;
 if (!rawRateInEgp || rawRateInEgp <= 0) return null;

 // Calculate rate in the selected market's currency:
 // 1 unit of code = (rateInEgp / baseEgpRate) in marketCurr
 const rateInMarketCurrency = rawRateInEgp / baseEgpRate;
 const meta = MAJOR_CURRENCIES_INFO[code] || { name: code, flag: '💱' };

 return (
 <div
 key={code}
 className="flex items-center justify-between p-2 rounded-lg bg-card/60 hover:bg-muted/70 border border-border/40 transition-colors"
 >
 <div className="flex items-center gap-2.5">
 <span className="text-lg flex-shrink-0">{meta.flag}</span>
 <div>
 <p className="font-semibold text-sm">{code}</p>
 <p className="text-xs text-muted-foreground">{meta.name}</p>
 </div>
 </div>

 <div className="text-left">
 <p className="font-bold text-sm tabular-nums">
 {rateInMarketCurrency >= 10
 ? (rateInMarketCurrency ?? 0).toFixed(2)
 : rateInMarketCurrency >= 1
 ? (rateInMarketCurrency ?? 0).toFixed(3)
 : (rateInMarketCurrency ?? 0).toFixed(4)}
 <span className="text-xs text-muted-foreground mr-1 font-normal">
 {marketCurr}
 </span>
 </p>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 );
 };

 return (
 <Card className="border-border/60 shadow-sm overflow-hidden">
 <CardHeader className="pb-2 pt-3.5 px-4">
 <div className="flex items-center justify-between">
 <CardTitle className="text-sm font-bold flex items-center gap-2">
 <Globe className="w-4 h-4 text-primary" />
 الأسواق المتعددة
 </CardTitle>
 <Badge variant="outline" className="text-xs font-normal px-2 py-0.5 border-primary/20 text-primary bg-primary/5">
 {marketInfo.flag} {marketInfo.name} ({marketInfo.currency})
 </Badge>
 </div>
 </CardHeader>
 <CardContent className="p-0">
 {/* Market Country Selector */}
 <div className="px-3.5 pt-1">
 {renderMarketSelector()}
 </div>

 {/* Categories Tabs */}
 <Tabs value={activeTab} onValueChange={setActiveTab}>
 <TabsList className="w-full grid grid-cols-4 h-10 rounded-none border-y bg-muted/40 p-0">
 <TabsTrigger
 value="stocks"
 className="text-xs py-2 rounded-none data-[state=active]:bg-background data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary transition-all font-medium"
 >
 📈 الأسهم
 </TabsTrigger>
 <TabsTrigger
 value="gold"
 className="text-xs py-2 rounded-none data-[state=active]:bg-background data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-warning transition-all font-medium"
 >
 🥇 الذهب
 </TabsTrigger>
 <TabsTrigger
 value="crypto"
 className="text-xs py-2 rounded-none data-[state=active]:bg-background data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-purple-500 transition-all font-medium"
 >
 ₿ كريبتو
 </TabsTrigger>
 <TabsTrigger
 value="forex"
 className="text-xs py-2 rounded-none data-[state=active]:bg-background data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-profit transition-all font-medium"
 >
 💱 عملات
 </TabsTrigger>
 </TabsList>

 <div className="p-3.5 max-h-[380px] overflow-y-auto">
 <TabsContent value="stocks" className="mt-0 focus-visible:outline-none">
 {renderStocks()}
 </TabsContent>
 <TabsContent value="gold" className="mt-0 focus-visible:outline-none">
 {renderGold()}
 </TabsContent>
 <TabsContent value="crypto" className="mt-0 focus-visible:outline-none">
 {renderCrypto()}
 </TabsContent>
 <TabsContent value="forex" className="mt-0 focus-visible:outline-none">
 {renderForex()}
 </TabsContent>
 </div>
 </Tabs>
 </CardContent>
 </Card>
 );
}

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Minus, Coins, ArrowUpRight, ArrowDownRight, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

// Market configuration
const MARKETS = [
  { code: 'EGX', name: 'مصر', flag: '🇪🇬', currency: 'EGP' },
  { code: 'TADAWUL', name: 'السعودية', flag: '🇸🇦', currency: 'SAR' },
  { code: 'KSE', name: 'الكويت', flag: '🇰🇼', currency: 'KWD' },
  { code: 'QSE', name: 'قطر', flag: '🇶🇦', currency: 'QAR' },
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

interface GoldCountry {
  currency: string;
  flag: string;
  name?: string;
  gold_per_gram_local?: number;
  prices_by_karat?: Record<string, number>;
  prices?: Array<{ karat: string; price_per_gram: number; price_per_ounce: number }>;
}

interface Crypto {
  rank: number;
  symbol: string;
  name: string;
  price_usd: number;
  price_change_24h: number;
  market_cap: number;
}

export function MultiMarketWidget() {
  const { loadStockDetail } = useAppStore();
  const [activeTab, setActiveTab] = useState('stocks');
  const [selectedMarket, setSelectedMarket] = useState<MarketCode>('EGX');
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [goldData, setGoldData] = useState<Record<string, GoldCountry> | null>(null);
  const [cryptoData, setCryptoData] = useState<Crypto[]>([]);
  const [forexData, setForexData] = useState<Record<string, { rate_to_usd: number; name: string; flag: string }>>({});
  const [loading, setLoading] = useState(true);

  // Handle stock click
  const handleStockClick = (ticker: string) => {
    if (ticker && ticker !== 'N/A') {
      loadStockDetail(ticker);
    }
  };

  // Reload data when market changes
  useEffect(() => {
    loadData();
  }, [selectedMarket]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load stocks for selected market
      const stocksRes = await fetch(`/api/data-engine/stocks?market=${selectedMarket}&limit=20`);
      if (stocksRes.ok) {
        const stocksJson = await stocksRes.json();
        setStocks(stocksJson.stocks || []);
      }

      // Load gold (country-specific based on market)
      const goldRes = await fetch('/api/data-engine/gold');
      if (goldRes.ok) {
        const goldJson = await goldRes.json();
        setGoldData(goldJson.gold);
      }

      // Load crypto (global, not market-specific)
      const cryptoRes = await fetch('/api/data-engine/crypto?limit=10');
      if (cryptoRes.ok) {
        const cryptoJson = await cryptoRes.json();
        setCryptoData(cryptoJson.cryptos || []);
      }

      // Load forex (global)
      const forexRes = await fetch('/api/data-engine/forex');
      if (forexRes.ok) {
        const forexJson = await forexRes.json();
        setForexData(forexJson.data?.rates || {});
      }
    } catch (e) {
      console.error('Error loading data:', e);
    } finally {
      setLoading(false);
    }
  };

  const getMarketInfo = (code: MarketCode) => {
    return MARKETS.find(m => m.code === code) || MARKETS[0];
  };

  const renderMarketSelector = () => (
    <div className="flex gap-1 p-1 bg-muted/50 rounded-lg mb-3 overflow-x-auto">
      {MARKETS.map((market) => (
        <Button
          key={market.code}
          variant={selectedMarket === market.code ? 'default' : 'ghost'}
          size="sm"
          className={cn(
            'text-xs h-8 px-2',
            selectedMarket === market.code && 'bg-primary text-primary-foreground'
          )}
          onClick={() => setSelectedMarket(market.code)}
        >
          <span className="mr-1">{market.flag}</span>
          {market.name}
        </Button>
      ))}
    </div>
  );

  const renderStocks = () => {
    const marketInfo = getMarketInfo(selectedMarket);
    
    // Deduplicate stocks by ticker+market
    const uniqueStocks = stocks.filter((stock, index, self) => {
      const ticker = stock.ticker || stock.symbol;
      const market = stock.market;
      return index === self.findIndex(s => 
        (s.ticker || s.symbol) === ticker && s.market === market
      );
    });
    
    return (
      <div className="space-y-2">
        {uniqueStocks.slice(0, 10).map((stock, index) => {
          const ticker = stock.ticker || stock.symbol || 'N/A';
          const price = stock.current_price || stock.price || 0;
          
          return (
            <button
              key={`${ticker}-${stock.market}-${index}`}
              className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer w-full text-right border-0 bg-transparent"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleStockClick(ticker);
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{marketInfo.flag}</span>
                <div>
                  <p className="font-semibold text-sm">{ticker}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-[5rem] sm:max-w-24">{stock.name}</p>
                </div>
              </div>
              <div className="text-left">
                <p className="font-semibold text-sm tabular-nums">
                  {price.toLocaleString()} {marketInfo.currency}
                </p>
                <div className="flex items-center gap-1">
                  {stock.change_percent > 0 ? (
                    <TrendingUp className="w-3 h-3 text-emerald-500" />
                  ) : stock.change_percent < 0 ? (
                    <TrendingDown className="w-3 h-3 text-red-500" />
                  ) : (
                    <Minus className="w-3 h-3 text-slate-500" />
                  )}
                  <span
                    className={cn(
                      'text-xs font-medium tabular-nums',
                      stock.change_percent > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : stock.change_percent < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-600 dark:text-slate-400'
                    )}
                  >
                    {stock.change_percent >= 0 ? '+' : ''}
                     {(stock.change_percent ?? 0).toFixed(2)}%
                  </span>
                </div>
              </div>
            </button>
          );
        })}
        {stocks.length === 0 && !loading && (
          <p className="text-center text-muted-foreground text-sm py-4">
            لا توجد أسهم لهذا السوق
          </p>
        )}
      </div>
    );
  };

  const renderGold = () => {
    if (!goldData || Object.keys(goldData).length === 0) return null;
    
    // Filter gold to show only selected market's country
    const marketInfo = getMarketInfo(selectedMarket);
    const arabicCountryName = marketInfo.name;
    
    // Find the gold data for this country
    const countryGold = goldData[arabicCountryName];
    const countries = countryGold 
      ? [[arabicCountryName, countryGold] as [string, GoldCountry]] 
      : Object.entries(goldData).slice(0, 4);

    return (
      <div className="space-y-2">
        {countries.map(([country, data]) => {
          // Get 24k price from either format
          const price24k = data.prices?.find(p => p.karat === 'عيار 24')?.price_per_gram 
            || data.gold_per_gram_local 
            || 0;
          
          return (
            <div
              key={country}
              className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{data.flag}</span>
                <div>
                  <p className="font-semibold text-sm">{country}</p>
                  <p className="text-xs text-muted-foreground">عيار 24</p>
                </div>
              </div>
              <div className="text-left">
                <p className="font-semibold text-sm tabular-nums">
                  {price24k.toLocaleString()} {data.currency}
                </p>
                <p className="text-xs text-muted-foreground">للجرام</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCrypto = () => (
    <div className="space-y-2">
      {cryptoData.slice(0, 8).map((crypto) => (
        <div
          key={crypto.symbol}
          className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              #{crypto.rank}
            </Badge>
            <div>
              <p className="font-semibold text-sm">{crypto.symbol}</p>
              <p className="text-xs text-muted-foreground truncate max-w-[5rem] sm:max-w-24">{crypto.name}</p>
            </div>
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm tabular-nums">
              ${crypto.price_usd.toLocaleString()}
            </p>
            <div className="flex items-center gap-1">
              {crypto.price_change_24h > 0 ? (
                <ArrowUpRight className="w-3 h-3 text-emerald-500" />
              ) : (
                <ArrowDownRight className="w-3 h-3 text-red-500" />
              )}
              <span
                className={cn(
                  'text-xs font-medium tabular-nums',
                  crypto.price_change_24h > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                )}
              >
                {crypto.price_change_24h >= 0 ? '+' : ''}
                {crypto.price_change_24h?.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderForex = () => {
    // Show forex for selected market's currency
    const marketInfo = getMarketInfo(selectedMarket);
    const relevantForex = forexData[marketInfo.currency];
    
    return (
      <div className="space-y-2">
        {relevantForex && (
          <div
            className="flex items-center justify-between p-2 rounded-lg bg-primary/10 border border-primary/20"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{relevantForex.flag}</span>
              <div>
                <p className="font-semibold text-sm">{marketInfo.currency}</p>
                <p className="text-xs text-muted-foreground">{relevantForex.name}</p>
              </div>
            </div>
            <div className="text-left">
              <p className="font-semibold text-sm tabular-nums">
                {relevantForex.rate_to_usd.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">للدولار</p>
            </div>
          </div>
        )}
        {Object.entries(forexData)
          .filter(([currency]) => currency !== marketInfo.currency)
          .slice(0, 6)
          .map(([currency, data]) => (
            <div
              key={currency}
              className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{data.flag}</span>
                <div>
                  <p className="font-semibold text-sm">{currency}</p>
                  <p className="text-xs text-muted-foreground">{data.name}</p>
                </div>
              </div>
              <div className="text-left">
                <p className="font-semibold text-sm tabular-nums">
                  {data.rate_to_usd.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">للدولار</p>
              </div>
            </div>
          ))}
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="w-4 h-4" />
          الأسواق المتعددة
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Market Selector */}
        <div className="px-3 pt-2">
          {renderMarketSelector()}
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-2 sm:grid-cols-4 h-9 rounded-none border-b">
            <TabsTrigger value="stocks" className="text-xs py-1.5">
              📈 الأسهم
            </TabsTrigger>
            <TabsTrigger value="gold" className="text-xs py-1.5">
              🥇 الذهب
            </TabsTrigger>
            <TabsTrigger value="crypto" className="text-xs py-1.5">
              ₿ كريبتو
            </TabsTrigger>
            <TabsTrigger value="forex" className="text-xs py-1.5">
              💱 عملات
            </TabsTrigger>
          </TabsList>
          <div className="p-3 max-h-80 overflow-y-auto">
            <TabsContent value="stocks" className="mt-0">
              {renderStocks()}
            </TabsContent>
            <TabsContent value="gold" className="mt-0">
              {renderGold()}
            </TabsContent>
            <TabsContent value="crypto" className="mt-0">
              {renderCrypto()}
            </TabsContent>
            <TabsContent value="forex" className="mt-0">
              {renderForex()}
            </TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}

'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { toast } from 'sonner';

// Types
interface Stock {
  ticker: string;
  market: string;
  name?: string;
  current_price?: number;
  previous_close?: number;
  change_percent: number;
  volume_numeric?: number;
  flag?: string;
  currency?: string;
}

interface MarketStatus {
  market: string;
  name: string;
  name_ar: string;
  flag: string;
  currency: string;
  is_open: boolean;
  status: string;
  local_time: string;
  local_date: string;
}

// Markets
const MARKETS = [
  { id: 'EGX', name: 'مصر', flag: '🇪🇬', currency: 'EGP' },
  { id: 'TADAWUL', name: 'السعودية', flag: '🇸🇦', currency: 'SAR' },
  { id: 'KSE', name: 'الكويت', flag: '🇰🇼', currency: 'KWD' },
  { id: 'QSE', name: 'قطر', flag: '🇶🇦', currency: 'QAR' },
];

export function MultiMarketTab() {
  const [selectedMarket, setSelectedMarket] = useState('EGX');
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [marketStatuses, setMarketStatuses] = useState<MarketStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    setRefreshing(true);
    try {
      // Fetch market status from Next.js API
      const statusRes = await fetch('/api/data-engine/status');
      const statusJson = await statusRes.json();
      if (statusJson.success) {
        setMarketStatuses(statusJson.markets);
      }

      // Fetch stocks for selected market from Next.js API
      const stocksRes = await fetch(`/api/data-engine/stocks?market=${selectedMarket}&limit=30`);
      const stocksJson = await stocksRes.json();
      if (stocksJson.success) {
        setStocks(stocksJson.stocks);
      }
    } catch (error) {
      toast.error('خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedMarket]);

  const currentStatus = marketStatuses.find(s => s.market === selectedMarket);

  const formatChange = (change: number) => {
    if (change > 0) return <span className="text-green-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" />+{change.toFixed(2)}%</span>;
    if (change < 0) return <span className="text-red-500 flex items-center gap-1"><TrendingDown className="w-3 h-3" />{change.toFixed(2)}%</span>;
    return <span className="text-gray-500 flex items-center gap-1"><Minus className="w-3 h-3" />0%</span>;
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            🌍 الأسواق العربية
          </h2>
          <p className="text-muted-foreground">
            متابعة الأسهم في 4 أسواق عربية
          </p>
        </div>
        <Button onClick={fetchData} disabled={refreshing} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {/* Market Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {MARKETS.map(market => {
          const status = marketStatuses.find(s => s.market === market.id);
          return (
            <Card
              key={market.id}
              className={`cursor-pointer transition-all ${selectedMarket === market.id ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setSelectedMarket(market.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{market.flag}</span>
                  <Badge variant={status?.is_open ? 'default' : 'secondary'} className={status?.is_open ? 'bg-green-500' : ''}>
                    {status?.is_open ? '🟢 مفتوح' : '🔴 مغلق'}
                  </Badge>
                </div>
                <div className="font-medium">{market.name}</div>
                <div className="text-xs text-muted-foreground">
                  {status?.local_time || '—'}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Current Market Info */}
      {currentStatus && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{currentStatus.flag}</span>
                <div>
                  <div className="font-bold text-lg">{currentStatus.name_ar}</div>
                  <div className="text-sm text-muted-foreground">{currentStatus.name}</div>
                </div>
              </div>
              <div className="text-left">
                <Badge variant={currentStatus.is_open ? 'default' : 'secondary'} className={currentStatus.is_open ? 'bg-green-500 text-lg py-1 px-3' : 'text-lg py-1 px-3'}>
                  {currentStatus.status}
                </Badge>
                <div className="text-sm text-muted-foreground mt-1">
                  العملة: {currentStatus.currency}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stocks Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            أسهم {MARKETS.find(m => m.id === selectedMarket)?.name}
          </CardTitle>
          <CardDescription>
            {stocks.length} سهم
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : stocks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد بيانات متاحة
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-right p-2">الرمز</th>
                    <th className="text-right p-2">السعر</th>
                    <th className="text-right p-2">التغير</th>
                    <th className="text-right p-2">الحجم</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks.map((stock, index) => (
                    <tr key={index} className="border-b hover:bg-muted/50">
                      <td className="p-2">
                        <span className="flex items-center gap-2">
                          <span className="text-lg">{stock.flag}</span>
                          <span className="font-medium">{stock.ticker}</span>
                        </span>
                      </td>
                      <td className="p-2 font-medium">
                        {stock.current_price?.toLocaleString('ar-EG', { maximumFractionDigits: 2 }) || '—'}
                        <span className="text-xs text-muted-foreground mr-1">{stock.currency}</span>
                      </td>
                      <td className="p-2">
                        {formatChange(stock.change_percent)}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {stock.volume_numeric?.toLocaleString('ar-EG') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Market Hours Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">أوقات التداول</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {MARKETS.map(market => (
              <div key={market.id} className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{market.flag}</span>
                  <span className="font-medium">{market.name}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {market.id === 'EGX' && '10:00 ص - 2:30 م'}
                  {market.id === 'TADAWUL' && '10:00 ص - 3:00 م'}
                  {market.id === 'KSE' && '9:00 ص - 1:15 م'}
                  {market.id === 'QSE' && '9:30 ص - 1:15 م'}
                </div>
                <div className="text-xs text-muted-foreground">
                  الأحد - الخميس
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

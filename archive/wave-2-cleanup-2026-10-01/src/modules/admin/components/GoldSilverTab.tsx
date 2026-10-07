'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';

// Types
interface GoldData {
  country: string;
  currency: string;
  symbol: string;
  flag: string;
  gold_per_gram_local: number;
  prices_by_karat: Record<string, number>;
  exchange_rate_to_usd: number;
}

interface MetalsData {
  timestamp: string;
  gold_usd_per_ounce: number;
  gold_usd_per_gram: number;
  countries: Record<string, GoldData>;
}

interface SilverData {
  timestamp: string;
  silver_usd_per_ounce: number;
  silver_usd_per_gram: number;
  countries: Record<string, {
    country: string;
    currency: string;
    symbol: string;
    flag: string;
    silver_per_gram_local: number;
    exchange_rate_to_usd: number;
  }>;
}

// Countries
const COUNTRIES = [
  { id: 'مصر', name: 'مصر', flag: '🇪🇬', currency: 'EGP' },
  { id: 'السعودية', name: 'السعودية', flag: '🇸🇦', currency: 'SAR' },
  { id: 'الكويت', name: 'الكويت', flag: '🇰🇼', currency: 'KWD' },
  { id: 'قطر', name: 'قطر', flag: '🇶🇦', currency: 'QAR' },
];

const KARATS = ['عيار 24', 'عيار 22', 'عيار 21', 'عيار 18', 'عيار 14'];

export function GoldSilverTab() {
  const [selectedCountry, setSelectedCountry] = useState('مصر');
  const [goldData, setGoldData] = useState<MetalsData | null>(null);
  const [silverData, setSilverData] = useState<SilverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    setRefreshing(true);
    try {
      // Fetch gold prices from Next.js API
      const goldRes = await fetch('/api/data-engine/gold');
      const goldJson = await goldRes.json();
      if (goldJson.success) {
        setGoldData(goldJson.gold);
      }

      // Fetch silver prices from Next.js API
      const silverRes = await fetch('/api/data-engine/silver');
      const silverJson = await silverRes.json();
      if (silverJson.success) {
        setSilverData(silverJson.silver);
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
  }, []);

  const currentCountryGold = goldData?.countries?.[selectedCountry];
  const currentCountrySilver = silverData?.countries?.[selectedCountry];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            🥇 أسعار الذهب والفضة
          </h2>
          <p className="text-muted-foreground">
            آخر تحديث: {goldData?.timestamp ? new Date(goldData.timestamp).toLocaleString('ar-EG') : '—'}
          </p>
        </div>
        <Button onClick={fetchData} disabled={refreshing} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {/* Country Selector */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {COUNTRIES.map(country => (
          <Button
            key={country.id}
            variant={selectedCountry === country.id ? 'default' : 'outline'}
            onClick={() => setSelectedCountry(country.id)}
            className="gap-2"
          >
            <span className="text-lg">{country.flag}</span>
            {country.name}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card><CardContent className="p-4"><Skeleton className="h-48 w-full" /></CardContent></Card>
          <Card><CardContent className="p-4"><Skeleton className="h-48 w-full" /></CardContent></Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Gold Card */}
          <Card className="border-yellow-200 dark:border-yellow-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-yellow-600">
                🥇 الذهب
              </CardTitle>
              <CardDescription>
                {currentCountryGold?.flag} {selectedCountry} ({currentCountryGold?.currency})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Global Price */}
              <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg">
                <div className="text-sm text-muted-foreground">السعر العالمي</div>
                <div className="text-2xl font-bold text-yellow-600">
                  ${goldData?.gold_usd_per_gram?.toFixed(2) || '—'} / جرام
                </div>
                <div className="text-sm text-muted-foreground">
                  ${goldData?.gold_usd_per_ounce?.toFixed(2) || '—'} / أوقية
                </div>
              </div>

              {/* Karat Prices */}
              <div className="space-y-2">
                <div className="text-sm font-medium mb-2">أسعار العيارات</div>
                <div className="grid grid-cols-2 gap-2">
                  {KARATS.map(karat => (
                    <div key={karat} className="p-3 bg-muted/50 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">{karat}</div>
                      <div className="text-lg font-bold">
                        {currentCountryGold?.prices_by_karat?.[karat]?.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) || '—'}
                      </div>
                      <div className="text-xs text-muted-foreground">{currentCountryGold?.symbol}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Exchange Rate */}
              <div className="mt-4 text-xs text-muted-foreground">
                سعر الصرف: 1 USD = {currentCountryGold?.exchange_rate_to_usd?.toFixed(2)} {currentCountryGold?.currency}
              </div>
            </CardContent>
          </Card>

          {/* Silver Card */}
          <Card className="border-gray-300 dark:border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-gray-500">
                🥈 الفضة
              </CardTitle>
              <CardDescription>
                {currentCountrySilver?.flag} {selectedCountry} ({currentCountrySilver?.currency})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Global Price */}
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-950/20 rounded-lg">
                <div className="text-sm text-muted-foreground">السعر العالمي</div>
                <div className="text-2xl font-bold text-gray-600">
                  ${silverData?.silver_usd_per_gram?.toFixed(2) || '—'} / جرام
                </div>
                <div className="text-sm text-muted-foreground">
                  ${silverData?.silver_usd_per_ounce?.toFixed(2) || '—'} / أوقية
                </div>
              </div>

              {/* Local Price */}
              <div className="p-4 bg-muted/50 rounded-lg text-center">
                <div className="text-sm text-muted-foreground mb-1">السعر المحلي</div>
                <div className="text-3xl font-bold">
                  {currentCountrySilver?.silver_per_gram_local?.toLocaleString('ar-EG', { maximumFractionDigits: 2 }) || '—'}
                </div>
                <div className="text-sm text-muted-foreground">{currentCountrySilver?.symbol} / جرام</div>
              </div>

              {/* Exchange Rate */}
              <div className="mt-4 text-xs text-muted-foreground">
                سعر الصرف: 1 USD = {currentCountrySilver?.exchange_rate_to_usd?.toFixed(2)} {currentCountrySilver?.currency}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* All Countries Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">أسعار الذهب في كل الدول</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-right p-2">الدولة</th>
                  <th className="text-right p-2">العملة</th>
                  <th className="text-right p-2">عيار 24</th>
                  <th className="text-right p-2">عيار 21</th>
                  <th className="text-right p-2">عيار 18</th>
                </tr>
              </thead>
              <tbody>
                {COUNTRIES.map(country => {
                  const data = goldData?.countries?.[country.id];
                  return (
                    <tr key={country.id} className="border-b hover:bg-muted/50 cursor-pointer" onClick={() => setSelectedCountry(country.id)}>
                      <td className="p-2">
                        <span className="flex items-center gap-2">
                          <span className="text-lg">{data?.flag || country.flag}</span>
                          {country.name}
                        </span>
                      </td>
                      <td className="p-2">{data?.currency || country.currency}</td>
                      <td className="p-2 font-medium">{data?.prices_by_karat?.['عيار 24']?.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) || '—'}</td>
                      <td className="p-2">{data?.prices_by_karat?.['عيار 21']?.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) || '—'}</td>
                      <td className="p-2">{data?.prices_by_karat?.['عيار 18']?.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

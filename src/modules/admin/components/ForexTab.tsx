'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, ArrowRightLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';

// Types
interface ExchangeRate {
  currency: string;
  rate_to_usd: number;
  name: string;
  name_en: string;
  country: string;
  flag: string;
  timestamp: string;
}

interface ForexData {
  timestamp: string;
  base: string;
  rates: Record<string, ExchangeRate>;
}

// Currencies
const CURRENCIES = [
  { code: 'EGP', name: 'جنيه مصري', flag: '🇪🇬', country: 'مصر' },
  { code: 'SAR', name: 'ريال سعودي', flag: '🇸🇦', country: 'السعودية' },
  { code: 'KWD', name: 'دينار كويتي', flag: '🇰🇼', country: 'الكويت' },
  { code: 'QAR', name: 'ريال قطري', flag: '🇶🇦', country: 'قطر' },
  { code: 'AED', name: 'درهم إماراتي', flag: '🇦🇪', country: 'الإمارات' },
  { code: 'BHD', name: 'دينار بحريني', flag: '🇧🇭', country: 'البحرين' },
  { code: 'OMR', name: 'ريال عماني', flag: '🇴🇲', country: 'عمان' },
  { code: 'JOD', name: 'دينار أردني', flag: '🇯🇴', country: 'الأردن' },
];

export function ForexTab() {
  const [rates, setRates] = useState<Record<string, ExchangeRate>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Converter state
  const [convertAmount, setConvertAmount] = useState('100');
  const [convertFrom, setConvertFrom] = useState('USD');
  const [convertTo, setConvertTo] = useState('EGP');
  const [convertResult, setConvertResult] = useState<number | null>(null);

  const fetchData = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/data-engine/forex');
      const json = await res.json();
      if (json.success) {
        setRates(json.data?.rates || {});
      }
    } catch (error) {
      toast.error('خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleConvert = async () => {
    try {
      // Calculate locally using rates
      const fromRate = convertFrom === 'USD' ? 1 : (rates[convertFrom]?.rate_to_usd || 1);
      const toRate = rates[convertTo]?.rate_to_usd || 1;
      const result = (parseFloat(convertAmount) / fromRate) * toRate;
      setConvertResult(result);
    } catch (error) {
      toast.error('خطأ في التحويل');
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const swapCurrencies = () => {
    const temp = convertFrom;
    setConvertFrom(convertTo);
    setConvertTo(temp);
    setConvertResult(null);
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            💱 أسعار الصرف
          </h2>
          <p className="text-muted-foreground">
            أسعار العملات العربية مقابل الدولار
          </p>
        </div>
        <Button onClick={fetchData} disabled={refreshing} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {/* Currency Converter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4" />
            محول العملات
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            {/* Amount */}
            <div className="flex-1 min-w-[120px]">
              <label className="text-sm text-muted-foreground mb-1 block">المبلغ</label>
              <Input
                type="number"
                value={convertAmount}
                onChange={(e) => setConvertAmount(e.target.value)}
                className="text-lg"
              />
            </div>

            {/* From Currency */}
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm text-muted-foreground mb-1 block">من</label>
              <select
                value={convertFrom}
                onChange={(e) => setConvertFrom(e.target.value)}
                className="w-full p-2 border rounded-md"
              >
                <option value="USD">🇺🇸 USD - دولار أمريكي</option>
                {CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.code} - {c.name}</option>
                ))}
              </select>
            </div>

            {/* Swap Button */}
            <Button variant="outline" size="icon" onClick={swapCurrencies} className="mt-6">
              <ArrowRightLeft className="w-4 h-4" />
            </Button>

            {/* To Currency */}
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm text-muted-foreground mb-1 block">إلى</label>
              <select
                value={convertTo}
                onChange={(e) => setConvertTo(e.target.value)}
                className="w-full p-2 border rounded-md"
              >
                {CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.code} - {c.name}</option>
                ))}
              </select>
            </div>

            {/* Convert Button */}
            <Button onClick={handleConvert} className="mt-6">
              تحويل
            </Button>
          </div>

          {/* Result */}
          {convertResult !== null && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg text-center">
              <div className="text-sm text-muted-foreground">النتيجة</div>
              <div className="text-3xl font-bold text-primary">
                {convertResult.toLocaleString('ar-EG', { maximumFractionDigits: 2 })}
              </div>
              <div className="text-sm text-muted-foreground">
                {convertAmount} {convertFrom} = {convertResult.toFixed(2)} {convertTo}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exchange Rates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          [...Array(8)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          CURRENCIES.map(currency => {
            const rate = rates[currency.code];
            return (
              <Card key={currency.code} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">{currency.flag}</span>
                    <Badge variant="outline">{currency.code}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mb-1">{currency.name}</div>
                  <div className="text-2xl font-bold">
                    {rate?.rate_to_usd?.toFixed(4) || '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    1 USD = {rate?.rate_to_usd?.toFixed(4) || '—'} {currency.code}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">جدول أسعار الصرف</CardTitle>
          <CardDescription>
            آخر تحديث: {rates?.EGP?.timestamp ? new Date(rates.EGP.timestamp).toLocaleString('ar-EG') : '—'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-right p-2">العملة</th>
                  <th className="text-right p-2">الرمز</th>
                  <th className="text-right p-2">سعر الدولار</th>
                  <th className="text-right p-2">الدولة</th>
                </tr>
              </thead>
              <tbody>
                {CURRENCIES.map(currency => {
                  const rate = rates[currency.code];
                  return (
                    <tr key={currency.code} className="border-b hover:bg-muted/50">
                      <td className="p-2">
                        <span className="flex items-center gap-2">
                          <span className="text-lg">{currency.flag}</span>
                          <span className="font-medium">{currency.name}</span>
                        </span>
                      </td>
                      <td className="p-2">
                        <Badge variant="outline">{currency.code}</Badge>
                      </td>
                      <td className="p-2 font-mono">
                        {rate?.rate_to_usd?.toFixed(6) || '—'}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {currency.country}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Quick Convert Cards */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">تحويلات سريعة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { from: 'USD', to: 'EGP', amount: 100 },
              { from: 'USD', to: 'SAR', amount: 100 },
              { from: 'USD', to: 'KWD', amount: 100 },
              { from: 'SAR', to: 'EGP', amount: 100 },
            ].map((conv, i) => {
              const fromRate = conv.from === 'USD' ? 1 : (rates[conv.from]?.rate_to_usd || 1);
              const toRate = rates[conv.to]?.rate_to_usd || 1;
              const result = (conv.amount / fromRate) * toRate;
              
              return (
                <div key={i} className="p-3 bg-muted/50 rounded-lg text-center">
                  <div className="text-sm text-muted-foreground mb-1">
                    {conv.amount} {conv.from}
                  </div>
                  <div className="text-lg font-bold text-primary">
                    = {result.toFixed(2)} {conv.to}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

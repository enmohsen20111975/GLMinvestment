'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { SingleStockAnalysisView } from '@/components/analysis/SingleStockAnalysisView';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LegalDisclaimerFooter } from '@/components/legal/DisclaimerBanner';
import {
  Plus,
  Trash2,
  RefreshCw,
  X,
  Search,
  Bitcoin,
  Columns,
  LayoutGrid,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface CryptoCoin {
  symbol: string;
  name: string;
  price_usd: number | null;
  price_change_24h: number | null;
  rank: number | null;
}

interface CryptoTradingChartViewProps {
  initialTicker?: string;
}

export function CryptoTradingChartView({
  initialTicker = 'BTC',
}: CryptoTradingChartViewProps) {
  const { setCurrentMarket } = useAppStore();
  const [coins, setCoins] = useState<CryptoCoin[]>([]);
  const [coinsLoading, setCoinsLoading] = useState(true);
  const [columns, setColumns] = useState<1 | 2>(1);
  const [selectedCoinToAdd, setSelectedCoinToAdd] = useState('');
  const [search, setSearch] = useState('');

  const defaultTicker = (initialTicker || 'BTC').toUpperCase();
  const [selectedTickers, setSelectedTickers] = useState<string[]>([
    defaultTicker,
  ]);

  // ─── على mount: فعّل وضع الكريبتو ───────────────────────────────────────────
  useEffect(() => {
    setCurrentMarket('CRYPTO');
  }, [setCurrentMarket]);

  // ─── تحميل قائمة العملات من crypto_prices ──────────────────────────────────
  const loadCoins = useCallback(async () => {
    setCoinsLoading(true);
    try {
      const res = await fetch('/api/data-engine/crypto?limit=200', {
        cache: 'no-store',
      });
      const json = await res.json();
      if (json.success) {
        setCoins(json.data || []);
      }
    } catch (e) {
      console.error('Failed to load crypto coins:', e);
    } finally {
      setCoinsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoins();
  }, [loadCoins]);

  // ─── فلترة العملات للبحث ───────────────────────────────────────────────────
  const filteredCoins = React.useMemo(() => {
    if (!search.trim()) return coins.slice(0, 100);
    const q = search.trim().toLowerCase();
    return coins
      .filter(
        (c) =>
          c.symbol.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q)
      )
      .slice(0, 100);
  }, [coins, search]);

  // ─── إضافة عملة للوحة ───────────────────────────────────────────────────────
  const handleAddCoin = (tickerToAdd?: string) => {
    const target = (tickerToAdd || selectedCoinToAdd).trim().toUpperCase();
    if (!target) {
      toast.info('اختر عملة أولاً لإضافتها للوحة');
      return;
    }
    if (selectedTickers.includes(target)) {
      toast.info(`العملة ${target} مضافة بالفعل في اللوحة`);
      return;
    }
    if (selectedTickers.length >= 6) {
      toast.warning('يمكنك إضافة حتى 6 عملات كحد أقصى للوحة التحليل');
      return;
    }
    setSelectedTickers((prev) => [...prev, target]);
    setSelectedCoinToAdd('');
    toast.success(`تمت إضافة الشارت والتحليل الشامل لـ ${target}`);
  };

  // ─── إزالة عملة ─────────────────────────────────────────────────────────────
  const handleRemoveCoin = (ticker: string) => {
    if (selectedTickers.length <= 1) {
      toast.info('يجب الإبقاء على عملة واحدة على الأقل في اللوحة');
      return;
    }
    setSelectedTickers((prev) => prev.filter((t) => t !== ticker));
  };

  // ─── إعادة تعيين ────────────────────────────────────────────────────────────
  const handleReset = () => {
    setSelectedTickers([defaultTicker]);
    toast.success('تمت إعادة التعيين للعملة الرئيسية');
  };

  return (
    <div className="space-y-3 p-3 md:p-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Bitcoin className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              شارت العملات الرقمية
            </h1>
            <p className="text-sm text-muted-foreground">
              بيانات OHLC حقيقية من CoinGecko •{' '}
              <code className="text-xs bg-muted px-1 rounded">
                /api/crypto/full-analysis
              </code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={columns === 1 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setColumns(1)}
          >
            <LayoutGrid className="h-4 w-4 ml-1" />
            عمود
          </Button>
          <Button
            variant={columns === 2 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setColumns(2)}
            disabled={selectedTickers.length < 2}
          >
            <Columns className="h-4 w-4 ml-1" />
            عمودين
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RefreshCw className="h-4 w-4 ml-1" />
            إعادة تعيين
          </Button>
        </div>
      </div>

      {/* Add Coin Bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-col md:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="بحث عن عملة (BTC, Ethereum, SOL...)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Select
              value={selectedCoinToAdd}
              onValueChange={(v) => {
                setSelectedCoinToAdd(v);
                setSearch('');
              }}
            >
              <SelectTrigger className="w-full md:w-64">
                <SelectValue
                  placeholder={
                    coinsLoading ? 'جاري التحميل...' : 'اختر عملة'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {filteredCoins.map((c) => (
                  <SelectItem key={c.symbol} value={c.symbol}>
                    <span className="font-mono">{c.symbol}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => handleAddCoin()} size="sm">
              <Plus className="h-4 w-4 ml-1" />
              إضافة
            </Button>
          </div>
          {/* Quick add chips */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE'].map((sym) => (
              <Badge
                key={sym}
                variant="outline"
                className="cursor-pointer hover:bg-amber-50 hover:border-amber-300 text-xs"
                onClick={() => handleAddCoin(sym)}
              >
                + {sym}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Charts Grid */}
      <div
        className={cn(
          'grid gap-3',
          columns === 2 ? 'md:grid-cols-2' : 'grid-cols-1'
        )}
      >
        {selectedTickers.map((ticker) => (
          <Card key={ticker} className="relative">
            <div className="absolute left-2 top-2 z-20 flex items-center gap-1">
              {selectedTickers.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleRemoveCoin(ticker)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <CardContent className="p-0">
              <SingleStockAnalysisView
                initialTicker={ticker}
                canRemove={selectedTickers.length > 1}
                onRemove={() => handleRemoveCoin(ticker)}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* إخلاء مسؤولية قانوني */}
      <LegalDisclaimerFooter />
    </div>
  );
}

export default CryptoTradingChartView;

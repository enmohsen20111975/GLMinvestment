'use client';
import { StatCard } from '@/components/ui/stat-card';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LegalDisclaimerFooter } from '@/components/legal/DisclaimerBanner';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/components/shared/UnifiedPublishButton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Download,
  Filter,
  Zap,
  Search,
  AlertTriangle,
  Bitcoin,
  Coins,
  DollarSign,
  Flame,
  ArrowUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CryptoCoin {
  id: number;
  symbol: string;
  name: string;
  price_usd: number | null;
  price_change_24h: number | null;
  price_change_7d: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  total_volume: number | null;
  circulating_supply: number | null;
  rank: number | null;
}

interface ApiResponse {
  success: boolean;
  count: number;
  last_update: string | null;
  data: CryptoCoin[];
  error?: string;
}

type SortKey =
  | 'market_cap'
  | 'total_volume'
  | 'price_change_24h'
  | 'price_change_7d'
  | 'price_usd'
  | 'rank';

type SortDir = 'asc' | 'desc';

type PresetFilter =
  | 'all'
  | 'gainers'
  | 'losers'
  | 'top10'
  | 'high_volume'
  | 'large_cap'
  | 'mid_cap'
  | 'small_cap';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatNumber(n: number | null, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(digits) + 'T';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(digits) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(digits) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(digits) + 'K';
  return n.toFixed(digits);
}

function formatPrice(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function formatChange(n: number | null): { text: string; positive: boolean } {
  if (n === null || n === undefined || Number.isNaN(n))
    return { text: '—', positive: false };
  return { text: (n >= 0 ? '+' : '') + n.toFixed(2) + '%', positive: n >= 0 };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CryptoScreenerView() {
  const [coins, setCoins] = useState<CryptoCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<PresetFilter>('all');
  const [minMarketCap, setMinMarketCap] = useState<string>('');
  const [minVolume, setMinVolume] = useState<string>('');
  const [minChange24h, setMinChange24h] = useState<string>('');
  const [maxChange24h, setMaxChange24h] = useState<string>('');
  const [minChange7d, setMinChange7d] = useState<string>('');

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('market_cap');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // ─── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data-engine/crypto?limit=200', {
        cache: 'no-store',
      });
      const json: ApiResponse = await res.json();
      if (json.success) {
        setCoins(json.data || []);
        setLastUpdate(json.last_update);
      } else {
        toast.error('فشل تحميل بيانات العملات');
        setCoins([]);
      }
    } catch (e) {
      toast.error('خطأ في الاتصال بقاعدة البيانات');
      console.error(e);
      setCoins([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Apply filters + sort ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = [...coins];

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (c) =>
          c.symbol.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q)
      );
    }

    // Preset filters
    switch (preset) {
      case 'gainers':
        result = result.filter(
          (c) => (c.price_change_24h || 0) > 0
        );
        break;
      case 'losers':
        result = result.filter(
          (c) => (c.price_change_24h || 0) < 0
        );
        break;
      case 'top10':
        result = result.filter((c) => (c.rank || 999) <= 10);
        break;
      case 'high_volume':
        result = result
          .filter((c) => (c.total_volume || 0) > 1e9)
          .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0));
        break;
      case 'large_cap':
        result = result.filter(
          (c) => (c.market_cap || 0) >= 1e10
        );
        break;
      case 'mid_cap':
        result = result.filter(
          (c) =>
            (c.market_cap || 0) >= 1e9 && (c.market_cap || 0) < 1e10
        );
        break;
      case 'small_cap':
        result = result.filter((c) => (c.market_cap || 0) < 1e9);
        break;
    }

    // Numeric filters
    if (minMarketCap) {
      const v = parseFloat(minMarketCap) * 1e9;
      result = result.filter((c) => (c.market_cap || 0) >= v);
    }
    if (minVolume) {
      const v = parseFloat(minVolume) * 1e6;
      result = result.filter((c) => (c.total_volume || 0) >= v);
    }
    if (minChange24h) {
      const v = parseFloat(minChange24h);
      result = result.filter((c) => (c.price_change_24h || -999) >= v);
    }
    if (maxChange24h) {
      const v = parseFloat(maxChange24h);
      result = result.filter((c) => (c.price_change_24h || 999) <= v);
    }
    if (minChange7d) {
      const v = parseFloat(minChange7d);
      result = result.filter((c) => (c.price_change_7d || -999) >= v);
    }

    // Sort
    result.sort((a, b) => {
      const av = a[sortKey] || 0;
      const bv = b[sortKey] || 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });

    return result;
  }, [
    coins,
    search,
    preset,
    minMarketCap,
    minVolume,
    minChange24h,
    maxChange24h,
    minChange7d,
    sortKey,
    sortDir,
  ]);

  // ─── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = coins.length;
    const gainers = coins.filter(
      (c) => (c.price_change_24h || 0) > 0
    ).length;
    const losers = coins.filter(
      (c) => (c.price_change_24h || 0) < 0
    ).length;
    const totalMarketCap = coins.reduce(
      (s, c) => s + (c.market_cap || 0),
      0
    );
    const totalVolume = coins.reduce(
      (s, c) => s + (c.total_volume || 0),
      0
    );
    const avgChange =
      total > 0
        ? coins.reduce((s, c) => s + (c.price_change_24h || 0), 0) / total
        : 0;
    return {
      total,
      gainers,
      losers,
      totalMarketCap,
      totalVolume,
      avgChange,
    };
  }, [coins]);

  // ─── Sort toggle ───────────────────────────────────────────────────────────
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // ─── Export CSV ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = [
      'Rank',
      'Symbol',
      'Name',
      'Price USD',
      'Change 24h %',
      'Change 7d %',
      'Market Cap',
      'Volume 24h',
      'Circulating Supply',
    ];
    const rows = filtered.map((c) => [
      c.rank ?? '',
      c.symbol,
      c.name,
      c.price_usd ?? '',
      c.price_change_24h ?? '',
      c.price_change_7d ?? '',
      c.market_cap ?? '',
      c.total_volume ?? '',
      c.circulating_supply ?? '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${v}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crypto-screener-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`تم تصدير ${filtered.length} عملة`);
  };

  const resetFilters = () => {
    setSearch('');
    setPreset('all');
    setMinMarketCap('');
    setMinVolume('');
    setMinChange24h('');
    setMaxChange24h('');
    setMinChange7d('');
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Bitcoin className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              فلتر العملات الرقمية
            </h1>
            <p className="text-sm text-muted-foreground">
              بيانات حقيقية من{' '}
              <code className="text-xs bg-muted px-1 rounded">
                crypto_prices
              </code>{' '}
              • آخر تحديث:{' '}
              <span className="font-mono text-xs">
                {lastUpdate || '—'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4 ml-2" />
            تصدير CSV
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw
              className={cn('h-4 w-4 ml-2', loading && 'animate-spin')}
            />
            تحديث
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard
          icon={<Coins className="h-4 w-4" />}
          label="إجمالي العملات"
          value={stats.total.toString()}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="صاعدات"
          value={stats.gainers.toString()}
          tone="positive"
        />
        <StatCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="هابطات"
          value={stats.losers.toString()}
          tone="negative"
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4" />}
          label="إجمالي القيمة"
          value={'$' + formatNumber(stats.totalMarketCap)}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="حجم التداول"
          value={'$' + formatNumber(stats.totalVolume)}
        />
        <StatCard
          icon={<Flame className="h-4 w-4" />}
          label="متوسط التغير"
          value={(stats.avgChange >= 0 ? '+' : '') + stats.avgChange.toFixed(2) + '%'}
          tone={stats.avgChange >= 0 ? 'positive' : 'negative'}
        />
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            فلاتر متقدمة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search + Presets */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالرمز أو الاسم (BTC, Bitcoin...)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Select
              value={preset}
              onValueChange={(v) => setPreset(v as PresetFilter)}
            >
              <SelectTrigger className="w-full md:w-56">
                <SelectValue placeholder="فلتر سريع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل العملات</SelectItem>
                <SelectItem value="gainers">🔥 الصاعدات فقط</SelectItem>
                <SelectItem value="losers">📉 الهابطات فقط</SelectItem>
                <SelectItem value="top10">⭐ أعلى 10</SelectItem>
                <SelectItem value="high_volume">💧 حجم تداول عالي</SelectItem>
                <SelectItem value="large_cap">قيمة كبيرة (≥10B)</SelectItem>
                <SelectItem value="mid_cap">قيمة متوسطة (1B-10B)</SelectItem>
                <SelectItem value="small_cap">قيمة صغيرة (&lt;1B)</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <Filter className="h-4 w-4 ml-1" />
              مسح الفلاتر
            </Button>
          </div>

          {/* Numeric Filters */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">القيمة السوقية ≥ (B)</Label>
              <Input
                type="number"
                placeholder="مثال: 1"
                value={minMarketCap}
                onChange={(e) => setMinMarketCap(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">حجم التداول ≥ (M)</Label>
              <Input
                type="number"
                placeholder="مثال: 100"
                value={minVolume}
                onChange={(e) => setMinVolume(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تغير 24h ≥ %</Label>
              <Input
                type="number"
                placeholder="مثال: 0"
                value={minChange24h}
                onChange={(e) => setMinChange24h(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تغير 24h ≤ %</Label>
              <Input
                type="number"
                placeholder="مثال: 10"
                value={maxChange24h}
                onChange={(e) => setMaxChange24h(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تغير 7d ≥ %</Label>
              <Input
                type="number"
                placeholder="مثال: 5"
                value={minChange7d}
                onChange={(e) => setMinChange7d(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              النتائج ({filtered.length})
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>ترتيب:</span>
              <Select
                value={sortKey}
                onValueChange={(v) => setSortKey(v as SortKey)}
              >
                <SelectTrigger className="h-7 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="market_cap">القيمة السوقية</SelectItem>
                  <SelectItem value="total_volume">حجم التداول</SelectItem>
                  <SelectItem value="price_change_24h">تغير 24h</SelectItem>
                  <SelectItem value="price_change_7d">تغير 7d</SelectItem>
                  <SelectItem value="price_usd">السعر</SelectItem>
                  <SelectItem value="rank">الترتيب</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">
                جاري تحميل العملات...
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                لا توجد عملات تطابق الفلاتر المحددة
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={resetFilters}
              >
                مسح الفلاتر
              </Button>
            </div>
          ) : (
            <UnifiedTable<CryptoCoin>
              columns={screenerColumns}
              data={filtered}
              keyField="id"
              dense
              columnToggle
              filterable
              maxHeight="max-h-[600px]"
              rowClassName={() => 'hover:bg-muted/50'}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── UnifiedTable columns ─────────────────────────────────────────────────────
const screenerColumns: Column<CryptoCoin>[] = [
  {
    key: 'rank',
    header: '#',
    align: 'center',
    sortable: true,
    width: 'w-12',
    className: 'text-xs text-muted-foreground',
    render: (c) => c.rank ?? '—',
  },
  {
    key: 'symbol',
    header: 'العملة',
    sortable: true,
    filterable: true,
    render: (c) => (
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 text-xs font-bold">
          {c.symbol.slice(0, 3)}
        </div>
        <div>
          <div className="font-semibold text-sm">{c.symbol}</div>
          <div className="text-xs text-muted-foreground">{c.name}</div>
        </div>
      </div>
    ),
  },
  {
    key: 'price_usd',
    header: 'السعر',
    align: 'right',
    sortable: true,
    className: 'font-mono text-sm',
    render: (c) => formatPrice(c.price_usd),
  },
  {
    key: 'price_change_24h',
    header: '24h',
    align: 'right',
    sortable: true,
    render: (c) => {
      const ch = formatChange(c.price_change_24h);
      return (
        <Badge variant="outline" className={cn('font-mono text-xs',
          ch.positive ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-red-600 bg-red-50 border-red-200'
        )}>
          {ch.text}
        </Badge>
      );
    },
  },
  {
    key: 'price_change_7d',
    header: '7d',
    align: 'right',
    sortable: true,
    render: (c) => {
      const ch = formatChange(c.price_change_7d);
      return (
        <Badge variant="outline" className={cn('font-mono text-xs',
          ch.positive ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-red-600 bg-red-50 border-red-200'
        )}>
          {ch.text}
        </Badge>
      );
    },
  },
  {
    key: 'market_cap',
    header: 'القيمة السوقية',
    align: 'right',
    sortable: true,
    className: 'font-mono text-sm',
    render: (c) => `$${formatNumber(c.market_cap)}`,
  },
  {
    key: 'total_volume',
    header: 'حجم التداول',
    align: 'right',
    sortable: true,
    className: 'font-mono text-sm',
    render: (c) => `$${formatNumber(c.total_volume)}`,
  },
];
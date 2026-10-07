'use client';
import { StatCard } from '@/components/ui/stat-card';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LegalDisclaimerFooter } from '@/components/legal/DisclaimerBanner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher';
import {
  Bitcoin,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  Activity,
  Target,
  Shield,
  Zap,
  AlertTriangle,
  DollarSign,
  Flame,
  Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CryptoCoin {
  symbol: string;
  name: string;
  price_usd: number | null;
  price_change_24h: number | null;
  price_change_7d: number | null;
  market_cap: number | null;
  total_volume: number | null;
  rank: number | null;
}

interface CryptoAnalysis {
  symbol: string;
  name: string;
  price: number | null;
  change_24h: number | null;
  change_7d: number | null;
  market_cap: number | null;
  volume: number | null;
  rsi: number | null;
  ma_50: number | null;
  ma_200: number | null;
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | null;
  signal: 'BUY' | 'SELL' | 'NEUTRAL' | null;
  signal_strength: number | null;
  volatility: number | null;
  above_ma50: boolean;
  above_ma200: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPrice(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function formatNumber(n: number | null, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(digits) + 'T';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(digits) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(digits) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(digits) + 'K';
  return n.toFixed(digits);
}

function formatChange(n: number | null): { text: string; positive: boolean } {
  if (n === null || n === undefined || Number.isNaN(n))
    return { text: '—', positive: false };
  return { text: (n >= 0 ? '+' : '') + n.toFixed(2) + '%', positive: n >= 0 };
}

function classifyCryptoState(
  rsi: number | null,
  change: number | null,
  above_ma50: boolean
): { state: string; state_ar: string; color: string } {
  if (rsi === null) {
    return {
      state: 'INSUFFICIENT_DATA',
      state_ar: 'بيانات غير كافية',
      color: 'bg-slate-100 text-slate-600 border-slate-200',
    };
  }
  if (rsi >= 70) {
    return {
      state: 'AT_PEAK',
      state_ar: 'في قمة',
      color: 'bg-red-50 text-red-700 border-red-200',
    };
  }
  if (rsi >= 65) {
    return {
      state: 'NEAR_PEAK',
      state_ar: 'قرب قمة',
      color: 'bg-orange-50 text-orange-700 border-orange-200',
    };
  }
  if (rsi > 55) {
    return {
      state: 'BALANCED_MOMENTUM',
      state_ar: 'زخم متزن',
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }
  if (rsi >= 45) {
    return {
      state: 'NEUTRAL',
      state_ar: 'محايد',
      color: 'bg-teal-50 text-teal-700 border-teal-200',
    };
  }
  if (rsi >= 40) {
    return {
      state: 'CORRECTION_END',
      state_ar: 'تصحيح خلص',
      color: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  return {
    state: 'DECLINING',
    state_ar: 'لسة نازل',
    color: 'bg-rose-50 text-rose-700 border-rose-200',
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CryptoAdvancedAnalysisView() {
  const [coins, setCoins] = useState<CryptoCoin[]>([]);
  const [analyses, setAnalyses] = useState<CryptoAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [trendFilter, setTrendFilter] = useState<string>('all');
  const [analysisDepth, setAnalysisDepth] = useState<number>(10); // كم عملة نحلل

  // ─── Fetch coin list ───────────────────────────────────────────────────────
  const fetchCoins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data-engine/crypto?limit=200', {
        cache: 'no-store',
      });
      const json = await res.json();
      if (json.success) {
        setCoins(json.data || []);
      }
    } catch (e) {
      console.error(e);
      toast.error('فشل تحميل قائمة العملات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoins();
  }, [fetchCoins]);

  // ─── Run analysis on top N coins ──────────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    if (coins.length === 0) {
      toast.info('لا توجد عملات للتحليل');
      return;
    }
    setAnalyzing(true);
    try {
      const topCoins = coins.slice(0, analysisDepth);
      const results: CryptoAnalysis[] = [];

      // تحليل متوازي (batch of 3) عشان ما نضغطش على CoinGecko
      for (let i = 0; i < topCoins.length; i += 3) {
        const batch = topCoins.slice(i, i + 3);
        const batchResults = await Promise.all(
          batch.map(async (coin) => {
            try {
              const res = await fetch(
                `/api/crypto/full-analysis?ticker=${encodeURIComponent(coin.symbol)}&timeframe=DAY&limit=200`,
                { signal: AbortSignal.timeout(20000) }
              );
              if (!res.ok) return null;
              const data = await res.json();
              if (!data || !data.candles || data.candles.length === 0) return null;

              const candles = data.candles;
              const lastCandle = candles[candles.length - 1];
              const closes = candles.map((c: any) => c.close).filter((n: number) => !Number.isNaN(n));
              if (closes.length < 2) return null;

              const price = lastCandle.close;
              const change_24h = coin.price_change_24h;
              const change_7d = coin.price_change_7d;

              // حساب MA50 + MA200
              const ma_50 =
                closes.length >= 50
                  ? closes.slice(-50).reduce((a: number, b: number) => a + b, 0) / 50
                  : null;
              const ma_200 =
                closes.length >= 200
                  ? closes.slice(-200).reduce((a: number, b: number) => a + b, 0) / 200
                  : null;

              // حساب RSI (14)
              const rsi = computeRSI(closes, 14);

              // حساب volatility (std of last 20 returns)
              const returns: number[] = [];
              for (let j = Math.max(1, closes.length - 20); j < closes.length; j++) {
                returns.push((closes[j] - closes[j - 1]) / closes[j - 1]);
              }
              const avgRet = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
              const variance =
                returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) /
                (returns.length || 1);
              const volatility = Math.sqrt(variance) * 100;

              const above_ma50 = ma_50 !== null && price > ma_50;
              const above_ma200 = ma_200 !== null && price > ma_200;

              // Trend
              let trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | null = null;
              if (ma_50 !== null && ma_200 !== null) {
                if (above_ma50 && above_ma200) trend = 'UPTREND';
                else if (!above_ma50 && !above_ma200) trend = 'DOWNTREND';
                else trend = 'SIDEWAYS';
              }

              // Signal
              let signal: 'BUY' | 'SELL' | 'NEUTRAL' | null = 'NEUTRAL';
              let signal_strength = 50;
              if (rsi !== null) {
                if (rsi < 40 && above_ma50) {
                  signal = 'BUY';
                  signal_strength = 70 + (40 - rsi);
                } else if (rsi > 70) {
                  signal = 'SELL';
                  signal_strength = 70 + (rsi - 70);
                }
                signal_strength = Math.min(100, signal_strength);
              }

              return {
                symbol: coin.symbol,
                name: coin.name,
                price,
                change_24h,
                change_7d,
                market_cap: coin.market_cap,
                volume: coin.total_volume,
                rsi,
                ma_50,
                ma_200,
                trend,
                signal,
                signal_strength,
                volatility,
                above_ma50,
                above_ma200,
              } as CryptoAnalysis;
            } catch (e) {
              console.error(`Failed to analyze ${coin.symbol}:`, e);
              return null;
            }
          })
        );
        results.push(...batchResults.filter((r): r is CryptoAnalysis => r !== null));
      }

      setAnalyses(results);
      toast.success(`تم تحليل ${results.length} عملة بنجاح`);
    } catch (e) {
      console.error(e);
      toast.error('فشل التحليل');
    } finally {
      setAnalyzing(false);
    }
  }, [coins, analysisDepth]);

  // ─── Filtered analyses ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = [...analyses];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (a) =>
          a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
      );
    }
    if (stateFilter !== 'all') {
      result = result.filter((a) => {
        const cls = classifyCryptoState(a.rsi, a.change_24h, a.above_ma50);
        return cls.state === stateFilter;
      });
    }
    if (trendFilter !== 'all') {
      result = result.filter((a) => a.trend === trendFilter);
    }
    return result.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
  }, [analyses, search, stateFilter, trendFilter]);

  // ─── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const states = analyses.map((a) =>
      classifyCryptoState(a.rsi, a.change_24h, a.above_ma50).state
    );
    return {
      total: analyses.length,
      at_peak: states.filter((s) => s === 'AT_PEAK').length,
      near_peak: states.filter((s) => s === 'NEAR_PEAK').length,
      balanced: states.filter((s) => s === 'BALANCED_MOMENTUM').length,
      neutral: states.filter((s) => s === 'NEUTRAL').length,
      correction_end: states.filter((s) => s === 'CORRECTION_END').length,
      declining: states.filter((s) => s === 'DECLINING').length,
      insufficient: states.filter((s) => s === 'INSUFFICIENT_DATA').length,
      buy_signals: analyses.filter((a) => a.signal === 'BUY').length,
      sell_signals: analyses.filter((a) => a.signal === 'SELL').length,
    };
  }, [analyses]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              التحليل المتقدم للعملات الرقمية
            </h1>
            <p className="text-sm text-muted-foreground">
              تحليل فني شامل من CoinGecko OHLC • RSI • MA50/MA200 • Trend •
              Volatility
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={analysisDepth.toString()}
            onValueChange={(v) => setAnalysisDepth(parseInt(v, 10))}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 عملات</SelectItem>
              <SelectItem value="20">20 عملة</SelectItem>
              <SelectItem value="30">30 عملة</SelectItem>
              <SelectItem value="50">50 عملة</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="default"
            size="sm"
            onClick={runAnalysis}
            disabled={analyzing || loading || coins.length === 0}
          >
            <RefreshCw
              className={cn('h-4 w-4 ml-2', analyzing && 'animate-spin')}
            />
            {analyzing ? `جاري التحليل (${analyses.length}/${analysisDepth})` : 'تشغيل التحليل'}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="إجمالي"
          value={stats.total.toString()}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="في قمة"
          value={stats.at_peak.toString()}
          tone="negative"
        />
        <StatCard
          icon={<Flame className="h-4 w-4" />}
          label="قرب قمة"
          value={stats.near_peak.toString()}
          tone="warning"
        />
        <StatCard
          icon={<Zap className="h-4 w-4" />}
          label="زخم متزن"
          value={stats.balanced.toString()}
          tone="positive"
        />
        <StatCard
          icon={<Shield className="h-4 w-4" />}
          label="محايد"
          value={stats.neutral.toString()}
          tone="neutral"
        />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="تصحيح خلص"
          value={stats.correction_end.toString()}
          tone="warning"
        />
        <StatCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="نازل"
          value={stats.declining.toString()}
          tone="negative"
        />
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            نتائج التحليل ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالرمز أو الاسم..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="الحالة الفنية" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="AT_PEAK">في قمة</SelectItem>
                <SelectItem value="NEAR_PEAK">قرب قمة</SelectItem>
                <SelectItem value="BALANCED_MOMENTUM">زخم متزن</SelectItem>
                <SelectItem value="NEUTRAL">محايد</SelectItem>
                <SelectItem value="CORRECTION_END">تصحيح خلص</SelectItem>
                <SelectItem value="DECLINING">لسة نازل</SelectItem>
                <SelectItem value="INSUFFICIENT_DATA">بيانات غير كافية</SelectItem>
              </SelectContent>
            </Select>
            <Select value={trendFilter} onValueChange={setTrendFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="الاتجاه" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الاتجاهات</SelectItem>
                <SelectItem value="UPTREND">صاعد</SelectItem>
                <SelectItem value="DOWNTREND">هابط</SelectItem>
                <SelectItem value="SIDEWAYS">عرضي</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {analyzing && analyses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-amber-600 mb-3" />
              <p className="text-sm text-muted-foreground">
                جاري تحليل العملات من CoinGecko... ({analyses.length}/{analysisDepth})
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                ده بياخد وقت لأن CoinGecko بيرجع OHLC لكل عملة على حدة
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {analyses.length === 0
                  ? 'اضغط "تشغيل التحليل" لبدء التحليل الفني للعملات'
                  : 'لا توجد عملات تطابق الفلاتر'}
              </p>
            </div>
          ) : (
            <UnifiedTable<CryptoAnalysis & { _idx: number }>
              columns={analysisColumns}
              data={filtered.map((a, i) => ({ ...a, _idx: i + 1 }))}
              keyField="symbol"
              dense
              columnToggle
              filterable
              maxHeight="max-h-[600px]"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── UnifiedTable columns ─────────────────────────────────────────────────────
const analysisColumns: Column<CryptoAnalysis & { _idx: number }>[] = [
  {
    key: '_idx',
    header: '#',
    align: 'center',
    sortable: true,
    width: 'w-12',
    className: 'text-xs text-muted-foreground',
    render: (a) => a._idx,
  },
  {
    key: 'symbol',
    header: 'العملة',
    sortable: true,
    filterable: true,
    render: (a) => (
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 text-xs font-bold">
          {a.symbol.slice(0, 3)}
        </div>
        <div>
          <div className="font-semibold text-sm">{a.symbol}</div>
          <div className="text-xs text-muted-foreground">{a.name}</div>
        </div>
        <StockPublisher
          data={{
            ticker: a.symbol,
            nameEn: a.name,
            currentPrice: Number(a.price ?? 0),
            changePct: Number(a.change_24h ?? 0) || undefined,
            rsi: Number(a.rsi ?? 0) || undefined,
            sma20: Number(a.ma_50 ?? 0) || undefined,
            sma50: Number(a.ma_50 ?? 0) || undefined,
            sma200: Number(a.ma_200 ?? 0) || undefined,
            marketCap: Number(a.market_cap ?? 0) || undefined,
            turnover: Number(a.volume ?? 0) || undefined,
            market: 'CRYPTO' as StockPublishData['market'],
            recommendation:
              a.signal === 'BUY' ? 'BUY' :
              a.signal === 'SELL' ? 'SELL' : 'HOLD',
          }}
          variant="icon"
          size="sm"
        />
      </div>
    ),
  },
  {
    key: 'price',
    header: 'السعر',
    align: 'right',
    sortable: true,
    className: 'font-mono text-sm',
    render: (a) => formatPrice(a.price),
  },
  {
    key: 'change_24h',
    header: '24h',
    align: 'right',
    sortable: true,
    render: (a) => {
      const c = formatChange(a.change_24h);
      return (
        <Badge variant="outline" className={cn('font-mono text-xs',
          c.positive ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-red-600 bg-red-50 border-red-200'
        )}>
          {c.text}
        </Badge>
      );
    },
  },
  {
    key: 'change_7d',
    header: '7d',
    align: 'right',
    sortable: true,
    render: (a) => {
      const c = formatChange(a.change_7d);
      return (
        <Badge variant="outline" className={cn('font-mono text-xs',
          c.positive ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-red-600 bg-red-50 border-red-200'
        )}>
          {c.text}
        </Badge>
      );
    },
  },
  {
    key: 'rsi',
    header: 'RSI',
    align: 'center',
    sortable: true,
    className: 'font-mono text-sm',
    render: (a) => a.rsi !== null ? a.rsi.toFixed(1) : '—',
  },
  {
    key: '_state',
    header: 'الحالة',
    align: 'center',
    filterable: true,
    render: (a) => {
      const cls = classifyCryptoState(a.rsi, a.change_24h, a.above_ma50);
      return (
        <Badge variant="outline" className={cn('text-xs', cls.color)}>
          {cls.state_ar}
        </Badge>
      );
    },
  },
  {
    key: 'trend',
    header: 'الاتجاه',
    align: 'center',
    filterable: true,
    render: (a) => a.trend ? (
      <Badge variant="outline" className={cn('text-xs',
        a.trend === 'UPTREND' ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
        : a.trend === 'DOWNTREND' ? 'text-red-600 bg-red-50 border-red-200'
        : 'text-slate-600 bg-slate-50 border-slate-200'
      )}>
        {a.trend === 'UPTREND' ? 'صاعد' : a.trend === 'DOWNTREND' ? 'هابط' : 'عرضي'}
      </Badge>
    ) : '—',
  },
  {
    key: 'signal',
    header: 'إشارة',
    align: 'center',
    filterable: true,
    render: (a) => a.signal ? (
      <Badge variant="outline" className={cn('text-xs font-bold',
        a.signal === 'BUY' ? 'text-emerald-700 bg-emerald-100 border-emerald-300'
        : a.signal === 'SELL' ? 'text-red-700 bg-red-100 border-red-300'
        : 'text-slate-600 bg-slate-50 border-slate-200'
      )}>
        {a.signal}
      </Badge>
    ) : '—',
  },
  {
    key: 'market_cap',
    header: 'القيمة',
    align: 'right',
    sortable: true,
    className: 'font-mono text-sm',
    render: (a) => `$${formatNumber(a.market_cap)}`,
  },
  {
    key: 'volatility',
    header: 'التذبذب',
    align: 'right',
    sortable: true,
    className: 'font-mono text-sm',
    render: (a) => a.volatility !== null ? a.volatility.toFixed(2) + '%' : '—',
  },
];

// ─── RSI helper ─────────────────────────────────────────────────────────────

function computeRSI(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  // حساب أول average
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // smoothing لباقي القيم
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

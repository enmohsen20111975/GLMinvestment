'use client';

/**
 * CryptoAnalysisView — Crypto mirror of the stocks MarketAnalysisView.
 *
 * This component reuses the SAME 5-tab shell structure as MarketAnalysisView:
 *   - status       (حالة السوق)            — CryptoMarketStatusTab
 *   - predictions  (التوقعات)              — CryptoPredictionsTab (reads /api/crypto-lab/predictions)
 *   - investor     (المستثمر)              — CryptoPersonaTab persona="investor" (filters /api/crypto/coins?limit=250)
 *   - gambler      (المضارب)               — CryptoPersonaTab persona="gambler"  (filters /api/crypto/coins?limit=250)
 *   - expert       (توصيات الخبراء)        — ExpertRecommendationsPanel + live-lab fallback
 *   - trading-chart(الشارت)               — dynamic TradingChartView (BTC default)
 *
 * All live data sources are crypto-specific (/api/crypto/coins?limit=250 + /api/crypto-lab/predictions)
 * while the shell + sub-components mirror MarketAnalysisView so the UX is consistent.
 *
 * NO indigo/blue colors — emerald/rose/amber/fuchsia accent palette only.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity,
  Target,
  Clock,
  BarChart3,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Bitcoin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore, MarketType } from '@/lib/store';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
import { ExpertRecommendationsPanel } from '@/components/analysis/ExpertRecommendationsPanel';
import dynamic from 'next/dynamic';

// Mirror of MarketAnalysisView's TradingChartView dynamic import.
// Reads currentMarket from store internally, so when market=CRYPTO it will
// show crypto tickers. Default ticker is BTC.
const TradingChartViewDynamic = dynamic(
  () =>
    import('@/components/analysis/TradingChartView').then((m) => ({
      default: m.TradingChartView,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[500px] w-full rounded-xl" />,
  }
);

/* ====================================================================== */
/*  Types                                                                 */
/* ====================================================================== */

/** Coin shape returned by /api/crypto/coins?limit=250 (under all_cryptos array). */
interface CryptoCoin {
  symbol: string;
  name?: string;
  price_usd?: number;
  current_price?: number;
  change_24h?: number;
  change_percent?: number;
  change_7d?: number;
  market_cap?: number;
  volume_24h?: number;
  total_volume?: number;
  market_cap_rank?: number;
  image?: string;
}

/** Prediction shape returned by /api/crypto-lab/predictions. */
interface CryptoPrediction {
  id: number;
  symbol: string;
  signal: string;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  analysis: Record<string, unknown> | null;
  created_at: string;
}

/* ====================================================================== */
/*  Helpers                                                               */
/* ====================================================================== */

const CURRENCY = '$';

function fmtUSD(n?: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n as number)) return '—';
  const v = n as number;
  if (v >= 1000) {
    return v.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtCompact(n?: number | null): string {
  if (n == null || !Number.isFinite(n as number)) return '—';
  const v = n as number;
  if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(2);
}

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n as number)) return '—';
  const v = n as number;
  return (v > 0 ? '+' : '') + v.toFixed(digits) + '%';
}

function fmtDateAr(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function cryptoSignalStyle(signal: string): {
  label: string;
  color: string;
  bg: string;
} {
  const s = (signal || '').toUpperCase();
  if (s.includes('BUY'))
    return { label: 'شراء', color: '#15803d', bg: '#dcfce7' };
  if (s.includes('SELL'))
    return { label: 'بيع', color: '#b91c1c', bg: '#fee2e2' };
  if (s.includes('HOLD') || s === 'NEUTRAL')
    return { label: 'انتظار', color: '#a16207', bg: '#fef3c7' };
  return { label: signal || '—', color: '#52525b', bg: '#f4f4f5' };
}

function coinChange(c: CryptoCoin): number {
  return c.change_24h ?? c.change_percent ?? 0;
}
function coinPrice(c: CryptoCoin): number {
  return c.price_usd ?? c.current_price ?? 0;
}

/* ====================================================================== */
/*  Data hooks (useEffect + useState + 60s auto-refresh)                  */
/* ====================================================================== */

function useCryptoLive(refreshMs = 60_000) {
  const [coins, setCoins] = useState<CryptoCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/crypto/coins?limit=250', { cache: 'no-store' });
      if (!res.ok) {
        setError('فشل في تحميل بيانات العملات الرقمية');
        if (!silent) setLoading(false);
        return;
      }
      const data = await res.json();
      const list: CryptoCoin[] =
        (data.all_cryptos as CryptoCoin[] | undefined) ||
        (data.data?.all_cryptos as CryptoCoin[] | undefined) ||
        (Array.isArray(data) ? (data as CryptoCoin[]) : []);
      setCoins(list);
      setLastUpdate(new Date().toLocaleString('ar-EG'));
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error('[useCryptoLive]', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(() => fetchData(true), refreshMs);
    return () => clearInterval(t);
  }, [fetchData, refreshMs]);

  return { coins, loading, error, lastUpdate, refetch: fetchData };
}

function useCryptoPredictions(refreshMs = 60_000) {
  const [predictions, setPredictions] = useState<CryptoPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/crypto-lab/predictions', {
        cache: 'no-store',
      });
      if (!res.ok) {
        setError('فشل في تحميل توقعات الكريبتو');
        if (!silent) setLoading(false);
        return;
      }
      const data = await res.json();
      const preds =
        (data.predictions as CryptoPrediction[] | undefined) || [];
      setPredictions(preds);
      setLastUpdate(
        data.last_updated
          ? fmtDateAr(data.last_updated)
          : new Date().toLocaleString('ar-EG')
      );
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error('[useCryptoPredictions]', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(() => fetchData(true), refreshMs);
    return () => clearInterval(t);
  }, [fetchData, refreshMs]);

  return { predictions, loading, error, lastUpdate, refetch: fetchData };
}

/* ====================================================================== */
/*  Shared small UI atoms                                                 */
/* ====================================================================== */

function StatBadge({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={cn('rounded-xl p-3 text-center border border-black/5', bg)}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={cn('text-lg font-bold tabular-nums', color)}>{value}</div>
    </div>
  );
}

function IndicatorChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-md border border-black/5 bg-muted/40 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn('font-bold tabular-nums text-xs', color)}>{value}</div>
    </div>
  );
}

function ErrorCard({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <Card className="border-rose-200 bg-rose-50">
      <CardContent className="p-6 text-center">
        <p className="text-rose-700 mb-3">{error}</p>
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 ml-2" /> إعادة المحاولة
        </Button>
      </CardContent>
    </Card>
  );
}

/* ====================================================================== */
/*  CryptoMarketStatusTab (status tab)                                    */
/* ====================================================================== */

function CryptoMarketStatusTab() {
  const { coins, loading, error, lastUpdate, refetch } = useCryptoLive();

  const stats = useMemo(() => {
    if (coins.length === 0) {
      return {
        total: 0,
        gainers: 0,
        losers: 0,
        unchanged: 0,
        totalMarketCap: 0,
        topGainers: [] as CryptoCoin[],
        topLosers: [] as CryptoCoin[],
      };
    }
    const gainers = coins.filter((c) => coinChange(c) > 0);
    const losers = coins.filter((c) => coinChange(c) < 0);
    const unchanged = coins.filter((c) => coinChange(c) === 0);
    const totalMarketCap = coins.reduce(
      (sum, c) => sum + (c.market_cap ?? 0),
      0
    );
    const topGainers = [...gainers]
      .sort((a, b) => coinChange(b) - coinChange(a))
      .slice(0, 5);
    const topLosers = [...losers]
      .sort((a, b) => coinChange(a) - coinChange(b))
      .slice(0, 5);
    return {
      total: coins.length,
      gainers: gainers.length,
      losers: losers.length,
      unchanged: unchanged.length,
      totalMarketCap,
      topGainers,
      topLosers,
    };
  }, [coins]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) return <ErrorCard error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-emerald-600" />
            حالة سوق العملات الرقمية
          </CardTitle>
          {lastUpdate && (
            <p className="text-xs text-muted-foreground">
              آخر تحديث: {lastUpdate}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBadge
              label="إجمالي العملات"
              value={stats.total.toLocaleString('en-US')}
              color="text-foreground"
              bg="bg-muted"
            />
            <StatBadge
              label="الصاعدون"
              value={stats.gainers.toLocaleString('en-US')}
              color="text-emerald-700"
              bg="bg-emerald-50"
            />
            <StatBadge
              label="الهابطون"
              value={stats.losers.toLocaleString('en-US')}
              color="text-rose-700"
              bg="bg-rose-50"
            />
            <StatBadge
              label="القيمة السوقية"
              value={`${CURRENCY}${fmtCompact(stats.totalMarketCap)}`}
              color="text-amber-700"
              bg="bg-amber-50"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MoversCard
          title="أعلى الصاعدات"
          coins={stats.topGainers}
          kind="gainer"
        />
        <MoversCard
          title="أعلى الهابطات"
          coins={stats.topLosers}
          kind="loser"
        />
      </div>
    </div>
  );
}

function MoversCard({
  title,
  coins,
  kind,
}: {
  title: string;
  coins: CryptoCoin[];
  kind: 'gainer' | 'loser';
}) {
  const isGainer = kind === 'gainer';
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {isGainer ? (
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          ) : (
            <TrendingDown className="h-4 w-4 text-rose-600" />
          )}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {coins.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            لا توجد بيانات
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {coins.map((c, i) => {
              const ch = coinChange(c);
              return (
                <div
                  key={`${c.symbol}-${i}`}
                  className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-bold w-12 shrink-0">
                      {c.symbol}
                    </span>
                    <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                      {c.name || c.symbol}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs tabular-nums">
                      {CURRENCY}
                      {fmtUSD(coinPrice(c))}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'tabular-nums',
                        isGainer
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : 'text-rose-700 bg-rose-50 border-rose-200'
                      )}
                    >
                      {fmtPct(ch)}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ====================================================================== */
/*  CryptoPredictionsTab (predictions tab)                                */
/* ====================================================================== */

function CryptoPredictionsTab() {
  const { predictions, loading, error, lastUpdate, refetch } =
    useCryptoPredictions();

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) return <ErrorCard error={error} onRetry={() => refetch()} />;

  if (predictions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <Bitcoin className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            لا توجد توقعات كريبتو بعد. المختبر يعمل كل 15 دقيقة وستظهر التوقعات
            قريباً.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          {predictions.length} توقعات · آخر تحديث: {lastUpdate}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 ml-2" /> تحديث
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {predictions.map((p) => (
          <CryptoPredictionCard key={p.id} prediction={p} />
        ))}
      </div>
    </div>
  );
}

function CryptoPredictionCard({
  prediction,
}: {
  prediction: CryptoPrediction;
}) {
  const style = cryptoSignalStyle(prediction.signal);
  const indicators =
    (prediction.analysis?.indicators as
      | Record<string, number | null>
      | undefined) || {};
  const trendUp = prediction.analysis?.trend_up as boolean | undefined;
  const changePct = prediction.analysis?.change_24h_pct as
    | number
    | undefined;
  const fusion =
    (prediction.analysis?.fusion as Record<string, unknown> | undefined) ||
    {};
  const finalSignalAr = prediction.analysis?.final_signal_ar as
    | string
    | undefined;

  const rr =
    prediction.entry_price &&
    prediction.stop_loss &&
    prediction.target_price &&
    Math.abs(prediction.entry_price - prediction.stop_loss) > 0
      ? Math.abs(
          prediction.target_price - prediction.entry_price
        ) / Math.abs(prediction.entry_price - prediction.stop_loss)
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bitcoin className="h-5 w-5 text-amber-600" />
            <CardTitle className="text-lg">{prediction.symbol}</CardTitle>
          </div>
          <Badge
            variant="outline"
            style={{
              color: style.color,
              backgroundColor: style.bg,
              borderColor: style.color + '33',
            }}
          >
            {style.label}
          </Badge>
        </div>
        {finalSignalAr && <CardDescription>{finalSignalAr}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/50 p-2 text-center">
            <div className="text-xs text-muted-foreground">الثقة</div>
            <div className="text-base font-bold tabular-nums">
              {prediction.confidence.toFixed(0)}%
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-2 text-center">
            <div className="text-xs text-muted-foreground">R/R</div>
            <div className="text-base font-bold tabular-nums">
              {rr ? rr.toFixed(2) : '—'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">الدخول</div>
            <div className="font-semibold tabular-nums">
              {CURRENCY}
              {fmtUSD(prediction.entry_price)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">الهدف</div>
            <div className="font-semibold tabular-nums text-emerald-700">
              {CURRENCY}
              {fmtUSD(prediction.target_price)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">الوقف</div>
            <div className="font-semibold tabular-nums text-rose-700">
              {CURRENCY}
              {fmtUSD(prediction.stop_loss)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {typeof indicators.rsi === 'number' && (
            <IndicatorChip
              label="RSI"
              value={indicators.rsi.toFixed(1)}
              color={
                indicators.rsi > 70
                  ? 'text-rose-700'
                  : indicators.rsi < 30
                  ? 'text-emerald-700'
                  : 'text-foreground'
              }
            />
          )}
          {typeof indicators.macd_hist === 'number' && (
            <IndicatorChip
              label="MACD Hist"
              value={indicators.macd_hist.toFixed(2)}
              color={
                indicators.macd_hist >= 0
                  ? 'text-emerald-700'
                  : 'text-rose-700'
              }
            />
          )}
          {typeof indicators.atr_pct === 'number' && (
            <IndicatorChip
              label="ATR %"
              value={indicators.atr_pct.toFixed(2)}
              color="text-foreground"
            />
          )}
          {typeof changePct === 'number' && (
            <IndicatorChip
              label="تغير 24س"
              value={fmtPct(changePct)}
              color={changePct >= 0 ? 'text-emerald-700' : 'text-rose-700'}
            />
          )}
          {typeof fusion.score === 'number' && (
            <IndicatorChip
              label="Fusion"
              value={(fusion.score as number).toFixed(0)}
              color="text-amber-700"
            />
          )}
          {trendUp !== undefined && (
            <IndicatorChip
              label="الاتجاه"
              value={trendUp ? 'صاعد ↑' : 'هابط ↓'}
              color={trendUp ? 'text-emerald-700' : 'text-rose-700'}
            />
          )}
        </div>

        <div className="text-xs text-muted-foreground text-left pt-1">
          {fmtDateAr(prediction.created_at)}
        </div>
      </CardContent>
    </Card>
  );
}

/* ====================================================================== */
/*  CryptoPersonaTab (investor + gambler tabs)                            */
/* ====================================================================== */

function CryptoPersonaTab({ persona }: { persona: 'investor' | 'gambler' }) {
  const { coins, loading, error, refetch } = useCryptoLive();

  const picks = useMemo(() => {
    if (coins.length === 0) return [] as CryptoCoin[];
    const scored = coins.map((c) => ({
      coin: c,
      change: coinChange(c),
      rank: c.market_cap_rank ?? 9999,
    }));
    if (persona === 'investor') {
      // Stable uptrend (0%..5%) + large caps (rank <= 50) — investor-friendly.
      return scored
        .filter((p) => p.change >= 0 && p.change <= 5 && p.rank <= 50)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 12)
        .map((p) => p.coin);
    }
    // Gambler: high volatility (|change| > 5%), sorted by absolute change desc.
    return scored
      .filter((p) => Math.abs(p.change) > 5)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 12)
      .map((p) => p.coin);
  }, [coins, persona]);

  const theme =
    persona === 'investor'
      ? {
          emoji: '🏦',
          label: 'المستثمر',
          accentBorder: 'border-emerald-200',
          accentBg: 'bg-emerald-50',
          accentText: 'text-emerald-700',
          accentBadge:
            'bg-emerald-100 text-emerald-800 border-emerald-200',
          accentDot: 'bg-emerald-500',
          desc: 'عملات ذات اتجاه صاعد مستقر (0%-5% خلال 24س) ورأس مال كبير (Top 50) — مناسبة للاستثمار متوسط وطويل المدى.',
        }
      : {
          emoji: '🎯',
          label: 'المضارب',
          accentBorder: 'border-fuchsia-200',
          accentBg: 'bg-fuchsia-50',
          accentText: 'text-fuchsia-700',
          accentBadge:
            'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200',
          accentDot: 'bg-fuchsia-500',
          desc: 'عملات ذات تذبذب عالي (أكثر من 5% خلال 24س صعوداً أو هبوطاً) — فرص مضاربة قصيرة المدى مع انتباه للمخاطر.',
        };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) return <ErrorCard error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <Card className={cn(theme.accentBorder, theme.accentBg)}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-lg font-bold flex items-center gap-2 flex-wrap">
                <span className="text-2xl">{theme.emoji}</span>
                <span>{theme.label}</span>
                <Badge variant="outline" className={theme.accentBadge}>
                  {picks.length} عملة
                </Badge>
              </h3>
              <p className={cn('text-xs mt-1', theme.accentText)}>
                {theme.desc}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 ml-2" /> تحديث
            </Button>
          </div>
        </CardContent>
      </Card>

      {picks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              لا توجد عملات تطابق معايير {theme.label} حالياً. حاول لاحقاً بعد
              تحديث السوق.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {picks.map((c, i) => (
            <CryptoPersonaCard
              key={`${c.symbol}-${i}`}
              coin={c}
              persona={persona}
              rank={i + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CryptoPersonaCard({
  coin,
  persona,
  rank,
}: {
  coin: CryptoCoin;
  persona: 'investor' | 'gambler';
  rank: number;
}) {
  const change = coinChange(coin);
  const price = coinPrice(coin);
  const isGainer = change >= 0;
  const accentText =
    persona === 'investor' ? 'text-emerald-700' : 'text-fuchsia-700';
  const accentDot =
    persona === 'investor' ? 'bg-emerald-500' : 'bg-fuchsia-500';

  const verdict =
    persona === 'investor'
      ? change > 0
        ? 'شراء تدريجي'
        : 'مراقبة'
      : isGainer
      ? 'زخم صاعد'
      : 'انعكاس هابط';

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold shrink-0',
                accentDot
              )}
            >
              {rank}
            </span>
            <div className="min-w-0">
              <div className="font-bold text-base">{coin.symbol}</div>
              <div className="text-xs text-muted-foreground truncate max-w-[140px]">
                {coin.name || coin.symbol}
              </div>
            </div>
          </div>
          <Badge variant="outline" className={accentText}>
            {verdict}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">السعر</div>
            <div className="font-semibold tabular-nums">
              {CURRENCY}
              {fmtUSD(price)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">تغير 24س</div>
            <div
              className={cn(
                'font-semibold tabular-nums',
                isGainer ? 'text-emerald-700' : 'text-rose-700'
              )}
            >
              {fmtPct(change)}
            </div>
          </div>
        </div>
        {(coin.market_cap ?? 0) > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            القيمة السوقية: {CURRENCY}
            {fmtCompact(coin.market_cap)}
          </div>
        )}
        {coin.volume_24h != null && (coin.volume_24h ?? 0) > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            حجم التداول: {CURRENCY}
            {fmtCompact(coin.volume_24h ?? coin.total_volume ?? 0)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ====================================================================== */
/*  CryptoExpertTab (expert recommendations + crypto lab fallback)        */
/* ====================================================================== */

function CryptoExpertTab({ market }: { market: MarketType }) {
  const { predictions, loading, lastUpdate } = useCryptoPredictions();

  return (
    <div className="space-y-4">
      <ExpertRecommendationsPanel market={market} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base flex-wrap">
            <Bitcoin className="h-5 w-5 text-amber-600" />
            توقعات المختبر المباشر (BTC / ETH)
            {lastUpdate && (
              <span className="text-xs text-muted-foreground font-normal">
                · {lastUpdate}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            توقعات لحظية من مختبر العملات الرقمية (يعمل كل 15 دقيقة) — تستند إلى
            محرك FusionEngineV20 + SMC على بيانات CoinGecko.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : predictions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              المختبر يعمل كل 15 دقيقة وستظهر التوقعات قريباً.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {predictions.map((p) => (
                <CryptoPredictionCard
                  key={`expert-${p.id}`}
                  prediction={p}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ====================================================================== */
/*  Main CryptoAnalysisView — mirrors MarketAnalysisView shell            */
/* ====================================================================== */

export function CryptoAnalysisView() {
  const [activeTab, setActiveTab] = useState('status');
  const { currentMarket } = useAppStore();

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold">تحليلات العملات الرقمية</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <RefreshAnalyticsButton variant="glow" size="default" />
          <MarketSelector size="default" />
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 h-auto">
          <TabsTrigger value="status" className="flex items-center gap-1">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">حالة السوق</span>
          </TabsTrigger>
          <TabsTrigger
            value="predictions"
            className="flex items-center gap-1"
          >
            <Target className="h-4 w-4" />
            <span className="hidden sm:inline">التوقعات</span>
          </TabsTrigger>
          <TabsTrigger value="investor" className="flex items-center gap-1">
            <span className="text-base">🏦</span>
            <span className="hidden sm:inline">المستثمر</span>
          </TabsTrigger>
          <TabsTrigger value="gambler" className="flex items-center gap-1">
            <span className="text-base">🎯</span>
            <span className="hidden sm:inline">المضارب</span>
          </TabsTrigger>
          <TabsTrigger value="expert" className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">توصيات الخبراء</span>
          </TabsTrigger>
          <TabsTrigger
            value="trading-chart"
            className="flex items-center gap-1"
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">الشارت</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="mt-4">
          <CryptoMarketStatusTab />
        </TabsContent>

        <TabsContent value="predictions" className="mt-4">
          <CryptoPredictionsTab />
        </TabsContent>

        <TabsContent value="investor" className="mt-4">
          <CryptoPersonaTab persona="investor" />
        </TabsContent>

        <TabsContent value="gambler" className="mt-4">
          <CryptoPersonaTab persona="gambler" />
        </TabsContent>

        <TabsContent value="expert" className="mt-4">
          <CryptoExpertTab market={currentMarket} />
        </TabsContent>

        <TabsContent value="trading-chart" className="mt-0">
          <TradingChartViewDynamic initialTicker="BTC" />
        </TabsContent>
      </Tabs>

      {/* Social Share Footer — mirrors MarketAnalysisView */}
      <Card className="mt-4 bg-muted/50">
        <CardContent className="p-3 text-center text-sm text-muted-foreground">
          <p>📍 تابع أحدث تحليلات العملات الرقمية على</p>
          <div className="flex items-center justify-center gap-4 mt-2 flex-wrap">
            <a
              href="https://invist.m2y.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              invist.m2y.net
            </a>
            <span>|</span>
            <a
              href="https://t.me/REDACTED_CHANNEL_NAME"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Telegram
            </a>
            <span>|</span>
            <a
              href="https://www.facebook.com/profile.php?id=61590600300048"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Facebook
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default CryptoAnalysisView;

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Radar, RefreshCw, Eye, Flame, TrendingUp, TrendingDown,
  Activity, AlertTriangle, Star, StarOff, X, ChevronLeft
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { useAppStore } from '@/lib/store';
import { getMarketStatus } from '@/lib/market-hours';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

// ============================================================================
// Types
// ============================================================================
interface RadarStock {
  ticker: string;
  current_price: number;
  price_bucket: 'low_price' | 'mid_price' | 'high_price';
  avg_turnover_20d: number;
  avg_volume_20d: number;
  avg_volume_10d: number;
  volume_ratio_10d_vs_20d: number;
  price_stability: number;
  range_10d_pct: number;
  roc_10d: number | null;
  path: 'A_pre_surge' | 'B_quiet_accumulation_strong' | 'C_quiet_accumulation_weak' | 'D_explosive_surge' | 'E_early_break';
  position_size: number;
  reason: string;
  quiet_details?: {
    signal_count: number;
    signals_met: string[];
    signals_failed: string[];
  };
  explosive_details?: any;
  break_reason?: string;
  // من الـ tracking merge
  isTracked?: boolean;
  trackingEntryDate?: string;
  trackingEntryPrice?: number;
  changeSinceTracking?: number;
}

interface MakerRadarResponse {
  success: boolean;
  market: string;
  min_quiet_signals: number;
  min_price: number;
  total_scanned: number;
  under_microscope_count: number;
  quiet_count: number;
  explosive_count: number;
  early_break_count: number;
  quiet_list: RadarStock[];
  pre_surge_list: RadarStock[];
  explosive_list: RadarStock[];
  early_break_list: RadarStock[];
  tracked_count: number;
  tracked_tickers: string[];
  generated_at: string;
  cached?: boolean;
  cache_age_seconds?: number;
  error?: string;
}

interface StockDetail {
  success: boolean;
  ticker: string;
  stock_info: any;
  prices: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number; turnover: number }>;
  stats: {
    lastClose: number;
    changePct: number;
    roc10d: number;
    avgVolume20: number;
    avgTurnover20: number;
    max20: number;
    min20: number;
    range20Pct: number;
    dataPoints: number;
  };
  tracking: {
    isTracked: boolean;
    entryDate?: string;
    entryPrice?: number;
    currentPrice?: number;
    changeSinceTracking?: number;
    daysTracked?: number;
  } | null;
}

// ============================================================================
// Helpers
// ============================================================================
const fmtNum = (n: number | null | undefined, digits = 2): string => {
  if (n == null || isNaN(n)) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
};

const fmtMoney = (n: number | null | undefined): string => {
  if (n == null || isNaN(n)) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
};

const fmtPct = (n: number | null | undefined, withSign = true): string => {
  if (n == null || isNaN(n)) return '-';
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
};

const pnlColorClass = (pnl: number | null | undefined): string => {
  if (pnl == null || pnl === 0) return 'text-muted-foreground';
  return pnl > 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400';
};

const bucketLabel: Record<string, string> = {
  low_price: 'رخيص',
  mid_price: 'وسط',
  high_price: 'غالي',
};

// ============================================================================
// Main Component
// ============================================================================
interface MakerRadarTabProps {
  market?: string;
}

export function MakerRadarTab({ market = 'EGX' }: MakerRadarTabProps) {
  const [data, setData] = useState<MakerRadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'quiet' | 'explosive' | 'early_break' | 'tracked'>('all');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const params = new URLSearchParams({
        market,
        minQuietSignals: '5',
        minPrice: '1.0',
      });
      const res = await fetch(`/api/maker-radar?${params}`, { cache: 'no-store' });
      const json: MakerRadarResponse = await res.json();
      if (json.success) {
        setData(json);
        setLastUpdated(new Date());
      } else {
        setError(json.error || 'فشل في تحميل البيانات');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [market]);

  // fetch على mount + لما يتغير الـ market
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // auto-refresh كل 60 ثانية (لو السوق مفتوح)
  useVisibilityAwarePolling(
    () => fetchData(true),
    60_000,
    [fetchData],
    { market, allowOffMarket: false }
  );

  const handleTrackToggle = async (ticker: string, currentPrice: number, isTracked: boolean) => {
    try {
      const res = await fetch('/api/maker-radar/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          entryPrice: currentPrice,
          action: isTracked ? 'remove' : 'add',
          notes: 'tracked from maker radar tab',
        }),
      });
      const json = await res.json();
      if (json.success) {
        // refresh سريع
        fetchData(true);
      }
    } catch (e) {
      console.error('track toggle error:', e);
    }
  };

  const marketStatus = getMarketStatus(market);

  // فلترة القوائم حسب الـ filter النشط
  const filteredPreSurge = useMemo(() => {
    if (filter === 'all' || filter === 'quiet') return data?.pre_surge_list || [];
    if (filter === 'tracked') return (data?.pre_surge_list || []).filter((s) => s.isTracked);
    return [];
  }, [data, filter]);

  const filteredQuiet = useMemo(() => {
    if (filter === 'all' || filter === 'quiet') return data?.quiet_list || [];
    if (filter === 'tracked') return (data?.quiet_list || []).filter((s) => s.isTracked);
    return [];
  }, [data, filter]);

  const filteredExplosive = useMemo(() => {
    if (filter === 'all' || filter === 'explosive') return data?.explosive_list || [];
    if (filter === 'tracked') return (data?.explosive_list || []).filter((s) => s.isTracked);
    return [];
  }, [data, filter]);

  const filteredEarlyBreak = useMemo(() => {
    if (filter === 'all' || filter === 'early_break') return data?.early_break_list || [];
    if (filter === 'tracked') return (data?.early_break_list || []).filter((s) => s.isTracked);
    return [];
  }, [data, filter]);

  // العرض
  if (loading && !data) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-6 text-center">
        <AlertTriangle className="h-10 w-10 text-rose-500 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground mb-3">{error}</p>
        <Button size="sm" onClick={() => fetchData()}>
          <RefreshCw className="h-4 w-4 ml-1" /> إعادة المحاولة
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ===== الهيدر ===== */}
      <Card className="p-3 md:p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h3 className="text-base font-semibold">رادار الميكرز</h3>
              <p className="text-xs text-muted-foreground">
                {data ? `${data.total_scanned} سهم مفحوص` : '...'} ·{' '}
                {data ? `${data.under_microscope_count} تحت الميكروسكوب` : ''}
                {data?.cached && (
                  <span className="text-amber-600 dark:text-amber-400 ml-2">
                    · cache {data.cache_age_seconds}s
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                marketStatus.isOpen
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300'
              }
            >
              <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${marketStatus.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              {marketStatus.isOpen ? 'السوق مفتوح' : 'السوق مقفول'}
            </Badge>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground">
                آخر تحديث: {lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={() => fetchData(true)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* الفلتر السريع */}
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/50">
          {([
            { key: 'all', label: 'الكل' },
            { key: 'quiet', label: '🎯 تحت الميكروسكوب' },
            { key: 'explosive', label: '🔥 موجة انفجارية' },
            { key: 'early_break', label: '⚡ اختراق مبكر' },
            { key: 'tracked', label: '⭐ المتابَعة' },
          ] as const).map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key === 'tracked' && data?.tracked_count ? (
                <Badge variant="secondary" className="ml-1 h-4 text-xs px-1">{data.tracked_count}</Badge>
              ) : null}
            </Button>
          ))}
        </div>
      </Card>

      {/* ===== القسم 0: Pre-Surge (الأولوية القصوى) ===== */}
      {(filter === 'all' || filter === 'quiet' || filter === 'tracked') && filteredPreSurge.length > 0 && (
        <RadarSection
          title="Pre-Surge (تجميع مبكر)"
          subtitle="أعلى أولوية — السهم بيتجمع قبل الانفجار"
          icon={<Radar className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
          accent="amber"
          stocks={filteredPreSurge}
          onSelect={setSelectedTicker}
          onTrackToggle={handleTrackToggle}
        />
      )}

      {/* ===== القسم 1: تحت الميكروسكوب (الأولوية القصوى) ===== */}
      {(filter === 'all' || filter === 'quiet' || filter === 'tracked') && filteredQuiet.length > 0 && (
        <RadarSection
          title="تحت الميكروسكوب"
          subtitle="تجميع هادئ محتمل للانفجار"
          icon={<Eye className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          accent="amber"
          stocks={filteredQuiet}
          onSelect={setSelectedTicker}
          onTrackToggle={handleTrackToggle}
        />
      )}

      {/* ===== القسم 2: الموجة الانفجارية ===== */}
      {(filter === 'all' || filter === 'explosive' || filter === 'tracked') && filteredExplosive.length > 0 && (
        <RadarSection
          title="الموجة الانفجارية"
          subtitle="حجم فجائي + حركة قوية"
          icon={<Flame className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
          accent="rose"
          stocks={filteredExplosive}
          onSelect={setSelectedTicker}
          onTrackToggle={handleTrackToggle}
        />
      )}

      {/* ===== القسم 3: اختراق مبكر ===== */}
      {(filter === 'all' || filter === 'early_break' || filter === 'tracked') && filteredEarlyBreak.length > 0 && (
        <RadarSection
          title="اختراق مبكر"
          subtitle="خروج من نطاق ضيق بحجم"
          icon={<TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          accent="emerald"
          stocks={filteredEarlyBreak}
          onSelect={setSelectedTicker}
          onTrackToggle={handleTrackToggle}
        />
      )}

      {/* ===== حالة فاضية ===== */}
      {data && data.under_microscope_count === 0 && (
        <Card className="p-8 text-center">
          <Radar className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">مفيش أسهم تحت الميكروسكوب دلوقتي</p>
          <p className="text-xs text-muted-foreground mt-1">جرّب تحديث بعد شوية</p>
        </Card>
      )}

      {/* ===== Stock Detail Dialog ===== */}
      <Dialog open={!!selectedTicker} onOpenChange={(open) => { if (!open) setSelectedTicker(null); }}>
        <DialogContent className="max-w-[95vw] w-full h-[90vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg" showCloseButton={false}>
          {selectedTicker && (
            <StockDetailDrawer
              ticker={selectedTicker}
              onClose={() => setSelectedTicker(null)}
              onTrackToggle={handleTrackToggle}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Radar Section Component
// ============================================================================
interface RadarSectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: 'amber' | 'rose' | 'emerald';
  stocks: RadarStock[];
  onSelect: (ticker: string) => void;
  onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

function RadarSection({ title, subtitle, icon, accent, stocks, onSelect, onTrackToggle }: RadarSectionProps) {
  const accentClasses = {
    amber: 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20',
    rose: 'border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20',
    emerald: 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20',
  };

  return (
    <Card className={`p-3 md:p-4 ${accentClasses[accent]}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h4 className="text-sm font-semibold">{title}</h4>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Badge variant="secondary" className="text-xs">{stocks.length} سهم</Badge>
      </div>

      {/* جدول الأسهم */}
      <div className="overflow-x-auto -mx-3 md:mx-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border/50">
              <th className="text-right font-medium py-2 px-2">السهم</th>
              <th className="text-right font-medium py-2 px-2">السعر</th>
              <th className="text-right font-medium py-2 px-2 hidden sm:table-cell">ROC10</th>
              <th className="text-right font-medium py-2 px-2 hidden md:table-cell">سيولة</th>
              <th className="text-right font-medium py-2 px-2 hidden lg:table-cell">حجم نسبي</th>
              <th className="text-right font-medium py-2 px-2 hidden xl:table-cell">استقرار</th>
              <th className="text-right font-medium py-2 px-2">تغير</th>
              <th className="text-center font-medium py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((stock) => (
              <tr
                key={stock.ticker}
                className="border-b border-border/30 hover:bg-muted/40 cursor-pointer transition-colors"
                onClick={() => onSelect(stock.ticker)}
              >
                <td className="py-2 px-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTrackToggle(stock.ticker, stock.current_price, !!stock.isTracked);
                      }}
                      className="text-muted-foreground hover:text-amber-500"
                      title={stock.isTracked ? 'إزالة من المتابعة' : 'أضف للمتابعة'}
                    >
                      {stock.isTracked ? (
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      ) : (
                        <StarOff className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <div>
                      <div className="font-semibold">{stock.ticker}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {bucketLabel[stock.price_bucket]}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="py-2 px-2 text-right font-mono">
                  {fmtNum(stock.current_price)}
                </td>
                <td className={`py-2 px-2 text-right hidden sm:table-cell ${pnlColorClass(stock.roc_10d)}`}>
                  {fmtPct(stock.roc_10d)}
                </td>
                <td className="py-2 px-2 text-right hidden md:table-cell font-mono text-muted-foreground">
                  {fmtMoney(stock.avg_turnover_20d)}
                </td>
                <td className="py-2 px-2 text-right hidden lg:table-cell">
                  <span className={
                    stock.volume_ratio_10d_vs_20d >= 1.5
                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                      : stock.volume_ratio_10d_vs_20d >= 1.0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-muted-foreground'
                  }>
                    {stock.volume_ratio_10d_vs_20d.toFixed(2)}×
                  </span>
                </td>
                <td className="py-2 px-2 text-right hidden xl:table-cell">
                  <span className={
                    stock.price_stability >= 0.7
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : stock.price_stability >= 0.5
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-muted-foreground'
                  }>
                    {(stock.price_stability * 100).toFixed(0)}%
                  </span>
                </td>
                <td className={`py-2 px-2 text-right ${pnlColorClass(stock.changeSinceTracking)}`}>
                  {stock.isTracked ? fmtPct(stock.changeSinceTracking) : '-'}
                </td>
                <td className="py-2 px-2 text-center">
                  <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground inline" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* تفاصيل الإشارات لـ quiet accumulation (آخر 3 أسهم) */}
      {accent === 'amber' && stocks.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            عرض تفاصيل الإشارات ({stocks.length} سهم)
          </summary>
          <div className="mt-2 space-y-2">
            {stocks.slice(0, 5).map((stock) => {
              const qd = stock.quiet_details;
              if (!qd) return null;
              return (
                <div key={stock.ticker} className="border border-border/30 rounded-md p-2 bg-background/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">{stock.ticker}</span>
                    <Badge variant="outline" className="text-xs">
                      {qd.signal_count}/6 إشارات
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {qd.signals_met.map((s, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        ✓ {s.split('(')[0]}
                      </span>
                    ))}
                    {qd.signals_failed.map((s, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                        ✗ {s.split('(')[0]}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </Card>
  );
}

// ============================================================================
// Stock Detail Drawer (inside Dialog)
// ============================================================================
interface StockDetailDrawerProps {
  ticker: string;
  onClose: () => void;
  onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

function StockDetailDrawer({ ticker, onClose, onTrackToggle }: StockDetailDrawerProps) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadStockDetail = useAppStore((s) => s.loadStockDetail);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/maker-radar/stock?ticker=${ticker}&days=30`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setDetail(json);
      } else {
        setError(json.error || 'فشل تحميل البيانات');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleTrack = async () => {
    if (!detail?.stats.lastClose) return;
    await onTrackToggle(ticker, detail.stats.lastClose, !!detail?.tracking?.isTracked);
    fetchDetail(); // refresh
  };

  // mini sparkline for prices
  const sparkline = useMemo(() => {
    if (!detail?.prices || detail.prices.length < 2) return null;
    const prices = detail.prices.map((p) => p.close).filter((c) => c > 0);
    if (prices.length < 2) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const w = 200;
    const h = 40;
    const points = prices.map((p, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${x},${y}`;
    }).join(' ');
    const isUp = prices[prices.length - 1] >= prices[0];
    return { points, isUp, w, h, min, max };
  }, [detail]);

  return (
    <>
      {/* sticky header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <DialogTitle className="text-base font-semibold">{ticker}</DialogTitle>
          {detail?.stock_info?.name_ar && (
            <span className="text-xs text-muted-foreground">{detail.stock_info.name_ar}</span>
          )}
          {detail?.stock_info?.sector && (
            <Badge variant="outline" className="text-xs">{detail.stock_info.sector}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {detail && (
            <Button
              size="sm"
              variant={detail.tracking?.isTracked ? 'default' : 'outline'}
              onClick={handleTrack}
              className="h-8"
            >
              {detail.tracking?.isTracked ? (
                <><Star className="h-3.5 w-3.5 fill-current" /> متابَع</>
              ) : (
                <><StarOff className="h-3.5 w-3.5" /> أضف للمتابعة</>
              )}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => loadStockDetail(ticker)} className="h-8">
            صفحة السهم
          </Button>
          <DialogClose asChild>
            <Button size="sm" variant="ghost" onClick={onClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-4 bg-muted/10">
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {error && (
          <Card className="p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-rose-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" onClick={fetchDetail} className="mt-3">
              <RefreshCw className="h-4 w-4 ml-1" /> إعادة
            </Button>
          </Card>
        )}

        {detail && !loading && (
          <div className="space-y-3">
            {/* القيم الأساسية */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatCard
                label="السعر الحالي"
                value={fmtNum(detail.stats.lastClose)}
                sub={detail.tracking?.isTracked ? `من ${fmtNum(detail.tracking.entryPrice)}` : undefined}
              />
              <StatCard
                label="تغير الفترة"
                value={fmtPct(detail.stats.changePct)}
                valueClass={pnlColorClass(detail.stats.changePct)}
              />
              <StatCard
                label="ROC 10 أيام"
                value={fmtPct(detail.stats.roc10d)}
                valueClass={pnlColorClass(detail.stats.roc10d)}
              />
              <StatCard
                label="مدى 20 يوم"
                value={`${detail.stats.range20Pct.toFixed(1)}%`}
                sub={`${fmtNum(detail.stats.min20)} - ${fmtNum(detail.stats.max20)}`}
              />
            </div>

            {/* tracking info */}
            {detail.tracking?.isTracked && (
              <Card className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    <span className="text-xs font-medium">تحت المتابعة منذ {detail.tracking.entryDate}</span>
                  </div>
                  <div className="text-left">
                    <div className={`text-sm font-bold ${pnlColorClass(detail.tracking.changeSinceTracking)}`}>
                      {fmtPct(detail.tracking.changeSinceTracking)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {detail.tracking.daysTracked} يوم · من {fmtNum(detail.tracking.entryPrice)} لـ {fmtNum(detail.tracking.currentPrice)}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* sparkline */}
            {sparkline && (
              <Card className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">حركة السعر ({detail.prices.length} يوم)</span>
                  <Badge variant="outline" className={sparkline.isUp ? 'text-emerald-600' : 'text-rose-600'}>
                    {sparkline.isUp ? <TrendingUp className="h-3 w-3 ml-1" /> : <TrendingDown className="h-3 w-3 ml-1" />}
                    {fmtPct(((sparkline.max - sparkline.min) / sparkline.min) * 100, false)} مدى
                  </Badge>
                </div>
                <svg viewBox={`0 0 ${sparkline.w} ${sparkline.h}`} className="w-full h-12" preserveAspectRatio="none">
                  <polyline
                    points={sparkline.points}
                    fill="none"
                    stroke={sparkline.isUp ? '#10b981' : '#f43f5e'}
                    strokeWidth="1.5"
                  />
                </svg>
              </Card>
            )}

            {/* سيولة وحجم */}
            <Card className="p-3">
              <div className="text-xs font-medium mb-2">السيولة والحجم</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">متوسط حجم 20 يوم</div>
                  <div className="font-mono font-semibold">{fmtMoney(detail.stats.avgVolume20)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">متوسط سيولة 20 يوم</div>
                  <div className="font-mono font-semibold">{fmtMoney(detail.stats.avgTurnover20)} EGP</div>
                </div>
                <div>
                  <div className="text-muted-foreground">نقاط البيانات</div>
                  <div className="font-mono font-semibold">{detail.stats.dataPoints}</div>
                </div>
              </div>
            </Card>

            {/* جدول الأسعار الأخيرة */}
            <Card className="p-3">
              <div className="text-xs font-medium mb-2">آخر {Math.min(detail.prices.length, 10)} أيام</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border/50">
                      <th className="text-right py-1 px-2 font-medium">التاريخ</th>
                      <th className="text-right py-1 px-2 font-medium">إغلاق</th>
                      <th className="text-right py-1 px-2 font-medium hidden sm:table-cell">أعلى</th>
                      <th className="text-right py-1 px-2 font-medium hidden sm:table-cell">أقل</th>
                      <th className="text-right py-1 px-2 font-medium">حجم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.prices.slice(-10).reverse().map((p) => (
                      <tr key={p.date} className="border-b border-border/30">
                        <td className="py-1.5 px-2 text-muted-foreground">{p.date}</td>
                        <td className="py-1.5 px-2 font-mono font-semibold">{fmtNum(p.close)}</td>
                        <td className="py-1.5 px-2 font-mono hidden sm:table-cell">{fmtNum(p.high)}</td>
                        <td className="py-1.5 px-2 font-mono hidden sm:table-cell">{fmtNum(p.low)}</td>
                        <td className="py-1.5 px-2 font-mono text-muted-foreground">{fmtMoney(p.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================================
// Stat Card
// ============================================================================
function StatCard({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <Card className="p-2.5">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-bold ${valueClass || ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

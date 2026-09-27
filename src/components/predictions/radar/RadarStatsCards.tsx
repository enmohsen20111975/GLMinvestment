'use client';

// ============================================================================
// RadarStatsCards — المكونات الجديدة لترقية رادار السيولة
// ============================================================================
// 4 مكونات:
//   1. RadarSignalStatsCard   — إحصائيات مصير إشارات الرادار (win rate per signal type)
//   2. SectorTreemapCard      — خريطة سيولة القطاعات (sector liquidity treemap)
//   3. EntryTimingCard        — درجة توقيت الدخول الذكي (0-100) + breakdown
//   4. LiquidityFootprintCard — بصمة السيولة (volume profile by price level)
//
// كل المكونات:
//   - client-side fetch من الـ endpoints الجديدة في /api/maker-radar/*
//   - shadcn/ui Card-based + RTL Arabic
//   - lazy + graceful fallback على error/empty state
//   - لا تعتمد على props من parent — self-contained
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Trophy, RefreshCw, TrendingUp, TrendingDown, Gauge,
  Layers, BarChart3, Target, Activity, AlertCircle, Info,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// ============================================================================
// 1) RadarSignalStatsCard — تتبع مصير الإشارات (Signal Tracker)
// ============================================================================
interface SignalStats {
  success: boolean;
  total_signals: number;
  pending: number;
  verified: number;
  win_rate_pct: number;
  avg_outcome_7d: number | null;
  avg_outcome_14d: number | null;
  avg_outcome_30d: number | null;
  by_signal_type: Array<{
    signal_type: string;
    label: string;
    total: number;
    verified: number;
    wins: number;
    win_rate_pct: number;
    avg_outcome_7d: number | null;
    avg_outcome_14d: number | null;
    avg_outcome_30d: number | null;
  }>;
  recent_signals: Array<{
    ticker: string;
    signal_date: string;
    signal_type: string;
    entry_price: number;
    outcome_30d: number | null;
    status: string;
  }>;
}

const SIGNAL_TYPE_AR: Record<string, string> = {
  explosive_surge: '💥 انفجار حجمي',
  quiet_accumulation_strong: '🎯 تجميع قوي',
  quiet_accumulation_weak: '🔍 تجميع ضعيف',
  pre_surge: '🚀 Pre-Surge',
  early_break: '⚡ اختراق مبكر',
};

const SIGNAL_TYPE_COLOR: Record<string, string> = {
  explosive_surge: 'text-rose-600 dark:text-rose-400',
  quiet_accumulation_strong: 'text-amber-600 dark:text-amber-400',
  quiet_accumulation_weak: 'text-yellow-600 dark:text-yellow-400',
  pre_surge: 'text-purple-600 dark:text-purple-400',
  early_break: 'text-emerald-600 dark:text-emerald-400',
};

function fmtPct(n: number | null | undefined, withSign = true): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function pnlColorClass(n: number | null | undefined): string {
  if (n == null) return 'text-muted-foreground';
  if (n > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (n < 0) return 'text-rose-600 dark:text-rose-400';
  return 'text-muted-foreground';
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

export function RadarSignalStatsCard() {
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/maker-radar/signal-tracker?days=30', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setStats(json);
      } else {
        setError(json.error || 'فشل تحميل الإحصائيات');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const res = await fetch('/api/maker-radar/signal-tracker/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_age_days: 45 }),
      });
      const json = await res.json();
      if (json.success) {
        const msg = `✓ تم التحقق من ${json.verified_count} إشارة — ${json.win_count} رابحة / ${json.loss_count} خاسرة`;
        setVerifyMsg(msg);
        fetchStats(); // refresh stats
      } else {
        setVerifyMsg(`✗ ${json.error || 'فشل التحقق'}`);
      }
    } catch (e) {
      setVerifyMsg(`✗ ${e instanceof Error ? e.message : 'خطأ'}`);
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-20 w-full" />
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <Card className="p-4 border-dashed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>تعذّر تحميل إحصائيات الإشارات</span>
        </div>
      </Card>
    );
  }

  const hasData = stats.total_signals > 0;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <div>
            <h4 className="text-sm font-semibold">مصير إشارات الرادار</h4>
            <p className="text-[10px] text-muted-foreground">تتبّع دقة كل نوع إشارة بعد 7/14/30 يوم</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={verifying || !hasData || stats.pending === 0}
            onClick={handleVerify}
          >
            {verifying ? (
              <>
                <RefreshCw className="h-3 w-3 ml-1 animate-spin" />
                جاري التحقق...
              </>
            ) : (
              <>
                <RefreshCw className="h-3 w-3 ml-1" />
                تحقّق ({stats.pending})
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={fetchStats}
            title="تحديث"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {!hasData ? (
        <div className="text-xs text-muted-foreground text-center py-4">
          <Info className="h-6 w-6 mx-auto mb-2 opacity-40" />
          لسه مفيش إشارات مسجّلة — الإشارات بتتسجّل تلقائياً مع كل تشغيل للرادار
        </div>
      ) : (
        <>
          {/* Top stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="text-center p-2 rounded-md bg-muted/30">
              <div className="text-[10px] text-muted-foreground">إجمالي الإشارات</div>
              <div className="text-lg font-bold">{stats.total_signals}</div>
            </div>
            <div className="text-center p-2 rounded-md bg-muted/30">
              <div className="text-[10px] text-muted-foreground">قيد التحقق</div>
              <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{stats.pending}</div>
            </div>
            <div className="text-center p-2 rounded-md bg-muted/30">
              <div className="text-[10px] text-muted-foreground">تم التحقق</div>
              <div className="text-lg font-bold">{stats.verified}</div>
            </div>
            <div className="text-center p-2 rounded-md bg-muted/30">
              <div className="text-[10px] text-muted-foreground">نسبة النجاح</div>
              <div className={`text-lg font-bold ${stats.win_rate_pct >= 60 ? 'text-emerald-600 dark:text-emerald-400' : stats.win_rate_pct >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {stats.win_rate_pct.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Avg outcomes */}
          <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
            <div className="text-center p-1.5 rounded bg-muted/20">
              <div className="text-[9px] text-muted-foreground">7 أيام</div>
              <div className={`font-semibold ${pnlColorClass(stats.avg_outcome_7d)}`}>
                {fmtPct(stats.avg_outcome_7d)}
              </div>
            </div>
            <div className="text-center p-1.5 rounded bg-muted/20">
              <div className="text-[9px] text-muted-foreground">14 يوم</div>
              <div className={`font-semibold ${pnlColorClass(stats.avg_outcome_14d)}`}>
                {fmtPct(stats.avg_outcome_14d)}
              </div>
            </div>
            <div className="text-center p-1.5 rounded bg-muted/20">
              <div className="text-[9px] text-muted-foreground">30 يوم</div>
              <div className={`font-semibold ${pnlColorClass(stats.avg_outcome_30d)}`}>
                {fmtPct(stats.avg_outcome_30d)}
              </div>
            </div>
          </div>

          {/* Per signal type */}
          {stats.by_signal_type.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-muted-foreground font-medium mb-1">حسب نوع الإشارة:</div>
              {stats.by_signal_type.map((s) => (
                <div
                  key={s.signal_type}
                  className="flex items-center justify-between p-2 rounded-md bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-medium ${SIGNAL_TYPE_COLOR[s.signal_type] || ''}`}>
                      {SIGNAL_TYPE_AR[s.signal_type] || s.signal_type}
                    </span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1">
                      {s.verified}/{s.total}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{s.wins} رابح</span>
                    <span className={`font-bold ${s.win_rate_pct >= 60 ? 'text-emerald-600 dark:text-emerald-400' : s.win_rate_pct >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {s.win_rate_pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {verifyMsg && (
            <div className="mt-3 text-[10px] text-muted-foreground text-center p-1.5 rounded bg-muted/20">
              {verifyMsg}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ============================================================================
// 2) SectorTreemapCard — خريطة سيولة القطاعات
// ============================================================================
interface SectorTreemapData {
  success: boolean;
  total_sectors: number;
  total_turnover: number;
  sectors: Array<{
    sector: string;
    stocks_count: number;
    total_turnover: number;
    total_volume: number;
    avg_change_pct: number;
    avg_roc_10d: number;
    direction: string;
    color: string;
    top_tickers: Array<{
      ticker: string;
      name_ar: string;
      avg_turnover_20d: number;
      change_pct: number;
      roc_10d: number;
    }>;
  }>;
}

const DIRECTION_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  inflow: { bg: 'bg-emerald-500/80', text: 'text-white', label: 'دخول' },
  outflow: { bg: 'bg-rose-500/80', text: 'text-white', label: 'خروج' },
  neutral: { bg: 'bg-amber-500/70', text: 'text-white', label: 'محايد' },
};

export function SectorTreemapCard() {
  const [data, setData] = useState<SectorTreemapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/maker-radar/sector-treemap?days=30', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || 'فشل تحميل القطاعات');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }

  if (error || !data || !data.success) {
    return (
      <Card className="p-4 border-dashed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>{error || 'الرادار بيتسخن — حاول تاني بعد شوية'}</span>
        </div>
      </Card>
    );
  }

  // Treemap layout: simple proportional flex-basis grid (no D3)
  const maxTurnover = data.sectors[0]?.total_turnover || 1;
  const sectors = data.sectors.slice(0, 12); // top 12

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h4 className="text-sm font-semibold">خريطة سيولة القطاعات</h4>
            <p className="text-[10px] text-muted-foreground">حجم القطاع = سيولته · اللون = اتجاه الأموال</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={fetchData}
          title="تحديث"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Treemap: flex-wrap with proportional flex-basis */}
      <div className="flex flex-wrap gap-1.5 -mx-1">
        {sectors.map((s) => {
          const sizePct = Math.max(8, (s.total_turnover / maxTurnover) * 100);
          const dir = DIRECTION_STYLE[s.direction] || DIRECTION_STYLE.neutral;
          return (
            <div
              key={s.sector}
              className={`${dir.bg} ${dir.text} p-2 rounded-md transition-all hover:scale-105 hover:shadow-md cursor-default`}
              style={{ flex: `${Math.max(1, sizePct / 4)} 1 ${Math.max(80, sizePct * 4)}px`, minHeight: '64px' }}
              title={`${s.sector} — ${s.stocks_count} سهم — سيولة ${fmtMoney(s.total_turnover)} — أداء ${s.avg_change_pct.toFixed(2)}%`}
            >
              <div className="text-[10px] font-bold leading-tight truncate">{s.sector}</div>
              <div className="text-[10px] opacity-90">{s.stocks_count} سهم</div>
              <div className="text-xs font-bold mt-0.5">{fmtMoney(s.total_turnover)}</div>
              <div className="text-[9px] opacity-80">
                {s.avg_change_pct >= 0 ? '+' : ''}{s.avg_change_pct.toFixed(1)}%
              </div>
              <div className="text-[9px] opacity-70 mt-0.5">{dir.label}</div>
            </div>
          );
        })}
      </div>

      {/* Top sectors detail */}
      <div className="mt-3 space-y-1.5">
        <div className="text-[10px] text-muted-foreground font-medium mb-1">أعلى القطاعات سيولة:</div>
        {sectors.slice(0, 3).map((s) => (
          <div key={s.sector} className="text-xs">
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-medium">{s.sector}</span>
              <span className="text-muted-foreground">{fmtMoney(s.total_turnover)} EGP</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {s.top_tickers.slice(0, 3).map((t) => (
                <Badge
                  key={t.ticker}
                  variant="outline"
                  className={`text-[9px] h-4 px-1 ${t.change_pct >= 0 ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400' : 'border-rose-500/40 text-rose-700 dark:text-rose-400'}`}
                >
                  {t.ticker} {t.change_pct >= 0 ? '+' : ''}{t.change_pct.toFixed(1)}%
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================================
// 3) EntryTimingCard — توقيت الدخول الذكي (0-100)
// ============================================================================
interface EntryTimingData {
  success: boolean;
  ticker: string;
  score: number;
  label: string;
  label_color: string;
  breakdown: {
    accumulation: { score: number; max: number; label: string; detail: string };
    volume: { score: number; max: number; label: string; detail: string };
    support: { score: number; max: number; label: string; detail: string };
    momentum: { score: number; max: number; label: string; detail: string };
  };
  recommendation: string;
  computed_at: string;
}

const LABEL_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  emerald: { bg: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-500/40' },
  amber: { bg: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', ring: 'ring-amber-500/40' },
  yellow: { bg: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', ring: 'ring-yellow-500/40' },
  rose: { bg: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', ring: 'ring-rose-500/40' },
};

export function EntryTimingCard({ ticker }: { ticker: string }) {
  const [data, setData] = useState<EntryTimingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTiming = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/maker-radar/entry-timing?ticker=${ticker}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || 'فشل حساب التوقيت');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { fetchTiming(); }, [fetchTiming]);

  if (loading) {
    return (
      <Card className="p-3">
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  if (error || !data || !data.success) {
    return (
      <Card className="p-3 border-dashed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Gauge className="h-3.5 w-3.5" />
          <span>{error || 'تعذّر حساب توقيت الدخول'}</span>
        </div>
      </Card>
    );
  }

  const colors = LABEL_COLORS[data.label_color] || LABEL_COLORS.amber;
  const breakdown = data.breakdown;
  const totalMax = 100;

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div>
            <div className="text-xs font-semibold">توقيت الدخول الذكي</div>
            <div className="text-[10px] text-muted-foreground">درجة من 0-100 بناءً على 4 عوامل</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`text-2xl font-bold ${colors.text}`}>
            {data.score}
          </div>
          <Badge className={`${colors.bg} text-white text-[10px]`}>{data.label}</Badge>
        </div>
      </div>

      {/* Score breakdown bar */}
      <div className="mb-3">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full ${colors.bg} transition-all`}
            style={{ width: `${(data.score / totalMax) * 100}%` }}
          />
        </div>
      </div>

      {/* Breakdown grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          { key: 'accumulation', icon: '🎯', b: breakdown.accumulation },
          { key: 'volume', icon: '📊', b: breakdown.volume },
          { key: 'support', icon: '📍', b: breakdown.support },
          { key: 'momentum', icon: '⚡', b: breakdown.momentum },
        ].map(({ key, icon, b }) => (
          <div key={key} className="p-2 rounded-md bg-muted/20">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span>{icon}</span>
                {b.label}
              </span>
              <span className="text-xs font-bold">
                {b.score}
                <span className="text-muted-foreground text-[9px]">/{b.max}</span>
              </span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden mb-1">
              <div
                className={`h-full ${b.score >= b.max * 0.7 ? 'bg-emerald-500' : b.score >= b.max * 0.4 ? 'bg-amber-500' : 'bg-rose-500'}`}
                style={{ width: `${(b.score / b.max) * 100}%` }}
              />
            </div>
            <div className="text-[9px] text-muted-foreground truncate">{b.detail}</div>
          </div>
        ))}
      </div>

      {/* Recommendation */}
      <div className="mt-2 p-2 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 text-[11px] text-blue-700 dark:text-blue-300 flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
        <span>{data.recommendation}</span>
      </div>
    </Card>
  );
}

// ============================================================================
// 4) LiquidityFootprintCard — بصمة السيولة (Volume Profile by Price Level)
// ============================================================================
interface FootprintData {
  success: boolean;
  ticker: string;
  days: number;
  bin_count: number;
  price_min: number;
  price_max: number;
  poc_price: number;
  poc_volume: number;
  vah_price: number;
  val_price: number;
  value_area_volume_pct: number;
  total_volume: number;
  buy_volume: number;
  sell_volume: number;
  delta_volume: number;
  buy_sell_ratio: number;
  levels: Array<{
    price_low: number;
    price_high: number;
    price_mid: number;
    volume: number;
    buy_volume: number;
    sell_volume: number;
    delta: number;
    volume_pct: number;
    is_poc: boolean;
    is_value_area: boolean;
  }>;
}

export function LiquidityFootprintCard({ ticker }: { ticker: string }) {
  const [data, setData] = useState<FootprintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFootprint = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/maker-radar/footprint?ticker=${ticker}&days=30`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || 'فشل تحميل البصمة');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { fetchFootprint(); }, [fetchFootprint]);

  if (loading) {
    return (
      <Card className="p-3">
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }

  if (error || !data || !data.success) {
    return (
      <Card className="p-3 border-dashed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          <span>{error || 'تعذّر تحميل بصمة السيولة'}</span>
        </div>
      </Card>
    );
  }

  const maxVolume = Math.max(...data.levels.map((l) => l.volume));
  const levels = [...data.levels].sort((a, b) => b.price_mid - a.price_mid); // descending by price

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          <div>
            <div className="text-xs font-semibold">بصمة السيولة</div>
            <div className="text-[10px] text-muted-foreground">توزيع الحجم على مستويات السعر · آخر {data.days} يوم</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={fetchFootprint}
          title="تحديث"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div className="p-1.5 rounded bg-purple-50 dark:bg-purple-950/20 text-center">
          <div className="text-[9px] text-muted-foreground">POC</div>
          <div className="font-bold text-purple-700 dark:text-purple-300">{data.poc_price.toFixed(2)}</div>
          <div className="text-[9px] text-muted-foreground">نقطة التحكم</div>
        </div>
        <div className="p-1.5 rounded bg-emerald-50 dark:bg-emerald-950/20 text-center">
          <div className="text-[9px] text-muted-foreground">VAH</div>
          <div className="font-bold text-emerald-700 dark:text-emerald-300">{data.vah_price.toFixed(2)}</div>
          <div className="text-[9px] text-muted-foreground">قمة منطقة القيمة</div>
        </div>
        <div className="p-1.5 rounded bg-rose-50 dark:bg-rose-950/20 text-center">
          <div className="text-[9px] text-muted-foreground">VAL</div>
          <div className="font-bold text-rose-700 dark:text-rose-300">{data.val_price.toFixed(2)}</div>
          <div className="text-[9px] text-muted-foreground">قاع منطقة القيمة</div>
        </div>
      </div>

      {/* Buy/Sell pressure */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="text-emerald-600 dark:text-emerald-400">شراء {fmtMoney(data.buy_volume)}</span>
          <span className="text-muted-foreground"> delta {data.delta_volume >= 0 ? '+' : ''}{fmtMoney(data.delta_volume)} </span>
          <span className="text-rose-600 dark:text-rose-400">بيع {fmtMoney(data.sell_volume)}</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-muted">
          <div
            className="bg-emerald-500"
            style={{ width: `${(data.buy_volume / (data.buy_volume + data.sell_volume)) * 100}%` }}
          />
          <div
            className="bg-rose-500"
            style={{ width: `${(data.sell_volume / (data.buy_volume + data.sell_volume)) * 100}%` }}
          />
        </div>
        <div className="text-[9px] text-muted-foreground text-center mt-1">
          نسبة الشراء/البيع: <span className={`font-semibold ${data.buy_sell_ratio >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{data.buy_sell_ratio.toFixed(2)}x</span>
        </div>
      </div>

      {/* Volume profile horizontal bars (top-to-bottom = high-to-low price) */}
      <div className="space-y-0.5">
        <div className="text-[10px] text-muted-foreground font-medium mb-1 flex items-center justify-between">
          <span>مستوى السعر</span>
          <span>الحجم</span>
        </div>
        <div className="max-h-56 overflow-y-auto pr-1">
          {levels.map((lvl, i) => {
            const isPoc = lvl.is_poc;
            const isInVA = lvl.is_value_area;
            return (
              <div key={i} className="flex items-center gap-1 text-[10px] py-0.5">
                <div className="w-16 text-left font-mono text-muted-foreground flex-shrink-0">
                  {lvl.price_mid.toFixed(2)}
                </div>
                <div className="flex-1 relative h-4 rounded-sm overflow-hidden bg-muted/40">
                  {/* Buy volume (right side, green) */}
                  <div
                    className="absolute right-0 top-0 h-full bg-emerald-500/70"
                    style={{ width: `${(lvl.buy_volume / maxVolume) * 100}%` }}
                  />
                  {/* Sell volume (left side, red) */}
                  <div
                    className="absolute left-0 top-0 h-full bg-rose-500/70"
                    style={{ width: `${(lvl.sell_volume / maxVolume) * 100}%` }}
                  />
                  {/* POC marker */}
                  {isPoc && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[8px] font-bold text-white drop-shadow">★ POC</span>
                    </div>
                  )}
                  {/* Value area border */}
                  {isInVA && !isPoc && (
                    <div className="absolute inset-0 border-y border-purple-500/30" />
                  )}
                </div>
                <div className="w-12 text-left font-mono text-muted-foreground flex-shrink-0">
                  {fmtMoney(lvl.volume)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 text-[9px] text-muted-foreground text-center">
        ★ = نقطة التحكم (POC) · الإطار = منطقة القيمة ({data.value_area_volume_pct.toFixed(0)}% من الحجم)
      </div>
    </Card>
  );
}

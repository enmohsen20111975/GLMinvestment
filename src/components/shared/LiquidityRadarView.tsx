'use client';

/**
 * LiquidityRadarView — رادار السيولة الصارم (4 أعمدة فقط)
 * =======================================================
 * Task: A-RADAR-V2 (Alpha — Frontend & UI Lead)
 *
 * يستهلك من /api/v2/liquidity-radar?market=EGX (Bravo engine — scripts/liquidity_radar_v2.py)
 *
 * لكل سهم صف واحد بـ 4 خلايا فقط (لا تبويبات، لا مصطلحات Wyckoff، لا إنجليزي):
 *   1. الحوت فين؟        — whale.net_flow_egp + whale.flow_strength
 *   2. حالة السوق        — market_regime.regime + change_pct
 *   3. المرحلة           — phase (بيبلع على الهادي / بيتحضر / بيصرف / بيانات غير كافية)
 *   4. مستوى الدخول والدفاع — entry_defense.entry_level + defense_level
 *
 * ثم سطر "السبب" أسفل الخلايا الأربعة (نص API كما هو — لا تعديل، لا ترجمة).
 *
 * القيود الحديدية:
 *   - Rule 4  (NO FRONTEND COMPUTATION): كل الأرقام من الـ API — تنسيق عرض فقط.
 *   - Rule 27 (NO-FAKE-DATA): لو الـ API فشل أو فارغ → حالة صادقة (لا بيانات وهمية).
 *   - Rule 30 (CLIENT-FACING-STYLE): زمردي / تركوازي / أمبر / أحمر / رمادي — لا أزرق/إنديغو.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Fish, Droplet, Activity, TrendingUp, TrendingDown, Minus,
  Shield, Target, RefreshCw, AlertTriangle, Search, ChevronDown,
  Layers, Gauge, Wallet,
} from 'lucide-react';

// ============================================================================
// Types — مطابقة 100% لـ API
// ============================================================================

interface WhaleInfo {
  net_flow_egp: number | null;
  avg_daily_flow_egp: number | null;
  whale_present: boolean | null;
  flow_strength: string | null;
  reason?: string | null;
}

interface MarketRegime {
  regime: string | null;          // صاعد / هابط / عرضي / Risk-Off
  regime_en?: string | null;      // bull / bear / sideways / risk_off
  change_pct: number | null;
  index_symbol?: string | null;
  reason?: string | null;
  is_bear?: boolean | null;
  is_bull?: boolean | null;
}

interface EntryDefense {
  entry_level: number | null;
  defense_level: number | null;
  resistance_level?: number | null;
  reason?: string | null;
}

interface RadarStock {
  ticker: string;
  name?: string | null;
  market?: string | null;
  sector?: string | number | null;
  whale: WhaleInfo;
  market_regime: MarketRegime;
  phase: string;                  // بيبلع على الهادي / بيتحضر / بيصرف / بيانات غير كافية
  phase_reason?: string | null;
  entry_defense: EntryDefense;
  reason: string | null;
}

interface RadarResponse {
  success: boolean;
  market: string;
  market_regime: MarketRegime | null;
  scanned_count?: number;
  phases_breakdown?: Record<string, number>;
  generated_at?: string;
  stocks: RadarStock[];
  error?: string | null;
  message?: string | null;
}

interface LiquidityRadarViewProps {
  market: string; // 'EGX' | 'TADAWUL' | 'KSE' | 'QSE'
}

// ============================================================================
// Format helpers (Display only — Rule 4: no financial computation)
// ============================================================================

/** تنسيق صافي التدفق النقدي للقيمة المطلقة (B / M / K) مع إشارة. */
function fmtFlowEgp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

/** تنسيق نسبة التغيّر بالمئوية مع إشارة. */
function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

/** تنسيق سعر (دخول/دفاع/مقاومة). */
function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}

// ============================================================================
// Color maps (Rule 30: emerald/teal/amber/red/gray — NO blue/indigo)
// ============================================================================

const PHASE_STYLE: Record<string, { cell: string; badge: string; label: string }> = {
  'بيبلع على الهادي': {
    cell: 'bg-emerald-500/10 border-emerald-500/30 dark:bg-primary-container/20 dark:border-primary/30',
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 dark:bg-primary-container/20 dark:text-primary dark:border-primary/30',
    label: 'text-emerald-700 dark:text-emerald-300 dark:text-primary',
  },
  'بيتحضر': {
    cell: 'bg-teal-500/10 border-teal-500/30 dark:bg-secondary/20 dark:border-secondary/30',
    badge: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30 dark:bg-secondary/20 dark:text-secondary dark:border-secondary/30',
    label: 'text-teal-700 dark:text-teal-300 dark:text-secondary',
  },
  'بيصرف': {
    cell: 'bg-red-500/10 border-red-500/30 dark:bg-error-container/20 dark:border-error/30',
    badge: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30 dark:bg-error-container/20 dark:text-error dark:border-error/30',
    label: 'text-red-700 dark:text-red-300 dark:text-error',
  },
  'بيانات غير كافية': {
    cell: 'bg-muted border-border dark:bg-surface-container dark:border-outline-variant/30',
    badge: 'bg-muted text-muted-foreground border-border dark:bg-surface-container dark:text-on-surface-variant dark:border-outline-variant/30',
    label: 'text-muted-foreground dark:text-on-surface-variant',
  },
};

function phaseStyle(phase: string | null | undefined) {
  if (!phase) return PHASE_STYLE['بيانات غير كافية'];
  return PHASE_STYLE[phase] || PHASE_STYLE['بيانات غير كافية'];
}

/** خريطة ألوان حالة السوق. */
function regimeStyle(regime: string | null | undefined): {
  banner: string;
  badge: string;
  icon: 'bull' | 'bear' | 'sideways' | 'riskoff';
} {
  if (!regime) return {
    banner: 'bg-muted border-border dark:bg-surface-container-low dark:border-outline-variant/30',
    badge: 'bg-muted text-muted-foreground border-border dark:bg-surface-container dark:text-on-surface-variant dark:border-outline-variant/30',
    icon: 'sideways',
  };
  if (regime === 'صاعد') return {
    banner: 'bg-emerald-500/10 border-emerald-500/30 dark:bg-primary-container/20 dark:border-primary/30',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 dark:bg-primary-container/20 dark:text-primary dark:border-primary/30',
    icon: 'bull',
  };
  if (regime === 'هابط' || regime === 'Risk-Off') return {
    banner: 'bg-red-500/10 border-red-500/30 dark:bg-error-container/20 dark:border-error/30',
    badge: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30 dark:bg-error-container/20 dark:text-error dark:border-error/30',
    icon: regime === 'Risk-Off' ? 'riskoff' : 'bear',
  };
  // عرضي
  return {
    banner: 'bg-amber-500/10 border-amber-500/30 dark:bg-surface-container-low dark:border-outline-variant/30',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 dark:text-secondary',
    icon: 'sideways',
  };
}

/** خريطة ألوان خلية الحوت. */
function whaleStyle(whale: WhaleInfo | null | undefined): {
  cell: string;
  text: string;
  icon: React.ReactNode;
} {
  if (!whale || whale.net_flow_egp == null || !Number.isFinite(Number(whale.net_flow_egp)) || Number(whale.net_flow_egp) === 0) {
    return {
      cell: 'bg-muted border-border dark:bg-surface-container dark:border-outline-variant/30',
      text: 'text-muted-foreground dark:text-on-surface-variant',
      icon: <Activity className="w-3.5 h-3.5" />,
    };
  }
  const flow = Number(whale.net_flow_egp);
  if (whale.whale_present === true) {
    return {
      cell: 'bg-emerald-500/10 border-emerald-500/30 dark:bg-primary-container/20 dark:border-primary/30',
      text: 'text-emerald-700 dark:text-emerald-300 dark:text-primary',
      icon: <Fish className="w-3.5 h-3.5" />,
    };
  }
  if (flow < 0) {
    return {
      cell: 'bg-red-500/10 border-red-500/30 dark:bg-error-container/20 dark:border-error/30',
      text: 'text-red-700 dark:text-red-300 dark:text-error',
      icon: <Droplet className="w-3.5 h-3.5" />,
    };
  }
  // موجب ضعيف أو غير مصنف
  return {
    cell: 'bg-amber-500/10 border-amber-500/30 dark:bg-surface-container-low dark:border-outline-variant/30',
    text: 'text-amber-700 dark:text-amber-300 dark:text-secondary',
    icon: <Droplet className="w-3.5 h-3.5" />,
  };
}

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZE = 50;

const PHASE_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'بيبلع على الهادي', label: 'بيبلع على الهادي' },
  { key: 'بيتحضر', label: 'بيتحضر' },
  { key: 'بيصرف', label: 'بيصرف' },
  { key: 'بيانات غير كافية', label: 'بيانات غير كافية' },
];

// ============================================================================
// Main Component
// ============================================================================

export function LiquidityRadarView({ market }: LiquidityRadarViewProps) {
  const [data, setData] = useState<RadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  // ------------------------------------------------------------------
  // Fetch
  // ------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v2/liquidity-radar?market=${encodeURIComponent(market)}`,
        { cache: 'no-store' }
      );
      // BOX-2 Phase 2: Graceful 503 fallback — detect offline/warming_up explicitly
      // to prevent "Uncaught in promise" + show actionable Retry/Offline banner.
      if (!res.ok) {
        // Try to parse the error body gracefully (503 may carry warming_up flag).
        let errBody: Partial<RadarResponse> | null = null;
        try { errBody = await res.json(); } catch { /* non-JSON body */ }
        if (res.status === 503) {
          setError(errBody?.message || 'محرك رادار السيولة غير متاح حالياً (أوفلاين). اضغط إعادة المحاولة.');
        } else {
          setError(errBody?.message || errBody?.error || `تعذّر الاتصال بالخادم (${res.status})`);
        }
        setData(null);
        return;
      }
      const json: RadarResponse = await res.json();
      if (!json.success) {
        setError(json.message || json.error || 'فشل تشغيل محرّك رادار السيولة');
        setData(json); // نبقى نملك الـ payload عشان نعرض الحالة الصادقة
        return;
      }
      setData(json);
    } catch (e) {
      // BOX-2 Phase 2: never let fetch rejection (network error) crash the UI.
      setError(e instanceof Error ? `تعذّر الاتصال: ${e.message}` : 'تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // إعادة ضبط عدّاد العرض عند تغيير الفلتر/البحث/السوق
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [phaseFilter, searchTerm, market]);

  // ------------------------------------------------------------------
  // Sorted + filtered list (Display logic only — no financial computation)
  // ------------------------------------------------------------------
  const allStocks = data?.stocks ?? [];

  const sortedStocks = useMemo(() => {
    // ترتيب تنازلي حسب صافي التدفق (الأكبر أولاً) — Rule 4: القيمة من API
    const sorted = [...allStocks].sort((a, b) => {
      const va = Number(a?.whale?.net_flow_egp ?? 0);
      const vb = Number(b?.whale?.net_flow_egp ?? 0);
      return vb - va;
    });
    return sorted;
  }, [allStocks]);

  const filteredStocks = useMemo(() => {
    let list = sortedStocks;
    if (phaseFilter !== 'all') {
      list = list.filter((s) => s.phase === phaseFilter);
    }
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          (s.ticker || '').toLowerCase().includes(q) ||
          (s.name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [sortedStocks, phaseFilter, searchTerm]);

  const visibleStocks = filteredStocks.slice(0, visibleCount);
  const hasMore = filteredStocks.length > visibleCount;

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <div className="space-y-3" dir="rtl">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Error state (Rule 27 — honest empty state)
  // ------------------------------------------------------------------
  if (error && (!data || !data.stocks || data.stocks.length === 0)) {
    return (
      <Card dir="rtl" className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
        <CardContent className="p-6 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto dark:text-secondary" />
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 dark:text-secondary">
            {error || 'تعذّر جلب بيانات الرادار'}
          </p>
          <p className="text-xs text-muted-foreground dark:text-on-surface-variant">
            محرّك رادار السيولة غير متاح حالياً — لا توجد بيانات وهمية.
          </p>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ------------------------------------------------------------------
  // Main render
  // ------------------------------------------------------------------
  const regime = data?.market_regime ?? null;
  const rStyle = regimeStyle(regime?.regime);
  const phasesBreakdown = data?.phases_breakdown ?? {};
  const scannedCount = data?.scanned_count ?? 0;

  return (
    <div className="space-y-4" dir="rtl">
      {/* ---------------------------------------------------------------- */}
      {/* 1. Market Regime Banner                                          */}
      {/* ---------------------------------------------------------------- */}
      <Card className={cn('border', rStyle.banner, 'dark:bg-surface-container-low dark:border dark:border-outline-variant/30')}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                rStyle.banner,
                'dark:bg-surface-container dark:border dark:border-outline-variant/30'
              )}>
                {rStyle.icon === 'bull' && <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400 dark:text-primary" />}
                {rStyle.icon === 'bear' && <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400 dark:text-error" />}
                {rStyle.icon === 'riskoff' && <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 dark:text-error" />}
                {rStyle.icon === 'sideways' && <Minus className="w-5 h-5 text-amber-600 dark:text-amber-400 dark:text-secondary" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground dark:text-on-surface-variant">حالة سوق</span>
                  <span className="text-sm font-bold dark:text-on-surface dark:font-outfit">{market}</span>
                  <Badge variant="outline" className={cn('text-[10px]', rStyle.badge)}>
                    {regime?.regime || '—'}
                  </Badge>
                  {regime?.index_symbol && (
                    <span className="text-[10px] text-muted-foreground dark:text-on-surface-variant">
                      ({regime.index_symbol})
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1 text-muted-foreground leading-relaxed dark:text-on-surface-variant">
                  {regime?.reason || 'لا يوجد وصف لحالة السوق'}
                </p>
              </div>
            </div>
            <div className="text-left shrink-0">
              <p className="text-[10px] text-muted-foreground dark:text-on-surface-variant">تغيّر المؤشر</p>
              <p className={cn(
                'text-lg font-bold font-mono tabular-nums dark:font-financial',
                (regime?.change_pct ?? 0) > 0
                  ? 'text-emerald-600 dark:text-emerald-400 dark:text-primary'
                  : (regime?.change_pct ?? 0) < 0
                  ? 'text-red-600 dark:text-red-400 dark:text-error'
                  : 'text-amber-600 dark:text-amber-400 dark:text-secondary'
              )}>
                {fmtPct(regime?.change_pct)}
              </p>
            </div>
          </div>

          {/* تحذير صريح في حالة Risk-Off أو هابط */}
          {(regime?.is_bear || regime?.regime === 'Risk-Off' || regime?.regime === 'هابط') && (
            <div className="mt-3 flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 p-2 dark:bg-error-container/20 dark:border-error/30">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 dark:text-error shrink-0 mt-px" />
              <p className="text-[11px] text-red-700 dark:text-red-300 dark:text-error leading-relaxed">
                السوق حالياً في وضع هابط — لا توجد فرص تجميع صحيحة. التزم بالدفاع ووقف الخسارة.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* 2. Stats strip + Phase filter chips + Search                    */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-3">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border bg-card p-2.5 dark:bg-surface-container-low dark:border-outline-variant/30">
            <p className="text-[10px] text-muted-foreground dark:text-on-surface-variant">إجمالي الممسوح</p>
            <p className="text-base font-bold tabular-nums dark:text-on-surface dark:font-financial">{scannedCount}</p>
          </div>
          <div className="rounded-lg border bg-emerald-500/5 p-2.5 dark:bg-primary-container/10 dark:border-outline-variant/30">
            <p className="text-[10px] text-muted-foreground dark:text-on-surface-variant">بيبلع على الهادي</p>
            <p className="text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums dark:font-financial dark:text-primary">
              {phasesBreakdown['بيبلع على الهادي'] ?? 0}
            </p>
          </div>
          <div className="rounded-lg border bg-teal-500/5 p-2.5 dark:bg-secondary/10 dark:border-outline-variant/30">
            <p className="text-[10px] text-muted-foreground dark:text-on-surface-variant">بيتحضر</p>
            <p className="text-base font-bold text-teal-700 dark:text-teal-400 tabular-nums dark:font-financial dark:text-secondary">
              {phasesBreakdown['بيتحضر'] ?? 0}
            </p>
          </div>
          <div className="rounded-lg border bg-red-500/5 p-2.5 dark:bg-error-container/10 dark:border-outline-variant/30">
            <p className="text-[10px] text-muted-foreground dark:text-on-surface-variant">بيصرف</p>
            <p className="text-base font-bold text-red-700 dark:text-red-400 tabular-nums dark:font-financial dark:text-error">
              {phasesBreakdown['بيصرف'] ?? 0}
            </p>
          </div>
        </div>

        {/* Phase chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {PHASE_FILTERS.map((pf) => {
            const active = phaseFilter === pf.key;
            const count =
              pf.key === 'all'
                ? allStocks.length
                : allStocks.filter((s) => s.phase === pf.key).length;
            return (
              <button
                key={pf.key}
                type="button"
                onClick={() => setPhaseFilter(pf.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors dark:border-outline-variant/30',
                  active
                    ? 'bg-foreground text-background border-foreground dark:bg-primary-container dark:text-on-primary-container dark:border-primary-container'
                    : 'bg-card text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground dark:bg-surface-container dark:text-on-surface-variant dark:border-outline-variant/30 dark:hover:bg-surface-container-high dark:hover:text-on-surface'
                )}
              >
                {pf.label}
                <span className={cn(
                  'text-[9px] rounded-full px-1.5 py-px',
                  active ? 'bg-background/20 dark:bg-on-primary-container/20' : 'bg-muted dark:bg-surface-container-high'
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search + refresh row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-muted-foreground dark:text-on-surface-variant absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث برمز السهم أو الاسم…"
              className="h-8 pr-8 text-xs dark:bg-surface-container dark:text-on-surface dark:border-outline-variant"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={fetchData} className="gap-1.5 h-8 text-xs shrink-0">
            <RefreshCw className="w-3 h-3" /> تحديث
          </Button>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 3. Stocks list (each stock = ONE row with 4 cells)              */}
      {/* ---------------------------------------------------------------- */}
      {filteredStocks.length === 0 ? (
        <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <CardContent className="p-6 text-center space-y-2">
            <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto dark:text-on-surface-variant/40" />
            <p className="text-sm font-semibold text-muted-foreground dark:text-on-surface">لا توجد بيانات</p>
            <p className="text-xs text-muted-foreground dark:text-on-surface-variant">
              لا توجد أسهم مطابقة لهذا الفلتر في سوق {market}. (Rule 27: لا بيانات وهمية)
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="text-[11px] text-muted-foreground flex items-center justify-between flex-wrap gap-1 dark:text-on-surface-variant">
            <span>
              عرض {visibleStocks.length} من {filteredStocks.length} سهم
              {phaseFilter !== 'all' && <span className="ml-1">· مُصفّى: {PHASE_FILTERS.find(p => p.key === phaseFilter)?.label}</span>}
            </span>
            <span className="text-[10px]">مرتّب تنازلياً حسب صافي التدفق</span>
          </div>

          <div className="space-y-2.5">
            {visibleStocks.map((stock) => (
              <StockRow key={`${market}-${stock.ticker}`} stock={stock} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="gap-1.5"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                عرض المزيد
                <span className="text-[10px] text-muted-foreground dark:text-on-surface-variant">
                  (+{Math.min(PAGE_SIZE, filteredStocks.length - visibleCount)})
                </span>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// StockRow — صف واحد لكل سهم (4 خلايا + سطر السبب)
// ============================================================================

function StockRow({ stock }: { stock: RadarStock }) {
  const w = whaleStyle(stock.whale);
  const ps = phaseStyle(stock.phase);
  const localRegime = regimeStyle(stock.market_regime?.regime);

  // اسم السهم الوصفي — نعرض الـ ticker دائماً + الاسم إذا كان متاحاً وغير مكرر
  const displayName = stock.name && stock.name !== stock.ticker && stock.name !== stock.market
    ? stock.name
    : null;

  // sector قد يأتي رقم (خطأ backend) — نعرضه فقط لو نصّي صحيح
  const sectorText = typeof stock.sector === 'string' && stock.sector.trim().length > 0
    ? stock.sector
    : null;

  return (
    <Card className="overflow-hidden hover:border-emerald-500/30 transition-colors dark:bg-surface-container-low dark:border dark:border-outline-variant/30 dark:hover:border-primary/30">
      <CardContent className="p-3 space-y-2.5">
        {/* Header: ticker + name + sector + phase badge */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm dark:text-on-surface dark:font-outfit">{stock.ticker}</span>
              <Badge variant="outline" className={cn('text-[9px]', ps.badge)}>
                {stock.phase}
              </Badge>
              {sectorText && (
                <span className="text-[10px] text-muted-foreground dark:text-on-surface-variant">{sectorText}</span>
              )}
            </div>
            {displayName && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate dark:text-on-surface-variant">{displayName}</p>
            )}
          </div>
        </div>

        {/* 4 cells: mobile=1col, sm=2col, lg=4col */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {/* Cell 1: الحوت فين؟ */}
          <div className={cn('rounded-lg border p-2.5', w.cell)}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={w.text}>{w.icon}</span>
              <span className="text-[10px] text-muted-foreground dark:text-on-surface-variant">الحوت فين؟</span>
            </div>
            <p className={cn('text-sm font-bold font-mono tabular-nums dark:font-financial', w.text)}>
              {fmtFlowEgp(stock.whale?.net_flow_egp)}
              <span className="text-[9px] font-normal mr-1 opacity-70">EGP</span>
            </p>
            <p className={cn('text-[10px] mt-0.5 leading-tight', w.text)}>
              {stock.whale?.flow_strength || '—'}
            </p>
          </div>

          {/* Cell 2: حالة السوق */}
          <div className={cn('rounded-lg border p-2.5', localRegime.banner)}>
            <div className="flex items-center gap-1.5 mb-1">
              {localRegime.icon === 'bull' && <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 dark:text-primary" />}
              {localRegime.icon === 'bear' && <TrendingDown className="w-3.5 h-3.5 text-red-600 dark:text-red-400 dark:text-error" />}
              {localRegime.icon === 'riskoff' && <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 dark:text-error" />}
              {localRegime.icon === 'sideways' && <Minus className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 dark:text-secondary" />}
              <span className="text-[10px] text-muted-foreground dark:text-on-surface-variant">حالة السوق</span>
            </div>
            <p className={cn('text-sm font-bold', localRegime.badge.split(' ').filter(c => c.startsWith('text-')).join(' '))}>
              {stock.market_regime?.regime || '—'}
            </p>
            <p className="text-[10px] mt-0.5 text-muted-foreground font-mono tabular-nums dark:text-on-surface-variant dark:font-financial">
              {fmtPct(stock.market_regime?.change_pct)}
              {stock.market_regime?.index_symbol && (
                <span className="opacity-70 mr-1">· {stock.market_regime.index_symbol}</span>
              )}
            </p>
          </div>

          {/* Cell 3: المرحلة */}
          <div className={cn('rounded-lg border p-2.5', ps.cell)}>
            <div className="flex items-center gap-1.5 mb-1">
              <Layers className="w-3.5 h-3.5 text-muted-foreground dark:text-on-surface-variant" />
              <span className="text-[10px] text-muted-foreground dark:text-on-surface-variant">المرحلة</span>
            </div>
            <p className={cn('text-sm font-bold leading-tight', ps.label)}>
              {stock.phase || '—'}
            </p>
            {stock.phase_reason && (
              <p className="text-[10px] mt-0.5 text-muted-foreground leading-tight truncate dark:text-on-surface-variant" title={stock.phase_reason}>
                {stock.phase_reason}
              </p>
            )}
          </div>

          {/* Cell 4: مستوى الدخول والدفاع */}
          <div className={cn(
            'rounded-lg border p-2.5',
            stock.entry_defense?.entry_level == null
              ? 'bg-muted border-border dark:bg-surface-container dark:border-outline-variant/30'
              : 'bg-emerald-500/5 border-emerald-500/20 dark:bg-primary-container/10 dark:border-primary/30'
          )}>
            <div className="flex items-center gap-1.5 mb-1">
              <Shield className="w-3.5 h-3.5 text-muted-foreground dark:text-on-surface-variant" />
              <span className="text-[10px] text-muted-foreground dark:text-on-surface-variant">الدخول والدفاع</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <p className="text-[9px] text-muted-foreground flex items-center gap-0.5 dark:text-on-surface-variant">
                  <Target className="w-2.5 h-2.5" /> دخول
                </p>
                <p className={cn(
                  'text-sm font-mono font-semibold tabular-nums dark:font-financial',
                  stock.entry_defense?.entry_level == null
                    ? 'text-muted-foreground dark:text-on-surface-variant'
                    : 'text-emerald-700 dark:text-emerald-400 dark:text-primary'
                )}>
                  {fmtPrice(stock.entry_defense?.entry_level)}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground flex items-center gap-0.5 dark:text-on-surface-variant">
                  <Shield className="w-2.5 h-2.5" /> دفاع
                </p>
                <p className={cn(
                  'text-sm font-mono font-semibold tabular-nums dark:font-financial',
                  stock.entry_defense?.defense_level == null
                    ? 'text-muted-foreground dark:text-on-surface-variant'
                    : 'text-red-600 dark:text-red-400 dark:text-error'
                )}>
                  {fmtPrice(stock.entry_defense?.defense_level)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Reason line — API text as-is, no edit/translate (Rule: do NOT edit) */}
        {stock.reason && (
          <div className="flex items-start gap-1.5 rounded-md bg-muted/40 border border-border px-2 py-1.5 dark:bg-surface-container dark:border-outline-variant/30">
            <Gauge className="w-3 h-3 text-muted-foreground shrink-0 mt-px dark:text-on-surface-variant" />
            <p className="text-[11px] text-muted-foreground leading-relaxed flex-1 dark:text-on-surface-variant">
              {stock.reason}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default LiquidityRadarView;

'use client';

// ============================================================================
// ExitRadarTab — رادار الخروج (Exit Radar)
// ============================================================================
// L2-ALERTS-EXIT-RADAR: detects distribution/exit signals — the inverse of
// the maker radar. Helps the user know when to SELL.
//
// 5 exit paths (X1-X5):
//   🔴 X1_distribution_strong   → strong distribution (institutional selling)
//   ⚠️ X2_volume_divergence     → price up but volume declining (fake rally)
//   🚫 X3_resistance_rejection  → rejected at key resistance
//   😮 X4_exhaustion_gap        → exhaustion gap after long rally
//   🛑 X5_kill_switch_triggered → kill switch triggered (limit up trap, etc.)
//
// Data source:
//   GET /api/maker-radar/exit-radar?market=EGX
//   → reads scripts/output/exit_radar_<date>.json (instant <50ms, cached)
//   → triggers background warmup if stale
//
// The component is RTL Arabic, shadcn-based. Each exit path renders as a
// collapsible section with a UnifiedTable of stocks (ticker, price, volume
// ratio, reason, suggested action). All client-side — no SSR.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, AlertTriangle, TrendingDown, TrendingUp,
  Activity, Eye, EyeOff, ChevronDown, Lock,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { useAppStore } from '@/lib/store';
import { getTrialStatus } from '@/lib/subscription-gate';
import { useTranslation } from '@/lib/i18n-context';
import type { MarketType } from '@/lib/store';

// ============================================================================
// Types — Exit Radar API contract
// ============================================================================
interface ExitRadarEntry {
  ticker: string;
  current_price: number;
  avg_volume_20d?: number;
  volume_ratio_today?: number;
  rally_5d_pct?: number | null;
  path: string;
  reason: string;
  all_paths?: string[];
  path_details?: Array<{ path: string; reason: string }>;
}

interface ExitRadarResponse {
  success: boolean;
  cached?: boolean;
  cache_age_seconds?: number | null;
  cache_stale?: boolean;
  warmup_running?: boolean;
  cache_generated_at?: string | null;
  market?: string;
  db_source?: string | null;
  total_scanned?: number;
  exit_count?: number;
  x1_distribution_strong_count?: number;
  x2_volume_divergence_count?: number;
  x3_resistance_rejection_count?: number;
  x4_exhaustion_gap_count?: number;
  x5_kill_switch_triggered_count?: number;
  exit_list?: ExitRadarEntry[];
  x1_distribution_strong?: ExitRadarEntry[];
  x2_volume_divergence?: ExitRadarEntry[];
  x3_resistance_rejection?: ExitRadarEntry[];
  x4_exhaustion_gap?: ExitRadarEntry[];
  x5_kill_switch_triggered?: ExitRadarEntry[];
  warming_up?: boolean;
  error?: string;
  warning?: string;
}

interface ExitRadarTabProps {
  market: MarketType | string;
}

// ============================================================================
// Exit path metadata — labels, colors, suggested actions
// ============================================================================
// Each entry maps a path to its translation key suffix (e.g. 'x1' → radar.exit.paths.x1.*).
const EXIT_PATHS = [
  {
    key: 'x1_distribution_strong',
    tKey: 'x1',
    pathValue: 'X1_distribution_strong',
    icon: '🔴',
    color: 'text-loss dark:text-loss',
    bg: 'bg-loss dark:bg-loss/30',
    border: 'border-loss dark:border-loss',
    badge: 'bg-loss text-loss dark:bg-loss/40 dark:text-loss',
  },
  {
    key: 'x2_volume_divergence',
    tKey: 'x2',
    pathValue: 'X2_volume_divergence',
    icon: '⚠️',
    color: 'text-warning dark:text-warning',
    bg: 'bg-warning dark:bg-warning/30',
    border: 'border-warning dark:border-warning',
    badge: 'bg-warning text-warning dark:bg-warning/40 dark:text-warning',
  },
  {
    key: 'x3_resistance_rejection',
    tKey: 'x3',
    pathValue: 'X3_resistance_rejection',
    icon: '🚫',
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    border: 'border-orange-200 dark:border-orange-900',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  },
  {
    key: 'x4_exhaustion_gap',
    tKey: 'x4',
    pathValue: 'X4_exhaustion_gap',
    icon: '😮',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    border: 'border-purple-200 dark:border-purple-900',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  },
  {
    key: 'x5_kill_switch_triggered',
    tKey: 'x5',
    pathValue: 'X5_kill_switch_triggered',
    icon: '🛑',
    color: 'text-loss dark:text-loss',
    bg: 'bg-loss dark:bg-loss/30',
    border: 'border-loss dark:border-loss',
    badge: 'bg-loss text-loss dark:bg-loss/40 dark:text-loss',
  },
] as const;

// ============================================================================
// Helpers
// ============================================================================
function fmtVolRatio(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${(n ?? 0).toFixed(2)}×`;
}

function fmtPrice(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—';
  return (n ?? 0).toFixed(2);
}

function fmtPct(n?: number | null, withSign = true): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${(n ?? 0).toFixed(1)}%`;
}

// ============================================================================
// ExitRadarTab — main component
// ============================================================================
export function ExitRadarTab({ market }: ExitRadarTabProps) {
  const t = useTranslation();
  const [data, setData] = useState<ExitRadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warmingUp, setWarmingUp] = useState(false);
  // Track which collapsible sections are open (default: all open if they have data)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    x1_distribution_strong: true,
    x2_volume_divergence: true,
    x3_resistance_rejection: true,
    x4_exhaustion_gap: true,
    x5_kill_switch_triggered: true,
  });

  // PAYWALL Gate 2: Exit Radar locked for free users post-trial
  const subscriptionUser = useAppStore((s) => s.user);
  const exitRadarSubStatus = getTrialStatus(subscriptionUser);
  const exitRadarLocked = exitRadarSubStatus.isFreeUser && exitRadarSubStatus.isTrialExpired;

  // The exit radar should respect the same market convention as the maker
  // radar — CRYPTO / GOLD fallback to EGX (the script doesn't have dedicated
  // crypto/gold tables; it uses the same fallback chain).
  const effectiveMarket = market === 'CRYPTO' || market === 'GOLD' ? 'EGX' : market;

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/maker-radar/exit-radar?market=${encodeURIComponent(effectiveMarket)}`,
        { cache: 'no-store' },
      );
      const json: ExitRadarResponse = await res.json();
      if (json.success) {
        setData(json);
        setWarmingUp(false);
      } else if (json.warming_up) {
        setWarmingUp(true);
        setData(null);
        // Retry in 15s — the background warmup should finish quickly.
        setTimeout(() => fetchData(false), 15_000);
      } else {
        setError(json.error || t('radar.exit.loadFailed'));
        setData(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('radar.exit.connectionError'));
      setData(null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [effectiveMarket]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Poll every 60s when the tab is visible — same pattern as MakerRadarTab.
  useVisibilityAwarePolling(fetchData, 60_000);

  const handleRefresh = async () => {
    // Trigger a synchronous warmup via POST, then re-fetch.
    try {
      await fetch(
        `/api/maker-radar/exit-radar?market=${encodeURIComponent(effectiveMarket)}`,
        { method: 'POST' },
      );
    } catch {
      // ignore — best-effort
    }
    fetchData();
  };

  // ============================================================================
  // PAYWALL Gate 2: lock screen for free users post-trial — teaser "3 stocks approaching exit"
  // ============================================================================
  if (exitRadarLocked) {
    return (
      <Card className="p-6 border-warning/40 bg-warning/50 dark:bg-warning/20" dir="rtl">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-warning dark:bg-warning/40 flex items-center justify-center">
            <Lock className="h-6 w-6 text-warning dark:text-warning" />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-1 flex items-center justify-center gap-2">
              {t('radar.exit.lock.title')}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t('radar.exit.lock.body')}
              <span className="block mt-1 font-medium text-warning dark:text-warning">
                {t('radar.exit.lock.teaser')}
              </span>
            </p>
          </div>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/pricing';
              }
            }}
          >
            {t('radar.exit.lock.cta')}
          </Button>
        </div>
      </Card>
    );
  }

  // ============================================================================
  // Loading state
  // ============================================================================
  if (loading && !data) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-loss dark:text-loss animate-pulse" />
            <h3 className="text-base font-semibold">{t('radar.exit.title')}</h3>
          </div>
          <Skeleton className="h-6 w-32" />
        </div>
        <Skeleton className="h-8 w-full mb-2" />
        <Skeleton className="h-8 w-full mb-2" />
        <Skeleton className="h-8 w-full mb-2" />
        <Skeleton className="h-8 w-full" />
      </Card>
    );
  }

  // ============================================================================
  // Warming-up state (first request — cache being populated)
  // ============================================================================
  if (warmingUp && !data) {
    return (
      <Card className="p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-loss dark:bg-loss/40 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-loss dark:text-loss animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-1">{t('radar.exit.loading')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('radar.exit.warmingUp')}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // ============================================================================
  // Error state
  // ============================================================================
  if (error && !data) {
    return (
      <Card className="p-4 border-dashed border-loss dark:border-loss">
        <div className="flex items-center gap-2 text-sm text-loss dark:text-loss">
          <AlertTriangle className="h-4 w-4" />
          <span>{t('radar.exit.errorPrefix', { error })}</span>
        </div>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchData()}>
          <RefreshCw className="h-4 w-4 ml-2" />
          {t('radar.exit.retry')}
        </Button>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  // ============================================================================
  // Empty state — exit radar ran but found no exit signals (good news!)
  // ============================================================================
  const hasAnySignals = (data.exit_count ?? 0) > 0;
  const cacheAgeSec = data.cache_age_seconds ?? null;
  const cacheAgeLabel =
    cacheAgeSec == null
      ? t('radar.exit.cacheAge.unknown')
      : cacheAgeSec < 60
        ? t('radar.exit.cacheAge.seconds', { count: cacheAgeSec })
        : cacheAgeSec < 3600
          ? t('radar.exit.cacheAge.minutes', { count: Math.round(cacheAgeSec / 60) })
          : t('radar.exit.cacheAge.hours', { count: Math.round(cacheAgeSec / 3600) });

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <div className="space-y-4">
      {/* Header — stats summary */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-loss dark:text-loss" />
            <div>
              <h3 className="text-base font-semibold">{t('radar.exit.titleWithEmoji')}</h3>
              <p className="text-[11px] text-muted-foreground">
                {t('radar.exit.subtitle', { cacheAge: cacheAgeLabel })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[11px]">
              {t('radar.exit.marketLabel')} {effectiveMarket}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {t('radar.exit.scannedLabel')} {data.total_scanned ?? 0}
            </Badge>
            <Badge
              variant="outline"
              className={
                hasAnySignals
                  ? 'text-[11px] bg-loss dark:bg-loss/30 text-loss dark:text-loss'
                  : 'text-[11px] bg-profit dark:bg-profit/30 text-profit dark:text-profit'
              }
            >
              {hasAnySignals
                ? t('radar.exit.exitCount', { count: data.exit_count ?? 0 })
                : t('radar.exit.noSignals')}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ml-1 ${loading ? 'animate-spin' : ''}`} />
              {t('radar.exit.refresh')}
            </Button>
          </div>
        </div>
        {data.warning && (
          <div className="mt-3 text-xs text-warning dark:text-warning bg-warning dark:bg-warning/30 p-2 rounded">
            ⚠️ {data.warning}
          </div>
        )}
      </Card>

      {/* 5 exit path sections — collapsible */}
      {!hasAnySignals && (
        <Card className="p-8 text-center border-profit dark:border-profit bg-profit/50 dark:bg-profit/20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-profit dark:bg-profit/40 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-profit dark:text-profit" />
            </div>
            <div>
              <h3 className="text-base font-semibold mb-1">{t('radar.exit.empty.title')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('radar.exit.empty.body')}
              </p>
            </div>
          </div>
        </Card>
      )}

      {EXIT_PATHS.map((p) => {
        const list = (data[p.key as keyof ExitRadarResponse] as ExitRadarEntry[]) ?? [];
        const count = list.length;
        const isOpen = openSections[p.key] && count > 0;
        if (count === 0) return null;
        return (
          <Collapsible
            key={p.key}
            open={isOpen}
            onOpenChange={(open) =>
              setOpenSections((s) => ({ ...s, [p.key]: open }))
            }
          >
            <Card className={`p-0 overflow-hidden border ${p.border} ${p.bg}`}>
              <CollapsibleTrigger asChild>
                <button
                  className="w-full p-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{p.icon}</span>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${p.color}`}>{t(`radar.exit.paths.${p.tKey}.label`)}</div>
                      <div className="text-[10px] text-muted-foreground">{t(`radar.exit.paths.${p.tKey}.desc`)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${p.badge}`}>{count} {t('radar.exit.stocksCount')}</Badge>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border/50 p-3">
                  <div className={`text-xs mb-3 p-2 rounded ${p.bg} ${p.color}`}>
                    <strong>{t('radar.exit.suggestedAction')}</strong> {t(`radar.exit.paths.${p.tKey}.action`)}
                  </div>
                  <ExitPathTable entries={list} />
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}

      {/* Footer — explanatory note */}
      <Card className="p-3 bg-muted/30">
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">{t('radar.exit.footer.title')}</strong>
          <br />
          {t('radar.exit.footer.body')}{' '}
          <code className="text-foreground">scripts/exit_radar.py</code> —
          Python is brain (Rule 32).
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// ExitPathTable — table of stocks for a single exit path
// ============================================================================
interface ExitPathTableProps {
  entries: ExitRadarEntry[];
}

function ExitPathTable({ entries }: ExitPathTableProps) {
  const t = useTranslation();
  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'ticker',
      header: t('radar.exit.table.ticker'),
      headerAr: t('radar.exit.table.ticker'),
      sortable: true,
      width: 'min-w-[100px]',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm">{String(row.ticker || '')}</span>
        </div>
      ),
    },
    {
      key: 'current_price',
      header: t('radar.exit.table.price'),
      headerAr: t('radar.exit.table.price'),
      sortable: true,
      align: 'center',
      width: 'w-20',
      render: (row) => (
        <span className="font-mono text-xs">{fmtPrice(row.current_price as number)}</span>
      ),
    },
    {
      key: 'volume_ratio_today',
      header: t('radar.exit.table.volumeToday'),
      headerAr: t('radar.exit.table.volumeToday'),
      sortable: true,
      align: 'center',
      width: 'w-24',
      render: (row) => {
        const ratio = row.volume_ratio_today as number | undefined;
        const cls =
          ratio == null
            ? 'text-muted-foreground'
            : ratio >= 1.5
              ? 'text-loss dark:text-loss font-bold'
              : ratio >= 1.0
                ? 'text-warning dark:text-warning'
                : 'text-profit dark:text-profit';
        return <span className={`font-mono text-xs ${cls}`}>{fmtVolRatio(ratio)}</span>;
      },
    },
    {
      key: 'rally_5d_pct',
      header: t('radar.exit.table.rally5d'),
      headerAr: t('radar.exit.table.rally5d'),
      sortable: true,
      align: 'center',
      width: 'w-24',
      render: (row) => {
        const rally = row.rally_5d_pct as number | null | undefined;
        const cls =
          rally == null
            ? 'text-muted-foreground'
            : rally > 15
              ? 'text-loss dark:text-loss'
              : rally > 5
                ? 'text-warning dark:text-warning'
                : 'text-muted-foreground';
        return <span className={`font-mono text-xs ${cls}`}>{fmtPct(rally)}</span>;
      },
    },
    {
      key: 'all_paths',
      header: t('radar.exit.table.allPaths'),
      headerAr: t('radar.exit.table.allPaths'),
      align: 'center',
      width: 'min-w-[160px]',
      render: (row) => {
        const allPaths = (row.all_paths as string[]) ?? [];
        if (allPaths.length <= 1) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1 justify-center">
            {allPaths.map((p) => {
              const meta = EXIT_PATHS.find((x) => x.pathValue === p);
              if (!meta) return null;
              return (
                <span key={p} className={`text-[10px] px-1.5 py-0.5 rounded ${meta.badge}`}>
                  {meta.icon} {t(`radar.exit.paths.${meta.tKey}.label`)}
                </span>
              );
            })}
          </div>
        );
      },
    },
    {
      key: 'reason',
      header: t('radar.exit.table.reason'),
      headerAr: t('radar.exit.table.reason'),
      width: 'min-w-[300px]',
      render: (row) => (
        <span className="text-xs text-muted-foreground leading-relaxed block">
          {String(row.reason || '—')}
        </span>
      ),
    },
  ];

  const rows = entries as unknown as Record<string, unknown>[];

  return (
    <UnifiedTable
      columns={columns}
      data={rows}
      maxHeight="max-h-[420px]"
      emptyText={t('radar.exit.table.empty')}
      emptyTextAr={t('radar.exit.table.empty')}
      dense
    />
  );
}

export default ExitRadarTab;

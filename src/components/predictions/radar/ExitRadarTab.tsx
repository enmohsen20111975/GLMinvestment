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
  Activity, Eye, EyeOff, ChevronDown,
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
const EXIT_PATHS = [
  {
    key: 'x1_distribution_strong',
    pathValue: 'X1_distribution_strong',
    ar: 'توزيع قوي',
    icon: '🔴',
    desc: 'بيع مؤسسي قوي — حجم مرتفع مع إغلاق في النصف السفلي',
    action: 'بيع كامل أو تقليص قوي للمركز',
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    border: 'border-rose-200 dark:border-rose-900',
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
  {
    key: 'x2_volume_divergence',
    pathValue: 'X2_volume_divergence',
    ar: 'تباعد حجمي',
    icon: '⚠️',
    desc: 'صعود وهمي — السعر اخترق قمة لكن الحجم ضعيف',
    action: 'تقليص نصف المركز + وقف مضغوط',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-900',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  {
    key: 'x3_resistance_rejection',
    pathValue: 'X3_resistance_rejection',
    ar: 'رفض مقاومة',
    icon: '🚫',
    desc: 'اختبر مقاومة وأغلق بـ upper shadow طويلة',
    action: 'وقف عند آخر قاع + مراقبة الاختراق',
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    border: 'border-orange-200 dark:border-orange-900',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  },
  {
    key: 'x4_exhaustion_gap',
    pathValue: 'X4_exhaustion_gap',
    ar: 'فجوة إرهاق',
    icon: '😮',
    desc: 'بعد صعود طويل، فجوة صاعدة ثم إغلاق أحمر',
    action: 'بيع كامل — الاندفاع استُنفد',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    border: 'border-purple-200 dark:border-purple-900',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  },
  {
    key: 'x5_kill_switch_triggered',
    pathValue: 'X5_kill_switch_triggered',
    ar: 'Kill Switch',
    icon: '🛑',
    desc: 'إشارة خروج فورية (Limit Up Trap / توزيع قاتل)',
    action: 'خروج فوري — لا تنتظر',
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-900',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
] as const;

// ============================================================================
// Helpers
// ============================================================================
function fmtVolRatio(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(2)}×`;
}

function fmtPrice(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(2);
}

function fmtPct(n?: number | null, withSign = true): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

// ============================================================================
// ExitRadarTab — main component
// ============================================================================
export function ExitRadarTab({ market }: ExitRadarTabProps) {
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
        setError(json.error || 'فشل تحميل رادار الخروج');
        setData(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
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
  // Loading state
  // ============================================================================
  if (loading && !data) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 animate-pulse" />
            <h3 className="text-base font-semibold">رادار الخروج</h3>
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
          <div className="h-12 w-12 rounded-full bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-rose-600 dark:text-rose-400 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-1">رادار الخروج بيتسخن</h3>
            <p className="text-sm text-muted-foreground">
              أول تشغيل — بنبني قائمة إشارات الخروج. حاول تاني خلال دقيقة.
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
      <Card className="p-4 border-dashed border-rose-200 dark:border-rose-900">
        <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-4 w-4" />
          <span>تعذّر تحميل رادار الخروج: {error}</span>
        </div>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchData()}>
          <RefreshCw className="h-4 w-4 ml-2" />
          إعادة المحاولة
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
      ? 'غير معروف'
      : cacheAgeSec < 60
        ? `من ${cacheAgeSec} ثانية`
        : cacheAgeSec < 3600
          ? `من ${Math.round(cacheAgeSec / 60)} دقيقة`
          : `من ${Math.round(cacheAgeSec / 3600)} ساعة`;

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <div className="space-y-4">
      {/* Header — stats summary */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
            <div>
              <h3 className="text-base font-semibold">🚪 رادار الخروج</h3>
              <p className="text-[11px] text-muted-foreground">
                إشارات التوزيع والخروج — عكس رادار الميكرز. آخر تحديث: {cacheAgeLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[11px]">
              السوق: {effectiveMarket}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              المفحوصين: {data.total_scanned ?? 0}
            </Badge>
            <Badge
              variant="outline"
              className={
                hasAnySignals
                  ? 'text-[11px] bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                  : 'text-[11px] bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              }
            >
              {hasAnySignals
                ? `${data.exit_count} إشارة خروج`
                : 'لا توجد إشارات خروج ✅'}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ml-1 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </Button>
          </div>
        </div>
        {data.warning && (
          <div className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
            ⚠️ {data.warning}
          </div>
        )}
      </Card>

      {/* 5 exit path sections — collapsible */}
      {!hasAnySignals && (
        <Card className="p-8 text-center border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold mb-1">لا توجد إشارات خروج اليوم</h3>
              <p className="text-sm text-muted-foreground">
                كل الأسهم المفحوصين لا تظهر عليهم إشارات توزيع أو خروج حالياً.
                راجع الرادار بانتظام خلال ساعات التداول.
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
                      <div className={`text-sm font-bold ${p.color}`}>{p.ar}</div>
                      <div className="text-[10px] text-muted-foreground">{p.desc}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${p.badge}`}>{count} سهم</Badge>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border/50 p-3">
                  <div className={`text-xs mb-3 p-2 rounded ${p.bg} ${p.color}`}>
                    <strong>الإجراء المقترح:</strong> {p.action}
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
          <strong className="text-foreground">ℹ️ كيف يعمل رادار الخروج؟</strong>
          <br />
          يفحص السكريبت كل الأسهم يومياً على 5 مسارات خروج (X1-X5). الإشارات
          ترتيبها حسب الأولوية: X5 (Kill Switch) → X1 (توزيع قوي) → X4 (فجوة
          إرهاق) → X3 (رفض مقاومة) → X2 (تباعد حجمي). كل سهم يظهر مع أعلى
          مسار خروج محقق له. المصدر:{' '}
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
  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'ticker',
      header: 'السهم',
      headerAr: 'السهم',
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
      header: 'السعر',
      headerAr: 'السعر',
      sortable: true,
      align: 'center',
      width: 'w-20',
      render: (row) => (
        <span className="font-mono text-xs">{fmtPrice(row.current_price as number)}</span>
      ),
    },
    {
      key: 'volume_ratio_today',
      header: 'حجم اليوم',
      headerAr: 'حجم اليوم',
      sortable: true,
      align: 'center',
      width: 'w-24',
      render: (row) => {
        const ratio = row.volume_ratio_today as number | undefined;
        const cls =
          ratio == null
            ? 'text-muted-foreground'
            : ratio >= 1.5
              ? 'text-rose-600 dark:text-rose-400 font-bold'
              : ratio >= 1.0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400';
        return <span className={`font-mono text-xs ${cls}`}>{fmtVolRatio(ratio)}</span>;
      },
    },
    {
      key: 'rally_5d_pct',
      header: 'صعود 5 أيام',
      headerAr: 'صعود 5 أيام',
      sortable: true,
      align: 'center',
      width: 'w-24',
      render: (row) => {
        const rally = row.rally_5d_pct as number | null | undefined;
        const cls =
          rally == null
            ? 'text-muted-foreground'
            : rally > 15
              ? 'text-rose-600 dark:text-rose-400'
              : rally > 5
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground';
        return <span className={`font-mono text-xs ${cls}`}>{fmtPct(rally)}</span>;
      },
    },
    {
      key: 'all_paths',
      header: 'كل المسارات',
      headerAr: 'كل المسارات',
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
                  {meta.icon} {meta.ar}
                </span>
              );
            })}
          </div>
        );
      },
    },
    {
      key: 'reason',
      header: 'السبب',
      headerAr: 'السبب',
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
      emptyText="لا توجد أسهم في هذا المسار"
      emptyTextAr="لا توجد أسهم في هذا المسار"
      dense
    />
  );
}

export default ExitRadarTab;

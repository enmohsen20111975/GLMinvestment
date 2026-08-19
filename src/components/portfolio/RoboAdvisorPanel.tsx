'use client';

/* ============================================================
   ROBO-ADVISOR-PANEL — P33-FRONTEND-ROBO
   ============================================================
   Five self-contained Robo-Advisor features:
   1. Future Wealth Projection   (التوقع المستقبلي للثروة)
   2. Smart Rebalancing Alerts    (تنبيهات التزن الذكي)
   3. Equity Curve                (حركة صافي الثروة)
   4. Asset Allocation Pie Chart  (توزيع الأصول)
   5. Transactions History Table  (سجل المعاملات)

   Self-contained: receives `assets` (and optional `rebalanceAlerts`) as
   props, then fetches /api/finance/projection, /api/portfolio/equity-curve
   and /api/finance/calculate-values itself. Handles 401 gracefully for
   endpoints that require auth.
   ============================================================ */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Info,
  AlertOctagon,
  PieChart as PieIcon,
  History,
  RefreshCw,
  Wallet,
  CalendarClock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ────────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────────

interface RoboAsset {
  id: number | string;
  type: string;
  name: string;
  total_invested: number;
  current_value: number;
  profit_loss?: number;
  profit_loss_percent?: number;
  purchase_date?: string;
  added_at?: string;
  stock_ticker?: string;
  quantity?: number;
  avg_buy_price?: number;
  [key: string]: any;
}

interface RebalanceAlert {
  type: string;
  severity: 'info' | 'warning' | 'danger';
  title_ar: string;
  message_ar: string;
  suggested_action_ar: string;
  amount_egp?: number;
  pct?: number;
}

interface RoboAdvisorPanelProps {
  assets: RoboAsset[];
  rebalanceAlerts?: RebalanceAlert[];
}

interface ProjectionPoint {
  year: number;
  value: number;
  yield_egp: number;
  expenses_egp: number;
  net_change_egp: number;
}

interface ProjectionData {
  success: boolean;
  years: number;
  compound: boolean;
  current_value: number;
  annual_yield_egp: number;
  annual_yield_rate: number;
  monthly_expenses_egp: number;
  projection: ProjectionPoint[];
  final_value: number;
  growth_pct: number;
  total_yield_egp: number;
  total_expenses_egp: number;
}

interface EquitySnapshot {
  snapshot_date: string;
  total_current_value: number;
  total_invested?: number;
  total_pnl?: number;
  total_pnl_pct?: number;
}

interface EquityData {
  success: boolean;
  days: number;
  snapshots: EquitySnapshot[];
  first_val: number;
  last_val: number;
  total_change_pct: number;
}

// ────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────

function fmtEGP(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0 ج';
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(n) + ' ج';
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  // Accept yyyy-mm-dd OR ISO timestamps
  const datePart = String(s).split('T')[0];
  const d = new Date(datePart);
  if (isNaN(d.getTime())) return datePart;
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d);
  } catch {
    return datePart;
  }
}

// Shorter date for the chart X-axis (dd/mm)
function fmtShortDate(s?: string): string {
  if (!s) return '';
  const datePart = String(s).split('T')[0];
  const parts = datePart.split('-');
  if (parts.length < 3) return datePart;
  return `${parts[2]}/${parts[1]}`;
}

// Asset type → Arabic label + color
const TYPE_META: Record<string, { label: string; color: string }> = {
  stock: { label: 'أسهم', color: '#10b981' },
  gold: { label: 'ذهب', color: '#f59e0b' },
  silver: { label: 'فضة', color: '#94a3b8' },
  bank: { label: 'بنك', color: '#3b82f6' },
  certificate: { label: 'شهادات', color: '#06b6d4' },
  fund: { label: 'صناديق', color: '#8b5cf6' },
  crypto: { label: 'كريبتو', color: '#f97316' },
  real_estate: { label: 'عقارات', color: '#f43f5e' },
  bond: { label: 'سندات', color: '#0ea5e9' },
  deposit: { label: 'ودائع', color: '#14b8a6' },
  savings_account: { label: 'حسابات توفير', color: '#22c55e' },
  car: { label: 'سيارة', color: '#a78bfa' },
  currency: { label: 'عملات', color: '#64748b' },
  forex: { label: 'فوركس', color: '#64748b' },
  other: { label: 'أخرى', color: '#64748b' },
};

function typeLabel(t: string): string {
  return TYPE_META[(t || 'other').toLowerCase()]?.label || 'أخرى';
}

function typeColor(t: string): string {
  return TYPE_META[(t || 'other').toLowerCase()]?.color || '#64748b';
}

// ────────────────────────────────────────────────────────────
//  Severity styling for rebalance alerts
// ────────────────────────────────────────────────────────────

interface SeverityStyle {
  container: string;
  title: string;
  message: string;
  action: string;
  badge: string;
  icon: React.ReactNode;
}

function getSeverityStyle(sev: RebalanceAlert['severity']): SeverityStyle {
  switch (sev) {
    case 'danger':
      return {
        container: 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800',
        title: 'text-red-800 dark:text-red-200',
        message: 'text-red-700 dark:text-red-300',
        action: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800',
        badge: 'bg-red-600 text-white',
        icon: <AlertOctagon className="h-5 w-5 text-red-500" />,
      };
    case 'warning':
      return {
        container: 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800',
        title: 'text-amber-800 dark:text-amber-200',
        message: 'text-amber-700 dark:text-amber-300',
        action: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800',
        badge: 'bg-amber-500 text-white',
        icon: <AlertTriangle className="h-5 w-5 text-amber-500" />,
      };
    case 'info':
    default:
      return {
        container: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800',
        title: 'text-emerald-800 dark:text-emerald-200',
        message: 'text-emerald-700 dark:text-emerald-300',
        action: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800',
        badge: 'bg-emerald-600 text-white',
        icon: <Info className="h-5 w-5 text-emerald-500" />,
      };
  }
}

// ────────────────────────────────────────────────────────────
//  Card header icon badge
// ────────────────────────────────────────────────────────────

function FeatureIcon({ icon, tone }: { icon: React.ReactNode; tone: string }) {
  return (
    <span className={cn('inline-flex h-9 w-9 items-center justify-center rounded-lg', tone)}>
      {icon}
    </span>
  );
}

// ════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ════════════════════════════════════════════════════════════

export function RoboAdvisorPanel({ assets, rebalanceAlerts }: RoboAdvisorPanelProps) {
  // ── Feature 1: Projection state ──
  const [projYears, setProjYears] = useState<number>(10);
  const [compound, setCompound] = useState<boolean>(true);
  const [projection, setProjection] = useState<ProjectionData | null>(null);
  const [projLoading, setProjLoading] = useState<boolean>(true);
  const [projError, setProjError] = useState<string | null>(null);

  // ── Feature 2: Rebalance alerts ──
  const [alerts, setAlerts] = useState<RebalanceAlert[] | null>(null);
  const [alertsLoading, setAlertsLoading] = useState<boolean>(true);

  // ── Feature 3: Equity curve state ──
  const [curveDays, setCurveDays] = useState<number>(30);
  const [equity, setEquity] = useState<EquityData | null>(null);
  const [equityLoading, setEquityLoading] = useState<boolean>(true);
  const [equityAuthRequired, setEquityAuthRequired] = useState<boolean>(false);
  const [equityError, setEquityError] = useState<string | null>(null);

  // ── Refresh trigger (lets the user manually refetch) ──
  const [refreshTick, setRefreshTick] = useState<number>(0);

  // ──────────────────────────────────────────────────────────
  //  Feature 1: Fetch projection
  // ──────────────────────────────────────────────────────────
  const fetchProjection = useCallback(async () => {
    setProjLoading(true);
    setProjError(null);
    try {
      const res = await fetch(
        `/api/finance/projection?years=${projYears}&compound=${compound}`,
        { cache: 'no-store' }
      );
      if (res.status === 401) {
        setProjection(null);
        setProjError('يجب تسجيل الدخول لعرض التوقع المستقبلي');
        return;
      }
      if (!res.ok) throw new Error('projection fetch failed');
      const data: ProjectionData = await res.json();
      setProjection(data?.success ? data : null);
    } catch (e) {
      console.error('[RoboAdvisorPanel] projection error:', e);
      setProjError('تعذّر حساب التوقع المستقبلي');
      setProjection(null);
    } finally {
      setProjLoading(false);
    }
  }, [projYears, compound]);

  useEffect(() => {
    fetchProjection();
  }, [fetchProjection, refreshTick]);

  // ──────────────────────────────────────────────────────────
  //  Feature 2: Fetch rebalance alerts (if not passed as prop)
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (rebalanceAlerts !== undefined) {
      setAlerts(rebalanceAlerts);
      setAlertsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setAlertsLoading(true);
      try {
        const res = await fetch('/api/finance/calculate-values', { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401) {
          setAlerts([]);
          return;
        }
        if (!res.ok) {
          setAlerts([]);
          return;
        }
        const data = await res.json();
        const smart = data?.smart_math || {};
        const list: RebalanceAlert[] = Array.isArray(smart.rebalance_alerts)
          ? smart.rebalance_alerts
          : [];
        setAlerts(list);
      } catch (e) {
        console.error('[RoboAdvisorPanel] alerts error:', e);
        setAlerts([]);
      } finally {
        if (!cancelled) setAlertsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rebalanceAlerts, refreshTick]);

  // ──────────────────────────────────────────────────────────
  //  Feature 3: Fetch equity curve
  // ──────────────────────────────────────────────────────────
  const fetchEquity = useCallback(async () => {
    setEquityLoading(true);
    setEquityError(null);
    setEquityAuthRequired(false);
    try {
      const res = await fetch(`/api/portfolio/equity-curve?days=${curveDays}`, {
        cache: 'no-store',
      });
      if (res.status === 401) {
        setEquityAuthRequired(true);
        setEquity(null);
        return;
      }
      if (!res.ok) throw new Error('equity-curve fetch failed');
      const data: EquityData = await res.json();
      setEquity(data?.success ? data : null);
    } catch (e) {
      console.error('[RoboAdvisorPanel] equity error:', e);
      setEquityError('تعذّر تحميل منحنى الثروة');
      setEquity(null);
    } finally {
      setEquityLoading(false);
    }
  }, [curveDays]);

  useEffect(() => {
    fetchEquity();
  }, [fetchEquity, refreshTick]);

  // ──────────────────────────────────────────────────────────
  //  Feature 4: Allocation by type (derived from `assets` prop)
  // ──────────────────────────────────────────────────────────
  const allocation = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const a of assets || []) {
      const t = String(a?.type || 'other').toLowerCase();
      const v = Number(a?.current_value || 0) || 0;
      if (v <= 0) continue;
      groups[t] = (groups[t] || 0) + v;
    }
    const total = Object.values(groups).reduce((s, v) => s + v, 0);
    return Object.entries(groups)
      .map(([type, value]) => ({
        type,
        label: typeLabel(type),
        color: typeColor(type),
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [assets]);

  const allocationTotal = useMemo(
    () => allocation.reduce((s, g) => s + g.value, 0),
    [allocation]
  );

  // ──────────────────────────────────────────────────────────
  //  Feature 5: Transactions table (derived from `assets`)
  // ──────────────────────────────────────────────────────────
  const transactions = useMemo(() => {
    return (assets || [])
      .map((a) => {
        const invested = Number(a?.total_invested || 0) || 0;
        const current = Number(a?.current_value || 0) || 0;
        const pnl = Number(a?.profit_loss ?? current - invested);
        const pnlPct =
          a?.profit_loss_percent !== undefined && a?.profit_loss_percent !== null
            ? Number(a.profit_loss_percent)
            : invested > 0
            ? (pnl / invested) * 100
            : 0;
        const dateStr = a?.purchase_date || a?.added_at || '';
        return {
          id: a.id,
          date: dateStr,
          name: a?.name || '—',
          type: String(a?.type || 'other'),
          invested,
          current,
          pnl,
          pnlPct,
        };
      })
      .sort((a, b) => {
        // Newest first; empty dates pushed to the bottom
        // LOCALECOMPARE-FIX: wrap with String() — `date` can come from DB as
        // number/null/object and would crash with "localeCompare is not a function".
        const da = String(a?.date ?? '');
        const db = String(b?.date ?? '');
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      });
  }, [assets]);

  // ──────────────────────────────────────────────────────────
  //  Render
  // ──────────────────────────────────────────────────────────

  return (
    <section className="space-y-4 my-4" aria-label="لوحة المستشار الآلي">
      {/* Panel header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FeatureIcon
            icon={<Sparkles className="h-5 w-5" />}
            tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          />
          <div>
            <h2 className="text-base md:text-lg font-bold">المستشار الآلي (Robo-Advisor)</h2>
            <p className="text-xs text-muted-foreground">
              تحليل ذكي لمحفظتك — توقعات، تنبيهات تزن، وحركة الثروة
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRefreshTick((t) => t + 1)}
          className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800 dark:hover:bg-emerald-950/40"
        >
          <RefreshCw className="h-3.5 w-3.5 ml-1.5" />
          تحديث
        </Button>
      </div>

      {/* ── Feature 2: Rebalance Alerts (full-width banner section) ── */}
      <RebalanceAlertsCard alerts={alerts} loading={alertsLoading} />

      {/* ── Top row: Projection + Equity Curve ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ProjectionCard
          data={projection}
          loading={projLoading}
          error={projError}
          years={projYears}
          compound={compound}
          onYearsChange={setProjYears}
          onCompoundChange={setCompound}
        />
        <EquityCurveCard
          data={equity}
          loading={equityLoading}
          error={equityError}
          authRequired={equityAuthRequired}
          days={curveDays}
          onDaysChange={setCurveDays}
        />
      </div>

      {/* ── Second row: Pie + Transactions Table ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AllocationCard allocation={allocation} total={allocationTotal} />
        <TransactionsCard transactions={transactions} />
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════
//  SUB-COMPONENT 1: Projection Card
// ════════════════════════════════════════════════════════════

interface ProjectionCardProps {
  data: ProjectionData | null;
  loading: boolean;
  error: string | null;
  years: number;
  compound: boolean;
  onYearsChange: (y: number) => void;
  onCompoundChange: (c: boolean) => void;
}

const YEAR_OPTIONS = [5, 10, 15, 20, 30];

function ProjectionCard({
  data,
  loading,
  error,
  years,
  compound,
  onYearsChange,
  onCompoundChange,
}: ProjectionCardProps) {
  const isPositive = (data?.growth_pct ?? 0) >= 0;
  return (
    <Card className="border-emerald-200 dark:border-emerald-900/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <FeatureIcon
              icon={<CalendarClock className="h-5 w-5" />}
              tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            />
            <div>
              <CardTitle className="text-base">التوقع المستقبلي للثروة</CardTitle>
              <p className="text-xs text-muted-foreground">توقع نمو محفظتك خلال السنوات القادمة</p>
            </div>
          </div>
          {/* Year selector */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {YEAR_OPTIONS.map((y) => (
              <Button
                key={y}
                size="sm"
                variant={years === y ? 'default' : 'outline'}
                onClick={() => onYearsChange(y)}
                className={
                  years === y
                    ? 'h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'h-7 px-2.5 text-xs'
                }
              >
                {y} سنة
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Compound toggle */}
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="compound-switch" className="text-sm font-medium cursor-pointer">
              إعادة استثمار العائد (Compound)
            </Label>
          </div>
          <Switch
            id="compound-switch"
            checked={compound}
            onCheckedChange={onCompoundChange}
            className="data-[state=checked]:bg-emerald-600"
          />
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {error}
          </div>
        ) : !data ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            لا توجد بيانات كافية لحساب التوقع
          </div>
        ) : (
          <>
            {/* Big result */}
            <div className="rounded-xl bg-gradient-to-l from-emerald-50 to-emerald-100/40 dark:from-emerald-950/40 dark:to-emerald-900/20 border border-emerald-200 dark:border-emerald-900/50 p-4">
              <p className="text-xs text-muted-foreground mb-1">
                ثروتك المتوقعة بعد {data.years} سنين هي
              </p>
              <p className="text-2xl md:text-3xl font-extrabold text-emerald-700 dark:text-emerald-300 tracking-tight">
                {fmtEGP(data.final_value)}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge
                  className={
                    isPositive
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent'
                      : 'bg-red-600 hover:bg-red-700 text-white border-transparent'
                  }
                >
                  {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {fmtPct(data.growth_pct)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  من {fmtEGP(data.current_value)}
                </span>
              </div>
            </div>

            {/* Chart */}
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.projection}
                  margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="projLineGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                  <XAxis
                    dataKey="year"
                    stroke="#94a3b8"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    tickFormatter={(v) => `س${v}`}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    width={50}
                    tickFormatter={(v) => {
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                      if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
                      return String(v);
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      direction: 'rtl',
                    }}
                    labelFormatter={(label) => `السنة ${label}`}
                    formatter={(value: any, name: string) => {
                      if (name === 'value') return [fmtEGP(Number(value)), 'القيمة'];
                      return [fmtNum(Number(value)), name];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5, stroke: '#10b981', strokeWidth: 2, fill: '#ffffff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Sub-text */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md bg-muted/40 px-2 py-1.5">
                <div className="text-muted-foreground">العائد السنوي</div>
                <div className="font-bold text-emerald-700 dark:text-emerald-300">
                  {fmtEGP(data.annual_yield_egp)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  ({data.annual_yield_rate.toFixed(2)}%)
                </div>
              </div>
              <div className="rounded-md bg-muted/40 px-2 py-1.5">
                <div className="text-muted-foreground">المصاريف الشهرية</div>
                <div className="font-bold text-rose-700 dark:text-rose-300">
                  {fmtEGP(data.monthly_expenses_egp)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  ({fmtEGP(data.total_expenses_egp)} إجمالي)
                </div>
              </div>
              <div className="rounded-md bg-muted/40 px-2 py-1.5">
                <div className="text-muted-foreground">إجمالي العائد</div>
                <div className="font-bold text-emerald-700 dark:text-emerald-300">
                  {fmtEGP(data.total_yield_egp)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {compound ? 'مركّب' : 'بسيط'}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
//  SUB-COMPONENT 2: Rebalance Alerts Card
// ════════════════════════════════════════════════════════════

interface RebalanceAlertsCardProps {
  alerts: RebalanceAlert[] | null;
  loading: boolean;
}

function RebalanceAlertsCard({ alerts, loading }: RebalanceAlertsCardProps) {
  return (
    <Card className="border-amber-200 dark:border-amber-900/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <FeatureIcon
            icon={<ShieldCheck className="h-5 w-5" />}
            tone="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          />
          <div>
            <CardTitle className="text-base">تنبيهات التزن الذكي</CardTitle>
            <p className="text-xs text-muted-foreground">
              توصيات تلقائية لإعادة توازن محفظتك
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : !alerts || alerts.length === 0 ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 p-4 flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="font-bold text-emerald-800 dark:text-emerald-200">
                محفظتك متزنة
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                لا توجد تنبيهات تزن في الوقت الحالي. استمر في المراقبة!
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {alerts.map((alert, idx) => {
              const style = getSeverityStyle(alert.severity);
              return (
                <div
                  key={`${alert.type}-${idx}`}
                  className={cn(
                    'rounded-xl border p-3.5 flex items-start gap-3',
                    style.container
                  )}
                >
                  <span className="flex-shrink-0 mt-0.5">{style.icon}</span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={cn('font-bold text-sm', style.title)}>{alert.title_ar}</p>
                      <Badge className={style.badge}>
                        {alert.severity === 'danger'
                          ? 'خطر'
                          : alert.severity === 'warning'
                          ? 'تحذير'
                          : 'معلومة'}
                      </Badge>
                      {typeof alert.pct === 'number' && (
                        <span className={cn('text-xs font-medium', style.message)}>
                          ({alert.pct.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                    <p className={cn('text-sm leading-relaxed', style.message)}>
                      {alert.message_ar}
                    </p>
                    {alert.suggested_action_ar && (
                      <div
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm font-medium flex items-start gap-2',
                          style.action
                        )}
                      >
                        <Sparkles className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <span>
                          <span className="font-bold">الإجراء المقترح: </span>
                          {alert.suggested_action_ar}
                          {typeof alert.amount_egp === 'number' && alert.amount_egp > 0 && (
                            <span className="block text-xs mt-0.5 opacity-80">
                              المبلغ المقترح: {fmtEGP(alert.amount_egp)}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
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

// ════════════════════════════════════════════════════════════
//  SUB-COMPONENT 3: Equity Curve Card
// ════════════════════════════════════════════════════════════

interface EquityCurveCardProps {
  data: EquityData | null;
  loading: boolean;
  error: string | null;
  authRequired: boolean;
  days: number;
  onDaysChange: (d: number) => void;
}

const DAY_OPTIONS = [7, 30, 90];

function EquityCurveCard({
  data,
  loading,
  error,
  authRequired,
  days,
  onDaysChange,
}: EquityCurveCardProps) {
  const isPositive = (data?.total_change_pct ?? 0) >= 0;
  const trendColor = isPositive ? '#10b981' : '#ef4444';
  const chartData = useMemo(() => {
    if (!data?.snapshots) return [];
    return data.snapshots.map((s) => ({
      ...s,
      date_label: fmtShortDate(s.snapshot_date),
    }));
  }, [data]);

  return (
    <Card className="border-emerald-200 dark:border-emerald-900/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <FeatureIcon
              icon={<TrendingUp className="h-5 w-5" />}
              tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            />
            <div>
              <CardTitle className="text-base">حركة صافي الثروة</CardTitle>
              <p className="text-xs text-muted-foreground">قيمة محفظتك خلال آخر {days} يوم</p>
            </div>
          </div>
          {/* Day range selector */}
          <div className="flex items-center gap-1.5">
            {DAY_OPTIONS.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={days === d ? 'default' : 'outline'}
                onClick={() => onDaysChange(d)}
                className={
                  days === d
                    ? 'h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'h-7 px-2.5 text-xs'
                }
              >
                {d} يوم
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : authRequired ? (
          <div className="rounded-xl border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-6 text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300 flex items-center justify-center gap-2">
              <Info className="h-4 w-4" />
              سجّل الدخول لعرض حركة ثروتك
            </p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {error}
          </div>
        ) : !data || chartData.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Wallet className="h-8 w-8 text-muted-foreground/50" />
            لا توجد بيانات تاريخية كافية بعد
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground">آخر قيمة:</span>
                <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                  {fmtEGP(data.last_val)}
                </span>
              </div>
              <Badge
                className={
                  isPositive
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent'
                    : 'bg-red-600 hover:bg-red-700 text-white border-transparent'
                }
              >
                {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {fmtPct(data.total_change_pct)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                من {fmtEGP(data.first_val)}
              </span>
            </div>

            {/* Chart */}
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={trendColor} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                  <XAxis
                    dataKey="date_label"
                    stroke="#94a3b8"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    width={50}
                    tickFormatter={(v) => {
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                      if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
                      return String(v);
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      direction: 'rtl',
                    }}
                    labelFormatter={(label) => `التاريخ: ${label}`}
                    formatter={(value: any) => [fmtEGP(Number(value)), 'صافي الثروة']}
                  />
                  <Area
                    type="monotone"
                    dataKey="total_current_value"
                    stroke={trendColor}
                    strokeWidth={2.5}
                    fill="url(#equityGradient)"
                    dot={false}
                    activeDot={{ r: 5, stroke: trendColor, strokeWidth: 2, fill: '#ffffff' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
//  SUB-COMPONENT 4: Asset Allocation Pie Card
// ════════════════════════════════════════════════════════════

interface AllocationItem {
  type: string;
  label: string;
  color: string;
  value: number;
  pct: number;
}

interface AllocationCardProps {
  allocation: AllocationItem[];
  total: number;
}

function AllocationCard({ allocation, total }: AllocationCardProps) {
  return (
    <Card className="border-emerald-200 dark:border-emerald-900/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <FeatureIcon
            icon={<PieIcon className="h-5 w-5" />}
            tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          />
          <div>
            <CardTitle className="text-base">توزيع الأصول</CardTitle>
            <p className="text-xs text-muted-foreground">نسبة كل نوع أصل في محفظتك</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {allocation.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <PieIcon className="h-8 w-8 text-muted-foreground/50" />
            لا توجد أصول لعرض توزيعها
          </div>
        ) : (
          <>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocation}
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {allocation.map((entry) => (
                      <Cell key={entry.type} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      direction: 'rtl',
                    }}
                    formatter={(value: any, _name: string, props: any) => {
                      const pct = props?.payload?.pct ?? 0;
                      return [`${fmtEGP(Number(value))} (${pct.toFixed(1)}%)`, props?.payload?.label || ''];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
              {allocation.map((item) => (
                <div
                  key={item.type}
                  className="flex items-center justify-between gap-2 text-sm py-1"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block h-3 w-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-medium truncate">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-muted-foreground text-xs">{fmtEGP(item.value)}</span>
                    <Badge variant="outline" className="text-xs font-bold">
                      {item.pct.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 text-sm pt-2 mt-1 border-t border-border">
                <span className="font-bold">الإجمالي</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-300">
                  {fmtEGP(total)}
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
//  SUB-COMPONENT 5: Transactions History Table
// ════════════════════════════════════════════════════════════

interface TransactionRow {
  id: number | string;
  date: string;
  name: string;
  type: string;
  invested: number;
  current: number;
  pnl: number;
  pnlPct: number;
}

function TransactionsCard({ transactions }: { transactions: TransactionRow[] }) {
  return (
    <Card className="border-emerald-200 dark:border-emerald-900/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <FeatureIcon
            icon={<History className="h-5 w-5" />}
            tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          />
          <div>
            <CardTitle className="text-base">سجل المعاملات</CardTitle>
            <p className="text-xs text-muted-foreground">
              عمليات الشراء ({transactions.length} معاملة)
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <History className="h-8 w-8 text-muted-foreground/50" />
            لا توجد معاملات لعرضها
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto custom-scrollbar rounded-lg border border-border">
            <Table className="text-xs sm:text-sm">
              <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-right font-semibold">التاريخ</TableHead>
                  <TableHead className="text-right font-semibold">الأصل</TableHead>
                  <TableHead className="text-right font-semibold">النوع</TableHead>
                  <TableHead className="text-right font-semibold">السعر المشترى</TableHead>
                  <TableHead className="text-right font-semibold">القيمة الحالية</TableHead>
                  <TableHead className="text-right font-semibold">الربح/الخسارة</TableHead>
                  <TableHead className="text-right font-semibold">النسبة %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => {
                  const isProfit = t.pnl >= 0;
                  return (
                    <TableRow key={t.id} className="border-border">
                      <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                        {fmtDate(t.date)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {t.name}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: `${typeColor(t.type)}22`,
                            color: typeColor(t.type),
                          }}
                        >
                          {typeLabel(t.type)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {fmtEGP(t.invested)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap font-medium">
                        {fmtEGP(t.current)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right whitespace-nowrap font-bold',
                          isProfit
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        )}
                      >
                        {isProfit ? '+' : ''}
                        {fmtEGP(t.pnl)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right whitespace-nowrap font-bold',
                          isProfit
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        )}
                      >
                        {fmtPct(t.pnlPct)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

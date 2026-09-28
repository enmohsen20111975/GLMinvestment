'use client';

/**
 * MarketPulseWidget — نبض السوق اللحظي
 * ====================================================
 * ودجت مدمج لعرض نبض السوق اللحظي:
 * - مقياس نصف دائري (Gauge) من -5 إلى +5 مع مؤشر
 * - تسمية النبض بالعربية (صاعد/هابط/محايد...)
 * - EGX30 + EGX70 ببطاقتين مصغرتين
 * - شارة نظام التباعد (توزيع/مضاربة/صعود صحي/هبوط)
 * - شريط اتساع السوق (gainers vs losers)
 * - القطاع الأكثر امتصاصاً للسيولة
 * - تحديث تلقائي كل 10 ثوانٍ مع وميض خفيف عند التحديث
 * - "آخر تحديث: منذ X ثانية" — يُعاد حسابه كل ثانية
 *
 * يجلب البيانات من `/api/market-pulse`.
 * يعمل بالكامل في RTL، ألوان emerald/rose/amber فقط (لا أزرق/إنديغو).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Flame,
  Loader2,
  RefreshCw,
  Signal,
  Snowflake,
  WifiOff,
  Zap,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';

// ============================================================
// Types — مطابقة لـ /api/market-pulse
// ============================================================

interface IndexSnapshot {
  value: number;
  change_percent: number;
  previous_close: number;
}

interface PulseInfo {
  score: number; // -5..+5
  label: string; // "قوي صاعد" / "صاعد" / "محايد" / "هابط" / "قوي هابط"
  label_en: string;
  color: 'emerald' | 'green' | 'amber' | 'orange' | 'rose';
}

interface DivergenceInfo {
  value: number;
  regime: 'HEALTHY_BULL' | 'DISTRIBUTION' | 'SPECULATION' | 'BEAR';
  regime_ar: string;
  action: 'BUY' | 'CAUTION' | 'DANGER' | 'EXIT';
  action_ar: string;
}

interface SectorInfo {
  sector: string;
  stock_count: number;
  avg_change: number;
  turnover: number;
  turnover_pct: number;
  gainers: number;
  losers: number;
  status: 'HOT' | 'COLD' | 'NEUTRAL';
}

interface MarketPulseData {
  cairo_time: string;
  weekday: string;
  is_trading_hours: boolean;
  market_status: 'OPEN' | 'CLOSED';
  latest_update: string;
  egx30: IndexSnapshot;
  egx70: IndexSnapshot;
  divergence: DivergenceInfo;
  pulse: PulseInfo;
  sectors: SectorInfo[];
  top_sector: { sector: string; turnover_pct: number; avg_change: number } | null;
  breadth: {
    gainers: number;
    losers: number;
    unchanged: number;
    adv_dec_ratio: number;
    total_turnover: number;
    total_turnover_bn: number;
  };
}

interface ApiResponse {
  success?: boolean;
  data?: MarketPulseData;
  error?: string;
}

// ============================================================
// Helpers
// ============================================================

const numberFmt2 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const intFmt = new Intl.NumberFormat('en-US');

function fmtNum(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (decimals === 0) return intFmt.format(Math.round(value));
  return numberFmt2.format(value);
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${numberFmt2.format(value)}%`;
}

function fmtVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} مليار`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} مليون`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} ألف`;
  return intFmt.format(value);
}

/** "منذ X ثانية/دقيقة" — نسخة محلية (بدون التأثير على جذر التطبيق). */
function relTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';
  let diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 0) diffSec = 0;
  if (diffSec < 60) return `منذ ${diffSec} ثانية`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    if (diffMin === 1) return 'منذ دقيقة';
    if (diffMin <= 10) return `منذ ${diffMin} دقائق`;
    return `منذ ${diffMin} دقيقة`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    if (diffHr === 1) return 'منذ ساعة';
    if (diffHr <= 10) return `منذ ${diffHr} ساعات`;
    return `منذ ${diffHr} ساعة`;
  }
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'منذ يوم';
  if (diffDay <= 10) return `منذ ${diffDay} أيام`;
  return `منذ ${diffDay} يوم`;
}

// ============================================================
// Pulse Gauge (SVG)
// ============================================================
// نصف دائرة من 180° (يسار، score=-5) إلى 0° (يمين، score=+5)
// المناطق اللونية:
//   -5..-2     : أحمر (rose)
//   -2..-0.5   : برتقالي (orange)
//   -0.5..0.5  : كهرماني (amber)
//    0.5..2    : أخضر فاتح (green)
//    2..5      : زمردي (emerald)

const GAUGE_CX = 110;
const GAUGE_CY = 110;
const GAUGE_R = 90;

/** زاوية رياضية قياسية (درجات) لدرجة نبض معينة. */
function scoreToAngle(score: number): number {
  const clamped = Math.max(-5, Math.min(5, score));
  return 180 - ((clamped + 5) / 10) * 180; // 180° عند -5 ، 0° عند +5
}

/** نقطة على القوس بزاوية معينة (درجات، قياس قياسي). */
function pointOnArc(angleDeg: number, r: number = GAUGE_R): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: GAUGE_CX + r * Math.cos(rad),
    y: GAUGE_CY - r * Math.sin(rad), // y مقلوبة في SVG
  };
}

/** يبني مسار SVG لقوس بين درجتين على النصف العلوي. */
function arcPath(angleStartDeg: number, angleEndDeg: number, r: number = GAUGE_R): string {
  // angleStart > angleEnd (نتحرك من اليسار إلى اليمين)
  const p1 = pointOnArc(angleStartDeg, r);
  const p2 = pointOnArc(angleEndDeg, r);
  const largeArc = Math.abs(angleStartDeg - angleEndDeg) > 180 ? 1 : 0;
  // sweep=0 في SVG = اتجاه الزاوية السالبة = عكس عقارب الساعة رياضياً
  // = يمر من الأعلى (لأن y مقلوبة). هذا ما نريده للنصف العلوي.
  return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 0 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`;
}

interface Zone {
  from: number; // score
  to: number; // score
  color: string; // tailwind hex-like for stroke
  label: string;
}

const ZONES: Zone[] = [
  { from: -5, to: -2, color: '#f43f5e', label: 'هابط قوي' }, // rose-500
  { from: -2, to: -0.5, color: '#f97316', label: 'هابط' }, // orange-500
  { from: -0.5, to: 0.5, color: '#f59e0b', label: 'محايد' }, // amber-500
  { from: 0.5, to: 2, color: '#22c55e', label: 'صاعد' }, // green-500
  { from: 2, to: 5, color: '#10b981', label: 'صاعد قوي' }, // emerald-500
];

function PulseGauge({ score }: { score: number }) {
  // زاوية دوران الإبرة (بالدرجات، سالب = يسار، موجب = يمين).
  // score = -5  → -90° (يسار)
  // score =  0  →   0° (أعلى)
  // score = +5  → +90° (يمين)
  const needleRot = Math.max(-5, Math.min(5, score)) * 18;
  const needleLen = GAUGE_R - 12; // طول الإبرة
  // الإبرة تُرسَم وهي تشير للأعلى (من المركز إلى الأعلى)، ثم تُدوَّر حول المركز.
  const needleTip = { x: GAUGE_CX, y: GAUGE_CY - needleLen };

  return (
    <svg
      viewBox="0 0 220 130"
      className="w-full h-auto"
      role="img"
      aria-label={`مؤشر نبض السوق: ${score.toFixed(1)} من 5`}
    >
      {/* مناطق الألوان */}
      {ZONES.map((z) => (
        <path
          key={z.label}
          d={arcPath(scoreToAngle(z.from), scoreToAngle(z.to))}
          fill="none"
          stroke={z.color}
          strokeWidth={14}
          strokeLinecap="butt"
          opacity={0.85}
        />
      ))}

      {/* خلفية رمادية خفيفة تحت القوس */}
      <path
        d={arcPath(180, 0, GAUGE_R + 8)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="2 4"
        className="text-slate-300 dark:text-slate-700"
        opacity={0.5}
      />

      {/* علامات صغيرة عند -5, 0, +5 */}
      {[-5, 0, 5].map((s) => {
        const a = scoreToAngle(s);
        const p1 = pointOnArc(a, GAUGE_R - 4);
        const p2 = pointOnArc(a, GAUGE_R + 4);
        const labelP = pointOnArc(a, GAUGE_R + 14);
        return (
          <g key={s}>
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-slate-400 dark:text-slate-500"
            />
            <text
              x={labelP.x}
              y={labelP.y + 4}
              textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-400"
              style={{ fontSize: '10px', fontWeight: 600 }}
            >
              {s > 0 ? `+${s}` : s}
            </text>
          </g>
        );
      })}

      {/* المؤشر (الإبرة) — يُرسم للأعلى ثم يُدوَّر */}
      <g
        style={{
          transform: `rotate(${needleRot}deg)`,
          transformOrigin: `${GAUGE_CX}px ${GAUGE_CY}px`,
          transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <line
          x1={GAUGE_CX}
          y1={GAUGE_CY}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          className="text-slate-900 dark:text-white"
        />
        {/* رأس الإبرة (دائرة صغيرة) */}
        <circle
          cx={needleTip.x}
          cy={needleTip.y}
          r={3}
          className="fill-slate-900 dark:fill-white"
        />
      </g>
      {/* محور المؤشر */}
      <circle
        cx={GAUGE_CX}
        cy={GAUGE_CY}
        r={6}
        className="fill-slate-900 dark:fill-white"
      />
      <circle
        cx={GAUGE_CX}
        cy={GAUGE_CY}
        r={3}
        className="fill-slate-100 dark:fill-slate-900"
      />
    </svg>
  );
}

// ============================================================
// Divergence badge
// ============================================================

function divergenceStyle(regime: DivergenceInfo['regime']): {
  bg: string;
  text: string;
  border: string;
  icon: React.ComponentType<{ className?: string }>;
} {
  switch (regime) {
    case 'HEALTHY_BULL':
      return {
        bg: 'bg-emerald-50 dark:bg-emerald-950/50',
        text: 'text-emerald-700 dark:text-emerald-300',
        border: 'border-emerald-200 dark:border-emerald-800',
        icon: ArrowUpRight,
      };
    case 'DISTRIBUTION':
      return {
        bg: 'bg-amber-50 dark:bg-amber-950/50',
        text: 'text-amber-700 dark:text-amber-300',
        border: 'border-amber-200 dark:border-amber-800',
        icon: AlertTriangle,
      };
    case 'SPECULATION':
      return {
        bg: 'bg-orange-50 dark:bg-orange-950/50',
        text: 'text-orange-700 dark:text-orange-300',
        border: 'border-orange-200 dark:border-orange-800',
        icon: Flame,
      };
    case 'BEAR':
      return {
        bg: 'bg-rose-50 dark:bg-rose-950/50',
        text: 'text-rose-700 dark:text-rose-300',
        border: 'border-rose-200 dark:border-rose-800',
        icon: ArrowDownRight,
      };
    default:
      return {
        bg: 'bg-slate-50 dark:bg-slate-900/50',
        text: 'text-slate-700 dark:text-slate-300',
        border: 'border-slate-200 dark:border-slate-800',
        icon: AlertTriangle,
      };
  }
}

function pulseColorClasses(color: PulseInfo['color']): string {
  switch (color) {
    case 'emerald':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'green':
      return 'text-green-600 dark:text-green-400';
    case 'amber':
      return 'text-amber-600 dark:text-amber-400';
    case 'orange':
      return 'text-orange-600 dark:text-orange-400';
    case 'rose':
      return 'text-rose-600 dark:text-rose-400';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

// ============================================================
// Mini index card (EGX30 / EGX70)
// ============================================================

function IndexMiniCard({
  label,
  idx,
}: {
  label: string;
  idx: IndexSnapshot | null | undefined;
}) {
  const up = (idx?.change_percent ?? 0) >= 0;
  const hasData = !!idx && typeof idx.value === 'number';
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </span>
        {hasData && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums',
              up
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400',
            )}
            dir="ltr"
          >
            {up ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {fmtPct(idx?.change_percent)}
          </span>
        )}
      </div>
      <div
        className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white"
        dir="ltr"
      >
        {hasData ? fmtNum(idx?.value) : '—'}
      </div>
      <div className="text-[10px] text-slate-400 dark:text-slate-500" dir="ltr">
        إغلاق سابق: {hasData ? fmtNum(idx?.previous_close) : '—'}
      </div>
    </div>
  );
}

// ============================================================
// Breadth bar
// ============================================================

function BreadthBar({
  gainers,
  losers,
  unchanged,
}: {
  gainers: number;
  losers: number;
  unchanged: number;
}) {
  const total = Math.max(1, gainers + losers + unchanged);
  const gPct = (gainers / total) * 100;
  const lPct = (losers / total) * 100;
  const uPct = (unchanged / total) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-medium">
        <span className="text-emerald-600 dark:text-emerald-400">
          ▲ {gainers} صاعد
        </span>
        <span className="text-slate-400 dark:text-slate-500">
          {unchanged} ثابت
        </span>
        <span className="text-rose-600 dark:text-rose-400">
          ▼ {losers} هابط
        </span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full bg-emerald-500 transition-all duration-700 ease-out"
          style={{ width: `${gPct}%` }}
        />
        <div
          className="h-full bg-slate-300 dark:bg-slate-600 transition-all duration-700 ease-out"
          style={{ width: `${uPct}%` }}
        />
        <div
          className="h-full bg-rose-500 transition-all duration-700 ease-out"
          style={{ width: `${lPct}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================
// Loading skeleton
// ============================================================

function PulseSkeleton() {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <Skeleton className="mx-auto h-28 w-56" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}

// ============================================================
// Main component
// ============================================================

const REFRESH_INTERVAL_MS = 10_000;

export function MarketPulseWidget() {
  const [data, setData] = useState<MarketPulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFresh, setIsFresh] = useState(false);
  const [lastUpdateStr, setLastUpdateStr] = useState<string>('—');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const freshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      const res = await fetch('/api/market-pulse', {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json: ApiResponse = await res.json();
      // الـ API قد يرجع البيانات مباشرة أو داخل `data`
      const payload: MarketPulseData | undefined =
        (json && (json.data as MarketPulseData | undefined)) ||
        (json as unknown as MarketPulseData);

      if (!payload || (json.success === false && !json.data)) {
        throw new Error(json.error ?? 'استجابة غير صالحة');
      }

      setData(payload);
      setError(null);
      setIsFresh(true);
      if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
      freshTimerRef.current = setTimeout(() => setIsFresh(false), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
      setError(msg);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // الجلب الأولي + التحديث الدوري — P37-PHASE-2B-4A: visibility-aware polling
  // (clears the interval when the tab is hidden, fires immediately on resume).
  // The 1-second "آخر تحديث" clock ticker below stays on its own cadence.
  useEffect(() => {
    void fetchData();
    return () => {
      if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useVisibilityAwarePolling(() => { void fetchData(); }, REFRESH_INTERVAL_MS, [fetchData]);

  // تحديث نص "آخر تحديث: منذ X" كل ثانية
  useEffect(() => {
    if (!data?.latest_update) {
      setLastUpdateStr('—');
      return;
    }
    setLastUpdateStr(relTime(data.latest_update));
    const id = setInterval(() => {
      setLastUpdateStr(relTime(data?.latest_update));
    }, 1000);
    return () => clearInterval(id);
  }, [data?.latest_update]);

  if (loading && !data) {
    return <PulseSkeleton />;
  }

  const hasError = !!error && !data;

  if (hasError) {
    return (
      <Card className="gap-2 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-rose-500" />
            نبض السوق
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <WifiOff className="h-8 w-8 text-rose-400" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                انقطاع الاتصال
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                تعذّر جلب بيانات نبض السوق
              </p>
            </div>
            <button
              onClick={() => void fetchData()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              إعادة المحاولة
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const pulse = data.pulse;
  const div = data.divergence;
  const divStyle = divergenceStyle(div?.regime);
  const DivIcon = divStyle.icon;
  const bread = data.bread;
  const top = data.top_sector;
  const isOpen = data.market_status === 'OPEN';

  return (
    <Card
      className={cn(
        'relative overflow-hidden gap-3 py-4 transition-all duration-500',
        isFresh
          ? 'ring-2 ring-emerald-400/40 dark:ring-emerald-500/30 shadow-md'
          : 'shadow-sm',
      )}
      dir="rtl"
    >
      {/* رأس البطاقة */}
      <CardHeader className="px-4 pb-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md',
                isOpen
                  ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400',
              )}
            >
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">نبض السوق</CardTitle>
              <CardDescription className="text-[10px]">
                Market Pulse
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* مؤشر مباشر */}
            <span className="relative flex h-2 w-2">
              {isOpen && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={cn(
                  'relative inline-flex h-2 w-2 rounded-full',
                  isOpen
                    ? 'bg-emerald-500'
                    : 'bg-slate-400 dark:bg-slate-600',
                )}
              />
            </span>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              {isOpen ? 'مباشر' : 'مغلق'}
            </span>

            {/* مؤشر انقطاع الاتصال */}
            {error && (
              <Badge
                variant="outline"
                className="border-rose-300 bg-rose-50 text-[9px] text-rose-600 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-400"
              >
                <WifiOff className="h-2.5 w-2.5" />
                انقطاع
              </Badge>
            )}

            {/* زر التحديث اليدوي */}
            <button
              onClick={() => void fetchData()}
              disabled={isRefreshing}
              title="تحديث"
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              {isRefreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4">
        {/* المقياس + التسمية */}
        <div className="flex flex-col items-center gap-1">
          <div className="relative w-full max-w-[260px]">
            <PulseGauge score={pulse?.score ?? 0} />
            {/* درجة النبض في المنتصف */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
              <span
                className={cn(
                  'font-mono text-2xl font-bold tabular-nums leading-none',
                  pulseColorClasses(pulse?.color),
                )}
                dir="ltr"
              >
                {pulse ? (pulse.score >= 0 ? `+${pulse.score.toFixed(1)}` : pulse.score.toFixed(1)) : '—'}
              </span>
              <span className="text-[9px] text-slate-400 dark:text-slate-500">
                من +5
              </span>
            </div>
          </div>

          <div className="text-center">
            <div
              className={cn(
                'text-xl font-bold leading-tight transition-colors',
                pulseColorClasses(pulse?.color),
              )}
            >
              {pulse?.label ?? '—'}
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {pulse?.label_en ?? ''}
            </div>
          </div>
        </div>

        {/* EGX30 + EGX70 */}
        <div className="grid grid-cols-2 gap-2">
          <IndexMiniCard label="EGX 30" idx={data.egx30} />
          <IndexMiniCard label="EGX 70" idx={data.egx70} />
        </div>

        {/* نظام التباعد */}
        {div && (
          <div
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2',
              divStyle.bg,
              divStyle.border,
            )}
          >
            <div className="flex items-center gap-2">
              <DivIcon className={cn('h-4 w-4', divStyle.text)} />
              <div>
                <div className={cn('text-xs font-bold', divStyle.text)}>
                  {div.regime_ar}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  التباعد: {fmtPct(div.value)} • {div.action_ar}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* اتساع السوق */}
        <div className="rounded-lg border border-slate-200 bg-white/60 p-2.5 dark:border-slate-800 dark:bg-slate-950/30">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              اتساع السوق
            </span>
            {bread && (
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                السيولة: {fmtVolume(bread.total_turnover)} ج.م
              </span>
            )}
          </div>
          {bread ? (
            <BreadthBar
              gainers={bread.gainers}
              losers={bread.losers}
              unchanged={bread.unchanged}
            />
          ) : (
            <Skeleton className="h-2 w-full" />
          )}
        </div>

        {/* القطاع الأكثر نشاطاً */}
        {top && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-gradient-to-l from-emerald-50/60 to-transparent px-2.5 py-2 dark:border-slate-800 dark:from-emerald-950/30">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                {top.avg_change >= 0 ? (
                  <Signal className="h-3.5 w-3.5" />
                ) : (
                  <Snowflake className="h-3.5 w-3.5" />
                )}
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  القطاع الأكثر امتصاصاً للسيولة
                </div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {top.sector}
                </div>
              </div>
            </div>
            <div className="text-left" dir="ltr">
              <div className="text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {fmtPct(top.turnover_pct)}
              </div>
              <div
                className={cn(
                  'text-[10px] tabular-nums',
                  top.avg_change >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {fmtPct(top.avg_change)}
              </div>
            </div>
          </div>
        )}

        {/* آخر تحديث */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <span>آخر تحديث: {lastUpdateStr}</span>
          <span dir="ltr" className="tabular-nums">
            {data.cairo_time?.split(' ')?.[1] ?? ''}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default MarketPulseWidget;

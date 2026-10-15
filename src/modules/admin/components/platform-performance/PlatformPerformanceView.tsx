'use client';

/**
 * PlatformPerformanceView.tsx — لوحة أدمن «كفاءة المنصة»
 * =====================================================
 * Admin Only — لا تظهر للعميل.
 *
 * تعرض:
 *   1. KPI cards (Win Rate, PF, Expectancy, Max Loss, TP1/Stop hit rates)
 *   2. أفضل الصفقات المحترمة (Top 20)
 *   3. تحقق المستهدفات (Target Hits)
 *   4. أسوأ الصفقات (Worst 10) — إجباري للشفافية
 *   5. مقارنة القنوات (balanced vs morning_bell)
 *   6. صندوق قرار الجاهزية للخارج (إرشادي)
 *
 * الهوية: دليل الاستثمار (Investment Guide)
 * شارة: للتقييم الداخلي — Admin Only
 *
 * قراءة فقط — لا كتابة على DB.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  Award,
  AlertTriangle,
  BarChart3,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Gauge,
  Percent,
  Trophy,
  Skull,
  Layers,
  Info,
} from 'lucide-react';

// ============================================================================
// Types (تطابق ما يرجعه /api/admin/platform-performance)
// ============================================================================

interface Trade {
  id: number;
  ticker: string;
  persona: string | null;
  is_morning_bell: boolean;
  prediction_date: string;
  entry_price: number;
  target_price: number | null;
  target_price_2: number | null;
  stop_loss: number | null;
  exit_price: number | null;
  actual_return: number;
  hit_target: 0 | 1;
  hit_stop: 0 | 1;
  status: string;
  holding_days: number | null;
  outcome_date: string | null;
  highest_price: number | null;
  lowest_price: number | null;
  channel: 'balanced' | 'morning_bell';
  market: string;
  capped: boolean;
  valid: boolean;
  exclusion_reason: string | null;
}

interface KPIs {
  n_raw: number;
  n_valid: number;
  n_excluded: number;
  n_open: number;
  win_rate: number;
  profit_factor: number;
  expectancy_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  max_loss_pct: number;
  max_win_pct: number;
  tp1_hit_rate: number;
  stop_hit_rate: number;
  expired_rate: number;
  hard_capped_count: number;
  exclusion_breakdown: Record<string, number>;
}

interface ChannelStats {
  channel: string;
  n: number;
  win_rate: number;
  profit_factor: number;
  expectancy_pct: number;
  max_loss_pct: number;
}

interface MarketStats {
  market: string;
  n_raw: number;
  n_valid: number;
  win_rate: number;
  profit_factor: number;
  expectancy_pct: number;
  max_loss_pct: number;
}

interface ReadinessBox {
  n_sufficient: boolean;
  pf_passes: boolean;
  max_loss_reasonable: boolean;
  recommendation: 'internal' | 'candidate';
  recommendation_ar: string;
  notes_ar: string[];
}

interface PlatformPerformanceData {
  success: boolean;
  generated_at: string;
  filters: {
    period: string;
    channel: string;
    market: string;
    min_return: number;
    date_from: string | null;
    date_to: string | null;
  };
  kpis: KPIs | null;
  top_trades: Trade[];
  worst_trades: Trade[];
  target_hits: Trade[];
  by_channel: ChannelStats[];
  by_market: MarketStats[];
  excluded_examples: Trade[];
  readiness: ReadinessBox | null;
  data_sources: string[];
  data_missing: string[];
  sample_note_ar: string;
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(digits) + '%';
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { // silent fallback (safe-by-design)
    return s;
  }
}

function channelLabel(ch: string): string {
  if (ch === 'morning_bell') return 'جرس الصباح';
  if (ch === 'balanced') return 'المتوازن';
  return ch;
}

function returnColor(ret: number): string {
  if (ret >= 0) return 'text-stitch-primary dark:text-stitch-primary dark:text-primary font-semibold tabular-nums dark:font-financial';
  return 'text-rose-400 dark:text-rose-400 dark:text-error font-semibold tabular-nums dark:font-financial';
}

// ============================================================================
// KPI Card component
// ============================================================================

function KPICard({
  label,
  value,
  sublabel,
  icon,
  variant = 'default',
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const colorClasses = {
    default: 'text-stitch-on-surface dark:text-on-surface',
    success: 'text-stitch-primary dark:text-stitch-primary dark:text-primary',
    warning: 'text-amber-600 dark:text-amber-400 dark:text-on-surface-variant',
    danger: 'text-rose-400 dark:text-rose-400 dark:text-error',
  };
  const borderClasses = {
    default: 'border-border/60 dark:border-outline-variant/30',
    success: 'border-emerald-500/30 dark:border-emerald-500/30/50 dark:border-primary-container/40',
    warning: 'border-amber-200 dark:border-amber-800/50 dark:border-outline-variant/30',
    danger: 'border-rose-500/30 dark:border-rose-500/30/50 dark:border-error-container/40',
  };
  return (
    <Card className={`border ${borderClasses[variant]} shadow-xs dark:bg-surface-container-low dark:font-financial`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-stitch-muted dark:text-on-surface-variant dark:font-outfit">{label}</span>
          <div className="text-stitch-muted/70 dark:text-on-surface-variant">{icon}</div>
        </div>
        <div className={`text-2xl font-bold tabular-nums dark:font-financial ${colorClasses[variant]}`}>{value}</div>
        {sublabel && (
          <div className="text-xs text-stitch-muted mt-1 dark:text-on-surface-variant dark:font-outfit">{sublabel}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Trade table row
// ============================================================================

function TradeRow({ trade, showChannel = true, showMarket = true }: { trade: Trade; showChannel?: boolean; showMarket?: boolean }) {
  return (
    <tr className="border-b hover:bg-secondary/30 transition-colors dark:border-outline-variant/20 dark:hover:bg-surface-container-low">
      <td className="px-2 py-2 text-xs stitch-num font-medium tabular-nums dark:font-financial dark:text-on-surface">{trade.ticker}</td>
      {showMarket && (
        <td className="px-2 py-2 text-xs">
          <Badge variant="outline" className="text-[10px] stitch-num tabular-nums dark:font-financial dark:border-outline-variant/40 dark:text-on-surface-variant">{trade.market}</Badge>
        </td>
      )}
      {showChannel && (
        <td className="px-2 py-2 text-xs">
          <Badge variant="outline" className="text-[10px] dark:border-outline-variant/40 dark:text-on-surface-variant">
            {channelLabel(trade.channel)}
          </Badge>
        </td>
      )}
      <td className="px-2 py-2 text-xs text-stitch-muted dark:text-on-surface-variant dark:font-outfit">{fmtDate(trade.prediction_date)}</td>
      <td className="px-2 py-2 text-xs stitch-num tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{fmtPrice(trade.entry_price)}</td>
      <td className="px-2 py-2 text-xs stitch-num tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{fmtPrice(trade.stop_loss)}</td>
      <td className="px-2 py-2 text-xs stitch-num tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{fmtPrice(trade.target_price)}</td>
      <td className="px-2 py-2 text-xs stitch-num tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{fmtPrice(trade.exit_price ?? trade.highest_price)}</td>
      <td className={`px-2 py-2 text-xs ${returnColor(trade.actual_return)}`} dir="ltr">
        {fmtPct(trade.actual_return)}
        {trade.capped && (
          <Badge variant="outline" className="ml-1 text-[9px] border-amber-300 text-amber-700 px-1 py-0 dark:border-amber-700/50 dark:text-amber-300">capped</Badge>
        )}
      </td>
      <td className="px-2 py-2 text-xs text-stitch-muted tabular-nums dark:text-on-surface-variant dark:font-financial">
        {trade.holding_days !== null ? `${trade.holding_days}ي` : '—'}
      </td>
      <td className="px-2 py-2 text-xs">
        {trade.hit_target === 1 ? (
          <Badge className="bg-emerald-500/10 text-stitch-primary hover:bg-emerald-500/10 text-[10px] dark:bg-primary-container/30 dark:text-primary dark:hover:bg-primary-container/40 dark:border-transparent">هدف ✓</Badge>
        ) : trade.hit_stop === 1 ? (
          <Badge className="bg-rose-500/10 text-rose-400 hover:bg-rose-500/10 text-[10px] dark:bg-error-container/30 dark:text-error dark:hover:bg-error-container/40 dark:border-transparent">وقف ✗</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] dark:border-outline-variant/40 dark:text-on-surface-variant">{trade.status}</Badge>
        )}
      </td>
    </tr>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PlatformPerformanceView() {
  const [data, setData] = useState<PlatformPerformanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>('30d');
  const [channel, setChannel] = useState<string>('all');
  const [market, setMarket] = useState<string>('all');
  const [minReturn, setMinReturn] = useState<string>('8.0');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('period', period);
      params.set('channel', channel);
      params.set('market', market);
      params.set('min_return', minReturn);
      const res = await fetch(`/api/admin/platform-performance?${params}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `فشل تحميل البيانات (HTTP ${res.status})`);
      }
      setData(json);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, channel, market, minReturn]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const kpis = data?.kpis;
  const readiness = data?.readiness;
  const insufficientData = kpis && kpis.n_valid === 0;

  return (
    <div className="space-y-4 dark:bg-surface-container-lowest" dir="rtl">
      {/* === Branding Header === */}
      <Card className="border-2 border-primary/20 bg-gradient-to-l from-primary/5 to-transparent dark:bg-surface-container-low dark:border-primary-container/40 dark:bg-gradient-to-l dark:from-primary-container/10 dark:to-transparent">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Gauge className="h-6 w-6 text-primary dark:text-primary" />
                <h2 className="text-xl sm:text-2xl font-bold dark:text-on-surface dark:font-outfit">كفاءة المنصة</h2>
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-xs dark:bg-surface-container-high dark:text-on-surface-variant dark:hover:bg-surface-container-high dark:border dark:border-outline-variant/30">
                  للتقييم الداخلي — Admin Only
                </Badge>
              </div>
              <p className="text-sm text-stitch-muted dark:text-on-surface-variant dark:font-outfit">
                منصة «دليل الاستثمار» — أرقام حقيقية بدون تجميل
              </p>
              <p className="text-xs text-stitch-muted/70 mt-1 dark:text-on-surface-variant dark:font-outfit">
                {data ? `آخر تحديث: ${new Date(data.generated_at).toLocaleString('ar-EG')}` : 'جارٍ التحميل...'}
              </p>
            </div>
            <div className="text-left text-xs text-stitch-muted dark:text-on-surface-variant dark:font-financial tabular-nums">
              <div>invist.m2y.net</div>
              <div className="mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchData}
                  disabled={loading}
                  className="h-7 text-xs dark:bg-surface-container dark:border-outline-variant/30 dark:text-on-surface dark:hover:bg-surface-container-high"
                >
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin ml-1 dark:text-primary" />
                  ) : (
                    <RefreshCw className="h-3 w-3 ml-1 dark:text-primary" />
                  )}
                  تحديث
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === Filters === */}
      <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-stitch-muted dark:text-on-surface-variant dark:font-outfit">الفترة</label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-9 text-sm dark:bg-surface-container dark:border-outline-variant/30 dark:text-on-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="dark:bg-surface-container-high dark:border dark:border-outline-variant/30">
                  <SelectItem value="today">اليوم</SelectItem>
                  <SelectItem value="7d">آخر 7 أيام</SelectItem>
                  <SelectItem value="30d">آخر 30 يوم</SelectItem>
                  <SelectItem value="all">الكل (من 2026-01)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-stitch-muted dark:text-on-surface-variant dark:font-outfit">السوق</label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="h-9 text-sm dark:bg-surface-container dark:border-outline-variant/30 dark:text-on-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="dark:bg-surface-container-high dark:border dark:border-outline-variant/30">
                  <SelectItem value="all">كل الأسواق</SelectItem>
                  <SelectItem value="EGX">EGX (مصر)</SelectItem>
                  <SelectItem value="CRYPTO">كريبتو</SelectItem>
                  <SelectItem value="KSE">KSE (الكويت)</SelectItem>
                  <SelectItem value="TADAWUL">TADAWUL (السعودية)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-stitch-muted dark:text-on-surface-variant dark:font-outfit">القناة</label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="h-9 text-sm dark:bg-surface-container dark:border-outline-variant/30 dark:text-on-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="dark:bg-surface-container-high dark:border dark:border-outline-variant/30">
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="balanced">المتوازن</SelectItem>
                  <SelectItem value="morning_bell">جرس الصباح</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-stitch-muted dark:text-on-surface-variant dark:font-outfit">حد «صفقة محترمة» (%)</label>
              <Select value={minReturn} onValueChange={setMinReturn}>
                <SelectTrigger className="h-9 text-sm dark:bg-surface-container dark:border-outline-variant/30 dark:text-on-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="dark:bg-surface-container-high dark:border dark:border-outline-variant/30">
                  <SelectItem value="5.0">+5%</SelectItem>
                  <SelectItem value="8.0">+8%</SelectItem>
                  <SelectItem value="10.0">+10%</SelectItem>
                  <SelectItem value="15.0">+15%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === Error === */}
      {error && (
        <Alert variant="destructive" className="dark:bg-error-container/20 dark:border-error-container/40">
          <AlertTriangle className="h-4 w-4 dark:text-error" />
          <AlertTitle className="dark:text-error dark:font-outfit">تعذر تحميل البيانات</AlertTitle>
          <AlertDescription className="text-sm dark:text-on-surface-variant">{error}</AlertDescription>
        </Alert>
      )}

      {/* === Insufficient data === */}
      {insufficientData && !loading && !error && (
        <Alert className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <Info className="h-4 w-4 dark:text-primary" />
          <AlertTitle className="dark:text-on-surface dark:font-outfit">لا توجد بيانات كافية</AlertTitle>
          <AlertDescription className="text-sm dark:text-on-surface-variant">لا توجد صفقات مغلقة في الفترة المحددة. جرّب توسيع الفترة (مثلاً «الكل»).</AlertDescription>
        </Alert>
      )}

      {/* === Sample note === */}
      {data && data.sample_note_ar && !insufficientData && (
        <Alert className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <Info className="h-4 w-4 dark:text-primary" />
          <AlertDescription className="text-sm dark:text-on-surface-variant">{data.sample_note_ar}</AlertDescription>
        </Alert>
      )}

      {/* === KPI Cards === */}
      {kpis && !insufficientData && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <KPICard
            label="الصفقات الصالحة للقياس"
            value={String(kpis.n_valid)}
            sublabel={`من أصل ${kpis.n_raw} (مستبعد: ${kpis.n_excluded})`}
            icon={<BarChart3 className="h-4 w-4" />}
          />
          <KPICard
            label="Win Rate"
            value={fmtNum(kpis.win_rate, 1) + '%'}
            sublabel={`TP1: ${fmtNum(kpis.tp1_hit_rate, 0)}% | Stop: ${fmtNum(kpis.stop_hit_rate, 0)}%`}
            icon={<Target className="h-4 w-4" />}
            variant={kpis.win_rate >= 50 ? 'success' : 'warning'}
          />
          <KPICard
            label="Profit Factor"
            value={fmtNum(kpis.profit_factor)}
            sublabel={kpis.profit_factor >= 1.3 ? 'مقبول (≥ 1.3)' : 'ضعيف (< 1.3)'}
            icon={<Activity className="h-4 w-4" />}
            variant={kpis.profit_factor >= 1.3 ? 'success' : 'warning'}
          />
          <KPICard
            label="Expectancy"
            value={fmtPct(kpis.expectancy_pct)}
            sublabel="متوسط عائد الصفقة"
            icon={<TrendingUp className="h-4 w-4" />}
            variant={kpis.expectancy_pct >= 0 ? 'success' : 'danger'}
          />
          <KPICard
            label="متوسط الربح"
            value={fmtPct(kpis.avg_win_pct)}
            sublabel="للصفقات الرابحة"
            icon={<Award className="h-4 w-4" />}
            variant="success"
          />
          <KPICard
            label="متوسط الخسارة"
            value={fmtPct(kpis.avg_loss_pct)}
            sublabel="للصفقات الخاسرة"
            icon={<TrendingDown className="h-4 w-4" />}
            variant="danger"
          />
          <KPICard
            label="Max Loss"
            value={fmtPct(kpis.max_loss_pct)}
            sublabel={kpis.max_loss_pct >= -20 ? 'ضمن نطاق الوقف' : 'خارج نطاق الوقف'}
            icon={<ShieldAlert className="h-4 w-4" />}
            variant={kpis.max_loss_pct >= -20 ? 'default' : 'danger'}
          />
          <KPICard
            label="Max Win"
            value={fmtPct(kpis.max_win_pct)}
            sublabel={kpis.hard_capped_count > 0 ? `${kpis.hard_capped_count} صفقة وصلت للحد الأقصى (50%)` : 'بدون حد أقصى'}
            icon={<Trophy className="h-4 w-4" />}
            variant="success"
          />
        </div>
      )}

      {/* === Readiness Box === */}
      {readiness && !insufficientData && (
        <Card className={readiness.recommendation === 'candidate' ? 'border-emerald-500/30 bg-emerald-50/50 dark:bg-primary-container/10 dark:border-primary-container/40' : 'border-amber-300 bg-amber-50/50 dark:bg-surface-container-low dark:border-outline-variant/30'}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {readiness.recommendation === 'candidate' ? (
                <ShieldCheck className="h-6 w-6 text-stitch-primary flex-shrink-0 dark:text-primary" />
              ) : (
                <ShieldAlert className="h-6 w-6 text-amber-600 flex-shrink-0 dark:text-on-surface-variant" />
              )}
              <div className="flex-1">
                <h3 className="text-base font-semibold mb-1 dark:text-on-surface dark:font-outfit">
                  قرار الجاهزية: {readiness.recommendation_ar}
                </h3>
                <div className="space-y-1">
                  {readiness.notes_ar.map((note, i) => (
                    <div key={i} className="text-xs text-stitch-muted flex items-start gap-1.5 dark:text-on-surface-variant dark:font-outfit">
                      <span className="text-stitch-muted/50 mt-0.5 dark:text-on-surface-variant/50">•</span>
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
                <Separator className="my-2 dark:bg-outline-variant/30" />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-stitch-muted dark:text-on-surface-variant dark:font-financial tabular-nums">n ≥ 30: </span>
                    <Badge variant={readiness.n_sufficient ? 'default' : 'outline'} className="text-[10px] dark:bg-primary-container dark:text-on-primary-container dark:border-transparent">
                      {readiness.n_sufficient ? 'نعم' : 'لا'}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-stitch-muted dark:text-on-surface-variant dark:font-financial tabular-nums">PF ≥ 1.3: </span>
                    <Badge variant={readiness.pf_passes ? 'default' : 'outline'} className="text-[10px] dark:bg-primary-container dark:text-on-primary-container dark:border-transparent">
                      {readiness.pf_passes ? 'نعم' : 'لا'}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-stitch-muted dark:text-on-surface-variant dark:font-financial tabular-nums">وقف معقول: </span>
                    <Badge variant={readiness.max_loss_reasonable ? 'default' : 'outline'} className="text-[10px] dark:bg-primary-container dark:text-on-primary-container dark:border-transparent">
                      {readiness.max_loss_reasonable ? 'نعم' : 'لا'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Top Trades === */}
      {data && data.top_trades.length > 0 && (
        <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base dark:text-on-surface dark:font-outfit">
              <Trophy className="h-5 w-5 text-stitch-primary dark:text-primary" />
              أفضل الصفقات المحترمة (Top {data.top_trades.length})
              <Badge variant="outline" className="text-xs dark:border-outline-variant/40 dark:text-on-surface-variant dark:font-financial tabular-nums">≥ +{minReturn}%</Badge>
            </CardTitle>
            <CardDescription className="text-xs dark:text-on-surface-variant">
              صفقات مغلقة حققت عائداً ≥ {minReturn}%
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-secondary/50 text-xs text-stitch-muted dark:bg-surface-container-low dark:text-on-surface-variant">
                  <tr>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">السهم</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">السوق</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">القناة</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">التاريخ</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">دخول</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">وقف</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">هدف</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">خروج</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">عائد</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">المدة</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_trades.map((t) => (
                    <TradeRow key={t.id} trade={t} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Target Hits === */}
      {data && data.target_hits.length > 0 && (
        <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base dark:text-on-surface dark:font-outfit">
              <Target className="h-5 w-5 text-stitch-primary dark:text-primary" />
              تحقق المستهدفات ({data.target_hits.length})
            </CardTitle>
            <CardDescription className="text-xs dark:text-on-surface-variant">
              صفقات لمست الهدف أو أعلى نقطة
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-secondary/50 text-xs text-stitch-muted dark:bg-surface-container-low dark:text-on-surface-variant">
                  <tr>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">السهم</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">القناة</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">دخول</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">أعلى/خروج</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">عائد</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.target_hits.map((t) => (
                    <tr key={t.id} className="border-b hover:bg-secondary/30 dark:border-outline-variant/20 dark:hover:bg-surface-container-low">
                      <td className="px-2 py-2 text-xs stitch-num font-medium tabular-nums dark:font-financial dark:text-on-surface">{t.ticker}</td>
                      <td className="px-2 py-2 text-xs">
                        <Badge variant="outline" className="text-[10px] dark:border-outline-variant/40 dark:text-on-surface-variant">{channelLabel(t.channel)}</Badge>
                      </td>
                      <td className="px-2 py-2 text-xs stitch-num tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{fmtPrice(t.entry_price)}</td>
                      <td className="px-2 py-2 text-xs stitch-num tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{fmtPrice(t.highest_price ?? t.exit_price)}</td>
                      <td className={`px-2 py-2 text-xs ${returnColor(t.actual_return)}`} dir="ltr">{fmtPct(t.actual_return)}</td>
                      <td className="px-2 py-2 text-xs">
                        <Badge className="bg-emerald-500/10 text-stitch-primary hover:bg-emerald-500/10 text-[10px] dark:bg-primary-container/30 dark:text-primary dark:hover:bg-primary-container/40 dark:border-transparent">تحقق ✓</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Worst Trades (إجباري) === */}
      {data && data.worst_trades.length > 0 && (
        <Card className="border-rose-500/30 dark:border-rose-500/30/50 dark:bg-surface-container-low dark:border-error-container/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-rose-400 dark:text-rose-400 dark:text-error">
              <Skull className="h-5 w-5 dark:text-error" />
              أسوأ الصفقات (Worst {data.worst_trades.length})
              <Badge variant="outline" className="text-xs border-rose-500/30 text-rose-400 dark:border-error-container/40 dark:text-error">شفافية داخلية</Badge>
            </CardTitle>
            <CardDescription className="text-xs dark:text-on-surface-variant">
              أسوأ الصفقات بدون إخفاء — للأمانة الداخلية
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-secondary/50 text-xs text-stitch-muted dark:bg-surface-container-low dark:text-on-surface-variant">
                  <tr>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">السهم</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">السوق</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">القناة</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">التاريخ</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">دخول</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">وقف</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">هدف</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">عائد</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.worst_trades.map((t) => (
                    <TradeRow key={t.id} trade={t} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Excluded Examples (شفافية) === */}
      {data && data.excluded_examples.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800/50 dark:bg-surface-container-low dark:border-outline-variant/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400 dark:text-on-surface-variant">
              <AlertTriangle className="h-5 w-5 dark:text-on-surface-variant" />
              صفقات مستبعدة من القياس ({data.excluded_examples.length})
              <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 dark:border-outline-variant dark:text-on-surface-variant">شفافية</Badge>
            </CardTitle>
            <CardDescription className="text-xs dark:text-on-surface-variant">
              صفقات استُبعدت من KPI بسبب تكرار/دخول=0/خروج غير منطقي
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-secondary/50 text-xs text-stitch-muted dark:bg-surface-container-low dark:text-on-surface-variant">
                  <tr>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">السهم</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">السوق</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">دخول</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">خروج</th>
                    <th className="px-2 py-2 font-medium dark:text-on-surface dark:font-outfit">سبب الاستبعاد</th>
                  </tr>
                </thead>
                <tbody>
                  {data.excluded_examples.map((t) => (
                    <tr key={t.id} className="border-b dark:border-outline-variant/20">
                      <td className="px-2 py-2 text-xs stitch-num tabular-nums dark:font-financial dark:text-on-surface">{t.ticker}</td>
                      <td className="px-2 py-2 text-xs">
                        <Badge variant="outline" className="text-[10px] stitch-num tabular-nums dark:font-financial dark:border-outline-variant/40 dark:text-on-surface-variant">{t.market}</Badge>
                      </td>
                      <td className="px-2 py-2 text-xs stitch-num tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{fmtPrice(t.entry_price)}</td>
                      <td className="px-2 py-2 text-xs stitch-num tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{fmtPrice(t.exit_price)}</td>
                      <td className="px-2 py-2 text-xs">
                        <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:border-outline-variant dark:text-on-surface-variant">
                          {t.exclusion_reason || 'unknown'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === By Market === */}
      {data && data.by_market.length > 0 && (
        <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base dark:text-on-surface dark:font-outfit">
              <Layers className="h-5 w-5 text-primary dark:text-primary" />
              كفاءة الأسواق (مقارنة)
            </CardTitle>
            <CardDescription className="text-xs dark:text-on-surface-variant">
              مقارنة الأداء بين الأسواق — بدون خلط
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-secondary/50 text-xs text-stitch-muted dark:bg-surface-container-low dark:text-on-surface-variant">
                  <tr>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">السوق</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">n_raw</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">n_valid</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">Win Rate</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">Profit Factor</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">Expectancy</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">Max Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_market.map((m) => (
                    <tr key={m.market} className="border-b hover:bg-secondary/30 dark:border-outline-variant/20 dark:hover:bg-surface-container-low">
                      <td className="px-3 py-2 text-sm font-medium">
                        <Badge variant="outline" className="stitch-num tabular-nums dark:font-financial dark:border-outline-variant/40 dark:text-on-surface">{m.market}</Badge>
                      </td>
                      <td className="px-3 py-2 text-sm text-stitch-muted tabular-nums dark:text-on-surface-variant dark:font-financial">{m.n_raw}</td>
                      <td className="px-3 py-2 text-sm font-medium tabular-nums dark:text-on-surface dark:font-financial">{m.n_valid}</td>
                      <td className="px-3 py-2 text-sm tabular-nums dark:font-financial dark:text-on-surface">{fmtNum(m.win_rate, 1)}%</td>
                      <td className={`px-3 py-2 text-sm tabular-nums dark:font-financial ${m.profit_factor >= 1.3 ? 'text-stitch-primary font-medium dark:text-primary' : 'text-amber-600 dark:text-on-surface-variant'}`}>
                        {fmtNum(m.profit_factor)}
                      </td>
                      <td className={`px-3 py-2 text-sm tabular-nums dark:font-financial ${m.expectancy_pct >= 0 ? 'text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-error'}`} dir="ltr">
                        {fmtPct(m.expectancy_pct)}
                      </td>
                      <td className="px-3 py-2 text-sm text-rose-400 tabular-nums dark:font-financial dark:text-error" dir="ltr">{fmtPct(m.max_loss_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === By Channel === */}
      {data && data.by_channel.length > 0 && (
        <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base dark:text-on-surface dark:font-outfit">
              <Layers className="h-5 w-5 text-primary dark:text-primary" />
              كفاءة القنوات (مقارنة)
            </CardTitle>
            <CardDescription className="text-xs dark:text-on-surface-variant">
              مقارنة الأداء بين القنوات — بدون خلط إحصائيات
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-secondary/50 text-xs text-stitch-muted dark:bg-surface-container-low dark:text-on-surface-variant">
                  <tr>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">القناة</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">n</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">Win Rate</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">Profit Factor</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">Expectancy</th>
                    <th className="px-3 py-2 font-medium dark:text-on-surface dark:font-outfit">Max Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_channel.map((ch) => (
                    <tr key={ch.channel} className="border-b hover:bg-secondary/30 dark:border-outline-variant/20 dark:hover:bg-surface-container-low">
                      <td className="px-3 py-2 text-sm font-medium">
                        <Badge variant="outline" className="dark:border-outline-variant/40 dark:text-on-surface-variant">{channelLabel(ch.channel)}</Badge>
                      </td>
                      <td className="px-3 py-2 text-sm tabular-nums dark:font-financial dark:text-on-surface">{ch.n}</td>
                      <td className="px-3 py-2 text-sm tabular-nums dark:font-financial dark:text-on-surface">{fmtNum(ch.win_rate, 1)}%</td>
                      <td className={`px-3 py-2 text-sm tabular-nums dark:font-financial ${ch.profit_factor >= 1.3 ? 'text-stitch-primary font-medium dark:text-primary' : 'text-amber-600 dark:text-on-surface-variant'}`}>
                        {fmtNum(ch.profit_factor)}
                      </td>
                      <td className={`px-3 py-2 text-sm tabular-nums dark:font-financial ${ch.expectancy_pct >= 0 ? 'text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-error'}`} dir="ltr">
                        {fmtPct(ch.expectancy_pct)}
                      </td>
                      <td className="px-3 py-2 text-sm text-rose-400 tabular-nums dark:font-financial dark:text-error" dir="ltr">{fmtPct(ch.max_loss_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Data sources (footer) === */}
      {data && (
        <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <CardContent className="p-3">
            <details className="text-xs text-stitch-muted dark:text-on-surface-variant dark:font-outfit">
              <summary className="cursor-pointer hover:text-stitch-on-surface dark:hover:text-on-surface">
                مصادر البيانات ({data.data_sources.length})
              </summary>
              <div className="mt-2 space-y-1">
                <div className="flex flex-wrap gap-1">
                  {data.data_sources.map((s, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] dark:border-outline-variant/40 dark:text-on-surface-variant dark:font-financial tabular-nums">{s}</Badge>
                  ))}
                </div>
                {data.data_missing.length > 0 && (
                  <div className="mt-2">
                    <span className="text-amber-600 dark:text-on-surface-variant">بيانات ناقصة:</span>{' '}
                    {data.data_missing.join('، ')}
                  </div>
                )}
                <div className="mt-1 text-stitch-muted dark:text-on-surface-variant dark:font-financial tabular-nums">
                  HARD cap: ABS(actual_return) ≤ 50% · حساب العائد: actual_return → exit_price → hit_target/target → hit_stop/stop → null
                </div>
              </div>
            </details>
          </CardContent>
        </Card>
      )}

      {/* === Loading === */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-3 dark:text-primary" />
          <p className="text-sm text-stitch-muted dark:text-on-surface-variant dark:font-outfit">جارٍ تحميل البيانات...</p>
        </div>
      )}
    </div>
  );
}

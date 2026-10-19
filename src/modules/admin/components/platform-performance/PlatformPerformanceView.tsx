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
  } catch {
    return s;
  }
}

function channelLabel(ch: string): string {
  if (ch === 'morning_bell') return 'جرس الصباح';
  if (ch === 'balanced') return 'المتوازن';
  return ch;
}

function returnColor(ret: number): string {
  if (ret >= 0) return 'text-profit dark:text-profit font-semibold';
  return 'text-loss dark:text-loss font-semibold';
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
    default: 'text-foreground',
    success: 'text-profit dark:text-profit',
    warning: 'text-warning dark:text-warning',
    danger: 'text-loss dark:text-loss',
  };
  const borderClasses = {
    default: 'border-border',
    success: 'border-profit dark:border-profit/50',
    warning: 'border-warning dark:border-warning/50',
    danger: 'border-loss dark:border-loss/50',
  };
  return (
    <Card className={`border ${borderClasses[variant]} shadow-xs`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <div className="text-muted-foreground/70">{icon}</div>
        </div>
        <div className={`text-2xl font-bold ${colorClasses[variant]}`}>{value}</div>
        {sublabel && (
          <div className="text-xs text-muted-foreground mt-1">{sublabel}</div>
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
    <tr className="border-b hover:bg-muted/30 transition-colors">
      <td className="px-2 py-2 text-xs font-mono font-medium">{trade.ticker}</td>
      {showMarket && (
        <td className="px-2 py-2 text-xs">
          <Badge variant="outline" className="text-[10px] font-mono">{trade.market}</Badge>
        </td>
      )}
      {showChannel && (
        <td className="px-2 py-2 text-xs">
          <Badge variant="outline" className="text-[10px]">
            {channelLabel(trade.channel)}
          </Badge>
        </td>
      )}
      <td className="px-2 py-2 text-xs text-muted-foreground">{fmtDate(trade.prediction_date)}</td>
      <td className="px-2 py-2 text-xs font-mono" dir="ltr">{fmtPrice(trade.entry_price)}</td>
      <td className="px-2 py-2 text-xs font-mono" dir="ltr">{fmtPrice(trade.stop_loss)}</td>
      <td className="px-2 py-2 text-xs font-mono" dir="ltr">{fmtPrice(trade.target_price)}</td>
      <td className="px-2 py-2 text-xs font-mono" dir="ltr">{fmtPrice(trade.exit_price ?? trade.highest_price)}</td>
      <td className={`px-2 py-2 text-xs ${returnColor(trade.actual_return)}`} dir="ltr">
        {fmtPct(trade.actual_return)}
        {trade.capped && (
          <Badge variant="outline" className="ml-1 text-[9px] border-warning text-warning px-1 py-0">
            capped
          </Badge>
        )}
      </td>
      <td className="px-2 py-2 text-xs text-muted-foreground">
        {trade.holding_days !== null ? `${trade.holding_days}ي` : '—'}
      </td>
      <td className="px-2 py-2 text-xs">
        {trade.hit_target === 1 ? (
          <Badge className="bg-profit text-profit hover:bg-profit text-[10px]">هدف ✓</Badge>
        ) : trade.hit_stop === 1 ? (
          <Badge className="bg-loss text-loss hover:bg-loss text-[10px]">وقف ✗</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">{trade.status}</Badge>
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
    <div className="space-y-4" dir="rtl">
      {/* === Branding Header === */}
      <Card className="border-2 border-primary/20 bg-gradient-to-l from-primary/5 to-transparent">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Gauge className="h-6 w-6 text-primary" />
                <h2 className="text-xl sm:text-2xl font-bold">كفاءة المنصة</h2>
                <Badge className="bg-warning text-warning hover:bg-warning text-xs">
                  للتقييم الداخلي — Admin Only
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                منصة «دليل الاستثمار» — أرقام حقيقية بدون تجميل
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {data ? `آخر تحديث: ${new Date(data.generated_at).toLocaleString('ar-EG')}` : 'جارٍ التحميل...'}
              </p>
            </div>
            <div className="text-left text-xs text-muted-foreground">
              <div>invist.m2y.net</div>
              <div className="mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchData}
                  disabled={loading}
                  className="h-7 text-xs"
                >
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin ml-1" />
                  ) : (
                    <RefreshCw className="h-3 w-3 ml-1" />
                  )}
                  تحديث
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === Filters === */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">الفترة</label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">اليوم</SelectItem>
                  <SelectItem value="7d">آخر 7 أيام</SelectItem>
                  <SelectItem value="30d">آخر 30 يوم</SelectItem>
                  <SelectItem value="all">الكل (من 2026-01)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">السوق</label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأسواق</SelectItem>
                  <SelectItem value="EGX">EGX (مصر)</SelectItem>
                  <SelectItem value="CRYPTO">كريبتو</SelectItem>
                  <SelectItem value="KSE">KSE (الكويت)</SelectItem>
                  <SelectItem value="TADAWUL">TADAWUL (السعودية)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">القناة</label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="balanced">المتوازن</SelectItem>
                  <SelectItem value="morning_bell">جرس الصباح</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">حد «صفقة محترمة» (%)</label>
              <Select value={minReturn} onValueChange={setMinReturn}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>تعذر تحميل البيانات</AlertTitle>
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      {/* === Insufficient data === */}
      {insufficientData && !loading && !error && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>لا توجد بيانات كافية</AlertTitle>
          <AlertDescription className="text-sm">
            لا توجد صفقات مغلقة في الفترة المحددة. جرّب توسيع الفترة (مثلاً «الكل»).
          </AlertDescription>
        </Alert>
      )}

      {/* === Sample note === */}
      {data && data.sample_note_ar && !insufficientData && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">{data.sample_note_ar}</AlertDescription>
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
        <Card className={readiness.recommendation === 'candidate' ? 'border-profit bg-profit/50' : 'border-warning bg-warning/50'}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {readiness.recommendation === 'candidate' ? (
                <ShieldCheck className="h-6 w-6 text-profit flex-shrink-0" />
              ) : (
                <ShieldAlert className="h-6 w-6 text-warning flex-shrink-0" />
              )}
              <div className="flex-1">
                <h3 className="text-base font-semibold mb-1">
                  قرار الجاهزية: {readiness.recommendation_ar}
                </h3>
                <div className="space-y-1">
                  {readiness.notes_ar.map((note, i) => (
                    <div key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="text-muted-foreground/50 mt-0.5">•</span>
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
                <Separator className="my-2" />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">n ≥ 30: </span>
                    <Badge variant={readiness.n_sufficient ? 'default' : 'outline'} className="text-[10px]">
                      {readiness.n_sufficient ? 'نعم' : 'لا'}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">PF ≥ 1.3: </span>
                    <Badge variant={readiness.pf_passes ? 'default' : 'outline'} className="text-[10px]">
                      {readiness.pf_passes ? 'نعم' : 'لا'}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">وقف معقول: </span>
                    <Badge variant={readiness.max_loss_reasonable ? 'default' : 'outline'} className="text-[10px]">
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-5 w-5 text-profit" />
              أفضل الصفقات المحترمة (Top {data.top_trades.length})
              <Badge variant="outline" className="text-xs">≥ +{minReturn}%</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              صفقات مغلقة حققت عائداً ≥ {minReturn}%
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">السهم</th>
                    <th className="px-2 py-2 font-medium">السوق</th>
                    <th className="px-2 py-2 font-medium">القناة</th>
                    <th className="px-2 py-2 font-medium">التاريخ</th>
                    <th className="px-2 py-2 font-medium">دخول</th>
                    <th className="px-2 py-2 font-medium">وقف</th>
                    <th className="px-2 py-2 font-medium">هدف</th>
                    <th className="px-2 py-2 font-medium">خروج</th>
                    <th className="px-2 py-2 font-medium">عائد</th>
                    <th className="px-2 py-2 font-medium">المدة</th>
                    <th className="px-2 py-2 font-medium">الحالة</th>
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-5 w-5 text-profit" />
              تحقق المستهدفات ({data.target_hits.length})
            </CardTitle>
            <CardDescription className="text-xs">
              صفقات لمست الهدف أو أعلى نقطة
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">السهم</th>
                    <th className="px-2 py-2 font-medium">القناة</th>
                    <th className="px-2 py-2 font-medium">دخول</th>
                    <th className="px-2 py-2 font-medium">أعلى/خروج</th>
                    <th className="px-2 py-2 font-medium">عائد</th>
                    <th className="px-2 py-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.target_hits.map((t) => (
                    <tr key={t.id} className="border-b hover:bg-muted/30">
                      <td className="px-2 py-2 text-xs font-mono font-medium">{t.ticker}</td>
                      <td className="px-2 py-2 text-xs">
                        <Badge variant="outline" className="text-[10px]">{channelLabel(t.channel)}</Badge>
                      </td>
                      <td className="px-2 py-2 text-xs font-mono" dir="ltr">{fmtPrice(t.entry_price)}</td>
                      <td className="px-2 py-2 text-xs font-mono" dir="ltr">{fmtPrice(t.highest_price ?? t.exit_price)}</td>
                      <td className={`px-2 py-2 text-xs ${returnColor(t.actual_return)}`} dir="ltr">{fmtPct(t.actual_return)}</td>
                      <td className="px-2 py-2 text-xs">
                        <Badge className="bg-profit text-profit hover:bg-profit text-[10px]">تحقق ✓</Badge>
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
        <Card className="border-loss dark:border-loss/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-loss dark:text-loss">
              <Skull className="h-5 w-5" />
              أسوأ الصفقات (Worst {data.worst_trades.length})
              <Badge variant="outline" className="text-xs border-loss text-loss">شفافية داخلية</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              أسوأ الصفقات بدون إخفاء — للأمانة الداخلية
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">السهم</th>
                    <th className="px-2 py-2 font-medium">السوق</th>
                    <th className="px-2 py-2 font-medium">القناة</th>
                    <th className="px-2 py-2 font-medium">التاريخ</th>
                    <th className="px-2 py-2 font-medium">دخول</th>
                    <th className="px-2 py-2 font-medium">وقف</th>
                    <th className="px-2 py-2 font-medium">هدف</th>
                    <th className="px-2 py-2 font-medium">عائد</th>
                    <th className="px-2 py-2 font-medium">الحالة</th>
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
        <Card className="border-warning dark:border-warning/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-warning dark:text-warning">
              <AlertTriangle className="h-5 w-5" />
              صفقات مستبعدة من القياس ({data.excluded_examples.length})
              <Badge variant="outline" className="text-xs border-warning text-warning">شفافية</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              صفقات استُبعدت من KPI بسبب تكرار/دخول=0/خروج غير منطقي
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">السهم</th>
                    <th className="px-2 py-2 font-medium">السوق</th>
                    <th className="px-2 py-2 font-medium">دخول</th>
                    <th className="px-2 py-2 font-medium">خروج</th>
                    <th className="px-2 py-2 font-medium">سبب الاستبعاد</th>
                  </tr>
                </thead>
                <tbody>
                  {data.excluded_examples.map((t) => (
                    <tr key={t.id} className="border-b">
                      <td className="px-2 py-2 text-xs font-mono">{t.ticker}</td>
                      <td className="px-2 py-2 text-xs">
                        <Badge variant="outline" className="text-[10px] font-mono">{t.market}</Badge>
                      </td>
                      <td className="px-2 py-2 text-xs font-mono" dir="ltr">{fmtPrice(t.entry_price)}</td>
                      <td className="px-2 py-2 text-xs font-mono" dir="ltr">{fmtPrice(t.exit_price)}</td>
                      <td className="px-2 py-2 text-xs">
                        <Badge variant="outline" className="text-[10px] border-warning text-warning">
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-5 w-5 text-primary" />
              كفاءة الأسواق (مقارنة)
            </CardTitle>
            <CardDescription className="text-xs">
              مقارنة الأداء بين الأسواق — بدون خلط
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">السوق</th>
                    <th className="px-3 py-2 font-medium">n_raw</th>
                    <th className="px-3 py-2 font-medium">n_valid</th>
                    <th className="px-3 py-2 font-medium">Win Rate</th>
                    <th className="px-3 py-2 font-medium">Profit Factor</th>
                    <th className="px-3 py-2 font-medium">Expectancy</th>
                    <th className="px-3 py-2 font-medium">Max Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_market.map((m) => (
                    <tr key={m.market} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 text-sm font-medium">
                        <Badge variant="outline" className="font-mono">{m.market}</Badge>
                      </td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{m.n_raw}</td>
                      <td className="px-3 py-2 text-sm font-medium">{m.n_valid}</td>
                      <td className="px-3 py-2 text-sm">{fmtNum(m.win_rate, 1)}%</td>
                      <td className={`px-3 py-2 text-sm ${m.profit_factor >= 1.3 ? 'text-profit font-medium' : 'text-warning'}`}>
                        {fmtNum(m.profit_factor)}
                      </td>
                      <td className={`px-3 py-2 text-sm ${m.expectancy_pct >= 0 ? 'text-profit' : 'text-loss'}`} dir="ltr">
                        {fmtPct(m.expectancy_pct)}
                      </td>
                      <td className="px-3 py-2 text-sm text-loss" dir="ltr">{fmtPct(m.max_loss_pct)}</td>
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-5 w-5 text-primary" />
              كفاءة القنوات (مقارنة)
            </CardTitle>
            <CardDescription className="text-xs">
              مقارنة الأداء بين القنوات — بدون خلط إحصائيات
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">القناة</th>
                    <th className="px-3 py-2 font-medium">n</th>
                    <th className="px-3 py-2 font-medium">Win Rate</th>
                    <th className="px-3 py-2 font-medium">Profit Factor</th>
                    <th className="px-3 py-2 font-medium">Expectancy</th>
                    <th className="px-3 py-2 font-medium">Max Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_channel.map((ch) => (
                    <tr key={ch.channel} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 text-sm font-medium">
                        <Badge variant="outline">{channelLabel(ch.channel)}</Badge>
                      </td>
                      <td className="px-3 py-2 text-sm">{ch.n}</td>
                      <td className="px-3 py-2 text-sm">{fmtNum(ch.win_rate, 1)}%</td>
                      <td className={`px-3 py-2 text-sm ${ch.profit_factor >= 1.3 ? 'text-profit font-medium' : 'text-warning'}`}>
                        {fmtNum(ch.profit_factor)}
                      </td>
                      <td className={`px-3 py-2 text-sm ${ch.expectancy_pct >= 0 ? 'text-profit' : 'text-loss'}`} dir="ltr">
                        {fmtPct(ch.expectancy_pct)}
                      </td>
                      <td className="px-3 py-2 text-sm text-loss" dir="ltr">{fmtPct(ch.max_loss_pct)}</td>
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
        <Card>
          <CardContent className="p-3">
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">
                مصادر البيانات ({data.data_sources.length})
              </summary>
              <div className="mt-2 space-y-1">
                <div className="flex flex-wrap gap-1">
                  {data.data_sources.map((s, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">{s}</Badge>
                  ))}
                </div>
                {data.data_missing.length > 0 && (
                  <div className="mt-2">
                    <span className="text-warning">بيانات ناقصة:</span>{' '}
                    {data.data_missing.join('، ')}
                  </div>
                )}
                <div className="mt-1 text-muted-foreground">
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
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
          <p className="text-sm text-muted-foreground">جارٍ تحميل البيانات...</p>
        </div>
      )}
    </div>
  );
}

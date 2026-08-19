'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Target,
  TrendingUp,
  ShieldAlert,
  BarChart3,
  Activity,
  Layers,
  Wallet,
  Building2,
  LineChart,
  GitBranch,
  Minimize2,
  Gauge,
  Settings2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConfluenceBreakdown {
  passed: boolean;
  points: number;
  max?: number;
  detail: string;
}

interface ConfluenceData {
  score: number;
  breakdown: Record<string, ConfluenceBreakdown>;
  signal: string;
  signal_color: string;
}

interface RiskData {
  entry: number;
  target: number;
  target_2?: number;
  stop_loss: number;
  rr_ratio: number;
  atr?: number;
  atr_pct?: number;
}

interface MaestroSignal {
  signal: string;
  label_ar: string;
  score: number;
  color: string;
  action: string;
}

interface ProjectSignals {
  maestro_signal?: MaestroSignal | null;
  persona_investor?: unknown;
  persona_gambler?: unknown;
  ai_confidence?: unknown;
}

interface AdaptiveWeights {
  technical: number;
  fundamental: number;
  momentum: number;
  volumeProfile: number;
  supportResistance: number;
  bollingerBands: number;
  risk: number;
  regimeLabel?: string;
  regimeMultiplier?: number;
}

interface BbSqueeze {
  level: string;
  score: number;
  bbWidthPct: number;
  bbWidthTrend: string;
  descriptionAr: string;
}

interface DynamicParams {
  rsiOverbought: number;
  rsiOversold: number;
  rsiPeriod: number;
  atrPeriod: number;
  atrStopMultiplier: number;
  atrTargetMultiplier: number;
  minRiskReward: number;
}

interface ScreenerTagData {
  tags?: string[];
  list_types?: Record<string, string>;
  is_gold?: boolean;
  is_trap?: boolean;
  has_data?: boolean;
}

interface ConfluencePanelProps {
  confluence: ConfluenceData;
  risk: RiskData;
  projectSignals?: ProjectSignals;
  levels?: {
    support: number | null;
    resistance: number | null;
    pivot: number | null;
    far_support?: number | null;
    far_resistance?: number | null;
    support_levels?: { price: number; strength: string }[];
    resistance_levels?: { price: number; strength: string }[];
    zone_type?: string;
    accumulation_zone?: boolean;
    distribution_zone?: boolean;
  };
  volumeAnalysis?: { avg_20d: number; recent_5d: number; ratio: number; summary?: string };
  currentIndicators?: {
    rsi: number; atr: number; sma20: number; sma50: number;
    sma200: number; bb_width: number; cmf: number;
    macd?: number; volume_ratio?: number;
  };
  marketRegime?: { regime: string; regime_ar?: string; confidence: number; color: string };
  stock?: {
    ticker?: string;
    name_ar?: string;
    sector?: string;
    industry?: string;
    support_level?: number;
    resistance_level?: number;
    ma_50?: number;
    ma_200?: number;
    rsi?: number;
    pe_ratio?: number;
    pb_ratio?: number;
    eps?: number;
    roe?: number;
    dividend_yield?: number;
    debt_to_equity?: number;
    market_cap?: number;
    volume?: number;
    current_price?: number;
    price_change?: number | null;
  } | null;
  adaptiveWeights?: AdaptiveWeights;
  bbSqueeze?: BbSqueeze;
  dynamicParams?: DynamicParams;
  screenerTags?: ScreenerTagData | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const LABEL_MAP: Record<string, string> = {
  macro_trend: 'الاتجاه الماكرو',
  price_vs_sma50: 'السعر vs SMA50',
  rsi: 'RSI',
  volume: 'حجم التداول',
  bollinger: 'بولنجر',
  smart_money: 'سيولة الذكية',
  rsi_zone: 'منطقة RSI',
  bos_structure: 'بنية السوق BOS',
};

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function scoreRingColor(score: number): string {
  if (score >= 80) return 'stroke-emerald-400';
  if (score >= 60) return 'stroke-yellow-400';
  if (score >= 40) return 'stroke-orange-400';
  return 'stroke-red-400';
}

function scoreBgRingColor(score: number): string {
  if (score >= 80) return 'stroke-emerald-400/20';
  if (score >= 60) return 'stroke-yellow-400/20';
  if (score >= 40) return 'stroke-orange-400/20';
  return 'stroke-red-400/20';
}

function signalBadgeClass(color: string): string {
  switch (color) {
    case 'green':
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'red':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'yellow':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    default:
      return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
  }
}

function weightBarColor(value: number): string {
  // Higher weight = more saturated emerald, lower = more muted zinc
  const pct = Math.round(value * 100);
  if (pct >= 25) return 'bg-emerald-500';
  if (pct >= 18) return 'bg-emerald-500/80';
  if (pct >= 14) return 'bg-emerald-400/60';
  if (pct >= 10) return 'bg-yellow-500/60';
  return 'bg-zinc-500/60';
}

function squeezeGaugeColor(score: number): string {
  if (score >= 80) return 'bg-red-500';
  if (score >= 60) return 'bg-orange-500';
  if (score >= 35) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

function squeezeLabel(level: string): string {
  switch (level) {
    case 'EXTREME_SQUEEZE': return 'ضغط شديد';
    case 'SQUEEZE': return 'ضغط';
    case 'NARROWING': return 'يتضيق';
    case 'NONE': return 'بدون ضغط';
    default: return level;
  }
}

function squeezeTrendIcon(trend: string): string {
  switch (trend) {
    case 'narrowing': return '▲';
    case 'stable': return '►';
    case 'widening': return '▼';
    default: return '►';
  }
}

function volatilityClass(atrPct: number): { label: string; color: string } {
  if (atrPct >= 4) return { label: 'عالي جداً', color: 'text-red-400' };
  if (atrPct >= 2.5) return { label: 'عالي', color: 'text-orange-400' };
  if (atrPct >= 1) return { label: 'متوسط', color: 'text-yellow-400' };
  return { label: 'منخفض', color: 'text-emerald-400' };
}

/* Screener Lists badges — تصنيف السهم اليوم (فرصة ذهبية / فخ مضاربي)
   البيانات من جدول screener_lists في data_engine.db (سكرابر after-session). */
const SCREENER_LABELS: Record<string, string> = {
  most_active: 'الأكثر نشاطاً',
  unusual_volume: 'زخم غير اعتيادي',
  high_dividend: 'أعلى عائد توزيعات',
  high_net_income: 'أعلى صافي دخل',
  penny: 'سهم قرشي',
  top_gainers: 'الأكثر ارتفاعاً',
};

function ScreenerBadges({ data }: { data: ScreenerTagData | null | undefined }) {
  if (!data || !data.has_data || !data.tags || data.tags.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {data.is_gold && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-base">🔥</span>
            <span className="text-xs font-semibold text-emerald-400">فرصة ذهبية اليوم</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.tags
              .filter((t) => data.list_types?.[t] === 'gold')
              .map((t) => (
                <Badge key={t} variant="outline" className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40 text-[10px]">
                  {SCREENER_LABELS[t] || t}
                </Badge>
              ))}
          </div>
          <div className="mt-1.5 text-[10px] text-emerald-400/80">
            سيولة مؤسسية نشطة — تأكيد ذكي على السهم
          </div>
        </div>
      )}

      {data.is_trap && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            <span className="text-xs font-semibold text-red-400">تحذير — فخ مضاربي</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.tags
              .filter((t) => data.list_types?.[t] === 'trap')
              .map((t) => (
                <Badge key={t} variant="outline" className="bg-red-500/15 text-red-300 border-red-500/40 text-[10px]">
                  {SCREENER_LABELS[t] || t}
                </Badge>
              ))}
          </div>
          <div className="mt-1.5 text-[10px] text-red-400/80">
            {data.tags.includes('top_gainers')
              ? 'السهم عند ذروة شرائية — خطر الشراء على القمة'
              : 'مخاطرة مرتفعة — تداول محفوف بالمخاطر'}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ScoreCircle({ score }: { score: number }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const offset = circumference - progress;

  return (
    <div className="relative flex items-center justify-center">
      <svg
        width="96"
        height="96"
        viewBox="0 0 96 96"
        className="-rotate-90"
      >
        {/* background ring */}
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          strokeWidth="6"
          className={scoreBgRingColor(score)}
        />
        {/* progress ring */}
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={scoreRingColor(score)}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <span
        className={`absolute text-2xl font-bold tabular-nums ${scoreColor(score)}`}
      >
        {score}
      </span>
    </div>
  );
}

function BreakdownRow({
  key_name,
  data,
}: {
  key_name: string;
  data: ConfluenceBreakdown;
}) {
  const label = LABEL_MAP[key_name] ?? key_name;

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/[0.04]">
      {/* status icon */}
      <span className="text-base leading-none shrink-0">
        {data.passed ? (
          <span className="text-emerald-400" role="img" aria-label="محقق">✅</span>
        ) : (
          <span className="text-red-400" role="img" aria-label="غير محقق">❌</span>
        )}
      </span>

      {/* label + points */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-zinc-200 truncate">{label}</span>
          <span
            className={`text-xs font-semibold tabular-nums shrink-0 ${
              data.passed ? 'text-emerald-400' : 'text-red-400/70'
            }`}
          >
            +{data.points}
          </span>
        </div>
        <p className="text-[11px] text-zinc-500 truncate mt-0.5">{data.detail}</p>
      </div>
    </div>
  );
}

function RiskBox({ risk }: { risk: RiskData }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Target className="size-3.5 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400">إدارة المخاطر</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <span className="text-zinc-500">الدخول</span>
        <span className="text-zinc-200 font-medium tabular-nums text-left" dir="ltr">
          {risk.entry.toFixed(2)}
        </span>

        <span className="text-zinc-500">الهدف</span>
        <span className="text-emerald-400 font-medium tabular-nums text-left" dir="ltr">
          {risk.target.toFixed(2)}
        </span>

        <span className="text-zinc-500">وقف الخسارة</span>
        <span className="text-red-400 font-medium tabular-nums text-left" dir="ltr">
          {risk.stop_loss.toFixed(2)}
        </span>

        <span className="text-zinc-500">نسبة المخاطرة</span>
        <span className="text-cyan-400 font-semibold tabular-nums text-left" dir="ltr">
          1 : {risk.rr_ratio.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function ProjectSignalsSection({ signals, fallbackScore }: { signals: ProjectSignals; fallbackScore?: number }) {
  const maestro = signals.maestro_signal;
  const items: { label: string; value: string; color: string }[] = [];

  if (maestro) {
    items.push({
      label: 'مايسترو',
      value: `${maestro.label_ar} (${maestro.score})`,
      color: `border-l-2 ${maestro.color === '#22c55e' ? 'border-emerald-500 text-emerald-400' :
               maestro.color === '#ef4444' ? 'border-red-500 text-red-400' :
               maestro.color === '#eab308' ? 'border-yellow-500 text-yellow-400' :
               'border-zinc-500 text-zinc-400'}`,
    });
  } else if (typeof fallbackScore === 'number') {
    let label_ar = 'محايد';
    let color = 'border-zinc-500 text-zinc-400';
    if (fallbackScore >= 80) { label_ar = 'شراء قوي'; color = 'border-emerald-500 text-emerald-400'; }
    else if (fallbackScore >= 65) { label_ar = 'فرصة شراء'; color = 'border-emerald-400 text-emerald-300'; }
    else if (fallbackScore >= 50) { label_ar = 'إيجابي'; color = 'border-lime-500 text-lime-400'; }
    else if (fallbackScore >= 35) { label_ar = 'انتظر'; color = 'border-yellow-500 text-yellow-400'; }
    else if (fallbackScore >= 20) { label_ar = 'حذر'; color = 'border-orange-500 text-orange-400'; }
    else { label_ar = 'خطر'; color = 'border-red-500 text-red-400'; }

    items.push({
      label: 'التقاء مؤشرات',
      value: `${label_ar} (${fallbackScore})`,
      color: `border-l-2 ${color}`,
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-3.5 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400">إشارات المشروع</span>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge
              key={item.label}
              variant="outline"
              className={`${item.color} text-[11px] px-2 py-0 bg-zinc-900`}
            >
              {item.label}: {item.value}
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-zinc-600 text-[11px]">لا توجد إشارات متاحة</span>
      )}
    </div>
  );
}

function LevelsSection({
  levels,
}: {
  levels: {
    support: number | null;
    resistance: number | null;
    pivot: number | null;
    far_support?: number | null;
    far_resistance?: number | null;
    support_levels?: { price: number; strength: string }[];
    resistance_levels?: { price: number; strength: string }[];
    zone_type?: string;
    accumulation_zone?: boolean;
    distribution_zone?: boolean;
  };
}) {
  const allSupport: { price: number; label: string; strength?: string }[] = [];
  if (levels.support != null) allSupport.push({ price: levels.support, label: 'دعم رئيسي' });
  if (levels.far_support != null) allSupport.push({ price: levels.far_support, label: 'دعم بعيد' });
  if (levels.support_levels) {
    levels.support_levels.forEach((l, i) => {
      if (l.price) allSupport.push({ price: l.price, label: `دعم ${i + 1}`, strength: l.strength });
    });
  }

  const allResistance: { price: number; label: string; strength?: string }[] = [];
  if (levels.resistance != null) allResistance.push({ price: levels.resistance, label: 'مقاومة رئيسية' });
  if (levels.far_resistance != null) allResistance.push({ price: levels.far_resistance, label: 'مقاومة بعيدة' });
  if (levels.resistance_levels) {
    levels.resistance_levels.forEach((l, i) => {
      if (l.price) allResistance.push({ price: l.price, label: `مقاومة ${i + 1}`, strength: l.strength });
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Layers className="size-3.5 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400">مستويات الدعم والمقاومة</span>
        {levels.accumulation_zone && <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-800">تراكمي</Badge>}
        {levels.distribution_zone && <Badge variant="outline" className="text-[9px] text-red-400 border-red-800">توزيعي</Badge>}
      </div>
      <div className="space-y-1.5 text-xs">
        {levels.pivot != null && (
          <div className="flex items-center justify-between px-2">
            <span className="text-zinc-500">الريفيوت</span>
            <span className="text-cyan-400 font-medium tabular-nums" dir="ltr">
              {levels.pivot.toFixed(2)}
            </span>
          </div>
        )}
        {allResistance.map((r, i) => (
          <div key={`res-${i}`} className="flex items-center justify-between px-2">
            <span className="text-zinc-500">{r.label}</span>
            <span className="text-red-400 tabular-nums" dir="ltr">
              {r.price.toFixed(2)}
            </span>
          </div>
        ))}
        {allSupport.map((s, i) => (
          <div key={`sup-${i}`} className="flex items-center justify-between px-2">
            <span className="text-zinc-500">{s.label}</span>
            <span className="text-emerald-400 tabular-nums" dir="ltr">
              {s.price.toFixed(2)}
            </span>
          </div>
        ))}
        {allSupport.length === 0 && allResistance.length === 0 && levels.pivot == null && (
          <span className="text-zinc-600 text-[11px] px-2">جاري حساب المستويات...</span>
        )}
      </div>
    </div>
  );
}

function StockInfoSection({ stock }: { stock: ConfluencePanelProps['stock'] }) {
  if (!stock) return null;

  const technicalItems: { label: string; value: string | number | null | undefined }[] = [];
  if (stock.rsi !== undefined && stock.rsi !== null) technicalItems.push({ label: 'RSI', value: stock.rsi.toFixed(1) });
  if (stock.ma_50) technicalItems.push({ label: 'MA 50', value: stock.ma_50.toFixed(2) });
  if (stock.ma_200) technicalItems.push({ label: 'MA 200', value: stock.ma_200.toFixed(2) });
  if (stock.support_level) technicalItems.push({ label: 'دعم', value: stock.support_level.toFixed(2) });
  if (stock.resistance_level) technicalItems.push({ label: 'مقاومة', value: stock.resistance_level.toFixed(2) });

  const financialItems: { label: string; value: string | number | null | undefined }[] = [];
  if (stock.pe_ratio) financialItems.push({ label: 'P/E', value: stock.pe_ratio.toFixed(2) });
  if (stock.pb_ratio) financialItems.push({ label: 'P/B', value: stock.pb_ratio.toFixed(2) });
  if (stock.eps) financialItems.push({ label: 'EPS', value: stock.eps.toFixed(2) });
  if (stock.roe) financialItems.push({ label: 'ROE', value: `${stock.roe.toFixed(1)}%` });
  if (stock.dividend_yield) financialItems.push({ label: 'Dividend', value: `${stock.dividend_yield.toFixed(1)}%` });
  if (stock.debt_to_equity) financialItems.push({ label: 'Debt/Eq', value: stock.debt_to_equity.toFixed(2) });

  const fundamentalItems: { label: string; value: string | number | null | undefined }[] = [];
  if (stock.sector) fundamentalItems.push({ label: 'القسم', value: stock.sector });
  if (stock.industry) fundamentalItems.push({ label: 'النشاط', value: stock.industry });
  if (stock.market_cap) fundamentalItems.push({ label: 'القيمة السوقية', value: stock.market_cap.toLocaleString('ar-EG') });
  if (stock.volume) fundamentalItems.push({ label: 'حجم التداول', value: stock.volume.toLocaleString('ar-EG') });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <LineChart className="size-3.5 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400">معلومات السهم</span>
      </div>

      {technicalItems.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-zinc-500 mb-1">تحليل فني</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {technicalItems.map((item, i) => (
              <div key={`tech-${i}`} className="flex items-center justify-between">
                <span className="text-zinc-500">{item.label}</span>
                <span className="font-medium tabular-nums text-zinc-300" dir="ltr">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {financialItems.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-zinc-500 mb-1">بيانات مالية</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {financialItems.map((item, i) => (
              <div key={`fin-${i}`} className="flex items-center justify-between">
                <span className="text-zinc-500">{item.label}</span>
                <span className="font-medium tabular-nums text-zinc-300" dir="ltr">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {fundamentalItems.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-zinc-500 mb-1">أساسيات</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {fundamentalItems.map((item, i) => (
              <div key={`fund-${i}`} className="flex items-center justify-between">
                <span className="text-zinc-500">{item.label}</span>
                <span className="font-medium text-zinc-300">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  NEW: Adaptive Weights Visualization                                */
/* ------------------------------------------------------------------ */

function AdaptiveWeightsSection({ weights }: { weights: AdaptiveWeights }) {
  const weightItems: { key: keyof AdaptiveWeights; label: string }[] = [
    { key: 'technical', label: 'فني' },
    { key: 'fundamental', label: 'أساسي' },
    { key: 'momentum', label: 'زخم' },
    { key: 'volumeProfile', label: 'حجم' },
    { key: 'supportResistance', label: 'دعم/مقاومة' },
    { key: 'bollingerBands', label: 'بولنجر' },
    { key: 'risk', label: 'مخاطر' },
  ];

  // Normalize to percentage of total for display
  const totalWeight = weightItems.reduce((sum, item) => sum + (weights[item.key] as number), 0);
  const maxWeight = Math.max(...weightItems.map(item => weights[item.key] as number));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="size-3.5 text-zinc-400" />
          <span className="text-xs font-medium text-zinc-400">أوزان التحليل التكيفية</span>
        </div>
        {weights.regimeLabel && (
          <Badge variant="outline" className="text-[9px] text-cyan-400 border-cyan-800 px-1.5 py-0">
            {weights.regimeLabel}
            {weights.regimeMultiplier != null && (
              <span className="text-zinc-500 mr-1" dir="ltr">×{weights.regimeMultiplier.toFixed(1)}</span>
            )}
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {weightItems.map((item) => {
          const val = weights[item.key] as number;
          const pct = totalWeight > 0 ? Math.round((val / totalWeight) * 100) : 0;
          const barPct = maxWeight > 0 ? Math.round((val / maxWeight) * 100) : 0;

          return (
            <div key={item.key} className="space-y-0.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">{item.label}</span>
                <span className="text-zinc-300 font-medium tabular-nums">{pct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${weightBarColor(val)}`}
                  style={{ width: `${barPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  NEW: Squeeze Meter Gauge                                           */
/* ------------------------------------------------------------------ */

function SqueezeMeterSection({ data }: { data: BbSqueeze }) {
  const gaugeColor = squeezeGaugeColor(data.score);
  const trendIcon = squeezeTrendIcon(data.bbWidthTrend);
  const trendLabel = data.bbWidthTrend === 'narrowing'
    ? 'يتضيق'
    : data.bbWidthTrend === 'widening'
      ? 'يتسع'
      : 'مستقر';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Minimize2 className="size-3.5 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400">مقياس الضغط (بولنجر)</span>
      </div>

      {/* Gauge bar */}
      <div className="space-y-1.5">
        <div className="relative h-3 w-full rounded-full bg-zinc-800 overflow-hidden">
          {/* Gradient background segments */}
          <div className="absolute inset-0 flex">
            <div className="flex-1 bg-emerald-500/20" />
            <div className="flex-1 bg-yellow-500/20" />
            <div className="flex-1 bg-orange-500/20" />
            <div className="flex-1 bg-red-500/20" />
          </div>
          {/* Indicator */}
          <div
            className="absolute top-0 h-full w-1.5 bg-white rounded-full shadow-[0_0_6px_rgba(255,255,255,0.6)] transition-all duration-500"
            style={{ left: `${Math.min(Math.max(data.score, 0), 100)}%`, transform: 'translateX(-50%)' }}
          />
          {/* Fill bar */}
          <div
            className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ${gaugeColor} opacity-40`}
            style={{ width: `${data.score}%` }}
          />
        </div>

        {/* Labels row */}
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">المستوى</span>
          <span className={`font-medium ${data.score >= 60 ? 'text-orange-400' : data.score >= 35 ? 'text-yellow-400' : 'text-emerald-400'}`}>
            {squeezeLabel(data.level)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">الدرجة</span>
          <span className="font-medium tabular-nums text-zinc-300" dir="ltr">{data.score}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">عرض BB</span>
          <span className="font-medium tabular-nums text-zinc-300" dir="ltr">{data.bbWidthPct.toFixed(2)}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">الاتجاه</span>
          <span className="font-medium text-zinc-300">
            <span className="ml-0.5" dir="ltr">{trendIcon}</span> {trendLabel}
          </span>
        </div>
      </div>

      {/* Arabic description */}
      {data.descriptionAr && (
        <p className="text-[11px] text-zinc-500 leading-relaxed">{data.descriptionAr}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  NEW: ATR & Volatility Analysis Box                                 */
/* ------------------------------------------------------------------ */

function AtrVolatilityBox({
  indicators,
  currentPrice,
}: {
  indicators: NonNullable<ConfluencePanelProps['currentIndicators']>;
  currentPrice?: number;
}) {
  const atr = indicators.atr;
  const atrPct = currentPrice && currentPrice > 0 ? (atr / currentPrice) * 100 : null;
  const bbWidth = indicators.bb_width;
  const volClass = atrPct !== null ? volatilityClass(atrPct) : null;

  // Volatility bar position (0-100 scale: 0%=very low, 5%+=very high)
  const volBarPct = atrPct !== null ? Math.min((atrPct / 5) * 100, 100) : null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Gauge className="size-3.5 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400">ATR والتقلبات</span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">ATR</span>
          <span className="font-medium tabular-nums text-zinc-200" dir="ltr">{atr.toFixed(3)}</span>
        </div>
        {atrPct !== null && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">ATR%</span>
            <span className="font-medium tabular-nums text-zinc-200" dir="ltr">{atrPct.toFixed(2)}%</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">عرض BB</span>
          <span className="font-medium tabular-nums text-zinc-200" dir="ltr">{bbWidth.toFixed(3)}</span>
        </div>
        {volClass && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">التقلب</span>
            <span className={`font-medium ${volClass.color}`}>{volClass.label}</span>
          </div>
        )}
      </div>

      {/* Volatility bar */}
      {volBarPct !== null && (
        <div className="space-y-1">
          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                volBarPct >= 80 ? 'bg-red-500' :
                volBarPct >= 50 ? 'bg-orange-500' :
                volBarPct >= 20 ? 'bg-yellow-500' :
                'bg-emerald-500'
              }`}
              style={{ width: `${volBarPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[9px] text-zinc-600">
            <span>منخفض</span>
            <span>متوسط</span>
            <span>عالي</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  NEW: Dynamic Parameters Box                                        */
/* ------------------------------------------------------------------ */

function DynamicParamsBox({ params }: { params: DynamicParams }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Settings2 className="size-3.5 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400">المعاملات الديناميكية</span>
      </div>

      <div className="space-y-1.5 text-xs">
        {/* RSI Row */}
        <div className="flex items-center justify-between px-2 py-1 rounded-md bg-zinc-800/40">
          <span className="text-zinc-500">RSI</span>
          <span className="font-medium tabular-nums text-zinc-300" dir="ltr">
            <span className="text-emerald-400">{params.rsiOversold}</span>
            {' / '}
            <span className="text-red-400">{params.rsiOverbought}</span>
            <span className="text-zinc-500 text-[10px] mr-1.5">(فترة: {params.rsiPeriod})</span>
          </span>
        </div>

        {/* ATR Row */}
        <div className="flex items-center justify-between px-2 py-1 rounded-md bg-zinc-800/40">
          <span className="text-zinc-500">وقف/هدف</span>
          <span className="font-medium tabular-nums text-zinc-300" dir="ltr">
            وقف: <span className="text-red-400">{params.atrStopMultiplier}×</span>ATR
            <span className="text-zinc-600 mx-1.5">|</span>
            هدف: <span className="text-emerald-400">{params.atrTargetMultiplier}×</span>ATR
          </span>
        </div>

        {/* Risk Reward Row */}
        <div className="flex items-center justify-between px-2 py-1 rounded-md bg-zinc-800/40">
          <span className="text-zinc-500">حد R:R</span>
          <span className="font-medium tabular-nums text-cyan-400" dir="ltr">
            {params.minRiskReward.toFixed(1)}
          </span>
        </div>

        {/* ATR Period */}
        <div className="flex items-center justify-between px-2 py-1 rounded-md bg-zinc-800/40">
          <span className="text-zinc-500">فترة ATR</span>
          <span className="font-medium tabular-nums text-zinc-300" dir="ltr">
            {params.atrPeriod}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function ConfluencePanel({
  confluence,
  risk,
  projectSignals,
  levels,
  marketRegime,
  volumeAnalysis,
  currentIndicators,
  stock,
  adaptiveWeights,
  bbSqueeze,
  dynamicParams,
  screenerTags,
}: ConfluencePanelProps) {
  const breakdownEntries = Object.entries(confluence.breakdown);

  return (
    <Card className="bg-[#131722] border-zinc-800 rounded-xl gap-0 py-0 overflow-hidden h-full max-h-full">
      <ScrollArea className="h-full max-h-full">
        <CardContent className="p-4 space-y-4">

          {/* Screener Lists Badges — فرصة ذهبية / فخ مضاربي */}
          <ScreenerBadges data={screenerTags} />

          {/* Market Regime Indicator */}
          {marketRegime && (
            <div className="mb-4 p-3 rounded-lg border" style={{
              borderColor: marketRegime.color || '#666',
              backgroundColor: `${marketRegime.color || '#666'}15`,
            }}>
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4" style={{ color: marketRegime.color || '#666' }} />
                <span className="font-semibold text-sm">وضع السوق</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" style={{ borderColor: marketRegime.color, color: marketRegime.color }}>
                  {marketRegime.regime_ar || marketRegime.regime || 'N/A'}
                </Badge>
                {marketRegime.confidence && (
                  <span className="text-xs text-muted-foreground">ثقة: {marketRegime.confidence}%</span>
                )}
              </div>
            </div>
          )}

          {/* Current Indicators Summary */}
          {currentIndicators && (
            <div className="mb-4 p-3 rounded-lg bg-muted/30 border">
              <div className="text-xs font-semibold mb-2 text-muted-foreground">المؤشرات الحالية</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {currentIndicators.rsi !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">RSI</span>
                    <span className={currentIndicators.rsi > 70 ? 'text-red-500' : currentIndicators.rsi < 30 ? 'text-green-500' : ''}>
                      {currentIndicators.rsi?.toFixed(1)}
                    </span>
                  </div>
                )}
                {currentIndicators.macd !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MACD</span>
                    <span>{currentIndicators.macd?.toFixed(3)}</span>
                  </div>
                )}
                {currentIndicators.volume_ratio !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">حجم</span>
                    <span>{currentIndicators.volume_ratio?.toFixed(1)}x</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Volume Analysis */}
          {volumeAnalysis && (
            <div className="mb-4 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <div className="text-xs font-semibold mb-2 text-muted-foreground">تحليل الحجم</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between px-1">
                  <span className="text-zinc-500">متوسط 20 يوم</span>
                  <span className="text-zinc-300 tabular-nums" dir="ltr">
                    {(volumeAnalysis.avg_20d / 1_000_000).toFixed(2)}M
                  </span>
                </div>
                <div className="flex items-center justify-between px-1">
                  <span className="text-zinc-500">آخر 5 أيام</span>
                  <span className="text-zinc-300 tabular-nums" dir="ltr">
                    {(volumeAnalysis.recent_5d / 1_000_000).toFixed(2)}M
                  </span>
                </div>
                <div className="flex items-center justify-between px-1">
                  <span className="text-zinc-500">النسبة</span>
                  <span className={cn(
                    'font-semibold tabular-nums',
                    volumeAnalysis.ratio >= 1.3 ? 'text-emerald-400' :
                    volumeAnalysis.ratio >= 1.0 ? 'text-zinc-300' :
                    'text-red-400'
                  )} dir="ltr">
                    {volumeAnalysis.ratio.toFixed(2)}x
                  </span>
                </div>
                <div className="mt-1 px-1">
                  <span className={cn(
                    'text-[11px]',
                    volumeAnalysis.ratio >= 1.3 ? 'text-emerald-400' :
                    volumeAnalysis.ratio >= 1.0 ? 'text-zinc-400' :
                    'text-red-400/80'
                  )}>
                    {volumeAnalysis.ratio >= 1.5
                      ? '🔥 حجم مرتفع جداً — اهتمام مؤسسي'
                      : volumeAnalysis.ratio >= 1.3
                      ? '📈 حجم أعلى من المتوسط — تأكيد'
                      : volumeAnalysis.ratio >= 1.0
                      ? '📊 حجم طبيعي'
                      : volumeAnalysis.ratio >= 0.7
                      ? '📉 حجم أقل من المتوسط'
                      : '⚠️ حجم ضعيف جداً — لا سيولة'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ========== NEW SECTIONS ========== */}

          {/* Adaptive Weights Visualization */}
          {adaptiveWeights && (
            <>
              <Separator className="bg-zinc-800" />
              <AdaptiveWeightsSection weights={adaptiveWeights} />
            </>
          )}

          {/* Squeeze Meter Gauge */}
          {bbSqueeze && (
            <>
              <Separator className="bg-zinc-800" />
              <SqueezeMeterSection data={bbSqueeze} />
            </>
          )}

          {/* ATR & Volatility Analysis Box */}
          {currentIndicators && (
            <>
              <Separator className="bg-zinc-800" />
              <AtrVolatilityBox
                indicators={currentIndicators}
                currentPrice={stock?.current_price}
              />
            </>
          )}

          {/* Dynamic Parameters Box */}
          {dynamicParams && (
            <>
              <Separator className="bg-zinc-800" />
              <DynamicParamsBox params={dynamicParams} />
            </>
          )}

          {/* ========== END NEW SECTIONS ========== */}

          {/* ---- Header: Score + Signal ---- */}
          <div className="flex flex-col items-center gap-2">
            <ScoreCircle score={confluence.score} />
            <Badge
              variant="outline"
              className={`${signalBadgeClass(confluence.signal_color)} text-sm font-semibold px-3 py-1`}
            >
              {confluence.signal}
            </Badge>
          </div>

          <Separator className="bg-zinc-800" />

          {/* ---- Breakdown Rows ---- */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="size-3.5 text-zinc-400" />
              <span className="text-xs font-medium text-zinc-400">تفاصيل التقاء المؤشرات</span>
            </div>
            {breakdownEntries.map(([key, val]) => (
              <BreakdownRow key={key} key_name={key} data={val} />
            ))}
          </div>

          <Separator className="bg-zinc-800" />

          {/* ---- Risk Box ---- */}
          <RiskBox risk={risk} />

          {/* ---- Project Signals ---- */}
          <Separator className="bg-zinc-800" />
          <ProjectSignalsSection signals={projectSignals || {}} fallbackScore={confluence.score} />

          {/* ---- Support / Resistance Levels ---- */}
          {levels && (
            <>
              <Separator className="bg-zinc-800" />
              <LevelsSection levels={levels} />
            </>
          )}

          {/* ---- Stock Info ---- */}
          {stock && (
            <>
              <Separator className="bg-zinc-800" />
              <StockInfoSection stock={stock} />
            </>
          )}

        </CardContent>
      </ScrollArea>
    </Card>
  );
}

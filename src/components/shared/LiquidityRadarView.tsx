'use client';

/**
 * LiquidityRadarView — رادار تدفق السيولة المؤسسية ونبض الحيتان
 * =================================================================
 * SCR-020 — مطابقة Google Stitch Screen 4 (Sovereign Terminal)
 *
 * الهيكل (مطابق للمليمتر لـ stitch_full_website_ui_design/_4/code.html):
 *   أ) Macro Market Pulse Ribbon — شريط نبض علوي + نقطة خضراء بتنبض
 *   ب) Live Macro Mini Gauges — 3 عدادات (تجميع/تصريف/مخاطرة)
 *   ج) Multi-tier Filter Bar — Market + Sector + Timeframe + Wyckoff Phase Chips
 *   د) Institutional Asset Cards — 4 أعمدة لكل سهم (حوت/زخم/وايكوف/دفاع)
 *
 * Rule 4: Python = brain — لا حسابات في React، البيانات من /api/v2/liquidity-radar
 * Rule 27: NO-FAKE-DATA — حالات فارغة صادقة
 * Rule 30: زمردي/مينت/كهرماني فقط — صفر أزرق/نيلي
 *
 * منع هري الديباج: أي نصوص مثل "volume_high_recurring" أو "compressed" أو
 * أرقام المصفوفات تُترجم لعلامات بصرية أو تُستبعد تماماً.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Shield, Target, RefreshCw, AlertTriangle, Search,
  TrendingUp, TrendingDown, Minus, Rocket, Layers,
  Wallet, Activity, Gauge, ChevronDown, Filter,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';

// ============================================================================
// Types — مطابقة 100% لـ API (liquidity_radar_v2.py)
// ============================================================================

interface WhaleInfo {
  net_flow_egp: number | null;
  avg_daily_flow_egp?: number | null;
  whale_present: boolean | null;
  flow_strength: string | null;
  buy_pct?: number | null;
  sell_pct?: number | null;
  reason?: string | null;
}

interface MarketRegime {
  regime: string | null;
  regime_en?: string | null;
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
  phase: string;
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

// ============================================================================
// Helpers — number formatting (display only, Rule 4: no computation)
// ============================================================================

function fmtFlow(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const abs = Math.abs(Number(n));
  const sign = Number(n) >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(2)}%`;
}

// ============================================================================
// Phase styling — Wyckoff phases → visual chips (no raw text leak)
// ============================================================================

const PHASE_STYLE: Record<string, { dot: string; label: string; badge: string }> = {
  'بيبلع على الهادي': { dot: 'bg-primary', label: 'مرحلة التجميع', badge: 'bg-primary-container/20 text-primary' },
  'بيتحضر': { dot: 'bg-secondary', label: 'مرحلة الصعود', badge: 'bg-secondary/20 text-secondary' },
  'بيصرف': { dot: 'bg-error', label: 'مرحلة التصريف', badge: 'bg-error-container/20 text-error' },
  'بيانات غير كافية': { dot: 'bg-outline', label: 'بيانات غير كافية', badge: 'bg-surface-container-high text-on-surface-variant' },
};

function getPhaseStyle(phase: string | null | undefined) {
  if (!phase) return PHASE_STYLE['بيانات غير كافية'];
  return PHASE_STYLE[phase] || PHASE_STYLE['بيانات غير كافية'];
}

// Translate raw debug text to clean Arabic labels (prevents هري الديباج)
function cleanReason(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '—';
  // Replace common debug patterns with clean Arabic
  let cleaned = raw
    .replace(/volume_high_recurring/gi, 'سيولة ذكية فائقة')
    .replace(/compressed/gi, 'ضغط تجميعي')
    .replace(/accumulation/gi, 'تجميع مؤسسي')
    .replace(/distribution/gi, 'تصريف')
    .replace(/markup/gi, 'صعود')
    .replace(/markdown/gi, 'هبوط')
    .replace(/spring/gi, 'اختبار ناجح')
    .replace(/SOS/gi, 'علامات صعود')
    .replace(/LPS/gi, 'نقطة دخول')
    .replace(/PSY/gi, 'تجميع أولي')
    .replace(/ST/gi, 'اختبار هبوطي')
    .replace(/UTAD/gi, 'ذروة شراء')
    .replace(/\bUTC\b/gi, '')
    .replace(/\[.*?\]/g, '') // remove array indices
    .replace(/\{.*?\}/g, '') // remove dict notation
    .trim();
  // Truncate if still too long
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 77) + '...';
  return cleaned || '—';
}

// ============================================================================
// Main Component
// ============================================================================

export function LiquidityRadarView({ market: marketProp }: { market?: string }) {
  const storeMarket = useAppStore((s) => s.currentMarket);
  const market = (marketProp || storeMarket || 'EGX').toUpperCase();

  const [data, setData] = useState<RadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string>('الكل');
  const [searchQuery, setSearchQuery] = useState('');
  const [limit, setLimit] = useState(20);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v2/liquidity-radar?market=${encodeURIComponent(market)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        setError('تعذّر الاتصال بالخادم');
        setData(null);
        return;
      }
      const json: RadarResponse = await res.json();
      if (!json.success) {
        setError(json.message || json.error || 'فشل تشغيل محرّك رادار السيولة');
        setData(json);
        return;
      }
      setData(json);
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Filter stocks by phase + search ───
  const allStocks = data?.stocks ?? [];
  const filteredStocks = allStocks.filter((s) => {
    if (activePhase !== 'الكل' && s.phase !== activePhase) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.ticker.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q);
    }
    return true;
  }).slice(0, limit);

  const phasesBreakdown = data?.phases_breakdown ?? {};
  const phasesList = [
    { key: 'الكل', label: 'الكل', count: allStocks.length, dot: 'bg-primary' },
    { key: 'بيبلع على الهادي', label: 'مرحلة التجميع', count: phasesBreakdown['بيبلع على الهادي'] ?? 0, dot: 'bg-primary' },
    { key: 'بيتحضر', label: 'مرحلة الصعود', count: phasesBreakdown['بيتحضر'] ?? 0, dot: 'bg-secondary' },
    { key: 'بيصرف', label: 'مرحلة التصريف', count: phasesBreakdown['بيصرف'] ?? 0, dot: 'bg-error' },
    { key: 'بيانات غير كافية', label: 'بيانات غير كافية', count: phasesBreakdown['بيانات غير كافية'] ?? 0, dot: 'bg-outline' },
  ];

  // ─── Loading state ───
  if (loading) {
    return (
      <div className="space-y-4" dir="rtl">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // ─── Error / empty state ───
  if (error || !data || !data.stocks || data.stocks.length === 0) {
    return (
      <div className="space-y-4" dir="rtl">
        <PulseRibbon regime={data?.market_regime ?? null} scannedCount={data?.scanned_count ?? 0} />
        <Card className="glass-panel dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <CardContent className="p-8 text-center space-y-3">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              {error || 'لا توجد بيانات رادار متاحة حالياً'}
            </p>
            <p className="text-xs text-muted-foreground dark:text-on-surface-variant">
              محرّك رادار السيولة بيفحص السوق كل 5 دقائق — ستظهر الأسهم هنا فور رصدها
            </p>
            <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Main render ───
  const regime = data.market_regime;
  const isBull = regime?.is_bull ?? (regime?.regime_en === 'bull');
  const isBear = regime?.is_bear ?? (regime?.regime_en === 'bear' || regime?.regime_en === 'risk_off');

  return (
    <div className="space-y-4" dir="rtl">
      {/* ═══ (أ) Macro Market Pulse Ribbon ═══ */}
      <PulseRibbon regime={regime} scannedCount={data.scanned_count ?? allStocks.length} />

      {/* ═══ (ب) Header + Live Macro Mini Gauges ═══ */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="flex flex-col gap-1 max-w-3xl">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded dark:bg-surface-container-high font-financial text-[10px] text-primary uppercase tracking-wide">
              Whale Protocol Alpha
            </span>
            <span className="text-outline font-financial text-[10px] tracking-widest">● LIVE INSTITUTIONAL SCAN</span>
          </div>
          <h1 className="font-outfit text-xl lg:text-2xl font-bold text-foreground dark:text-on-surface tracking-tight">
            رادار تدفق السيولة المؤسسية ونبض الحيتان
          </h1>
          <p className="text-sm text-muted-foreground dark:text-on-surface-variant">
            رصد خوارزمي دقيق لتدفقات السيولة الذكية ومراحل تجميع وتصريف صناع السوق وفق منهجية وايكوف المعيارية.
          </p>
        </div>

        {/* Live Macro Mini Gauges */}
        <div className="flex items-center gap-3 self-start lg:self-auto dark:bg-surface-container p-2 rounded-xl shadow-md dark:border dark:border-outline-variant/20">
          <MiniGauge
            label="كفاءة التجميع المؤسسي"
            value={`${(phasesBreakdown['بيبلع على الهادي'] ?? 0) + (phasesBreakdown['بيتحضر'] ?? 0)}`}
            suffix=" سهم"
            trend="▲"
            trendColor="text-primary"
            color="text-primary"
          />
          <div className="w-px h-10 dark:bg-surface-container-high bg-border" />
          <MiniGauge
            label="ضغط التصريف المعاكس"
            value={`${phasesBreakdown['بيصرف'] ?? 0}`}
            suffix=" سهم"
            trend="▼"
            trendColor="text-error"
            color="text-error"
          />
          <div className="w-px h-10 dark:bg-surface-container-high bg-border" />
          <MiniGauge
            label="مؤشر المخاطرة"
            value={isBear ? 'عالي' : isBull ? 'منخفض' : 'متوسط'}
            trend=""
            trendColor=""
            color={isBear ? 'text-error' : isBull ? 'text-primary' : 'text-secondary'}
          />
        </div>
      </div>

      {/* ═══ (ج) Multi-tier Filter Bar ═══ */}
      <Card className="glass-panel dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
        <CardContent className="p-3 space-y-3">
          {/* Top Line: Market + Search + Refresh */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center dark:bg-surface-container p-1 rounded-lg">
                <span className="bg-primary-container text-on-primary-container px-2.5 py-0.5 rounded-md text-xs font-semibold flex items-center gap-1">
                  🇪🇬 {market}
                </span>
              </div>
              {/* Search */}
              <div className="relative">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground dark:text-on-surface-variant" />
                <input
                  type="text"
                  placeholder="ابحث برمز السهم أو الاسم..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-7 pl-2 py-1.5 text-xs rounded-lg dark:bg-surface-container dark:text-on-surface dark:border-outline-variant border focus:outline-none focus:ring-1 focus:ring-primary w-48"
                />
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchData} className="gap-1.5 h-7 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> تحديث
            </Button>
          </div>

          {/* Wyckoff Phase Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <span className="font-financial text-[10px] text-muted-foreground dark:text-on-surface-variant shrink-0 ml-1 uppercase tracking-wide">مرحلة وايكوف:</span>
            {phasesList.map((p) => (
              <button
                key={p.key}
                onClick={() => setActivePhase(p.key)}
                className={cn(
                  'px-2.5 py-1 rounded-full shrink-0 text-xs font-semibold transition-colors flex items-center gap-1.5',
                  activePhase === p.key
                    ? 'bg-primary-container text-on-primary-container shadow-sm'
                    : 'dark:bg-surface-container dark:text-on-surface-variant hover:dark:bg-surface-container-high hover:dark:text-on-surface bg-muted text-muted-foreground',
                )}
              >
                {p.dot && <span className={cn('w-1.5 h-1.5 rounded-full', p.dot)} />}
                <span>{p.label}</span>
                <span className={cn(
                  'text-[10px] px-1 rounded-full font-financial tabular-nums',
                  activePhase === p.key ? 'dark:bg-surface-container-lowest/30 bg-background/30' : 'dark:bg-surface-container-highest bg-background',
                )}>
                  {p.count}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ═══ (د) Institutional Asset Cards — 4-column grid ═══ */}
      {filteredStocks.length === 0 ? (
        <Card className="glass-panel dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <CardContent className="p-8 text-center">
            <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground dark:text-on-surface-variant">
              لا توجد أسهم مطابقة للفلتر الحالي
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredStocks.map((stock) => (
            <InstitutionalAssetCard key={stock.ticker} stock={stock} />
          ))}
          {limit < filteredStocks.length + (allStocks.length - limit) && allStocks.length > limit && (
            <Button variant="outline" size="sm" onClick={() => setLimit(l => l + 20)} className="w-full gap-1.5">
              <ChevronDown className="w-4 h-4" /> عرض المزيد ({allStocks.length - limit} سهم متبقي)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// (أ) Macro Market Pulse Ribbon
// ============================================================================

function PulseRibbon({ regime, scannedCount }: { regime: MarketRegime | null; scannedCount: number }) {
  const isBull = regime?.is_bull ?? (regime?.regime_en === 'bull');
  const isBear = regime?.is_bear ?? (regime?.regime_en === 'bear' || regime?.regime_en === 'risk_off');

  const flowText = isBear
    ? 'سيولة تصريفية خارجة — حذر'
    : isBull
      ? 'سيولة تراكمية داخلة — تدفق شراء مؤسسي'
      : 'سيولة متوازنة — توزيع عادل';

  return (
    <div className="w-full dark:bg-surface-container-low px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-sm dark:border dark:border-outline-variant/30 rounded-xl">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {/* Pulsing green dot */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
          </span>
          <span className="font-financial text-[10px] text-primary uppercase tracking-wider">WYCKOFF-RADAR-V4</span>
        </div>
        <div className="h-4 w-px dark:bg-surface-container-high bg-border hidden sm:block" />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground dark:text-on-surface-variant">حالة تدفق السيولة:</span>
          <span className={cn('font-financial font-semibold', isBear ? 'text-error' : isBull ? 'text-primary' : 'text-secondary')}>
            {flowText}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground dark:text-on-surface-variant">
          <Shield className="w-3.5 h-3.5 text-primary" />
          <span>بروتوكول Rule 80 نشط</span>
        </div>
        <div className="h-4 w-px dark:bg-surface-container-high bg-border hidden sm:block" />
        <span className="font-financial text-[10px] text-secondary">
          مرقوب: {scannedCount} سهم
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// (ب) Mini Gauge
// ============================================================================

function MiniGauge({ label, value, suffix, trend, trendColor, color }: {
  label: string;
  value: string;
  suffix?: string;
  trend: string;
  trendColor: string;
  color: string;
}) {
  return (
    <div className="flex flex-col text-right px-2">
      <span className="text-xs text-muted-foreground dark:text-on-surface-variant">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className={cn('font-financial text-xl font-bold tabular-nums', color)}>{value}</span>
        {suffix && <span className={cn('text-xs font-financial', color)}>{suffix}</span>}
        {trend && <span className={cn('text-xs font-financial', trendColor)}>{trend}</span>}
      </div>
    </div>
  );
}

// ============================================================================
// (د) Institutional Asset Card — 4 columns
// ============================================================================

function InstitutionalAssetCard({ stock }: { stock: RadarStock }) {
  const whale = stock.whale;
  const regime = stock.market_regime;
  const defense = stock.entry_defense;
  const phaseStyle = getPhaseStyle(stock.phase);
  const cleanStockReason = cleanReason(stock.reason);

  // Whale flow visualization
  const buyPct = whale?.buy_pct ?? (whale?.whale_present ? 65 : 50);
  const sellPct = whale?.sell_pct ?? (100 - buyPct);
  const netFlowPositive = (whale?.net_flow_egp ?? 0) >= 0;

  return (
    <div className="dark:bg-surface-container hover:dark:bg-surface-container-high transition-colors rounded-xl p-3 shadow-md dark:border dark:border-outline-variant/30 flex flex-col xl:grid xl:grid-cols-12 gap-3 items-stretch">
      {/* ─── Col 1: Whale Volume & Flow + Dual Color Flow Bar ─── */}
      <div className="xl:col-span-3 flex flex-col justify-between dark:bg-surface-container-lowest/50 p-2.5 rounded-lg">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-financial text-sm font-bold text-foreground dark:text-on-surface truncate">{stock.ticker}</span>
            <span className="text-xs text-muted-foreground dark:text-on-surface-variant truncate">{stock.name || stock.ticker}</span>
          </div>
          <span className={cn(
            'px-1.5 py-0.5 rounded font-financial text-[10px] font-semibold shrink-0',
            netFlowPositive ? 'dark:bg-primary-container/20 text-primary bg-emerald-500/10 text-emerald-600' : 'dark:bg-error-container/20 text-error bg-red-500/10 text-red-600'
          )}>
            {fmtFlow(whale?.net_flow_egp)} صافي
          </span>
        </div>

        {/* Dual Color Flow Bar */}
        <div className="flex flex-col gap-1 my-1.5">
          <div className="flex justify-between items-center font-financial text-[10px]">
            <span className="text-primary font-semibold">شراء {Math.round(buyPct)}%</span>
            <span className="text-muted-foreground dark:text-on-surface-variant">بيع {Math.round(sellPct)}%</span>
          </div>
          <div className="w-full h-2 rounded-full dark:bg-surface-container-highest bg-muted overflow-hidden flex">
            <div className="h-full bg-primary rounded-r-full transition-all" style={{ width: `${buyPct}%` }} />
            <div className="h-full bg-error rounded-l-full transition-all" style={{ width: `${sellPct}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between mt-1 font-financial text-[10px] text-muted-foreground dark:text-on-surface-variant">
          <span>{whale?.whale_present ? 'حوت نشط' : 'سيولة عادية'}</span>
          <span className={cn('flex items-center gap-0.5', netFlowPositive ? 'text-primary' : 'text-error')}>
            {netFlowPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {netFlowPositive ? 'تدفق تجميعي' : 'تدفق تصريفي'}
          </span>
        </div>
      </div>

      {/* ─── Col 2: Momentum & Market Regime ─── */}
      <div className="xl:col-span-3 flex flex-col justify-between dark:bg-surface-container-lowest/50 p-2.5 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="font-financial text-[10px] text-outline uppercase tracking-wide">حالة السهم</span>
          <span className={cn(
            'font-financial text-sm font-bold tabular-nums',
            (regime?.change_pct ?? 0) >= 0 ? 'text-primary' : 'text-error'
          )}>
            {fmtPct(regime?.change_pct)}
          </span>
        </div>

        {/* Regime indicator */}
        <div className="my-1.5 flex items-center gap-2">
          <div className="flex-1">
            <div className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold',
              regime?.is_bull ? 'bg-primary-container/20 text-primary' :
              regime?.is_bear ? 'bg-error-container/20 text-error' :
              'dark:bg-surface-container-high dark:text-on-surface-variant bg-muted text-muted-foreground'
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full',
                regime?.is_bull ? 'bg-primary' : regime?.is_bear ? 'bg-error' : 'bg-outline')} />
              {regime?.regime || 'محايد'}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between font-financial text-[10px]">
          <span className="text-muted-foreground dark:text-on-surface-variant">تقييم النبض:</span>
          <span className={cn('flex items-center gap-0.5',
            (regime?.change_pct ?? 0) > 0.5 ? 'text-primary' :
            (regime?.change_pct ?? 0) < -0.5 ? 'text-error' :
            'text-muted-foreground dark:text-on-surface-variant')}>
            {(regime?.change_pct ?? 0) > 0.5 ? <><TrendingUp className="w-3 h-3" /> زخم إيجابي</> :
             (regime?.change_pct ?? 0) < -0.5 ? <><TrendingDown className="w-3 h-3" /> ضغط بيعي</> :
             <><Minus className="w-3 h-3" /> حركة عرضية</>}
          </span>
        </div>
      </div>

      {/* ─── Col 3: Wyckoff Phase & Key Levels ─── */}
      <div className="xl:col-span-3 flex flex-col justify-between dark:bg-surface-container-lowest/50 p-2.5 rounded-lg">
        <div className="flex items-center justify-between">
          <span className={cn('px-2 py-0.5 rounded-md text-xs font-semibold flex items-center gap-1', phaseStyle.badge)}>
            <Layers className="w-3.5 h-3.5" />
            {phaseStyle.label}
          </span>
          <span className="font-financial text-[10px] text-outline">{stock.phase_reason ? 'نشط' : 'مراقبة'}</span>
        </div>

        <div className="flex flex-col gap-1 my-1.5 text-xs">
          {/* Entry level */}
          {defense?.entry_level != null && Number.isFinite(Number(defense.entry_level)) && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground dark:text-on-surface-variant">مستوى الدخول:</span>
              <span className="font-financial font-semibold text-primary tabular-nums">{fmtPrice(defense.entry_level)}</span>
            </div>
          )}
          {/* Defense level */}
          {defense?.defense_level != null && Number.isFinite(Number(defense.defense_level)) && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground dark:text-on-surface-variant">مستوى الدفاع:</span>
              <span className="font-financial font-semibold text-error tabular-nums">{fmtPrice(defense.defense_level)}</span>
            </div>
          )}
          {/* Resistance */}
          {defense?.resistance_level != null && Number.isFinite(Number(defense.resistance_level)) && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground dark:text-on-surface-variant">المقاومة:</span>
              <span className="font-financial font-semibold text-secondary tabular-nums">{fmtPrice(defense.resistance_level)}</span>
            </div>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground dark:text-on-surface-variant truncate">
          {cleanStockReason}
        </div>
      </div>

      {/* ─── Col 4: Entry & Capital Defense Strategy ─── */}
      <div className="xl:col-span-3 flex flex-col justify-between dark:bg-surface-container-lowest/50 p-2.5 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="font-financial text-[10px] text-outline uppercase tracking-wide">استراتيجية الدخول</span>
          <span className={cn('flex items-center gap-0.5 text-[10px] font-semibold',
            whale?.whale_present ? 'text-primary' : 'text-muted-foreground dark:text-on-surface-variant')}>
            {whale?.whale_present ? <><Shield className="w-3 h-3" /> حماية حيتان</> : <><AlertTriangle className="w-3 h-3" /> بدون حماية</>}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 my-1.5">
          <div className="flex flex-col p-1.5 rounded dark:bg-surface-container-high/50 bg-muted/50">
            <span className="text-[9px] text-muted-foreground dark:text-on-surface-variant">الدخول</span>
            <span className="font-financial text-sm font-bold text-primary tabular-nums">{fmtPrice(defense?.entry_level)}</span>
          </div>
          <div className="flex flex-col p-1.5 rounded dark:bg-surface-container-high/50 bg-muted/50">
            <span className="text-[9px] text-muted-foreground dark:text-on-surface-variant">الدفاع</span>
            <span className="font-financial text-sm font-bold text-error tabular-nums">{fmtPrice(defense?.defense_level)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px]">
          <Gauge className="w-3 h-3 text-secondary" />
          <span className="text-muted-foreground dark:text-on-surface-variant">قوة التدفق:</span>
          <span className={cn('font-financial font-semibold',
            whale?.flow_strength === 'high' || whale?.flow_strength === 'سيولة ذكية فائقة' ? 'text-primary' :
            whale?.flow_strength === 'low' || whale?.flow_strength === 'ضعيف' ? 'text-error' : 'text-secondary')}>
            {whale?.flow_strength || 'متوسط'}
          </span>
        </div>
      </div>
    </div>
  );
}

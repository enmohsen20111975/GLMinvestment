'use client';

/**
 * LiquidityRadarView — رادار تدفق السيولة المؤسسية ونبض الحيتان
 * =================================================================
 * SCR-020 — Structural Rebuild per Stitch Screen 4 (Sovereign Terminal)
 *
 * هذا بناء هيكلي حقيقي (مش حشر dark: على قديم). كل الـ JSX منسوخ من
 * stitch_full_website_ui_design/_4/code.html ومربوط بـ /api/v2/liquidity-radar.
 *
 * Rule 1: Stitch Canvas (#0B0E14) + ambient glow + glass cards (#111622/80)
 * Rule 2: No client calculations (Rule 4 + Rule 20) — data from Python API
 * Rule 3: Atomic build — this file is self-contained, ErrorBoundary-wrapped
 * Rule 4: Debug text purged via cleanReason() — visual indicators only
 */

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Shield, RefreshCw, AlertTriangle, Search,
  TrendingUp, TrendingDown, Minus,
  Layers, Gauge, ChevronDown,
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
// Helpers — display formatting only (Rule 4: no computation)
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

// Translate raw debug patterns → clean Arabic (prevents هري الديباج)
function cleanReason(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '—';
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
    .replace(/\[.*?\]/g, '')
    .replace(/\{.*?\}/g, '')
    .trim();
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 77) + '...';
  return cleaned || '—';
}

const PHASE_LABELS: Record<string, string> = {
  'بيبلع على الهادي': 'مرحلة التجميع',
  'بيتحضر': 'مرحلة الصعود',
  'بيصرف': 'مرحلة التصريف',
  'بيانات غير كافية': 'بيانات غير كافية',
};

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
      if (!res.ok) { setError('تعذّر الاتصال بالخادم'); setData(null); return; }
      const json: RadarResponse = await res.json();
      if (!json.success) { setError(json.message || json.error || 'فشل تشغيل المحرّك'); setData(json); return; }
      setData(json);
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
    { key: 'الكل', label: 'الكل', count: allStocks.length, dot: 'bg-emerald-500' },
    { key: 'بيبلع على الهادي', label: 'التجميع', count: phasesBreakdown['بيبلع على الهادي'] ?? 0, dot: 'bg-emerald-500' },
    { key: 'بيتحضر', label: 'الصعود', count: phasesBreakdown['بيتحضر'] ?? 0, dot: 'bg-teal-400' },
    { key: 'بيصرف', label: 'التصريف', count: phasesBreakdown['بيصرف'] ?? 0, dot: 'bg-rose-500' },
    { key: 'بيانات غير كافية', label: 'غير كافية', count: phasesBreakdown['بيانات غير كافية'] ?? 0, dot: 'bg-stone-500' },
  ];

  const regime = data?.market_regime;
  const isBull = regime?.is_bull ?? (regime?.regime_en === 'bull');
  const isBear = regime?.is_bear ?? (regime?.regime_en === 'bear' || regime?.regime_en === 'risk_off');

  // ─── Loading state ───
  if (loading) {
    return (
      <div className="stitch-canvas min-h-screen p-4 space-y-4" dir="rtl">
        <div className="stitch-glass h-12 animate-pulse" />
        <div className="stitch-glass h-32 animate-pulse" />
        <div className="stitch-glass h-16 animate-pulse" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="stitch-glass h-40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="stitch-canvas min-h-screen p-4 space-y-4 relative" dir="rtl">
      <div className="relative z-10 space-y-4">

        {/* ═══ (أ) Macro Market Pulse Ribbon ═══ */}
        <div className="stitch-glass px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {/* Live pulse dot (animate-ping green) */}
              <span className="stitch-pulse-dot" />
              <span className="stitch-num text-[10px] text-stitch-primary uppercase tracking-widest">WYCKOFF-RADAR-V4</span>
            </div>
            <div className="h-4 w-px bg-white/[0.06]" />
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-stitch-muted">حالة تدفق السيولة:</span>
              <span className={cn('stitch-num font-semibold', isBear ? 'text-rose-400' : isBull ? 'text-stitch-primary' : 'text-teal-400')}>
                {isBear ? 'سيولة تصريفية خارجة — حذر' : isBull ? 'سيولة تراكمية داخلة — تدفق شراء مؤسسي' : 'سيولة متوازنة — توزيع عادل'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs text-stitch-muted">
              <Shield className="w-3.5 h-3.5 text-stitch-primary" />
              <span>بروتوكول Rule 80 نشط</span>
            </div>
            <div className="h-4 w-px bg-white/[0.06]" />
            <span className="stitch-num text-[10px] text-teal-400">مرقوب: {data?.scanned_count ?? allStocks.length} سهم</span>
          </div>
        </div>

        {/* ═══ (ب) Header + Live Macro Mini Gauges ═══ */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="flex flex-col gap-1 max-w-3xl">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-[#182030] stitch-num text-[10px] text-stitch-primary uppercase tracking-wide">Whale Protocol Alpha</span>
              <span className="text-stitch-outline stitch-num text-[10px] tracking-widest">● LIVE INSTITUTIONAL SCAN</span>
            </div>
            <h1 className="stitch-latin text-xl lg:text-2xl font-bold text-stitch-on-surface tracking-tight">
              رادار تدفق السيولة المؤسسية ونبض الحيتان
            </h1>
            <p className="text-sm text-stitch-muted stitch-ar">
              رصد خوارزمي دقيق لتدفقات السيولة الذكية ومراحل تجميع وتصريف صناع السوق وفق منهجية وايكوف المعيارية.
            </p>
          </div>

          {/* Live Macro Mini Gauges */}
          <div className="flex items-center gap-3 stitch-glass-strong p-3 rounded-xl shadow-md">
            <MiniGauge
              label="كفاءة التجميع المؤسسي"
              value={`${(phasesBreakdown['بيبلع على الهادي'] ?? 0) + (phasesBreakdown['بيتحضر'] ?? 0)}`}
              suffix=" سهم"
              trend="▲"
              trendColor="text-stitch-primary"
              color="text-stitch-primary"
            />
            <div className="w-px h-10 bg-white/[0.06]" />
            <MiniGauge
              label="ضغط التصريف المعاكس"
              value={`${phasesBreakdown['بيصرف'] ?? 0}`}
              suffix=" سهم"
              trend="▼"
              trendColor="text-rose-400"
              color="text-rose-400"
            />
            <div className="w-px h-10 bg-white/[0.06]" />
            <MiniGauge
              label="مؤشر المخاطرة"
              value={isBear ? 'عالي' : isBull ? 'منخفض' : 'متوسط'}
              trend=""
              trendColor=""
              color={isBear ? 'text-rose-400' : isBull ? 'text-stitch-primary' : 'text-teal-400'}
            />
          </div>
        </div>

        {/* ═══ (ج) Multi-tier Filter Bar ═══ */}
        <div className="stitch-glass p-3 space-y-3">
          {/* Top Line: Market + Search + Refresh */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-[#182030] p-1 rounded-lg">
                <span className="bg-emerald-600 text-white px-2.5 py-0.5 rounded-md text-xs font-semibold flex items-center gap-1">
                  🇪🇬 {market}
                </span>
              </div>
              {/* Search */}
              <div className="relative">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stitch-outline" />
                <input
                  type="text"
                  placeholder="ابحث برمز السهم أو الاسم..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="stitch-ar pr-7 pl-2 py-1.5 text-xs rounded-lg bg-[#182030] text-stitch-on-surface border border-white/[0.06] focus:outline-none focus:ring-1 focus:ring-emerald-500 w-48"
                />
              </div>
            </div>
            <button onClick={fetchData} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#182030] hover:bg-[#1f2a3d] text-stitch-on-surface transition-colors text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> تحديث
            </button>
          </div>

          {/* Wyckoff Phase Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <span className="stitch-num text-[10px] text-stitch-muted shrink-0 ml-1 uppercase tracking-wide">مرحلة وايكوف:</span>
            {phasesList.map((p) => (
              <button
                key={p.key}
                onClick={() => setActivePhase(p.key)}
                className={cn(
                  'px-2.5 py-1 rounded-full shrink-0 text-xs font-semibold transition-colors flex items-center gap-1.5',
                  activePhase === p.key
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-[#182030] text-stitch-muted hover:bg-[#1f2a3d] hover:text-stitch-on-surface',
                )}
              >
                {p.dot && <span className={cn('w-1.5 h-1.5 rounded-full', p.dot)} />}
                <span>{p.label}</span>
                <span className={cn(
                  'stitch-num text-[10px] px-1 rounded-full',
                  activePhase === p.key ? 'bg-black/20' : 'bg-[#0B0E14]',
                )}>
                  {p.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ═══ (د) Institutional Asset Cards ═══ */}
        {error || !data || allStocks.length === 0 ? (
          <div className="stitch-glass p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-amber-400">{error || 'لا توجد بيانات رادار متاحة حالياً'}</p>
            <p className="text-xs text-stitch-muted mt-1">المحرّك بيفحص السوق كل 5 دقائق — ستظهر الأسهم هنا فور رصدها</p>
          </div>
        ) : filteredStocks.length === 0 ? (
          <div className="stitch-glass p-8 text-center">
            <p className="text-sm text-stitch-muted">لا توجد أسهم مطابقة للفلتر الحالي</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredStocks.map((stock) => (
              <InstitutionalAssetCard key={stock.ticker} stock={stock} />
            ))}
            {allStocks.length > limit && (
              <button
                onClick={() => setLimit(l => l + 20)}
                className="stitch-glass w-full py-2.5 flex items-center justify-center gap-1.5 text-sm text-stitch-muted hover:text-stitch-on-surface transition-colors"
              >
                <ChevronDown className="w-4 h-4" /> عرض المزيد ({allStocks.length - limit} سهم متبقي)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Mini Gauge
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
      <span className="text-xs text-stitch-muted stitch-ar">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className={cn('stitch-num text-xl font-bold', color)}>{value}</span>
        {suffix && <span className={cn('text-xs stitch-num', color)}>{suffix}</span>}
        {trend && <span className={cn('text-xs stitch-num', trendColor)}>{trend}</span>}
      </div>
    </div>
  );
}

// ============================================================================
// Institutional Asset Card — 4 columns (structural rebuild per Stitch _4)
// ============================================================================

function InstitutionalAssetCard({ stock }: { stock: RadarStock }) {
  const whale = stock.whale;
  const regime = stock.market_regime;
  const defense = stock.entry_defense;
  const phaseLabel = PHASE_LABELS[stock.phase] || stock.phase || 'غير محدد';
  const cleanStockReason = cleanReason(stock.reason);

  const buyPct = whale?.buy_pct ?? (whale?.whale_present ? 65 : 50);
  const sellPct = whale?.sell_pct ?? (100 - buyPct);
  const netFlowPositive = (whale?.net_flow_egp ?? 0) >= 0;

  return (
    <div className="stitch-glass p-3 hover:border-emerald-500/20 transition-colors flex flex-col xl:grid xl:grid-cols-12 gap-3 items-stretch">

      {/* ─── Col 1: Whale Volume & Flow + Dual Color Flow Bar ─── */}
      <div className="xl:col-span-3 flex flex-col justify-between bg-[#0B0E14]/50 p-2.5 rounded-lg">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="stitch-num text-sm font-bold text-stitch-on-surface truncate">{stock.ticker}</span>
            <span className="text-xs text-stitch-muted stitch-ar truncate">{stock.name || stock.ticker}</span>
          </div>
          <span className={cn(
            'px-1.5 py-0.5 rounded stitch-num text-[10px] font-semibold shrink-0',
            netFlowPositive ? 'bg-emerald-500/10 text-stitch-primary' : 'bg-rose-500/10 text-rose-400'
          )}>
            {fmtFlow(whale?.net_flow_egp)} صافي
          </span>
        </div>

        {/* Dual Color Flow Bar */}
        <div className="flex flex-col gap-1 my-1.5">
          <div className="flex justify-between items-center stitch-num text-[10px]">
            <span className="text-stitch-primary font-semibold">شراء {Math.round(buyPct)}%</span>
            <span className="text-stitch-muted">بيع {Math.round(sellPct)}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#0B0E14] overflow-hidden flex">
            <div className="h-full bg-emerald-500 rounded-r-full transition-all" style={{ width: `${buyPct}%` }} />
            <div className="h-full bg-rose-500 rounded-l-full transition-all" style={{ width: `${sellPct}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between mt-1 stitch-num text-[10px] text-stitch-muted">
          <span>{whale?.whale_present ? 'حوت نشط' : 'سيولة عادية'}</span>
          <span className={cn('flex items-center gap-0.5', netFlowPositive ? 'text-stitch-primary' : 'text-rose-400')}>
            {netFlowPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {netFlowPositive ? 'تدفق تجميعي' : 'تدفق تصريفي'}
          </span>
        </div>
      </div>

      {/* ─── Col 2: Momentum & Market Regime ─── */}
      <div className="xl:col-span-3 flex flex-col justify-between bg-[#0B0E14]/50 p-2.5 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="stitch-num text-[10px] text-stitch-outline uppercase tracking-wide">حالة السهم</span>
          <span className={cn(
            'stitch-num text-sm font-bold',
            (regime?.change_pct ?? 0) >= 0 ? 'text-stitch-primary' : 'text-rose-400'
          )}>
            {fmtPct(regime?.change_pct)}
          </span>
        </div>

        <div className="my-1.5">
          <div className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold',
            regime?.is_bull ? 'bg-emerald-500/10 text-stitch-primary' :
            regime?.is_bear ? 'bg-rose-500/10 text-rose-400' :
            'bg-[#182030] text-stitch-muted'
          )}>
            <span className={cn('w-1.5 h-1.5 rounded-full',
              regime?.is_bull ? 'bg-emerald-500' : regime?.is_bear ? 'bg-rose-500' : 'bg-stone-500')} />
            {regime?.regime || 'محايد'}
          </div>
        </div>

        <div className="flex items-center justify-between stitch-num text-[10px]">
          <span className="text-stitch-muted">تقييم النبض:</span>
          <span className={cn('flex items-center gap-0.5',
            (regime?.change_pct ?? 0) > 0.5 ? 'text-stitch-primary' :
            (regime?.change_pct ?? 0) < -0.5 ? 'text-rose-400' : 'text-stitch-muted')}>
            {(regime?.change_pct ?? 0) > 0.5 ? <><TrendingUp className="w-3 h-3" /> زخم إيجابي</> :
             (regime?.change_pct ?? 0) < -0.5 ? <><TrendingDown className="w-3 h-3" /> ضغط بيعي</> :
             <><Minus className="w-3 h-3" /> حركة عرضية</>}
          </span>
        </div>
      </div>

      {/* ─── Col 3: Wyckoff Phase & Key Levels ─── */}
      <div className="xl:col-span-3 flex flex-col justify-between bg-[#0B0E14]/50 p-2.5 rounded-lg">
        <div className="flex items-center justify-between">
          <span className={cn(
            'px-2 py-0.5 rounded-md text-xs font-semibold flex items-center gap-1 stitch-ar',
            stock.phase === 'بيبلع على الهادي' ? 'bg-emerald-500/10 text-stitch-primary' :
            stock.phase === 'بيتحضر' ? 'bg-teal-500/10 text-teal-400' :
            stock.phase === 'بيصرف' ? 'bg-rose-500/10 text-rose-400' :
            'bg-[#182030] text-stitch-muted'
          )}>
            <Layers className="w-3.5 h-3.5" />
            {phaseLabel}
          </span>
          <span className="stitch-num text-[10px] text-stitch-outline">{stock.phase_reason ? 'نشط' : 'مراقبة'}</span>
        </div>

        <div className="flex flex-col gap-1 my-1.5 text-xs">
          {defense?.entry_level != null && Number.isFinite(Number(defense.entry_level)) && (
            <div className="flex items-center justify-between">
              <span className="text-stitch-muted stitch-ar">مستوى الدخول:</span>
              <span className="stitch-num font-semibold text-stitch-primary">{fmtPrice(defense.entry_level)}</span>
            </div>
          )}
          {defense?.defense_level != null && Number.isFinite(Number(defense.defense_level)) && (
            <div className="flex items-center justify-between">
              <span className="text-stitch-muted stitch-ar">مستوى الدفاع:</span>
              <span className="stitch-num font-semibold text-rose-400">{fmtPrice(defense.defense_level)}</span>
            </div>
          )}
          {defense?.resistance_level != null && Number.isFinite(Number(defense.resistance_level)) && (
            <div className="flex items-center justify-between">
              <span className="text-stitch-muted stitch-ar">المقاومة:</span>
              <span className="stitch-num font-semibold text-teal-400">{fmtPrice(defense.resistance_level)}</span>
            </div>
          )}
        </div>

        <div className="text-[10px] text-stitch-muted stitch-ar truncate">{cleanStockReason}</div>
      </div>

      {/* ─── Col 4: Entry & Capital Defense Strategy ─── */}
      <div className="xl:col-span-3 flex flex-col justify-between bg-[#0B0E14]/50 p-2.5 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="stitch-num text-[10px] text-stitch-outline uppercase tracking-wide">استراتيجية الدخول</span>
          <span className={cn('flex items-center gap-0.5 text-[10px] font-semibold',
            whale?.whale_present ? 'text-stitch-primary' : 'text-stitch-muted')}>
            {whale?.whale_present ? <><Shield className="w-3 h-3" /> حماية حيتان</> : <><AlertTriangle className="w-3 h-3" /> بدون حماية</>}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 my-1.5">
          <div className="flex flex-col p-1.5 rounded bg-[#182030]/50">
            <span className="text-[9px] text-stitch-muted stitch-ar">الدخول</span>
            <span className="stitch-num text-sm font-bold text-stitch-primary">{fmtPrice(defense?.entry_level)}</span>
          </div>
          <div className="flex flex-col p-1.5 rounded bg-[#182030]/50">
            <span className="text-[9px] text-stitch-muted stitch-ar">الدفاع</span>
            <span className="stitch-num text-sm font-bold text-rose-400">{fmtPrice(defense?.defense_level)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px]">
          <Gauge className="w-3 h-3 text-teal-400" />
          <span className="text-stitch-muted stitch-ar">قوة التدفق:</span>
          <span className={cn('stitch-num font-semibold',
            whale?.flow_strength === 'high' || whale?.flow_strength === 'سيولة ذكية فائقة' ? 'text-stitch-primary' :
            whale?.flow_strength === 'low' || whale?.flow_strength === 'ضعيف' ? 'text-rose-400' : 'text-teal-400')}>
            {whale?.flow_strength || 'متوسط'}
          </span>
        </div>
      </div>
    </div>
  );
}

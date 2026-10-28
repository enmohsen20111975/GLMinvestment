'use client';

/**
 * IncubatorSection — "خلية فحص الأسهم" (Live Stock Scan UI)
 * ============================================================================
 * Financial Design System Compliant (Clean, High Contrast, Compact).
 * - Matches platform tokens (bg-card, border-border, text-foreground).
 * - Compact cards (reduced vertical footprint by ~60%).
 * - Optional table view + collapsible mode.
 * - Zero hardcoded alien gradients or low-contrast text.
 *
 * PANEL VIEW (2026-10-26 redesign per owner directive):
 * - 3 zones: status bar (A) + candidate list (B) + analysis panel (C).
 * - Auto-advance through candidates every 4s; stops on user interaction.
 * - Real sparkline from /api/stocks/sparkline (price_history.db).
 * - Condition panel from real passed_reasons[] + trigger{} — NO fabrication.
 * - Respects prefers-reduced-motion.
 * ============================================================================
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bell,
  BellRing,
  TrendingUp,
  Target,
  Shield,
  Activity,
  Zap,
  Eye,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  List,
  Radar as RadarIcon,
  Play,
  Pause,
  RefreshCw,
  CheckCircle2,
  Clock,
  Circle,
  AlertTriangle,
  Radio,
  TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StockIconMini } from '@/modules/stock-analysis/components/StockIcon';

// ============================================================================
// Types
// ============================================================================

export interface IncubatorTrigger {
  type: 'VOLUME_SURGE' | 'RESISTANCE_BREAK' | 'SUPPORT_CONFIRM' | 'OTHER' | 'COMPLETE' | string;
  condition_ar: string;
  trigger_price: number | null;
  distance_to_trigger_pct: number;
}

export interface IncubatorCandidate {
  ticker: string;
  name_ar?: string;
  current_price: number;
  readiness_pct: number;
  signals_passed: number;
  total_signals: number;
  passed_reasons: string[];
  trigger: IncubatorTrigger;
  target_if_promoted: number;
  stop_loss_if_promoted: number;
  risk_reward: number;
  stage: 'HEATING_UP' | 'APPROACHING_TRIGGER' | 'UNKNOWN' | string;
  logo_url?: string;
  /** Optional path classification from maker_radar (e.g., 'B_quiet_accumulation_strong') */
  path?: string | null;
  // (ALPHA-SCANNER-ALERTS — owner directive 2026-10-27): enrichment fields
  volume_surge?: boolean;
  change_percent?: number;
  rsi_scanner?: number | null;
  value_traded_official?: number | null;
  relative_volume_10d_official?: number | null;
  turnover_egp?: number;
  logoUrl?: string | null;
  classification?: string;
  // ─── (ALPHA-RADAR-INTELLIGENCE): 4 طبقات ذكاء ──────────────────────────
  price_action?: string | null;
  price_action_evidence?: Record<string, unknown> | null;
  participant_flow_assessment?: string | null;
  participant_evidence_level?: string | null;
  participant_evidence?: Record<string, unknown> | null;
  continuation_assessment?: string | null;
  data_quality_status?: string | null;
  data_quality_reasons?: string[] | null;
  classification_timestamp?: string | null;
}

/**
 * (ALPHA-SCANNER-ALERTS — owner directive 2026-10-27):
 * تنبيه من بيانات السكانر الحية — نشاط غير معتاد (مش توصية شراء).
 */
export interface ScannerAlert {
  ticker: string;
  classification: 'SCANNER_ALERT';
  path: 'F_scanner_alert';
  name_ar?: string;
  movement_type: 'SURGE_UP' | 'SURGE_DOWN' | 'UP' | 'DOWN' | 'FLAT';
  movement_desc?: string;
  change_percent: number;
  volume_surge: boolean;
  current_price: number;
  relative_volume_10d_official?: number | null;
  value_traded_official?: number | null;
  rsi_scanner?: number | null;
  turnover_egp?: number;
  signal: 'HOLD';
  signal_ar?: 'مراقبة';
  readiness_pct: 0;
  under_microscope: false;
  score?: number;
  logo_url?: string | null;
  logoUrl?: string | null;
  // ─── (ALPHA-RADAR-INTELLIGENCE): 4 طبقات ذكاء ──────────────────────────
  price_action?: string | null;
  price_action_evidence?: Record<string, unknown> | null;
  participant_flow_assessment?: string | null;
  participant_evidence_level?: string | null;
  participant_evidence?: Record<string, unknown> | null;
  continuation_assessment?: string | null;
  data_quality_status?: string | null;
  data_quality_reasons?: string[] | null;
  classification_timestamp?: string | null;
}

export interface IncubatorResponse {
  success: boolean;
  market: string;
  total_candidates: number;
  candidates: IncubatorCandidate[];
  /** (ALPHA-SCANNER-ALERTS): تنبيهات السكانر — نشاط غير معتاد. */
  scanner_alerts?: ScannerAlert[];
  /** (ALPHA-SCANNER-ALERTS): مرشحو الحاضنة تحت الميكروسكوب. */
  under_microscope?: IncubatorCandidate[];
  timestamp: string;
  source?: string;
  message?: string;
}

export interface IncubatorSectionProps {
  market?: string;
  refreshIntervalMs?: number;
  maxDisplay?: number;
  className?: string;
  /** Default view mode. 'panel' = new 3-zone design; 'grid'/'table' = legacy. */
  defaultViewMode?: 'panel' | 'grid' | 'table';
  /** Auto-advance interval in ms (panel view). 0 = disabled. Default 4000. */
  autoAdvanceMs?: number;
}

// ============================================================================
// Trigger Icon helper (legacy — used by CandidateCard)
// ============================================================================

function TriggerIcon({ type }: { type: string }) {
  if (type === 'VOLUME_SURGE') return <Activity className="size-3 text-warning" />;
  if (type === 'RESISTANCE_BREAK') return <TrendingUp className="size-3 text-profit" />;
  if (type === 'SUPPORT_CONFIRM') return <Shield className="size-3 text-primary" />;
  return <Zap className="size-3 text-warning" />;
}

// ============================================================================
// Sparkline (real data — SVG path from /api/stocks/sparkline prices[])
// ============================================================================

interface SparklineData {
  prices: number[];
  min: number;
  max: number;
  first: number;
  last: number;
  change_pct: number;
  days: number;
  source: string;
}

function useSparkline(ticker: string | null): {
  data: SparklineData | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<SparklineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/stocks/sparkline?ticker=${encodeURIComponent(ticker)}&days=30`, {
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: SparklineData) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setData(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return { data, loading, error };
}

function MiniSparkline({
  prices,
  changePct,
  loading,
  error,
}: {
  prices: number[];
  changePct: number;
  loading: boolean;
  error: string | null;
}) {
  // SVG path — no fabricated points. If <2 prices → honest empty state.
  if (loading) {
    return (
      <div className="h-16 flex items-center justify-center text-[11px] text-muted-foreground">
        جاري تحميل المنحنى…
      </div>
    );
  }
  if (error || !Array.isArray(prices) || prices.length < 2) {
    return (
      <div className="h-16 flex items-center justify-center text-[11px] text-muted-foreground gap-1.5">
        <AlertTriangle className="size-3" />
        <span>لا توجد بيانات تاريخية كافية لعرض المنحنى</span>
      </div>
    );
  }
  const w = 280,
    h = 60,
    pad = 4;
  const min = Math.min(...prices),
    max = Math.max(...prices);
  const range = max - min || 1;
  const step = (w - pad * 2) / (prices.length - 1);
  const points = prices
    .map((p, i) => {
      const x = pad + i * step;
      const y = h - pad - ((p - min) / range) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const isUp = changePct >= 0;
  const stroke = isUp ? '#26a69a' : '#ef5350';
  // Build area path for subtle fill
  const areaPath = `${points} L${(w - pad).toFixed(1)},${(h - pad).toFixed(1)} L${pad.toFixed(1)},${(
    h - pad
  ).toFixed(1)} Z`;
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-16"
        preserveAspectRatio="none"
        role="img"
        aria-label="منحنى السعر خلال آخر 30 يوم"
      >
        <path d={areaPath} fill={stroke} fillOpacity={0.08} />
        <path
          d={points}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 font-mono">
        <span>آخر {prices.length} جلسة</span>
        <span className={isUp ? 'text-profit' : 'text-loss'}>
          {isUp ? '+' : ''}
          {changePct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Condition Panel — real passed_reasons + trigger from API
// ============================================================================

type ConditionState = 'passed' | 'waiting' | 'failed' | 'unknown';

function ConditionRow({
  state,
  label,
  detail,
}: {
  state: ConditionState;
  label: string;
  detail?: string | null;
}) {
  const config = {
    passed: {
      icon: CheckCircle2,
      color: 'text-profit',
      bg: 'bg-profit/10',
      border: 'border-profit/30',
      label: 'متحقق',
    },
    waiting: {
      icon: Clock,
      color: 'text-warning',
      bg: 'bg-warning/10',
      border: 'border-warning/30',
      label: 'انتظار',
    },
    failed: {
      icon: AlertTriangle,
      color: 'text-loss',
      bg: 'bg-loss/10',
      border: 'border-loss/30',
      label: 'فشل',
    },
    unknown: {
      icon: Circle,
      color: 'text-muted-foreground',
      bg: 'bg-muted/30',
      border: 'border-border/40',
      label: 'غير متاح',
    },
  }[state];
  const Icon = config.icon;
  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-2.5 py-2', config.bg, config.border)}>
      <Icon className={cn('size-3.5 shrink-0 mt-0.5', config.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-foreground leading-tight">{label}</span>
          <span className={cn('text-[10px] font-bold shrink-0', config.color)}>{config.label}</span>
        </div>
        {detail && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{detail}</p>}
      </div>
    </div>
  );
}

function ConditionPanel({ candidate }: { candidate: IncubatorCandidate }) {
  // Build condition rows from REAL API data only.
  // passed_reasons[] → 'passed' rows (one per reason).
  // trigger{} → 'waiting' row (the missing condition).
  // total_signals - signals_passed → if > 0 AND trigger missing → 'unknown' placeholder.
  const passedRows = useMemo(() => {
    return (candidate.passed_reasons || []).map((reason, i) => ({
      key: `passed-${i}`,
      state: 'passed' as const,
      label: reason,
      detail: null as string | null,
    }));
  }, [candidate.passed_reasons]);

  const waitingRows = useMemo(() => {
    const rows: Array<{
      key: string;
      state: 'waiting';
      label: string;
      detail: string | null;
    }> = [];
    if (candidate.trigger?.condition_ar && candidate.trigger.type !== 'COMPLETE') {
      rows.push({
        key: 'trigger-wait',
        state: 'waiting',
        label: candidate.trigger.condition_ar,
        detail:
          candidate.trigger.trigger_price != null
            ? `عند سعر ${candidate.trigger.trigger_price.toFixed(2)}`
            : candidate.trigger.distance_to_trigger_pct != null
              ? `المسافة للشرط: ${candidate.trigger.distance_to_trigger_pct.toFixed(2)}%`
              : null,
      });
    }
    return rows;
  }, [candidate.trigger]);

  // Honest gap: if signals_passed < total_signals AND no explicit trigger, show unknown.
  const missingCount = Math.max(
    0,
    (candidate.total_signals || 0) - (candidate.signals_passed || 0),
  );
  const unknownRows = useMemo(() => {
    if (missingCount > 0 && waitingRows.length === 0) {
      return [
        {
          key: 'unknown-gap',
          state: 'unknown' as const,
          label: `${missingCount} شرط بانتظار التقييم`,
          detail: 'النظام لم يُرجع تفاصيل هذا الشرط بعد.',
        },
      ];
    }
    return [];
  }, [missingCount, waitingRows.length]);

  const allRows = [...passedRows, ...waitingRows, ...unknownRows];

  if (allRows.length === 0) {
    return (
      <div className="text-center py-4 text-[11px] text-muted-foreground">
        لا توجد تفاصيل شروط متاحة لهذا السهم من النظام.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-foreground">شروط الاختراق الفنية</span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {candidate.signals_passed}/{candidate.total_signals} متحقق
        </span>
      </div>
      {allRows.map((row) => (
        <ConditionRow key={row.key} state={row.state} label={row.label} detail={row.detail} />
      ))}
    </div>
  );
}

// ============================================================================
// Hook: prefers-reduced-motion
// ============================================================================

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return reduce;
}

// ============================================================================
// Candidate Analysis Panel (Zone C) — the focused stock's analysis
// ============================================================================

function CandidateAnalysisPanel({
  candidate,
  animKey,
}: {
  candidate: IncubatorCandidate;
  animKey: number;
}) {
  const { data: spark, loading, error } = useSparkline(candidate.ticker);
  const reduceMotion = usePrefersReducedMotion();

  return (
    <div className="flex flex-col gap-3" key={animKey}>
      {/* Zone C.1 — Stock identity */}
      <div
        className={cn(
          'rounded-lg border border-border bg-card/50 p-3',
          !reduceMotion && 'animate-in fade-in slide-in-from-bottom-1 duration-200',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-foreground font-mono">{candidate.ticker}</span>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-1.5 py-0 font-medium h-4',
                  candidate.readiness_pct >= 80
                    ? 'border-profit/30 bg-profit/10 text-profit'
                    : 'border-warning/30 bg-warning/10 text-warning',
                )}
              >
                {candidate.stage === 'APPROACHING_TRIGGER' ? '⚡ جاهز للاختراق' : '🔍 قيد الفحص'}
              </Badge>
              {candidate.path && (
                <span className="text-[10px] text-muted-foreground font-mono">{candidate.path}</span>
              )}
            </div>
            {candidate.name_ar && (
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{candidate.name_ar}</p>
            )}
          </div>
          <div className="text-left shrink-0">
            <div className="font-mono font-bold text-sm text-foreground">
              {candidate.current_price > 0 ? candidate.current_price.toFixed(2) : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground">السعر الحالي</div>
          </div>
        </div>
      </div>

      {/* Zone C.2 — Real price sparkline */}
      <div
        className={cn(
          'rounded-lg border border-border bg-card/50 p-3',
          !reduceMotion && 'animate-in fade-in slide-in-from-bottom-1 duration-200 delay-75',
        )}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-foreground">الحركة السعرية</span>
          {spark?.source && (
            <span className="text-[9px] text-muted-foreground font-mono">المصدر: {spark.source}</span>
          )}
        </div>
        <MiniSparkline
          prices={spark?.prices || []}
          changePct={spark?.change_pct || 0}
          loading={loading}
          error={error}
        />
      </div>

      {/* Zone C.3 — Condition panel (real passed_reasons + trigger) */}
      <div
        className={cn(
          'rounded-lg border border-border bg-card/50 p-3',
          !reduceMotion && 'animate-in fade-in slide-in-from-bottom-1 duration-200 delay-150',
        )}
      >
        <ConditionPanel candidate={candidate} />
      </div>

      {/* Zone C.4 — Promotion targets (only if system provided them) */}
      {(candidate.target_if_promoted > 0 ||
        candidate.stop_loss_if_promoted > 0 ||
        candidate.risk_reward > 0) && (
        <div
          className={cn(
            'rounded-lg border border-border bg-card/50 p-3',
            !reduceMotion && 'animate-in fade-in slide-in-from-bottom-1 duration-200 delay-200',
          )}
        >
          <div className="text-[11px] font-semibold text-foreground mb-2">الأهداف الفنية المتوقعة</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground">الهدف</div>
              <div className="font-mono font-bold text-sm text-profit">
                {candidate.target_if_promoted > 0 ? candidate.target_if_promoted.toFixed(2) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">الوقف</div>
              <div className="font-mono font-bold text-sm text-loss">
                {candidate.stop_loss_if_promoted > 0
                  ? candidate.stop_loss_if_promoted.toFixed(2)
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">R/R</div>
              <div className="font-mono font-bold text-sm text-foreground">
                {candidate.risk_reward > 0 ? candidate.risk_reward.toFixed(1) : '—'}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            قيم محسوبة مسبقًا عند الترقية — ليست توصية شراء فورية.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PANEL VIEW — the new 3-zone redesign
// ============================================================================

function PanelView({
  candidates,
  timestamp,
  onRefresh,
  autoAdvanceMs,
}: {
  candidates: IncubatorCandidate[];
  timestamp: string | null;
  onRefresh: () => void;
  autoAdvanceMs: number;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [userInteracted, setUserInteracted] = useState(false);
  const reduceMotion = usePrefersReducedMotion();

  // Clamp activeIdx when candidates change (e.g., after refresh)
  useEffect(() => {
    if (activeIdx >= candidates.length) setActiveIdx(0);
  }, [candidates.length, activeIdx]);

  // Auto-advance — only if autoPlay AND no recent user interaction AND motion allowed
  useEffect(() => {
    if (!autoPlay || autoAdvanceMs <= 0 || candidates.length <= 1) return;
    if (reduceMotion) return; // respect reduced motion
    const timer = setInterval(() => {
      if (userInteracted) return;
      setActiveIdx((i) => (i + 1) % candidates.length);
    }, autoAdvanceMs);
    return () => clearInterval(timer);
  }, [autoPlay, autoAdvanceMs, candidates.length, userInteracted, reduceMotion]);

  const activeCandidate = candidates[activeIdx] || null;

  // Stats for Zone A
  const hotCount = candidates.filter(
    (c) => c.readiness_pct >= 80 || c.stage === 'APPROACHING_TRIGGER',
  ).length;
  const isStale = (() => {
    if (!timestamp) return true;
    const ageMs = Date.now() - new Date(timestamp).getTime();
    return ageMs > 30 * 60 * 1000; // stale if older than 30 min
  })();

  const handleCandidateClick = (idx: number) => {
    setActiveIdx(idx);
    setUserInteracted(true);
    setAutoPlay(false);
  };

  const handleHover = () => {
    // Pause auto-advance on hover (don't change selection, just pause)
    if (autoPlay) setUserInteracted(true);
  };

  if (candidates.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-xs">
        🔭 لا توجد أسهم قريبة من اكتمال شروط الاختراق في هذه اللحظة.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Zone A — Status bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', isStale ? 'bg-warning' : 'bg-profit')} />
            <span className="text-muted-foreground">
              {isStale ? 'بانتظار تحديث' : 'بيانات محدّثة'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Eye className="size-3 text-muted-foreground" />
            <span className="font-mono text-foreground font-semibold">{candidates.length}</span>
            <span className="text-muted-foreground">قيد المراقبة</span>
          </div>
          {hotCount > 0 && (
            <div className="flex items-center gap-1">
              <Zap className="size-3 text-warning" />
              <span className="font-mono text-warning font-semibold">{hotCount}</span>
              <span className="text-muted-foreground">جاهز للاختراق</span>
            </div>
          )}
          {timestamp && (
            <div className="text-muted-foreground font-mono">
              آخر تحديث:{' '}
              {new Date(timestamp).toLocaleTimeString('ar-EG', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAutoPlay((p) => !p);
              setUserInteracted(false);
            }}
            className="h-7 px-2 text-[11px] gap-1"
            title={autoPlay ? 'إيقاف الاستعراض التلقائي' : 'تشغيل الاستعراض التلقائي'}
            disabled={candidates.length <= 1}
          >
            {autoPlay ? <Pause className="size-3" /> : <Play className="size-3" />}
            <span>{autoPlay ? 'إيقاف' : 'تشغيل'}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRefresh}
            className="h-7 w-7 p-0"
            title="تحديث الآن"
          >
            <RefreshCw className="size-3" />
          </Button>
        </div>
      </div>

      {/* Zones B + C — side by side on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-3">
        {/* Zone B — Candidate list */}
        <div
          className="rounded-lg border border-border bg-card/30 p-1.5 max-h-[420px] overflow-y-auto"
          onMouseEnter={handleHover}
        >
          <div className="space-y-1">
            {candidates.map((c, idx) => {
              const isActive = idx === activeIdx;
              return (
                <button
                  key={`${c.ticker}-${idx}`}
                  onClick={() => handleCandidateClick(idx)}
                  className={cn(
                    'w-full text-right rounded-md border p-2 transition-all duration-200',
                    isActive
                      ? 'border-primary/40 bg-primary/5 shadow-sm ring-1 ring-primary/20'
                      : 'border-transparent hover:bg-muted/40',
                  )}
                  style={isActive ? {
                    // P3-B: Transition Pulse — إطار glow خفيف
                    boxShadow: '0 0 0 2px rgba(var(--primary-rgb, 99, 102, 241), 0.1), 0 1px 3px rgba(0,0,0,0.05)',
                  } : undefined}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <StockIconMini ticker={c.ticker} className="size-4 shrink-0" />
                      <span className="font-bold text-[12px] text-foreground font-mono truncate">
                        {c.ticker}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-foreground shrink-0">
                      {c.current_price > 0 ? c.current_price.toFixed(2) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {/* P1-A: مؤشر الجاهزية الحي — تدرج لوني 3 مراحل */}
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500 ease-out',
                          c.readiness_pct >= 80 ? 'bg-profit' :
                          c.readiness_pct >= 50 ? 'bg-warning' :
                          'bg-muted-foreground/40',
                        )}
                        style={{
                          width: `${Math.min(100, Math.max(0, c.readiness_pct))}%`,
                        }}
                      />
                    </div>
                    <span
                      className={cn(
                        'text-[10px] font-mono font-bold shrink-0 transition-colors duration-300',
                        c.readiness_pct >= 80 ? 'text-profit' :
                        c.readiness_pct >= 50 ? 'text-warning' :
                        'text-muted-foreground',
                      )}
                    >
                      {c.readiness_pct}%
                    </span>
                  </div>
                  {/* P1-B: إثبات الفرصة — Evidence Chips مختصرة */}
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {c.signals_passed > 0 && (
                      <span className="text-[8px] font-mono text-profit/70 bg-profit/5 px-1 py-0.5 rounded">
                        ✅ {c.signals_passed}/{c.total_signals}
                      </span>
                    )}
                    {c.trigger?.condition_ar && c.trigger?.type !== 'COMPLETE' && (
                      <span className="text-[8px] font-mono text-warning/70 bg-warning/5 px-1 py-0.5 rounded">
                        ⏳ {c.trigger.type === 'VOLUME_SURGE' ? 'فوليوم' : c.trigger.type === 'RESISTANCE_BREAK' ? 'اختراق' : 'تأكيد'}
                      </span>
                    )}
                    {c.risk_reward > 0 && (
                      <span className="text-[8px] font-mono text-info/70 bg-info/5 px-1 py-0.5 rounded">
                        R/R {c.risk_reward.toFixed(1)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Zone C — Active candidate analysis */}
        <div className="min-w-0">
          {activeCandidate ? (
            <CandidateAnalysisPanel candidate={activeCandidate} animKey={activeIdx} />
          ) : (
            <div className="text-center py-8 text-muted-foreground text-xs">
              اختر سهمًا من القائمة لعرض التحليل.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Single Candidate Compact Card (legacy grid view — kept for backward compat)
// ============================================================================

function CandidateCard({ c }: { c: IncubatorCandidate }) {
  const [subscribed, setSubscribed] = useState(false);
  const [promoted, setPromoted] = useState(false);

  const handleSubscribe = useCallback(async () => {
    if (subscribed) return;
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setSubscribed(true);
        new Notification('🔭 خلية فحص الأسهم', {
          body: `تم تفعيل التنبيه لـ ${c.ticker} — ستصلك إشارة فور اكتمال الشروط.`,
          icon: '/logo.svg',
        });
      } else {
        setSubscribed(true);
      }
    } else {
      setSubscribed(true);
    }
  }, [subscribed, c.ticker]);

  useEffect(() => {
    if (c.trigger.distance_to_trigger_pct <= 0 && c.trigger.type !== 'COMPLETE') {
      setPromoted(true);
    }
  }, [c.trigger.distance_to_trigger_pct, c.trigger.type]);

  const isHot = c.stage === 'APPROACHING_TRIGGER' || c.readiness_pct >= 80;
  // (ALPHA-SCANNER-ALERTS): enrichment fields من scanner.
  const logo = c.logo_url || c.logoUrl || null;
  const changePct = c.change_percent;
  const hasVolumeSurge = c.volume_surge === true;

  return (
    <div
      className={cn(
        'relative flex flex-col justify-between rounded-lg border bg-card p-3 transition-all duration-200',
        'hover:border-primary/40 hover:shadow-sm',
        promoted ? 'border-profit/50 bg-profit/5 animate-pulse' : 'border-border',
      )}
    >
      {/* Top Row: Symbol + Price */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <StockIconMini ticker={c.ticker} name={c.name_ar} logoUrl={logo} className="size-6 shrink-0" />
            <div className="truncate">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm text-foreground font-mono">{c.ticker}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] px-1.5 py-0 font-medium h-4',
                    isHot
                      ? 'border-profit/30 bg-profit/10 text-profit'
                      : 'border-warning/30 bg-warning/10 text-warning',
                  )}
                >
                  {isHot ? '⚡ جاهز للاختراق' : '🔍 قيد الفحص'}
                </Badge>
                {/* (ALPHA-SCANNER-ALERTS): شارة volume_surge ⚡ لو true */}
                {hasVolumeSurge && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-warning/30 bg-warning/10 text-warning">
                    <Zap className="size-2.5" />
                    حجم
                  </Badge>
                )}
              </div>
              {c.name_ar && (
                <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                  {c.name_ar}
                </p>
              )}
            </div>
          </div>

          <div className="text-left shrink-0">
            <div className="font-mono font-bold text-sm text-foreground">
              {c.current_price > 0 ? c.current_price.toFixed(2) : '—'}
            </div>
            {/* (ALPHA-SCANNER-ALERTS): عرض change_percent اليومي لو موجود */}
            {changePct != null && (
              <div className={cn(
                'text-[10px] font-mono font-bold',
                changePct > 0 ? 'text-profit' : changePct < 0 ? 'text-loss' : 'text-muted-foreground',
              )}>
                {changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%
              </div>
            )}
            {/* (ALPHA-SCANNER-ALERTS): عرض RSI من scanner لو موجود */}
            {c.rsi_scanner != null && (
              <div className="text-[9px] text-muted-foreground font-mono">
                RSI: {c.rsi_scanner.toFixed(1)}
              </div>
            )}
            {changePct == null && c.rsi_scanner == null && (
              <div className="text-[10px] text-muted-foreground">السعر الحالي</div>
            )}
          </div>
        </div>

        {/* Readiness Meter */}
        <div className="mb-2.5">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-muted-foreground text-[10px]">الجاهزية الفنية</span>
            <span
              className={cn(
                'font-bold text-[10px] tabular-nums',
                c.readiness_pct >= 80 ? 'text-profit' : 'text-warning',
              )}
            >
              {c.readiness_pct}% ({c.signals_passed}/{c.total_signals})
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                c.readiness_pct >= 80 ? 'bg-profit' : 'bg-warning',
              )}
              style={{ width: `${Math.min(100, Math.max(0, c.readiness_pct))}%` }}
            />
          </div>
        </div>

        {/* Missing Trigger Condition (1 compact line) */}
        {c.trigger.condition_ar && c.trigger.type !== 'COMPLETE' && (
          <div className="rounded-md border border-warning/20 bg-warning/5 px-2 py-1.5 mb-2.5 flex items-start gap-1.5">
            <TriggerIcon type={c.trigger.type} />
            <div className="text-[11px] leading-tight flex-1 text-foreground/90">
              <span className="text-warning font-semibold text-[10px]">متبقي: </span>
              {c.trigger.condition_ar}
              {c.trigger.trigger_price != null && (
                <span className="font-mono font-medium text-muted-foreground text-[10px] mr-1">
                  (عند {c.trigger.trigger_price.toFixed(2)})
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Metrics + Alert Action */}
      <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-1 text-[11px]">
        <div className="flex items-center gap-2.5 font-mono text-[10px]">
          <div>
            <span className="text-muted-foreground">هدف: </span>
            <span className="font-bold text-profit">
              {c.target_if_promoted > 0 ? c.target_if_promoted.toFixed(2) : '—'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">وقف: </span>
            <span className="font-bold text-loss">
              {c.stop_loss_if_promoted > 0 ? c.stop_loss_if_promoted.toFixed(2) : '—'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">R/R: </span>
            <span className="font-bold text-foreground">
              {c.risk_reward > 0 ? c.risk_reward.toFixed(1) : '—'}
            </span>
          </div>
        </div>

        <Button
          size="sm"
          variant={subscribed ? 'secondary' : 'ghost'}
          onClick={handleSubscribe}
          disabled={subscribed}
          className={cn(
            'h-6 px-2 text-[10px] gap-1 shrink-0',
            subscribed ? 'text-profit font-medium' : 'text-muted-foreground hover:text-foreground',
          )}
          title={subscribed ? 'تنبيه مفعل' : 'نبهني عند اكتمال الشروط'}
        >
          {subscribed ? (
            <>
              <BellRing className="size-3 text-profit" />
              <span>مفعل</span>
            </>
          ) : (
            <>
              <Bell className="size-3" />
              <span>تنبيه</span>
            </>
          )}
        </Button>
      </div>

      {/* (ALPHA-RADAR-INTELLIGENCE): 4 طبقات ذكاء من برافو للحاضنة.
          quiet_accumulation هتكون عندها price_action حقيقية (SURGE_UP, BREAKOUT, ...).
          SCANNER_ALERT عندها price_action=INSUFFICIENT_DATA.
          لو كل الطبقات null → لا تعرض شيئًا (Rule 27). */}
      <IntelligenceBadges
        price_action={c.price_action}
        price_action_evidence={c.price_action_evidence}
        participant_flow_assessment={c.participant_flow_assessment}
        participant_evidence_level={c.participant_evidence_level}
        participant_evidence={c.participant_evidence}
        continuation_assessment={c.continuation_assessment}
        data_quality_status={c.data_quality_status}
        data_quality_reasons={c.data_quality_reasons}
        classification_timestamp={c.classification_timestamp}
      />
    </div>
  );
}

// ============================================================================
// Compact Table Mode (legacy)
// ============================================================================

function CandidateTable({ candidates }: { candidates: IncubatorCandidate[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-right text-xs">
        <thead className="bg-muted/50 text-muted-foreground border-b border-border">
          <tr>
            <th className="p-2.5 font-medium">السهم</th>
            <th className="p-2.5 font-medium">السعر</th>
            <th className="p-2.5 font-medium">الجاهزية</th>
            <th className="p-2.5 font-medium">الشرط المتبقي للاختراق</th>
            <th className="p-2.5 font-medium">الهدف</th>
            <th className="p-2.5 font-medium">الوقف</th>
            <th className="p-2.5 font-medium">R/R</th>
            <th className="p-2.5 font-medium text-center">إشعار</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {candidates.map((c, i) => (
            <tr key={`${c.ticker}-${i}`} className="hover:bg-muted/30 transition-colors">
              <td className="p-2.5 font-bold font-mono">
                <div className="flex items-center gap-1.5">
                  <StockIconMini ticker={c.ticker} className="size-4 shrink-0" />
                  <span>{c.ticker}</span>
                  {c.name_ar && (
                    <span className="text-[11px] font-normal text-muted-foreground">
                      ({c.name_ar})
                    </span>
                  )}
                </div>
              </td>
              <td className="p-2.5 font-mono">{c.current_price.toFixed(2)}</td>
              <td className="p-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'font-bold font-mono text-[11px]',
                      c.readiness_pct >= 80 ? 'text-profit' : 'text-warning',
                    )}
                  >
                    {c.readiness_pct}%
                  </span>
                  <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-full', c.readiness_pct >= 80 ? 'bg-profit' : 'bg-warning')}
                      style={{ width: `${c.readiness_pct}%` }}
                    />
                  </div>
                </div>
              </td>
              <td className="p-2.5 text-muted-foreground text-[11px] max-w-xs truncate">
                {c.trigger.condition_ar || 'بانتظار تأكيد الاختراق'}
              </td>
              <td className="p-2.5 font-mono text-profit font-semibold">
                {c.target_if_promoted.toFixed(2)}
              </td>
              <td className="p-2.5 font-mono text-loss font-semibold">
                {c.stop_loss_if_promoted.toFixed(2)}
              </td>
              <td className="p-2.5 font-mono font-medium">{c.risk_reward.toFixed(1)}</td>
              <td className="p-2.5 text-center">
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                  <Bell className="size-3 text-muted-foreground" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * (ALPHA-RADAR-INTELLIGENCE — owner directive 2026-10-27):
 * 4 طبقات ذكاء من برافو — عرض مختصر كـ badges + تفاصيل قابلة للتوسيع.
 *
 * الطبقات:
 *   1. price_action — تصنيف الحركة السعرية (14 قيمة)
 *   2. participant_flow — تقييم المشاركين (INSTITUTIONAL_EVIDENCE, ...)
 *   3. continuation — قابلية الاستمرار (SUPPORTIVE, MIXED, WEAK, ...)
 *   4. data_quality — حالة البيانات (FRESH, STALE, VERY_STALE, ...)
 *
 * Rule 27: لو الحقل null → لا تعرض الطبقة (no fabrication).
 */
interface IntelligenceProps {
  price_action?: string | null;
  price_action_evidence?: Record<string, unknown> | null;
  participant_flow_assessment?: string | null;
  participant_evidence_level?: string | null;
  participant_evidence?: Record<string, unknown> | null;
  continuation_assessment?: string | null;
  data_quality_status?: string | null;
  data_quality_reasons?: string[] | null;
  classification_timestamp?: string | null;
}

/** ترجمة قيم price_action لعربي مختصر. */
// (ALPHA-FRONTEND-DECOMPOSITION): IntelligenceBadges + translation maps
// مستوردة من shared component (المصدر الموحد) بدل تكرارها هنا.
import {
  IntelligenceBadges,
  PRICE_ACTION_AR, PARTICIPANT_FLOW_AR, CONTINUATION_AR, DATA_QUALITY_AR,
  dataQualityColor,
  type IntelligenceProps,
} from '@/components/shared/IntelligenceBadges';


/**
 * (ALPHA-SCANNER-ALERTS — owner directive 2026-10-27):
 * قسم "تنبيهات السكانر" — نشاط غير معتاد (مش توصية شراء).
 * يعرض الأسهم اللي فيها حركة سع/حجم غير اعتيادية حسب SCANNER_ALERT.
 */
function ScannerAlertsSection({ alerts }: { alerts: ScannerAlert[] }) {
  if (!alerts || alerts.length === 0) {
    return null; // ما تعرضش القسم لو مفيش تنبيهات (no noise).
  }

  return (
    <div className="rounded-lg border border-warning/20 bg-warning/5 overflow-hidden">
      <div className="flex items-center gap-2 p-2.5 border-b border-warning/20 bg-warning/10">
        <Radio className="size-4 text-warning" />
        <h3 className="text-sm font-bold text-warning">📡 تنبيهات السكانر</h3>
        <Badge variant="outline" className="text-[10px] ml-auto border-warning/30 text-warning">
          {alerts.length} نشاط
        </Badge>
      </div>
      <div className="text-[10px] text-muted-foreground px-3 py-1.5 bg-muted/30 border-b border-border/40">
        ⚠️ نشاط غير معتاد — <strong>مش توصية شراء</strong>. للمراقبة فقط.
      </div>
      <div className="divide-y divide-border/30 max-h-80 overflow-y-auto">
        {alerts.map((alert, idx) => {
          const logo = alert.logo_url || alert.logoUrl || null;
          // (ALPHA-SCANNER-ALERTS): شارة الحركة حسب movement_type.
          const movement = alert.movement_type;
          const isSurgeUp = movement === 'SURGE_UP';
          const isSurgeDown = movement === 'SURGE_DOWN';
          const isUp = movement === 'UP' || isSurgeUp;
          const isDown = movement === 'DOWN' || isSurgeDown;

          const movementBadgeClass = isSurgeUp
            ? 'border-profit/30 bg-profit/15 text-profit'
            : isSurgeDown
              ? 'border-loss/30 bg-loss/15 text-loss'
              : isUp
                ? 'border-profit/20 bg-profit/5 text-profit'
                : isDown
                  ? 'border-loss/20 bg-loss/5 text-loss'
                  : 'border-border bg-muted/30 text-muted-foreground';

          const movementArrow = isSurgeUp ? '↑↑' : isSurgeDown ? '↓↓' : isUp ? '↑' : isDown ? '↓' : '→';

          // (ALPHA-SCANNER-ALERTS): value_traded بالمليون.
          const cashMillions = alert.value_traded_official != null
            ? (alert.value_traded_official / 1_000_000).toFixed(1) + 'M'
            : alert.turnover_egp != null
              ? (alert.turnover_egp / 1_000_000).toFixed(1) + 'M'
              : null;

          return (
            <div
              key={`${alert.ticker}-${idx}`}
              className="flex items-center gap-2 p-2 hover:bg-muted/30 transition-colors"
              title={alert.movement_desc || `${alert.ticker} — ${movement}`}
            >
              {/* الأيقونة */}
              <StockIconMini
                ticker={alert.ticker}
                name={alert.name_ar}
                logoUrl={logo}
                className="size-7 shrink-0"
              />

              {/* التيكر + السعر */}
              <div className="flex flex-col min-w-0 flex-shrink-0">
                <span className="text-xs font-bold font-mono">{alert.ticker}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {alert.current_price?.toFixed(2) || '—'} EGP
                </span>
              </div>

              {/* شارة الحركة */}
              <div className={cn(
                'flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[10px] font-bold',
                movementBadgeClass,
              )}>
                <span>{movementArrow}</span>
                <span>{(alert.change_percent ?? 0) > 0 ? '+' : ''}{(alert.change_percent ?? 0).toFixed(2)}%</span>
              </div>

              {/* شارة volume_surge ⚡ */}
              {alert.volume_surge && (
                <Badge variant="outline" className="text-[9px] gap-0.5 border-warning/30 bg-warning/10 text-warning px-1 py-0 shrink-0">
                  <Zap className="size-2.5" />
                  حجم غير اعتيادي
                </Badge>
              )}

              {/* السيولة الكاش */}
              {cashMillions && (
                <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                  <span>💰</span>
                  <span className="font-mono">{cashMillions}</span>
                </div>
              )}

              {/* RSI من scanner */}
              {alert.rsi_scanner != null && (
                <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                  <span>RSI:</span>
                  <span className={cn(
                    'font-mono font-bold',
                    alert.rsi_scanner < 30 ? 'text-profit' : alert.rsi_scanner > 70 ? 'text-loss' : 'text-foreground',
                  )}>
                    {alert.rsi_scanner.toFixed(1)}
                  </span>
                </div>
              )}

              {/* شارة "مراقبة" (مش شراء) */}
              <Badge variant="outline" className="text-[9px] ml-auto border-muted-foreground/30 bg-muted/20 text-muted-foreground shrink-0">
                👁️ مراقبة
              </Badge>

              {/* (ALPHA-RADAR-INTELLIGENCE): 4 طبقات ذكاء من برافو.
                  price_action + participant_flow + continuation + data_quality.
                  لو كل الطبقات null → لا تعرض شيئًا (Rule 27). */}
              <div className="w-full">
                <IntelligenceBadges
                  price_action={alert.price_action}
                  price_action_evidence={alert.price_action_evidence}
                  participant_flow_assessment={alert.participant_flow_assessment}
                  participant_evidence_level={alert.participant_evidence_level}
                  participant_evidence={alert.participant_evidence}
                  continuation_assessment={alert.continuation_assessment}
                  data_quality_status={alert.data_quality_status}
                  data_quality_reasons={alert.data_quality_reasons}
                  classification_timestamp={alert.classification_timestamp}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RadarScannerSweep({ active = true }: { active?: boolean }) {
  return (
    <div className="relative size-6 flex items-center justify-center shrink-0" title="رادار المسح اللحظي نشط">
      <svg className="size-6 text-primary/30" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </svg>
      {active && (
        <div className="absolute inset-0 animate-spin [animation-duration:4s]">
          <svg className="size-6 text-primary" viewBox="0 0 24 24" fill="none">
            <line x1="12" y1="12" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M12 2 A10 10 0 0 1 20 8" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
          </svg>
        </div>
      )}
      <span className="absolute size-1.5 rounded-full bg-profit animate-ping" />
    </div>
  );
}

// ============================================================================
// Main IncubatorSection Component
// ============================================================================

export function IncubatorSection({
  market = 'EGX',
  refreshIntervalMs = 60_000,
  maxDisplay = 0, // 0 = اعرض كل المرشحين (مش محدود بـ 6)
  className,
  defaultViewMode = 'panel',
  autoAdvanceMs = 4000,
}: IncubatorSectionProps) {
  const [candidates, setCandidates] = useState<IncubatorCandidate[]>([]);
  // (ALPHA-SCANNER-ALERTS): state لتنبيهات السكانر (نشاط غير معتاد — مش توصية).
  const [scannerAlerts, setScannerAlerts] = useState<ScannerAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<'panel' | 'grid' | 'table'>(defaultViewMode);
  const [lastTimestamp, setLastTimestamp] = useState<string | null>(null);

  const fetchIncubator = useCallback(async () => {
    // FIX (2026-10-27): لا نمسح البيانات القديمة أثناء التحديث الدوري.
    // لو فيه بيانات موجودة بالفعل، نعتبر ده "تحديث خلفي" ونحتفظ بالقديم
    // حتى وصول البيانات الجديدة الصالحة.
    const hasUsableData = candidates.length > 0;
    if (hasUsableData) {
      setIsBackgroundRefreshing(true);
    }
    try {
      setError(null);
      const res = await fetch(`/api/radar/incubator?market=${encodeURIComponent(market)}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: IncubatorResponse = await res.json();
      if (data.success) {
        // FIX: maxDisplay=0 يعني اعرض الكل (مش محدود)
        setCandidates(maxDisplay > 0 ? data.candidates.slice(0, maxDisplay) : data.candidates);
        // (ALPHA-SCANNER-ALERTS): خزّن تنبيهات السكانر (نشاط غير معتاد — مش توصية).
        setScannerAlerts(data.scanner_alerts || []);
        setLastTimestamp(data.timestamp || null);
      } else {
        // FIX: لا نمسح البيانات القديمة لو الـ API رجع success=false.
        // فقط لو مفيش بيانات قديمة نعرض القائمة الفارغة.
        if (!hasUsableData) {
          setCandidates([]);
          setScannerAlerts([]);
        }
        setLastTimestamp(null);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // FIX: لو فيه بيانات قديمة، احتفظ بيها + اعرض الخطأ بشكل غير مزعج.
      if (!hasUsableData) {
        setError(errMsg);
        setCandidates([]);
      } else {
        setError(errMsg); // اعرض الخطأ بس احتفظ بالبيانات
      }
      setLastTimestamp(null);
    } finally {
      setLoading(false);
      setIsBackgroundRefreshing(false);
    }
  }, [market, maxDisplay, candidates.length]);

  useEffect(() => {
    fetchIncubator();
    if (refreshIntervalMs > 0) {
      const interval = setInterval(fetchIncubator, refreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchIncubator, refreshIntervalMs]);

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-3.5 shadow-sm transition-all',
        className,
      )}
      dir="rtl"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-border/60">
        <div className="flex items-center gap-2">
          <RadarScannerSweep active={!isCollapsed} />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm md:text-base font-bold text-foreground">
                فحص السوق
              </h3>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 font-medium border-warning/30 bg-warning/10 text-warning"
              >
                قيد المراقبة
              </Badge>
              <span className="text-[11px] text-muted-foreground font-mono">
                ({candidates.length} أسهم)
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              أسهم حققت معظم الشروط وتنتظر تأكيد السيولة للترقية لتوقعات حية
            </p>
          </div>
        </div>

        {/* View Switchers & Collapse Toggle */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={viewMode === 'panel' ? 'secondary' : 'ghost'}
            onClick={() => setViewMode('panel')}
            className="h-7 w-7 p-0"
            title="عرض لوحة التحليل (الجديد)"
          >
            <RadarIcon className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            onClick={() => setViewMode('grid')}
            className="h-7 w-7 p-0"
            title="عرض كروت مدمجة"
          >
            <LayoutGrid className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'table' ? 'secondary' : 'ghost'}
            onClick={() => setViewMode('table')}
            className="h-7 w-7 p-0"
            title="عرض جدول"
          >
            <List className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
          >
            {isCollapsed ? (
              <>
                <span>عرض</span>
                <ChevronDown className="size-3.5" />
              </>
            ) : (
              <>
                <span>طي</span>
                <ChevronUp className="size-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ============= Live Scan Status Bar ============= */}
      {/* A2 FIX (2026-10-27): شريط حالة الفحص الحي — بيانات فعلية فقط من الـ API */}
      {!isCollapsed && (
        <div className="flex items-center justify-between flex-wrap gap-2 mt-2 px-3 py-2 rounded-lg bg-muted/20 border border-border/40">
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            {/* Scan status indicator */}
            <div className="flex items-center gap-1.5">
              <span className={cn(
                'size-2 rounded-full',
                isBackgroundRefreshing ? 'bg-info animate-pulse' :
                error ? 'bg-loss' :
                candidates.length > 0 ? 'bg-profit' : 'bg-muted-foreground'
              )} />
              <span className="text-muted-foreground font-medium">
                {isBackgroundRefreshing ? 'جارٍ فحص السوق...' :
                 error ? 'تعذّر التحديث' :
                 candidates.length > 0 ? 'اكتمل الفحص' : 'بانتظار الفحص'}
              </span>
            </div>

            {/* Candidates count (from API — not fabricated) */}
            {candidates.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="font-mono text-foreground font-bold text-sm">{candidates.length}</span>
                <span className="text-muted-foreground">سهم اجتاز الشروط</span>
              </div>
            )}

            {/* Last scan timestamp (from API — not fabricated) */}
            {lastTimestamp && (
              <div className="text-muted-foreground font-mono">
                آخر فحص: {new Date(lastTimestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}

            {/* Error indicator (non-intrusive) */}
            {error && candidates.length > 0 && (
              <div className="text-[10px] text-loss/70">
                ⚠️ عرض آخر بيانات صالحة
              </div>
            )}

            {/* Auto-refresh indicator */}
            {refreshIntervalMs > 0 && (
              <div className="text-[10px] text-muted-foreground/60">
                🔄 تحديث كل {Math.round(refreshIntervalMs / 1000)} ثانية
              </div>
            )}
          </div>

          {/* Manual refresh button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchIncubator()}
            disabled={isBackgroundRefreshing}
            className="h-7 w-7 p-0"
            title="تحديث الآن"
          >
            <RefreshCw className={cn('size-3', isBackgroundRefreshing && 'animate-spin')} />
          </Button>
        </div>
      )}

      {/* Body Content */}
      {!isCollapsed && (
        <div className="pt-3">
          {loading ? (
            <div className="text-center py-6 text-muted-foreground text-xs flex items-center justify-center gap-2">
              <Eye className="size-3.5 animate-pulse" />
              <span>جاري مسح أسهم الرادار...</span>
            </div>
          ) : error ? (
            <div className="text-center py-4 text-warning text-xs">
              ⚠️ تعذّر تحميل بيانات الرادار — حاول مرة أخرى لاحقاً.
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-xs">
              🔭 لا توجد أسهم قريبة من اكتمال شروط الاختراق في هذه اللحظة.
            </div>
          ) : viewMode === 'table' ? (
            <CandidateTable candidates={candidates} />
          ) : viewMode === 'panel' ? (
            <PanelView
              candidates={candidates}
              timestamp={lastTimestamp}
              onRefresh={fetchIncubator}
              autoAdvanceMs={autoAdvanceMs}
            />
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {candidates.map((c, i) => (
                <CandidateCard key={`${c.ticker}-${i}`} c={c} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* (ALPHA-SCANNER-ALERTS — owner directive 2026-10-27):
          قسم "تنبيهات السكانر" — نشاط غير معتاد (مش توصية شراء).
          بيظهر بشكل منفصل تحت الحاضنة. لو مفيش تنبيهات → لا يظهر (no noise). */}
      <ScannerAlertsSection alerts={scannerAlerts} />
    </div>
  );
}

export default IncubatorSection;

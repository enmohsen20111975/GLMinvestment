'use client';

/**
 * IncubatorSection — "رادار التربص وقيد التسخين" (The Stalking Radar UI)
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
}

export interface IncubatorResponse {
  success: boolean;
  market: string;
  total_candidates: number;
  candidates: IncubatorCandidate[];
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
        <span className="text-[11px] font-semibold text-foreground">لوحة فحص الشروط</span>
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
                {candidate.stage === 'APPROACHING_TRIGGER' ? '🔥 وشك' : '🌡️ تسخين'}
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
          <div className="text-[11px] font-semibold text-foreground mb-2">أهداف الترقية المحتملة</div>
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
              <span className="text-muted-foreground">وشك الترقية</span>
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
                    'w-full text-right rounded-md border p-2 transition-colors duration-150',
                    isActive
                      ? 'border-primary/40 bg-primary/5 shadow-sm'
                      : 'border-transparent hover:bg-muted/40',
                  )}
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
                    <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          c.readiness_pct >= 80 ? 'bg-profit' : 'bg-warning',
                        )}
                        style={{
                          width: `${Math.min(100, Math.max(0, c.readiness_pct))}%`,
                        }}
                      />
                    </div>
                    <span
                      className={cn(
                        'text-[10px] font-mono font-bold shrink-0',
                        c.readiness_pct >= 80 ? 'text-profit' : 'text-warning',
                      )}
                    >
                      {c.readiness_pct}%
                    </span>
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
        new Notification('🔭 رادار التربص', {
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
            <StockIconMini ticker={c.ticker} className="size-6 shrink-0" />
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
                  {isHot ? '🔥 وشك' : '🌡️ تسخين'}
                </Badge>
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
            <div className="text-[10px] text-muted-foreground">السعر الحالي</div>
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

// ============================================================================
// Main IncubatorSection Component
// ============================================================================

export function IncubatorSection({
  market = 'EGX',
  refreshIntervalMs = 60_000,
  maxDisplay = 6,
  className,
  defaultViewMode = 'panel',
  autoAdvanceMs = 4000,
}: IncubatorSectionProps) {
  const [candidates, setCandidates] = useState<IncubatorCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<'panel' | 'grid' | 'table'>(defaultViewMode);
  const [lastTimestamp, setLastTimestamp] = useState<string | null>(null);

  const fetchIncubator = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/radar/incubator?market=${encodeURIComponent(market)}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: IncubatorResponse = await res.json();
      if (data.success) {
        setCandidates(data.candidates.slice(0, maxDisplay));
        setLastTimestamp(data.timestamp || null);
      } else {
        setCandidates([]);
        setLastTimestamp(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCandidates([]);
      setLastTimestamp(null);
    } finally {
      setLoading(false);
    }
  }, [market, maxDisplay]);

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
          <span className="text-lg">🔭</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm md:text-base font-bold text-foreground">
                رادار التربص وقيد التسخين
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
    </div>
  );
}

export default IncubatorSection;

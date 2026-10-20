'use client';

/**
 * IncubatorSection — "رادار التربص وقيد التسخين" (The Incubator UI)
 * ============================================================================
 * Per Mohsen's directive 2026-10-20 (ALPHA task):
 *
 * الفلسفة: العميل لما يفتح المنصة، مش عايزين نعرض له شاشة كاش باردة
 * وصامتة توحي بالموت. العميل لازم يشوف "غرفة الطبخ والتربص اللحظي" —
 * الأسهم اللي "على وشك الانفجار" (محققة 4/6 أو 5/6 شروط) ومستنية "تكة"
 * (Trigger) عشان تترقى لتوصية شراء حية.
 *
 * Source: GET /api/radar/incubator?market=EGX
 *   → returns 'candidates' array with ticker, readiness_pct, trigger, etc.
 *
 * Design (per owner directive):
 * - Glassmorphism بخلفية داكنة + توهج كهرماني/بنفسجي (Amber/Purple Glow)
 * - Title: 🔭 رادار التربص وقيد التسخين | The Stalking Radar
 * - Pulsing badge: 🔴 قيد المراقبة اللحظية
 * - Readiness Meter (progress bar with gradient)
 * - Missing Trigger Box (yellow warning)
 * - Passed conditions (green checkmarks)
 * - Deal numbers (entry/target/stop/RR)
 * - 🔔 نبهني فور التفعيل button (Notification API)
 * - Promoted State: 🚀 animation when stock achieves trigger
 *
 * المحظورات (per owner):
 * 1. ممنوع حساب أسعار/أهداف في الفرونت-إند — كل البيانات من الـ API.
 * 2. ممنوع Mock Data — لو الـ API فاضي، اعرض رسالة "الرادار يمسح السوق".
 * 3. Responsive Design للموبايل.
 * ============================================================================
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, BellRing, CheckCircle2, TrendingUp, Target, Shield, Activity, Zap, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ============================================================================
// Types (mirrors the API response contract)
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

// ============================================================================
// Props
// ============================================================================

export interface IncubatorSectionProps {
  /** السوق — default: EGX */
  market?: string;
  /** Auto-refresh interval in ms. default: 60000 (60s). 0 = no refresh. */
  refreshIntervalMs?: number;
  /** Max candidates to display. default: 6. */
  maxDisplay?: number;
  /** className for the root container. */
  className?: string;
}

// ============================================================================
// Helper: readiness color gradient (orange → green)
// ============================================================================

function readinessColor(pct: number): string {
  if (pct >= 80) return 'from-emerald-500 to-green-400'; // green (approaching trigger)
  if (pct >= 60) return 'from-amber-500 to-yellow-400';   // warm amber (heating up)
  return 'from-orange-600 to-amber-500';                  // cool (early stage)
}

function readinessTextColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-400';
  if (pct >= 60) return 'text-amber-400';
  return 'text-orange-400';
}

// ============================================================================
// Trigger Icon helper
// ============================================================================

function TriggerIcon({ type }: { type: string }) {
  if (type === 'VOLUME_SURGE') return <Activity className="h-3.5 w-3.5" />;
  if (type === 'RESISTANCE_BREAK') return <TrendingUp className="h-3.5 w-3.5" />;
  if (type === 'SUPPORT_CONFIRM') return <Shield className="h-3.5 w-3.5" />;
  return <Zap className="h-3.5 w-3.5" />;
}

// ============================================================================
// Single Candidate Card
// ============================================================================

function CandidateCard({ c }: { c: IncubatorCandidate }) {
  const [subscribed, setSubscribed] = useState(false);
  const [promoted, setPromoted] = useState(false);

  // Notification subscription (per owner directive: "🔔 نبهني فور التفعيل")
  const handleSubscribe = useCallback(async () => {
    if (subscribed) return;
    // Request browser notification permission
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setSubscribed(true);
        // In production, this would also register a webhook with the backend
        // (the intraday_scanner.py promotion hook would send a notification).
        new Notification('🔭 رادار التربص', {
          body: `تم تفعيل التنبيه لـ ${c.ticker} — هتـوصلك إشعار أول ما يترقى.`,
          icon: '/logo.svg',
        });
      }
    } else {
      // Fallback: just mark as subscribed (webhook-only)
      setSubscribed(true);
    }
  }, [subscribed, c.ticker]);

  // Simulate promotion detection (in production, this would be a WebSocket
  // event from the intraday_scanner.py promotion hook).
  // For now, we just check if the trigger distance crosses 0.
  useEffect(() => {
    if (c.trigger.distance_to_trigger_pct <= 0 && c.trigger.type !== 'COMPLETE') {
      setPromoted(true);
    }
  }, [c.trigger.distance_to_trigger_pct, c.trigger.type]);

  return (
    <div
      className={cn(
        'relative rounded-xl border p-4 backdrop-blur-md transition-all',
        promoted
          ? 'border-emerald-400/60 bg-emerald-950/40 shadow-[0_0_20px_rgba(52,211,153,0.3)] animate-pulse'
          : 'border-amber-500/30 bg-slate-900/60 hover:border-amber-400/50'
      )}
    >
      {/* Promoted badge (animation when trigger achieved) */}
      {promoted && (
        <div className="absolute -top-3 right-4">
          <Badge className="bg-emerald-500 text-white border-emerald-400 text-[10px] font-bold shadow-lg">
            🚀 تم الانفجار والانتقال لتوصيات الشراء!
          </Badge>
        </div>
      )}

      {/* Header: ticker + name + stage badge */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-base text-white">{c.ticker}</span>
            <Badge
              className={cn(
                'text-[9px] font-semibold',
                c.stage === 'APPROACHING_TRIGGER'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              )}
            >
              {c.stage === 'APPROACHING_TRIGGER' ? '🔥 على وشك' : '🌡️ تسخين'}
            </Badge>
          </div>
          {c.name_ar && (
            <p className="text-[10px] text-slate-400 mt-0.5 truncate">{c.name_ar}</p>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">السعر</div>
          <div className="font-mono font-bold text-white text-sm">{c.current_price.toFixed(2)}</div>
        </div>
      </div>

      {/* Readiness Meter */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="text-slate-400">الجاهزية</span>
          <span className={cn('font-bold tabular-nums', readinessTextColor(c.readiness_pct))}>
            {c.readiness_pct}% — {c.signals_passed} من {c.total_signals} شروط
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={cn('h-full rounded-full bg-gradient-to-r transition-all', readinessColor(c.readiness_pct))}
            style={{ width: `${c.readiness_pct}%` }}
            role="progressbar"
            aria-valuenow={c.readiness_pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      {/* Missing Trigger Box (yellow warning) */}
      {c.trigger.type !== 'COMPLETE' && (
        <div className="mb-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <TriggerIcon type={c.trigger.type} />
            <span className="text-[10px] font-bold text-yellow-400">⏳ الشرط المتبقي للاختراق:</span>
          </div>
          <p className="text-[11px] text-yellow-200 leading-snug">{c.trigger.condition_ar}</p>
          {c.trigger.trigger_price != null && (
            <div className="mt-1.5 flex items-center justify-between text-[10px]">
              <span className="text-slate-400">سعر التفعيل:</span>
              <span className="font-mono font-bold text-yellow-300">
                {c.trigger.trigger_price.toFixed(2)}
                {c.trigger.distance_to_trigger_pct > 0 && (
                  <span className="text-slate-400 font-normal">
                    {' '}(باقي +{c.trigger.distance_to_trigger_pct.toFixed(1)}%)
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Passed conditions (green checkmarks) */}
      {c.passed_reasons.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] text-slate-400 mb-1.5">الشروط المتحققة:</div>
          <ul className="space-y-1">
            {c.passed_reasons.slice(0, 4).map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[10px] text-slate-300">
                <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deal numbers (if promoted) */}
      <div className="grid grid-cols-3 gap-2 mb-3 pt-2 border-t border-slate-700/50">
        <div>
          <div className="text-[9px] text-slate-400 flex items-center gap-0.5">
            <Target className="h-2.5 w-2.5" /> هدف
          </div>
          <div className="font-mono font-bold text-emerald-400 text-xs">
            {c.target_if_promoted.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-slate-400 flex items-center gap-0.5">
            <Shield className="h-2.5 w-2.5" /> وقف
          </div>
          <div className="font-mono font-bold text-red-400 text-xs">
            {c.stop_loss_if_promoted.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-slate-400">R/R</div>
          <div className={cn(
            'font-mono font-bold text-xs',
            c.risk_reward >= 1.8 ? 'text-emerald-400' : 'text-amber-400'
          )}>
            {c.risk_reward.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Bell button — subscribe to notification */}
      {!promoted && (
        <Button
          size="sm"
          variant={subscribed ? 'secondary' : 'outline'}
          onClick={handleSubscribe}
          disabled={subscribed}
          className={cn(
            'w-full gap-1.5 text-[11px] h-7',
            subscribed
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : 'bg-transparent border-amber-500/40 text-amber-300 hover:bg-amber-500/10'
          )}
        >
          {subscribed ? (
            <>
              <BellRing className="h-3 w-3" /> تم التفعيل — هتوصلك إشعار
            </>
          ) : (
            <>
              <Bell className="h-3 w-3" /> 🔔 نبهني فور التفعيل
            </>
          )}
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Main IncubatorSection component
// ============================================================================

export function IncubatorSection({
  market = 'EGX',
  refreshIntervalMs = 60_000,
  maxDisplay = 6,
  className,
}: IncubatorSectionProps) {
  const [candidates, setCandidates] = useState<IncubatorCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const fetchIncubator = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/radar/incubator?market=${encodeURIComponent(market)}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: IncubatorResponse = await res.json();
      if (data.success) {
        setCandidates(data.candidates.slice(0, maxDisplay));
        setLastUpdated(data.timestamp || new Date().toISOString());
      } else {
        setCandidates([]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [market, maxDisplay]);

  useEffect(() => {
    fetchIncubator();
    // Auto-refresh
    if (refreshIntervalMs > 0) {
      const interval = setInterval(fetchIncubator, refreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchIncubator, refreshIntervalMs]);

  // ============================================================================
  // Glassmorphism container with amber/purple glow
  // ============================================================================
  return (
    <div
      className={cn(
        'relative rounded-2xl border border-amber-500/20',
        'bg-gradient-to-br from-slate-900/80 via-purple-950/40 to-amber-950/30',
        'backdrop-blur-xl',
        'shadow-[0_0_30px_rgba(251,191,36,0.08)]',
        'p-4 md:p-5',
        className
      )}
      dir="rtl"
    >
      {/* Subtle glow overlay */}
      <div className="absolute inset-0 rounded-2xl pointer-events-none bg-gradient-to-br from-amber-500/5 via-transparent to-purple-500/5" />

      {/* Header */}
      <div className="relative flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔭</span>
          <div>
            <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2 flex-wrap">
              رادار التربص وقيد التسخين
              <span className="text-[10px] font-normal text-slate-400" dir="ltr">
                | The Stalking Radar
              </span>
            </h3>
            {lastUpdated && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                آخر تحديث: {new Date(lastUpdated).toLocaleString('ar-EG')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <Badge className="bg-red-500/20 text-red-300 border-red-500/40 text-[10px] font-bold">
            قيد المراقبة اللحظية
          </Badge>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-8 text-slate-400 text-sm">
          <div className="inline-flex items-center gap-2">
            <Eye className="h-4 w-4 animate-pulse" />
            جاري مسح السوق...
          </div>
        </div>
      ) : error ? (
        <div className="text-center py-6 text-amber-400 text-sm">
          <p>⚠️ تعذّر تحميل بيانات الرادار — حاول تاني بعد شوية.</p>
          <p className="text-[10px] text-slate-500 mt-1">({error})</p>
        </div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">
          <div className="inline-flex items-center gap-2">
            <Eye className="h-4 w-4" />
            🔭 الرادار يمسح السوق حالياً — لا توجد أسهم قريبة من اكتمال شروط الاختراق في هذه اللحظة.
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {candidates.map((c, i) => (
            <CandidateCard key={`${c.ticker}-${i}`} c={c} />
          ))}
        </div>
      )}

      {/* Footer */}
      {candidates.length > 0 && (
        <div className="relative mt-4 pt-3 border-t border-amber-500/10 text-[10px] text-slate-500 text-center">
          الأسهم دي مش توصيات شراء — دي تحت المراقبة اللحظية لحد ما تحقق شرط التفعيل.
          أول ما يتحقق الشرط، بـ تتـرقى تلقائياً لتوصية شراء حية.
        </div>
      )}
    </div>
  );
}

export default IncubatorSection;

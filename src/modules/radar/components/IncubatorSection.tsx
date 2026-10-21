'use client';

/**
 * IncubatorSection — "رادار التربص وقيد التسخين" (The Stalking Radar UI)
 * ============================================================================
 * Financial Design System Compliant (Clean, High Contrast, Compact).
 * - Matches platform tokens (bg-card, border-border, text-foreground).
 * - Compact cards (reduced vertical footprint by ~60%).
 * - Optional table view + collapsible mode.
 * - Zero hardcoded alien gradients or low-contrast text.
 * ============================================================================
 */

import React, { useState, useEffect, useCallback } from 'react';
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
}

// ============================================================================
// Trigger Icon helper
// ============================================================================

function TriggerIcon({ type }: { type: string }) {
  if (type === 'VOLUME_SURGE') return <Activity className="size-3 text-warning" />;
  if (type === 'RESISTANCE_BREAK') return <TrendingUp className="size-3 text-profit" />;
  if (type === 'SUPPORT_CONFIRM') return <Shield className="size-3 text-primary" />;
  return <Zap className="size-3 text-warning" />;
}

// ============================================================================
// Single Candidate Compact Card
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
        promoted ? 'border-profit/50 bg-profit/5 animate-pulse' : 'border-border'
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
                      : 'border-warning/30 bg-warning/10 text-warning'
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
                c.readiness_pct >= 80 ? 'text-profit' : 'text-warning'
              )}
            >
              {c.readiness_pct}% ({c.signals_passed}/{c.total_signals})
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                c.readiness_pct >= 80 ? 'bg-profit' : 'bg-warning'
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
            subscribed ? 'text-profit font-medium' : 'text-muted-foreground hover:text-foreground'
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
// Compact Table Mode
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
                  {c.name_ar && <span className="text-[11px] font-normal text-muted-foreground">({c.name_ar})</span>}
                </div>
              </td>
              <td className="p-2.5 font-mono">{c.current_price.toFixed(2)}</td>
              <td className="p-2.5">
                <div className="flex items-center gap-2">
                  <span className={cn('font-bold font-mono text-[11px]', c.readiness_pct >= 80 ? 'text-profit' : 'text-warning')}>
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
              <td className="p-2.5 font-mono text-profit font-semibold">{c.target_if_promoted.toFixed(2)}</td>
              <td className="p-2.5 font-mono text-loss font-semibold">{c.stop_loss_if_promoted.toFixed(2)}</td>
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
}: IncubatorSectionProps) {
  const [candidates, setCandidates] = useState<IncubatorCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

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
      } else {
        setCandidates([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCandidates([]);
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
        className
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

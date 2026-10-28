'use client';

/**
 * RadarMomentumTab.tsx — توقعات زخم الرادار (عالية المخاطر)
 * ====================================================================
 * (ALPHA-RADAR-MOMENTUM — owner directive 2026-10-28):
 * «توقعات مضاربية عالية المخاطر، مبنية على الزخم ونشاط التداول كما يرصدها النظام.
 *  لا تمثل ضمانًا للربح، وقد تتغير الإشارة أو تفشل.»
 *
 * مصدر البيانات: GET /api/radar/incubator?market=EGX
 *   → candidates (incubator_candidates: quiet_accumulation + pre_surge)
 *   → under_microscope (quiet_accumulation تحت الميكروسكوب)
 *
 * قواعد العرض (per owner directive):
 *   - لا نخلط بين مرشح الرادار والتوقع النشط المسجل.
 *   - الحالة: «مرشح رادار» — مش «توقع شراء نشط».
 *   - entry/stop/target تُعرض فقط لو موجودة في الـ radar candidate.
 *   - لا نختلق أسعار أو أهداف أو وقف خسارة.
 *   - لا نعرض نسب نجاح أو احتمالات ربح غير مثبتة.
 *   - IntelligenceBadges بـ يعرض الطبقات الحقيقية من Backend.
 *   - لو مفيش مرشحين مؤهلين → رسالة واضحة (لا نملأ بأسهم عشوائية).
 *
 * Rule 27: null = null (no fabrication).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle, Activity, TrendingUp, Target, Shield,
  Loader2, RefreshCw, Radio, Eye, Clock, Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { StockIconMini } from '@/modules/stock-analysis/components/StockIcon';
import { IntelligenceBadges } from '@/components/shared/IntelligenceBadges';
import { cn, fmtPrice } from '@/lib/utils';

// ─── Types (matching IncubatorCandidate from IncubatorSection) ─────────────

interface RadarCandidate {
  ticker: string;
  name_ar?: string;
  current_price: number;
  readiness_pct: number;
  signals_passed: number;
  total_signals: number;
  passed_reasons?: string[];
  trigger?: {
    type?: string;
    condition_ar?: string;
    trigger_price?: number | null;
    distance_to_trigger_pct?: number | null;
  };
  target_if_promoted?: number;
  stop_loss_if_promoted?: number;
  risk_reward?: number;
  stage?: string;
  path?: string | null;
  // Intelligence layers (merged from results by DbManager)
  price_action?: string | null;
  price_action_evidence?: Record<string, unknown> | null;
  participant_flow_assessment?: string | null;
  participant_evidence_level?: string | null;
  participant_evidence?: Record<string, unknown> | null;
  continuation_assessment?: string | null;
  data_quality_status?: string | null;
  data_quality_reasons?: string[] | null;
  classification_timestamp?: string | null;
  // Enrichment
  volume_surge?: boolean | null;
  change_percent?: number | null;
  rsi_scanner?: number | null;
  value_traded_official?: number | null;
  turnover_egp?: number;
  logo_url?: string | null;
  logoUrl?: string | null;
  classification?: string;
}

interface IncubatorResponse {
  success: boolean;
  market: string;
  total_candidates: number;
  candidates: RadarCandidate[];
  under_microscope?: RadarCandidate[];
  timestamp: string;
  source?: string;
  is_fresh?: boolean;
  message?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RadarMomentumTab({ market = 'EGX' }: { market?: string }) {
  const [candidates, setCandidates] = useState<RadarCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTimestamp, setLastTimestamp] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchData = useCallback(async (background = false) => {
    if (background) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await fetch(`/api/radar/incubator?market=${encodeURIComponent(market)}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: IncubatorResponse = await res.json();

      if (!isMountedRef.current) return;

      if (data.success) {
        // دمج candidates + under_microscope (dedup by ticker).
        const all = [...(data.candidates || []), ...(data.under_microscope || [])];
        const seen = new Set<string>();
        const deduped: RadarCandidate[] = [];
        for (const c of all) {
          const t = (c.ticker || '').toUpperCase();
          if (t && !seen.has(t)) {
            seen.add(t);
            deduped.push(c);
          }
        }
        // فلتر: بس المرشحين اللي عندهم readiness_pct > 0 (مش فاضيين).
        const filtered = deduped.filter((c) => c.readiness_pct > 0);
        setCandidates(filtered);
        setLastTimestamp(data.timestamp || null);
      } else {
        if (!background) setCandidates([]);
        setError(data.message || 'فشل تحميل البيانات');
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (!background) setCandidates([]);
      setError(msg);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [market]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchData(false);
    const interval = setInterval(() => fetchData(true), 60_000); // تحديث كل دقيقة
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-warning" />
        <span className="text-xs text-muted-foreground mr-2">جارٍ تحميل توقعات الرادار...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Risk Warning — ثابت وواضح */}
      <div className="flex items-start gap-2 p-2.5 rounded-lg border border-warning/20 bg-warning/5">
        <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-warning">توقعات مضاربية عالية المخاطر</strong> — مبنية على الزخم
          ونشاط التداول كما يرصدها رادار السيولة. لا تمثل ضمانًا للربح، وقد تتغير الإشارة أو تفشل.
          ليست نصيحة استثمارية مرخّصة. استشر مستشاراً ماليًا قبل أي قرار.
        </p>
      </div>

      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-warning" />
          <span className="text-xs font-bold">مرشحو الرادار: {candidates.length}</span>
          {lastTimestamp && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(lastTimestamp).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => fetchData(true)}
          disabled={isRefreshing}
          className="h-7 gap-1 text-xs"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
          تحديث
        </Button>
      </div>

      {/* Error */}
      {error && candidates.length === 0 && (
        <div className="text-center py-8">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-loss/50" />
          <p className="text-xs text-muted-foreground">
            تعذّر تحميل توقعات الرادار: {error}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchData(false)}
            className="mt-2 text-xs"
          >
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* Empty state — لا نملأ بأسهم عشوائية */}
      {candidates.length === 0 && !error && (
        <div className="text-center py-12">
          <Eye className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground font-medium">
            لا توجد حاليًا توقعات زخم تستوفي شروط العرض.
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            الرادار بـ يراقب السوق بانتظام — تظهر هنا المرشحون عند تحقق الشروط.
          </p>
        </div>
      )}

      {/* Candidates list */}
      {candidates.length > 0 && (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {candidates.map((c, idx) => (
            <RadarCandidateCard key={`${c.ticker}-${idx}`} candidate={c} />
          ))}
        </div>
      )}

      {/* Footer disclaimer */}
      <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 border border-border/40">
        <Eye className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
          المرشحون المعروضون هنا ليسوا توقعات شراء مسجلة في قاعدة البيانات — هم نتائج مسح رادار
          السيولة الآلي. الحالة «مرشح رادار» تعني أن السهم أظهر نشاط زخم محتمل، لكن ذلك لا يعني
          تأكيد الصفقة. التحقق النهائي مسؤولية المستخدم.
        </p>
      </div>
    </div>
  );
}

// ─── Candidate Card ──────────────────────────────────────────────────────────

function RadarCandidateCard({ candidate }: { candidate: RadarCandidate }) {
  const logo = candidate.logo_url || candidate.logoUrl || null;
  const isHighReadiness = candidate.readiness_pct >= 80;
  const hasTrigger = candidate.trigger?.trigger_price != null;
  const hasTargets = candidate.target_if_promoted != null && candidate.stop_loss_if_promoted != null;
  const changePct = candidate.change_percent;
  const hasVolumeSurge = candidate.volume_surge === true;

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all',
        isHighReadiness
          ? 'border-warning/30 bg-warning/5'
          : 'border-border bg-card',
      )}
    >
      {/* Row 1: Identity + Status */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <StockIconMini
            ticker={candidate.ticker}
            name={candidate.name_ar}
            logoUrl={logo}
            className="size-7 shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm font-mono">{candidate.ticker}</span>
              <Badge
                variant="outline"
                className={cn(
                  'text-[9px] px-1 py-0 h-4',
                  isHighReadiness
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : 'border-muted-foreground/30 bg-muted/20 text-muted-foreground',
                )}
              >
                🔬 مرشح رادار
              </Badge>
              {/* change_percent */}
              {changePct != null && (
                <span className={cn(
                  'text-[10px] font-mono font-bold',
                  changePct > 0 ? 'text-profit' : changePct < 0 ? 'text-loss' : 'text-muted-foreground',
                )}>
                  {changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%
                </span>
              )}
              {/* volume_surge ⚡ */}
              {hasVolumeSurge && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-warning/30 bg-warning/10 text-warning">
                  <Zap className="w-2.5 h-2.5" />
                  حجم
                </Badge>
              )}
            </div>
            {candidate.name_ar && (
              <span className="text-[10px] text-muted-foreground truncate">{candidate.name_ar}</span>
            )}
          </div>
        </div>

        {/* Price + readiness */}
        <div className="text-left shrink-0">
          <div className="font-mono font-bold text-sm">
            {candidate.current_price > 0 ? candidate.current_price.toFixed(2) : '—'}
          </div>
          <div className="text-[9px] text-muted-foreground">
            جاهزية: <span className={cn('font-bold', isHighReadiness ? 'text-warning' : '')}>{candidate.readiness_pct}%</span>
          </div>
        </div>
      </div>

      {/* Row 2: Intelligence Badges */}
      <div className="mt-2">
        <IntelligenceBadges
          price_action={candidate.price_action}
          price_action_evidence={candidate.price_action_evidence}
          participant_flow_assessment={candidate.participant_flow_assessment}
          participant_evidence_level={candidate.participant_evidence_level}
          participant_evidence={candidate.participant_evidence}
          continuation_assessment={candidate.continuation_assessment}
          data_quality_status={candidate.data_quality_status}
          data_quality_reasons={candidate.data_quality_reasons}
          classification_timestamp={candidate.classification_timestamp}
        />
      </div>

      {/* Row 3: Trigger + Entry/Stop/Target (only if available) */}
      {(hasTrigger || hasTargets) && (
        <>
          <Separator className="my-2" />
          <div className="grid grid-cols-3 gap-2 text-center">
            {/* Trigger */}
            <div>
              <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                <Target className="w-2.5 h-2.5" />
                التفعيل
              </div>
              <div className="font-mono text-xs font-bold">
                {candidate.trigger?.trigger_price != null
                  ? fmtPrice(candidate.trigger.trigger_price)
                  : '—'}
              </div>
              {candidate.trigger?.distance_to_trigger_pct != null && (
                <div className="text-[8px] text-muted-foreground">
                  {candidate.trigger.distance_to_trigger_pct > 0 ? '+' : ''}
                  {candidate.trigger.distance_to_trigger_pct.toFixed(1)}%
                </div>
              )}
            </div>
            {/* Stop loss */}
            <div>
              <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                <Shield className="w-2.5 h-2.5" />
                الوقف
              </div>
              <div className="font-mono text-xs font-bold text-loss">
                {candidate.stop_loss_if_promoted != null && candidate.stop_loss_if_promoted > 0
                  ? fmtPrice(candidate.stop_loss_if_promoted)
                  : '—'}
              </div>
            </div>
            {/* Target */}
            <div>
              <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                <TrendingUp className="w-2.5 h-2.5" />
                الهدف
              </div>
              <div className="font-mono text-xs font-bold text-profit">
                {candidate.target_if_promoted != null && candidate.target_if_promoted > 0
                  ? fmtPrice(candidate.target_if_promoted)
                  : '—'}
              </div>
            </div>
          </div>
          {/* R/R */}
          {candidate.risk_reward != null && candidate.risk_reward > 0 && (
            <div className="text-center mt-1">
              <span className="text-[9px] text-muted-foreground">
                العائد/المخاطرة: <span className="font-bold text-foreground">{candidate.risk_reward.toFixed(1)}:1</span>
              </span>
            </div>
          )}
        </>
      )}

      {/* Row 4: Signals passed (honest — not probability) */}
      {candidate.passed_reasons && candidate.passed_reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {candidate.passed_reasons.slice(0, 4).map((reason, i) => (
            <Badge key={i} variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-muted-foreground/20 text-muted-foreground">
              {reason}
            </Badge>
          ))}
          {candidate.passed_reasons.length > 4 && (
            <span className="text-[8px] text-muted-foreground">
              +{candidate.passed_reasons.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Row 5: Trigger condition (if available) */}
      {candidate.trigger?.condition_ar && (
        <div className="mt-1.5 text-[10px] text-muted-foreground/80 italic" dir="rtl">
          ⏳ {candidate.trigger.condition_ar}
        </div>
      )}
    </div>
  );
}

export default RadarMomentumTab;

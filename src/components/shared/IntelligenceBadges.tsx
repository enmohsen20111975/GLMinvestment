'use client';

/**
 * IntelligenceBadges.tsx — شارات الـ 4 طبقات ذكاء (shared component)
 * ====================================================================
 * (ALPHA-RADAR-INTELLIGENCE — owner directive 2026-10-28):
 * بيعرض الـ 4 طبقات ذكاء من برافو كـ badges مختصرة + تفاصيل expandable.
 *
 * مستخدم في:
 *   - IncubatorSection (الحاضنة + تنبيهات السكانر)
 *   - LiquidityRadarView (رادار السيولة)
 *
 * الطبقات:
 *   1. price_action — تصنيف الحركة السعرية (14 قيمة)
 *   2. participant_flow — تقييم المشاركين (INSTITUTIONAL_EVIDENCE, ...)
 *   3. continuation — قابلية الاستمرار (SUPPORTIVE, MIXED, WEAK, ...)
 *   4. data_quality — حالة البيانات (FRESH, STALE, VERY_STALE, ...)
 *
 * Rule 27: لو كل الطبقات null → لا تعرض شيئًا (no fabrication).
 */

import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface IntelligenceProps {
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

// ─── Arabic translations ──────────────────────────────────────────────────

const PRICE_ACTION_AR: Record<string, string> = {
  SURGE_UP: 'ارتفاع قوي',
  SURGE_DOWN: 'انخفاض قوي',
  BULLISH_WAVE_START: 'بداية موجة صاعدة',
  BEARISH_WAVE_START: 'بداية موجة هابطة',
  BULLISH_CONTINUATION: 'استمرار صاعد',
  BEARISH_CONTINUATION: 'استمرار هابط',
  BOUNCE_AFTER_DECLINE: 'ارتداد بعد هبوط',
  PULLBACK_AFTER_RALLY: 'تصحيح بعد صعود',
  BREAKOUT: 'اختراق',
  BREAKDOWN: 'كسر',
  SIDEWAYS: 'عرضي',
  MOMENTUM_EXHAUSTION: 'إرهاق الزخم',
  UNCONFIRMED: 'غير مؤكد',
  INSUFFICIENT_DATA: 'بيانات ناقصة',
};

const PARTICIPANT_FLOW_AR: Record<string, string> = {
  INSTITUTIONAL_EVIDENCE: 'أدلة مؤسسية',
  SPECULATIVE_PATTERN: 'نمط مضاربي',
  MIXED_PARTICIPATION: 'مشاركة مختلطة',
  UNCONFIRMED: 'غير مؤكد',
  UNAVAILABLE: 'غير متاح',
};

const CONTINUATION_AR: Record<string, string> = {
  SUPPORTIVE: 'داعم للاستمرار',
  MIXED: 'مختلط',
  WEAK: 'ضعيف',
  UNCONFIRMED: 'غير مؤكد',
  INSUFFICIENT_DATA: 'بيانات ناقصة',
};

const DATA_QUALITY_AR: Record<string, string> = {
  FRESH: 'بيانات حديثة',
  STALE: 'بيانات قديمة',
  VERY_STALE: 'بيانات قديمة جدًا',
  INSUFFICIENT_HISTORY: 'تاريخ ناقص',
  GAPS: 'فجوات بيانات',
  UNAVAILABLE: 'بيانات غير متاحة',
  OK: 'بيانات سليمة',
};

// ─── Color helpers ─────────────────────────────────────────────────────────

function dataQualityColor(status: string | null | undefined): string {
  if (!status) return 'border-border bg-muted/20 text-muted-foreground';
  if (status === 'FRESH' || status === 'OK') return 'border-profit/30 bg-profit/10 text-profit';
  if (status === 'STALE') return 'border-warning/30 bg-warning/10 text-warning';
  if (status === 'VERY_STALE' || status === 'UNAVAILABLE' || status === 'GAPS' || status === 'INSUFFICIENT_HISTORY')
    return 'border-loss/30 bg-loss/10 text-loss';
  return 'border-border bg-muted/20 text-muted-foreground';
}

// ─── Main component ─────────────────────────────────────────────────────────

export function IntelligenceBadges(props: IntelligenceProps) {
  const [expanded, setExpanded] = useState(false);
  const hasAny =
    props.price_action || props.participant_flow_assessment ||
    props.continuation_assessment || props.data_quality_status;

  if (!hasAny) return null; // Rule 27: لو كل الطبقات null → لا تعرض شيئًا.

  return (
    <div className="flex flex-wrap items-center gap-1">
      {/* Layer 1: price_action */}
      {props.price_action && (
        <Badge
          variant="outline"
          className="text-[9px] px-1 py-0 h-4 border-primary/30 bg-primary/5 text-primary"
          title={`الحركة السعرية: ${props.price_action}`}
        >
          {PRICE_ACTION_AR[props.price_action] || props.price_action}
        </Badge>
      )}

      {/* Layer 2: participant_flow */}
      {props.participant_flow_assessment && (
        <Badge
          variant="outline"
          className="text-[9px] px-1 py-0 h-4 border-whale/30 bg-whale/5 text-whale"
          title={`المشاركون: ${props.participant_flow_assessment}${props.participant_evidence_level ? ` (${props.participant_evidence_level})` : ''}`}
        >
          {PARTICIPANT_FLOW_AR[props.participant_flow_assessment] || props.participant_flow_assessment}
        </Badge>
      )}

      {/* Layer 3: continuation */}
      {props.continuation_assessment && (
        <Badge
          variant="outline"
          className="text-[9px] px-1 py-0 h-4 border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-400"
          title={`قابلية الاستمرار: ${props.continuation_assessment}`}
        >
          {CONTINUATION_AR[props.continuation_assessment] || props.continuation_assessment}
        </Badge>
      )}

      {/* Layer 4: data_quality */}
      {props.data_quality_status && (
        <Badge
          variant="outline"
          className={cn('text-[9px] px-1 py-0 h-4', dataQualityColor(props.data_quality_status))}
          title={props.data_quality_reasons?.join('، ') || `حالة البيانات: ${props.data_quality_status}`}
        >
          {DATA_QUALITY_AR[props.data_quality_status] || props.data_quality_status}
        </Badge>
      )}

      {/* Expand button — لو فيه أدلة تفصيلية */}
      {(props.price_action_evidence || props.participant_evidence || (props.data_quality_reasons && props.data_quality_reasons.length > 0)) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] text-muted-foreground hover:text-foreground underline ml-1"
        >
          {expanded ? 'إخفاء' : 'تفاصيل'}
        </button>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="w-full mt-1 p-2 rounded-md bg-muted/30 border border-border/40 text-[10px] space-y-1">
          {props.price_action_evidence && Object.keys(props.price_action_evidence).length > 0 && (
            <div>
              <span className="font-bold text-primary">أدلة الحركة:</span>{' '}
              {Object.entries(props.price_action_evidence).map(([k, v]) => `${k}=${String(v)}`).join('، ')}
            </div>
          )}
          {props.participant_evidence && Object.keys(props.participant_evidence).length > 0 && (
            <div>
              <span className="font-bold text-whale">أدلة المشاركين:</span>{' '}
              {Object.entries(props.participant_evidence).map(([k, v]) => `${k}=${String(v)}`).join('، ')}
            </div>
          )}
          {props.data_quality_reasons && props.data_quality_reasons.length > 0 && (
            <div>
              <span className="font-bold text-loss">أسباب جودة البيانات:</span>{' '}
              {props.data_quality_reasons.join('، ')}
            </div>
          )}
          {props.classification_timestamp && (
            <div className="text-muted-foreground">
              وقت التصنيف: {new Date(props.classification_timestamp).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IntelligenceBadges;

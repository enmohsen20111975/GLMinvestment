'use client';

/**
 * ExitSignalBadge — مكون قابل لإعادة الاستخدام لعرض إشارات الخروج والتحذير
 * ============================================================================
 * Phase: Exit / Sell Signals — Alpha scope (UI only)
 *
 * القواعد:
 * - كل البيانات من الـ API — لا حسابات في الواجهة (Rule 20)
 * - لو البيانات ناقصة/قديمة → عرض "—" أو إخفاء (مش اختلاق)
 * - 3 حالات: EXIT / TAKE_PROFIT / CAUTION
 * - ألوان دلالية: أحمر للخروج، أخضر للجني، كهرماني للتحذير
 * - خفيف على الموبايل (لا animations ثقيلة)
 *
 * العقد المقترح (من Bravo):
 * {
 *   signal: "EXIT" | "TAKE_PROFIT" | "CAUTION" | null,
 *   action_ar: string | null,        // نص عربي مختصر
 *   reasons: Array<{ code: string, text: string }> | null,
 *   trailing_stop: number | null,     // سعر الوقف المتحرك
 *   reference_price: number | null,   // السعر المرجعي
 *   data_timestamp: string | null,    // توقيت البيانات
 *   status: "CONFIRMED" | "PENDING" | null
 * }
 * ============================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import {
  DoorOpen,
  Target,
  AlertTriangle,
  Shield,
  Clock,
  TrendingDown,
} from 'lucide-react';

// ============================================================================
// Types — matching the proposed contract (no fabrication)
// ============================================================================

export type ExitSignalType = 'EXIT' | 'TAKE_PROFIT' | 'CAUTION' | null;

export interface ExitReason {
  code: string;
  text: string;
}

export interface ExitSignalData {
  signal?: ExitSignalType;
  action_ar?: string | null;
  reasons?: ExitReason[] | null;
  trailing_stop?: number | null;
  reference_price?: number | null;
  data_timestamp?: string | null;
  status?: 'CONFIRMED' | 'PENDING' | null;
}

// ============================================================================
// Config — colors, icons, labels per signal type
// ============================================================================

const SIGNAL_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; bg: string; border: string; label: string; default_ar: string }
> = {
  EXIT: {
    icon: DoorOpen,
    color: 'text-loss',
    bg: 'bg-loss/10',
    border: 'border-loss/30',
    label: 'خروج',
    default_ar: 'خروج',
  },
  TAKE_PROFIT: {
    icon: Target,
    color: 'text-profit',
    bg: 'bg-profit/10',
    border: 'border-profit/30',
    label: 'جني أرباح',
    default_ar: 'جني أرباح',
  },
  CAUTION: {
    icon: AlertTriangle,
    color: 'text-warning',
    bg: 'bg-warning/10',
    border: 'border-warning/30',
    label: 'تحذير',
    default_ar: 'احذر',
  },
};

// ============================================================================
// Main component — compact badge (for table cells / list items)
// ============================================================================

export function ExitSignalBadge({
  data,
  compact = false,
  className,
}: {
  data: ExitSignalData | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  // لو مفيش بيانات → لا تعرض شيء (مش اختلاق)
  if (!data || !data.signal) return null;

  const config = SIGNAL_CONFIG[data.signal];
  if (!config) return null;

  const Icon = config.icon;
  const actionText = data.action_ar || config.default_ar;
  const isConfirmed = data.status === 'CONFIRMED';

  if (compact) {
    // Compact mode: just icon + label (for table cells)
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border',
          config.bg,
          config.color,
          config.border,
          className,
        )}
        title={data.reasons?.[0]?.text || actionText}
      >
        <Icon className="size-3" />
        <span>{actionText}</span>
        {isConfirmed && <span className="size-1 rounded-full bg-current opacity-60" />}
      </span>
    );
  }

  // Full mode: icon + label + reasons + trailing stop
  return (
    <div className={cn('rounded-lg border p-2 space-y-1.5', config.bg, config.border, className)}>
      {/* Header: icon + action + status */}
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4', config.color)} />
        <span className={cn('text-xs font-bold', config.color)}>{actionText}</span>
        {isConfirmed && (
          <span className={cn('text-[9px] font-mono px-1 py-0.5 rounded', config.bg, config.color)}>
            مؤكد
          </span>
        )}
        {data.status === 'PENDING' && (
          <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground">
            قيد المراجعة
          </span>
        )}
      </div>

      {/* Reasons — لو موجودة وصالحة */}
      {data.reasons && data.reasons.length > 0 && (
        <div className="space-y-0.5">
          {data.reasons.slice(0, 3).map((reason, i) => (
            <div key={i} className="flex items-start gap-1 text-[10px] text-muted-foreground">
              <span className="text-current opacity-50">•</span>
              <span>{reason.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Trailing stop — لو موجود وصالح (> 0) */}
      {data.trailing_stop != null && data.trailing_stop > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Shield className="size-3" />
          <span>وقف متحرك: </span>
          <span className="font-mono font-semibold text-foreground">
            {data.trailing_stop.toFixed(2)}
          </span>
        </div>
      )}

      {/* Reference price — لو موجود وصالح (> 0) */}
      {data.reference_price != null && data.reference_price > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <TrendingDown className="size-3" />
          <span>سعر مرجعي: </span>
          <span className="font-mono font-semibold text-foreground">
            {data.reference_price.toFixed(2)}
          </span>
        </div>
      )}

      {/* Data timestamp — لو موجود */}
      {data.data_timestamp && (
        <div className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <Clock className="size-2.5" />
          <span>{new Date(data.data_timestamp).toLocaleString('ar-EG', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
          })}</span>
        </div>
      )}

      {/* Stale data warning — لو التوقيت أقدم من 30 دقيقة */}
      {data.data_timestamp && isStale(data.data_timestamp) && (
        <div className="text-[9px] text-warning/70">
          ⚠️ بيانات قديمة — تحقق من التحديث
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helper: stale check (> 30 minutes old)
// ============================================================================

function isStale(timestamp: string): boolean {
  try {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    return ageMs > 30 * 60 * 1000; // 30 minutes
  } catch {
    return true; // لو التاريخ مش صالح → اعتبره قديم
  }
}

// ============================================================================
// Helper: extract ExitSignalData from existing API fields
// ============================================================================

/**
 * parseExitSignalFromPrediction — يحول حقول الـ prediction الموجودة
 * لـ ExitSignalData. لو مفيش إشارة خروج → null.
 *
 * ده مش "حساب" — ده mapping من حقول موجودة للعقد الجديد.
 */
export function parseExitSignalFromPrediction(pred: {
  signal?: string | null;
  exit_type?: string | null;
  status?: string | null;
}): ExitSignalData | null {
  // لو الـ signal = SELL → EXIT
  if (pred.signal?.toUpperCase() === 'SELL') {
    return {
      signal: 'EXIT',
      action_ar: 'خروج',
      status: 'CONFIRMED',
      reasons: [{ code: 'SELL_SIGNAL', text: 'إشارة بيع من المحرك' }],
    };
  }

  // لو exit_type فيه شيء مفهوم
  if (pred.exit_type) {
    const et = pred.exit_type.toLowerCase();
    if (et.includes('target') || et.includes('profit')) {
      return {
        signal: 'TAKE_PROFIT',
        action_ar: 'جني أرباح',
        status: 'CONFIRMED',
        reasons: [{ code: 'TARGET_HIT', text: 'تم ضرب الهدف' }],
      };
    }
    // FIX: trailing check BEFORE stop check (trailing_stop contains "stop")
    if (et.includes('trailing')) {
      return {
        signal: 'CAUTION',
        action_ar: 'احذر — وقف متحرك',
        status: 'PENDING',
        reasons: [{ code: 'TRAILING_STOP', text: 'الوقف المتحرك قريب' }],
      };
    }
    if (et.includes('stop') || et.includes('loss')) {
      return {
        signal: 'EXIT',
        action_ar: 'خروج — وقف خسارة',
        status: 'CONFIRMED',
        reasons: [{ code: 'STOP_LOSS', text: 'تم ضرب وقف الخسارة' }],
      };
    }
  }

  // لو الـ status فيه إشارة
  if (pred.status) {
    const st = pred.status.toLowerCase();
    if (st.includes('closed') || st.includes('stopped')) {
      return {
        signal: 'EXIT',
        action_ar: 'خروج — صفقة مغلقة',
        status: 'CONFIRMED',
        reasons: [{ code: 'POSITION_CLOSED', text: 'الصفقة تم إغلاقها' }],
      };
    }
  }

  return null;
}

/**
 * parseExitSignalFromRadarStock — يحول تصنيف الرادار لـ ExitSignalData.
 * لو السهم في تصريف/فخ → إشارة CAUTION/EXIT.
 */
export function parseExitSignalFromRadarStock(stock: {
  classification?: string | null;
  phase?: string | null;
}): ExitSignalData | null {
  const cls = stock.classification?.toLowerCase() || '';
  const phase = stock.phase?.toLowerCase() || '';

  // distribution = تصريف = CAUTION
  if (cls.includes('distribution') || phase.includes('distribution')) {
    return {
      signal: 'CAUTION',
      action_ar: 'تحذير — تصريف',
      status: 'CONFIRMED',
      reasons: [{ code: 'DISTRIBUTION', text: 'السهم في مرحلة تصريف مؤسسي' }],
    };
  }

  // dead_trap = فخ = EXIT (تجنب)
  if (cls.includes('dead_trap') || phase.includes('dead_trap')) {
    return {
      signal: 'EXIT',
      action_ar: 'تجنب — فخ سيولة',
      status: 'CONFIRMED',
      reasons: [{ code: 'DEAD_TRAP', text: 'فخ سيولة — تجنب الدخول' }],
    };
  }

  // rule80_downtrend = هبوط قوي = CAUTION
  if (cls.includes('rule80_downtrend') || phase.includes('rule80')) {
    return {
      signal: 'CAUTION',
      action_ar: 'تحذير — هبوط قوي',
      status: 'CONFIRMED',
      reasons: [{ code: 'RULE80_DOWNTREND', text: 'السهم في هبوط قوي (Rule 80)' }],
    };
  }

  return null;
}

export default ExitSignalBadge;

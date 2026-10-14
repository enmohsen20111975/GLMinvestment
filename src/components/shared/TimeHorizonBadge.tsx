'use client';

/**
 * TimeHorizonBadge — شارة الأفق الزمني المتوهجة (Glowing Badge)
 * ==============================================================
 * T-ALPHA-A1: استبدال مسميات الشخصيات (مستثمر/مضارب/متوازن) بالأفق الزمني:
 *   ⚡ يومية (1-5 أيام) — بوهج أصفر/ذهبي
 *   🎯 أسبوعية (2-4 أسابيع) — بوهج أزرق نيون
 *   🛡️ استراتيجية (شهر+) — بوهج أخضر زمردي
 *
 * Rule 4: لا حساب مالي — مجرد mapping من persona field إلى label + glow color.
 */

import React from 'react';
import { cn } from '@/lib/utils';

type Persona = 'conservative' | 'balanced' | 'gambler' | 'investor' | string | null | undefined;

interface Props {
  persona?: Persona;
  size?: 'sm' | 'md';
  className?: string;
}

const HORIZON_MAP: Record<string, { emoji: string; label: string; glow: string; bg: string; text: string; border: string }> = {
  conservative: {
    emoji: '🛡️',
    label: 'استراتيجية',
    glow: 'shadow-[0_0_8px_rgba(16,185,129,0.4)]',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-500/40',
  },
  investor: {
    emoji: '🛡️',
    label: 'استراتيجية',
    glow: 'shadow-[0_0_8px_rgba(16,185,129,0.4)]',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-500/40',
  },
  balanced: {
    emoji: '🎯',
    label: 'أسبوعية',
    glow: 'shadow-[0_0_8px_rgba(59,130,246,0.4)]',
    bg: 'bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-500/40',
  },
  gambler: {
    emoji: '⚡',
    label: 'يومية',
    glow: 'shadow-[0_0_8px_rgba(245,158,11,0.4)]',
    bg: 'bg-amber-500/10',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-500/40',
  },
};

const DEFAULT_HORIZON = {
  emoji: '⏳',
  label: 'مرنة',
  glow: '',
  bg: 'bg-muted/30',
  text: 'text-muted-foreground',
  border: 'border-border/40',
};

export function TimeHorizonBadge({ persona, size = 'sm', className }: Props) {
  const config = (persona && HORIZON_MAP[persona]) || DEFAULT_HORIZON;
  const sizeClass = size === 'sm' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border font-bold transition-all',
        sizeClass,
        config.bg,
        config.text,
        config.border,
        config.glow,
        className,
      )}
      title={`أفق زمني: ${config.label}`}
    >
      <span className="text-[10px]">{config.emoji}</span>
      {config.label}
    </span>
  );
}

// Helper: map persona to horizon label for display
export function personaToHorizonLabel(persona?: Persona): string {
  if (!persona) return 'مرنة';
  const config = HORIZON_MAP[persona] || DEFAULT_HORIZON;
  return `${config.emoji} ${config.label}`;
}

// Helper: format R:R for bold display
export function formatRR(rr: number | null | undefined): string {
  if (rr == null || !Number.isFinite(Number(rr))) return '—';
  const val = Number(rr);
  return `R:R 1:${val.toFixed(1)}`;
}

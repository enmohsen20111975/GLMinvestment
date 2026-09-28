'use client';

/**
 * PinnableWidget — Dashboard widget wrapper that adds a small "📌 Pin"
 * toggle to each major widget's header (Phase 5.2 — Mobile-First UX).
 *
 * - Renders a thin header row with the widget title (RTL, right-aligned)
 *   and a Pin/PinOff icon button (left-aligned).
 * - Clicking the button calls `togglePin(widgetId)` on the Zustand store.
 * - Pinned state persists to localStorage (`egx-pinned-widgets`).
 * - Visually highlights pinned widgets with an emerald accent border.
 *
 * Used inside DashboardView. Wraps the existing SafeWidget + widget combo.
 */

import React, { ReactNode } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface PinnableWidgetProps {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}

export function PinnableWidget({ id, title, children, className }: PinnableWidgetProps) {
  const pinnedWidgets = useAppStore((s) => s.pinnedWidgets);
  const togglePin = useAppStore((s) => s.togglePin);
  const isPinned = pinnedWidgets.includes(id);

  return (
    <div
      className={cn(
        'rounded-xl transition-colors',
        isPinned
          ? 'ring-2 ring-emerald-500/40 ring-offset-1 ring-offset-background'
          : '',
        className
      )}
    >
      <div className="flex items-center justify-between mb-2" dir="rtl">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
        <button
          type="button"
          onClick={() => togglePin(id)}
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors min-w-[44px] min-h-[44px] sm:min-h-[28px] sm:min-w-[28px]',
            isPinned
              ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          aria-pressed={isPinned}
          aria-label={isPinned ? `إلغاء تثبيت ${title}` : `تثبيت ${title}`}
          title={isPinned ? 'إلغاء التثبيت' : 'تثبيت في الأعلى'}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>
      </div>
      {children}
    </div>
  );
}

export default PinnableWidget;

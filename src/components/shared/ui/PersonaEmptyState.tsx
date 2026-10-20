'use client';

/**
 * PersonaEmptyState — P0-COMPONENT-UNIFICATION (Phase 1.9)
 * ====================================================================
 * Empty state موحّد لـ persona tabs (conservative / balanced / gambler).
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 15+ inline persona empty states في PersonaTab +
 * PersonaTableView. كل واحد بـ نص مختلف + style مختلف.
 *
 * PersonaEmptyState بـ يستخدم UnifiedEmptyState (موجود بس 1 file بـ
 * يستخدمه!) + PERSONA_THEMES من lib/persona-config.ts (Phase 0).
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { UnifiedEmptyState } from '@/components/shared/ui/UnifiedEmptyState';
import { getPersonaTheme, type Persona, type LegacyPersona } from '@/lib/persona-config';
import { Inbox } from 'lucide-react';

export interface PersonaEmptyStateProps {
  /** الـ persona. */
  persona: Persona | LegacyPersona | string | null | undefined;
  /** عنوان الـ empty state. default: theme-derived. */
  title?: string;
  /** وصف الـ empty state. default: theme-derived. */
  description?: string;
  /** نص زر الإجراء (optional). */
  actionLabel?: string;
  /** callback زر الإجراء. */
  onAction?: () => void;
  className?: string;
}

/**
 * @example
 * <PersonaEmptyState persona="conservative" />
 *
 * @example
 * <PersonaEmptyState
 *   persona="balanced"
 *   title="مفيش فرص متوازنة"
 *   description="السوق في وضع دفاعي — جرّب tab تاني"
 *   actionLabel="تحديث"
 *   onAction={refetch}
 * />
 */
export function PersonaEmptyState({
  persona,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: PersonaEmptyStateProps) {
  const theme = getPersonaTheme(persona);

  // Default title + description from theme
  const finalTitle = title || `${theme.emoji} ${theme.label} — مفيش فرص`;
  const finalDescription = description || theme.description;

  // Pass icon as a React element (not a component type) — that's what
  // UnifiedEmptyState expects.
  const iconElement = <Inbox className="h-8 w-8 text-muted-foreground" />;

  return (
    <UnifiedEmptyState
      icon={iconElement}
      title={finalTitle}
      description={finalDescription}
      actionLabel={actionLabel}
      onAction={onAction}
      className={cn(className)}
    />
  );
}

export default PersonaEmptyState;

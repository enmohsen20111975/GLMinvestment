/**
 * academy-encyclopedia/constants.ts
 * =================================
 * Static configuration for the AcademyEncyclopedia family: category metadata,
 * level labels, level badge variants, and the localStorage key for progress.
 *
 * Extracted from the original `AcademyEncyclopedia.tsx` (2,054 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

import type { CategoryMeta, Level } from './types';

export const CATEGORIES: CategoryMeta[] = [
  { id: 'basics', label: 'الأساسيات', icon: '📘', color: 'text-sky-600' },
  { id: 'technical', label: 'التحليل الفني', icon: '📈', color: 'text-violet-600' },
  { id: 'fundamental', label: 'التحليل الأساسي', icon: '🏛️', color: 'text-warning' },
  { id: 'smc', label: 'SMC / ICT', icon: '⚙️', color: 'text-loss' },
  { id: 'risk', label: 'إدارة المخاطر', icon: '🛡️', color: 'text-profit' },
  { id: 'psychology', label: 'سيكولوجية التداول', icon: '🧘', color: 'text-fuchsia-600' },
  // Task 29 Fix 4 — new category to surface Islamic finance / purification lessons
  { id: 'islamic', label: 'التمويل الإسلامي', icon: '🕌', color: 'text-whale ' },
];

export const LEVEL_LABELS: Record<Level, string> = {
  beginner: 'مبتدئ',
  intermediate: 'متوسط',
  advanced: 'متقدم',
};

export const LEVEL_BADGE_VARIANT: Record<
  Level,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  beginner: 'secondary',
  intermediate: 'default',
  advanced: 'destructive',
};

export const PROGRESS_KEY = 'academy_progress';

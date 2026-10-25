/**
 * academy-encyclopedia/progress.ts
 * ================================
 * localStorage-backed progress tracker for the AcademyEncyclopedia family.
 *
 * Extracted from the original `AcademyEncyclopedia.tsx` (2,054 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 *
 * SSR-safe — both helpers no-op when `typeof window === 'undefined'`.
 */

import { PROGRESS_KEY } from './constants';
import type { AcademyProgress } from './types';

export function loadProgress(): AcademyProgress {
  if (typeof window === 'undefined') {
    return { completedLessonIds: [], quizScores: {} };
  }
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { completedLessonIds: [], quizScores: {} };
    const parsed = JSON.parse(raw) as Partial<AcademyProgress>;
    return {
      completedLessonIds: parsed.completedLessonIds ?? [],
      quizScores: parsed.quizScores ?? {},
    };
  } catch {
    return { completedLessonIds: [], quizScores: {} };
  }
}

export function saveProgress(p: AcademyProgress) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

/**
 * academy-encyclopedia/types.ts
 * =============================
 * All TypeScript types + interfaces for the AcademyEncyclopedia family.
 *
 * Extracted from the original `AcademyEncyclopedia.tsx` (2,054 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 *
 * Naming + semantics preserved 1:1 with the original file so every existing
 * reference (LessonDiagram, LessonQuiz, AcademyEncyclopedia) keeps working.
 */

import type { LessonContent, LessonSection } from '../LessonPDFExporter';

export type Category = LessonContent['category'];
export type Level = LessonContent['level'];

export interface Lesson extends LessonContent {}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

// ── Sub-component prop / state types ──

export interface CategoryMeta {
  id: Category;
  label: string;
  icon: string;
  color: string;
}

export interface AcademyProgress {
  completedLessonIds: string[];
  quizScores: Record<string, number>; // lessonId -> correct count
}

export interface QuizState {
  selected: Record<number, number>; // questionIndex -> selectedOptionIndex
  submitted: boolean;
}

// Re-export the LessonContent / LessonSection types so callers can import every
// academy-encyclopedia type from one place.
export type { LessonContent, LessonSection } from '../LessonPDFExporter';

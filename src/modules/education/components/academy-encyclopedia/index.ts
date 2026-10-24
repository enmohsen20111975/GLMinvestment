/**
 * academy-encyclopedia/index.ts
 * ============================
 * Barrel for the AcademyEncyclopedia family.
 *
 * Re-exports:
 *  - AcademyEncyclopedia (default + named) — main container.
 *  - Sub-components: LessonDiagram, LessonQuiz.
 *  - helpers: loadProgress, saveProgress, renderBody.
 *  - constants: CATEGORIES, LEVEL_LABELS, LEVEL_BADGE_VARIANT, PROGRESS_KEY.
 *  - data: LESSONS (12 lessons across 6 categories).
 *  - types: Category, Level, Lesson, QuizQuestion, CategoryMeta, AcademyProgress, QuizState.
 */

export { AcademyEncyclopedia, default } from './AcademyEncyclopedia';

export { LessonDiagram } from './LessonDiagram';
export type { LessonDiagramProps } from './LessonDiagram';

export { LessonQuiz } from './LessonQuiz';
export type { LessonQuizProps } from './LessonQuiz';

export { renderBody } from './renderBody';
export { loadProgress, saveProgress } from './progress';
export { LESSONS } from './lessons';

export {
  CATEGORIES,
  LEVEL_LABELS,
  LEVEL_BADGE_VARIANT,
  PROGRESS_KEY,
} from './constants';

export type {
  Category,
  Level,
  Lesson,
  QuizQuestion,
  CategoryMeta,
  AcademyProgress,
  QuizState,
  LessonContent,
  LessonSection,
} from './types';

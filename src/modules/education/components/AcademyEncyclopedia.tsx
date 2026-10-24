/**
 * AcademyEncyclopedia.tsx (shim)
 * ======================================
 * Re-export shim. The actual implementation now lives in the
 * `academy-encyclopedia/` folder as part of Task
 * F-Phase3-Split-Reports+Edu (split from 2,054 LOC).
 *
 * Sub-modules:
 *   - academy-encyclopedia/AcademyEncyclopedia.tsx       (container, < 400 LOC)
 *   - academy-encyclopedia/lessons.ts                   (LESSONS catalog — 12 lessons)
 *   - academy-encyclopedia/progress.ts                  (loadProgress + saveProgress)
 *   - academy-encyclopedia/renderBody.tsx               (**bold** inline renderer)
 *   - academy-encyclopedia/LessonDiagram.tsx            (inline SVG diagrams)
 *   - academy-encyclopedia/LessonQuiz.tsx               (interactive quiz)
 *   - academy-encyclopedia/constants.ts                 (CATEGORIES + LEVEL_LABELS + PROGRESS_KEY)
 *   - academy-encyclopedia/types.ts                     (all interfaces)
 *
 * Backward compatible: existing import sites keep working unchanged.
 *   - src/modules/education/index.ts barrel.
 *   - src/modules/education/components/academy/AcademyView.tsx.
 */
export {
  AcademyEncyclopedia,
  default,
} from './academy-encyclopedia/AcademyEncyclopedia';

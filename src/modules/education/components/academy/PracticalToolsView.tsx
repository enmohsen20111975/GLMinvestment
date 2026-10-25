'use client';

/**
 * academy/PracticalToolsView.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Practical Tools tab container (Task ID 32). Two interactive calculators
 * that replace the most-asked-about code blocks from lessons 01-12
 * (owner feedback: "أنت بتعرض كود برمجي حرفي لشخص مش مبرمج"):
 *   1) PositionSizeCalculator — حاسبة حجم الصفقة
 *   2) BiasDetectorQuiz — كاشف التحيز السلوكي
 * ============================================================================
 */

import { PositionSizeCalculator } from './PositionSizeCalculator';
import { BiasDetectorQuiz } from './BiasDetectorQuiz';

export function PracticalToolsView() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-warning/20 bg-warning/20 px-4 py-3 text-xs text-warning sm:px-6">
        <span className="font-semibold">🧮 الأدوات العملية —</span> حاسبتان عمليتان لكل مستثمر: الأولى
        تحسب حجم الصفقة المثالي بناءً على المخاطرة المسموحة، والثانية تكشف تحيزاتك السلوكية المهيمنة
        وتوجّهك للدرس المناسب.
      </div>
      <PositionSizeCalculator />
      <BiasDetectorQuiz />
    </div>
  );
}

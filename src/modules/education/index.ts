// src/modules/education/index.ts
// Public API for the education module.
// Rule 63 (NO-NEW-SCREENS-FILES — Education Unification 2026-10-01):
//   LearningView + learning-content.ts + learning-store.ts archived to
//   archive/education-duplicate-2026-10-01/. Single canonical education
//   screen is now #academy (AcademyView) which already hosts the
//   encyclopedia + 3 simulators + LessonPDFExporter.

// Reusable visual primitives (still consumed by AcademyEncyclopedia + CryptoLearningView)
export { MathText } from './components/MathRenderer';
export { DiagramRenderer, CalloutBox, ExampleCard } from './components/LearningVisuals';

// Academy (interactive simulators + encyclopedia + advanced MD lessons)
export { AcademyView } from './components/AcademyView';
export { AcademyEncyclopedia } from './components/AcademyEncyclopedia';
export { CandlestickSimulator } from './components/CandlestickSimulator';
export { LessonPDFExporter } from './components/LessonPDFExporter';
export { PaperTradingWorkstation } from './components/PaperTradingWorkstation';
export { StrategySandbox } from './components/StrategySandbox';

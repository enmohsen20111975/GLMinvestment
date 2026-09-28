// src/modules/education/index.ts
// Public API for the education module.
// Merges academy + learning components.

// Learning (theoretical content with quizzes & lessons)
export { LearningView } from './components/LearningView';
export { MathText } from './components/MathRenderer';
export { DiagramRenderer, CalloutBox, ExampleCard } from './components/LearningVisuals';

// Academy (interactive simulators + encyclopedia)
export { AcademyView } from './components/AcademyView';
export { AcademyEncyclopedia } from './components/AcademyEncyclopedia';
export { CandlestickSimulator } from './components/CandlestickSimulator';
export { LessonPDFExporter } from './components/LessonPDFExporter';
export { PaperTradingWorkstation } from './components/PaperTradingWorkstation';
export { StrategySandbox } from './components/StrategySandbox';

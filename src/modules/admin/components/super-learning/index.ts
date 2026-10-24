/**
 * super-learning/index.ts
 * =======================
 * Barrel exports for the Super Learning System module.
 *
 * Re-exports the main `SuperLearningSystem` component + the constants + helpers +
 * types so consumers can import via a single entry point:
 * `import { SuperLearningSystem, PERSONA_INFO } from './super-learning';`
 */
export { SuperLearningSystem } from './SuperLearningSystem';
export { HeaderSection } from './HeaderSection';
export { ActionButtonsCard } from './ActionButtonsCard';
export { PredictionsEngineTab } from './tabs/PredictionsEngineTab';
export { ParametersTab } from './tabs/ParametersTab';
export { ConfigTab } from './tabs/ConfigTab';
export { AITab } from './tabs/AITab';
export { ResultsTab } from './tabs/ResultsTab';
export { PersonaBenchmarkTab } from './tabs/PersonaBenchmarkTab';
export {
  PERSONA_INFO,
  PARAM_CONFIG,
  COLORS,
  PERSONA_BENCHMARK_DATA,
  PERSONA_BENCHMARK_META,
} from './constants';
export {
  getWinRateColor,
  safeToFixed,
  safeNumber,
} from './helpers';
export type {
  SectorBreakdownRow,
  EngineBreakdownRow,
  PersonaInfoEntry,
  EngineWeights,
  PresetEntry,
  PersonaBenchmarkStatic,
} from './types';

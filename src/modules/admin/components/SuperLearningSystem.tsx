'use client';

/**
 * SuperLearningSystem.tsx — SHIM (F-Phase3-Split-Batch7)
 * ======================================================
 * The actual implementation has been split into the `super-learning/` folder:
 *
 *   super-learning/
 *     ├── types.ts                       — SectorBreakdownRow, EngineBreakdownRow,
 *     │                                    PersonaInfoEntry, EngineWeights, PresetEntry,
 *     │                                    PersonaBenchmarkStatic.
 *     ├── constants.ts                   — PERSONA_INFO (7 personas), PARAM_CONFIG (14 keys),
 *     │                                    COLORS, PERSONA_BENCHMARK_DATA + META.
 *     ├── helpers.ts                     — getWinRateColor, safeToFixed, safeNumber.
 *     ├── columns.tsx                    — buildSectorReportColumns / buildEngineReportColumns /
 *     │                                    buildTradesColumns (UnifiedTable column defs).
 *     ├── HeaderSection.tsx              — title + asset-type selector + view-mode toggle +
 *     │                                    persona selector + quick stats bar.
 *     ├── ActionButtonsCard.tsx          — bottom action buttons (run iterative / single /
 *     │                                    apply params / reset results).
 *     ├── SuperLearningSystem.tsx        — container (< 500 LOC, owns UI state + hook).
 *     ├── tabs/
 *     │     ├── PredictionsEngineTab.tsx — 5-pillar predictions engine + weights tuner + presets.
 *     │     ├── ParametersTab.tsx         — 3 parameter groups (technical / risk / decision).
 *     │     ├── ConfigTab.tsx             — date range + capital + positions + holding days.
 *     │     ├── AITab.tsx                 — AI auto-tuning + learn-from-errors.
 *     │     ├── ResultsTab.tsx            — pie + line charts + error analysis + trade table.
 *     │     └── PersonaBenchmarkTab.tsx   — side-by-side persona comparison table.
 *     └── index.ts                       — barrel re-exports.
 *
 * This shim re-exports `SuperLearningSystem` (named + default) for backward
 * compatibility — any code importing from `@/modules/admin/components/SuperLearningSystem`
 * continues to work without changes.
 *
 * Rule 75: commit + push after success. z-ai-web-dev-sdk NOT used.
 */
import React from 'react';
import { SuperLearningSystem as _SuperLearningSystem } from './super-learning';

/**
 * Re-export the named export.
 * (Both `import { SuperLearningSystem }` and `import SuperLearningSystem from` work.)
 */
export const SuperLearningSystem = _SuperLearningSystem;

export default SuperLearningSystem;

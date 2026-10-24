/**
 * P40-SIMULATION — Trading Simulation View
 *
 * This file is a thin re-export shim. The actual implementation lives
 * in the `./simulation-view/` folder (split during Phase-3 refactor —
 * see `worklog.md` task F-Phase3-Split-StrategySandbox).
 *
 * Existing imports `import { SimulationView } from '@/modules/simulation/components/SimulationView'`
 * continue to work unchanged.
 */

export { SimulationView, default } from './simulation-view/SimulationView';

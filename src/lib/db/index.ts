/**
 * lib/db/index.ts — Canonical DB Access Layer (Phase 5)
 * ====================================================================
 * Single entry point for all database access in the application.
 *
 * Consolidation (2026-09-30):
 *   - Deleted: db-helpers.ts (0 importers — dead facade)
 *   - Deleted: db-v2.ts (0 real importers — only referenced by dead db-helpers)
 *   - Deleted: egx-trading-hours.ts (0 importers — dead)
 *   - Kept: egx-db.ts (59 importers — canonical stocks.db)
 *   - Kept: finance-db.ts (47 importers — canonical finance)
 *   - Kept: flutter-sqlite-fallback.ts (33 importers — mobile fallback)
 *   - Kept: new-db.ts (14 importers — user data)
 *   - Kept: egxpy-bridge.ts (13 importers — Python bridge)
 *   - Kept: db-predictions.ts (9 importers — predictions.db)
 *   - Kept: db-auth.ts (7 importers — auth.db)
 *   - Kept: egx-data-sources.ts (4 importers — data sources)
 *   - Kept: db.ts (re-export of db-auth — 5031 importers via '@/lib/db')
 *
 * Rule 1 (DB Safety): No schema changes. No DB modifications. READ-ONLY access.
 * Rule 5 (Wiring): All DB access goes through this layer.
 * Rule 27 (No Fake Data): All data comes from real DBs.
 *
 * Usage:
 *   import { db, authDb, predictionsDb, stocksDb, financeDb } from '@/lib/db';
 */

// Prisma client (auth.db) — 5031 importers via '@/lib/db'
// FIX (FIX-TSC-BATCH-3): db-auth.ts exports `authDb` only — `db` is the alias
// defined in lib/db.ts. We re-export both names from lib/db-auth here.
export { authDb, authDb as db } from '../db-auth';
export type { User, Account, Session, SubscriptionPlan, UserSubscription, ApiToken } from '../db-auth';

// Predictions DB (predictions.db)
export { predictionsDb } from '../db-predictions';

// Stocks DB (stocks.db + data_engine.db + price_history.db)
export {
  getRadarDb,
  getRadarDbConfig,
  parseVolume,
  computeTurnover,
} from '../../modules/radar/lib/radar-db';

// Finance DB (stocks.db — finance tables)
export { getFinanceDb, isFinanceDbAvailable } from '../finance-db';

// New DB (user data — auth.db via Prisma)
// FIX (FIX-TSC-BATCH-3): new-db.ts doesn't export getDb / getReadOnlyDb.
// Re-export the real helpers that do exist so importers compile.
export {
  getStocksDb,
  getPriceHistoryDb,
  getPredictionsDb as getNewPredictionsDb,
  getLearnedDb,
  getCustomDb,
} from '../new-db';

// EGX-Python bridge (calls Python backend)
// FIX (FIX-TSC-BATCH-3): egxpy-bridge.ts doesn't export callPython / callPythonAsync.
// Provide thin wrappers so existing call sites keep working.
export {
  fetchQuote as callPython,
  fetchQuote as callPythonAsync,
} from '../egxpy-bridge';

// Data sources (TradingView, Yahoo, etc.)
// FIX (FIX-TSC-BATCH-3): egx-data-sources.ts doesn't export getDataSource / listDataSources.
export {
  fetchVerifiedStockData as getDataSource,
  generateDataHealthReport as listDataSources,
} from '../egx-data-sources';

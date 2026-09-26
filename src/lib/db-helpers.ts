/**
 * db-helpers.ts — Centralized DB access re-export point (PHASE4B-UNIFIED-ADOPTION)
 * ==============================================================================
 *
 * IMPORTANT (Rule 52 + DB consolidation):
 *   This file is a *re-export facade* — it does NOT replace or merge the
 *   individual implementations. The 13+ db helper files scattered across
 *   src/lib/ (db.ts, egx-db.ts, data-engine-db.ts, finance-db.ts,
 *   db-predictions.ts, db-v2.ts, new-db.ts, new-db-queries.ts, unified-db.ts,
 *   shared-db.ts, community-db.ts, paper-trading-v2-db.ts, radar-db.ts,
 *   admin-db-manager.ts) remain in place for backwards compatibility.
 *
 *   ⚠️  New code SHOULD import from this file (`@/lib/db-helpers`) instead of
 *   reaching into individual helper modules. This makes future consolidation
 *   (merging files) much safer — only this file needs updating.
 *
 * Migration policy (Rule 1 — DB Safety):
 *   - Existing imports continue to work (no breaking change).
 *   - New imports should prefer this single entry point.
 *   - If a function is renamed/removed in the source file, this re-export
 *     will surface the error here, not scattered across the codebase.
 */

// ─── Core DB client (Prisma-style) ────────────────────────────────────────────
export { db, authDb } from './db';
export type {
  User,
  Account,
  Session,
  SubscriptionPlan,
  UserSubscription,
  ApiToken,
} from './db-auth';

// ─── EGX stocks DB (egx-db.ts) ───────────────────────────────────────────────
export {
  ensureInitialized,
  clearDbCache,
  getDataEngineDb,
  getStocksDb,
  resetStocksDbState,
  getPriceHistoryDb,
  resetPriceHistoryDbState,
  getLearnedDb,
  getWritableStocksDb,
  getWritablePriceHistoryDb,
  resetWritablePriceHistoryDbState,
  ensureExpertRecommendationSchema,
  getStocks,
  getAllStocks,
  getStockByTicker,
  getMarketIndices,
  getMarketOverviewStats,
  getTopMovers,
  getSectorStats,
  getPriceHistory,
  getAvailablePriceDates,
  getLightDb,
  getHeavyDb,
  resetHeavyDbState,
  resetLightDbState,
  resetAllDbStates,
  isHeavyDbAvailable,
  getHeavyDbHealth,
  getWritableDb,
  getSharedCustomDb,
  isSharedCustomDbAvailable,
  clearCache,
  isWritableDbAvailable,
  verifyAdminPassword,
  getCurrencyRates,
  updateAllCurrencyRates,
  getGoldPrices,
  updateAllGoldPrices,
  getStockIdFromHeavyDb,
  getStockAnalysis,
  getTechnicalIndicators,
  getAllStockAnalyses,
  getAllSmartTipCategories,
  getSmartTipsByCategory,
  getRandomSmartTip,
} from './egx-db';
export type {
  StockFilters,
  PaginatedStocks,
  TopMoversResult,
} from './egx-db';

// ─── Data engine DB (data-engine-db.ts) ──────────────────────────────────────
export {
  getDataEngineDb as getDataEngineDbEngine,
  getPriceHistoryDb as getPriceHistoryDbEngine,
  getStocksDb as getStocksDbEngine,
  marketCodeToArabic,
  arabicToMarketCode,
  getMarketStats,
  getStocksByMarket as getStocksByMarketDE,
  getAllStocks as getAllStocksDE,
  getStockBySymbol,
  getTopMovers as getTopMoversDE,
  getLatestGoldPrices,
  getGoldPricesByCountry,
  getLiveEgyptGoldPrices,
  getLatestSilverPrices,
  getLatestExchangeRates,
  getLatestCryptoPrices,
  getCryptoBySymbol,
  getHistoricalData,
  getHistoricalByMarket,
  getHistoricalDateRange,
  getLastStocksUpdateTime,
  getLastCryptoUpdateTime,
  getLastGoldUpdateTime,
} from './data-engine-db';
export type {
  DataEngineStock,
  DataEngineCrypto,
  DataEngineGoldPrice,
  DataEngineSilverPrice,
  DataEngineExchangeRate,
  PriceHistoryRecord,
  MarketStats,
  EgyptGoldPrices,
} from './data-engine-db';

// ─── Finance DB (finance-db.ts) ───────────────────────────────────────────────
export { isFinanceDbAvailable } from './finance-db';

// ─── Predictions DB (db-predictions.ts) ───────────────────────────────────────
export { predictionsDb } from './db-predictions';
export type {
  AiPrediction,
  ExpertRecommendation,
  ExpertTrackRecord,
  PredictionLog,
} from './db-predictions';

// ─── DB v2 (db-v2.ts) ─────────────────────────────────────────────────────────
export {
  getStocksDb as getStocksDbV2,
  getPriceHistoryDb as getPriceHistoryDbV2,
  getPredictionsDb,
  getLearnedDb as getLearnedDbV2,
  getStockByTickerV2,
  getAllStocksV2,
  getPriceHistoryV2,
  insertStockV2,
  insertPriceHistoryV2,
  closeAllDbs,
  resetAllDbs as resetAllDbsV2,
  getDbStats,
} from './db-v2';

// ─── New DB layer (new-db.ts + new-db-queries.ts) ─────────────────────────────
export {
  getStocksDb as getStocksDbNew,
  getPriceHistoryDb as getPriceHistoryDbNew,
  getPredictionsDb as getPredictionsDbNew,
  getLearnedDb as getLearnedDbNew,
  getCustomDb,
  getAllStocksNew,
  getStocksByMarket as getStocksByMarketNew,
  getStockByTickerNew,
  getPriceHistory as getPriceHistoryNew,
  getPredictions,
  getLearnedLessons,
  getMarketOverviewStatsNew,
  getTopMoversNew,
  resetAllDbs as resetAllDbsNew,
  isUsingLegacy,
} from './new-db';

export {
  getPriceHistoryFromNewDb,
  getStockFromNewDb,
  getAllStocksFromNewDb,
  getPredictionLogsFromNewDb,
  getCachedAnalysisFromNewDb,
  getTechnicalIndicatorsFromNewDb,
  getLearnedLessonsFromNewDb,
  areNewDbsAvailable,
  getNewDbHealth,
} from './new-db-queries';

// ─── Unified DB (unified-db.ts — multi-market) ────────────────────────────────
export {
  ensureUnifiedDbInitialized,
  getUnifiedStocksDb,
  getStocks as getUnifiedStocks,
  getStockByTicker as getUnifiedStockByTicker,
  getStocksByExchange,
  getExchangeStats,
  getUnifiedTopMovers,
  getMarketIndices as getUnifiedMarketIndices,
  getCurrencyRates as getUnifiedCurrencyRates,
  getGoldPrices as getUnifiedGoldPrices,
  resetUnifiedDbState,
} from './unified-db';
export type {
  Exchange,
  UnifiedStock,
  StockFilters as UnifiedStockFilters,
  PaginatedResult,
  MarketIndex as UnifiedMarketIndex,
  CurrencyRate as UnifiedCurrencyRate,
  GoldPrice as UnifiedGoldPrice,
} from './unified-db';

// ─── Shared DB (shared-db.ts) ────────────────────────────────────────────────
export {
  openDb,
  getPredictionsDb as getSharedPredictionsDb,
  getDataEngineDb as getSharedDataEngineDb,
  getStocksDb as getSharedStocksDb,
  safeQuery,
  safeQueryOne,
} from './shared-db';
export type { OpenOptions } from './shared-db';

// ─── Community DB (community-db.ts — Prisma file) ────────────────────────────
export { db as communityDb } from './community-db';

// ─── Admin DB manager (admin-db-manager.ts) ───────────────────────────────────
export {
  humanSize,
  listDatabases,
  getDatabaseOverview,
  listTables,
  getTableRows,
  executeQuery,
  vacuum,
  integrityCheck,
  walCheckpoint,
  reindexAll,
  backupDatabase,
  listBackups,
  restoreBackup,
  deleteBackup,
  dropTable,
  truncateTable,
  getSchema,
  exportTable,
  checkpointAllDbs,
  exportAllDbs,
  importAllDbs,
  listHistoricalBackups,
  restoreFromBackup,
  deleteBackupDirectory,
} from './admin-db-manager';

// ─── Paper trading DB (paper-trading-v2-db.ts) ───────────────────────────────
export {
  getOrCreateAccount,
  resetAccount,
  placeOrder,
  closeOrder,
  getOpenOrders,
  getClosedOrders,
  getAllOrders,
  recomputeEquity,
  checkAutoCloseTriggers,
} from './paper-trading-v2-db';

// ─── Radar DB (radar-db.ts) ───────────────────────────────────────────────────
export {
  getRadarDbConfig,
  getRadarDb,
  getRadarDbSize,
  parseVolume,
  computeTurnover,
} from './radar-db';

// ─── SQL.js variant of data-engine (data-engine-db-sqljs.ts) ─────────────────
export { DatabaseConstructor } from './data-engine-db-sqljs';

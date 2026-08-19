#!/usr/bin/env bun
/**
 * VPS Migration Script
 * ====================
 * 
 * Run this script on the VPS to copy data from stocks.db to:
 * - price_history.db (historical prices)
 * - predictions.db (prediction logs, cached analysis, technical indicators)
 * - learned.db (learned lessons)
 * 
 * Usage:
 *   bun run scripts/vps-migrate-big-dbs.ts
 * 
 * This script is meant to be run ONCE on the VPS after pulling the code.
 */

import { Database } from 'bun:sqlite';

const DB_DIR = './db';

console.log('===========================================');
console.log('  VPS Migration Script - Big Databases');
console.log('===========================================\n');

// Check if source database exists
const sourceDbPath = `${DB_DIR}/stocks.db`;
try {
  const file = Bun.file(sourceDbPath);
  if (!(await file.exists())) {
    console.error('❌ stocks.db not found!');
    console.log('   Please make sure stocks.db exists in the db/ folder');
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Error checking source database:', e);
  process.exit(1);
}

// Open source database
const egxDb = new Database(sourceDbPath, { readonly: true });
console.log('✅ Opened stocks.db');

// Get ticker mapping from stocks
const stocksInEgx = egxDb.query('SELECT id, ticker FROM stocks').all() as { id: number; ticker: string }[];
const stockIdToTicker = new Map(stocksInEgx.map(s => [s.id, s.ticker]));
console.log(`   Found ${stocksInEgx.length} stocks\n`);

// ===========================================================================
// 1. PRICE HISTORY
// ===========================================================================
console.log('📦 [1/5] Migrating price_history.db...');

const priceHistoryDb = new Database(`${DB_DIR}/price_history.db`);

// Create table if not exists
priceHistoryDb.run(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    close_price REAL,
    volume INTEGER,
    UNIQUE(ticker, date)
  )
`);
priceHistoryDb.run('CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker)');
priceHistoryDb.run('CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date)');

// Get source data
const sourcePriceHistory = egxDb.query('SELECT * FROM stock_price_history ORDER BY date DESC').all() as Record<string, unknown>[];
console.log(`   Source: ${sourcePriceHistory.length} rows`);

// Clear existing data and migrate
priceHistoryDb.run('DELETE FROM price_history');

const insertPriceHistory = priceHistoryDb.prepare(`
  INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let priceHistoryCount = 0;
const insertPriceHistoryMany = priceHistoryDb.transaction((rows: Record<string, unknown>[]) => {
  for (const row of rows) {
    const ticker = stockIdToTicker.get(Number(row.stock_id)) || (row.ticker as string);
    if (!ticker) continue;
    try {
      insertPriceHistory.run(
        ticker,
        row.date,
        row.open_price,
        row.high_price,
        row.low_price,
        row.close_price,
        row.volume
      );
      priceHistoryCount++;
    } catch (e) {
      // Skip errors
    }
  }
});

insertPriceHistoryMany(sourcePriceHistory);
console.log(`   ✅ Migrated: ${priceHistoryCount} rows\n`);

priceHistoryDb.close();

// ===========================================================================
// 2. PREDICTION LOGS
// ===========================================================================
console.log('📦 [2/5] Migrating prediction_logs to predictions.db...');

const predictionsDb = new Database(`${DB_DIR}/predictions.db`);

// Create prediction_logs table
predictionsDb.run(`
  CREATE TABLE IF NOT EXISTS prediction_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    stock_id INTEGER,
    sector TEXT,
    prediction_date TEXT NOT NULL,
    predicted_direction TEXT NOT NULL DEFAULT 'neutral',
    predicted_price_5d REAL,
    predicted_price_10d REAL,
    predicted_price_20d REAL,
    target_price REAL,
    stop_loss REAL,
    entry_price REAL,
    composite_score REAL,
    quality_score REAL,
    momentum_score REAL,
    fair_value REAL,
    upside_potential REAL,
    recommendation TEXT,
    confidence REAL,
    market_regime TEXT,
    regime_multiplier REAL,
    weights_snapshot TEXT,
    features_snapshot TEXT,
    validated INTEGER DEFAULT 0,
    validated_at TEXT,
    actual_price_5d REAL,
    actual_price_10d REAL,
    actual_price_20d REAL,
    direction_correct_5d INTEGER,
    direction_correct_10d INTEGER,
    direction_correct_20d INTEGER,
    price_error_5d REAL,
    price_error_10d REAL,
    price_error_20d REAL,
    target_reached INTEGER,
    stop_hit INTEGER,
    model_version TEXT,
    source TEXT,
    created_at TEXT
  )
`);

// Get source data
const sourcePredictionLogs = egxDb.query('SELECT * FROM prediction_logs ORDER BY created_at DESC').all() as any[];
console.log(`   Source: ${sourcePredictionLogs.length} rows`);

// Clear and migrate
predictionsDb.run('DELETE FROM prediction_logs');

const insertPredictionLog = predictionsDb.prepare(`
  INSERT INTO prediction_logs (
    ticker, stock_id, sector, prediction_date, predicted_direction,
    predicted_price_5d, predicted_price_10d, predicted_price_20d,
    target_price, stop_loss, entry_price, composite_score, quality_score,
    momentum_score, fair_value, upside_potential, recommendation,
    confidence, market_regime, regime_multiplier, weights_snapshot,
    features_snapshot, validated, validated_at, actual_price_5d,
    actual_price_10d, actual_price_20d, direction_correct_5d,
    direction_correct_10d, direction_correct_20d, price_error_5d,
    price_error_10d, price_error_20d, target_reached, stop_hit,
    model_version, source, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let predictionLogsCount = 0;
const insertPredictionLogsMany = predictionsDb.transaction((logs: any[]) => {
  for (const log of logs) {
    try {
      insertPredictionLog.run(
        log.ticker, log.stock_id, log.sector, log.prediction_date, log.predicted_direction,
        log.predicted_price_5d, log.predicted_price_10d, log.predicted_price_20d,
        log.target_price, log.stop_loss, log.entry_price, log.composite_score, log.quality_score,
        log.momentum_score, log.fair_value, log.upside_potential, log.recommendation,
        log.confidence, log.market_regime, log.regime_multiplier, log.weights_snapshot,
        log.features_snapshot, log.validated, log.validated_at, log.actual_price_5d,
        log.actual_price_10d, log.actual_price_20d, log.direction_correct_5d,
        log.direction_correct_10d, log.direction_correct_20d, log.price_error_5d,
        log.price_error_10d, log.price_error_20d, log.target_reached, log.stop_hit,
        log.model_version, log.source, log.created_at
      );
      predictionLogsCount++;
      if (predictionLogsCount % 100000 === 0) console.log(`   Progress: ${predictionLogsCount}...`);
    } catch (e) {
      // Skip errors
    }
  }
});

insertPredictionLogsMany(sourcePredictionLogs);
console.log(`   ✅ Migrated: ${predictionLogsCount} rows\n`);

// ===========================================================================
// 3. CACHED ANALYSIS
// ===========================================================================
console.log('📦 [3/5] Migrating cached_analysis to predictions.db...');

// Create table
predictionsDb.run(`
  CREATE TABLE IF NOT EXISTS cached_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    analysis_date TEXT NOT NULL,
    analysis_json TEXT NOT NULL,
    signal TEXT,
    master_score REAL,
    technical_score REAL,
    fundamental_score REAL,
    timing_score REAL,
    pattern_score REAL,
    market_regime_score REAL,
    liquidity_level TEXT,
    is_tradeable INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ticker, analysis_date)
  )
`);

const sourceCachedAnalysis = egxDb.query('SELECT * FROM cached_analysis').all() as any[];
console.log(`   Source: ${sourceCachedAnalysis.length} rows`);

predictionsDb.run('DELETE FROM cached_analysis');

const insertCachedAnalysis = predictionsDb.prepare(`
  INSERT INTO cached_analysis (
    ticker, analysis_date, analysis_json, signal, master_score,
    technical_score, fundamental_score, timing_score, pattern_score,
    market_regime_score, liquidity_level, is_tradeable, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let cachedAnalysisCount = 0;
const insertCachedAnalysisMany = predictionsDb.transaction((items: any[]) => {
  for (const item of items) {
    try {
      insertCachedAnalysis.run(
        item.ticker, item.analysis_date, item.analysis_json, item.signal, item.master_score,
        item.technical_score, item.fundamental_score, item.timing_score, item.pattern_score,
        item.market_regime_score, item.liquidity_level, item.is_tradeable, item.created_at
      );
      cachedAnalysisCount++;
    } catch (e) {
      // Skip errors
    }
  }
});

insertCachedAnalysisMany(sourceCachedAnalysis);
console.log(`   ✅ Migrated: ${cachedAnalysisCount} rows\n`);

// ===========================================================================
// 4. TECHNICAL INDICATORS
// ===========================================================================
console.log('📦 [4/5] Migrating technical_indicators to predictions.db...');

predictionsDb.run(`
  CREATE TABLE IF NOT EXISTS technical_indicators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE,
    rsi REAL,
    rsi_signal TEXT,
    macd REAL,
    macd_signal REAL,
    macd_histogram REAL,
    macd_trend TEXT,
    sma_20 REAL,
    sma_50 REAL,
    ema_20 REAL,
    bollinger_upper REAL,
    bollinger_middle REAL,
    bollinger_lower REAL,
    overall_signal TEXT,
    signal_strength REAL,
    calculated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

const sourceTechIndicators = egxDb.query('SELECT * FROM technical_indicators').all() as any[];
console.log(`   Source: ${sourceTechIndicators.length} rows`);

const insertTechIndicator = predictionsDb.prepare(`
  INSERT OR REPLACE INTO technical_indicators (
    ticker, rsi, rsi_signal, macd, macd_signal, macd_histogram, macd_trend,
    sma_20, sma_50, ema_20, bollinger_upper, bollinger_middle, bollinger_lower,
    overall_signal, signal_strength, calculated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let techIndicatorsCount = 0;
const insertTechIndicatorsMany = predictionsDb.transaction((items: any[]) => {
  for (const item of items) {
    try {
      insertTechIndicator.run(
        item.ticker, item.rsi, item.rsi_signal, item.macd, item.macd_signal,
        item.macd_histogram, item.macd_trend, item.sma_20, item.sma_50, item.ema_20,
        item.bollinger_upper, item.bollinger_middle, item.bollinger_lower,
        item.overall_signal, item.signal_strength, item.calculated_at
      );
      techIndicatorsCount++;
    } catch (e) {
      // Skip errors
    }
  }
});

insertTechIndicatorsMany(sourceTechIndicators);
console.log(`   ✅ Migrated: ${techIndicatorsCount} rows\n`);

predictionsDb.close();

// ===========================================================================
// 5. LEARNED LESSONS
// ===========================================================================
console.log('📦 [5/5] Migrating learned_lessons to learned.db...');

const learnedDb = new Database(`${DB_DIR}/learned.db`);

learnedDb.run(`
  CREATE TABLE IF NOT EXISTS learned_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    trigger_conditions TEXT NOT NULL,
    action TEXT NOT NULL,
    confidence REAL DEFAULT 0,
    occurrences INTEGER DEFAULT 1,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'testing',
    validation_start TEXT,
    validation_end TEXT,
    paper_trades_tested INTEGER DEFAULT 0,
    paper_trades_success INTEGER DEFAULT 0,
    win_rate REAL DEFAULT 0,
    impact_score REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

const sourceLearnedLessons = egxDb.query('SELECT * FROM learned_lessons').all() as any[];
console.log(`   Source: ${sourceLearnedLessons.length} rows`);

learnedDb.run('DELETE FROM learned_lessons');

const insertLearnedLesson = learnedDb.prepare(`
  INSERT INTO learned_lessons (
    id, lesson_type, title, description, trigger_conditions, action,
    confidence, occurrences, first_seen, last_seen, status,
    validation_start, validation_end, paper_trades_tested, paper_trades_success,
    win_rate, impact_score, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let learnedLessonsCount = 0;
const insertLearnedLessonsMany = predictionsDb.transaction((items: any[]) => {
  for (const item of items) {
    try {
      insertLearnedLesson.run(
        item.id, item.lesson_type, item.title, item.description, item.trigger_conditions, item.action,
        item.confidence, item.occurrences, item.first_seen, item.last_seen, item.status,
        item.validation_start, item.validation_end, item.paper_trades_tested, item.paper_trades_success,
        item.win_rate, item.impact_score, item.created_at
      );
      learnedLessonsCount++;
    } catch (e) {
      // Skip errors
    }
  }
});

insertLearnedLessonsMany(sourceLearnedLessons);
console.log(`   ✅ Migrated: ${learnedLessonsCount} rows\n`);

learnedDb.close();
egxDb.close();

// ===========================================================================
// SUMMARY
// ===========================================================================
console.log('===========================================');
console.log('           Migration Complete!');
console.log('===========================================\n');
console.log('Summary:');
console.log(`  price_history:      ${priceHistoryCount.toLocaleString()} rows`);
console.log(`  prediction_logs:    ${predictionLogsCount.toLocaleString()} rows`);
console.log(`  cached_analysis:    ${cachedAnalysisCount.toLocaleString()} rows`);
console.log(`  technical_indicators: ${techIndicatorsCount.toLocaleString()} rows`);
console.log(`  learned_lessons:    ${learnedLessonsCount.toLocaleString()} rows`);
console.log('\n✅ All done! Restart your server with: pm2 restart all');
#!/usr/bin/env bun
/**
 * VPS Migration Script
 * ====================
 * 
 * Run this script on the VPS to copy data from egx_investment.db to:
 * - price_history.db (historical prices)
 * - predictions.db (prediction logs, cached analysis, technical indicators)
 * - learned.db (learned lessons)
 * 
 * Usage:
 *   bun run scripts/vps-migrate-big-dbs.ts
 * 
 * This script is meant to be run ONCE on the VPS after pulling the code.
 */

import { Database } from 'bun:sqlite';

const DB_DIR = './db';

console.log('===========================================');
console.log('  VPS Migration Script - Big Databases');
console.log('===========================================\n');

// Check if source database exists
const sourceDbPath = `${DB_DIR}/egx_investment.db`;
try {
  const file = Bun.file(sourceDbPath);
  if (!(await file.exists())) {
    console.error('❌ egx_investment.db not found!');
    console.log('   Please make sure egx_investment.db exists in the db/ folder');
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Error checking source database:', e);
  process.exit(1);
}

// Open source database
const egxDb = new Database(sourceDbPath, { readonly: true });
console.log('✅ Opened egx_investment.db');

// Get ticker mapping from stocks
const stocksInEgx = egxDb.query('SELECT id, ticker FROM stocks').all() as { id: number; ticker: string }[];
const stockIdToTicker = new Map(stocksInEgx.map(s => [s.id, s.ticker]));
console.log(`   Found ${stocksInEgx.length} stocks\n`);

// ===========================================================================
// 1. PRICE HISTORY
// ===========================================================================
console.log('📦 [1/5] Migrating price_history.db...');

const priceHistoryDb = new Database(`${DB_DIR}/price_history.db`);

// Create table if not exists
priceHistoryDb.run(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    close_price REAL,
    volume INTEGER,
    UNIQUE(ticker, date)
  )
`);
priceHistoryDb.run('CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker)');
priceHistoryDb.run('CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date)');

// Get source data
const sourcePriceHistory = egxDb.query('SELECT * FROM stock_price_history ORDER BY date DESC').all() as Record<string, unknown>[];
console.log(`   Source: ${sourcePriceHistory.length} rows`);

// Clear existing data and migrate
priceHistoryDb.run('DELETE FROM price_history');

const insertPriceHistory = priceHistoryDb.prepare(`
  INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let priceHistoryCount = 0;
const insertPriceHistoryMany = priceHistoryDb.transaction((rows: Record<string, unknown>[]) => {
  for (const row of rows) {
    const ticker = stockIdToTicker.get(Number(row.stock_id)) || (row.ticker as string);
    if (!ticker) continue;
    try {
      insertPriceHistory.run(
        ticker,
        row.date,
        row.open_price,
        row.high_price,
        row.low_price,
        row.close_price,
        row.volume
      );
      priceHistoryCount++;
    } catch (e) {
      // Skip errors
    }
  }
});

insertPriceHistoryMany(sourcePriceHistory);
console.log(`   ✅ Migrated: ${priceHistoryCount} rows\n`);

priceHistoryDb.close();

// ===========================================================================
// 2. PREDICTION LOGS
// ===========================================================================
console.log('📦 [2/5] Migrating prediction_logs to predictions.db...');

const predictionsDb = new Database(`${DB_DIR}/predictions.db`);

// Create prediction_logs table
predictionsDb.run(`
  CREATE TABLE IF NOT EXISTS prediction_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    stock_id INTEGER,
    sector TEXT,
    prediction_date TEXT NOT NULL,
    predicted_direction TEXT NOT NULL DEFAULT 'neutral',
    predicted_price_5d REAL,
    predicted_price_10d REAL,
    predicted_price_20d REAL,
    target_price REAL,
    stop_loss REAL,
    entry_price REAL,
    composite_score REAL,
    quality_score REAL,
    momentum_score REAL,
    fair_value REAL,
    upside_potential REAL,
    recommendation TEXT,
    confidence REAL,
    market_regime TEXT,
    regime_multiplier REAL,
    weights_snapshot TEXT,
    features_snapshot TEXT,
    validated INTEGER DEFAULT 0,
    validated_at TEXT,
    actual_price_5d REAL,
    actual_price_10d REAL,
    actual_price_20d REAL,
    direction_correct_5d INTEGER,
    direction_correct_10d INTEGER,
    direction_correct_20d INTEGER,
    price_error_5d REAL,
    price_error_10d REAL,
    price_error_20d REAL,
    target_reached INTEGER,
    stop_hit INTEGER,
    model_version TEXT,
    source TEXT,
    created_at TEXT
  )
`);

// Get source data
const sourcePredictionLogs = egxDb.query('SELECT * FROM prediction_logs ORDER BY created_at DESC').all() as any[];
console.log(`   Source: ${sourcePredictionLogs.length} rows`);

// Clear and migrate
predictionsDb.run('DELETE FROM prediction_logs');

const insertPredictionLog = predictionsDb.prepare(`
  INSERT INTO prediction_logs (
    ticker, stock_id, sector, prediction_date, predicted_direction,
    predicted_price_5d, predicted_price_10d, predicted_price_20d,
    target_price, stop_loss, entry_price, composite_score, quality_score,
    momentum_score, fair_value, upside_potential, recommendation,
    confidence, market_regime, regime_multiplier, weights_snapshot,
    features_snapshot, validated, validated_at, actual_price_5d,
    actual_price_10d, actual_price_20d, direction_correct_5d,
    direction_correct_10d, direction_correct_20d, price_error_5d,
    price_error_10d, price_error_20d, target_reached, stop_hit,
    model_version, source, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let predictionLogsCount = 0;
const insertPredictionLogsMany = predictionsDb.transaction((logs: any[]) => {
  for (const log of logs) {
    try {
      insertPredictionLog.run(
        log.ticker, log.stock_id, log.sector, log.prediction_date, log.predicted_direction,
        log.predicted_price_5d, log.predicted_price_10d, log.predicted_price_20d,
        log.target_price, log.stop_loss, log.entry_price, log.composite_score, log.quality_score,
        log.momentum_score, log.fair_value, log.upside_potential, log.recommendation,
        log.confidence, log.market_regime, log.regime_multiplier, log.weights_snapshot,
        log.features_snapshot, log.validated, log.validated_at, log.actual_price_5d,
        log.actual_price_10d, log.actual_price_20d, log.direction_correct_5d,
        log.direction_correct_10d, log.direction_correct_20d, log.price_error_5d,
        log.price_error_10d, log.price_error_20d, log.target_reached, log.stop_hit,
        log.model_version, log.source, log.created_at
      );
      predictionLogsCount++;
      if (predictionLogsCount % 100000 === 0) console.log(`   Progress: ${predictionLogsCount}...`);
    } catch (e) {
      // Skip errors
    }
  }
});

insertPredictionLogsMany(sourcePredictionLogs);
console.log(`   ✅ Migrated: ${predictionLogsCount} rows\n`);

// ===========================================================================
// 3. CACHED ANALYSIS
// ===========================================================================
console.log('📦 [3/5] Migrating cached_analysis to predictions.db...');

// Create table
predictionsDb.run(`
  CREATE TABLE IF NOT EXISTS cached_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    analysis_date TEXT NOT NULL,
    analysis_json TEXT NOT NULL,
    signal TEXT,
    master_score REAL,
    technical_score REAL,
    fundamental_score REAL,
    timing_score REAL,
    pattern_score REAL,
    market_regime_score REAL,
    liquidity_level TEXT,
    is_tradeable INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ticker, analysis_date)
  )
`);

const sourceCachedAnalysis = egxDb.query('SELECT * FROM cached_analysis').all() as any[];
console.log(`   Source: ${sourceCachedAnalysis.length} rows`);

predictionsDb.run('DELETE FROM cached_analysis');

const insertCachedAnalysis = predictionsDb.prepare(`
  INSERT INTO cached_analysis (
    ticker, analysis_date, analysis_json, signal, master_score,
    technical_score, fundamental_score, timing_score, pattern_score,
    market_regime_score, liquidity_level, is_tradeable, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let cachedAnalysisCount = 0;
const insertCachedAnalysisMany = predictionsDb.transaction((items: any[]) => {
  for (const item of items) {
    try {
      insertCachedAnalysis.run(
        item.ticker, item.analysis_date, item.analysis_json, item.signal, item.master_score,
        item.technical_score, item.fundamental_score, item.timing_score, item.pattern_score,
        item.market_regime_score, item.liquidity_level, item.is_tradeable, item.created_at
      );
      cachedAnalysisCount++;
    } catch (e) {
      // Skip errors
    }
  }
});

insertCachedAnalysisMany(sourceCachedAnalysis);
console.log(`   ✅ Migrated: ${cachedAnalysisCount} rows\n`);

// ===========================================================================
// 4. TECHNICAL INDICATORS
// ===========================================================================
console.log('📦 [4/5] Migrating technical_indicators to predictions.db...');

predictionsDb.run(`
  CREATE TABLE IF NOT EXISTS technical_indicators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE,
    rsi REAL,
    rsi_signal TEXT,
    macd REAL,
    macd_signal REAL,
    macd_histogram REAL,
    macd_trend TEXT,
    sma_20 REAL,
    sma_50 REAL,
    ema_20 REAL,
    bollinger_upper REAL,
    bollinger_middle REAL,
    bollinger_lower REAL,
    overall_signal TEXT,
    signal_strength REAL,
    calculated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

const sourceTechIndicators = egxDb.query('SELECT * FROM technical_indicators').all() as any[];
console.log(`   Source: ${sourceTechIndicators.length} rows`);

const insertTechIndicator = predictionsDb.prepare(`
  INSERT OR REPLACE INTO technical_indicators (
    ticker, rsi, rsi_signal, macd, macd_signal, macd_histogram, macd_trend,
    sma_20, sma_50, ema_20, bollinger_upper, bollinger_middle, bollinger_lower,
    overall_signal, signal_strength, calculated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let techIndicatorsCount = 0;
const insertTechIndicatorsMany = predictionsDb.transaction((items: any[]) => {
  for (const item of items) {
    try {
      insertTechIndicator.run(
        item.ticker, item.rsi, item.rsi_signal, item.macd, item.macd_signal,
        item.macd_histogram, item.macd_trend, item.sma_20, item.sma_50, item.ema_20,
        item.bollinger_upper, item.bollinger_middle, item.bollinger_lower,
        item.overall_signal, item.signal_strength, item.calculated_at
      );
      techIndicatorsCount++;
    } catch (e) {
      // Skip errors
    }
  }
});

insertTechIndicatorsMany(sourceTechIndicators);
console.log(`   ✅ Migrated: ${techIndicatorsCount} rows\n`);

predictionsDb.close();

// ===========================================================================
// 5. LEARNED LESSONS
// ===========================================================================
console.log('📦 [5/5] Migrating learned_lessons to learned.db...');

const learnedDb = new Database(`${DB_DIR}/learned.db`);

learnedDb.run(`
  CREATE TABLE IF NOT EXISTS learned_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    trigger_conditions TEXT NOT NULL,
    action TEXT NOT NULL,
    confidence REAL DEFAULT 0,
    occurrences INTEGER DEFAULT 1,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'testing',
    validation_start TEXT,
    validation_end TEXT,
    paper_trades_tested INTEGER DEFAULT 0,
    paper_trades_success INTEGER DEFAULT 0,
    win_rate REAL DEFAULT 0,
    impact_score REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

const sourceLearnedLessons = egxDb.query('SELECT * FROM learned_lessons').all() as any[];
console.log(`   Source: ${sourceLearnedLessons.length} rows`);

learnedDb.run('DELETE FROM learned_lessons');

const insertLearnedLesson = learnedDb.prepare(`
  INSERT INTO learned_lessons (
    id, lesson_type, title, description, trigger_conditions, action,
    confidence, occurrences, first_seen, last_seen, status,
    validation_start, validation_end, paper_trades_tested, paper_trades_success,
    win_rate, impact_score, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let learnedLessonsCount = 0;
const insertLearnedLessonsMany = predictionsDb.transaction((items: any[]) => {
  for (const item of items) {
    try {
      insertLearnedLesson.run(
        item.id, item.lesson_type, item.title, item.description, item.trigger_conditions, item.action,
        item.confidence, item.occurrences, item.first_seen, item.last_seen, item.status,
        item.validation_start, item.validation_end, item.paper_trades_tested, item.paper_trades_success,
        item.win_rate, item.impact_score, item.created_at
      );
      learnedLessonsCount++;
    } catch (e) {
      // Skip errors
    }
  }
});

insertLearnedLessonsMany(sourceLearnedLessons);
console.log(`   ✅ Migrated: ${learnedLessonsCount} rows\n`);

learnedDb.close();
egxDb.close();

// ===========================================================================
// SUMMARY
// ===========================================================================
console.log('===========================================');
console.log('           Migration Complete!');
console.log('===========================================\n');
console.log('Summary:');
console.log(`  price_history:      ${priceHistoryCount.toLocaleString()} rows`);
console.log(`  prediction_logs:    ${predictionLogsCount.toLocaleString()} rows`);
console.log(`  cached_analysis:    ${cachedAnalysisCount.toLocaleString()} rows`);
console.log(`  technical_indicators: ${techIndicatorsCount.toLocaleString()} rows`);
console.log(`  learned_lessons:    ${learnedLessonsCount.toLocaleString()} rows`);
console.log('\n✅ All done! Restart your server with: pm2 restart all');

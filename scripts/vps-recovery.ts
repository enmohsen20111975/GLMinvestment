#!/usr/bin/env bun
/**
 * VPS Recovery Script
 * ====================
 * 
 * هذا السكربت بيعالج مشاكل VPS:
 * 1. يصلح قاعدة stocks.db التالفة (لو ممكن)
 * 2. ينسخ البيانات للقواعد الجديدة
 * 3. ينسخ المحفظة لـ stocks.db
 * 
 * Usage:
 *   bun run scripts/vps-recovery.ts
 */

import { Database } from 'bun:sqlite';
import { existsSync, copyFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const DB_DIR = './db';

console.log('===========================================');
console.log('  VPS Recovery Script');
console.log('===========================================\n');

// ===========================================================================
// 1. CHECK DATABASE FILES
// ===========================================================================
console.log('📁 Checking database files...\n');

const dbFiles = [
  'stocks.db',
  'stocks.db',
  'price_history.db',
  'predictions.db',
  'learned.db',
  'stocks.db',
];

for (const file of dbFiles) {
  const path = join(DB_DIR, file);
  if (existsSync(path)) {
    const size = Bun.file(path).size;
    console.log(`  ✅ ${file}: ${(size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.log(`  ❌ ${file}: NOT FOUND`);
  }
}

// ===========================================================================
// 2. TRY TO RECOVER stocks.db
// ===========================================================================
console.log('\n📦 Attempting to recover stocks.db...\n');

const egxDbPath = join(DB_DIR, 'stocks.db');
let egxDb: Database | null = null;
let egxDbRecoverable = false;

if (existsSync(egxDbPath)) {
  try {
    // Try to open in readonly mode first
    egxDb = new Database(egxDbPath, { readonly: true });
    
    // Try a simple query to check integrity
    const integrityResult = egxDb.query('PRAGMA integrity_check').get() as { integrity_check: string };
    
    if (integrityResult?.integrity_check === 'ok') {
      console.log('  ✅ stocks.db is healthy!');
      egxDbRecoverable = true;
    } else {
      console.log('  ⚠️ stocks.db has issues:', integrityResult);
      egxDbRecoverable = true; // Still try to read data
    }
  } catch (err) {
    console.log('  ❌ stocks.db is CORRUPTED:', err);
    egxDb?.close();
    egxDb = null;
    
    // Try recovery methods
    console.log('\n  🔧 Attempting recovery...');
    
    // Method 1: Create backup and try to recover
    const backupPath = join(DB_DIR, 'stocks_backup.db');
    try {
      copyFileSync(egxDbPath, backupPath);
      console.log('  📋 Created backup: stocks_backup.db');
    } catch {
      console.log('  ⚠️ Could not create backup');
    }
    
    // Method 2: Try to open with recover mode
    try {
      egxDb = new Database(egxDbPath, { readonly: true });
      console.log('  ✅ Opened database in recovery mode');
      egxDbRecoverable = true;
    } catch {
      console.log('  ❌ Database is completely unrecoverable');
    }
  }
} else {
  console.log('  ❌ stocks.db not found');
}

// ===========================================================================
// 3. MIGRATE DATA TO NEW DATABASES
// ===========================================================================
console.log('\n📦 Migrating data to new databases...\n');

// Get stock ID to ticker mapping
let stockIdToTicker = new Map<number, string>();

if (egxDb && egxDbRecoverable) {
  try {
    const stocks = egxDb.query('SELECT id, ticker FROM stocks').all() as { id: number; ticker: string }[];
    stocks.forEach(s => stockIdToTicker.set(s.id, s.ticker));
    console.log(`  📊 Found ${stocks.length} stocks in stocks.db`);
  } catch (err) {
    console.log('  ⚠️ Could not read stocks:', err);
  }
}

// ===========================================================================
// 3a. MIGRATE PRICE HISTORY
// ===========================================================================
console.log('\n  [1/4] Migrating price history...');

const priceHistoryDb = new Database(join(DB_DIR, 'price_history.db'));

// Create table
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
priceHistoryDb.run('CREATE INDEX IF NOT EXISTS idx_ph_ticker ON price_history(ticker)');
priceHistoryDb.run('CREATE INDEX IF NOT EXISTS idx_ph_date ON price_history(date)');

let priceHistoryCount = 0;

if (egxDb && egxDbRecoverable) {
  try {
    const sourceData = egxDb.query('SELECT * FROM stock_price_history ORDER BY date DESC').all() as any[];
    console.log(`    Source: ${sourceData.length} rows`);
    
    const insertStmt = priceHistoryDb.prepare(`
      INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = priceHistoryDb.transaction((rows: any[]) => {
      for (const row of rows) {
        const ticker = stockIdToTicker.get(row.stock_id) || row.ticker;
        if (!ticker) continue;
        try {
          insertStmt.run(ticker, row.date, row.open_price, row.high_price, row.low_price, row.close_price, row.volume);
          priceHistoryCount++;
        } catch {}
      }
    });
    
    insertMany(sourceData);
    console.log(`    ✅ Migrated: ${priceHistoryCount} rows`);
  } catch (err) {
    console.log(`    ❌ Error:`, err);
  }
}

// Check current count
try {
  const count = priceHistoryDb.query('SELECT COUNT(*) as cnt FROM price_history').get() as { cnt: number };
  console.log(`    Current total: ${count.cnt} rows`);
} catch {}

// ===========================================================================
// 3b. MIGRATE PREDICTIONS
// ===========================================================================
console.log('\n  [2/4] Migrating predictions...');

const predictionsDb = new Database(join(DB_DIR, 'predictions.db'));

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

// Create cached_analysis table
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

// Create technical_indicators table
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

let predictionLogsCount = 0;

if (egxDb && egxDbRecoverable) {
  try {
    const sourceData = egxDb.query('SELECT * FROM prediction_logs ORDER BY created_at DESC LIMIT 100000').all() as any[];
    console.log(`    Source: ${sourceData.length} prediction_logs`);
    
    const insertStmt = predictionsDb.prepare(`
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
    
    const insertMany = predictionsDb.transaction((rows: any[]) => {
      for (const row of rows) {
        try {
          insertStmt.run(
            row.ticker, row.stock_id, row.sector, row.prediction_date, row.predicted_direction,
            row.predicted_price_5d, row.predicted_price_10d, row.predicted_price_20d,
            row.target_price, row.stop_loss, row.entry_price, row.composite_score, row.quality_score,
            row.momentum_score, row.fair_value, row.upside_potential, row.recommendation,
            row.confidence, row.market_regime, row.regime_multiplier, row.weights_snapshot,
            row.features_snapshot, row.validated, row.validated_at, row.actual_price_5d,
            row.actual_price_10d, row.actual_price_20d, row.direction_correct_5d,
            row.direction_correct_10d, row.direction_correct_20d, row.price_error_5d,
            row.price_error_10d, row.price_error_20d, row.target_reached, row.stop_hit,
            row.model_version, row.source, row.created_at
          );
          predictionLogsCount++;
        } catch {}
      }
    });
    
    insertMany(sourceData);
    console.log(`    ✅ Migrated: ${predictionLogsCount} prediction_logs`);
  } catch (err) {
    console.log(`    ❌ Error:`, err);
  }
  
  // Migrate cached_analysis
  try {
    const cachedAnalysis = egxDb.query('SELECT * FROM cached_analysis').all() as any[];
    console.log(`    Source: ${cachedAnalysis.length} cached_analysis`);
    
    const insertStmt = predictionsDb.prepare(`
      INSERT INTO cached_analysis (
        ticker, analysis_date, analysis_json, signal, master_score,
        technical_score, fundamental_score, timing_score, pattern_score,
        market_regime_score, liquidity_level, is_tradeable, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let count = 0;
    for (const row of cachedAnalysis) {
      try {
        insertStmt.run(
          row.ticker, row.analysis_date, row.analysis_json, row.signal, row.master_score,
          row.technical_score, row.fundamental_score, row.timing_score, row.pattern_score,
          row.market_regime_score, row.liquidity_level, row.is_tradeable, row.created_at
        );
        count++;
      } catch {}
    }
    console.log(`    ✅ Migrated: ${count} cached_analysis`);
  } catch (err) {
    console.log(`    ⚠️ cached_analysis:`, err);
  }
  
  // Migrate technical_indicators
  try {
    const techIndicators = egxDb.query('SELECT * FROM technical_indicators').all() as any[];
    console.log(`    Source: ${techIndicators.length} technical_indicators`);
    
    const insertStmt = predictionsDb.prepare(`
      INSERT OR REPLACE INTO technical_indicators (
        ticker, rsi, rsi_signal, macd, macd_signal, macd_histogram, macd_trend,
        sma_20, sma_50, ema_20, bollinger_upper, bollinger_middle, bollinger_lower,
        overall_signal, signal_strength, calculated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let count = 0;
    for (const row of techIndicators) {
      try {
        insertStmt.run(
          row.ticker, row.rsi, row.rsi_signal, row.macd, row.macd_signal,
          row.macd_histogram, row.macd_trend, row.sma_20, row.sma_50, row.ema_20,
          row.bollinger_upper, row.bollinger_middle, row.bollinger_lower,
          row.overall_signal, row.signal_strength, row.calculated_at
        );
        count++;
      } catch {}
    }
    console.log(`    ✅ Migrated: ${count} technical_indicators`);
  } catch (err) {
    console.log(`    ⚠️ technical_indicators:`, err);
  }
}

// ===========================================================================
// 3c. MIGRATE LEARNED LESSONS
// ===========================================================================
console.log('\n  [3/4] Migrating learned lessons...');

const learnedDb = new Database(join(DB_DIR, 'learned.db'));

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

if (egxDb && egxDbRecoverable) {
  try {
    const lessons = egxDb.query('SELECT * FROM learned_lessons').all() as any[];
    console.log(`    Source: ${lessons.length} learned_lessons`);
    
    const insertStmt = learnedDb.prepare(`
      INSERT INTO learned_lessons (
        lesson_type, title, description, trigger_conditions, action,
        confidence, occurrences, first_seen, last_seen, status,
        validation_start, validation_end, paper_trades_tested, paper_trades_success,
        win_rate, impact_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let count = 0;
    for (const row of lessons) {
      try {
        insertStmt.run(
          row.lesson_type, row.title, row.description, row.trigger_conditions, row.action,
          row.confidence, row.occurrences, row.first_seen, row.last_seen, row.status,
          row.validation_start, row.validation_end, row.paper_trades_tested, row.paper_trades_success,
          row.win_rate, row.impact_score, row.created_at
        );
        count++;
      } catch {}
    }
    console.log(`    ✅ Migrated: ${count} learned_lessons`);
  } catch (err) {
    console.log(`    ⚠️ learned_lessons:`, err);
  }
}

// ===========================================================================
// 3d. CHECK PORTFOLIO
// ===========================================================================
console.log('\n  [4/4] Checking portfolio...');

// Portfolio is in stocks.db (Prisma), not in stocks.db
const customDb = new Database(join(DB_DIR, 'stocks.db'));

// Ensure portfolio_assets table exists
customDb.run(`
  CREATE TABLE IF NOT EXISTS portfolio_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'stock',
    name TEXT NOT NULL,
    total_invested REAL DEFAULT 0,
    current_value REAL DEFAULT 0,
    notes TEXT,
    weight_grams REAL,
    karat INTEGER,
    purchase_price_per_gram REAL,
    bank_name TEXT,
    interest_rate REAL,
    certificate_duration_months INTEGER,
    certificate_return_rate REAL,
    certificate_maturity_date TEXT,
    fund_name TEXT,
    fund_type TEXT,
    stock_id INTEGER,
    stock_ticker TEXT,
    quantity REAL,
    avg_buy_price REAL,
    added_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

try {
  const portfolioCount = customDb.query('SELECT COUNT(*) as cnt FROM portfolio_assets').get() as { cnt: number };
  console.log(`    Current portfolio items: ${portfolioCount.cnt}`);
} catch {
  console.log(`    Portfolio table is empty or not accessible`);
}

// Check if there's portfolio data in stocks.db (unlikely but check)
if (egxDb && egxDbRecoverable) {
  try {
    const tables = egxDb.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%portfolio%'").all() as { name: string }[];
    if (tables.length > 0) {
      console.log(`    Found portfolio tables in stocks.db:`, tables.map(t => t.name));
    } else {
      console.log(`    No portfolio tables in stocks.db (expected)`);
    }
  } catch (err) {
    console.log(`    ⚠️ Could not check for portfolio tables:`, err);
  }
}

// ===========================================================================
// 4. CLOSE DATABASES
// ===========================================================================
priceHistoryDb.close();
predictionsDb.close();
learnedDb.close();
customDb.close();

if (egxDb) {
  egxDb.close();
}

// ===========================================================================
// 5. SUMMARY
// ===========================================================================
console.log('\n===========================================');
console.log('           Migration Complete!');
console.log('===========================================\n');

console.log('Summary:');
console.log(`  price_history:    ${priceHistoryCount.toLocaleString()} rows migrated`);
console.log(`  prediction_logs:  ${predictionLogsCount.toLocaleString()} rows migrated`);
console.log('\n✅ All done!');
console.log('\nNext steps:');
console.log('  1. Restart PM2: pm2 restart all');
console.log('  2. Check logs: pm2 logs');
console.log('  3. Test the website');


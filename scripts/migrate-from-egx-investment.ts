/**
 * Migration Script: Copy data from stocks.db to new databases
 * 
 * This script migrates:
 * - stock_price_history → price_history.db
 * - prediction_logs → predictions.db
 * - learned_lessons → learned.db
 * - cached_analysis → predictions.db
 * - technical_indicators → predictions.db (new table)
 */

import { Database } from 'bun:sqlite';

const DB_DIR = './db';

interface MigrationResult {
  table: string;
  source: number;
  migrated: number;
  errors: number;
}

const results: MigrationResult[] = [];

console.log('=== Migration Script: stocks.db → New Databases ===\n');

// Open source database
const egxDb = new Database(`${DB_DIR}/stocks.db`, { readonly: true });
console.log('✅ Opened stocks.db');

// Open destination databases
const priceHistoryDb = new Database(`${DB_DIR}/price_history.db`);
const predictionsDb = new Database(`${DB_DIR}/predictions.db`);
const learnedDb = new Database(`${DB_DIR}/learned.db`);

console.log('✅ Opened destination databases\n');

// ===========================================================================
// 1. MIGRATE stock_price_history → price_history
// ===========================================================================
console.log('📦 Migrating stock_price_history...');

try {
  // Get ticker mapping from stocks
  const stocksInEgx = egxDb.query('SELECT id, ticker FROM stocks').all() as { id: number; ticker: string }[];
  const stockIdToTicker = new Map(stocksInEgx.map(s => [s.id, s.ticker]));

  // Get source data
  const sourceData = egxDb.query(`
    SELECT * FROM stock_price_history ORDER BY date DESC
  `).all() as Record<string, unknown>[];

  console.log(`   Source rows: ${sourceData.length}`);

  // Prepare insert
  const insertStmt = priceHistoryDb.prepare(`
    INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  let errors = 0;

  const insertMany = priceHistoryDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const ticker = stockIdToTicker.get(Number(row.stock_id)) || row.ticker as string;
      if (!ticker) {
        errors++;
        continue;
      }
      try {
        insertStmt.run(
          ticker,
          row.date,
          row.open_price,
          row.high_price,
          row.low_price,
          row.close_price,
          row.volume
        );
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'stock_price_history → price_history', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// 2. MIGRATE prediction_logs → predictions.prediction_logs
// ===========================================================================
console.log('📦 Migrating prediction_logs...');

try {
  const sourceData = egxDb.query('SELECT * FROM prediction_logs ORDER BY created_at DESC').all() as Record<string, unknown>[];
  console.log(`   Source rows: ${sourceData.length}`);

  // Create table if not exists with matching schema
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

  const columns = Object.keys(sourceData[0] || {});
  const placeholders = columns.map(() => '?').join(', ');
  const insertStmt = predictionsDb.prepare(`INSERT OR REPLACE INTO prediction_logs (${columns.join(', ')}) VALUES (${placeholders})`);

  let migrated = 0;
  let errors = 0;

  const insertMany = predictionsDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      try {
        insertStmt.run(...Object.values(row));
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'prediction_logs → prediction_logs', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// 3. MIGRATE learned_lessons → learned.learned_lessons
// ===========================================================================
console.log('📦 Migrating learned_lessons...');

try {
  const sourceData = egxDb.query('SELECT * FROM learned_lessons').all() as Record<string, unknown>[];
  console.log(`   Source rows: ${sourceData.length}`);

  const columns = Object.keys(sourceData[0] || {});
  const placeholders = columns.map(() => '?').join(', ');
  const insertStmt = learnedDb.prepare(`INSERT OR REPLACE INTO learned_lessons (${columns.join(', ')}) VALUES (${placeholders})`);

  let migrated = 0;
  let errors = 0;

  const insertMany = learnedDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      try {
        insertStmt.run(...Object.values(row));
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'learned_lessons → learned_lessons', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// 4. MIGRATE cached_analysis → predictions.cached_analysis
// ===========================================================================
console.log('📦 Migrating cached_analysis...');

try {
  const sourceData = egxDb.query('SELECT * FROM cached_analysis').all() as Record<string, unknown>[];
  console.log(`   Source rows: ${sourceData.length}`);

  // Clear existing data
  predictionsDb.run('DELETE FROM cached_analysis');

  const columns = Object.keys(sourceData[0] || {});
  const placeholders = columns.map(() => '?').join(', ');
  const insertStmt = predictionsDb.prepare(`INSERT INTO cached_analysis (${columns.join(', ')}) VALUES (${placeholders})`);

  let migrated = 0;
  let errors = 0;

  const insertMany = predictionsDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      try {
        insertStmt.run(...Object.values(row));
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'cached_analysis → cached_analysis', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// 5. MIGRATE technical_indicators → predictions.technical_indicators
// ===========================================================================
console.log('📦 Migrating technical_indicators...');

try {
  const sourceData = egxDb.query('SELECT * FROM technical_indicators').all() as Record<string, unknown>[];
  console.log(`   Source rows: ${sourceData.length}`);

  // Create table
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

  const columns = Object.keys(sourceData[0] || {});
  const placeholders = columns.map(() => '?').join(', ');
  const insertStmt = predictionsDb.prepare(`INSERT OR REPLACE INTO technical_indicators (${columns.join(', ')}) VALUES (${placeholders})`);

  let migrated = 0;
  let errors = 0;

  const insertMany = predictionsDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      try {
        insertStmt.run(...Object.values(row));
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'technical_indicators → technical_indicators', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// SUMMARY
// ===========================================================================
console.log('\n=== Migration Summary ===\n');
console.log('| Table | Source | Migrated | Errors |');
console.log('|-------|--------|----------|--------|');
for (const r of results) {
  console.log(`| ${r.table} | ${r.source} | ${r.migrated} | ${r.errors} |`);
}

// Close databases
egxDb.close();
priceHistoryDb.close();
predictionsDb.close();
learnedDb.close();

console.log('\n✅ Migration complete! All databases closed.');
/**
 * Migration Script: Copy data from egx_investment.db to new databases
 * 
 * This script migrates:
 * - stock_price_history → price_history.db
 * - prediction_logs → predictions.db
 * - learned_lessons → learned.db
 * - cached_analysis → predictions.db
 * - technical_indicators → predictions.db (new table)
 */

import { Database } from 'bun:sqlite';

const DB_DIR = './db';

interface MigrationResult {
  table: string;
  source: number;
  migrated: number;
  errors: number;
}

const results: MigrationResult[] = [];

console.log('=== Migration Script: egx_investment.db → New Databases ===\n');

// Open source database
const egxDb = new Database(`${DB_DIR}/egx_investment.db`, { readonly: true });
console.log('✅ Opened egx_investment.db');

// Open destination databases
const priceHistoryDb = new Database(`${DB_DIR}/price_history.db`);
const predictionsDb = new Database(`${DB_DIR}/predictions.db`);
const learnedDb = new Database(`${DB_DIR}/learned.db`);

console.log('✅ Opened destination databases\n');

// ===========================================================================
// 1. MIGRATE stock_price_history → price_history
// ===========================================================================
console.log('📦 Migrating stock_price_history...');

try {
  // Get ticker mapping from stocks
  const stocksInEgx = egxDb.query('SELECT id, ticker FROM stocks').all() as { id: number; ticker: string }[];
  const stockIdToTicker = new Map(stocksInEgx.map(s => [s.id, s.ticker]));

  // Get source data
  const sourceData = egxDb.query(`
    SELECT * FROM stock_price_history ORDER BY date DESC
  `).all() as Record<string, unknown>[];

  console.log(`   Source rows: ${sourceData.length}`);

  // Prepare insert
  const insertStmt = priceHistoryDb.prepare(`
    INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  let errors = 0;

  const insertMany = priceHistoryDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const ticker = stockIdToTicker.get(Number(row.stock_id)) || row.ticker as string;
      if (!ticker) {
        errors++;
        continue;
      }
      try {
        insertStmt.run(
          ticker,
          row.date,
          row.open_price,
          row.high_price,
          row.low_price,
          row.close_price,
          row.volume
        );
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'stock_price_history → price_history', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// 2. MIGRATE prediction_logs → predictions.prediction_logs
// ===========================================================================
console.log('📦 Migrating prediction_logs...');

try {
  const sourceData = egxDb.query('SELECT * FROM prediction_logs ORDER BY created_at DESC').all() as Record<string, unknown>[];
  console.log(`   Source rows: ${sourceData.length}`);

  // Create table if not exists with matching schema
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

  const columns = Object.keys(sourceData[0] || {});
  const placeholders = columns.map(() => '?').join(', ');
  const insertStmt = predictionsDb.prepare(`INSERT OR REPLACE INTO prediction_logs (${columns.join(', ')}) VALUES (${placeholders})`);

  let migrated = 0;
  let errors = 0;

  const insertMany = predictionsDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      try {
        insertStmt.run(...Object.values(row));
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'prediction_logs → prediction_logs', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// 3. MIGRATE learned_lessons → learned.learned_lessons
// ===========================================================================
console.log('📦 Migrating learned_lessons...');

try {
  const sourceData = egxDb.query('SELECT * FROM learned_lessons').all() as Record<string, unknown>[];
  console.log(`   Source rows: ${sourceData.length}`);

  const columns = Object.keys(sourceData[0] || {});
  const placeholders = columns.map(() => '?').join(', ');
  const insertStmt = learnedDb.prepare(`INSERT OR REPLACE INTO learned_lessons (${columns.join(', ')}) VALUES (${placeholders})`);

  let migrated = 0;
  let errors = 0;

  const insertMany = learnedDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      try {
        insertStmt.run(...Object.values(row));
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'learned_lessons → learned_lessons', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// 4. MIGRATE cached_analysis → predictions.cached_analysis
// ===========================================================================
console.log('📦 Migrating cached_analysis...');

try {
  const sourceData = egxDb.query('SELECT * FROM cached_analysis').all() as Record<string, unknown>[];
  console.log(`   Source rows: ${sourceData.length}`);

  // Clear existing data
  predictionsDb.run('DELETE FROM cached_analysis');

  const columns = Object.keys(sourceData[0] || {});
  const placeholders = columns.map(() => '?').join(', ');
  const insertStmt = predictionsDb.prepare(`INSERT INTO cached_analysis (${columns.join(', ')}) VALUES (${placeholders})`);

  let migrated = 0;
  let errors = 0;

  const insertMany = predictionsDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      try {
        insertStmt.run(...Object.values(row));
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'cached_analysis → cached_analysis', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// 5. MIGRATE technical_indicators → predictions.technical_indicators
// ===========================================================================
console.log('📦 Migrating technical_indicators...');

try {
  const sourceData = egxDb.query('SELECT * FROM technical_indicators').all() as Record<string, unknown>[];
  console.log(`   Source rows: ${sourceData.length}`);

  // Create table
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

  const columns = Object.keys(sourceData[0] || {});
  const placeholders = columns.map(() => '?').join(', ');
  const insertStmt = predictionsDb.prepare(`INSERT OR REPLACE INTO technical_indicators (${columns.join(', ')}) VALUES (${placeholders})`);

  let migrated = 0;
  let errors = 0;

  const insertMany = predictionsDb.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      try {
        insertStmt.run(...Object.values(row));
        migrated++;
      } catch (e) {
        errors++;
      }
    }
  });

  insertMany(sourceData);

  results.push({ table: 'technical_indicators → technical_indicators', source: sourceData.length, migrated, errors });
  console.log(`   ✅ Migrated: ${migrated}, Errors: ${errors}\n`);
} catch (e) {
  console.log(`   ❌ Error: ${e}\n`);
}

// ===========================================================================
// SUMMARY
// ===========================================================================
console.log('\n=== Migration Summary ===\n');
console.log('| Table | Source | Migrated | Errors |');
console.log('|-------|--------|----------|--------|');
for (const r of results) {
  console.log(`| ${r.table} | ${r.source} | ${r.migrated} | ${r.errors} |`);
}

// Close databases
egxDb.close();
priceHistoryDb.close();
predictionsDb.close();
learnedDb.close();

console.log('\n✅ Migration complete! All databases closed.');

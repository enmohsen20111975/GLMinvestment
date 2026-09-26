#!/usr/bin/env node
/**
 * dev_seed_dedup_test_dbs.js
 * =====================================================================
 * DEV/TEST ONLY — creates synthetic DBs that mimic the production
 * duplicate-table situation so the consolidation script can be exercised
 * end-to-end without touching real production data.
 *
 * Creates in DB_DIR_OVERRIDE (defaults to /tmp/dedup-test-<ts>/):
 *   - stocks.db       with ExpertRecommendation(10 rows), outcome_logs(20),
 *                     learned_lessons(5), indicator_weights(4),
 *                     regime_indicator_weights(6)
 *   - auth.db         with ExpertRecommendation(5 rows) — different ids
 *   - predictions.db  with ExpertRecommendation(8 rows) — canonical, different
 *                     ids (so INSERT OR IGNORE doesn't double-insert)
 *                     + outcome_logs(20) — same ids as stocks.db (to test dedup)
 *   - learned.db      EMPTY (no tables)
 *   - finance.db      EMPTY
 *   - custom.db       EMPTY
 *   - crypto.db       EMPTY
 *
 * Usage:
 *   node scripts/dev_seed_dedup_test_dbs.js
 *
 * Then run the consolidation:
 *   DB_DIR_OVERRIDE=$(node scripts/dev_seed_dedup_test_dbs.js) \
 *     node scripts/consolidate-db-duplicates.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DIR = process.env.DB_DIR_OVERRIDE
  ? path.resolve(process.env.DB_DIR_OVERRIDE)
  : path.join(os.tmpdir(), `dedup-test-${Date.now()}`);

fs.mkdirSync(TEST_DIR, { recursive: true });
console.log(TEST_DIR); // The only stdout — so DB_DIR_OVERRIDE=$(...) works.

function log(...a) { console.error('[seed]', ...a); }

const SCHEMAS = {
  ExpertRecommendation: `
    CREATE TABLE IF NOT EXISTS ExpertRecommendation (
      id TEXT PRIMARY KEY,
      stock_symbol TEXT,
      stock_name_ar TEXT,
      expert_name TEXT,
      action TEXT,
      entry_price REAL,
      target_price REAL,
      stop_loss REAL,
      status TEXT,
      recommendation_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    )
  `,
  outcome_logs: `
    CREATE TABLE IF NOT EXISTS outcome_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER,
      close_date TEXT,
      actual_exit_price REAL,
      close_reason TEXT,
      gross_profit_loss REAL,
      net_profit_loss REAL,
      profit_loss_percent REAL,
      days_open INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `,
  learned_lessons: `
    CREATE TABLE IF NOT EXISTS learned_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_type TEXT,
      title TEXT,
      description TEXT,
      trigger_conditions TEXT,
      action TEXT,
      confidence REAL,
      occurrences INTEGER,
      first_seen TEXT,
      last_seen TEXT,
      status TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `,
  indicator_weights: `
    CREATE TABLE IF NOT EXISTS indicator_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      regime TEXT NOT NULL,
      indicator_name TEXT NOT NULL,
      base_weight REAL,
      learned_weight REAL,
      win_rate REAL,
      sample_count INTEGER,
      last_updated TEXT,
      notes TEXT,
      UNIQUE(regime, indicator_name)
    )
  `,
  regime_indicator_weights: `
    CREATE TABLE IF NOT EXISTS regime_indicator_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      indicator_name TEXT NOT NULL,
      regime TEXT NOT NULL,
      weight REAL,
      expectancy REAL,
      sample_count INTEGER,
      last_calculated TEXT,
      UNIQUE(indicator_name, regime)
    )
  `,
};

function ensure(db, table) {
  if (!SCHEMAS[table]) throw new Error('unknown table ' + table);
  db.exec(SCHEMAS[table]);
}

function insertExpertRecs(db, prefix, count, offset = 0) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO ExpertRecommendation
      (id, stock_symbol, stock_name_ar, expert_name, action, entry_price, target_price, stop_loss, status, recommendation_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < count; i++) {
    const idx = offset + i;
    stmt.run(
      `${prefix}-${idx}`,                       // id
      `STK${idx % 5}`,                          // stock_symbol
      `سهم ${idx}`,                             // stock_name_ar
      `خبير ${idx % 3}`,                        // expert_name
      idx % 2 === 0 ? 'BUY' : 'SELL',           // action
      100 + idx,                                // entry_price
      110 + idx,                                // target_price
      95 + idx,                                 // stop_loss
      'PENDING',                                // status
      '2026-09-01'                              // recommendation_date
    );
  }
}

function insertOutcomeLogs(db, count, startId = 1) {
  const stmt = db.prepare(`
    INSERT INTO outcome_logs
      (trade_id, close_date, actual_exit_price, close_reason, gross_profit_loss, net_profit_loss, profit_loss_percent, days_open, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < count; i++) {
    const id = startId + i;
    stmt.run(id, '2026-09-01', 105, 'target', 5, 4.8, 5.0, 3, '2026-09-04');
  }
}

function insertLearnedLessons(db, count) {
  const stmt = db.prepare(`
    INSERT INTO learned_lessons
      (lesson_type, title, description, trigger_conditions, action, confidence, occurrences, first_seen, last_seen, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < count; i++) {
    stmt.run('loss', `درس ${i}`, 'وصف', 'شرط', 'فعل', 0.7, i + 1, '2026-08-01', '2026-09-01', 'testing', '2026-08-01');
  }
}

function insertIndicatorWeights(db, count) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO indicator_weights
      (regime, indicator_name, base_weight, learned_weight, win_rate, sample_count, last_updated, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const regimes = ['BULL', 'BEAR', 'RANGE'];
  const indicators = ['rsi', 'macd', 'ema_50', 'volume_ratio'];
  let n = 0;
  for (let i = 0; i < count; i++) {
    const r = regimes[i % regimes.length];
    const ind = indicators[i % indicators.length];
    stmt.run(r, ind, 1.0, 1.2, 55, 100, '2026-09-01', `note-${i}`);
    n++;
  }
  return n;
}

function insertRegimeIndicatorWeights(db, count) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO regime_indicator_weights
      (indicator_name, regime, weight, expectancy, sample_count, last_calculated)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const regimes = ['BULL', 'BEAR', 'RANGE'];
  const indicators = ['rsi', 'macd', 'ema_50', 'volume_ratio', 'atr'];
  for (let i = 0; i < count; i++) {
    const ind = indicators[i % indicators.length];
    const r = regimes[i % regimes.length];
    stmt.run(ind, r, 1.0 + i * 0.05, 0.012 * i, 50 + i, '2026-09-01');
  }
}

function createEmptyDb(file) {
  const p = path.join(TEST_DIR, file);
  if (fs.existsSync(p)) fs.rmSync(p);
  const db = new Database(p);
  db.close();
  log(`created empty DB: ${file}`);
}

function buildStocks() {
  const db = new Database(path.join(TEST_DIR, 'stocks.db'));
  db.pragma('journal_mode = WAL');
  ensure(db, 'ExpertRecommendation');
  ensure(db, 'outcome_logs');
  ensure(db, 'learned_lessons');
  ensure(db, 'indicator_weights');
  ensure(db, 'regime_indicator_weights');
  insertExpertRecs(db, 'STK', 10, 1000); // ids STK-1000..STK-1009
  insertOutcomeLogs(db, 20, 1);           // ids 1..20
  insertLearnedLessons(db, 5);
  insertIndicatorWeights(db, 4);
  insertRegimeIndicatorWeights(db, 6);
  db.close();
  log('built stocks.db');
}

function buildAuth() {
  const db = new Database(path.join(TEST_DIR, 'auth.db'));
  db.pragma('journal_mode = WAL');
  ensure(db, 'ExpertRecommendation');
  insertExpertRecs(db, 'AUTH', 5, 2000); // ids AUTH-2000..AUTH-2004
  db.close();
  log('built auth.db');
}

function buildPredictions() {
  const db = new Database(path.join(TEST_DIR, 'predictions.db'));
  db.pragma('journal_mode = WAL');
  ensure(db, 'ExpertRecommendation');
  ensure(db, 'outcome_logs');
  insertExpertRecs(db, 'PRED', 8, 3000);    // ids PRED-3000..PRED-3007
  insertOutcomeLogs(db, 20, 1);              // ids 1..20 (DUPLICATES of stocks.db)
  db.close();
  log('built predictions.db (canonical)');
}

function main() {
  log('TEST_DIR =', TEST_DIR);
  // Wipe stale test DBs in the dir.
  if (TEST_DIR.includes('dedup-test-')) {
    for (const f of fs.readdirSync(TEST_DIR)) {
      if (f.endsWith('.db') || f.endsWith('.db.bak') || f.startsWith('migration-consolidate-')) {
        fs.rmSync(path.join(TEST_DIR, f));
      }
    }
  }
  buildStocks();
  buildAuth();
  buildPredictions();
  createEmptyDb('learned.db');
  createEmptyDb('finance.db');
  createEmptyDb('custom.db');
  createEmptyDb('crypto.db');
  log('done.');
}

main();

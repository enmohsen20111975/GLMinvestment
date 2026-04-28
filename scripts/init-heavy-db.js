#!/usr/bin/env node
/**
 * init-heavy-db.js — Create and seed egx_investment.db with full schema + data
 *
 * Creates the heavy database required by the feedback loop, recommendation engine,
 * and price history analysis features. Copies stocks from custom.db and seeds
 * default calculation weights.
 *
 * Usage:
 *   node scripts/init-heavy-db.js
 *   node scripts/init-heavy-db.js --force   # Recreate even if exists
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const HEAVY_DB_PATH = path.join(ROOT, 'db', 'egx_investment.db');
const LIGHT_DB_PATH = path.join(ROOT, 'db', 'custom.db');
const WASM_PATH = path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

async function main() {
  console.log('=== EGX Heavy DB Initialization ===\n');

  const forceRecreate = process.argv.includes('--force');

  // Check if DB already exists
  if (fs.existsSync(HEAVY_DB_PATH) && !forceRecreate) {
    const stats = fs.statSync(HEAVY_DB_PATH);
    console.log(`  egx_investment.db already exists (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    console.log('  Use --force to recreate.');
    process.exit(0);
  }

  if (forceRecreate && fs.existsSync(HEAVY_DB_PATH)) {
    fs.unlinkSync(HEAVY_DB_PATH);
    console.log('  Removed existing egx_investment.db (--force)');
  }

  // Load sql.js
  if (!fs.existsSync(WASM_PATH)) {
    console.error('ERROR: sql-wasm.wasm not found at', WASM_PATH);
    process.exit(1);
  }

  const initSqlJs = require('sql.js');
  const wasmBinary = fs.readFileSync(WASM_PATH);
  const SQL = await initSqlJs({ wasmBinary });

  // Create the database
  const db = new SQL.Database();

  // ==================== CREATE TABLES ====================

  console.log('  Creating tables...');

  // Core stock table (matches light DB schema)
  db.run(`CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255),
    name_ar VARCHAR(255),
    current_price FLOAT,
    previous_close FLOAT,
    open_price FLOAT,
    high_price FLOAT,
    low_price FLOAT,
    volume INTEGER,
    market_cap FLOAT,
    pe_ratio FLOAT,
    pb_ratio FLOAT,
    ps_ratio FLOAT,
    ev_to_ebitda FLOAT,
    dividend_yield FLOAT,
    eps FLOAT,
    roe FLOAT,
    roa FLOAT,
    debt_to_equity FLOAT,
    current_ratio FLOAT,
    book_value_per_share FLOAT,
    shares_outstanding FLOAT,
    support_level FLOAT,
    resistance_level FLOAT,
    ma_50 FLOAT,
    ma_200 FLOAT,
    rsi FLOAT,
    investment_type TEXT DEFAULT 'stock',
    sector VARCHAR(100),
    industry VARCHAR(100),
    is_halal TINYINT(1) DEFAULT NULL,
    compliance_status TEXT DEFAULT 'unknown',
    compliance_note TEXT,
    compliance_last_reviewed DATETIME,
    egx30_member TINYINT(1) DEFAULT 0,
    egx70_member TINYINT(1) DEFAULT 0,
    egx100_member TINYINT(1) DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    is_egx TINYINT(1) DEFAULT 1,
    last_update DATETIME,
    created_at DATETIME
  )`);

  // Stock price history (with Next.js column names)
  db.run(`CREATE TABLE IF NOT EXISTS stock_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    close_price REAL,
    volume INTEGER,
    adjusted_close REAL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(stock_id, date),
    FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE
  )`);

  // Gold price history
  db.run(`CREATE TABLE IF NOT EXISTS gold_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    karat TEXT NOT NULL,
    price_per_gram REAL NOT NULL,
    change REAL,
    currency TEXT DEFAULT 'EGP',
    recorded_at TEXT DEFAULT (datetime('now')),
    source TEXT DEFAULT 'system'
  )`);

  // Market indices
  db.run(`CREATE TABLE IF NOT EXISTS market_indices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    current_value FLOAT,
    previous_close FLOAT,
    change FLOAT,
    change_percent FLOAT,
    is_shariah TINYINT(1) DEFAULT 0,
    last_update DATETIME,
    created_at DATETIME
  )`);

  // Gold prices (current)
  db.run(`CREATE TABLE IF NOT EXISTS gold_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    karat TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    price_per_gram REAL NOT NULL,
    change REAL,
    currency TEXT DEFAULT 'EGP',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT 'system'
  )`);

  // Currency rates (current)
  db.run(`CREATE TABLE IF NOT EXISTS currency_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    buy_rate REAL NOT NULL DEFAULT 0,
    sell_rate REAL NOT NULL DEFAULT 0,
    change REAL,
    is_major INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT 'system'
  )`);

  // Stock deep insight snapshots
  db.run(`CREATE TABLE IF NOT EXISTS stock_deep_insight_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER,
    ticker TEXT NOT NULL,
    insights_payload TEXT,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE
  )`);

  // Dividends
  db.run(`CREATE TABLE IF NOT EXISTS dividends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    ex_dividend_date TEXT,
    dividend_amount REAL,
    dividend_yield REAL,
    payment_date TEXT,
    declaration_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE
  )`);

  // ==================== V2 ENGINE TABLES ====================

  // Prediction logs (core feedback loop table)
  db.run(`CREATE TABLE IF NOT EXISTS prediction_logs (
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
  )`);

  // Calculation weights (v2 config service)
  db.run(`CREATE TABLE IF NOT EXISTS calculation_weights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parameter_name TEXT NOT NULL UNIQUE,
    parameter_group TEXT,
    current_value REAL NOT NULL,
    min_bound REAL,
    max_bound REAL,
    auto_adjust INTEGER DEFAULT 0,
    version TEXT DEFAULT '1.0.0',
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT 'system'
  )`);

  // Weight adjustment logs
  db.run(`CREATE TABLE IF NOT EXISTS weight_adjustment_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parameter_name TEXT NOT NULL,
    old_value REAL NOT NULL,
    new_value REAL NOT NULL,
    requested_value REAL,
    adjustment_reason TEXT,
    adjusted_by TEXT DEFAULT 'system',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Feedback accuracy summary
  db.run(`CREATE TABLE IF NOT EXISTS feedback_accuracy_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluated_at TEXT NOT NULL,
    model_version TEXT NOT NULL,
    time_horizon TEXT NOT NULL,
    total_predictions INTEGER DEFAULT 0,
    direction_correct INTEGER DEFAULT 0,
    direction_accuracy REAL DEFAULT 0,
    avg_price_error REAL DEFAULT 0,
    median_price_error REAL DEFAULT 0,
    buy_signal_accuracy REAL DEFAULT 0,
    sell_signal_accuracy REAL DEFAULT 0,
    strong_buy_accuracy REAL DEFAULT 0,
    hold_accuracy REAL DEFAULT 0,
    target_reached_count INTEGER DEFAULT 0,
    stop_hit_count INTEGER DEFAULT 0,
    avg_composite_score_correct REAL DEFAULT 0,
    avg_composite_score_incorrect REAL DEFAULT 0,
    regime_bull_accuracy REAL DEFAULT 0,
    regime_bear_accuracy REAL DEFAULT 0,
    regime_neutral_accuracy REAL DEFAULT 0,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Audit logs
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Admin settings
  db.run(`CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // DB metadata
  db.run(`CREATE TABLE IF NOT EXISTS db_metadata (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  )`);

  // Recommendations
  db.run(`CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    action TEXT,
    confidence REAL,
    target_price REAL,
    stop_loss REAL,
    entry_price REAL,
    composite_score REAL,
    fair_value REAL,
    upside_percent REAL,
    source TEXT DEFAULT 'v2-engine',
    raw_payload TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Smart tips
  db.run(`CREATE TABLE IF NOT EXISTS smart_tips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    tip_text_ar TEXT NOT NULL,
    trigger_event TEXT,
    priority INTEGER DEFAULT 50,
    is_active INTEGER DEFAULT 1,
    show_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ==================== INDEXES ====================

  console.log('  Creating indexes...');
  db.run('CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)');
  db.run('CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)');
  db.run('CREATE INDEX IF NOT EXISTS idx_stocks_active ON stocks(is_active)');
  db.run('CREATE INDEX IF NOT EXISTS idx_price_history_stock ON stock_price_history(stock_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_price_history_date ON stock_price_history(date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_price_history_stock_date ON stock_price_history(stock_id, date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_deep_insight_ticker ON stock_deep_insight_snapshots(ticker)');
  db.run('CREATE INDEX IF NOT EXISTS idx_deep_insight_stock ON stock_deep_insight_snapshots(stock_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_prediction_logs_date ON prediction_logs(prediction_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_prediction_logs_ticker ON prediction_logs(ticker)');
  db.run('CREATE INDEX IF NOT EXISTS idx_prediction_logs_validated ON prediction_logs(validated)');
  db.run('CREATE INDEX IF NOT EXISTS idx_recommendations_ticker ON recommendations(ticker)');
  db.run('CREATE INDEX IF NOT EXISTS idx_calc_weights_name ON calculation_weights(parameter_name)');
  db.run('CREATE INDEX IF NOT EXISTS idx_feedback_summary_horizon ON feedback_accuracy_summary(time_horizon)');

  // Enable WAL mode
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  console.log('  Tables and indexes created.');

  // ==================== COPY STOCKS FROM LIGHT DB ====================

  let stocksCopied = 0;
  if (fs.existsSync(LIGHT_DB_PATH)) {
    console.log('  Copying stocks from custom.db...');
    try {
      const lightBuf = fs.readFileSync(LIGHT_DB_PATH);
      const lightDb = new SQL.Database(lightBuf);

      // Copy stocks
      const stockRows = lightDb.exec('SELECT * FROM stocks');
      if (stockRows.length > 0) {
        const cols = stockRows[0].columns;
        const placeholders = cols.map(() => '?').join(',');
        const insertSQL = `INSERT OR IGNORE INTO stocks (${cols.join(',')}) VALUES (${placeholders})`;
        const stmt = db.prepare(insertSQL);
        for (const row of stockRows[0].values) {
          stmt.run(row);
          stocksCopied++;
        }
        stmt.free();
        console.log(`    stocks: ${stocksCopied} rows`);
      }

      // Copy market indices
      const idxRows = lightDb.exec('SELECT * FROM market_indices');
      if (idxRows.length > 0) {
        const cols = idxRows[0].columns;
        const placeholders = cols.map(() => '?').join(',');
        const insertSQL = `INSERT OR IGNORE INTO market_indices (${cols.join(',')}) VALUES (${placeholders})`;
        const stmt = db.prepare(insertSQL);
        for (const row of idxRows[0].values) {
          stmt.run(row);
        }
        stmt.free();
        console.log(`    market_indices: ${idxRows[0].values.length} rows`);
      }

      // Copy gold prices
      const goldRows = lightDb.exec('SELECT * FROM gold_prices');
      if (goldRows.length > 0) {
        const cols = goldRows[0].columns;
        const placeholders = cols.map(() => '?').join(',');
        const insertSQL = `INSERT OR IGNORE INTO gold_prices (${cols.join(',')}) VALUES (${placeholders})`;
        const stmt = db.prepare(insertSQL);
        for (const row of goldRows[0].values) {
          stmt.run(row);
        }
        stmt.free();
        console.log(`    gold_prices: ${goldRows[0].values.length} rows`);
      }

      // Copy currency rates
      const currRows = lightDb.exec('SELECT * FROM currency_rates');
      if (currRows.length > 0) {
        const cols = currRows[0].columns;
        const placeholders = cols.map(() => '?').join(',');
        const insertSQL = `INSERT OR IGNORE INTO currency_rates (${cols.join(',')}) VALUES (${placeholders})`;
        const stmt = db.prepare(insertSQL);
        for (const row of currRows[0].values) {
          stmt.run(row);
        }
        stmt.free();
        console.log(`    currency_rates: ${currRows[0].values.length} rows`);
      }

      // Copy admin settings
      const adminRows = lightDb.exec('SELECT * FROM admin_settings');
      if (adminRows.length > 0) {
        const cols = adminRows[0].columns;
        const placeholders = cols.map(() => '?').join(',');
        const insertSQL = `INSERT OR REPLACE INTO admin_settings (${cols.join(',')}) VALUES (${placeholders})`;
        const stmt = db.prepare(insertSQL);
        for (const row of adminRows[0].values) {
          stmt.run(row);
        }
        stmt.free();
        console.log(`    admin_settings: ${adminRows[0].values.length} rows`);
      }

      // Copy smart tips if exists (with column name mapping)
      try {
        const tipRows = lightDb.exec('SELECT * FROM smart_tips');
        if (tipRows.length > 0) {
          const cols = tipRows[0].columns;
          const insertSQL = `INSERT OR IGNORE INTO smart_tips (id, category, tip_text_ar, trigger_event, priority, is_active, show_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
          const stmt = db.prepare(insertSQL);
          for (const row of tipRows[0].values) {
            const colMap = {};
            cols.forEach((c, i) => { colMap[c] = row[i]; });
            const tipText = colMap.tip_text_ar || colMap.content || colMap.tip_text || '';
            stmt.run(
              colMap.id || null,
              colMap.category || 'general',
              tipText,
              colMap.trigger_event || null,
              colMap.priority || 50,
              colMap.is_active !== undefined ? colMap.is_active : 1,
              colMap.show_count || 0,
              colMap.created_at || null
            );
          }
          stmt.free();
          console.log(`    smart_tips: ${tipRows[0].values.length} rows`);
        }
      } catch (tipErr) {
        console.log('    smart_tips: skipped (schema mismatch: ' + tipErr.message + ')');
      }

      lightDb.close();
    } catch (err) {
      console.error('  ERROR copying from custom.db:', err.message);
    }
  } else {
    console.log('  WARNING: custom.db not found, skipping stock copy.');
  }

  // ==================== SEED CALCULATION WEIGHTS ====================

  console.log('  Seeding calculation_weights...');

  const defaultWeights = [
    // Quality / Fundamental weights
    { parameter_name: 'weight_profitability', parameter_group: 'quality', current_value: 0.25, min_bound: 0.05, max_bound: 0.50, description: 'Profitability analysis weight (PE, EPS, Net Margin, ROE)' },
    { parameter_name: 'weight_growth', parameter_group: 'quality', current_value: 0.20, min_bound: 0.05, max_bound: 0.40, description: 'Growth analysis weight (Revenue Growth, EPS Growth)' },
    { parameter_name: 'weight_safety', parameter_group: 'quality', current_value: 0.15, min_bound: 0.05, max_bound: 0.35, description: 'Safety / Risk analysis weight (Debt/Equity, Current Ratio)' },
    { parameter_name: 'weight_efficiency', parameter_group: 'quality', current_value: 0.15, min_bound: 0.05, max_bound: 0.30, description: 'Efficiency analysis weight (ROA, Asset Turnover)' },
    { parameter_name: 'weight_valuation', parameter_group: 'quality', current_value: 0.25, min_bound: 0.10, max_bound: 0.50, description: 'Valuation analysis weight (PB, PS, EV/EBITDA)' },

    // Composite score weights
    { parameter_name: 'quality_composite_weight', parameter_group: 'composite', current_value: 0.55, min_bound: 0.30, max_bound: 0.75, description: 'Weight of quality score in composite calculation' },
    { parameter_name: 'momentum_composite_weight', parameter_group: 'composite', current_value: 0.45, min_bound: 0.25, max_bound: 0.70, description: 'Weight of momentum score in composite calculation' },

    // Thresholds
    { parameter_name: 'strong_buy_threshold', parameter_group: 'thresholds', current_value: 65, min_bound: 50, max_bound: 85, description: 'Minimum composite score for Strong Buy recommendation' },
    { parameter_name: 'buy_threshold', parameter_group: 'thresholds', current_value: 52, min_bound: 40, max_bound: 65, description: 'Minimum composite score for Buy recommendation' },
    { parameter_name: 'hold_threshold', parameter_group: 'thresholds', current_value: 40, min_bound: 30, max_bound: 50, description: 'Minimum composite score for Hold recommendation' },
    { parameter_name: 'sell_threshold', parameter_group: 'thresholds', current_value: 30, min_bound: 20, max_bound: 45, description: 'Maximum composite score for Sell recommendation' },

    // Market regime
    { parameter_name: 'regime_bull_multiplier', parameter_group: 'regime', current_value: 1.3, min_bound: 1.0, max_bound: 1.6, description: 'Score multiplier in bull market regime' },
    { parameter_name: 'regime_bear_multiplier', parameter_group: 'regime', current_value: 0.7, min_bound: 0.4, max_bound: 1.0, description: 'Score multiplier in bear market regime' },
    { parameter_name: 'regime_bull_threshold', parameter_group: 'regime', current_value: 20, min_bound: 10, max_bound: 35, description: 'Average change % to detect bull market' },
    { parameter_name: 'regime_bear_threshold', parameter_group: 'regime', current_value: -15, min_bound: -30, max_bound: -5, description: 'Average change % to detect bear market' },
    { parameter_name: 'market_regime', parameter_group: 'regime', current_value: 0, min_bound: -1, max_bound: 1, description: 'Manual regime override (0=auto, 1=bull, -1=bear)' },

    // Feedback loop settings
    { parameter_name: 'feedback_enabled', parameter_group: 'feedback', current_value: 1, min_bound: 0, max_bound: 1, description: 'Enable/disable auto feedback loop' },
    { parameter_name: 'feedback_min_predictions', parameter_group: 'feedback', current_value: 30, min_bound: 10, max_bound: 200, description: 'Minimum predictions before weight adjustments kick in' },
    { parameter_name: 'feedback_direction_accuracy_target', parameter_group: 'feedback', current_value: 55, min_bound: 45, max_bound: 75, description: 'Target direction accuracy % before adjustments' },
    { parameter_name: 'feedback_boost_factor', parameter_group: 'feedback', current_value: 0.05, min_bound: 0.01, max_bound: 0.15, description: 'Factor for boosting weights when accuracy is good' },
    { parameter_name: 'feedback_decay_factor', parameter_group: 'feedback', current_value: 0.03, min_bound: 0.01, max_bound: 0.10, description: 'Factor for decaying weights when accuracy is poor' },
    { parameter_name: 'feedback_max_weight_adjustment', parameter_group: 'feedback', current_value: 15, min_bound: 5, max_bound: 30, description: 'Maximum % weight adjustment per cycle' },
    { parameter_name: 'feedback_backtest_days', parameter_group: 'feedback', current_value: 60, min_bound: 20, max_bound: 180, description: 'Number of days for historical backtesting' },

    // Fair value parameters
    { parameter_name: 'fair_value_pe_base', parameter_group: 'fair_value', current_value: 12, min_bound: 5, max_bound: 25, description: 'Base PE ratio for fair value calculation' },
    { parameter_name: 'fair_value_pb_base', parameter_group: 'fair_value', current_value: 1.5, min_bound: 0.5, max_bound: 4.0, description: 'Base PB ratio for fair value calculation' },
    { parameter_name: 'fair_value_growth_premium', parameter_group: 'fair_value', current_value: 0.5, min_bound: 0.1, max_bound: 1.5, description: 'Growth premium multiplier for fair value' },
    { parameter_name: 'fair_value_sector_adjustment', parameter_group: 'fair_value', current_value: 1.0, min_bound: 0.5, max_bound: 2.0, description: 'Sector-based adjustment for fair value' },

    // Technical indicators
    { parameter_name: 'rsi_oversold', parameter_group: 'technical', current_value: 30, min_bound: 20, max_bound: 40, description: 'RSI oversold threshold' },
    { parameter_name: 'rsi_overbought', parameter_group: 'technical', current_value: 70, min_bound: 60, max_bound: 80, description: 'RSI overbought threshold' },
    { parameter_name: 'ma_cross_weight', parameter_group: 'technical', current_value: 0.15, min_bound: 0.05, max_bound: 0.30, description: 'Weight for MA crossover signals' },
    { parameter_name: 'volume_spike_threshold', parameter_group: 'technical', current_value: 2.0, min_bound: 1.5, max_bound: 4.0, description: 'Volume spike threshold (x average)' },
  ];

  let weightCount = 0;
  for (const w of defaultWeights) {
    try {
      const pn = String(w.parameter_name);
      const pg = String(w.parameter_group || 'general');
      const cv = Number(w.current_value);
      const mb = w.min_bound !== null && w.min_bound !== undefined ? Number(w.min_bound) : null;
      const xb = w.max_bound !== null && w.max_bound !== undefined ? Number(w.max_bound) : null;
      const desc = String(w.description || '');
      db.run(
        `INSERT INTO calculation_weights (parameter_name, parameter_group, current_value, min_bound, max_bound, description)
         VALUES ('${pn.replace(/'/g, "''")}', '${pg.replace(/'/g, "''")}', ${cv}, ${mb}, ${xb}, '${desc.replace(/'/g, "''")}')`
      );
      weightCount++;
    } catch (wErr) {
      console.error(`    ERROR seeding weight ${w.parameter_name}: ${wErr.message}`);
    }
  }
  console.log(`    ${weightCount}/${defaultWeights.length} weight parameters seeded.`);

  // ==================== SAVE METADATA ====================

  db.run("INSERT OR REPLACE INTO db_metadata VALUES ('version', '2.0.0', datetime('now'))");
  db.run("INSERT OR REPLACE INTO db_metadata VALUES ('schema_version', '2', datetime('now'))");
  db.run("INSERT OR REPLACE INTO db_metadata VALUES ('source', 'initialized', datetime('now'))");
  db.run("INSERT OR REPLACE INTO db_metadata VALUES ('stock_count', ?, datetime('now'))", stocksCopied);

  // ==================== EXPORT DATABASE ====================

  const data = db.export();
  const buf = Buffer.from(data);
  fs.writeFileSync(HEAVY_DB_PATH, buf);

  console.log(`\n  egx_investment.db saved: ${(buf.length / 1024).toFixed(1)} KB`);
  console.log(`  Stocks: ${stocksCopied}`);
  console.log(`  Tables: 18 (stocks, price_history, predictions, weights, etc.)`);
  console.log(`  Weights: ${defaultWeights.length} parameters`);
  console.log('\n  NOTE: stock_price_history is empty. Run market sync to populate:');
  console.log('    POST /api/market/sync-live');
  console.log('    Or use the VPS bridge to fetch historical data.');

  db.close();
  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

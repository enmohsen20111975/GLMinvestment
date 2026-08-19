#!/usr/bin/env bun
/**
 * Sync Light Database Script
 * سكريبت مزامنة قاعدة البيانات الخفيفة
 * 
 * يقوم بمزامنة البيانات بين قواعد البيانات المختلفة
 * ويضمن وجود الجداول المطلوبة
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = process.cwd();
const DB_DIR = join(PROJECT_ROOT, 'db');

// Ensure db directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
  console.log('✅ Created db directory');
}

// Database paths
const STOCKS_DB_PATH = join(DB_DIR, 'stocks.db');
const CUSTOM_DB_PATH = join(DB_DIR, 'stocks.db');

// Tables to ensure exist in stocks.db
const STOCKS_DB_TABLES = `
-- Expert Recommendations Table
CREATE TABLE IF NOT EXISTS ExpertRecommendation (
  id TEXT PRIMARY KEY,
  stock_symbol TEXT NOT NULL,
  stock_name_ar TEXT,
  expert_name TEXT NOT NULL,
  expert_source TEXT,
  action TEXT DEFAULT 'BUY',
  recommendation_type TEXT DEFAULT 'detailed',
  
  entry_price REAL NOT NULL,
  entry_price_from REAL,
  entry_price_to REAL,
  entry_condition TEXT,
  
  target_price REAL,
  target_price_2 REAL,
  investment_target REAL,
  
  support_level REAL,
  resistance_level REAL,
  
  expected_profit_min REAL,
  expected_profit_max REAL,
  expected_profit_investment REAL,
  
  stop_loss REAL,
  stop_loss_condition TEXT,
  
  technical_analysis TEXT,
  fundamental_analysis TEXT,
  recommendation_reason TEXT,
  
  session_date TEXT,
  session_type TEXT DEFAULT 'صباحية',
  expected_duration TEXT,
  expected_duration_days INTEGER,
  
  notes TEXT,
  status TEXT DEFAULT 'PENDING',
  
  final_price REAL,
  profit_loss_percent REAL,
  hit_target INTEGER DEFAULT 0,
  hit_stop_loss INTEGER DEFAULT 0,
  closed_at TEXT,
  
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Prediction Logs Table
CREATE TABLE IF NOT EXISTS prediction_logs (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  prediction_date TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  confidence REAL,
  entry_price REAL,
  target_price REAL,
  stop_loss REAL,
  
  direction_correct_5d INTEGER DEFAULT 0,
  direction_correct_10d INTEGER DEFAULT 0,
  target_reached INTEGER DEFAULT 0,
  stop_hit INTEGER DEFAULT 0,
  
  actual_price_5d REAL,
  actual_price_10d REAL,
  
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cached Analysis Table
CREATE TABLE IF NOT EXISTS cached_analysis (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL UNIQUE,
  signal TEXT,
  master_score REAL,
  technical_score REAL,
  fundamental_score REAL,
  timing_score REAL,
  analysis_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Stocks Table
CREATE TABLE IF NOT EXISTS stocks (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  name_ar TEXT,
  sector TEXT,
  industry TEXT,
  market TEXT DEFAULT 'EGX',
  is_active INTEGER DEFAULT 1,
  is_egx30 INTEGER DEFAULT 0,
  is_egx70 INTEGER DEFAULT 0,
  is_egx100 INTEGER DEFAULT 0,
  
  current_price REAL,
  previous_close REAL,
  change REAL,
  change_percent REAL,
  volume REAL,
  turnover REAL,
  market_cap REAL,
  
  high_52w REAL,
  low_52w REAL,
  
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Market Indices Table
CREATE TABLE IF NOT EXISTS market_indices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  value REAL,
  change REAL,
  change_percent REAL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_expert_rec_symbol ON ExpertRecommendation(stock_symbol);
CREATE INDEX IF NOT EXISTS idx_expert_rec_status ON ExpertRecommendation(status);
CREATE INDEX IF NOT EXISTS idx_expert_rec_date ON ExpertRecommendation(session_date);
CREATE INDEX IF NOT EXISTS idx_prediction_ticker ON prediction_logs(ticker);
CREATE INDEX IF NOT EXISTS idx_prediction_date ON prediction_logs(prediction_date);
CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market);
CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector);
`;

interface SyncResult {
  success: boolean;
  tables_created: number;
  stocks_count: number;
  expert_recs_count: number;
  predictions_count: number;
  errors: string[];
}

async function syncLightDatabase(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    tables_created: 0,
    stocks_count: 0,
    expert_recs_count: 0,
    predictions_count: 0,
    errors: []
  };

  try {
    // Use bun's sqlite wrapper
    const { Database } = await import('bun:sqlite');
    
    // Open or create stocks.db
    const db = new Database(STOCKS_DB_PATH);
    
    // Enable WAL mode
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
    
    console.log('📦 Syncing stocks.db...');
    
    // Create tables
    const statements = STOCKS_DB_TABLES.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      try {
        if (stmt.trim()) {
          db.run(stmt);
        }
      } catch (e: any) {
        if (!e.message.includes('already exists')) {
          result.errors.push(`Table creation: ${e.message}`);
        }
      }
    }
    
    // Count records
    try {
      const stocksCount = db.query('SELECT COUNT(*) as count FROM stocks').get() as { count: number };
      result.stocks_count = stocksCount?.count || 0;
    } catch (e) {
      result.stocks_count = 0;
    }
    
    try {
      const expertCount = db.query('SELECT COUNT(*) as count FROM ExpertRecommendation').get() as { count: number };
      result.expert_recs_count = expertCount?.count || 0;
    } catch (e) {
      result.expert_recs_count = 0;
    }
    
    try {
      const predCount = db.query('SELECT COUNT(*) as count FROM prediction_logs').get() as { count: number };
      result.predictions_count = predCount?.count || 0;
    } catch (e) {
      result.predictions_count = 0;
    }
    
    db.close();
    
    result.success = true;
    console.log(`✅ Synced stocks.db:`);
    console.log(`   - stocks: ${result.stocks_count} rows`);
    console.log(`   - ExpertRecommendation: ${result.expert_recs_count} rows`);
    console.log(`   - prediction_logs: ${result.predictions_count} rows`);
    
  } catch (error: any) {
    result.errors.push(error.message);
    console.error('❌ Error syncing database:', error.message);
  }

  return result;
}

// Run the sync
console.log('🔄 Starting database sync...');
const startTime = Date.now();

syncLightDatabase().then(result => {
  const duration = Date.now() - startTime;
  
  console.log('\n📊 Sync Summary:');
  console.log(`   Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
  console.log(`   Duration: ${duration}ms`);
  console.log(`   Stocks: ${result.stocks_count}`);
  console.log(`   Expert Recommendations: ${result.expert_recs_count}`);
  console.log(`   Predictions: ${result.predictions_count}`);
  
  if (result.errors.length > 0) {
    console.log(`   Errors: ${result.errors.length}`);
    result.errors.forEach(e => console.log(`     - ${e}`));
  }
  
  // Output for parsing by the API
  console.log(`\n📈 Result: stocks: ${result.stocks_count} rows, experts: ${result.expert_recs_count} rows, predictions: ${result.predictions_count} rows`);
  
  process.exit(result.success ? 0 : 1);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
#!/usr/bin/env bun
/**
 * Sync Light Database Script
 * سكريبت مزامنة قاعدة البيانات الخفيفة
 * 
 * يقوم بمزامنة البيانات بين قواعد البيانات المختلفة
 * ويضمن وجود الجداول المطلوبة
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = process.cwd();
const DB_DIR = join(PROJECT_ROOT, 'db');

// Ensure db directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
  console.log('✅ Created db directory');
}

// Database paths
const STOCKS_DB_PATH = join(DB_DIR, 'stocks.db');
const CUSTOM_DB_PATH = join(DB_DIR, 'custom.db');

// Tables to ensure exist in stocks.db
const STOCKS_DB_TABLES = `
-- Expert Recommendations Table
CREATE TABLE IF NOT EXISTS ExpertRecommendation (
  id TEXT PRIMARY KEY,
  stock_symbol TEXT NOT NULL,
  stock_name_ar TEXT,
  expert_name TEXT NOT NULL,
  expert_source TEXT,
  action TEXT DEFAULT 'BUY',
  recommendation_type TEXT DEFAULT 'detailed',
  
  entry_price REAL NOT NULL,
  entry_price_from REAL,
  entry_price_to REAL,
  entry_condition TEXT,
  
  target_price REAL,
  target_price_2 REAL,
  investment_target REAL,
  
  support_level REAL,
  resistance_level REAL,
  
  expected_profit_min REAL,
  expected_profit_max REAL,
  expected_profit_investment REAL,
  
  stop_loss REAL,
  stop_loss_condition TEXT,
  
  technical_analysis TEXT,
  fundamental_analysis TEXT,
  recommendation_reason TEXT,
  
  session_date TEXT,
  session_type TEXT DEFAULT 'صباحية',
  expected_duration TEXT,
  expected_duration_days INTEGER,
  
  notes TEXT,
  status TEXT DEFAULT 'PENDING',
  
  final_price REAL,
  profit_loss_percent REAL,
  hit_target INTEGER DEFAULT 0,
  hit_stop_loss INTEGER DEFAULT 0,
  closed_at TEXT,
  
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Prediction Logs Table
CREATE TABLE IF NOT EXISTS prediction_logs (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  prediction_date TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  confidence REAL,
  entry_price REAL,
  target_price REAL,
  stop_loss REAL,
  
  direction_correct_5d INTEGER DEFAULT 0,
  direction_correct_10d INTEGER DEFAULT 0,
  target_reached INTEGER DEFAULT 0,
  stop_hit INTEGER DEFAULT 0,
  
  actual_price_5d REAL,
  actual_price_10d REAL,
  
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cached Analysis Table
CREATE TABLE IF NOT EXISTS cached_analysis (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL UNIQUE,
  signal TEXT,
  master_score REAL,
  technical_score REAL,
  fundamental_score REAL,
  timing_score REAL,
  analysis_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Stocks Table
CREATE TABLE IF NOT EXISTS stocks (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  name_ar TEXT,
  sector TEXT,
  industry TEXT,
  market TEXT DEFAULT 'EGX',
  is_active INTEGER DEFAULT 1,
  is_egx30 INTEGER DEFAULT 0,
  is_egx70 INTEGER DEFAULT 0,
  is_egx100 INTEGER DEFAULT 0,
  
  current_price REAL,
  previous_close REAL,
  change REAL,
  change_percent REAL,
  volume REAL,
  turnover REAL,
  market_cap REAL,
  
  high_52w REAL,
  low_52w REAL,
  
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Market Indices Table
CREATE TABLE IF NOT EXISTS market_indices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  value REAL,
  change REAL,
  change_percent REAL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_expert_rec_symbol ON ExpertRecommendation(stock_symbol);
CREATE INDEX IF NOT EXISTS idx_expert_rec_status ON ExpertRecommendation(status);
CREATE INDEX IF NOT EXISTS idx_expert_rec_date ON ExpertRecommendation(session_date);
CREATE INDEX IF NOT EXISTS idx_prediction_ticker ON prediction_logs(ticker);
CREATE INDEX IF NOT EXISTS idx_prediction_date ON prediction_logs(prediction_date);
CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market);
CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector);
`;

interface SyncResult {
  success: boolean;
  tables_created: number;
  stocks_count: number;
  expert_recs_count: number;
  predictions_count: number;
  errors: string[];
}

async function syncLightDatabase(): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    tables_created: 0,
    stocks_count: 0,
    expert_recs_count: 0,
    predictions_count: 0,
    errors: []
  };

  try {
    // Use bun's sqlite wrapper
    const { Database } = await import('bun:sqlite');
    
    // Open or create stocks.db
    const db = new Database(STOCKS_DB_PATH);
    
    // Enable WAL mode
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
    
    console.log('📦 Syncing stocks.db...');
    
    // Create tables
    const statements = STOCKS_DB_TABLES.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      try {
        if (stmt.trim()) {
          db.run(stmt);
        }
      } catch (e: any) {
        if (!e.message.includes('already exists')) {
          result.errors.push(`Table creation: ${e.message}`);
        }
      }
    }
    
    // Count records
    try {
      const stocksCount = db.query('SELECT COUNT(*) as count FROM stocks').get() as { count: number };
      result.stocks_count = stocksCount?.count || 0;
    } catch (e) {
      result.stocks_count = 0;
    }
    
    try {
      const expertCount = db.query('SELECT COUNT(*) as count FROM ExpertRecommendation').get() as { count: number };
      result.expert_recs_count = expertCount?.count || 0;
    } catch (e) {
      result.expert_recs_count = 0;
    }
    
    try {
      const predCount = db.query('SELECT COUNT(*) as count FROM prediction_logs').get() as { count: number };
      result.predictions_count = predCount?.count || 0;
    } catch (e) {
      result.predictions_count = 0;
    }
    
    db.close();
    
    result.success = true;
    console.log(`✅ Synced stocks.db:`);
    console.log(`   - stocks: ${result.stocks_count} rows`);
    console.log(`   - ExpertRecommendation: ${result.expert_recs_count} rows`);
    console.log(`   - prediction_logs: ${result.predictions_count} rows`);
    
  } catch (error: any) {
    result.errors.push(error.message);
    console.error('❌ Error syncing database:', error.message);
  }

  return result;
}

// Run the sync
console.log('🔄 Starting database sync...');
const startTime = Date.now();

syncLightDatabase().then(result => {
  const duration = Date.now() - startTime;
  
  console.log('\n📊 Sync Summary:');
  console.log(`   Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
  console.log(`   Duration: ${duration}ms`);
  console.log(`   Stocks: ${result.stocks_count}`);
  console.log(`   Expert Recommendations: ${result.expert_recs_count}`);
  console.log(`   Predictions: ${result.predictions_count}`);
  
  if (result.errors.length > 0) {
    console.log(`   Errors: ${result.errors.length}`);
    result.errors.forEach(e => console.log(`     - ${e}`));
  }
  
  // Output for parsing by the API
  console.log(`\n📈 Result: stocks: ${result.stocks_count} rows, experts: ${result.expert_recs_count} rows, predictions: ${result.predictions_count} rows`);
  
  process.exit(result.success ? 0 : 1);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

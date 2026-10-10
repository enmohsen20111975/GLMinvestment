/**
 * Database Migration Script
 * =========================
 * 
 * يعمل على إعادة هيكلة قواعد البيانات:
 * - stocks.db: كل الأسهم (مصرية + عربية) + العملات الرقمية
 * - price_history.db: الأسعار التاريخية
 * - predictions.db: التوقعات والتحليلات
 * - learned.db: الدروس المستفادة
 * - stocks.db: المستخدمين (زي هي)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'db');

// مصادر البيانات
const SOURCES = {
  stocks: path.join(DB_DIR, 'stocks.db'),
  unified_stocks: path.join(DB_DIR, 'unified_stocks.db'),
  crypto: path.join(DB_DIR, 'crypto.db'),
  custom: path.join(DB_DIR, 'stocks.db'),
};

// قواعد البيانات الجديدة
const TARGETS = {
  stocks: path.join(DB_DIR, 'stocks.db'),
  price_history: path.join(DB_DIR, 'price_history.db'),
  predictions: path.join(DB_DIR, 'predictions.db'),
  learned: path.join(DB_DIR, 'learned.db'),
};

// ==================== SCHEMAS ====================

const STOCKS_SCHEMA = `
-- جدول الأسهم الموحد
CREATE TABLE IF NOT EXISTS stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT UNIQUE NOT NULL,
  name TEXT,
  name_ar TEXT,
  market TEXT NOT NULL DEFAULT 'EGX',
  sector TEXT,
  industry TEXT,
  
  -- الأسعار
  current_price REAL,
  previous_close REAL,
  open_price REAL,
  high_price REAL,
  low_price REAL,
  change_percent REAL,
  volume INTEGER,
  market_cap REAL,
  
  -- المؤشرات
  pe_ratio REAL,
  pb_ratio REAL,
  ps_ratio REAL,
  eps REAL,
  roe REAL,
  roa REAL,
  debt_to_equity REAL,
  current_ratio REAL,
  book_value_per_share REAL,
  
  -- التحليل الفني
  ma_50 REAL,
  ma_200 REAL,
  rsi REAL,
  support_level REAL,
  resistance_level REAL,
  
  -- معلومات إضافية
  is_halal INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_egx30 INTEGER DEFAULT 0,
  is_egx70 INTEGER DEFAULT 0,
  is_egx100 INTEGER DEFAULT 0,
  
  -- العملات الرقمية
  is_crypto INTEGER DEFAULT 0,
  crypto_id TEXT,
  ath REAL,
  ath_change_percent REAL,
  atl REAL,
  atl_change_percent REAL,
  circulating_supply REAL,
  total_supply REAL,
  
  last_update TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker);
CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market);
CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector);
CREATE INDEX IF NOT EXISTS idx_stocks_is_crypto ON stocks(is_crypto);

-- جدول الذهب
CREATE TABLE IF NOT EXISTS gold_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  karat TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  price_per_gram REAL NOT NULL,
  change REAL,
  currency TEXT DEFAULT 'EGP',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- جدول العملات
CREATE TABLE IF NOT EXISTS currency_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  buy_rate REAL DEFAULT 0,
  sell_rate REAL DEFAULT 0,
  change REAL,
  is_major INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- جدول المؤشرات
CREATE TABLE IF NOT EXISTS market_indices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT UNIQUE,
  name TEXT,
  name_ar TEXT,
  current_value REAL,
  previous_close REAL,
  change REAL,
  change_percent REAL,
  is_shariah INTEGER DEFAULT 0,
  last_update TEXT
);
`;

const PRICE_HISTORY_SCHEMA = `
-- جدول الأسعار التاريخية
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  open_price REAL,
  high_price REAL,
  low_price REAL,
  close_price REAL,
  volume INTEGER,
  source TEXT DEFAULT 'system',
  created_at TEXT DEFAULT (datetime('now')),
  
  UNIQUE(ticker, date)
);

CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date);
CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date ON price_history(ticker, date);
`;

const PREDICTIONS_SCHEMA = `
-- جدول التوقعات
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  market TEXT DEFAULT 'EGX',
  signal TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  entry_price REAL,
  target_price REAL,
  stop_loss REAL,
  reasoning TEXT,
  indicators TEXT,
  news_summary TEXT,
  
  -- النتيجة
  verify_date TEXT,
  verified INTEGER DEFAULT 0,
  final_price REAL,
  result TEXT,
  profit_loss_pct REAL,
  
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_predictions_ticker ON predictions(ticker);
CREATE INDEX IF NOT EXISTS idx_predictions_created ON predictions(created_at);
CREATE INDEX IF NOT EXISTS idx_predictions_verified ON predictions(verified);
CREATE INDEX IF NOT EXISTS idx_predictions_market ON predictions(market);

-- جدول التحليلات المحفوظة
CREATE TABLE IF NOT EXISTS cached_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  analysis_type TEXT,
  analysis_data TEXT,
  score REAL,
  recommendation TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cached_analysis_ticker ON cached_analysis(ticker);

-- جدول سجلات التوقعات
CREATE TABLE IF NOT EXISTS prediction_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  signal_date TEXT NOT NULL,
  direction TEXT,
  maestro_score REAL,
  regime TEXT,
  phase_scores TEXT,
  calculated_entry_price REAL,
  calculated_stop_loss REAL,
  calculated_target REAL,
  indicators_used TEXT,
  executed INTEGER DEFAULT 0,
  execution_date TEXT,
  actual_entry_price REAL,
  actual_exit_price REAL,
  exit_reason TEXT,
  profit_percent REAL,
  outcome TEXT,
  days_open INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prediction_logs_ticker ON prediction_logs(ticker);
CREATE INDEX IF NOT EXISTS idx_prediction_logs_date ON prediction_logs(signal_date);

-- جدول توصيات الخبراء
CREATE TABLE IF NOT EXISTS expert_recommendations (
  id TEXT PRIMARY KEY,
  expert_name TEXT NOT NULL,
  stock_symbol TEXT NOT NULL,
  stock_name_ar TEXT,
  action TEXT NOT NULL,
  entry_price REAL,
  target_price REAL,
  stop_loss REAL,
  investment_target REAL,
  stop_loss_condition TEXT,
  timeframe TEXT,
  risk_level TEXT,
  notes TEXT,
  source TEXT,
  source_url TEXT,
  status TEXT DEFAULT 'PENDING',
  hit_target INTEGER DEFAULT 0,
  hit_stop_loss INTEGER DEFAULT 0,
  final_price REAL,
  profit_loss_percent REAL,
  closed_at TEXT,
  verified_at TEXT,
  recommendation_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expert_recs_expert ON expert_recommendations(expert_name);
CREATE INDEX IF NOT EXISTS idx_expert_recs_symbol ON expert_recommendations(stock_symbol);
CREATE INDEX IF NOT EXISTS idx_expert_recs_status ON expert_recommendations(status);
`;

const LEARNED_SCHEMA = `
-- جدول الدروس المستفادة
CREATE TABLE IF NOT EXISTS learned_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  lesson_date TEXT NOT NULL,
  lesson_type TEXT,
  scenario TEXT,
  what_worked TEXT,
  what_failed TEXT,
  market_conditions TEXT,
  indicators_involved TEXT,
  confidence_adjustment REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_learned_lessons_ticker ON learned_lessons(ticker);
CREATE INDEX IF NOT EXISTS idx_learned_lessons_date ON learned_lessons(lesson_date);
CREATE INDEX IF NOT EXISTS idx_learned_lessons_type ON learned_lessons(lesson_type);

-- جدول أوزان المؤشرات المتعلمة
CREATE TABLE IF NOT EXISTS indicator_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regime TEXT NOT NULL,
  indicator_name TEXT NOT NULL,
  base_weight REAL DEFAULT 1.0,
  learned_weight REAL DEFAULT 1.0,
  win_rate REAL DEFAULT 50,
  sample_count INTEGER DEFAULT 0,
  last_updated TEXT DEFAULT (datetime('now')),
  notes TEXT,
  
  UNIQUE(regime, indicator_name)
);

CREATE INDEX IF NOT EXISTS idx_indicator_weights_regime ON indicator_weights(regime);

-- جدول ثقة المؤشرات
CREATE TABLE IF NOT EXISTS indicator_trust_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator_name TEXT UNIQUE NOT NULL,
  trust_score REAL DEFAULT 50,
  total_signals INTEGER DEFAULT 0,
  successful_signals INTEGER DEFAULT 0,
  avg_profit REAL DEFAULT 0,
  last_updated TEXT DEFAULT (datetime('now'))
);

-- جدول أنماط السوق
CREATE TABLE IF NOT EXISTS market_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_name TEXT NOT NULL,
  pattern_type TEXT,
  description TEXT,
  success_rate REAL DEFAULT 0,
  occurrences INTEGER DEFAULT 0,
  avg_return REAL DEFAULT 0,
  last_seen TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_market_patterns_type ON market_patterns(pattern_type);
`;

// ==================== MIGRATION FUNCTIONS ====================

function createDatabase(dbPath: string, schema: string, name: string) {
  console.log(`\n📦 Creating ${name}...`);
  
  // حذف الملف القديم لو موجود
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log(`  ✓ Deleted old ${name}`);
  }
  
  const db = new Database(dbPath);
  db.exec(schema);
  console.log(`  ✓ Created schema for ${name}`);
  
  return db;
}

function migrateEGXStocks(targetDb: Database, sourceDb: Database) {
  console.log('\n📊 Migrating EGX stocks...');
  
  try {
    const stocks = sourceDb.prepare(`
      SELECT 
        ticker, name, name_ar, current_price, previous_close, open_price,
        high_price, low_price, change_percent, volume, market_cap,
        pe_ratio, pb_ratio, ps_ratio, eps, roe, roa, debt_to_equity,
        current_ratio, book_value_per_share, ma_50, ma_200, rsi,
        support_level, resistance_level, is_halal, is_active,
        is_egx30, is_egx70, is_egx100, sector, industry, last_update
      FROM stocks
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO stocks (
        ticker, name, name_ar, market, current_price, previous_close, open_price,
        high_price, low_price, change_percent, volume, market_cap,
        pe_ratio, pb_ratio, ps_ratio, eps, roe, roa, debt_to_equity,
        current_ratio, book_value_per_share, ma_50, ma_200, rsi,
        support_level, resistance_level, is_halal, is_active,
        is_egx30, is_egx70, is_egx100, sector, industry, last_update, is_crypto
      ) VALUES (
        @ticker, @name, @name_ar, 'EGX', @current_price, @previous_close, @open_price,
        @high_price, @low_price, @change_percent, @volume, @market_cap,
        @pe_ratio, @pb_ratio, @ps_ratio, @eps, @roe, @roa, @debt_to_equity,
        @current_ratio, @book_value_per_share, @ma_50, @ma_200, @rsi,
        @support_level, @resistance_level, @is_halal, @is_active,
        @is_egx30, @is_egx70, @is_egx100, @sector, @industry, @last_update, 0
      )
    `);
    
    let count = 0;
    for (const stock of stocks) {
      try {
        insert.run(stock);
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} EGX stocks`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migrateArabStocks(targetDb: Database, sourceDb: Database) {
  console.log('\n🌍 Migrating Arab stocks...');
  
  try {
    const stocks = sourceDb.prepare(`
      SELECT 
        ticker, name, name_ar, market, current_price, previous_close, open_price,
        high_price, low_price, change_percent, volume, market_cap,
        pe_ratio, pb_ratio, sector, industry, is_active, last_update
      FROM stocks
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO stocks (
        ticker, name, name_ar, market, current_price, previous_close, open_price,
        high_price, low_price, change_percent, volume, market_cap,
        pe_ratio, pb_ratio, sector, industry, is_active, last_update, is_crypto
      ) VALUES (
        @ticker, @name, @name_ar, @market, @current_price, @previous_close, @open_price,
        @high_price, @low_price, @change_percent, @volume, @market_cap,
        @pe_ratio, @pb_ratio, @sector, @industry, @is_active, @last_update, 0
      )
    `);
    
    let count = 0;
    for (const stock of stocks) {
      try {
        insert.run({ ...stock, is_crypto: 0 });
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} Arab stocks`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migrateCrypto(targetDb: Database, sourceDb: Database) {
  console.log('\n💰 Migrating Crypto...');
  
  try {
    const coins = sourceDb.prepare(`
      SELECT * FROM crypto_coins
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO stocks (
        ticker, name, market, is_crypto, crypto_id, current_price, 
        change_percent, market_cap, volume, ath, ath_change_percent, atl, atl_change_percent,
        circulating_supply, total_supply
      ) VALUES (
        @ticker, @name, 'CRYPTO', 1, @crypto_id, @current_price,
        @change_percent, @market_cap, @volume, @ath, @ath_change_percent, @atl, @atl_change_percent,
        @circulating_supply, @total_supply
      )
    `);
    
    let count = 0;
    for (const coin of coins) {
      try {
        insert.run({
          ticker: (coin.symbol || coin.coin_id || '').toUpperCase(),
          name: coin.name,
          crypto_id: coin.coin_id || coin.id,
          current_price: coin.current_price || coin.price,
          change_percent: coin.change_24h || coin.price_change_percentage_24h,
          market_cap: coin.market_cap,
          volume: coin.volume_24h || coin.total_volume,
          ath: coin.ath,
          ath_change_percent: coin.ath_change_percentage,
          atl: coin.atl,
          atl_change_percent: coin.atl_change_percentage,
          circulating_supply: coin.circulating_supply,
          total_supply: coin.total_supply,
        });
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} crypto coins`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migrateGoldAndCurrencies(targetDb: Database, sourceDb: Database) {
  console.log('\n📈 Migrating Gold and Currencies...');
  
  try {
    // Gold
    const gold = sourceDb.prepare(`SELECT * FROM gold_prices`).all() as any[];
    const insertGold = targetDb.prepare(`
      INSERT OR REPLACE INTO gold_prices (karat, name_ar, price_per_gram, change, currency, updated_at)
      VALUES (@karat, @name_ar, @price_per_gram, @change, @currency, @updated_at)
    `);
    
    for (const g of gold) {
      try {
        insertGold.run(g);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${gold.length} gold prices`);
    
    // Currencies
    const currencies = sourceDb.prepare(`SELECT * FROM currency_rates`).all() as any[];
    const insertCurrency = targetDb.prepare(`
      INSERT OR REPLACE INTO currency_rates (code, name_ar, buy_rate, sell_rate, change, is_major, updated_at)
      VALUES (@code, @name_ar, @buy_rate, @sell_rate, @change, @is_major, @updated_at)
    `);
    
    for (const c of currencies) {
      try {
        insertCurrency.run(c);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${currencies.length} currency rates`);
    
    // Market Indices
    const indices = sourceDb.prepare(`SELECT * FROM market_indices`).all() as any[];
    const insertIndex = targetDb.prepare(`
      INSERT OR REPLACE INTO market_indices (symbol, name, name_ar, current_value, previous_close, change, change_percent, is_shariah, last_update)
      VALUES (@symbol, @name, @name_ar, @current_value, @previous_close, @change, @change_percent, @is_shariah, @last_update)
    `);
    
    for (const i of indices) {
      try {
        insertIndex.run(i);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${indices.length} market indices`);
    
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
  }
}

function migratePriceHistory(targetDb: Database, sourceDb: Database) {
  console.log('\n📅 Migrating Price History...');
  
  try {
    const history = sourceDb.prepare(`
      SELECT ticker, date, open_price, high_price, low_price, close_price, volume, source
      FROM stock_price_history
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume, source)
      VALUES (@ticker, @date, @open_price, @high_price, @low_price, @close_price, @volume, @source)
    `);
    
    const batchSize = 1000;
    let count = 0;
    
    targetDb.exec('BEGIN TRANSACTION');
    for (const row of history) {
      try {
        insert.run(row);
        count++;
        if (count % batchSize === 0) {
          console.log(`  → Migrated ${count}/${history.length} records...`);
        }
      } catch (e) {
        // skip duplicates
      }
    }
    targetDb.exec('COMMIT');
    
    console.log(`  ✓ Migrated ${count} price history records`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migratePredictions(targetDb: Database, sourceDb: Database) {
  console.log('\n🎯 Migrating Predictions...');
  
  try {
    const predictions = sourceDb.prepare(`
      SELECT * FROM prediction_logs
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO predictions (
        id, ticker, market, signal, confidence, entry_price, target_price, stop_loss,
        reasoning, indicators, news_summary, verify_date, verified, final_price, result, profit_loss_pct, created_at
      ) VALUES (
        @id, @ticker, @market, @signal, @confidence, @entry_price, @target_price, @stop_loss,
        @reasoning, @indicators, @news_summary, @verify_date, @verified, @final_price, @result, @profit_loss_pct, @created_at
      )
    `);
    
    let count = 0;
    for (const p of predictions) {
      try {
        insert.run({
          id: p.id?.toString() || `pred_${count}`,
          ticker: p.ticker,
          market: p.market || 'EGX',
          signal: p.direction || p.signal || 'HOLD',
          confidence: p.confidence || 0.5,
          entry_price: p.entry_price || p.calculated_entry_price,
          target_price: p.target_price || p.calculated_target,
          stop_loss: p.stop_loss || p.calculated_stop_loss,
          reasoning: p.reasoning || p.notes,
          indicators: p.indicators_used || p.indicators,
          news_summary: p.news_summary,
          verify_date: p.verify_date || p.execution_date,
          verified: p.verified || (p.outcome ? 1 : 0),
          final_price: p.final_price || p.actual_exit_price,
          result: p.result || p.outcome,
          profit_loss_pct: p.profit_loss_pct || p.profit_percent,
          created_at: p.created_at,
        });
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} predictions`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migrateLearnedLessons(targetDb: Database, sourceDb: Database) {
  console.log('\n📚 Migrating Learned Lessons...');
  
  try {
    const lessons = sourceDb.prepare(`SELECT * FROM learned_lessons`).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO learned_lessons (
        ticker, lesson_date, lesson_type, scenario, what_worked, what_failed,
        market_conditions, indicators_involved, confidence_adjustment, notes, created_at
      ) VALUES (
        @ticker, @lesson_date, @lesson_type, @scenario, @what_worked, @what_failed,
        @market_conditions, @indicators_involved, @confidence_adjustment, @notes, @created_at
      )
    `);
    
    let count = 0;
    for (const l of lessons) {
      try {
        insert.run(l);
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} learned lessons`);
    
    // Migrate indicator weights
    const weights = sourceDb.prepare(`SELECT * FROM regime_indicator_weights`).all() as any[];
    const insertWeight = targetDb.prepare(`
      INSERT OR REPLACE INTO indicator_weights (
        regime, indicator_name, base_weight, learned_weight, win_rate, sample_count, last_updated, notes
      ) VALUES (@regime, @indicator_name, @base_weight, @learned_weight, @win_rate, @sample_count, @last_updated, @notes)
    `);
    
    for (const w of weights) {
      try {
        insertWeight.run(w);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${weights.length} indicator weights`);
    
    // Migrate indicator trust scores
    const scores = sourceDb.prepare(`SELECT * FROM indicator_trust_scores`).all() as any[];
    const insertScore = targetDb.prepare(`
      INSERT OR REPLACE INTO indicator_trust_scores (
        indicator_name, trust_score, total_signals, successful_signals, avg_profit, last_updated
      ) VALUES (@indicator_name, @trust_score, @total_signals, @successful_signals, @avg_profit, @last_updated)
    `);
    
    for (const s of scores) {
      try {
        insertScore.run(s);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${scores.length} indicator trust scores`);
    
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

// ==================== MAIN ====================

async function main() {
  console.log('🚀 Starting Database Migration...\n');
  console.log('=' .repeat(50));
  
  // فتح قواعد البيانات المصدر
  const egxDb = new Database(SOURCES.stocks, { readonly: true });
  const unifiedDb = new Database(SOURCES.unified_stocks, { readonly: true });
  const cryptoDb = new Database(SOURCES.crypto, { readonly: true });
  
  console.log('\n📦 Source databases opened:');
  console.log(`  - stocks.db: ${egxDb ? '✓' : '✗'}`);
  console.log(`  - unified_stocks.db: ${unifiedDb ? '✓' : '✗'}`);
  console.log(`  - crypto.db: ${cryptoDb ? '✓' : '✗'}`);
  
  // 1. إنشاء قاعدة الأسهم
  const stocksDb = createDatabase(TARGETS.stocks, STOCKS_SCHEMA, 'stocks.db');
  migrateEGXStocks(stocksDb, egxDb);
  migrateArabStocks(stocksDb, unifiedDb);
  migrateCrypto(stocksDb, cryptoDb);
  migrateGoldAndCurrencies(stocksDb, egxDb);
  stocksDb.close();
  
  // 2. إنشاء قاعدة الأسعار التاريخية
  const priceHistoryDb = createDatabase(TARGETS.price_history, PRICE_HISTORY_SCHEMA, 'price_history.db');
  migratePriceHistory(priceHistoryDb, egxDb);
  // نقل الأسعار من unified_stocks
  try {
    const unifiedHistory = unifiedDb.prepare(`SELECT * FROM stock_price_history`).all() as any[];
    const insert = priceHistoryDb.prepare(`
      INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume, source)
      VALUES (@ticker, @date, @open_price, @high_price, @low_price, @close_price, @volume, @source)
    `);
    for (const h of unifiedHistory) {
      try { insert.run(h); } catch (e) {}
    }
    console.log(`  ✓ Added ${unifiedHistory.length} records from unified_stocks`);
  } catch (e) {}
  priceHistoryDb.close();
  
  // 3. إنشاء قاعدة التوقعات
  const predictionsDb = createDatabase(TARGETS.predictions, PREDICTIONS_SCHEMA, 'predictions.db');
  migratePredictions(predictionsDb, egxDb);
  predictionsDb.close();
  
  // 4. إنشاء قاعدة الدروس المستفادة
  const learnedDb = createDatabase(TARGETS.learned, LEARNED_SCHEMA, 'learned.db');
  migrateLearnedLessons(learnedDb, egxDb);
  learnedDb.close();
  
  // إغلاق قواعد البيانات المصدر
  egxDb.close();
  unifiedDb.close();
  cryptoDb.close();
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Migration Complete!\n');
  
  // عرض أحجام الملفات الجديدة
  console.log('📊 New Database Sizes:');
  for (const [name, path] of Object.entries(TARGETS)) {
    if (fs.existsSync(path)) {
      const stats = fs.statSync(path);
      console.log(`  - ${name}.db: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }
}

main().catch(console.error);
/**
 * Database Migration Script
 * =========================
 * 
 * يعمل على إعادة هيكلة قواعد البيانات:
 * - stocks.db: كل الأسهم (مصرية + عربية) + العملات الرقمية
 * - price_history.db: الأسعار التاريخية
 * - predictions.db: التوقعات والتحليلات
 * - learned.db: الدروس المستفادة
 * - custom.db: المستخدمين (زي هي)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'db');

// مصادر البيانات
const SOURCES = {
  egx_investment: path.join(DB_DIR, 'egx_investment.db'),
  unified_stocks: path.join(DB_DIR, 'unified_stocks.db'),
  crypto: path.join(DB_DIR, 'crypto.db'),
  custom: path.join(DB_DIR, 'custom.db'),
};

// قواعد البيانات الجديدة
const TARGETS = {
  stocks: path.join(DB_DIR, 'stocks.db'),
  price_history: path.join(DB_DIR, 'price_history.db'),
  predictions: path.join(DB_DIR, 'predictions.db'),
  learned: path.join(DB_DIR, 'learned.db'),
};

// ==================== SCHEMAS ====================

const STOCKS_SCHEMA = `
-- جدول الأسهم الموحد
CREATE TABLE IF NOT EXISTS stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT UNIQUE NOT NULL,
  name TEXT,
  name_ar TEXT,
  market TEXT NOT NULL DEFAULT 'EGX',
  sector TEXT,
  industry TEXT,
  
  -- الأسعار
  current_price REAL,
  previous_close REAL,
  open_price REAL,
  high_price REAL,
  low_price REAL,
  change_percent REAL,
  volume INTEGER,
  market_cap REAL,
  
  -- المؤشرات
  pe_ratio REAL,
  pb_ratio REAL,
  ps_ratio REAL,
  eps REAL,
  roe REAL,
  roa REAL,
  debt_to_equity REAL,
  current_ratio REAL,
  book_value_per_share REAL,
  
  -- التحليل الفني
  ma_50 REAL,
  ma_200 REAL,
  rsi REAL,
  support_level REAL,
  resistance_level REAL,
  
  -- معلومات إضافية
  is_halal INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_egx30 INTEGER DEFAULT 0,
  is_egx70 INTEGER DEFAULT 0,
  is_egx100 INTEGER DEFAULT 0,
  
  -- العملات الرقمية
  is_crypto INTEGER DEFAULT 0,
  crypto_id TEXT,
  ath REAL,
  ath_change_percent REAL,
  atl REAL,
  atl_change_percent REAL,
  circulating_supply REAL,
  total_supply REAL,
  
  last_update TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker);
CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market);
CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector);
CREATE INDEX IF NOT EXISTS idx_stocks_is_crypto ON stocks(is_crypto);

-- جدول الذهب
CREATE TABLE IF NOT EXISTS gold_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  karat TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  price_per_gram REAL NOT NULL,
  change REAL,
  currency TEXT DEFAULT 'EGP',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- جدول العملات
CREATE TABLE IF NOT EXISTS currency_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  buy_rate REAL DEFAULT 0,
  sell_rate REAL DEFAULT 0,
  change REAL,
  is_major INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- جدول المؤشرات
CREATE TABLE IF NOT EXISTS market_indices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT UNIQUE,
  name TEXT,
  name_ar TEXT,
  current_value REAL,
  previous_close REAL,
  change REAL,
  change_percent REAL,
  is_shariah INTEGER DEFAULT 0,
  last_update TEXT
);
`;

const PRICE_HISTORY_SCHEMA = `
-- جدول الأسعار التاريخية
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  open_price REAL,
  high_price REAL,
  low_price REAL,
  close_price REAL,
  volume INTEGER,
  source TEXT DEFAULT 'system',
  created_at TEXT DEFAULT (datetime('now')),
  
  UNIQUE(ticker, date)
);

CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date);
CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date ON price_history(ticker, date);
`;

const PREDICTIONS_SCHEMA = `
-- جدول التوقعات
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  market TEXT DEFAULT 'EGX',
  signal TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  entry_price REAL,
  target_price REAL,
  stop_loss REAL,
  reasoning TEXT,
  indicators TEXT,
  news_summary TEXT,
  
  -- النتيجة
  verify_date TEXT,
  verified INTEGER DEFAULT 0,
  final_price REAL,
  result TEXT,
  profit_loss_pct REAL,
  
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_predictions_ticker ON predictions(ticker);
CREATE INDEX IF NOT EXISTS idx_predictions_created ON predictions(created_at);
CREATE INDEX IF NOT EXISTS idx_predictions_verified ON predictions(verified);
CREATE INDEX IF NOT EXISTS idx_predictions_market ON predictions(market);

-- جدول التحليلات المحفوظة
CREATE TABLE IF NOT EXISTS cached_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  analysis_type TEXT,
  analysis_data TEXT,
  score REAL,
  recommendation TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cached_analysis_ticker ON cached_analysis(ticker);

-- جدول سجلات التوقعات
CREATE TABLE IF NOT EXISTS prediction_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  signal_date TEXT NOT NULL,
  direction TEXT,
  maestro_score REAL,
  regime TEXT,
  phase_scores TEXT,
  calculated_entry_price REAL,
  calculated_stop_loss REAL,
  calculated_target REAL,
  indicators_used TEXT,
  executed INTEGER DEFAULT 0,
  execution_date TEXT,
  actual_entry_price REAL,
  actual_exit_price REAL,
  exit_reason TEXT,
  profit_percent REAL,
  outcome TEXT,
  days_open INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prediction_logs_ticker ON prediction_logs(ticker);
CREATE INDEX IF NOT EXISTS idx_prediction_logs_date ON prediction_logs(signal_date);

-- جدول توصيات الخبراء
CREATE TABLE IF NOT EXISTS expert_recommendations (
  id TEXT PRIMARY KEY,
  expert_name TEXT NOT NULL,
  stock_symbol TEXT NOT NULL,
  stock_name_ar TEXT,
  action TEXT NOT NULL,
  entry_price REAL,
  target_price REAL,
  stop_loss REAL,
  investment_target REAL,
  stop_loss_condition TEXT,
  timeframe TEXT,
  risk_level TEXT,
  notes TEXT,
  source TEXT,
  source_url TEXT,
  status TEXT DEFAULT 'PENDING',
  hit_target INTEGER DEFAULT 0,
  hit_stop_loss INTEGER DEFAULT 0,
  final_price REAL,
  profit_loss_percent REAL,
  closed_at TEXT,
  verified_at TEXT,
  recommendation_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expert_recs_expert ON expert_recommendations(expert_name);
CREATE INDEX IF NOT EXISTS idx_expert_recs_symbol ON expert_recommendations(stock_symbol);
CREATE INDEX IF NOT EXISTS idx_expert_recs_status ON expert_recommendations(status);
`;

const LEARNED_SCHEMA = `
-- جدول الدروس المستفادة
CREATE TABLE IF NOT EXISTS learned_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  lesson_date TEXT NOT NULL,
  lesson_type TEXT,
  scenario TEXT,
  what_worked TEXT,
  what_failed TEXT,
  market_conditions TEXT,
  indicators_involved TEXT,
  confidence_adjustment REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_learned_lessons_ticker ON learned_lessons(ticker);
CREATE INDEX IF NOT EXISTS idx_learned_lessons_date ON learned_lessons(lesson_date);
CREATE INDEX IF NOT EXISTS idx_learned_lessons_type ON learned_lessons(lesson_type);

-- جدول أوزان المؤشرات المتعلمة
CREATE TABLE IF NOT EXISTS indicator_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regime TEXT NOT NULL,
  indicator_name TEXT NOT NULL,
  base_weight REAL DEFAULT 1.0,
  learned_weight REAL DEFAULT 1.0,
  win_rate REAL DEFAULT 50,
  sample_count INTEGER DEFAULT 0,
  last_updated TEXT DEFAULT (datetime('now')),
  notes TEXT,
  
  UNIQUE(regime, indicator_name)
);

CREATE INDEX IF NOT EXISTS idx_indicator_weights_regime ON indicator_weights(regime);

-- جدول ثقة المؤشرات
CREATE TABLE IF NOT EXISTS indicator_trust_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator_name TEXT UNIQUE NOT NULL,
  trust_score REAL DEFAULT 50,
  total_signals INTEGER DEFAULT 0,
  successful_signals INTEGER DEFAULT 0,
  avg_profit REAL DEFAULT 0,
  last_updated TEXT DEFAULT (datetime('now'))
);

-- جدول أنماط السوق
CREATE TABLE IF NOT EXISTS market_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_name TEXT NOT NULL,
  pattern_type TEXT,
  description TEXT,
  success_rate REAL DEFAULT 0,
  occurrences INTEGER DEFAULT 0,
  avg_return REAL DEFAULT 0,
  last_seen TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_market_patterns_type ON market_patterns(pattern_type);
`;

// ==================== MIGRATION FUNCTIONS ====================

function createDatabase(dbPath: string, schema: string, name: string) {
  console.log(`\n📦 Creating ${name}...`);
  
  // حذف الملف القديم لو موجود
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log(`  ✓ Deleted old ${name}`);
  }
  
  const db = new Database(dbPath);
  db.exec(schema);
  console.log(`  ✓ Created schema for ${name}`);
  
  return db;
}

function migrateEGXStocks(targetDb: Database, sourceDb: Database) {
  console.log('\n📊 Migrating EGX stocks...');
  
  try {
    const stocks = sourceDb.prepare(`
      SELECT 
        ticker, name, name_ar, current_price, previous_close, open_price,
        high_price, low_price, change_percent, volume, market_cap,
        pe_ratio, pb_ratio, ps_ratio, eps, roe, roa, debt_to_equity,
        current_ratio, book_value_per_share, ma_50, ma_200, rsi,
        support_level, resistance_level, is_halal, is_active,
        is_egx30, is_egx70, is_egx100, sector, industry, last_update
      FROM stocks
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO stocks (
        ticker, name, name_ar, market, current_price, previous_close, open_price,
        high_price, low_price, change_percent, volume, market_cap,
        pe_ratio, pb_ratio, ps_ratio, eps, roe, roa, debt_to_equity,
        current_ratio, book_value_per_share, ma_50, ma_200, rsi,
        support_level, resistance_level, is_halal, is_active,
        is_egx30, is_egx70, is_egx100, sector, industry, last_update, is_crypto
      ) VALUES (
        @ticker, @name, @name_ar, 'EGX', @current_price, @previous_close, @open_price,
        @high_price, @low_price, @change_percent, @volume, @market_cap,
        @pe_ratio, @pb_ratio, @ps_ratio, @eps, @roe, @roa, @debt_to_equity,
        @current_ratio, @book_value_per_share, @ma_50, @ma_200, @rsi,
        @support_level, @resistance_level, @is_halal, @is_active,
        @is_egx30, @is_egx70, @is_egx100, @sector, @industry, @last_update, 0
      )
    `);
    
    let count = 0;
    for (const stock of stocks) {
      try {
        insert.run(stock);
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} EGX stocks`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migrateArabStocks(targetDb: Database, sourceDb: Database) {
  console.log('\n🌍 Migrating Arab stocks...');
  
  try {
    const stocks = sourceDb.prepare(`
      SELECT 
        ticker, name, name_ar, market, current_price, previous_close, open_price,
        high_price, low_price, change_percent, volume, market_cap,
        pe_ratio, pb_ratio, sector, industry, is_active, last_update
      FROM stocks
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO stocks (
        ticker, name, name_ar, market, current_price, previous_close, open_price,
        high_price, low_price, change_percent, volume, market_cap,
        pe_ratio, pb_ratio, sector, industry, is_active, last_update, is_crypto
      ) VALUES (
        @ticker, @name, @name_ar, @market, @current_price, @previous_close, @open_price,
        @high_price, @low_price, @change_percent, @volume, @market_cap,
        @pe_ratio, @pb_ratio, @sector, @industry, @is_active, @last_update, 0
      )
    `);
    
    let count = 0;
    for (const stock of stocks) {
      try {
        insert.run({ ...stock, is_crypto: 0 });
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} Arab stocks`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migrateCrypto(targetDb: Database, sourceDb: Database) {
  console.log('\n💰 Migrating Crypto...');
  
  try {
    const coins = sourceDb.prepare(`
      SELECT * FROM crypto_coins
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO stocks (
        ticker, name, market, is_crypto, crypto_id, current_price, 
        change_percent, market_cap, volume, ath, ath_change_percent, atl, atl_change_percent,
        circulating_supply, total_supply
      ) VALUES (
        @ticker, @name, 'CRYPTO', 1, @crypto_id, @current_price,
        @change_percent, @market_cap, @volume, @ath, @ath_change_percent, @atl, @atl_change_percent,
        @circulating_supply, @total_supply
      )
    `);
    
    let count = 0;
    for (const coin of coins) {
      try {
        insert.run({
          ticker: (coin.symbol || coin.coin_id || '').toUpperCase(),
          name: coin.name,
          crypto_id: coin.coin_id || coin.id,
          current_price: coin.current_price || coin.price,
          change_percent: coin.change_24h || coin.price_change_percentage_24h,
          market_cap: coin.market_cap,
          volume: coin.volume_24h || coin.total_volume,
          ath: coin.ath,
          ath_change_percent: coin.ath_change_percentage,
          atl: coin.atl,
          atl_change_percent: coin.atl_change_percentage,
          circulating_supply: coin.circulating_supply,
          total_supply: coin.total_supply,
        });
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} crypto coins`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migrateGoldAndCurrencies(targetDb: Database, sourceDb: Database) {
  console.log('\n📈 Migrating Gold and Currencies...');
  
  try {
    // Gold
    const gold = sourceDb.prepare(`SELECT * FROM gold_prices`).all() as any[];
    const insertGold = targetDb.prepare(`
      INSERT OR REPLACE INTO gold_prices (karat, name_ar, price_per_gram, change, currency, updated_at)
      VALUES (@karat, @name_ar, @price_per_gram, @change, @currency, @updated_at)
    `);
    
    for (const g of gold) {
      try {
        insertGold.run(g);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${gold.length} gold prices`);
    
    // Currencies
    const currencies = sourceDb.prepare(`SELECT * FROM currency_rates`).all() as any[];
    const insertCurrency = targetDb.prepare(`
      INSERT OR REPLACE INTO currency_rates (code, name_ar, buy_rate, sell_rate, change, is_major, updated_at)
      VALUES (@code, @name_ar, @buy_rate, @sell_rate, @change, @is_major, @updated_at)
    `);
    
    for (const c of currencies) {
      try {
        insertCurrency.run(c);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${currencies.length} currency rates`);
    
    // Market Indices
    const indices = sourceDb.prepare(`SELECT * FROM market_indices`).all() as any[];
    const insertIndex = targetDb.prepare(`
      INSERT OR REPLACE INTO market_indices (symbol, name, name_ar, current_value, previous_close, change, change_percent, is_shariah, last_update)
      VALUES (@symbol, @name, @name_ar, @current_value, @previous_close, @change, @change_percent, @is_shariah, @last_update)
    `);
    
    for (const i of indices) {
      try {
        insertIndex.run(i);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${indices.length} market indices`);
    
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
  }
}

function migratePriceHistory(targetDb: Database, sourceDb: Database) {
  console.log('\n📅 Migrating Price History...');
  
  try {
    const history = sourceDb.prepare(`
      SELECT ticker, date, open_price, high_price, low_price, close_price, volume, source
      FROM stock_price_history
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume, source)
      VALUES (@ticker, @date, @open_price, @high_price, @low_price, @close_price, @volume, @source)
    `);
    
    const batchSize = 1000;
    let count = 0;
    
    targetDb.exec('BEGIN TRANSACTION');
    for (const row of history) {
      try {
        insert.run(row);
        count++;
        if (count % batchSize === 0) {
          console.log(`  → Migrated ${count}/${history.length} records...`);
        }
      } catch (e) {
        // skip duplicates
      }
    }
    targetDb.exec('COMMIT');
    
    console.log(`  ✓ Migrated ${count} price history records`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migratePredictions(targetDb: Database, sourceDb: Database) {
  console.log('\n🎯 Migrating Predictions...');
  
  try {
    const predictions = sourceDb.prepare(`
      SELECT * FROM prediction_logs
    `).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO predictions (
        id, ticker, market, signal, confidence, entry_price, target_price, stop_loss,
        reasoning, indicators, news_summary, verify_date, verified, final_price, result, profit_loss_pct, created_at
      ) VALUES (
        @id, @ticker, @market, @signal, @confidence, @entry_price, @target_price, @stop_loss,
        @reasoning, @indicators, @news_summary, @verify_date, @verified, @final_price, @result, @profit_loss_pct, @created_at
      )
    `);
    
    let count = 0;
    for (const p of predictions) {
      try {
        insert.run({
          id: p.id?.toString() || `pred_${count}`,
          ticker: p.ticker,
          market: p.market || 'EGX',
          signal: p.direction || p.signal || 'HOLD',
          confidence: p.confidence || 0.5,
          entry_price: p.entry_price || p.calculated_entry_price,
          target_price: p.target_price || p.calculated_target,
          stop_loss: p.stop_loss || p.calculated_stop_loss,
          reasoning: p.reasoning || p.notes,
          indicators: p.indicators_used || p.indicators,
          news_summary: p.news_summary,
          verify_date: p.verify_date || p.execution_date,
          verified: p.verified || (p.outcome ? 1 : 0),
          final_price: p.final_price || p.actual_exit_price,
          result: p.result || p.outcome,
          profit_loss_pct: p.profit_loss_pct || p.profit_percent,
          created_at: p.created_at,
        });
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} predictions`);
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

function migrateLearnedLessons(targetDb: Database, sourceDb: Database) {
  console.log('\n📚 Migrating Learned Lessons...');
  
  try {
    const lessons = sourceDb.prepare(`SELECT * FROM learned_lessons`).all() as any[];
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO learned_lessons (
        ticker, lesson_date, lesson_type, scenario, what_worked, what_failed,
        market_conditions, indicators_involved, confidence_adjustment, notes, created_at
      ) VALUES (
        @ticker, @lesson_date, @lesson_type, @scenario, @what_worked, @what_failed,
        @market_conditions, @indicators_involved, @confidence_adjustment, @notes, @created_at
      )
    `);
    
    let count = 0;
    for (const l of lessons) {
      try {
        insert.run(l);
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    
    console.log(`  ✓ Migrated ${count} learned lessons`);
    
    // Migrate indicator weights
    const weights = sourceDb.prepare(`SELECT * FROM regime_indicator_weights`).all() as any[];
    const insertWeight = targetDb.prepare(`
      INSERT OR REPLACE INTO indicator_weights (
        regime, indicator_name, base_weight, learned_weight, win_rate, sample_count, last_updated, notes
      ) VALUES (@regime, @indicator_name, @base_weight, @learned_weight, @win_rate, @sample_count, @last_updated, @notes)
    `);
    
    for (const w of weights) {
      try {
        insertWeight.run(w);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${weights.length} indicator weights`);
    
    // Migrate indicator trust scores
    const scores = sourceDb.prepare(`SELECT * FROM indicator_trust_scores`).all() as any[];
    const insertScore = targetDb.prepare(`
      INSERT OR REPLACE INTO indicator_trust_scores (
        indicator_name, trust_score, total_signals, successful_signals, avg_profit, last_updated
      ) VALUES (@indicator_name, @trust_score, @total_signals, @successful_signals, @avg_profit, @last_updated)
    `);
    
    for (const s of scores) {
      try {
        insertScore.run(s);
      } catch (e) {}
    }
    console.log(`  ✓ Migrated ${scores.length} indicator trust scores`);
    
    return count;
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return 0;
  }
}

// ==================== MAIN ====================

async function main() {
  console.log('🚀 Starting Database Migration...\n');
  console.log('=' .repeat(50));
  
  // فتح قواعد البيانات المصدر
  const egxDb = new Database(SOURCES.egx_investment, { readonly: true });
  const unifiedDb = new Database(SOURCES.unified_stocks, { readonly: true });
  const cryptoDb = new Database(SOURCES.crypto, { readonly: true });
  
  console.log('\n📦 Source databases opened:');
  console.log(`  - egx_investment.db: ${egxDb ? '✓' : '✗'}`);
  console.log(`  - unified_stocks.db: ${unifiedDb ? '✓' : '✗'}`);
  console.log(`  - crypto.db: ${cryptoDb ? '✓' : '✗'}`);
  
  // 1. إنشاء قاعدة الأسهم
  const stocksDb = createDatabase(TARGETS.stocks, STOCKS_SCHEMA, 'stocks.db');
  migrateEGXStocks(stocksDb, egxDb);
  migrateArabStocks(stocksDb, unifiedDb);
  migrateCrypto(stocksDb, cryptoDb);
  migrateGoldAndCurrencies(stocksDb, egxDb);
  stocksDb.close();
  
  // 2. إنشاء قاعدة الأسعار التاريخية
  const priceHistoryDb = createDatabase(TARGETS.price_history, PRICE_HISTORY_SCHEMA, 'price_history.db');
  migratePriceHistory(priceHistoryDb, egxDb);
  // نقل الأسعار من unified_stocks
  try {
    const unifiedHistory = unifiedDb.prepare(`SELECT * FROM stock_price_history`).all() as any[];
    const insert = priceHistoryDb.prepare(`
      INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume, source)
      VALUES (@ticker, @date, @open_price, @high_price, @low_price, @close_price, @volume, @source)
    `);
    for (const h of unifiedHistory) {
      try { insert.run(h); } catch (e) {}
    }
    console.log(`  ✓ Added ${unifiedHistory.length} records from unified_stocks`);
  } catch (e) {}
  priceHistoryDb.close();
  
  // 3. إنشاء قاعدة التوقعات
  const predictionsDb = createDatabase(TARGETS.predictions, PREDICTIONS_SCHEMA, 'predictions.db');
  migratePredictions(predictionsDb, egxDb);
  predictionsDb.close();
  
  // 4. إنشاء قاعدة الدروس المستفادة
  const learnedDb = createDatabase(TARGETS.learned, LEARNED_SCHEMA, 'learned.db');
  migrateLearnedLessons(learnedDb, egxDb);
  learnedDb.close();
  
  // إغلاق قواعد البيانات المصدر
  egxDb.close();
  unifiedDb.close();
  cryptoDb.close();
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Migration Complete!\n');
  
  // عرض أحجام الملفات الجديدة
  console.log('📊 New Database Sizes:');
  for (const [name, path] of Object.entries(TARGETS)) {
    if (fs.existsSync(path)) {
      const stats = fs.statSync(path);
      console.log(`  - ${name}.db: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }
}

main().catch(console.error);

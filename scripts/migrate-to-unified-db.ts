/**
 * Migration Script: Unified Stocks Database
 * 
 * This script:
 * 1. Creates a new unified_stocks.db with proper schema
 * 2. Migrates EGX stocks from stocks.db
 * 3. Migrates Arab stocks from basic.db (KSA, UAE, Kuwait, Qatar, Bahrain)
 * 4. Migrates Crypto from JSON cache
 * 5. Creates crypto.db for cryptocurrency data
 */

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = '/home/z/my-project/db';
const UPLOAD_DIR = '/home/z/my-project/upload';

// Source databases
const EGX_DB_PATH = path.join(DB_DIR, 'stocks.db');
const BASIC_DB_PATH = path.join(UPLOAD_DIR, 'basic.db');
const CRYPTO_CACHE_PATH = '/home/z/my-project/vps-service/data/crypto_cache.json';

// Target databases
const UNIFIED_STOCKS_DB_PATH = path.join(DB_DIR, 'unified_stocks.db');
const CRYPTO_DB_PATH = path.join(DB_DIR, 'crypto.db');

// Backup flag
const BACKUP = true;

console.log('========================================');
console.log('Unified Stocks Migration Script');
console.log('========================================\n');

// ============================================================================
// STEP 1: Create Unified Stocks Database
// ============================================================================
console.log('STEP 1: Creating unified_stocks.db...');

// Delete existing if needed
if (fs.existsSync(UNIFIED_STOCKS_DB_PATH)) {
  if (BACKUP) {
    const backupPath = `${UNIFIED_STOCKS_DB_PATH}.backup_${Date.now()}`;
    fs.copyFileSync(UNIFIED_STOCKS_DB_PATH, backupPath);
    console.log(`  Backed up existing DB to ${backupPath}`);
  }
  fs.unlinkSync(UNIFIED_STOCKS_DB_PATH);
}

const stocksDb = new Database(UNIFIED_STOCKS_DB_PATH);
stocksDb.run('PRAGMA journal_mode = WAL');
stocksDb.run('PRAGMA foreign_keys = ON');

// Create unified stocks table
stocksDb.run(`
  CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255),
    name_ar VARCHAR(255),
    
    -- Market info
    exchange VARCHAR(20) NOT NULL DEFAULT 'EGX',
    country VARCHAR(50),
    sector VARCHAR(100),
    industry VARCHAR(100),
    isin VARCHAR(50),
    
    -- Prices
    current_price REAL,
    previous_close REAL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    volume INTEGER,
    market_cap REAL,
    
    -- Fundamentals
    pe_ratio REAL,
    pb_ratio REAL,
    ps_ratio REAL,
    ev_to_ebitda REAL,
    dividend_yield REAL,
    eps REAL,
    roe REAL,
    roa REAL,
    debt_to_equity REAL,
    current_ratio REAL,
    book_value_per_share REAL,
    shares_outstanding REAL,
    beta REAL,
    
    -- Technical
    rsi REAL,
    ma_50 REAL,
    ma_200 REAL,
    support_level REAL,
    resistance_level REAL,
    
    -- Additional
    is_halal INTEGER DEFAULT 0,
    compliance_status TEXT DEFAULT 'unknown',
    compliance_note TEXT,
    compliance_last_reviewed DATETIME,
    
    -- Index membership (EGX specific)
    egx30_member INTEGER DEFAULT 0,
    egx70_member INTEGER DEFAULT 0,
    egx100_member INTEGER DEFAULT 0,
    
    -- Status
    is_active INTEGER DEFAULT 1,
    icon_url VARCHAR(255),
    
    -- Timestamps
    last_update DATETIME,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    
    -- Legacy fields
    price_change REAL,
    change_percent REAL,
    personality TEXT
  )
`);

// Create indexes
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON stocks(exchange)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_country ON stocks(country)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_active ON stocks(is_active)');

console.log('  Created stocks table with indexes');

// ============================================================================
// STEP 2: Migrate EGX Stocks
// ============================================================================
console.log('\nSTEP 2: Migrating EGX stocks...');

const egxDb = new Database(EGX_DB_PATH, { readonly: true });

const egxStocks = egxDb.query(`
  SELECT 
    ticker, name, name_ar, current_price, previous_close, open_price, high_price, low_price,
    volume, market_cap, pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, dividend_yield, eps,
    roe, roa, debt_to_equity, current_ratio, book_value_per_share, shares_outstanding,
    support_level, resistance_level, ma_50, ma_200, rsi, sector, industry, is_halal,
    compliance_status, compliance_note, compliance_last_reviewed, egx30_member, egx70_member,
    egx100_member, is_active, last_update, created_at, price_change, change_percent,
    personality, beta
  FROM stocks
`).all() as Record<string, unknown>[];

console.log(`  Found ${egxStocks.length} EGX stocks`);

const insertStock = stocksDb.prepare(`
  INSERT OR REPLACE INTO stocks (
    ticker, name, name_ar, exchange, country, current_price, previous_close, open_price,
    high_price, low_price, volume, market_cap, pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda,
    dividend_yield, eps, roe, roa, debt_to_equity, current_ratio, book_value_per_share,
    shares_outstanding, support_level, resistance_level, ma_50, ma_200, rsi, sector,
    industry, is_halal, compliance_status, compliance_note, compliance_last_reviewed,
    egx30_member, egx70_member, egx100_member, is_active, last_update, created_at,
    price_change, change_percent, personality, beta
  ) VALUES (
    ?, ?, ?, 'EGX', 'مصر', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

let egxCount = 0;
for (const stock of egxStocks) {
  try {
    insertStock.run(
      stock.ticker, stock.name, stock.name_ar, stock.current_price, stock.previous_close,
      stock.open_price, stock.high_price, stock.low_price, stock.volume, stock.market_cap,
      stock.pe_ratio, stock.pb_ratio, stock.ps_ratio, stock.ev_to_ebitda, stock.dividend_yield,
      stock.eps, stock.roe, stock.roa, stock.debt_to_equity, stock.current_ratio,
      stock.book_value_per_share, stock.shares_outstanding, stock.support_level,
      stock.resistance_level, stock.ma_50, stock.ma_200, stock.rsi, stock.sector,
      stock.industry, stock.is_halal, stock.compliance_status, stock.compliance_note,
      stock.compliance_last_reviewed, stock.egx30_member, stock.egx70_member,
      stock.egx100_member, stock.is_active, stock.last_update, stock.created_at,
      stock.price_change, stock.change_percent, stock.personality, stock.beta
    );
    egxCount++;
  } catch (e) {
    console.log(`  Error inserting ${stock.ticker}: ${e}`);
  }
}

console.log(`  Migrated ${egxCount} EGX stocks`);
egxDb.close();

// ============================================================================
// STEP 3: Migrate Arab Stocks from basic.db
// ============================================================================
console.log('\nSTEP 3: Migrating Arab stocks from basic.db...');

const basicDb = new Database(BASIC_DB_PATH, { readonly: true });

// Get Arab stocks (non-EGX)
const arabStocks = basicDb.query(`
  SELECT 
    ticker, name, name_ar, current_price, previous_close, open_price, high_price, low_price,
    volume, market_cap, pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, dividend_yield, eps,
    roe, roa, debt_to_equity, current_ratio, book_value_per_share, shares_outstanding,
    support_level, resistance_level, ma_50, ma_200, rsi, sector, industry, is_halal,
    compliance_status, compliance_note, compliance_last_reviewed, is_active, last_update,
    created_at, price_change, change_percent, country, exchange_code, icon_url
  FROM stocks
  WHERE exchange_code != 'EGX' OR exchange_code IS NULL
`).all() as Record<string, unknown>[];

console.log(`  Found ${arabStocks.length} Arab stocks`);

// Map exchange codes to country names
const exchangeToCountry: Record<string, string> = {
  'KSA': 'السعودية',
  'DFM': 'الإمارات',
  'KSE': 'الكويت',
  'QSE': 'قطر',
  'BSE': 'البحرين',
  'EGX': 'مصر'
};

const insertArabStock = stocksDb.prepare(`
  INSERT OR REPLACE INTO stocks (
    ticker, name, name_ar, exchange, country, current_price, previous_close, open_price,
    high_price, low_price, volume, market_cap, pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda,
    dividend_yield, eps, roe, roa, debt_to_equity, current_ratio, book_value_per_share,
    shares_outstanding, support_level, resistance_level, ma_50, ma_200, rsi, sector,
    industry, is_halal, compliance_status, compliance_note, compliance_last_reviewed,
    is_active, last_update, created_at, price_change, change_percent, icon_url
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

let arabCount = 0;
const exchangeStats: Record<string, number> = {};

for (const stock of arabStocks) {
  const exchange = (stock.exchange_code as string) || 'UNKNOWN';
  const country = exchangeToCountry[exchange] || (stock.country as string) || 'غير محدد';
  
  try {
    insertArabStock.run(
      stock.ticker, stock.name, stock.name_ar, exchange, country, stock.current_price,
      stock.previous_close, stock.open_price, stock.high_price, stock.low_price,
      stock.volume, stock.market_cap, stock.pe_ratio, stock.pb_ratio, stock.ps_ratio,
      stock.ev_to_ebitda, stock.dividend_yield, stock.eps, stock.roe, stock.roa,
      stock.debt_to_equity, stock.current_ratio, stock.book_value_per_share,
      stock.shares_outstanding, stock.support_level, stock.resistance_level,
      stock.ma_50, stock.ma_200, stock.rsi, stock.sector, stock.industry,
      stock.is_halal, stock.compliance_status, stock.compliance_note,
      stock.compliance_last_reviewed, stock.is_active, stock.last_update,
      stock.created_at, stock.price_change, stock.change_percent, stock.icon_url
    );
    arabCount++;
    exchangeStats[exchange] = (exchangeStats[exchange] || 0) + 1;
  } catch (e) {
    console.log(`  Error inserting ${stock.ticker}: ${e}`);
  }
}

console.log(`  Migrated ${arabCount} Arab stocks`);
console.log('  Breakdown by exchange:');
for (const [exchange, count] of Object.entries(exchangeStats)) {
  console.log(`    ${exchange}: ${count}`);
}

basicDb.close();

// ============================================================================
// STEP 4: Create stock_price_history table and migrate data
// ============================================================================
console.log('\nSTEP 4: Migrating price history...');

stocksDb.run(`
  CREATE TABLE IF NOT EXISTS stock_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    ticker VARCHAR(20) NOT NULL,
    date TEXT NOT NULL,
    open_price REAL DEFAULT 0,
    high_price REAL DEFAULT 0,
    low_price REAL DEFAULT 0,
    close_price REAL DEFAULT 0,
    volume INTEGER DEFAULT 0,
    adjusted_close REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(ticker, date)
  )
`);
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON stock_price_history(ticker)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_price_history_date ON stock_price_history(date)');

// Migrate price history from EGX
const egxDb2 = new Database(EGX_DB_PATH, { readonly: true });

const priceHistory = egxDb2.query(`
  SELECT sph.*, s.ticker 
  FROM stock_price_history sph
  JOIN stocks s ON s.id = sph.stock_id
  LIMIT 50000
`).all() as Record<string, unknown>[];

console.log(`  Found ${priceHistory.length} price history records (limited to 50k for initial migration)`);

const insertPriceHistory = stocksDb.prepare(`
  INSERT OR IGNORE INTO stock_price_history (stock_id, ticker, date, open_price, high_price, low_price, close_price, volume, adjusted_close, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let historyCount = 0;
for (const record of priceHistory) {
  try {
    insertPriceHistory.run(
      record.stock_id, record.ticker, record.date, record.open_price, record.high_price,
      record.low_price, record.close_price, record.volume, record.adjusted_close, record.created_at
    );
    historyCount++;
  } catch (e) {
    // Ignore duplicates
  }
}

console.log(`  Migrated ${historyCount} price history records`);
egxDb2.close();

// ============================================================================
// STEP 5: Create Crypto Database
// ============================================================================
console.log('\nSTEP 5: Creating crypto.db...');

if (fs.existsSync(CRYPTO_DB_PATH)) {
  if (BACKUP) {
    const backupPath = `${CRYPTO_DB_PATH}.backup_${Date.now()}`;
    fs.copyFileSync(CRYPTO_DB_PATH, backupPath);
    console.log(`  Backed up existing DB to ${backupPath}`);
  }
  fs.unlinkSync(CRYPTO_DB_PATH);
}

const cryptoDb = new Database(CRYPTO_DB_PATH);
cryptoDb.run('PRAGMA journal_mode = WAL');
cryptoDb.run('PRAGMA foreign_keys = ON');

// Create crypto_coins table
cryptoDb.run(`
  CREATE TABLE IF NOT EXISTS crypto_coins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coin_id VARCHAR(50) NOT NULL UNIQUE,
    symbol VARCHAR(20) NOT NULL,
    name VARCHAR(100),
    name_ar VARCHAR(100),
    
    -- Prices
    current_price REAL,
    price_change_24h REAL,
    price_change_percent_24h REAL,
    high_24h REAL,
    low_24h REAL,
    
    -- Market data
    market_cap REAL,
    market_cap_rank INTEGER,
    total_volume REAL,
    circulating_supply REAL,
    total_supply REAL,
    max_supply REAL,
    
    -- All time high/low
    ath REAL,
    ath_change_percent REAL,
    ath_date TEXT,
    atl REAL,
    atl_change_percent REAL,
    atl_date TEXT,
    
    -- Image
    image_url VARCHAR(255),
    
    -- Analysis
    signal VARCHAR(20),
    confidence REAL,
    
    -- Timestamps
    last_update DATETIME,
    created_at DATETIME DEFAULT (datetime('now'))
  )
`);

// Create price history table
cryptoDb.run(`
  CREATE TABLE IF NOT EXISTS crypto_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coin_id VARCHAR(50) NOT NULL,
    date TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume REAL,
    created_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(coin_id, date)
  )
`);

// Create indexes
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_coin_id ON crypto_coins(coin_id)');
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_symbol ON crypto_coins(symbol)');
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_rank ON crypto_coins(market_cap_rank)');
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_history_coin ON crypto_price_history(coin_id)');
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_history_date ON crypto_price_history(date)');

console.log('  Created crypto tables with indexes');

// Migrate crypto from JSON
console.log('\n  Migrating crypto from JSON cache...');

if (fs.existsSync(CRYPTO_CACHE_PATH)) {
  const cryptoCache = JSON.parse(fs.readFileSync(CRYPTO_CACHE_PATH, 'utf-8'));
  const cacheKeys = Object.keys(cryptoCache);
  
  for (const key of cacheKeys) {
    const data = cryptoCache[key];
    if (data && data.data && Array.isArray(data.data)) {
      const coins = data.data;
      console.log(`  Found ${coins.length} coins in cache`);
      
      const insertCoin = cryptoDb.prepare(`
        INSERT OR REPLACE INTO crypto_coins (
          coin_id, symbol, name, current_price, price_change_24h, price_change_percent_24h,
          high_24h, low_24h, market_cap, market_cap_rank, total_volume, circulating_supply,
          total_supply, max_supply, ath, ath_change_percent, ath_date, atl, atl_change_percent,
          atl_date, image_url, last_update
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);
      
      let coinCount = 0;
      for (const coin of coins) {
        try {
          insertCoin.run(
            coin.id, coin.symbol, coin.name, coin.current_price, coin.price_change_24h,
            coin.price_change_percentage_24h, coin.high_24h, coin.low_24h, coin.market_cap,
            coin.market_cap_rank, coin.total_volume, coin.circulating_supply, coin.total_supply,
            coin.max_supply, coin.ath, coin.ath_change_percentage, coin.ath_date,
            coin.atl, coin.atl_change_percentage, coin.atl_date, coin.image, coin.last_updated
          );
          coinCount++;
        } catch (e) {
          console.log(`    Error inserting ${coin.id}: ${e}`);
        }
      }
      console.log(`  Migrated ${coinCount} crypto coins`);
    }
  }
} else {
  console.log('  Crypto cache not found, skipping crypto migration');
}

// ============================================================================
// STEP 6: Create market data tables in unified_stocks.db
// ============================================================================
console.log('\nSTEP 6: Creating market data tables...');

// Market indices
stocksDb.run(`
  CREATE TABLE IF NOT EXISTS market_indices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol VARCHAR(20) UNIQUE,
    name VARCHAR(100),
    name_ar VARCHAR(100),
    current_value REAL,
    previous_close REAL,
    change REAL,
    change_percent REAL,
    is_shariah INTEGER DEFAULT 0,
    last_update DATETIME,
    created_at DATETIME DEFAULT (datetime('now'))
  )
`);

// Currency rates
stocksDb.run(`
  CREATE TABLE IF NOT EXISTS currency_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(10) UNIQUE,
    name_ar VARCHAR(100),
    buy_rate REAL DEFAULT 0,
    sell_rate REAL DEFAULT 0,
    change REAL,
    is_major INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now')),
    updated_by VARCHAR(50) DEFAULT 'system'
  )
`);

// Gold prices
stocksDb.run(`
  CREATE TABLE IF NOT EXISTS gold_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    karat VARCHAR(10) UNIQUE,
    name_ar VARCHAR(100),
    price_per_gram REAL NOT NULL,
    change REAL,
    currency VARCHAR(10) DEFAULT 'EGP',
    updated_at DATETIME DEFAULT (datetime('now')),
    updated_by VARCHAR(50) DEFAULT 'system'
  )
`);

// Migrate market data from EGX db
const egxDb3 = new Database(EGX_DB_PATH, { readonly: true });

// Market indices
const indices = egxDb3.query('SELECT * FROM market_indices').all() as Record<string, unknown>[];
console.log(`  Migrating ${indices.length} market indices...`);

const insertIndex = stocksDb.prepare(`
  INSERT OR REPLACE INTO market_indices (symbol, name, name_ar, current_value, previous_close, change, change_percent, is_shariah, last_update)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const idx of indices) {
  try {
    insertIndex.run(
      idx.symbol, idx.name, idx.name_ar, idx.current_value, idx.previous_close,
      idx.change, idx.change_percent, idx.is_shariah, idx.last_update
    );
  } catch (e) {}
}

// Currency rates
const currencies = egxDb3.query('SELECT * FROM currency_rates').all() as Record<string, unknown>[];
console.log(`  Migrating ${currencies.length} currency rates...`);

const insertCurrency = stocksDb.prepare(`
  INSERT OR REPLACE INTO currency_rates (code, name_ar, buy_rate, sell_rate, change, is_major, updated_at, updated_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const curr of currencies) {
  try {
    insertCurrency.run(
      curr.code, curr.name_ar, curr.buy_rate, curr.sell_rate, curr.change, curr.is_major, curr.updated_at, curr.updated_by
    );
  } catch (e) {}
}

// Gold prices
const gold = egxDb3.query('SELECT * FROM gold_prices').all() as Record<string, unknown>[];
console.log(`  Migrating ${gold.length} gold prices...`);

const insertGold = stocksDb.prepare(`
  INSERT OR REPLACE INTO gold_prices (karat, name_ar, price_per_gram, change, currency, updated_at, updated_by)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

for (const g of gold) {
  try {
    insertGold.run(
      g.karat, g.name_ar, g.price_per_gram, g.change, g.currency, g.updated_at, g.updated_by
    );
  } catch (e) {}
}

egxDb3.close();

// ============================================================================
// STEP 7: Final Statistics
// ============================================================================
console.log('\n========================================');
console.log('Migration Complete!');
console.log('========================================');

// Final counts
const finalStockCount = stocksDb.query('SELECT COUNT(*) as count FROM stocks').get() as { count: number };
const finalHistoryCount = stocksDb.query('SELECT COUNT(*) as count FROM stock_price_history').get() as { count: number };
const exchangeBreakdown = stocksDb.query('SELECT exchange, COUNT(*) as count FROM stocks GROUP BY exchange ORDER BY count DESC').all() as { exchange: string, count: number }[];

const finalCryptoCount = cryptoDb.query('SELECT COUNT(*) as count FROM crypto_coins').get() as { count: number };

console.log('\nUnified Stocks Database Statistics:');
console.log(`  Total stocks: ${finalStockCount.count}`);
console.log(`  Price history records: ${finalHistoryCount.count}`);
console.log('\n  Breakdown by exchange:');
for (const ex of exchangeBreakdown) {
  console.log(`    ${ex.exchange}: ${ex.count}`);
}

console.log('\nCrypto Database Statistics:');
console.log(`  Total coins: ${finalCryptoCount.count}`);

// Close databases
stocksDb.close();
cryptoDb.close();

console.log('\n✅ Migration completed successfully!');
console.log(`\nNew databases created:`);
console.log(`  - ${UNIFIED_STOCKS_DB_PATH}`);
console.log(`  - ${CRYPTO_DB_PATH}`);
/**
 * Migration Script: Unified Stocks Database
 * 
 * This script:
 * 1. Creates a new unified_stocks.db with proper schema
 * 2. Migrates EGX stocks from egx_investment.db
 * 3. Migrates Arab stocks from basic.db (KSA, UAE, Kuwait, Qatar, Bahrain)
 * 4. Migrates Crypto from JSON cache
 * 5. Creates crypto.db for cryptocurrency data
 */

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = '/home/z/my-project/db';
const UPLOAD_DIR = '/home/z/my-project/upload';

// Source databases
const EGX_DB_PATH = path.join(DB_DIR, 'egx_investment.db');
const BASIC_DB_PATH = path.join(UPLOAD_DIR, 'basic.db');
const CRYPTO_CACHE_PATH = '/home/z/my-project/vps-service/data/crypto_cache.json';

// Target databases
const UNIFIED_STOCKS_DB_PATH = path.join(DB_DIR, 'unified_stocks.db');
const CRYPTO_DB_PATH = path.join(DB_DIR, 'crypto.db');

// Backup flag
const BACKUP = true;

console.log('========================================');
console.log('Unified Stocks Migration Script');
console.log('========================================\n');

// ============================================================================
// STEP 1: Create Unified Stocks Database
// ============================================================================
console.log('STEP 1: Creating unified_stocks.db...');

// Delete existing if needed
if (fs.existsSync(UNIFIED_STOCKS_DB_PATH)) {
  if (BACKUP) {
    const backupPath = `${UNIFIED_STOCKS_DB_PATH}.backup_${Date.now()}`;
    fs.copyFileSync(UNIFIED_STOCKS_DB_PATH, backupPath);
    console.log(`  Backed up existing DB to ${backupPath}`);
  }
  fs.unlinkSync(UNIFIED_STOCKS_DB_PATH);
}

const stocksDb = new Database(UNIFIED_STOCKS_DB_PATH);
stocksDb.run('PRAGMA journal_mode = WAL');
stocksDb.run('PRAGMA foreign_keys = ON');

// Create unified stocks table
stocksDb.run(`
  CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255),
    name_ar VARCHAR(255),
    
    -- Market info
    exchange VARCHAR(20) NOT NULL DEFAULT 'EGX',
    country VARCHAR(50),
    sector VARCHAR(100),
    industry VARCHAR(100),
    isin VARCHAR(50),
    
    -- Prices
    current_price REAL,
    previous_close REAL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    volume INTEGER,
    market_cap REAL,
    
    -- Fundamentals
    pe_ratio REAL,
    pb_ratio REAL,
    ps_ratio REAL,
    ev_to_ebitda REAL,
    dividend_yield REAL,
    eps REAL,
    roe REAL,
    roa REAL,
    debt_to_equity REAL,
    current_ratio REAL,
    book_value_per_share REAL,
    shares_outstanding REAL,
    beta REAL,
    
    -- Technical
    rsi REAL,
    ma_50 REAL,
    ma_200 REAL,
    support_level REAL,
    resistance_level REAL,
    
    -- Additional
    is_halal INTEGER DEFAULT 0,
    compliance_status TEXT DEFAULT 'unknown',
    compliance_note TEXT,
    compliance_last_reviewed DATETIME,
    
    -- Index membership (EGX specific)
    egx30_member INTEGER DEFAULT 0,
    egx70_member INTEGER DEFAULT 0,
    egx100_member INTEGER DEFAULT 0,
    
    -- Status
    is_active INTEGER DEFAULT 1,
    icon_url VARCHAR(255),
    
    -- Timestamps
    last_update DATETIME,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    
    -- Legacy fields
    price_change REAL,
    change_percent REAL,
    personality TEXT
  )
`);

// Create indexes
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON stocks(exchange)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_country ON stocks(country)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_stocks_active ON stocks(is_active)');

console.log('  Created stocks table with indexes');

// ============================================================================
// STEP 2: Migrate EGX Stocks
// ============================================================================
console.log('\nSTEP 2: Migrating EGX stocks...');

const egxDb = new Database(EGX_DB_PATH, { readonly: true });

const egxStocks = egxDb.query(`
  SELECT 
    ticker, name, name_ar, current_price, previous_close, open_price, high_price, low_price,
    volume, market_cap, pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, dividend_yield, eps,
    roe, roa, debt_to_equity, current_ratio, book_value_per_share, shares_outstanding,
    support_level, resistance_level, ma_50, ma_200, rsi, sector, industry, is_halal,
    compliance_status, compliance_note, compliance_last_reviewed, egx30_member, egx70_member,
    egx100_member, is_active, last_update, created_at, price_change, change_percent,
    personality, beta
  FROM stocks
`).all() as Record<string, unknown>[];

console.log(`  Found ${egxStocks.length} EGX stocks`);

const insertStock = stocksDb.prepare(`
  INSERT OR REPLACE INTO stocks (
    ticker, name, name_ar, exchange, country, current_price, previous_close, open_price,
    high_price, low_price, volume, market_cap, pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda,
    dividend_yield, eps, roe, roa, debt_to_equity, current_ratio, book_value_per_share,
    shares_outstanding, support_level, resistance_level, ma_50, ma_200, rsi, sector,
    industry, is_halal, compliance_status, compliance_note, compliance_last_reviewed,
    egx30_member, egx70_member, egx100_member, is_active, last_update, created_at,
    price_change, change_percent, personality, beta
  ) VALUES (
    ?, ?, ?, 'EGX', 'مصر', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

let egxCount = 0;
for (const stock of egxStocks) {
  try {
    insertStock.run(
      stock.ticker, stock.name, stock.name_ar, stock.current_price, stock.previous_close,
      stock.open_price, stock.high_price, stock.low_price, stock.volume, stock.market_cap,
      stock.pe_ratio, stock.pb_ratio, stock.ps_ratio, stock.ev_to_ebitda, stock.dividend_yield,
      stock.eps, stock.roe, stock.roa, stock.debt_to_equity, stock.current_ratio,
      stock.book_value_per_share, stock.shares_outstanding, stock.support_level,
      stock.resistance_level, stock.ma_50, stock.ma_200, stock.rsi, stock.sector,
      stock.industry, stock.is_halal, stock.compliance_status, stock.compliance_note,
      stock.compliance_last_reviewed, stock.egx30_member, stock.egx70_member,
      stock.egx100_member, stock.is_active, stock.last_update, stock.created_at,
      stock.price_change, stock.change_percent, stock.personality, stock.beta
    );
    egxCount++;
  } catch (e) {
    console.log(`  Error inserting ${stock.ticker}: ${e}`);
  }
}

console.log(`  Migrated ${egxCount} EGX stocks`);
egxDb.close();

// ============================================================================
// STEP 3: Migrate Arab Stocks from basic.db
// ============================================================================
console.log('\nSTEP 3: Migrating Arab stocks from basic.db...');

const basicDb = new Database(BASIC_DB_PATH, { readonly: true });

// Get Arab stocks (non-EGX)
const arabStocks = basicDb.query(`
  SELECT 
    ticker, name, name_ar, current_price, previous_close, open_price, high_price, low_price,
    volume, market_cap, pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, dividend_yield, eps,
    roe, roa, debt_to_equity, current_ratio, book_value_per_share, shares_outstanding,
    support_level, resistance_level, ma_50, ma_200, rsi, sector, industry, is_halal,
    compliance_status, compliance_note, compliance_last_reviewed, is_active, last_update,
    created_at, price_change, change_percent, country, exchange_code, icon_url
  FROM stocks
  WHERE exchange_code != 'EGX' OR exchange_code IS NULL
`).all() as Record<string, unknown>[];

console.log(`  Found ${arabStocks.length} Arab stocks`);

// Map exchange codes to country names
const exchangeToCountry: Record<string, string> = {
  'KSA': 'السعودية',
  'DFM': 'الإمارات',
  'KSE': 'الكويت',
  'QSE': 'قطر',
  'BSE': 'البحرين',
  'EGX': 'مصر'
};

const insertArabStock = stocksDb.prepare(`
  INSERT OR REPLACE INTO stocks (
    ticker, name, name_ar, exchange, country, current_price, previous_close, open_price,
    high_price, low_price, volume, market_cap, pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda,
    dividend_yield, eps, roe, roa, debt_to_equity, current_ratio, book_value_per_share,
    shares_outstanding, support_level, resistance_level, ma_50, ma_200, rsi, sector,
    industry, is_halal, compliance_status, compliance_note, compliance_last_reviewed,
    is_active, last_update, created_at, price_change, change_percent, icon_url
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

let arabCount = 0;
const exchangeStats: Record<string, number> = {};

for (const stock of arabStocks) {
  const exchange = (stock.exchange_code as string) || 'UNKNOWN';
  const country = exchangeToCountry[exchange] || (stock.country as string) || 'غير محدد';
  
  try {
    insertArabStock.run(
      stock.ticker, stock.name, stock.name_ar, exchange, country, stock.current_price,
      stock.previous_close, stock.open_price, stock.high_price, stock.low_price,
      stock.volume, stock.market_cap, stock.pe_ratio, stock.pb_ratio, stock.ps_ratio,
      stock.ev_to_ebitda, stock.dividend_yield, stock.eps, stock.roe, stock.roa,
      stock.debt_to_equity, stock.current_ratio, stock.book_value_per_share,
      stock.shares_outstanding, stock.support_level, stock.resistance_level,
      stock.ma_50, stock.ma_200, stock.rsi, stock.sector, stock.industry,
      stock.is_halal, stock.compliance_status, stock.compliance_note,
      stock.compliance_last_reviewed, stock.is_active, stock.last_update,
      stock.created_at, stock.price_change, stock.change_percent, stock.icon_url
    );
    arabCount++;
    exchangeStats[exchange] = (exchangeStats[exchange] || 0) + 1;
  } catch (e) {
    console.log(`  Error inserting ${stock.ticker}: ${e}`);
  }
}

console.log(`  Migrated ${arabCount} Arab stocks`);
console.log('  Breakdown by exchange:');
for (const [exchange, count] of Object.entries(exchangeStats)) {
  console.log(`    ${exchange}: ${count}`);
}

basicDb.close();

// ============================================================================
// STEP 4: Create stock_price_history table and migrate data
// ============================================================================
console.log('\nSTEP 4: Migrating price history...');

stocksDb.run(`
  CREATE TABLE IF NOT EXISTS stock_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    ticker VARCHAR(20) NOT NULL,
    date TEXT NOT NULL,
    open_price REAL DEFAULT 0,
    high_price REAL DEFAULT 0,
    low_price REAL DEFAULT 0,
    close_price REAL DEFAULT 0,
    volume INTEGER DEFAULT 0,
    adjusted_close REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(ticker, date)
  )
`);
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON stock_price_history(ticker)');
stocksDb.run('CREATE INDEX IF NOT EXISTS idx_price_history_date ON stock_price_history(date)');

// Migrate price history from EGX
const egxDb2 = new Database(EGX_DB_PATH, { readonly: true });

const priceHistory = egxDb2.query(`
  SELECT sph.*, s.ticker 
  FROM stock_price_history sph
  JOIN stocks s ON s.id = sph.stock_id
  LIMIT 50000
`).all() as Record<string, unknown>[];

console.log(`  Found ${priceHistory.length} price history records (limited to 50k for initial migration)`);

const insertPriceHistory = stocksDb.prepare(`
  INSERT OR IGNORE INTO stock_price_history (stock_id, ticker, date, open_price, high_price, low_price, close_price, volume, adjusted_close, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let historyCount = 0;
for (const record of priceHistory) {
  try {
    insertPriceHistory.run(
      record.stock_id, record.ticker, record.date, record.open_price, record.high_price,
      record.low_price, record.close_price, record.volume, record.adjusted_close, record.created_at
    );
    historyCount++;
  } catch (e) {
    // Ignore duplicates
  }
}

console.log(`  Migrated ${historyCount} price history records`);
egxDb2.close();

// ============================================================================
// STEP 5: Create Crypto Database
// ============================================================================
console.log('\nSTEP 5: Creating crypto.db...');

if (fs.existsSync(CRYPTO_DB_PATH)) {
  if (BACKUP) {
    const backupPath = `${CRYPTO_DB_PATH}.backup_${Date.now()}`;
    fs.copyFileSync(CRYPTO_DB_PATH, backupPath);
    console.log(`  Backed up existing DB to ${backupPath}`);
  }
  fs.unlinkSync(CRYPTO_DB_PATH);
}

const cryptoDb = new Database(CRYPTO_DB_PATH);
cryptoDb.run('PRAGMA journal_mode = WAL');
cryptoDb.run('PRAGMA foreign_keys = ON');

// Create crypto_coins table
cryptoDb.run(`
  CREATE TABLE IF NOT EXISTS crypto_coins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coin_id VARCHAR(50) NOT NULL UNIQUE,
    symbol VARCHAR(20) NOT NULL,
    name VARCHAR(100),
    name_ar VARCHAR(100),
    
    -- Prices
    current_price REAL,
    price_change_24h REAL,
    price_change_percent_24h REAL,
    high_24h REAL,
    low_24h REAL,
    
    -- Market data
    market_cap REAL,
    market_cap_rank INTEGER,
    total_volume REAL,
    circulating_supply REAL,
    total_supply REAL,
    max_supply REAL,
    
    -- All time high/low
    ath REAL,
    ath_change_percent REAL,
    ath_date TEXT,
    atl REAL,
    atl_change_percent REAL,
    atl_date TEXT,
    
    -- Image
    image_url VARCHAR(255),
    
    -- Analysis
    signal VARCHAR(20),
    confidence REAL,
    
    -- Timestamps
    last_update DATETIME,
    created_at DATETIME DEFAULT (datetime('now'))
  )
`);

// Create price history table
cryptoDb.run(`
  CREATE TABLE IF NOT EXISTS crypto_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coin_id VARCHAR(50) NOT NULL,
    date TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume REAL,
    created_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(coin_id, date)
  )
`);

// Create indexes
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_coin_id ON crypto_coins(coin_id)');
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_symbol ON crypto_coins(symbol)');
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_rank ON crypto_coins(market_cap_rank)');
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_history_coin ON crypto_price_history(coin_id)');
cryptoDb.run('CREATE INDEX IF NOT EXISTS idx_crypto_history_date ON crypto_price_history(date)');

console.log('  Created crypto tables with indexes');

// Migrate crypto from JSON
console.log('\n  Migrating crypto from JSON cache...');

if (fs.existsSync(CRYPTO_CACHE_PATH)) {
  const cryptoCache = JSON.parse(fs.readFileSync(CRYPTO_CACHE_PATH, 'utf-8'));
  const cacheKeys = Object.keys(cryptoCache);
  
  for (const key of cacheKeys) {
    const data = cryptoCache[key];
    if (data && data.data && Array.isArray(data.data)) {
      const coins = data.data;
      console.log(`  Found ${coins.length} coins in cache`);
      
      const insertCoin = cryptoDb.prepare(`
        INSERT OR REPLACE INTO crypto_coins (
          coin_id, symbol, name, current_price, price_change_24h, price_change_percent_24h,
          high_24h, low_24h, market_cap, market_cap_rank, total_volume, circulating_supply,
          total_supply, max_supply, ath, ath_change_percent, ath_date, atl, atl_change_percent,
          atl_date, image_url, last_update
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);
      
      let coinCount = 0;
      for (const coin of coins) {
        try {
          insertCoin.run(
            coin.id, coin.symbol, coin.name, coin.current_price, coin.price_change_24h,
            coin.price_change_percentage_24h, coin.high_24h, coin.low_24h, coin.market_cap,
            coin.market_cap_rank, coin.total_volume, coin.circulating_supply, coin.total_supply,
            coin.max_supply, coin.ath, coin.ath_change_percentage, coin.ath_date,
            coin.atl, coin.atl_change_percentage, coin.atl_date, coin.image, coin.last_updated
          );
          coinCount++;
        } catch (e) {
          console.log(`    Error inserting ${coin.id}: ${e}`);
        }
      }
      console.log(`  Migrated ${coinCount} crypto coins`);
    }
  }
} else {
  console.log('  Crypto cache not found, skipping crypto migration');
}

// ============================================================================
// STEP 6: Create market data tables in unified_stocks.db
// ============================================================================
console.log('\nSTEP 6: Creating market data tables...');

// Market indices
stocksDb.run(`
  CREATE TABLE IF NOT EXISTS market_indices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol VARCHAR(20) UNIQUE,
    name VARCHAR(100),
    name_ar VARCHAR(100),
    current_value REAL,
    previous_close REAL,
    change REAL,
    change_percent REAL,
    is_shariah INTEGER DEFAULT 0,
    last_update DATETIME,
    created_at DATETIME DEFAULT (datetime('now'))
  )
`);

// Currency rates
stocksDb.run(`
  CREATE TABLE IF NOT EXISTS currency_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(10) UNIQUE,
    name_ar VARCHAR(100),
    buy_rate REAL DEFAULT 0,
    sell_rate REAL DEFAULT 0,
    change REAL,
    is_major INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now')),
    updated_by VARCHAR(50) DEFAULT 'system'
  )
`);

// Gold prices
stocksDb.run(`
  CREATE TABLE IF NOT EXISTS gold_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    karat VARCHAR(10) UNIQUE,
    name_ar VARCHAR(100),
    price_per_gram REAL NOT NULL,
    change REAL,
    currency VARCHAR(10) DEFAULT 'EGP',
    updated_at DATETIME DEFAULT (datetime('now')),
    updated_by VARCHAR(50) DEFAULT 'system'
  )
`);

// Migrate market data from EGX db
const egxDb3 = new Database(EGX_DB_PATH, { readonly: true });

// Market indices
const indices = egxDb3.query('SELECT * FROM market_indices').all() as Record<string, unknown>[];
console.log(`  Migrating ${indices.length} market indices...`);

const insertIndex = stocksDb.prepare(`
  INSERT OR REPLACE INTO market_indices (symbol, name, name_ar, current_value, previous_close, change, change_percent, is_shariah, last_update)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const idx of indices) {
  try {
    insertIndex.run(
      idx.symbol, idx.name, idx.name_ar, idx.current_value, idx.previous_close,
      idx.change, idx.change_percent, idx.is_shariah, idx.last_update
    );
  } catch (e) {}
}

// Currency rates
const currencies = egxDb3.query('SELECT * FROM currency_rates').all() as Record<string, unknown>[];
console.log(`  Migrating ${currencies.length} currency rates...`);

const insertCurrency = stocksDb.prepare(`
  INSERT OR REPLACE INTO currency_rates (code, name_ar, buy_rate, sell_rate, change, is_major, updated_at, updated_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const curr of currencies) {
  try {
    insertCurrency.run(
      curr.code, curr.name_ar, curr.buy_rate, curr.sell_rate, curr.change, curr.is_major, curr.updated_at, curr.updated_by
    );
  } catch (e) {}
}

// Gold prices
const gold = egxDb3.query('SELECT * FROM gold_prices').all() as Record<string, unknown>[];
console.log(`  Migrating ${gold.length} gold prices...`);

const insertGold = stocksDb.prepare(`
  INSERT OR REPLACE INTO gold_prices (karat, name_ar, price_per_gram, change, currency, updated_at, updated_by)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

for (const g of gold) {
  try {
    insertGold.run(
      g.karat, g.name_ar, g.price_per_gram, g.change, g.currency, g.updated_at, g.updated_by
    );
  } catch (e) {}
}

egxDb3.close();

// ============================================================================
// STEP 7: Final Statistics
// ============================================================================
console.log('\n========================================');
console.log('Migration Complete!');
console.log('========================================');

// Final counts
const finalStockCount = stocksDb.query('SELECT COUNT(*) as count FROM stocks').get() as { count: number };
const finalHistoryCount = stocksDb.query('SELECT COUNT(*) as count FROM stock_price_history').get() as { count: number };
const exchangeBreakdown = stocksDb.query('SELECT exchange, COUNT(*) as count FROM stocks GROUP BY exchange ORDER BY count DESC').all() as { exchange: string, count: number }[];

const finalCryptoCount = cryptoDb.query('SELECT COUNT(*) as count FROM crypto_coins').get() as { count: number };

console.log('\nUnified Stocks Database Statistics:');
console.log(`  Total stocks: ${finalStockCount.count}`);
console.log(`  Price history records: ${finalHistoryCount.count}`);
console.log('\n  Breakdown by exchange:');
for (const ex of exchangeBreakdown) {
  console.log(`    ${ex.exchange}: ${ex.count}`);
}

console.log('\nCrypto Database Statistics:');
console.log(`  Total coins: ${finalCryptoCount.count}`);

// Close databases
stocksDb.close();
cryptoDb.close();

console.log('\n✅ Migration completed successfully!');
console.log(`\nNew databases created:`);
console.log(`  - ${UNIFIED_STOCKS_DB_PATH}`);
console.log(`  - ${CRYPTO_DB_PATH}`);

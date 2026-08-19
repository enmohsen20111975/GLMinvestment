import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = '/home/z/my-project/db';
const UPLOAD_DIR = '/home/z/my-project/upload';

const EGX_DB_PATH = path.join(DB_DIR, 'stocks.db');
const BASIC_DB_PATH = path.join(UPLOAD_DIR, 'basic.db');
const CRYPTO_CACHE_PATH = '/home/z/my-project/vps-service/data/crypto_cache.json';

const UNIFIED_STOCKS_DB_PATH = path.join(DB_DIR, 'unified_stocks.db');
const CRYPTO_DB_PATH = path.join(DB_DIR, 'crypto.db');

console.log('=== Migration Started ===\n');

// Clean up old files
for (const f of [UNIFIED_STOCKS_DB_PATH, `${UNIFIED_STOCKS_DB_PATH}-shm`, `${UNIFIED_STOCKS_DB_PATH}-wal`, CRYPTO_DB_PATH]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// Create unified stocks DB
const stocksDb = new Database(UNIFIED_STOCKS_DB_PATH);
stocksDb.run('PRAGMA journal_mode = WAL');

stocksDb.run(`CREATE TABLE stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(255), name_ar VARCHAR(255),
  exchange VARCHAR(20) NOT NULL DEFAULT 'EGX',
  country VARCHAR(50),
  sector VARCHAR(100), industry VARCHAR(100),
  current_price REAL, previous_close REAL, open_price REAL,
  high_price REAL, low_price REAL, volume INTEGER, market_cap REAL,
  pe_ratio REAL, pb_ratio REAL, ps_ratio REAL, ev_to_ebitda REAL,
  dividend_yield REAL, eps REAL, roe REAL, roa REAL,
  debt_to_equity REAL, current_ratio REAL, book_value_per_share REAL,
  shares_outstanding REAL, beta REAL, rsi REAL, ma_50 REAL, ma_200 REAL,
  support_level REAL, resistance_level REAL,
  is_halal INTEGER DEFAULT 0, compliance_status TEXT, compliance_note TEXT,
  egx30_member INTEGER DEFAULT 0, egx70_member INTEGER DEFAULT 0, egx100_member INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1, icon_url VARCHAR(255),
  last_update DATETIME, created_at DATETIME DEFAULT (datetime('now')),
  price_change REAL, change_percent REAL
)`);

stocksDb.run('CREATE INDEX idx_stocks_exchange ON stocks(exchange)');
stocksDb.run('CREATE INDEX idx_stocks_ticker ON stocks(ticker)');
console.log('Created stocks table');

// Migrate EGX stocks
console.log('\nMigrating EGX stocks...');
const egxDb = new Database(EGX_DB_PATH, { readonly: true });
const egxStocks = egxDb.query('SELECT * FROM stocks').all() as any[];
console.log(`Found ${egxStocks.length} EGX stocks`);

const insertEgx = stocksDb.prepare(`
  INSERT INTO stocks (ticker, name, name_ar, exchange, country, sector, industry,
    current_price, previous_close, open_price, high_price, low_price, volume, market_cap,
    pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, dividend_yield, eps, roe, roa,
    debt_to_equity, current_ratio, book_value_per_share, shares_outstanding, beta,
    rsi, ma_50, ma_200, support_level, resistance_level, is_halal, compliance_status,
    compliance_note, egx30_member, egx70_member, egx100_member, is_active, last_update,
    created_at, price_change, change_percent)
  VALUES (?,?,?,'EGX','مصر',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

let egxCount = 0;
for (const s of egxStocks) {
  try {
    insertEgx.run(s.ticker, s.name, s.name_ar, s.sector, s.industry,
      s.current_price, s.previous_close, s.open_price, s.high_price, s.low_price,
      s.volume, s.market_cap, s.pe_ratio, s.pb_ratio, s.ps_ratio, s.ev_to_ebitda,
      s.dividend_yield, s.eps, s.roe, s.roa, s.debt_to_equity, s.current_ratio,
      s.book_value_per_share, s.shares_outstanding, s.beta, s.rsi, s.ma_50, s.ma_200,
      s.support_level, s.resistance_level, s.is_halal, s.compliance_status, s.compliance_note,
      s.egx30_member, s.egx70_member, s.egx100_member, s.is_active, s.last_update,
      s.created_at, s.price_change, s.change_percent);
    egxCount++;
  } catch (e: any) {
    if (!e.message.includes('UNIQUE')) console.log(`  Error: ${s.ticker}`);
  }
}
console.log(`Migrated ${egxCount} EGX stocks`);
egxDb.close();

// Migrate Arab stocks
console.log('\nMigrating Arab stocks...');
const basicDb = new Database(BASIC_DB_PATH, { readonly: true });
const arabStocks = basicDb.query("SELECT * FROM stocks WHERE exchange_code != 'EGX' OR exchange_code IS NULL").all() as any[];
console.log(`Found ${arabStocks.length} Arab stocks`);

const exchangeToCountry: any = { KSA: 'السعودية', DFM: 'الإمارات', KSE: 'الكويت', QSE: 'قطر', BSE: 'البحرين' };

const insertArab = stocksDb.prepare(`
  INSERT INTO stocks (ticker, name, name_ar, exchange, country, sector, industry,
    current_price, previous_close, open_price, high_price, low_price, volume, market_cap,
    pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, dividend_yield, eps, roe, roa,
    debt_to_equity, current_ratio, book_value_per_share, shares_outstanding, beta,
    rsi, ma_50, ma_200, support_level, resistance_level, is_halal, compliance_status,
    compliance_note, is_active, last_update, created_at, price_change, change_percent, icon_url)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

let arabCount = 0;
const stats: any = {};
for (const s of arabStocks) {
  const ex = s.exchange_code || 'UNKNOWN';
  const country = exchangeToCountry[ex] || s.country || 'غير محدد';
  try {
    insertArab.run(s.ticker, s.name, s.name_ar, ex, country, s.sector, s.industry,
      s.current_price, s.previous_close, s.open_price, s.high_price, s.low_price,
      s.volume, s.market_cap, s.pe_ratio, s.pb_ratio, s.ps_ratio, s.ev_to_ebitda,
      s.dividend_yield, s.eps, s.roe, s.roa, s.debt_to_equity, s.current_ratio,
      s.book_value_per_share, s.shares_outstanding, s.beta, s.rsi, s.ma_50, s.ma_200,
      s.support_level, s.resistance_level, s.is_halal, s.compliance_status, s.compliance_note,
      s.is_active, s.last_update, s.created_at, s.price_change, s.change_percent, s.icon_url);
    arabCount++;
    stats[ex] = (stats[ex] || 0) + 1;
  } catch (e: any) {
    if (!e.message.includes('UNIQUE')) console.log(`  Error: ${s.ticker}`);
  }
}
console.log(`Migrated ${arabCount} Arab stocks`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
basicDb.close();

// Create price history
console.log('\nCreating price history...');
stocksDb.run(`CREATE TABLE stock_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticker VARCHAR(20), date TEXT,
  open_price REAL, high_price REAL, low_price REAL, close_price REAL, volume INTEGER,
  UNIQUE(ticker, date)
)`);
stocksDb.run('CREATE INDEX idx_ph_ticker ON stock_price_history(ticker)');

const egxDb2 = new Database(EGX_DB_PATH, { readonly: true });
const ph = egxDb2.query('SELECT sph.*, s.ticker FROM stock_price_history sph JOIN stocks s ON s.id = sph.stock_id LIMIT 30000').all() as any[];
const insertPH = stocksDb.prepare('INSERT OR IGNORE INTO stock_price_history (ticker, date, open_price, high_price, low_price, close_price, volume) VALUES (?,?,?,?,?,?,?)');
let phCount = 0;
for (const p of ph) {
  try { insertPH.run(p.ticker, p.date, p.open_price, p.high_price, p.low_price, p.close_price, p.volume); phCount++; } catch (e) {}
}
console.log(`Migrated ${phCount} price history records`);
egxDb2.close();

// Create market tables
stocksDb.run(`CREATE TABLE market_indices (id INTEGER PRIMARY KEY, symbol VARCHAR(20) UNIQUE, name VARCHAR(100), name_ar VARCHAR(100), current_value REAL, previous_close REAL, change REAL, change_percent REAL, last_update DATETIME)`);
stocksDb.run(`CREATE TABLE currency_rates (id INTEGER PRIMARY KEY, code VARCHAR(10) UNIQUE, name_ar VARCHAR(100), buy_rate REAL, sell_rate REAL, change REAL, updated_at DATETIME)`);
stocksDb.run(`CREATE TABLE gold_prices (id INTEGER PRIMARY KEY, karat VARCHAR(10) UNIQUE, name_ar VARCHAR(100), price_per_gram REAL, change REAL, updated_at DATETIME)`);

const egxDb3 = new Database(EGX_DB_PATH, { readonly: true });
for (const i of egxDb3.query('SELECT * FROM market_indices').all() as any[]) {
  try { stocksDb.run('INSERT OR REPLACE INTO market_indices VALUES (?,?,?,?,?,?,?,?,?)', [i.id, i.symbol, i.name, i.name_ar, i.current_value, i.previous_close, i.change, i.change_percent, i.last_update]); } catch (e) {}
}
for (const c of egxDb3.query('SELECT * FROM currency_rates').all() as any[]) {
  try { stocksDb.run('INSERT OR REPLACE INTO currency_rates VALUES (?,?,?,?,?,?,?)', [c.id, c.code, c.name_ar, c.buy_rate, c.sell_rate, c.change, c.updated_at]); } catch (e) {}
}
for (const g of egxDb3.query('SELECT * FROM gold_prices').all() as any[]) {
  try { stocksDb.run('INSERT OR REPLACE INTO gold_prices VALUES (?,?,?,?,?,?)', [g.id, g.karat, g.name_ar, g.price_per_gram, g.change, g.updated_at]); } catch (e) {}
}
egxDb3.close();
console.log('Migrated market data');

// Create crypto DB
console.log('\nCreating crypto DB...');
const cryptoDb = new Database(CRYPTO_DB_PATH);
cryptoDb.run('PRAGMA journal_mode = WAL');
cryptoDb.run(`CREATE TABLE crypto_coins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, coin_id VARCHAR(50) UNIQUE, symbol VARCHAR(20),
  name VARCHAR(100), current_price REAL, price_change_24h REAL, price_change_percent_24h REAL,
  high_24h REAL, low_24h REAL, market_cap REAL, market_cap_rank INTEGER, total_volume REAL,
  circulating_supply REAL, total_supply REAL, max_supply REAL, ath REAL, ath_change_percent REAL,
  atl REAL, atl_change_percent REAL, image_url VARCHAR(255), last_update DATETIME,
  created_at DATETIME DEFAULT (datetime('now'))
)`);
cryptoDb.run('CREATE INDEX idx_crypto_coin ON crypto_coins(coin_id)');

if (fs.existsSync(CRYPTO_CACHE_PATH)) {
  const cache = JSON.parse(fs.readFileSync(CRYPTO_CACHE_PATH, 'utf-8'));
  for (const key of Object.keys(cache)) {
    const data = cache[key]?.data;
    if (Array.isArray(data)) {
      console.log(`Migrating ${data.length} coins...`);
      const ins = cryptoDb.prepare(`INSERT OR REPLACE INTO crypto_coins (coin_id, symbol, name, current_price, price_change_24h, price_change_percent_24h, high_24h, low_24h, market_cap, market_cap_rank, total_volume, circulating_supply, total_supply, max_supply, ath, ath_change_percent, atl, atl_change_percent, image_url, last_update) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      let cnt = 0;
      for (const c of data) {
        try { ins.run(c.id, c.symbol, c.name, c.current_price, c.price_change_24h, c.price_change_percentage_24h, c.high_24h, c.low_24h, c.market_cap, c.market_cap_rank, c.total_volume, c.circulating_supply, c.total_supply, c.max_supply, c.ath, c.ath_change_percentage, c.atl, c.atl_change_percentage, c.image, c.last_updated); cnt++; } catch (e) {}
      }
      console.log(`Migrated ${cnt} coins`);
    }
  }
}

// Final stats
console.log('\n=== FINAL STATS ===');
const finalStocks = (stocksDb.query('SELECT COUNT(*) as c FROM stocks').get() as any)?.c || 0;
const finalPH = (stocksDb.query('SELECT COUNT(*) as c FROM stock_price_history').get() as any)?.c || 0;
const exBreakdown = stocksDb.query('SELECT exchange, COUNT(*) as c FROM stocks GROUP BY exchange').all() as any[];
const finalCrypto = (cryptoDb.query('SELECT COUNT(*) as c FROM crypto_coins').get() as any)?.c || 0;

console.log(`Stocks: ${finalStocks}`);
console.log(`Price history: ${finalPH}`);
console.log(`By exchange:`);
for (const e of exBreakdown) console.log(`  ${e.exchange}: ${e.c}`);
console.log(`Crypto coins: ${finalCrypto}`);

stocksDb.close();
cryptoDb.close();

console.log('\n✅ Migration complete!');
console.log(`Created: ${UNIFIED_STOCKS_DB_PATH}`);
console.log(`Created: ${CRYPTO_DB_PATH}`);
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = '/home/z/my-project/db';
const UPLOAD_DIR = '/home/z/my-project/upload';

const EGX_DB_PATH = path.join(DB_DIR, 'egx_investment.db');
const BASIC_DB_PATH = path.join(UPLOAD_DIR, 'basic.db');
const CRYPTO_CACHE_PATH = '/home/z/my-project/vps-service/data/crypto_cache.json';

const UNIFIED_STOCKS_DB_PATH = path.join(DB_DIR, 'unified_stocks.db');
const CRYPTO_DB_PATH = path.join(DB_DIR, 'crypto.db');

console.log('=== Migration Started ===\n');

// Clean up old files
for (const f of [UNIFIED_STOCKS_DB_PATH, `${UNIFIED_STOCKS_DB_PATH}-shm`, `${UNIFIED_STOCKS_DB_PATH}-wal`, CRYPTO_DB_PATH]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// Create unified stocks DB
const stocksDb = new Database(UNIFIED_STOCKS_DB_PATH);
stocksDb.run('PRAGMA journal_mode = WAL');

stocksDb.run(`CREATE TABLE stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(255), name_ar VARCHAR(255),
  exchange VARCHAR(20) NOT NULL DEFAULT 'EGX',
  country VARCHAR(50),
  sector VARCHAR(100), industry VARCHAR(100),
  current_price REAL, previous_close REAL, open_price REAL,
  high_price REAL, low_price REAL, volume INTEGER, market_cap REAL,
  pe_ratio REAL, pb_ratio REAL, ps_ratio REAL, ev_to_ebitda REAL,
  dividend_yield REAL, eps REAL, roe REAL, roa REAL,
  debt_to_equity REAL, current_ratio REAL, book_value_per_share REAL,
  shares_outstanding REAL, beta REAL, rsi REAL, ma_50 REAL, ma_200 REAL,
  support_level REAL, resistance_level REAL,
  is_halal INTEGER DEFAULT 0, compliance_status TEXT, compliance_note TEXT,
  egx30_member INTEGER DEFAULT 0, egx70_member INTEGER DEFAULT 0, egx100_member INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1, icon_url VARCHAR(255),
  last_update DATETIME, created_at DATETIME DEFAULT (datetime('now')),
  price_change REAL, change_percent REAL
)`);

stocksDb.run('CREATE INDEX idx_stocks_exchange ON stocks(exchange)');
stocksDb.run('CREATE INDEX idx_stocks_ticker ON stocks(ticker)');
console.log('Created stocks table');

// Migrate EGX stocks
console.log('\nMigrating EGX stocks...');
const egxDb = new Database(EGX_DB_PATH, { readonly: true });
const egxStocks = egxDb.query('SELECT * FROM stocks').all() as any[];
console.log(`Found ${egxStocks.length} EGX stocks`);

const insertEgx = stocksDb.prepare(`
  INSERT INTO stocks (ticker, name, name_ar, exchange, country, sector, industry,
    current_price, previous_close, open_price, high_price, low_price, volume, market_cap,
    pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, dividend_yield, eps, roe, roa,
    debt_to_equity, current_ratio, book_value_per_share, shares_outstanding, beta,
    rsi, ma_50, ma_200, support_level, resistance_level, is_halal, compliance_status,
    compliance_note, egx30_member, egx70_member, egx100_member, is_active, last_update,
    created_at, price_change, change_percent)
  VALUES (?,?,?,'EGX','مصر',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

let egxCount = 0;
for (const s of egxStocks) {
  try {
    insertEgx.run(s.ticker, s.name, s.name_ar, s.sector, s.industry,
      s.current_price, s.previous_close, s.open_price, s.high_price, s.low_price,
      s.volume, s.market_cap, s.pe_ratio, s.pb_ratio, s.ps_ratio, s.ev_to_ebitda,
      s.dividend_yield, s.eps, s.roe, s.roa, s.debt_to_equity, s.current_ratio,
      s.book_value_per_share, s.shares_outstanding, s.beta, s.rsi, s.ma_50, s.ma_200,
      s.support_level, s.resistance_level, s.is_halal, s.compliance_status, s.compliance_note,
      s.egx30_member, s.egx70_member, s.egx100_member, s.is_active, s.last_update,
      s.created_at, s.price_change, s.change_percent);
    egxCount++;
  } catch (e: any) {
    if (!e.message.includes('UNIQUE')) console.log(`  Error: ${s.ticker}`);
  }
}
console.log(`Migrated ${egxCount} EGX stocks`);
egxDb.close();

// Migrate Arab stocks
console.log('\nMigrating Arab stocks...');
const basicDb = new Database(BASIC_DB_PATH, { readonly: true });
const arabStocks = basicDb.query("SELECT * FROM stocks WHERE exchange_code != 'EGX' OR exchange_code IS NULL").all() as any[];
console.log(`Found ${arabStocks.length} Arab stocks`);

const exchangeToCountry: any = { KSA: 'السعودية', DFM: 'الإمارات', KSE: 'الكويت', QSE: 'قطر', BSE: 'البحرين' };

const insertArab = stocksDb.prepare(`
  INSERT INTO stocks (ticker, name, name_ar, exchange, country, sector, industry,
    current_price, previous_close, open_price, high_price, low_price, volume, market_cap,
    pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda, dividend_yield, eps, roe, roa,
    debt_to_equity, current_ratio, book_value_per_share, shares_outstanding, beta,
    rsi, ma_50, ma_200, support_level, resistance_level, is_halal, compliance_status,
    compliance_note, is_active, last_update, created_at, price_change, change_percent, icon_url)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

let arabCount = 0;
const stats: any = {};
for (const s of arabStocks) {
  const ex = s.exchange_code || 'UNKNOWN';
  const country = exchangeToCountry[ex] || s.country || 'غير محدد';
  try {
    insertArab.run(s.ticker, s.name, s.name_ar, ex, country, s.sector, s.industry,
      s.current_price, s.previous_close, s.open_price, s.high_price, s.low_price,
      s.volume, s.market_cap, s.pe_ratio, s.pb_ratio, s.ps_ratio, s.ev_to_ebitda,
      s.dividend_yield, s.eps, s.roe, s.roa, s.debt_to_equity, s.current_ratio,
      s.book_value_per_share, s.shares_outstanding, s.beta, s.rsi, s.ma_50, s.ma_200,
      s.support_level, s.resistance_level, s.is_halal, s.compliance_status, s.compliance_note,
      s.is_active, s.last_update, s.created_at, s.price_change, s.change_percent, s.icon_url);
    arabCount++;
    stats[ex] = (stats[ex] || 0) + 1;
  } catch (e: any) {
    if (!e.message.includes('UNIQUE')) console.log(`  Error: ${s.ticker}`);
  }
}
console.log(`Migrated ${arabCount} Arab stocks`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
basicDb.close();

// Create price history
console.log('\nCreating price history...');
stocksDb.run(`CREATE TABLE stock_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticker VARCHAR(20), date TEXT,
  open_price REAL, high_price REAL, low_price REAL, close_price REAL, volume INTEGER,
  UNIQUE(ticker, date)
)`);
stocksDb.run('CREATE INDEX idx_ph_ticker ON stock_price_history(ticker)');

const egxDb2 = new Database(EGX_DB_PATH, { readonly: true });
const ph = egxDb2.query('SELECT sph.*, s.ticker FROM stock_price_history sph JOIN stocks s ON s.id = sph.stock_id LIMIT 30000').all() as any[];
const insertPH = stocksDb.prepare('INSERT OR IGNORE INTO stock_price_history (ticker, date, open_price, high_price, low_price, close_price, volume) VALUES (?,?,?,?,?,?,?)');
let phCount = 0;
for (const p of ph) {
  try { insertPH.run(p.ticker, p.date, p.open_price, p.high_price, p.low_price, p.close_price, p.volume); phCount++; } catch (e) {}
}
console.log(`Migrated ${phCount} price history records`);
egxDb2.close();

// Create market tables
stocksDb.run(`CREATE TABLE market_indices (id INTEGER PRIMARY KEY, symbol VARCHAR(20) UNIQUE, name VARCHAR(100), name_ar VARCHAR(100), current_value REAL, previous_close REAL, change REAL, change_percent REAL, last_update DATETIME)`);
stocksDb.run(`CREATE TABLE currency_rates (id INTEGER PRIMARY KEY, code VARCHAR(10) UNIQUE, name_ar VARCHAR(100), buy_rate REAL, sell_rate REAL, change REAL, updated_at DATETIME)`);
stocksDb.run(`CREATE TABLE gold_prices (id INTEGER PRIMARY KEY, karat VARCHAR(10) UNIQUE, name_ar VARCHAR(100), price_per_gram REAL, change REAL, updated_at DATETIME)`);

const egxDb3 = new Database(EGX_DB_PATH, { readonly: true });
for (const i of egxDb3.query('SELECT * FROM market_indices').all() as any[]) {
  try { stocksDb.run('INSERT OR REPLACE INTO market_indices VALUES (?,?,?,?,?,?,?,?,?)', [i.id, i.symbol, i.name, i.name_ar, i.current_value, i.previous_close, i.change, i.change_percent, i.last_update]); } catch (e) {}
}
for (const c of egxDb3.query('SELECT * FROM currency_rates').all() as any[]) {
  try { stocksDb.run('INSERT OR REPLACE INTO currency_rates VALUES (?,?,?,?,?,?,?)', [c.id, c.code, c.name_ar, c.buy_rate, c.sell_rate, c.change, c.updated_at]); } catch (e) {}
}
for (const g of egxDb3.query('SELECT * FROM gold_prices').all() as any[]) {
  try { stocksDb.run('INSERT OR REPLACE INTO gold_prices VALUES (?,?,?,?,?,?)', [g.id, g.karat, g.name_ar, g.price_per_gram, g.change, g.updated_at]); } catch (e) {}
}
egxDb3.close();
console.log('Migrated market data');

// Create crypto DB
console.log('\nCreating crypto DB...');
const cryptoDb = new Database(CRYPTO_DB_PATH);
cryptoDb.run('PRAGMA journal_mode = WAL');
cryptoDb.run(`CREATE TABLE crypto_coins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, coin_id VARCHAR(50) UNIQUE, symbol VARCHAR(20),
  name VARCHAR(100), current_price REAL, price_change_24h REAL, price_change_percent_24h REAL,
  high_24h REAL, low_24h REAL, market_cap REAL, market_cap_rank INTEGER, total_volume REAL,
  circulating_supply REAL, total_supply REAL, max_supply REAL, ath REAL, ath_change_percent REAL,
  atl REAL, atl_change_percent REAL, image_url VARCHAR(255), last_update DATETIME,
  created_at DATETIME DEFAULT (datetime('now'))
)`);
cryptoDb.run('CREATE INDEX idx_crypto_coin ON crypto_coins(coin_id)');

if (fs.existsSync(CRYPTO_CACHE_PATH)) {
  const cache = JSON.parse(fs.readFileSync(CRYPTO_CACHE_PATH, 'utf-8'));
  for (const key of Object.keys(cache)) {
    const data = cache[key]?.data;
    if (Array.isArray(data)) {
      console.log(`Migrating ${data.length} coins...`);
      const ins = cryptoDb.prepare(`INSERT OR REPLACE INTO crypto_coins (coin_id, symbol, name, current_price, price_change_24h, price_change_percent_24h, high_24h, low_24h, market_cap, market_cap_rank, total_volume, circulating_supply, total_supply, max_supply, ath, ath_change_percent, atl, atl_change_percent, image_url, last_update) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      let cnt = 0;
      for (const c of data) {
        try { ins.run(c.id, c.symbol, c.name, c.current_price, c.price_change_24h, c.price_change_percentage_24h, c.high_24h, c.low_24h, c.market_cap, c.market_cap_rank, c.total_volume, c.circulating_supply, c.total_supply, c.max_supply, c.ath, c.ath_change_percentage, c.atl, c.atl_change_percentage, c.image, c.last_updated); cnt++; } catch (e) {}
      }
      console.log(`Migrated ${cnt} coins`);
    }
  }
}

// Final stats
console.log('\n=== FINAL STATS ===');
const finalStocks = (stocksDb.query('SELECT COUNT(*) as c FROM stocks').get() as any)?.c || 0;
const finalPH = (stocksDb.query('SELECT COUNT(*) as c FROM stock_price_history').get() as any)?.c || 0;
const exBreakdown = stocksDb.query('SELECT exchange, COUNT(*) as c FROM stocks GROUP BY exchange').all() as any[];
const finalCrypto = (cryptoDb.query('SELECT COUNT(*) as c FROM crypto_coins').get() as any)?.c || 0;

console.log(`Stocks: ${finalStocks}`);
console.log(`Price history: ${finalPH}`);
console.log(`By exchange:`);
for (const e of exBreakdown) console.log(`  ${e.exchange}: ${e.c}`);
console.log(`Crypto coins: ${finalCrypto}`);

stocksDb.close();
cryptoDb.close();

console.log('\n✅ Migration complete!');
console.log(`Created: ${UNIFIED_STOCKS_DB_PATH}`);
console.log(`Created: ${CRYPTO_DB_PATH}`);

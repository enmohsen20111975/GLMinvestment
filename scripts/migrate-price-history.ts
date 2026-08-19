#!/usr/bin/env npx ts-node
/**
 * Migration Script: Copy price history from stocks.db to price_history.db
 * 
 * Usage: npx ts-node scripts/migrate-price-history.ts
 * 
 * This script reads historical price data from the large stocks.db
 * and populates price_history.db for the new system.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'db');
const SOURCE_DB = path.join(DB_DIR, 'stocks.db');
const TARGET_DB = path.join(DB_DIR, 'price_history.db');

console.log('========================================');
console.log('Price History Migration Script');
console.log('========================================\n');

// Check if source DB exists
if (!fs.existsSync(SOURCE_DB)) {
  console.error(`❌ Source database not found: ${SOURCE_DB}`);
  console.log('\nPlease make sure stocks.db exists in the db/ folder.');
  process.exit(1);
}

console.log(`✅ Source DB found: ${SOURCE_DB}`);
console.log(`   Size: ${(fs.statSync(SOURCE_DB).size / 1024 / 1024).toFixed(2)} MB\n`);

// Open databases
const sourceDb = new Database(SOURCE_DB, { readonly: true });

// Create target DB if not exists
const targetDb = new Database(TARGET_DB);

// Enable WAL mode for better performance
targetDb.pragma('journal_mode = WAL');
targetDb.pragma('foreign_keys = ON');

// Create price_history table in target
console.log('📦 Creating price_history table...');
targetDb.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    close_price REAL,
    volume INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ticker, date)
  );
  CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker);
  CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date);
`);
console.log('✅ Table created\n');

// Find the price history table in source DB
console.log('🔍 Looking for price history table in source DB...');
const tables = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
console.log('   Tables found:', tables.map(t => t.name).join(', '));

// Check different possible table names
const possibleTables = ['price_history', 'historical_prices', 'prices', 'stock_prices', 'daily_prices'];
let sourceTable: string | null = null;

for (const t of possibleTables) {
  if (tables.some(table => table.name.toLowerCase() === t.toLowerCase())) {
    sourceTable = t;
    break;
  }
}

// If not found, try to find any table with price data
if (!sourceTable) {
  for (const table of tables) {
    try {
      const columns = sourceDb.prepare(`PRAGMA table_info(${table.name})`).all() as { name: string }[];
      const colNames = columns.map(c => c.name.toLowerCase());
      
      // Check if table has price-related columns
      if (colNames.includes('close') || colNames.includes('close_price')) {
        if (colNames.includes('ticker') || colNames.includes('symbol') || colNames.includes('stock_id')) {
          sourceTable = table.name;
          console.log(`   Found price table: ${table.name}`);
          break;
        }
      }
    } catch (e) {
      // Skip tables that can't be read
    }
  }
}

if (!sourceTable) {
  console.error('\n❌ Could not find price history table in source database.');
  console.log('   Please check the table structure of stocks.db');
  sourceDb.close();
  targetDb.close();
  process.exit(1);
}

console.log(`✅ Using source table: ${sourceTable}\n`);

// Get column info
const sourceColumns = sourceDb.prepare(`PRAGMA table_info(${sourceTable})`).all() as { name: string; type: string }[];
console.log('   Source columns:', sourceColumns.map(c => c.name).join(', '));

// Get count of records
const countRow = sourceDb.prepare(`SELECT COUNT(*) as count FROM ${sourceTable}`).get() as { count: number };
console.log(`   Total records: ${countRow.count.toLocaleString()}\n`);

// Start migration
console.log('🚀 Starting migration...\n');

const batchSize = 10000;
let migrated = 0;
let skipped = 0;

// Prepare insert statement
const insertStmt = targetDb.prepare(`
  INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Get ticker mapping if needed (stock_id -> ticker)
let tickerMap: Map<number, string> = new Map();
try {
  const stocksTable = tables.find(t => t.name.toLowerCase().includes('stock'));
  if (stocksTable) {
    const stockRows = sourceDb.prepare(`SELECT * FROM ${stocksTable.name}`).all() as Record<string, unknown>[];
    for (const row of stockRows) {
      const id = Number(row.id || row.stock_id || 0);
      const ticker = String(row.ticker || row.symbol || '');
      if (id && ticker) {
        tickerMap.set(id, ticker);
      }
    }
    console.log(`   Loaded ${tickerMap.size} ticker mappings\n`);
  }
} catch (e) {
  console.log('   No ticker mapping needed\n');
}

// Read data in batches
const offset = 0;
let hasMore = true;

while (hasMore) {
  const rows = sourceDb.prepare(`
    SELECT * FROM ${sourceTable} 
    ORDER BY date ASC 
    LIMIT ? OFFSET ?
  `).all(batchSize, migrated + skipped) as Record<string, unknown>[];
  
  if (rows.length === 0) {
    hasMore = false;
    break;
  }
  
  const insertMany = targetDb.transaction(() => {
    for (const row of rows) {
      try {
        // Determine ticker
        let ticker = String(row.ticker || row.symbol || '');
        if (!ticker && row.stock_id) {
          ticker = tickerMap.get(Number(row.stock_id)) || '';
        }
        
        if (!ticker) {
          skipped++;
          continue;
        }
        
        // Get date
        const date = String(row.date || row.trade_date || row.trading_date || '').split('T')[0].split(' ')[0];
        if (!date || date.length < 10) {
          skipped++;
          continue;
        }
        
        // Get prices
        const openPrice = Number(row.open || row.open_price || 0);
        const highPrice = Number(row.high || row.high_price || 0);
        const lowPrice = Number(row.low || row.low_price || 0);
        const closePrice = Number(row.close || row.close_price || 0);
        const volume = Number(row.volume || row.vol || 0);
        
        if (closePrice <= 0) {
          skipped++;
          continue;
        }
        
        insertStmt.run(ticker.toUpperCase(), date, openPrice, highPrice, lowPrice, closePrice, volume);
        migrated++;
      } catch (e) {
        skipped++;
      }
    }
  });
  
  insertMany();
  
  // Progress
  if ((migrated + skipped) % 50000 === 0) {
    console.log(`   Processed: ${(migrated + skipped).toLocaleString()} | Migrated: ${migrated.toLocaleString()} | Skipped: ${skipped.toLocaleString()}`);
  }
  
  if (rows.length < batchSize) {
    hasMore = false;
  }
}

console.log(`\n✅ Migration completed!`);
console.log(`   Migrated: ${migrated.toLocaleString()} records`);
console.log(`   Skipped: ${skipped.toLocaleString()} records`);

// Verify
const targetCount = targetDb.prepare('SELECT COUNT(*) as count FROM price_history').get() as { count: number };
console.log(`\n📊 Verification:`);
console.log(`   Records in price_history.db: ${targetCount.count.toLocaleString()}`);

// Show sample data
const sampleData = targetDb.prepare('SELECT * FROM price_history ORDER BY date DESC LIMIT 5').all() as Record<string, unknown>[];
console.log(`\n   Sample data (last 5 records):`);
for (const row of sampleData) {
  console.log(`   ${row.ticker} | ${row.date} | Close: ${row.close_price} | Volume: ${row.volume}`);
}

// Close databases
sourceDb.close();
targetDb.close();

console.log('\n========================================');
console.log('Migration script completed!');
console.log('========================================');
#!/usr/bin/env npx ts-node
/**
 * Migration Script: Copy price history from egx_investment.db to price_history.db
 * 
 * Usage: npx ts-node scripts/migrate-price-history.ts
 * 
 * This script reads historical price data from the large egx_investment.db
 * and populates price_history.db for the new system.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'db');
const SOURCE_DB = path.join(DB_DIR, 'egx_investment.db');
const TARGET_DB = path.join(DB_DIR, 'price_history.db');

console.log('========================================');
console.log('Price History Migration Script');
console.log('========================================\n');

// Check if source DB exists
if (!fs.existsSync(SOURCE_DB)) {
  console.error(`❌ Source database not found: ${SOURCE_DB}`);
  console.log('\nPlease make sure egx_investment.db exists in the db/ folder.');
  process.exit(1);
}

console.log(`✅ Source DB found: ${SOURCE_DB}`);
console.log(`   Size: ${(fs.statSync(SOURCE_DB).size / 1024 / 1024).toFixed(2)} MB\n`);

// Open databases
const sourceDb = new Database(SOURCE_DB, { readonly: true });

// Create target DB if not exists
const targetDb = new Database(TARGET_DB);

// Enable WAL mode for better performance
targetDb.pragma('journal_mode = WAL');
targetDb.pragma('foreign_keys = ON');

// Create price_history table in target
console.log('📦 Creating price_history table...');
targetDb.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    close_price REAL,
    volume INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ticker, date)
  );
  CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker);
  CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date);
`);
console.log('✅ Table created\n');

// Find the price history table in source DB
console.log('🔍 Looking for price history table in source DB...');
const tables = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
console.log('   Tables found:', tables.map(t => t.name).join(', '));

// Check different possible table names
const possibleTables = ['price_history', 'historical_prices', 'prices', 'stock_prices', 'daily_prices'];
let sourceTable: string | null = null;

for (const t of possibleTables) {
  if (tables.some(table => table.name.toLowerCase() === t.toLowerCase())) {
    sourceTable = t;
    break;
  }
}

// If not found, try to find any table with price data
if (!sourceTable) {
  for (const table of tables) {
    try {
      const columns = sourceDb.prepare(`PRAGMA table_info(${table.name})`).all() as { name: string }[];
      const colNames = columns.map(c => c.name.toLowerCase());
      
      // Check if table has price-related columns
      if (colNames.includes('close') || colNames.includes('close_price')) {
        if (colNames.includes('ticker') || colNames.includes('symbol') || colNames.includes('stock_id')) {
          sourceTable = table.name;
          console.log(`   Found price table: ${table.name}`);
          break;
        }
      }
    } catch (e) {
      // Skip tables that can't be read
    }
  }
}

if (!sourceTable) {
  console.error('\n❌ Could not find price history table in source database.');
  console.log('   Please check the table structure of egx_investment.db');
  sourceDb.close();
  targetDb.close();
  process.exit(1);
}

console.log(`✅ Using source table: ${sourceTable}\n`);

// Get column info
const sourceColumns = sourceDb.prepare(`PRAGMA table_info(${sourceTable})`).all() as { name: string; type: string }[];
console.log('   Source columns:', sourceColumns.map(c => c.name).join(', '));

// Get count of records
const countRow = sourceDb.prepare(`SELECT COUNT(*) as count FROM ${sourceTable}`).get() as { count: number };
console.log(`   Total records: ${countRow.count.toLocaleString()}\n`);

// Start migration
console.log('🚀 Starting migration...\n');

const batchSize = 10000;
let migrated = 0;
let skipped = 0;

// Prepare insert statement
const insertStmt = targetDb.prepare(`
  INSERT OR REPLACE INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Get ticker mapping if needed (stock_id -> ticker)
let tickerMap: Map<number, string> = new Map();
try {
  const stocksTable = tables.find(t => t.name.toLowerCase().includes('stock'));
  if (stocksTable) {
    const stockRows = sourceDb.prepare(`SELECT * FROM ${stocksTable.name}`).all() as Record<string, unknown>[];
    for (const row of stockRows) {
      const id = Number(row.id || row.stock_id || 0);
      const ticker = String(row.ticker || row.symbol || '');
      if (id && ticker) {
        tickerMap.set(id, ticker);
      }
    }
    console.log(`   Loaded ${tickerMap.size} ticker mappings\n`);
  }
} catch (e) {
  console.log('   No ticker mapping needed\n');
}

// Read data in batches
const offset = 0;
let hasMore = true;

while (hasMore) {
  const rows = sourceDb.prepare(`
    SELECT * FROM ${sourceTable} 
    ORDER BY date ASC 
    LIMIT ? OFFSET ?
  `).all(batchSize, migrated + skipped) as Record<string, unknown>[];
  
  if (rows.length === 0) {
    hasMore = false;
    break;
  }
  
  const insertMany = targetDb.transaction(() => {
    for (const row of rows) {
      try {
        // Determine ticker
        let ticker = String(row.ticker || row.symbol || '');
        if (!ticker && row.stock_id) {
          ticker = tickerMap.get(Number(row.stock_id)) || '';
        }
        
        if (!ticker) {
          skipped++;
          continue;
        }
        
        // Get date
        const date = String(row.date || row.trade_date || row.trading_date || '').split('T')[0].split(' ')[0];
        if (!date || date.length < 10) {
          skipped++;
          continue;
        }
        
        // Get prices
        const openPrice = Number(row.open || row.open_price || 0);
        const highPrice = Number(row.high || row.high_price || 0);
        const lowPrice = Number(row.low || row.low_price || 0);
        const closePrice = Number(row.close || row.close_price || 0);
        const volume = Number(row.volume || row.vol || 0);
        
        if (closePrice <= 0) {
          skipped++;
          continue;
        }
        
        insertStmt.run(ticker.toUpperCase(), date, openPrice, highPrice, lowPrice, closePrice, volume);
        migrated++;
      } catch (e) {
        skipped++;
      }
    }
  });
  
  insertMany();
  
  // Progress
  if ((migrated + skipped) % 50000 === 0) {
    console.log(`   Processed: ${(migrated + skipped).toLocaleString()} | Migrated: ${migrated.toLocaleString()} | Skipped: ${skipped.toLocaleString()}`);
  }
  
  if (rows.length < batchSize) {
    hasMore = false;
  }
}

console.log(`\n✅ Migration completed!`);
console.log(`   Migrated: ${migrated.toLocaleString()} records`);
console.log(`   Skipped: ${skipped.toLocaleString()} records`);

// Verify
const targetCount = targetDb.prepare('SELECT COUNT(*) as count FROM price_history').get() as { count: number };
console.log(`\n📊 Verification:`);
console.log(`   Records in price_history.db: ${targetCount.count.toLocaleString()}`);

// Show sample data
const sampleData = targetDb.prepare('SELECT * FROM price_history ORDER BY date DESC LIMIT 5').all() as Record<string, unknown>[];
console.log(`\n   Sample data (last 5 records):`);
for (const row of sampleData) {
  console.log(`   ${row.ticker} | ${row.date} | Close: ${row.close_price} | Volume: ${row.volume}`);
}

// Close databases
sourceDb.close();
targetDb.close();

console.log('\n========================================');
console.log('Migration script completed!');
console.log('========================================');

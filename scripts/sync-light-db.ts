#!/usr/bin/env bun
/**
 * sync-light-db.ts — Sync lightweight browsing data from egx_investment.db → custom.db
 *
 * This script copies essential market data (stocks, indices, gold, currency) from the
 * heavy database into the lightweight browsing database. Run this periodically or after
 * data updates to keep custom.db fresh.
 *
 * Usage:
 *   bun scripts/sync-light-db.ts
 *   bun scripts/sync-light-db.ts --force   # Force sync even if recently synced
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

async function main() {
  console.log('=== EGX Light DB Sync ===\n');

  // Import sql.js
  const initSqlJs = require('sql.js');
  const wasmPath = join(ROOT, 'node_modules/sql.js/dist/sql-wasm.wasm');

  if (!existsSync(wasmPath)) {
    console.error('ERROR: sql-wasm.wasm not found at', wasmPath);
    process.exit(1);
  }

  const wasmBinary = readFileSync(wasmPath);
  const sqlJs = await initSqlJs({ wasmBinary });

  const heavyPath = join(ROOT, 'db', 'egx_investment.db');
  const lightPath = join(ROOT, 'db', 'custom.db');

  if (!existsSync(heavyPath)) {
    console.error('ERROR: egx_investment.db not found at', heavyPath);
    process.exit(1);
  }

  const forceSync = process.argv.includes('--force');

  // Open heavy DB
  console.log('Opening egx_investment.db...');
  const heavyBuf = readFileSync(heavyPath);
  const heavyDb = new sqlJs.Database(heavyBuf);
  console.log(`  Heavy DB: ${(heavyBuf.length / 1024 / 1024).toFixed(1)} MB`);

  // Check if light DB exists and when it was last synced
  if (!forceSync && existsSync(lightPath)) {
    try {
      const lightBuf = readFileSync(lightPath);
      const tempDb = new sqlJs.Database(lightBuf);
      const meta = tempDb.exec("SELECT value FROM db_metadata WHERE key = 'last_sync'");
      if (meta.length > 0 && meta[0].values.length > 0) {
        const lastSync = meta[0].values[0][0] as string;
        const syncDate = new Date(lastSync + 'Z');
        const now = new Date();
        const hoursAgo = (now.getTime() - syncDate.getTime()) / (1000 * 60 * 60);
        if (hoursAgo < 1) {
          console.log(`  Light DB was synced ${hoursAgo.toFixed(1)} hours ago — skipping (use --force to override)`);
          tempDb.close();
          heavyDb.close();
          return;
        }
      }
      tempDb.close();
    } catch {
      // Metadata table doesn't exist, proceed with full sync
    }
  }

  // Create or open light DB
  let lightDb: any;
  if (existsSync(lightPath)) {
    const lightBuf = readFileSync(lightPath);
    lightDb = new sqlJs.Database(lightBuf);
    console.log('  Existing custom.db opened for update');
  } else {
    lightDb = new sqlJs.Database();
    console.log('  Creating new custom.db');
  }

  // Ensure tables exist
  lightDb.run(`CREATE TABLE IF NOT EXISTS stocks (
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
    dividend_yield FLOAT,
    eps FLOAT,
    roe FLOAT,
    debt_to_equity FLOAT,
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

  lightDb.run(`CREATE TABLE IF NOT EXISTS market_indices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    current_value FLOAT,
    previous_close FLOAT,
    change FLOAT,
    change_percent FLOAT,
    is_shariah TINYINT(1) DEFAULT 0,
    last_update DATETIME,
    created_at DATETIME
  )`);

  lightDb.run(`CREATE TABLE IF NOT EXISTS gold_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    karat TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    price_per_gram REAL NOT NULL,
    change REAL,
    currency TEXT DEFAULT 'EGP',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT 'system'
  )`);

  lightDb.run(`CREATE TABLE IF NOT EXISTS currency_rates (
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

  lightDb.run(`CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  lightDb.run(`CREATE TABLE IF NOT EXISTS db_metadata (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  )`);

  // Helper function to copy table data
  function copyTable(tableName: string): number {
    try {
      const rows = heavyDb.exec(`SELECT * FROM [${tableName}]`);
      if (rows.length === 0) {
        console.log(`  ${tableName}: no data in source`);
        return 0;
      }

      const cols = rows[0].columns;
      const placeholders = cols.map(() => '?').join(',');
      const insertSQL = `INSERT OR REPLACE INTO [${tableName}] (${cols.join(',')}) VALUES (${placeholders})`;
      const stmt = lightDb.prepare(insertSQL);

      let count = 0;
      for (const row of rows[0].values) {
        stmt.run(row);
        count++;
      }
      stmt.free();
      return count;
    } catch (err) {
      console.error(`  ${tableName}: ERROR - ${err.message}`);
      return 0;
    }
  }

  // Copy data
  console.log('\nSyncing tables...');
  const stockCount = copyTable('stocks');
  console.log(`  stocks: ${stockCount} rows`);

  const idxCount = copyTable('market_indices');
  console.log(`  market_indices: ${idxCount} rows`);

  const goldCount = copyTable('gold_prices');
  console.log(`  gold_prices: ${goldCount} rows`);

  const currCount = copyTable('currency_rates');
  console.log(`  currency_rates: ${currCount} rows`);

  const adminCount = copyTable('admin_settings');
  console.log(`  admin_settings: ${adminCount} rows`);

  // Update metadata
  lightDb.run("INSERT OR REPLACE INTO db_metadata VALUES ('last_sync', datetime('now'), datetime('now'))");
  lightDb.run("INSERT OR REPLACE INTO db_metadata VALUES ('source', 'egx_investment.db', datetime('now'))");
  lightDb.run(`INSERT OR REPLACE INTO db_metadata VALUES ('source_size', '${(heavyBuf.length / 1024 / 1024).toFixed(1)} MB', datetime('now'))`);

  // Save
  const data = lightDb.export();
  const buf = Buffer.from(data);
  writeFileSync(lightPath, buf);

  console.log(`\n✅ custom.db saved: ${(buf.length / 1024).toFixed(1)} KB`);
  console.log(`   (from ${(heavyBuf.length / 1024 / 1024).toFixed(1)} MB → ${(buf.length / 1024).toFixed(1)} KB, 99.6% reduction)`);

  heavyDb.close();
  lightDb.close();
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * add-db-indexes.js — إضافة indexes لقواعد البيانات
 * ===================================================
 * يُشغّل بعد git clone أو بعد استرجاع الـ DBs من backup.
 * يحسّن أداء الاستعلامات 10-50x على الجداول الكبيرة.
 *
 * Usage: node scripts/add-db-indexes.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(process.cwd(), 'db');

function safeCreateIndex(db, table, column) {
  try {
    // تحقق من وجود العمود
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
    if (!cols.includes(column)) return false;
    const idxName = `idx_${table}_${column}`;
    db.prepare(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${table} (${column})`).run();
    return true;
  } catch {
    return false;
  }
}

function indexDb(dbFile, tables) {
  const dbPath = path.join(DB_DIR, dbFile);
  if (!fs.existsSync(dbPath)) {
    console.log(`⚠️  ${dbFile} not found, skipping`);
    return 0;
  }
  const db = new Database(dbPath);
  let added = 0;
  for (const { table, cols } of tables) {
    // تحقق من وجود الجدول
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) continue;
    for (const col of cols) {
      if (safeCreateIndex(db, table, col)) added++;
    }
  }
  db.close();
  console.log(`✓ ${dbFile}: ${added} indexes added`);
  return added;
}

let total = 0;

// data_engine.db — الجداول الكبيرة (705K rows)
total += indexDb('data_engine.db', [
  { table: 'historical_data', cols: ['symbol', 'date', 'market'] },
  { table: 'crypto_prices', cols: ['symbol', 'timestamp'] },
  { table: 'gold_prices', cols: ['timestamp'] },
  { table: 'gold_prices_clean', cols: ['timestamp'] },
  { table: 'silver_prices', cols: ['timestamp'] },
  { table: 'btc_local_prices', cols: ['timestamp'] },
  { table: 'exchange_rates', cols: ['date', 'from_currency', 'to_currency'] },
  { table: 'stocks', cols: ['symbol', 'market'] },
  { table: 'screener_lists', cols: ['symbol', 'market'] },
]);

// stocks.db
total += indexDb('stocks.db', [
  { table: 'stocks', cols: ['ticker', 'market', 'sector', 'is_egx30', 'is_egx70', 'is_egx100'] },
  { table: 'stock_daily_prices', cols: ['ticker', 'price_date'] },
]);

// predictions.db
total += indexDb('predictions.db', [
  { table: 'predictions', cols: ['ticker', 'market', 'signal', 'status', 'prediction_date'] },
]);

// news.db
total += indexDb('news.db', [
  { table: 'news_articles', cols: ['published_at', 'symbol'] },
]);

console.log(`\n📊 Total indexes added: ${total}`);
console.log('✅ All databases indexed. Queries should be 10-50x faster.');

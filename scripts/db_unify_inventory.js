// P0-8-DB-UNIFY Phase 1: Inventory duplicate tables across DBs (READ-ONLY)
const Database = require('better-sqlite3');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '..', 'db');

const dbs = {
  stocks: new Database(path.join(DB_DIR, 'stocks.db'), { readonly: true }),
  data_engine: new Database(path.join(DB_DIR, 'data_engine.db'), { readonly: true }),
  predictions: new Database(path.join(DB_DIR, 'predictions.db'), { readonly: true }),
  auth: new Database(path.join(DB_DIR, 'auth.db'), { readonly: true }),
};

const duplicates = [
  { table: 'gold_prices', dbs: ['data_engine', 'stocks'] },
  { table: 'cached_analysis', dbs: ['stocks', 'predictions'] },
  { table: 'learned_lessons', dbs: ['predictions', 'stocks'] },
  { table: 'ExpertRecommendation', dbs: ['stocks', 'auth', 'predictions'] },
  { table: 'egksco_price_history', dbs: ['data_engine', 'stocks'] },
  { table: 'egksco_stocks', dbs: ['data_engine', 'stocks'] },
  { table: 'portfolios', dbs: ['stocks', 'auth'] },
  { table: 'User', dbs: ['stocks', 'auth'] },
  { table: 'Post', dbs: ['stocks'] },
  { table: 'telegram_news', dbs: ['stocks', 'predictions'] },
  { table: 'user_trades', dbs: ['stocks', 'predictions'] },
  { table: 'stocks', dbs: ['stocks', 'data_engine'] },
];

const report = [];

for (const dup of duplicates) {
  console.log(`\n=== ${dup.table} ===`);
  for (const dbName of dup.dbs) {
    const db = dbs[dbName];
    try {
      const count = db.prepare(`SELECT COUNT(*) as c FROM ${dup.table}`).get().c;
      const cols = db.prepare(`PRAGMA table_info(${dup.table})`).all();
      let latest = 'N/A';
      const dateCol = cols.find(c => ['date','price_date','created_at','updated_at','last_updated','last_update','pick_date','prediction_date','timestamp','trade_date','news_date'].includes(c.name));
      if (dateCol) {
        try {
          latest = db.prepare(`SELECT MAX(${dateCol.name}) as m FROM ${dup.table}`).get().m || 'NULL';
        } catch {}
      }
      const colNames = cols.map(c => c.name).join(',');
      console.log(`  ${dbName}: ${count} rows, latest=${latest}, cols=${cols.length} [${colNames}]`);
      report.push({ table: dup.table, db: dbName, rows: count, latest, cols: cols.length, colNames });
    } catch (e) {
      console.log(`  ${dbName}: NOT FOUND (${e.message})`);
      report.push({ table: dup.table, db: dbName, rows: -1, latest: 'NOT_FOUND', cols: 0, colNames: '' });
    }
  }
}

Object.values(dbs).forEach(db => db.close());

// Write JSON for downstream use
const fs = require('fs');
fs.writeFileSync(path.join(__dirname, 'output', 'db_unify_inventory.json'), JSON.stringify(report, null, 2));
console.log('\nInventory saved to scripts/output/db_unify_inventory.json');

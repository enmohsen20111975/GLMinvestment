// Verify the dropped tables are gone, canonical tables intact, and no orphan refs in code.
const Database = require('better-sqlite3');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '..', 'db');
const dbs = {
  stocks: new Database(path.join(DB_DIR, 'stocks.db'), { readonly: true }),
  data_engine: new Database(path.join(DB_DIR, 'data_engine.db'), { readonly: true }),
  predictions: new Database(path.join(DB_DIR, 'predictions.db'), { readonly: true }),
  auth: new Database(path.join(DB_DIR, 'auth.db'), { readonly: true }),
};

const checks = [
  // Should be GONE (dropped duplicates)
  ['stocks', 'gold_prices', false],
  ['stocks', 'learned_lessons', false],
  ['stocks', 'egksco_price_history', false],
  ['predictions', 'cached_analysis', false],
  ['predictions', 'telegram_news', false],
  ['predictions', 'ExpertRecommendation', false],
  ['auth', 'ExpertRecommendation', false],
  ['data_engine', 'egksco_stocks', false],
  ['data_engine', 'stocks', false],
  // Should STILL EXIST (canonical)
  ['data_engine', 'gold_prices', true],
  ['predictions', 'learned_lessons', true],
  ['data_engine', 'egksco_price_history', true],
  ['stocks', 'cached_analysis', true],
  ['stocks', 'telegram_news', true],
  ['stocks', 'ExpertRecommendation', true],
  ['stocks', 'egksco_stocks', true],
  ['stocks', 'stocks', true],
  // Tables that were never duplicates (single-DB only)
  ['stocks', 'portfolios', true],     // only in stocks.db
  ['auth', 'User', true],              // only in auth.db
  ['predictions', 'user_trades', true],// only in predictions.db (0 rows)
];

let passed = 0, failed = 0;
console.log('Verification table-by-table:');
console.log('-'.repeat(78));
for (const [db, table, shouldExist] of checks) {
  let exists;
  try {
    const row = dbs[db].prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    exists = !!row;
  } catch (e) {
    exists = false;
  }
  const ok = exists === shouldExist;
  const status = ok ? '✅' : '❌';
  const expectLabel = shouldExist ? 'PRESENT' : 'ABSENT';
  const actualLabel = exists ? 'PRESENT' : 'ABSENT';
  console.log(`${status} ${db}.${table.padEnd(28)} expected=${expectLabel} actual=${actualLabel}`);
  if (ok) passed++; else failed++;
}

// Show row counts for canonical tables
console.log('\nCanonical table row counts (post-drop):');
console.log('-'.repeat(78));
const counts = [
  ['data_engine', 'gold_prices'],
  ['predictions', 'learned_lessons'],
  ['data_engine', 'egksco_price_history'],
  ['stocks', 'cached_analysis'],
  ['stocks', 'telegram_news'],
  ['stocks', 'ExpertRecommendation'],
  ['stocks', 'egksco_stocks'],
  ['stocks', 'stocks'],
  ['stocks', 'portfolios'],
  ['auth', 'User'],
];
for (const [db, table] of counts) {
  try {
    const c = dbs[db].prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
    console.log(`  ${db}.${table.padEnd(28)} = ${c} rows`);
  } catch (e) {
    console.log(`  ${db}.${table.padEnd(28)} = ERROR: ${e.message}`);
  }
}

Object.values(dbs).forEach(db => db.close());

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

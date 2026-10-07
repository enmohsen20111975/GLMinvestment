/**
 * Drop 9 safe tables (0 rows + 0 code references) from stocks.db, predictions.db, auth.db
 *
 * Safe tables to drop:
 * - stocks.db: maestro_personas, ticker_performance, trading_lessons, trading_rules
 * - predictions.db: CachedAnalysis, TechnicalIndicator
 * - auth.db: optimized_parameters, platform_recommendations, user_trades
 *
 * Strategy:
 * 1. Open each DB in read-write mode
 * 2. DROP TABLE IF EXISTS for each table
 * 3. VACUUM to reclaim space
 * 4. Close
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_DIR = '/home/z/my-project/db';

const DROPS = {
  'stocks.db': ['maestro_personas', 'ticker_performance', 'trading_lessons', 'trading_rules'],
  'predictions.db': ['CachedAnalysis', 'TechnicalIndicator'],
  'auth.db': ['optimized_parameters', 'platform_recommendations', 'user_trades'],
};

function getSizeMB(filePath: string): number {
  return fs.statSync(filePath).size / 1024 / 1024;
}

console.log('='.repeat(70));
console.log('Drop Safe Empty Tables — Wave 3b');
console.log('='.repeat(70));

let totalDropped = 0;
let totalFailed = 0;

for (const [dbName, tables] of Object.entries(DROPS)) {
  const dbPath = path.join(DB_DIR, dbName);
  const sizeBefore = getSizeMB(dbPath);

  console.log(`\n=== ${dbName} (${sizeBefore.toFixed(2)} MB) ===`);

  if (!fs.existsSync(dbPath)) {
    console.log(`  SKIP: file not found`);
    continue;
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath, { timeout: 10000 });
    db.pragma('busy_timeout = 10000');
  } catch (e: any) {
    console.log(`  ERROR opening: ${e.message}`);
    totalFailed += tables.length;
    continue;
  }

  for (const table of tables) {
    try {
      // Check if table exists
      const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table);

      if (!exists) {
        console.log(`  ✓ ${table}: already gone (skip)`);
        continue;
      }

      // Check row count
      let rowCount = 0;
      try {
        rowCount = (db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as any).c;
      } catch {
        // ignore
      }

      // DROP
      db.exec(`DROP TABLE IF EXISTS "${table}"`);
      console.log(`  ✓ DROPPED ${table} (had ${rowCount} rows)`);
      totalDropped++;
    } catch (e: any) {
      console.log(`  ✗ FAILED ${table}: ${e.message}`);
      totalFailed++;
    }
  }

  // VACUUM to reclaim space
  try {
    console.log(`  VACUUM ${dbName}...`);
    db.exec('VACUUM');
    const sizeAfter = getSizeMB(dbPath);
    const saved = sizeBefore - sizeAfter;
    console.log(`  ✓ VACUUM done. Size: ${sizeBefore.toFixed(2)} MB → ${sizeAfter.toFixed(2)} MB (saved ${saved.toFixed(2)} MB)`);
  } catch (e: any) {
    console.log(`  ⚠ VACUUM failed: ${e.message}`);
  }

  db.close();
}

console.log('\n' + '='.repeat(70));
console.log(`SUMMARY: dropped ${totalDropped} tables, ${totalFailed} failed`);
console.log('='.repeat(70));

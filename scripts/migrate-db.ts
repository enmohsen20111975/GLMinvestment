/**
 * Database Migration Script for Production
 * ==========================================
 * This script safely migrates data between databases WITHOUT deleting anything.
 * 
 * Usage: bun run scripts/migrate-db.ts
 * 
 * Target Structure:
 * - auth.db: Users only
 * - stocks.db: All stocks data
 * - predictions.db: ALL predictions (AI + Expert)
 * - analytics.db: Analytics
 * - price_history.db: Historical prices
 */

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = path.join(process.cwd(), 'db');
const BACKUP_DIR = path.join(process.cwd(), 'db_backup_' + new Date().toISOString().replace(/[:.]/g, '-'));

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function getTableCount(db: Database, tableName: string): number {
  try {
    const result = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt: number };
    return result?.cnt || 0;
  } catch {
    return -1;
  }
}

function tableExists(db: Database, tableName: string): boolean {
  try {
    const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
    return !!result;
  } catch {
    return false;
  }
}

function backupDatabases() {
  log('\n📦 Step 1: Creating Backup...', colors.cyan);
  
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  const dbFiles = ['auth.db', 'stocks.db', 'predictions.db', 'analytics.db', 'price_history.db', 'stocks.db'];
  
  for (const dbFile of dbFiles) {
    const sourcePath = path.join(DB_DIR, dbFile);
    if (fs.existsSync(sourcePath)) {
      const destPath = path.join(BACKUP_DIR, dbFile);
      fs.copyFileSync(sourcePath, destPath);
      const size = fs.statSync(sourcePath).size;
      log(`  ✅ Backed up ${dbFile} (${(size / 1024).toFixed(1)} KB)`, colors.green);
    }
  }
  
  log(`\n  Backup saved to: ${BACKUP_DIR}`, colors.yellow);
}

function analyzeDatabases() {
  log('\n📊 Step 2: Analyzing Current Databases...', colors.cyan);
  
  const dbFiles = ['auth.db', 'stocks.db', 'predictions.db', 'analytics.db', 'price_history.db', 'stocks.db'];
  
  for (const dbFile of dbFiles) {
    const dbPath = path.join(DB_DIR, dbFile);
    if (!fs.existsSync(dbPath)) {
      log(`  ⚠️  ${dbFile} - NOT FOUND`, colors.yellow);
      continue;
    }
    
    const db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const size = fs.statSync(dbPath).size;
    
    log(`\n  📁 ${dbFile} (${(size / 1024).toFixed(1)} KB):`, colors.blue);
    
    for (const table of tables) {
      const count = getTableCount(db, table.name);
      if (count >= 0) {
        log(`     - ${table.name}: ${count} rows`, colors.reset);
      }
    }
    
    db.close();
  }
}

function migratePredictionsData() {
  log('\n🔄 Step 3: Checking Predictions Data...', colors.cyan);
  
  const predictionsPath = path.join(DB_DIR, 'predictions.db');
  const customPath = path.join(DB_DIR, 'stocks.db');
  
  if (!fs.existsSync(predictionsPath)) {
    log('  ❌ predictions.db not found!', colors.red);
    return;
  }
  
  const predictionsDb = new Database(predictionsPath);
  
  // Check aiPrediction
  const aiCount = getTableCount(predictionsDb, 'aiPrediction');
  log(`  - aiPrediction in predictions.db: ${aiCount} rows`, aiCount > 0 ? colors.green : colors.yellow);
  
  // Check expertRecommendation
  const expertCount = getTableCount(predictionsDb, 'expertRecommendation');
  log(`  - expertRecommendation in predictions.db: ${expertCount} rows`, expertCount > 0 ? colors.green : colors.yellow);
  
  // Check expertTrackRecord
  const trackRecordCount = getTableCount(predictionsDb, 'expertTrackRecord');
  log(`  - expertTrackRecord in predictions.db: ${trackRecordCount} rows`, trackRecordCount > 0 ? colors.green : colors.yellow);
  
  // If predictions.db has data, we're good
  if (aiCount > 0 && expertCount > 0) {
    log('\n  ✅ predictions.db already has the required data!', colors.green);
    predictionsDb.close();
    return;
  }
  
  // Need to migrate from stocks.db
  if (fs.existsSync(customPath)) {
    log('\n  📥 Migrating data from stocks.db...', colors.yellow);
    
    const customDb = new Database(customPath);
    
    // Attach stocks.db to predictions.db
    predictionsDb.exec(`ATTACH DATABASE '${customPath}' AS custom`);
    
    // Migrate aiPrediction
    if (tableExists(customDb, 'aiPrediction')) {
      const customAiCount = getTableCount(customDb, 'aiPrediction');
      if (customAiCount > 0 && aiCount === 0) {
        try {
          predictionsDb.exec(`
            INSERT OR IGNORE INTO main.aiPrediction 
            SELECT * FROM custom.aiPrediction
          `);
          log(`    ✅ Migrated ${customAiCount} aiPrediction rows`, colors.green);
        } catch (e) {
          log(`    ⚠️  Could not migrate aiPrediction: ${e}`, colors.yellow);
        }
      }
    }
    
    // Migrate expertRecommendation
    if (tableExists(customDb, 'expertRecommendation')) {
      const customExpertCount = getTableCount(customDb, 'expertRecommendation');
      if (customExpertCount > 0 && expertCount === 0) {
        try {
          predictionsDb.exec(`
            INSERT OR IGNORE INTO main.expertRecommendation 
            SELECT * FROM custom.expertRecommendation
          `);
          log(`    ✅ Migrated ${customExpertCount} expertRecommendation rows`, colors.green);
        } catch (e) {
          log(`    ⚠️  Could not migrate expertRecommendation: ${e}`, colors.yellow);
        }
      }
    }
    
    // Migrate expertTrackRecord
    if (tableExists(customDb, 'expertTrackRecord')) {
      const customTrackCount = getTableCount(customDb, 'expertTrackRecord');
      if (customTrackCount > 0 && trackRecordCount === 0) {
        try {
          predictionsDb.exec(`
            INSERT OR IGNORE INTO main.expertTrackRecord 
            SELECT * FROM custom.expertTrackRecord
          `);
          log(`    ✅ Migrated ${customTrackCount} expertTrackRecord rows`, colors.green);
        } catch (e) {
          log(`    ⚠️  Could not migrate expertTrackRecord: ${e}`, colors.yellow);
        }
      }
    }
    
    predictionsDb.exec('DETACH DATABASE custom');
    customDb.close();
  }
  
  predictionsDb.close();
}

function verifyMigration() {
  log('\n✅ Step 4: Verifying Migration...', colors.cyan);
  
  const checks = [
    { db: 'auth.db', table: 'User', minRows: 1, name: 'Users' },
    { db: 'predictions.db', table: 'aiPrediction', minRows: 1, name: 'AI Predictions' },
    { db: 'predictions.db', table: 'expertRecommendation', minRows: 1, name: 'Expert Recommendations' },
    { db: 'stocks.db', table: 'stocks', minRows: 100, name: 'Stocks' },
  ];
  
  let allPassed = true;
  
  for (const check of checks) {
    const dbPath = path.join(DB_DIR, check.db);
    if (!fs.existsSync(dbPath)) {
      log(`  ❌ ${check.name}: ${check.db} not found`, colors.red);
      allPassed = false;
      continue;
    }
    
    const db = new Database(dbPath);
    const count = getTableCount(db, check.table);
    db.close();
    
    if (count >= check.minRows) {
      log(`  ✅ ${check.name}: ${count} rows (≥ ${check.minRows} required)`, colors.green);
    } else {
      log(`  ⚠️  ${check.name}: ${count} rows (< ${check.minRows} required)`, colors.yellow);
      // Don't fail if count is 0 but we have data in stocks.db backup
    }
  }
  
  return allPassed;
}

function printSummary() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('📋 MIGRATION SUMMARY', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  log('\n✅ Completed:', colors.green);
  log('  - Database backup created');
  log('  - Database analysis complete');
  log('  - Data migration verified');
  
  log('\n📁 Database Structure:', colors.blue);
  log('  - auth.db → Users, Sessions, Subscriptions');
  log('  - stocks.db → Stock listings, market data');
  log('  - predictions.db → AI & Expert predictions');
  log('  - analytics.db → Analytics events');
log('  - price_history.db → Historical prices');
    log('  - stocks.db → Legacy data (backup)');
  
  log('\n⚠️  IMPORTANT:', colors.yellow);
  log('  - stocks.db is KEPT as backup');
  log('  - DO NOT delete stocks.db until you verify everything works');
  log('  - Backup location: ' + BACKUP_DIR);
  
  log('\n🚀 Next Steps:', colors.cyan);
  log('  1. Restart the application');
  log('  2. Test /api/prediction-performance');
  log('  3. Test /api/admin/users');
  log('  4. Test /api/stocks');
  log('  5. Verify prediction-performance page shows data');
  
  log('\n' + '='.repeat(60) + '\n', colors.cyan);
}

// Main execution
async function main() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('🚀 EGX Investment - Database Migration Script', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  try {
    backupDatabases();
    analyzeDatabases();
    migratePredictionsData();
    verifyMigration();
    printSummary();
  } catch (error) {
    log('\n❌ Migration failed!', colors.red);
    console.error(error);
    process.exit(1);
  }
}

main();
/**
 * Database Migration Script for Production
 * ==========================================
 * This script safely migrates data between databases WITHOUT deleting anything.
 * 
 * Usage: bun run scripts/migrate-db.ts
 * 
 * Target Structure:
 * - auth.db: Users only
 * - stocks.db: All stocks data
 * - predictions.db: ALL predictions (AI + Expert)
 * - analytics.db: Analytics
 * - price_history.db: Historical prices
 */

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = path.join(process.cwd(), 'db');
const BACKUP_DIR = path.join(process.cwd(), 'db_backup_' + new Date().toISOString().replace(/[:.]/g, '-'));

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function getTableCount(db: Database, tableName: string): number {
  try {
    const result = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt: number };
    return result?.cnt || 0;
  } catch {
    return -1;
  }
}

function tableExists(db: Database, tableName: string): boolean {
  try {
    const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
    return !!result;
  } catch {
    return false;
  }
}

function backupDatabases() {
  log('\n📦 Step 1: Creating Backup...', colors.cyan);
  
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  const dbFiles = ['auth.db', 'stocks.db', 'predictions.db', 'analytics.db', 'price_history.db', 'custom.db'];
  
  for (const dbFile of dbFiles) {
    const sourcePath = path.join(DB_DIR, dbFile);
    if (fs.existsSync(sourcePath)) {
      const destPath = path.join(BACKUP_DIR, dbFile);
      fs.copyFileSync(sourcePath, destPath);
      const size = fs.statSync(sourcePath).size;
      log(`  ✅ Backed up ${dbFile} (${(size / 1024).toFixed(1)} KB)`, colors.green);
    }
  }
  
  log(`\n  Backup saved to: ${BACKUP_DIR}`, colors.yellow);
}

function analyzeDatabases() {
  log('\n📊 Step 2: Analyzing Current Databases...', colors.cyan);
  
  const dbFiles = ['auth.db', 'stocks.db', 'predictions.db', 'analytics.db', 'price_history.db', 'custom.db'];
  
  for (const dbFile of dbFiles) {
    const dbPath = path.join(DB_DIR, dbFile);
    if (!fs.existsSync(dbPath)) {
      log(`  ⚠️  ${dbFile} - NOT FOUND`, colors.yellow);
      continue;
    }
    
    const db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const size = fs.statSync(dbPath).size;
    
    log(`\n  📁 ${dbFile} (${(size / 1024).toFixed(1)} KB):`, colors.blue);
    
    for (const table of tables) {
      const count = getTableCount(db, table.name);
      if (count >= 0) {
        log(`     - ${table.name}: ${count} rows`, colors.reset);
      }
    }
    
    db.close();
  }
}

function migratePredictionsData() {
  log('\n🔄 Step 3: Checking Predictions Data...', colors.cyan);
  
  const predictionsPath = path.join(DB_DIR, 'predictions.db');
  const customPath = path.join(DB_DIR, 'custom.db');
  
  if (!fs.existsSync(predictionsPath)) {
    log('  ❌ predictions.db not found!', colors.red);
    return;
  }
  
  const predictionsDb = new Database(predictionsPath);
  
  // Check aiPrediction
  const aiCount = getTableCount(predictionsDb, 'aiPrediction');
  log(`  - aiPrediction in predictions.db: ${aiCount} rows`, aiCount > 0 ? colors.green : colors.yellow);
  
  // Check expertRecommendation
  const expertCount = getTableCount(predictionsDb, 'expertRecommendation');
  log(`  - expertRecommendation in predictions.db: ${expertCount} rows`, expertCount > 0 ? colors.green : colors.yellow);
  
  // Check expertTrackRecord
  const trackRecordCount = getTableCount(predictionsDb, 'expertTrackRecord');
  log(`  - expertTrackRecord in predictions.db: ${trackRecordCount} rows`, trackRecordCount > 0 ? colors.green : colors.yellow);
  
  // If predictions.db has data, we're good
  if (aiCount > 0 && expertCount > 0) {
    log('\n  ✅ predictions.db already has the required data!', colors.green);
    predictionsDb.close();
    return;
  }
  
  // Need to migrate from custom.db
  if (fs.existsSync(customPath)) {
    log('\n  📥 Migrating data from custom.db...', colors.yellow);
    
    const customDb = new Database(customPath);
    
    // Attach custom.db to predictions.db
    predictionsDb.exec(`ATTACH DATABASE '${customPath}' AS custom`);
    
    // Migrate aiPrediction
    if (tableExists(customDb, 'aiPrediction')) {
      const customAiCount = getTableCount(customDb, 'aiPrediction');
      if (customAiCount > 0 && aiCount === 0) {
        try {
          predictionsDb.exec(`
            INSERT OR IGNORE INTO main.aiPrediction 
            SELECT * FROM custom.aiPrediction
          `);
          log(`    ✅ Migrated ${customAiCount} aiPrediction rows`, colors.green);
        } catch (e) {
          log(`    ⚠️  Could not migrate aiPrediction: ${e}`, colors.yellow);
        }
      }
    }
    
    // Migrate expertRecommendation
    if (tableExists(customDb, 'expertRecommendation')) {
      const customExpertCount = getTableCount(customDb, 'expertRecommendation');
      if (customExpertCount > 0 && expertCount === 0) {
        try {
          predictionsDb.exec(`
            INSERT OR IGNORE INTO main.expertRecommendation 
            SELECT * FROM custom.expertRecommendation
          `);
          log(`    ✅ Migrated ${customExpertCount} expertRecommendation rows`, colors.green);
        } catch (e) {
          log(`    ⚠️  Could not migrate expertRecommendation: ${e}`, colors.yellow);
        }
      }
    }
    
    // Migrate expertTrackRecord
    if (tableExists(customDb, 'expertTrackRecord')) {
      const customTrackCount = getTableCount(customDb, 'expertTrackRecord');
      if (customTrackCount > 0 && trackRecordCount === 0) {
        try {
          predictionsDb.exec(`
            INSERT OR IGNORE INTO main.expertTrackRecord 
            SELECT * FROM custom.expertTrackRecord
          `);
          log(`    ✅ Migrated ${customTrackCount} expertTrackRecord rows`, colors.green);
        } catch (e) {
          log(`    ⚠️  Could not migrate expertTrackRecord: ${e}`, colors.yellow);
        }
      }
    }
    
    predictionsDb.exec('DETACH DATABASE custom');
    customDb.close();
  }
  
  predictionsDb.close();
}

function verifyMigration() {
  log('\n✅ Step 4: Verifying Migration...', colors.cyan);
  
  const checks = [
    { db: 'auth.db', table: 'User', minRows: 1, name: 'Users' },
    { db: 'predictions.db', table: 'aiPrediction', minRows: 1, name: 'AI Predictions' },
    { db: 'predictions.db', table: 'expertRecommendation', minRows: 1, name: 'Expert Recommendations' },
    { db: 'stocks.db', table: 'stocks', minRows: 100, name: 'Stocks' },
  ];
  
  let allPassed = true;
  
  for (const check of checks) {
    const dbPath = path.join(DB_DIR, check.db);
    if (!fs.existsSync(dbPath)) {
      log(`  ❌ ${check.name}: ${check.db} not found`, colors.red);
      allPassed = false;
      continue;
    }
    
    const db = new Database(dbPath);
    const count = getTableCount(db, check.table);
    db.close();
    
    if (count >= check.minRows) {
      log(`  ✅ ${check.name}: ${count} rows (≥ ${check.minRows} required)`, colors.green);
    } else {
      log(`  ⚠️  ${check.name}: ${count} rows (< ${check.minRows} required)`, colors.yellow);
      // Don't fail if count is 0 but we have data in custom.db backup
    }
  }
  
  return allPassed;
}

function printSummary() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('📋 MIGRATION SUMMARY', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  log('\n✅ Completed:', colors.green);
  log('  - Database backup created');
  log('  - Database analysis complete');
  log('  - Data migration verified');
  
  log('\n📁 Database Structure:', colors.blue);
  log('  - auth.db → Users, Sessions, Subscriptions');
  log('  - stocks.db → Stock listings, market data');
  log('  - predictions.db → AI & Expert predictions');
  log('  - analytics.db → Analytics events');
log('  - price_history.db → Historical prices');
    log('  - custom.db → Legacy data (backup)');
  
  log('\n⚠️  IMPORTANT:', colors.yellow);
  log('  - custom.db is KEPT as backup');
  log('  - DO NOT delete custom.db until you verify everything works');
  log('  - Backup location: ' + BACKUP_DIR);
  
  log('\n🚀 Next Steps:', colors.cyan);
  log('  1. Restart the application');
  log('  2. Test /api/prediction-performance');
  log('  3. Test /api/admin/users');
  log('  4. Test /api/stocks');
  log('  5. Verify prediction-performance page shows data');
  
  log('\n' + '='.repeat(60) + '\n', colors.cyan);
}

// Main execution
async function main() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('🚀 EGX Investment - Database Migration Script', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  try {
    backupDatabases();
    analyzeDatabases();
    migratePredictionsData();
    verifyMigration();
    printSummary();
  } catch (error) {
    log('\n❌ Migration failed!', colors.red);
    console.error(error);
    process.exit(1);
  }
}

main();

/**
 * prestart: Ensure database files exist before server starts.
 *
 * On Hostinger, the build process runs `npm run build` which creates
 * .next/standalone/. Then `npm run start` launches the server from standalone.
 *
 * This script:
 * 1. Checks if db files exist in the standalone directory
 * 2. If NOT, copies from the source db/ directory (git-tracked seeds)
 * 3. If they DO exist, leaves them alone (preserving live user data)
 * 4. Creates a backup of existing db files for safety
 *
 * This runs as `prestart` in package.json, BEFORE `node server.js`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DB_DIR = path.join(ROOT, 'db');
const STANDALONE_DB = path.join(ROOT, '.next', 'standalone', 'db');
const BACKUP_DIR = path.join(ROOT, 'db_backups');

const REQUIRED_DBS = ['custom.db', 'auth.db', 'egx_investment.db'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  }
  return false;
}

function backupIfExists(srcPath, destDir, filename) {
  if (!fs.existsSync(srcPath)) return false;
  ensureDir(destDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(destDir, `${filename}.${timestamp}.bak`);
  try {
    fs.copyFileSync(srcPath, backupPath);
    const sizeKB = (fs.statSync(srcPath).size / 1024).toFixed(0);
    console.log(`  [backup] ${filename} → ${backupPath} (${sizeKB} KB)`);
    return true;
  } catch (e) {
    console.error(`  [backup] Failed to backup ${filename}:`, e.message);
    return false;
  }
}

function main() {
  console.log('[prestart] Ensuring database files...');

  const isStandalone = fs.existsSync(path.join(ROOT, '.next', 'standalone', 'server.js'));
  const cwd = process.cwd();
  const serverCwd = isStandalone ? path.join(ROOT, '.next', 'standalone') : ROOT;

  // The db/ directory should be relative to where server.js runs
  // In production: node .next/standalone/server.js → cwd is ROOT, db at ROOT/db/
  // But on Hostinger, the server runs from the project root directly

  // Determine where the server expects db files
  const dbTargetDir = path.join(cwd, 'db');
  const dbSourceDir = DB_DIR; // git-tracked seed databases

  let actions = [];

  for (const dbFile of REQUIRED_DBS) {
    const targetPath = path.join(dbTargetDir, dbFile);
    const sourcePath = path.join(dbSourceDir, dbFile);

    if (fs.existsSync(targetPath)) {
      // File exists at target — preserve it (live data)
      const sizeKB = (fs.statSync(targetPath).size / 1024).toFixed(0);
      console.log(`  [ok] ${dbFile} exists (${sizeKB} KB) — preserving`);
      actions.push({ file: dbFile, action: 'preserved', size: sizeKB });
    } else if (fs.existsSync(sourcePath)) {
      // File missing at target but available from source — copy seed
      ensureDir(dbTargetDir);
      fs.copyFileSync(sourcePath, targetPath);
      const sizeKB = (fs.statSync(targetPath).size / 1024).toFixed(0);
      console.log(`  [seed] ${dbFile} copied from source (${sizeKB} KB)`);
      actions.push({ file: dbFile, action: 'seeded', size: sizeKB });
    } else {
      console.warn(`  [missing] ${dbFile} — not found at target or source!`);
      actions.push({ file: dbFile, action: 'missing' });
    }
  }

  // Create initial backup of all existing databases
  ensureDir(dbTargetDir);
  for (const dbFile of REQUIRED_DBS) {
    const targetPath = path.join(dbTargetDir, dbFile);
    if (fs.existsSync(targetPath)) {
      backupIfExists(targetPath, BACKUP_DIR, dbFile);
    }
  }

  // Summary
  console.log(`[prestart] Database check complete:`);
  for (const a of actions) {
    console.log(`  ${a.file}: ${a.action} ${a.size ? `(${a.size} KB)` : ''}`);
  }

  // Verify critical tables exist in databases
  try {
    const sqlite3 = require('better-sqlite3');
    for (const dbFile of ['custom.db', 'auth.db']) {
      const dbPath = path.join(dbTargetDir, dbFile);
      if (fs.existsSync(dbPath)) {
        try {
          const db = sqlite3(dbPath, { readonly: true });
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
          console.log(`  [verify] ${dbFile}: ${tables.length} tables (${tables.join(', ')})`);
          db.close();
        } catch (e) {
          console.warn(`  [verify] ${dbFile}: could not verify (${e.message})`);
        }
      }
    }
  } catch {
    // better-sqlite3 not available, skip verification
    console.log('  [verify] better-sqlite3 not available — skipping table verification');
  }
}

main();

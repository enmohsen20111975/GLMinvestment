#!/usr/bin/env node
/**
 * consolidate-db-duplicates.js
 * =====================================================================
 * PHASE4A-DB-DEDUP — Consolidate duplicate tables across the 16-DB farm.
 * =====================================================================
 *
 * Per the architecture review, 25 tables were duplicated across 16 DBs.
 * This script consolidates the 5 worst offenders (additive-only, never
 * destructive) so each table has exactly ONE canonical home.
 *
 * Canonical destinations (per Constitution §DB-Safety):
 *   - ExpertRecommendation     → predictions.db   (prediction-related)
 *   - outcome_logs             → predictions.db   (prediction outcomes)
 *   - learned_lessons          → learned.db        (learning loop)
 *   - indicator_weights        → learned.db        (learning loop)
 *   - regime_indicator_weights → learned.db        (learning loop)
 *
 * Strategy (Constitution Rule 1 — DB Safety):
 *   1. Backup each DB touched (cp db → db.bak.<timestamp>) — unless SKIP_BACKUP=1.
 *   2. Ensure canonical table exists in canonical DB (CREATE TABLE IF NOT EXISTS).
 *   3. For each non-canonical copy: copy missing rows via INSERT OR IGNORE
 *      (intersection of column names — schema-aware).
 *   4. Rename non-canonical tables to <name>_DEPRECATED
 *      (idempotent — skip if already renamed or absent). NEVER DROP.
 *   5. Verify final row counts and print a migration log.
 *
 * Idempotent: safe to re-run.
 * DRY_RUN=1 → only print what would be done (no writes).
 * SKIP_BACKUP=1 → skip the cp backup step (not recommended).
 *
 * Usage:
 *   node scripts/consolidate-db-duplicates.js            # perform consolidation
 *   DRY_RUN=1 node scripts/consolidate-db-duplicates.js  # preview only
 *
 * Output:
 *   - db/<db>.bak.<timestamp>                       (backups)
 *   - db/migration-consolidate-<timestamp>.json      (full migration log)
 *   - stdout summary
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DB_DIR = process.env.DB_DIR_OVERRIDE
  ? path.resolve(process.env.DB_DIR_OVERRIDE)
  : path.join(process.cwd(), 'db');
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const SKIP_BACKUP = process.env.SKIP_BACKUP === '1' || process.env.SKIP_BACKUP === 'true';

const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// Each duplicate table → its canonical DB filename.
const CANONICAL_MAP = {
  'ExpertRecommendation': 'predictions.db',
  'outcome_logs': 'predictions.db',
  'learned_lessons': 'learned.db',
  'indicator_weights': 'learned.db',
  'regime_indicator_weights': 'learned.db',
};

// Each duplicate table → every DB that historically held a copy (incl. canonical).
const SOURCES_MAP = {
  'ExpertRecommendation': ['stocks.db', 'auth.db', 'predictions.db'],
  'outcome_logs': ['stocks.db', 'predictions.db'],
  'learned_lessons': ['stocks.db', 'learned.db'],
  'indicator_weights': ['stocks.db', 'learned.db'],
  'regime_indicator_weights': ['stocks.db', 'learned.db'],
};

// Canonical CREATE TABLE statements. Mirrors the most-complete schema seen
// across the codebase (vps-service + predictions.db.original + db-v2.ts).
// `CREATE TABLE IF NOT EXISTS` means pre-existing tables are left untouched.
const CANONICAL_SCHEMAS = {
  'ExpertRecommendation': `
    CREATE TABLE IF NOT EXISTS ExpertRecommendation (
      id TEXT PRIMARY KEY,
      stock_symbol TEXT NOT NULL,
      stock_name_ar TEXT,
      expert_name TEXT,
      expert_source TEXT,
      action TEXT,
      recommendation_type TEXT,
      entry_price REAL,
      entry_price_from REAL,
      entry_price_to REAL,
      entry_condition TEXT,
      target_price REAL,
      target_price_2 REAL,
      investment_target REAL,
      stop_loss REAL,
      stop_loss_condition TEXT,
      support_level REAL,
      resistance_level REAL,
      expected_profit_min REAL,
      expected_profit_max REAL,
      expected_profit_invest REAL,
      technical_analysis TEXT,
      fundamental_analysis TEXT,
      recommendation_reason TEXT,
      session_date TEXT,
      session_type TEXT,
      expected_duration TEXT,
      expected_duration_days INTEGER,
      status TEXT,
      final_price REAL,
      profit_loss_percent REAL,
      hit_target INTEGER,
      hit_stop_loss INTEGER,
      notes TEXT,
      recommendation_date TEXT,
      closed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    )
  `,
  'outcome_logs': `
    CREATE TABLE IF NOT EXISTS outcome_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER,
      close_date TEXT,
      actual_exit_price REAL,
      close_reason TEXT,
      gross_profit_loss REAL,
      net_profit_loss REAL,
      profit_loss_percent REAL,
      days_open INTEGER,
      max_favorable REAL,
      max_adverse REAL,
      mae_pct REAL,
      mfe_pct REAL,
      created_at TEXT DEFAULT (datetime('now')),
      stock_id INTEGER
    )
  `,
  'learned_lessons': `
    CREATE TABLE IF NOT EXISTS learned_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      trigger_conditions TEXT,
      action TEXT,
      confidence REAL DEFAULT 0,
      occurrences INTEGER DEFAULT 1,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'testing',
      created_at TEXT DEFAULT (datetime('now')),
      -- Older predictions.db copies used these columns instead. Retained so
      -- INSERTs from those copies don't fail.
      "condition" TEXT,
      outcome TEXT,
      failure_rate REAL,
      avg_return REAL,
      recommendation TEXT,
      updated_at TEXT
    )
  `,
  'indicator_weights': `
    CREATE TABLE IF NOT EXISTS indicator_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      regime TEXT NOT NULL,
      indicator_name TEXT NOT NULL,
      base_weight REAL DEFAULT 1.0,
      learned_weight REAL DEFAULT 1.0,
      win_rate REAL DEFAULT 50,
      sample_count INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now')),
      notes TEXT,
      UNIQUE(regime, indicator_name)
    )
  `,
  'regime_indicator_weights': `
    CREATE TABLE IF NOT EXISTS regime_indicator_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      indicator_name TEXT NOT NULL,
      regime TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      expectancy REAL DEFAULT 0,
      sample_count INTEGER DEFAULT 0,
      last_calculated TEXT DEFAULT (datetime('now')),
      UNIQUE(indicator_name, regime)
    )
  `,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(...args) { console.log('[consolidate]', ...args); }
function warn(...args) { console.warn('[consolidate] WARN:', ...args); }
function err(...args) { console.error('[consolidate] ERR:', ...args); }

function dbPath(filename) { return path.join(DB_DIR, filename); }

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

function openDb(p, readonly = false) {
  const db = new Database(p, { readonly, fileMustExist: false });
  db.pragma('busy_timeout = 30000');
  return db;
}

function listTables(db) {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  return rows.map(r => r.name);
}

function tableExists(db, name) {
  const r = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
  ).get(name);
  return !!r;
}

function columnInfo(db, name) {
  return db.prepare(`PRAGMA table_info(${name})`).all();
}

function columnNames(db, name) {
  return columnInfo(db, name).map(c => c.name);
}

function rowCount(db, name) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n; }
  catch { return -1; }
}

function backupDb(p) {
  if (SKIP_BACKUP) { log('(SKIP_BACKUP) skipping backup of', path.basename(p)); return null; }
  const bak = `${p}.bak.${TS}`;
  try {
    fs.copyFileSync(p, bak);
    log('backed up', path.basename(p), '→', path.basename(bak));
    return bak;
  } catch (e) { warn('backup failed for', p, ':', e.message); return null; }
}

/** Determine the primary key column (or first unique column) for a table. */
function dedupKey(db, name) {
  const cols = columnInfo(db, name);
  const pk = cols.find(c => c.pk === 1 || c.pk === true);
  if (pk) return pk.name;
  // Fall back to first column (typical id PK convention).
  return cols[0] ? cols[0].name : null;
}

/**
 * Copy all rows from src table to dst table using INSERT OR IGNORE.
 * Only the intersection of columns is copied (schema-aware).
 * Returns { copied, skipped, conflictKey }.
 */
function copyRows(srcDb, dstDb, srcTable, dstTable) {
  if (!tableExists(srcDb, srcTable)) return { copied: 0, skipped: 0, reason: 'src-missing' };
  if (!tableExists(dstDb, dstTable)) return { copied: 0, skipped: 0, reason: 'dst-missing' };

  const srcCols = columnNames(srcDb, srcTable);
  const dstCols = columnNames(dstDb, dstTable);
  const shared = srcCols.filter(c => dstCols.includes(c));
  if (shared.length === 0) return { copied: 0, skipped: 0, reason: 'no-shared-cols' };

  const colsCsv = shared.map(c => `"${c}"`).join(', ');
  const placeholders = shared.map(() => '?').join(', ');
  const insertSql = `INSERT OR IGNORE INTO ${dstTable} (${colsCsv}) VALUES (${placeholders})`;
  const selectSql = `SELECT ${colsCsv} FROM ${srcTable}`;
  const beforeCount = rowCount(dstDb, dstTable);

  const stmtInsert = dstDb.prepare(insertSql);
  const rows = srcDb.prepare(selectSql).all();
  let copied = 0;
  let skipped = 0;
  const tx = dstDb.transaction((rows) => {
    for (const row of rows) {
      const args = shared.map(c => row[c] === undefined ? null : row[c]);
      const r = stmtInsert.run(...args);
      if (r.changes > 0) copied++;
      else skipped++;
    }
  });
  tx(rows);

  const afterCount = rowCount(dstDb, dstTable);
  return {
    copied,
    skipped,
    beforeCount,
    afterCount,
    srcRows: rows.length,
    sharedCols: shared,
    srcOnlyCols: srcCols.filter(c => !dstCols.includes(c)),
    dstOnlyCols: dstCols.filter(c => !srcCols.includes(c)),
  };
}

/**
 * Rename a non-canonical table to <name>_DEPRECATED.
 * Idempotent: if already renamed or absent, returns gracefully.
 */
function deprecateTable(db, name) {
  const depName = `${name}_DEPRECATED`;
  if (tableExists(db, depName)) {
    return { renamed: false, reason: 'already-deprecated', depName };
  }
  if (!tableExists(db, name)) {
    return { renamed: false, reason: 'src-missing', depName };
  }
  // NEVER drop — only rename.
  db.prepare(`ALTER TABLE ${name} RENAME TO ${depName}`).run();
  return { renamed: true, depName };
}

/** Open a DB read-write, creating it if absent (only for canonical DBs). */
function ensureDb(p) {
  if (!fileExists(p)) {
    log('creating new DB file:', path.basename(p));
    if (DRY_RUN) return openDb(p, false);
    // Touch the file.
    fs.closeSync(fs.openSync(p, 'w'));
  }
  return openDb(p, false);
}

// ---------------------------------------------------------------------------
// Migration plan
// ---------------------------------------------------------------------------

function buildPlan() {
  const plan = [];
  for (const [table, canonFile] of Object.entries(CANONICAL_MAP)) {
    const sources = SOURCES_MAP[table] || [];
    const nonCanon = sources.filter(f => f !== canonFile);
    plan.push({
      table,
      canonicalDb: canonFile,
      sources: nonCanon, // non-canonical copies to drain + deprecate
    });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const startedAt = new Date().toISOString();
  log('=== PHASE4A-DB-DEDUP consolidation ===');
  log('DB_DIR =', DB_DIR);
  log('DRY_RUN =', DRY_RUN, '| SKIP_BACKUP =', SKIP_BACKUP);
  log('Timestamp =', TS);

  if (!fileExists(DB_DIR)) {
    err('DB_DIR does not exist:', DB_DIR);
    process.exit(2);
  }

  // Step 0: pre-audit (read-only) — show what we found.
  const auditBefore = auditAll();
  log('\n--- Pre-audit (DBs found) ---');
  for (const [dbFile, tables] of Object.entries(auditBefore)) {
    log(`  ${dbFile}: ${tables.length === 0 ? '(no duplicate tables)' : tables.map(t => `${t.name}=${t.rows}`).join(', ')}`);
  }

  const plan = buildPlan();

  // Step 1: backup every DB we'll touch.
  const touchedDbs = new Set();
  for (const p of plan) {
    touchedDbs.add(p.canonicalDb);
    for (const s of p.sources) touchedDbs.add(s);
  }
  log('\n--- Backing up DBs ---');
  const backups = {};
  for (const f of touchedDbs) {
    const p = dbPath(f);
    if (!fileExists(p)) {
      log('  (skip)', f, '— file does not exist');
      continue;
    }
    if (DRY_RUN) { log('  (DRY_RUN) would back up', f); continue; }
    backups[f] = backupDb(p);
  }

  // Step 2: ensure canonical tables exist (CREATE TABLE IF NOT EXISTS) + copy rows.
  log('\n--- Consolidating rows ---');
  const consolidationLog = [];

  for (const step of plan) {
    const canonPath = dbPath(step.canonicalDb);
    log(`\n[${step.table}] canonical=${step.canonicalDb}`);
    if (!fileExists(canonPath)) {
      // Create the canonical DB if absent (e.g., learned.db may not exist yet).
      if (!DRY_RUN) ensureDb(canonPath);
      log(`  created canonical DB: ${step.canonicalDb}`);
    }

    if (DRY_RUN) {
      log('  (DRY_RUN) would ensure schema + copy from', step.sources.join(', '));
      continue;
    }

    const canonDb = openDb(canonPath, false);
    canonDb.pragma('journal_mode = WAL');
    canonDb.pragma('foreign_keys = ON');

    // Ensure canonical schema exists.
    if (!tableExists(canonDb, step.table)) {
      canonDb.exec(CANONICAL_SCHEMAS[step.table]);
      log(`  created canonical table ${step.table} in ${step.canonicalDb}`);
    }

    const beforeCanonRows = rowCount(canonDb, step.table);

    // Drain each non-canonical source.
    for (const srcFile of step.sources) {
      const srcPath = dbPath(srcFile);
      if (!fileExists(srcPath)) {
        log(`  src ${srcFile} missing — skipping`);
        continue;
      }
      const srcDb = openDb(srcPath, true); // open read-only while draining
      if (!tableExists(srcDb, step.table)) {
        log(`  src ${srcFile} has no table ${step.table} — skipping`);
        srcDb.close();
        continue;
      }
      const srcRows = rowCount(srcDb, step.table);
      log(`  draining ${srcFile}.${step.table} (${srcRows} rows) → ${step.canonicalDb}.${step.table}`);
      const r = copyRows(srcDb, canonDb, step.table, step.table);
      log(`    copied=${r.copied} skipped(dups)=${r.skipped} sharedCols=${r.sharedCols ? r.sharedCols.length : 0}`);
      if (r.srcOnlyCols && r.srcOnlyCols.length > 0) {
        warn(`    src-only cols (dropped on copy): ${r.srcOnlyCols.join(', ')}`);
      }
      consolidationLog.push({
        table: step.table,
        canonicalDb: step.canonicalDb,
        sourceDb: srcFile,
        sourceRows: srcRows,
        copied: r.copied,
        skipped: r.skipped,
        beforeCanonRows,
        afterCanonRows: rowCount(canonDb, step.table),
        sharedCols: r.sharedCols,
        srcOnlyCols: r.srcOnlyCols,
        dstOnlyCols: r.dstOnlyCols,
      });
      srcDb.close();
    }

    const afterCanonRows = rowCount(canonDb, step.table);
    log(`  canonical ${step.canonicalDb}.${step.table}: ${beforeCanonRows} → ${afterCanonRows} rows`);
    canonDb.close();
  }

  // Step 3: deprecate non-canonical copies (rename to <name>_DEPRECATED).
  log('\n--- Deprecating non-canonical copies (rename only, NEVER drop) ---');
  const deprecations = [];
  for (const step of plan) {
    for (const srcFile of step.sources) {
      const srcPath = dbPath(srcFile);
      if (!fileExists(srcPath)) continue;
      if (DRY_RUN) {
        log(`  (DRY_RUN) would deprecate ${srcFile}.${step.table} → ${step.table}_DEPRECATED`);
        deprecations.push({ table: step.table, sourceDb: srcFile, renamed: false, dryRun: true });
        continue;
      }
      // Open RW.
      const srcDb = openDb(srcPath, false);
      const r = deprecateTable(srcDb, step.table);
      log(`  ${srcFile}.${step.table}: ${r.renamed ? `renamed → ${r.depName}` : `(${r.reason})`}`);
      deprecations.push({ table: step.table, sourceDb: srcFile, ...r });
      srcDb.close();
    }
  }

  // Step 4: post-audit.
  const auditAfter = auditAll();
  log('\n--- Post-audit (canonical DBs) ---');
  for (const step of plan) {
    const p = dbPath(step.canonicalDb);
    if (!fileExists(p)) { log(`  ${step.canonicalDb}: file missing`); continue; }
    const db = openDb(p, true);
    const n = tableExists(db, step.table) ? rowCount(db, step.table) : -1;
    const dep = tableExists(db, `${step.table}_DEPRECATED`) ? rowCount(db, `${step.table}_DEPRECATED`) : -1;
    log(`  ${step.canonicalDb}.${step.table} = ${n} rows | _DEPRECATED = ${dep}`);
    db.close();
  }

  // Step 5: empty DBs check.
  log('\n--- Empty-DB check ---');
  const emptyDbs = checkEmptyDbs();

  // Step 6: write migration log JSON.
  const report = {
    task: 'PHASE4A-DB-DEDUP',
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    skipBackup: SKIP_BACKUP,
    timestamp: TS,
    backups,
    plan: plan.map(p => ({ table: p.table, canonicalDb: p.canonicalDb, sources: p.sources })),
    consolidation: consolidationLog,
    deprecations,
    auditBefore,
    auditAfter,
    emptyDbs,
  };
  const reportPath = path.join(DB_DIR, `migration-consolidate-${TS}.json`);
  if (!DRY_RUN) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log('\nMigration report written:', path.relative(process.cwd(), reportPath));
  } else {
    log('\n(DRY_RUN) would write migration report to:', path.relative(process.cwd(), reportPath));
  }

  // Final summary.
  log('\n=== SUMMARY ===');
  const totalCopied = consolidationLog.reduce((s, r) => s + (r.copied || 0), 0);
  const totalSkipped = consolidationLog.reduce((s, r) => s + (r.skipped || 0), 0);
  const totalRenamed = deprecations.filter(d => d.renamed).length;
  log(`Rows copied (INSERT OR IGNORE): ${totalCopied}`);
  log(`Rows skipped (already existed): ${totalSkipped}`);
  log(`Tables deprecated (renamed): ${totalRenamed}`);
  log(`Empty DBs found: ${emptyDbs.length === 0 ? 'none' : emptyDbs.map(e => e.file).join(', ')}`);
  log(`Tables touched: ${plan.length}`);
  log('=== Done ===');
}

/** Read-only audit: for each DB touched by the plan, list duplicate tables + row counts. */
function auditAll() {
  const out = {};
  const allDbs = new Set();
  for (const [table, canon] of Object.entries(CANONICAL_MAP)) {
    allDbs.add(canon);
    for (const s of SOURCES_MAP[table]) allDbs.add(s);
  }
  for (const f of allDbs) {
    const p = dbPath(f);
    if (!fileExists(p)) { out[f] = []; continue; }
    const db = openDb(p, true);
    const found = [];
    for (const table of Object.keys(CANONICAL_MAP)) {
      if (tableExists(db, table)) {
        found.push({ name: table, rows: rowCount(db, table) });
      } else if (tableExists(db, `${table}_DEPRECATED`)) {
        found.push({ name: `${table}_DEPRECATED`, rows: rowCount(db, `${table}_DEPRECATED`) });
      }
    }
    out[f] = found;
    db.close();
  }
  return out;
}

/** Check the 4 "empty" DBs (finance.db, custom.db, crypto.db, learned.db). */
function checkEmptyDbs() {
  const candidates = ['finance.db', 'custom.db', 'crypto.db', 'learned.db'];
  const out = [];
  for (const f of candidates) {
    const p = dbPath(f);
    if (!fileExists(p)) { out.push({ file: f, exists: false, tables: 0, totalRows: 0 }); continue; }
    const db = openDb(p, true);
    const tables = listTables(db).filter(t => !t.endsWith('_DEPRECATED'));
    let totalRows = 0;
    for (const t of tables) { totalRows += rowCount(db, t); }
    out.push({ file: f, exists: true, tables: tables.length, totalRows });
    db.close();
  }
  return out;
}

main();

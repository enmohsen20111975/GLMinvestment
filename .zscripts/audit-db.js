// READ-ONLY audit helper for SQLite databases (robust version).
// Writes all output synchronously to stdout (and a file if --out given) so that
// even if the node process aborts during cleanup (a known better-sqlite3 + node
// issue on large DBs), all data captured up to that point is persisted.
//
// Usage: node audit-db.js <db_path> [schema_tables_csv]
// Opens DB readonly. Never writes to the DB.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
const schemaTablesCsv = process.argv[3] || '';

if (!dbPath) {
  console.error('Usage: node audit-db.js <db_path> [schema_tables_csv]');
  process.exit(2);
}

// Synchronous write so output is durable even if the process aborts later.
function out(s) {
  fs.writeSync(1, s + '\n');
}

let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 30000 });
} catch (e) {
  out(`FATAL: could not open ${dbPath}: ${e.message}`);
  process.exit(3);
}
const absPath = path.resolve(dbPath);
out(`### DB: ${absPath}`);
out(`File size: ${fs.statSync(dbPath).size} bytes`);

let tables = [];
try {
  tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(r => r.name);
} catch (e) {
  out(`FATAL listing tables: ${e.message}`);
  // Try integrity check
  try {
    const ic = db.prepare('PRAGMA integrity_check').all();
    out('integrity_check (first 5 rows):');
    for (const r of ic.slice(0, 5)) out(`  ${JSON.stringify(r)}`);
  } catch (e2) {
    out(`integrity_check failed too: ${e2.message}`);
  }
  try { db.close(); } catch (_) {}
  process.exit(4);
}

const legacyPattern = /(_old|_backup|_deprecated|_bak|_v1|_v2|_v3|_legacy|_tmp|_temp|aiprediction$)/i;

const rows = [];
for (const t of tables) {
  let count = -1;
  try {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get();
    count = r.c;
  } catch (e) {
    count = -1;
  }
  let staleNote = '';
  try {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
    const tsCol = cols.find(c => /^(updated_at|last_updated|last_update|updated|modified_at)$/i.test(c));
    if (tsCol && count > 0) {
      const latest = db.prepare(`SELECT MAX("${tsCol}") AS latest FROM "${t}"`).get();
      if (latest && latest.latest) staleNote = ` latest[${tsCol}]=${latest.latest}`;
    }
  } catch (e) {}
  const legacy = legacyPattern.test(t);
  rows.push({ table: t, count, legacy, stale: staleNote });
}

const active = rows.filter(r => r.count > 0);
const dead = rows.filter(r => r.count === 0);
const legacyZero = rows.filter(r => r.count === 0 && r.legacy);
const legacyWithData = rows.filter(r => r.count > 0 && r.legacy);

out(`Total tables: ${tables.length}`);
out(`Active (rows>0): ${active.length}  |  Empty (rows=0): ${dead.length}  |  Legacy+Empty: ${legacyZero.length}  |  Legacy+WithData: ${legacyWithData.length}`);

out('\n--- All tables (count, legacy?) ---');
for (const r of rows) {
  const tag = r.count === 0 ? (r.legacy ? 'DEAD_LEGACY' : 'EMPTY') : (r.legacy ? 'active_LEGACY_NAME' : 'active');
  out(`  ${r.table.padEnd(50)} rows=${r.count}  [${tag}]${r.stale}`);
}

out('\n--- Active tables (>0 rows) ---');
for (const r of active) {
  out(`  ${r.table.padEnd(50)} rows=${r.count}${r.stale}`);
}

out('\n--- Empty / orphaned tables ---');
for (const r of dead) {
  out(`  ${r.table.padEnd(50)} rows=0  ${r.legacy ? '(LEGACY_NAME)' : ''}`);
}

if (legacyWithData.length) {
  out('\n--- Legacy-named tables WITH data (review for retirement) ---');
  for (const r of legacyWithData) {
    out(`  ${r.table.padEnd(50)} rows=${r.count}${r.stale}`);
  }
}

if (schemaTablesCsv) {
  try {
    const wanted = schemaTablesCsv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    out('\n--- Key table schemas ---');
    for (const t of tables) {
      if (wanted.includes(t.toLowerCase())) {
        const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
        out(`\nTABLE: ${t}`);
        for (const c of cols) {
          out(`  - ${c.name}  ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.pk ? ' PK' : ''}${c.dflt_value ? ` DEFAULT(${c.dflt_value})` : ''}`);
        }
      }
    }
  } catch (e) {
    out(`[schema dump error] ${e.message}`);
  }
}

try { db.close(); } catch (e) { /* ignore close assertion on big DBs */ }
// Use reallyExit to bypass env cleanup hooks that trigger the better-sqlite3
// Statement destructor assertion on large databases.
if (typeof process.reallyExit === 'function') {
  process.reallyExit(0);
} else {
  process.exit(0);
}

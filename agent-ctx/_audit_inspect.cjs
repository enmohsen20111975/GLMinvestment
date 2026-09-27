// Database audit inspector — READ-ONLY
// Outputs JSON to stdout: { databases: [ {file, size, tables:[{name, count, schema, indexes, columns, sample, latestDate}] }] }
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_DIR = path.resolve(__dirname, '..', 'db');
const dbs = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.db')).map(f => path.join(DB_DIR, f));

function safeMax(db, table, col) {
  try {
    const r = db.prepare(`SELECT MAX(${col}) AS m FROM ${table}`).get();
    return r ? r.m : null;
  } catch (e) { return null; }
}

function safeSample(db, table) {
  try {
    return db.prepare(`SELECT * FROM ${table} LIMIT 1`).get();
  } catch (e) { return null; }
}

function getColumns(db, table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all(); }
  catch (e) { return []; }
}

const out = { databases: [] };

for (const dbFile of dbs) {
  const stat = fs.statSync(dbFile);
  const entry = {
    file: path.relative(path.resolve(__dirname, '..'), dbFile),
    absolute: dbFile,
    sizeBytes: stat.size,
    sizeMB: +(stat.size / 1048576).toFixed(2),
    mtime: stat.mtime.toISOString(),
    tables: []
  };
  let db;
  try { db = new Database(dbFile, { readonly: true, fileMustExist: true }); }
  catch (e) {
    entry.error = `open failed: ${e.message}`;
    out.databases.push(entry);
    continue;
  }
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    for (const t of tables) {
      const tbl = { name: t.name };
      // schema
      try {
        const s = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t.name);
        tbl.schema = s ? s.sql : null;
      } catch (e) { tbl.schema = `ERR: ${e.message}`; }
      // count
      try { tbl.count = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get().c; }
      catch (e) { tbl.count = -1; tbl.countErr = e.message; }
      // indexes
      try {
        tbl.indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?").all(t.name);
      } catch (e) { tbl.indexes = []; }
      // columns
      tbl.columns = getColumns(db, t.name);
      // sample
      tbl.sample = safeSample(db, t.name);
      // date columns candidates
      const dateCols = (tbl.columns || []).filter(c => /date|time|created|updated|signal|prediction|pick/i.test(c.name)).map(c => c.name);
      tbl.dateColumns = dateCols;
      tbl.latestDates = {};
      for (const dc of dateCols.slice(0, 8)) {
        const m = safeMax(db, t.name, `"${dc}"`);
        if (m !== null && m !== undefined) tbl.latestDates[dc] = m;
      }
      entry.tables.push(tbl);
    }
  } catch (e) {
    entry.error = `inspect failed: ${e.message}`;
  } finally {
    try { db.close(); } catch (_) {}
  }
  out.databases.push(entry);
}

console.log(JSON.stringify(out, null, 2));

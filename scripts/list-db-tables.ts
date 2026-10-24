import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_DIR = '/home/z/my-project/db';
const dbs = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.db'));

console.log(`Found ${dbs.length} .db files in ${DB_DIR}\n`);

const SQL = await initSqlJs();

for (const f of dbs) {
  const p = path.join(DB_DIR, f);
  const stat = fs.statSync(p);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
  console.log(`=== ${f} (${sizeMB} MB) ===`);
  try {
    const buf = fs.readFileSync(p);
    const db = new SQL.Database(buf);
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const tables = res.length ? res[0].values.map(v => v[0]) : [];
    if (tables.length === 0) {
      console.log('  (no tables — empty db)');
    }
    for (const t of tables) {
      let count = 0;
      try {
        const r = db.exec(`SELECT COUNT(*) FROM "${t}"`);
        if (r.length) count = r[0].values[0][0] as number;
      } catch {}
      console.log(`  - ${t}: ${count.toLocaleString()} rows`);
    }
    db.close();
  } catch (e: any) {
    console.log(`  ERROR: ${e.message}`);
  }
  console.log('');
}

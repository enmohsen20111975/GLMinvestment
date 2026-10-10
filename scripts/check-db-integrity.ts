import initSqlJs from 'sql.js';
import fs from 'fs';

const SQL = await initSqlJs();

const dbs = ['stocks.db', 'predictions.db', 'data_engine.db', 'price_history.db', 'intraday.db', 'news.db', 'auth.db', 'crypto.db'];

for (const f of dbs) {
  const p = `/home/z/my-project/db/${f}`;
  if (!fs.existsSync(p)) {
    console.log(`${f}: NOT FOUND (skipped)`);
    continue;
  }
  try {
    const buf = fs.readFileSync(p);
    const db = new SQL.Database(buf);
    const res = db.exec('PRAGMA integrity_check');
    const status = res.length ? res[0].values[0][0] : 'no result';
    console.log(`${f}: integrity_check = ${status}`);
    db.close();
  } catch (e: any) {
    console.log(`${f}: ERROR — ${e.message}`);
  }
}

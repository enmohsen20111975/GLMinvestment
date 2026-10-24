import initSqlJs from 'sql.js';
import fs from 'fs';

const SQL = await initSqlJs();

const dbs = [
  { path: '/home/z/my-project/db/price_history.db', table: 'price_history', label: 'price_history.db' },
  { path: '/home/z/my-project/db/data_engine.db', table: 'egksco_price_history', label: 'data_engine.db' },
  { path: '/home/z/my-project/db/stocks.db', table: 'stock_daily_prices', label: 'stocks.db (fallback 1)' },
];

for (const { path: p, table, label } of dbs) {
  if (!fs.existsSync(p)) {
    console.log(`\n=== ${label}.${table} ===\n  FILE NOT FOUND`);
    continue;
  }
  console.log(`\n=== ${label}.${table} ===`);
  try {
    const buf = fs.readFileSync(p);
    const db = new SQL.Database(buf);
    const schema = db.exec(`PRAGMA table_info(${table})`);
    if (!schema.length) {
      console.log('  TABLE NOT FOUND');
      db.close();
      continue;
    }
    console.log('  Columns:');
    for (const row of schema[0].values) {
      console.log(`    - ${row[1]} (${row[2]}) ${row[3] ? 'NOT NULL' : ''} ${row[4] ? `DEFAULT ${row[4]}` : ''}`);
    }
    // Sample row
    const sample = db.exec(`SELECT * FROM ${table} LIMIT 1`);
    if (sample.length) {
      console.log('  Sample row keys:', Object.keys(sample[0].columns).map(k => sample[0].columns[k]));
      console.log('  Sample row:', sample[0].values[0]);
    }
    // Count
    const count = db.exec(`SELECT COUNT(*) FROM ${table}`);
    if (count.length) console.log(`  Total rows: ${count[0].values[0][0].toLocaleString()}`);
    // Date range
    let dateCol = schema[0].values.find(r => r[1].toLowerCase().includes('date'))?.[1];
    if (dateCol) {
      const range = db.exec(`SELECT MIN(${dateCol}), MAX(${dateCol}) FROM ${table}`);
      if (range.length) console.log(`  Date range (${dateCol}): ${range[0].values[0][0]} → ${range[0].values[0][1]}`);
    }
    db.close();
  } catch (e: any) {
    console.log(`  ERROR: ${e.message}`);
  }
}

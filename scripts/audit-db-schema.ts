import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const SQL = await initSqlJs();

const DB_DIR = '/home/z/my-project/db';

async function main() {

// 1. Show schema of crypto.db tables
console.log('=== crypto.db schema ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'crypto.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  if (res.length) {
    for (const row of res[0].values) {
      console.log('---');
      console.log('TABLE:', row[0]);
      console.log('SQL:', row[1]);
    }
  }
  db.close();
}

// 2. Show schema of custom.db tables
console.log('\n=== custom.db schema ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'custom.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  if (res.length) {
    for (const row of res[0].values) {
      console.log('---');
      console.log('TABLE:', row[0]);
      console.log('SQL:', row[1]);
    }
  }
  db.close();
}

// 3. Show schema of prices.db tables
console.log('\n=== prices.db schema ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'prices.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  if (res.length) {
    for (const row of res[0].values) {
      console.log('---');
      console.log('TABLE:', row[0]);
      console.log('SQL:', row[1]);
      try {
        const r2 = db.exec(`SELECT * FROM "${row[0]}" LIMIT 2`);
        if (r2.length) {
          console.log('SAMPLE COLUMNS:', r2[0].columns.join(', '));
          for (const v of r2[0].values) {
            console.log('SAMPLE ROW:', v.join(' | '));
          }
        }
      } catch (e: any) { console.log('Sample error:', e.message); }
    }
  }
  db.close();
}

// 4. Show schema of price_history.db
console.log('\n=== price_history.db schema ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'price_history.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  if (res.length) {
    for (const row of res[0].values) {
      console.log('---');
      console.log('TABLE:', row[0]);
      console.log('SQL:', row[1]);
      try {
        const r2 = db.exec(`SELECT * FROM "${row[0]}" LIMIT 2`);
        if (r2.length) {
          console.log('SAMPLE COLUMNS:', r2[0].columns.join(', '));
          for (const v of r2[0].values) {
            console.log('SAMPLE ROW:', v.join(' | '));
          }
        }
      } catch (e: any) { console.log('Sample error:', e.message); }
    }
  }
  db.close();
}

// 5. Cross-check: data_engine.db has egksco_price_history table
console.log('\n=== data_engine.db egksco_price_history schema (cross-check) ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'data_engine.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name='egksco_price_history'");
  if (res.length) {
    for (const row of res[0].values) {
      console.log('TABLE:', row[0]);
      console.log('SQL:', row[1]);
    }
  }
  try {
    const r2 = db.exec("SELECT * FROM egksco_price_history LIMIT 2");
    if (r2.length) {
      console.log('SAMPLE COLUMNS:', r2[0].columns.join(', '));
      for (const v of r2[0].values) {
        console.log('SAMPLE ROW:', v.join(' | '));
      }
    }
  } catch (e: any) { console.log('Sample error:', e.message); }
  try {
    const r3 = db.exec("SELECT COUNT(DISTINCT ticker) FROM egksco_price_history");
    if (r3.length) console.log('DISTINCT TICKERS (egksco_price_history):', r3[0].values[0][0]);
  } catch (e: any) { console.log('Count error:', e.message); }
  db.close();
}

// 6. Cross-check: data_engine.db stock_prices table
console.log('\n=== data_engine.db stock_prices schema (cross-check) ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'data_engine.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name='stock_prices'");
  if (res.length) {
    for (const row of res[0].values) {
      console.log('TABLE:', row[0]);
      console.log('SQL:', row[1]);
    }
  }
  try {
    const r2 = db.exec("SELECT * FROM stock_prices LIMIT 2");
    if (r2.length) {
      console.log('SAMPLE COLUMNS:', r2[0].columns.join(', '));
      for (const v of r2[0].values) {
        console.log('SAMPLE ROW:', v.join(' | '));
      }
    }
  } catch (e: any) { console.log('Sample error:', e.message); }
  try {
    const r3 = db.exec("SELECT COUNT(DISTINCT symbol) FROM stock_prices");
    if (r3.length) console.log('DISTINCT SYMBOLS (stock_prices):', r3[0].values[0][0]);
  } catch (e: any) { console.log('Count error:', e.message); }
  db.close();
}

// 7. Cross-check: stocks.db stock_daily_prices table
console.log('\n=== stocks.db stock_daily_prices schema (cross-check) ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'stocks.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name='stock_daily_prices'");
  if (res.length) {
    for (const row of res[0].values) {
      console.log('TABLE:', row[0]);
      console.log('SQL:', row[1]);
    }
  }
  try {
    const r2 = db.exec("SELECT * FROM stock_daily_prices LIMIT 2");
    if (r2.length) {
      console.log('SAMPLE COLUMNS:', r2[0].columns.join(', '));
      for (const v of r2[0].values) {
        console.log('SAMPLE ROW:', v.join(' | '));
      }
    }
  } catch (e: any) { console.log('Sample error:', e.message); }
  try {
    const r3 = db.exec("SELECT COUNT(DISTINCT ticker) FROM stock_daily_prices");
    if (r3.length) console.log('DISTINCT TICKERS (stock_daily_prices):', r3[0].values[0][0]);
  } catch (e: any) { console.log('Count error:', e.message); }
  db.close();
}

// 8. Cross-check: stocks.db egksco_price_history table
console.log('\n=== stocks.db egksco_price_history (cross-check) ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'stocks.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='egksco_price_history'");
  if (res.length) {
    console.log('egksco_price_history EXISTS in stocks.db');
    try {
      const r3 = db.exec("SELECT COUNT(*), COUNT(DISTINCT ticker) FROM egksco_price_history");
      if (r3.length) console.log('TOTAL ROWS / DISTINCT TICKERS:', r3[0].values[0].join(' / '));
    } catch (e: any) { console.log('Count error:', e.message); }
  } else {
    console.log('egksco_price_history NOT in stocks.db');
  }
  db.close();
}

// 9. Cross-check: data_engine.db crypto_prices
console.log('\n=== data_engine.db crypto_prices schema (cross-check vs prices.db.crypto_prices) ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'data_engine.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name='crypto_prices'");
  if (res.length) {
    for (const row of res[0].values) {
      console.log('TABLE:', row[0]);
      console.log('SQL:', row[1]);
    }
  }
  try {
    const r2 = db.exec("SELECT * FROM crypto_prices LIMIT 2");
    if (r2.length) {
      console.log('SAMPLE COLUMNS:', r2[0].columns.join(', '));
      for (const v of r2[0].values) {
        console.log('SAMPLE ROW:', v.join(' | '));
      }
    }
  } catch (e: any) { console.log('Sample error:', e.message); }
  db.close();
}

// 10. Cross-check: data_engine.db exchange_rates vs prices.db.exchange_rates
console.log('\n=== data_engine.db exchange_rates schema ===');
{
  const buf = fs.readFileSync(path.join(DB_DIR, 'data_engine.db'));
  const db = new SQL.Database(buf);
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name='exchange_rates'");
  if (res.length) {
    for (const row of res[0].values) {
      console.log('TABLE:', row[0]);
      console.log('SQL:', row[1]);
    }
  }
  try {
    const r2 = db.exec("SELECT * FROM exchange_rates LIMIT 2");
    if (r2.length) {
      console.log('SAMPLE COLUMNS:', r2[0].columns.join(', '));
      for (const v of r2[0].values) {
        console.log('SAMPLE ROW:', v.join(' | '));
      }
    }
  } catch (e: any) { console.log('Sample error:', e.message); }
  db.close();
}

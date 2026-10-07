const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_DIR = '/home/z/my-project/db';

async function main() {
  const SQL = await initSqlJs();

  function dumpSchema(name) {
    console.log(`\n=== ${name} schema ===`);
    try {
      const buf = fs.readFileSync(path.join(DB_DIR, name));
      const db = new SQL.Database(buf);
      const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
      if (res.length) {
        for (const row of res[0].values) {
          console.log('---');
          console.log('TABLE:', row[0]);
          console.log('SQL:', row[1]);
        }
      } else {
        console.log('(no tables)');
      }
      db.close();
    } catch (e) {
      console.log('Error:', e.message);
    }
  }

  function dumpSchemaAndSample(name) {
    console.log(`\n=== ${name} schema + samples ===`);
    try {
      const buf = fs.readFileSync(path.join(DB_DIR, name));
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
          } catch (e) {
            console.log('Sample error:', e.message);
          }
        }
      } else {
        console.log('(no tables)');
      }
      db.close();
    } catch (e) {
      console.log('Error:', e.message);
    }
  }

  function dumpTableSchema(name, table) {
    console.log(`\n=== ${name}.${table} ===`);
    try {
      const buf = fs.readFileSync(path.join(DB_DIR, name));
      const db = new SQL.Database(buf);
      const res = db.exec(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name='${table}'`);
      if (res.length) {
        for (const row of res[0].values) {
          console.log('TABLE:', row[0]);
          console.log('SQL:', row[1]);
        }
      } else {
        console.log(`Table ${table} NOT FOUND in ${name}`);
      }
      try {
        const r2 = db.exec(`SELECT * FROM "${table}" LIMIT 2`);
        if (r2.length) {
          console.log('SAMPLE COLUMNS:', r2[0].columns.join(', '));
          for (const v of r2[0].values) {
            console.log('SAMPLE ROW:', v.join(' | '));
          }
        }
      } catch (e) {
        console.log('Sample error:', e.message);
      }
      try {
        let cntRes;
        if (table === 'egksco_price_history') {
          cntRes = db.exec(`SELECT COUNT(*), COUNT(DISTINCT ticker) FROM "${table}"`);
        } else if (table === 'stock_prices') {
          cntRes = db.exec(`SELECT COUNT(*), COUNT(DISTINCT symbol) FROM "${table}"`);
        } else if (table === 'stock_daily_prices') {
          cntRes = db.exec(`SELECT COUNT(*), COUNT(DISTINCT ticker) FROM "${table}"`);
        } else {
          cntRes = db.exec(`SELECT COUNT(*) FROM "${table}"`);
        }
        if (cntRes.length) {
          console.log('COUNT:', cntRes[0].values[0].join(' / '));
        }
      } catch (e) {
        console.log('Count error:', e.message);
      }
      db.close();
    } catch (e) {
      console.log('Error:', e.message);
    }
  }

  // 1. crypto.db
  dumpSchema('crypto.db');
  // 2. custom.db
  dumpSchema('custom.db');
  // 3. prices.db
  dumpSchemaAndSample('prices.db');
  // 4. price_history.db
  dumpSchemaAndSample('price_history.db');

  // 5. data_engine.db egksco_price_history
  dumpTableSchema('data_engine.db', 'egksco_price_history');
  // 6. data_engine.db stock_prices
  dumpTableSchema('data_engine.db', 'stock_prices');
  // 7. stocks.db stock_daily_prices
  dumpTableSchema('stocks.db', 'stock_daily_prices');
  // 8. stocks.db egksco_price_history
  dumpTableSchema('stocks.db', 'egksco_price_history');
  // 9. data_engine.db crypto_prices
  dumpTableSchema('data_engine.db', 'crypto_prices');
  // 10. data_engine.db exchange_rates
  dumpTableSchema('data_engine.db', 'exchange_rates');

  // 11. Compare: pick 3 EGX tickers from price_history.db and check if they exist in data_engine.db egksco_price_history
  console.log('\n=== CROSS-CHECK: 3 EGX tickers in price_history.db vs data_engine.db.egksco_price_history ===');
  try {
    const phBuf = fs.readFileSync(path.join(DB_DIR, 'price_history.db'));
    const phDb = new SQL.Database(phBuf);
    const r = phDb.exec("SELECT ticker, COUNT(*) as cnt, MIN(date) as min_d, MAX(date) as max_d FROM price_history GROUP BY ticker ORDER BY cnt DESC LIMIT 3");
    if (r.length) {
      console.log('Top 3 tickers in price_history.db:');
      for (const v of r[0].values) {
        console.log(' ', v.join(' | '));
      }
      // For each top ticker, check if it exists in data_engine.db egksco_price_history
      const deBuf = fs.readFileSync(path.join(DB_DIR, 'data_engine.db'));
      const deDb = new SQL.Database(deBuf);
      for (const v of r[0].values) {
        const ticker = v[0];
        try {
          const rs = deDb.exec(`SELECT COUNT(*), MIN(date), MAX(date) FROM egksco_price_history WHERE ticker = '${ticker}'`);
          if (rs.length) {
            console.log(`In data_engine.db.egksco_price_history ticker=${ticker}: COUNT=${rs[0].values[0][0]}, MIN=${rs[0].values[0][1]}, MAX=${rs[0].values[0][2]}`);
          }
        } catch (e) {
          console.log(`Error checking ticker ${ticker}:`, e.message);
        }
      }
      deDb.close();
    }
    phDb.close();
  } catch (e) {
    console.log('Cross-check error:', e.message);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

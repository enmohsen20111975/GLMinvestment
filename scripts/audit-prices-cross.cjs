const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_DIR = '/home/z/my-project/db';

async function main() {
  const SQL = await initSqlJs();

  // Cross-check: prices.db.egx_prices vs data_engine.db.egksco_price_history (sample 5 rows)
  console.log('=== prices.db.egx_prices vs data_engine.db.egksco_price_history (5 sample rows) ===');
  {
    const pBuf = fs.readFileSync(path.join(DB_DIR, 'prices.db'));
    const pDb = new SQL.Database(pBuf);
    const r = pDb.exec("SELECT ticker, price_date, close_price, volume FROM egx_prices ORDER BY ticker ASC, price_date ASC LIMIT 5");
    if (r.length) {
      console.log('prices.db.egx_prices samples:');
      for (const v of r[0].values) {
        console.log('  PX:', v.join(' | '));
      }

      // Check the same rows in data_engine.db.egksco_price_history
      const deBuf = fs.readFileSync(path.join(DB_DIR, 'data_engine.db'));
      const deDb = new SQL.Database(deBuf);
      for (const v of r[0].values) {
        const ticker = v[0];
        const date = v[1];
        try {
          const rs = deDb.exec(`SELECT symbol, price_date, close_price, volume FROM egksco_price_history WHERE symbol = '${ticker}' AND price_date = '${date}'`);
          if (rs.length) {
            for (const r2 of rs[0].values) {
              console.log(`  DE (${ticker}/${date}):`, r2.join(' | '));
            }
          } else {
            console.log(`  DE (${ticker}/${date}): NOT FOUND in data_engine.db`);
          }
        } catch (e) { console.log(`  DE error:`, e.message); }
      }
      deDb.close();
    }

    // Counts
    try {
      const c = pDb.exec("SELECT COUNT(*), COUNT(DISTINCT ticker) FROM egx_prices");
      if (c.length) console.log('\nprices.db.egx_prices TOTAL ROWS / DISTINCT TICKERS:', c[0].values[0].join(' / '));
    } catch (e) { console.log('Count error:', e.message); }
    pDb.close();
  }

  // Cross-check: prices.db.crypto_prices vs data_engine.db.crypto_prices (sample 5 rows)
  console.log('\n=== prices.db.crypto_prices vs data_engine.db.crypto_prices (5 sample rows) ===');
  {
    const pBuf = fs.readFileSync(path.join(DB_DIR, 'prices.db'));
    const pDb = new SQL.Database(pBuf);
    const r = pDb.exec("SELECT ticker, price_date, close_price FROM crypto_prices ORDER BY ticker ASC, price_date ASC LIMIT 5");
    if (r.length) {
      console.log('prices.db.crypto_prices samples:');
      for (const v of r[0].values) {
        console.log('  PX:', v.join(' | '));
      }
    }
    try {
      const c = pDb.exec("SELECT COUNT(*), COUNT(DISTINCT ticker) FROM crypto_prices");
      if (c.length) console.log('prices.db.crypto_prices TOTAL ROWS / DISTINCT TICKERS:', c[0].values[0].join(' / '));
    } catch (e) { console.log('Count error:', e.message); }
    pDb.close();
    const deBuf = fs.readFileSync(path.join(DB_DIR, 'data_engine.db'));
    const deDb = new SQL.Database(deBuf);
    try {
      const c = deDb.exec("SELECT COUNT(*), COUNT(DISTINCT symbol) FROM crypto_prices");
      if (c.length) console.log('data_engine.db.crypto_prices TOTAL ROWS / DISTINCT SYMBOLS:', c[0].values[0].join(' / '));
    } catch (e) { console.log('Count error:', e.message); }
    deDb.close();
  }

  // Cross-check: prices.db.commodity_prices vs data_engine.db.gold_prices (sample 5 rows)
  console.log('\n=== prices.db.commodity_prices vs data_engine.db.gold_prices (5 sample rows) ===');
  {
    const pBuf = fs.readFileSync(path.join(DB_DIR, 'prices.db'));
    const pDb = new SQL.Database(pBuf);
    const r = pDb.exec("SELECT symbol, price_date, close_price FROM commodity_prices ORDER BY symbol ASC, price_date ASC LIMIT 5");
    if (r.length) {
      console.log('prices.db.commodity_prices samples:');
      for (const v of r[0].values) {
        console.log('  PX:', v.join(' | '));
      }
    }
    try {
      const c = pDb.exec("SELECT COUNT(*), COUNT(DISTINCT symbol) FROM commodity_prices");
      if (c.length) console.log('prices.db.commodity_prices TOTAL ROWS / DISTINCT SYMBOLS:', c[0].values[0].join(' / '));
    } catch (e) { console.log('Count error:', e.message); }
    pDb.close();
  }

  // Cross-check: prices.db.exchange_rates vs data_engine.db.exchange_rates (sample 5 rows)
  console.log('\n=== prices.db.exchange_rates vs data_engine.db.exchange_rates (5 sample rows) ===');
  {
    const pBuf = fs.readFileSync(path.join(DB_DIR, 'prices.db'));
    const pDb = new SQL.Database(pBuf);
    const r = pDb.exec("SELECT price_date, from_currency, to_currency, rate FROM exchange_rates ORDER BY price_date ASC, from_currency ASC LIMIT 5");
    if (r.length) {
      console.log('prices.db.exchange_rates samples:');
      for (const v of r[0].values) {
        console.log('  PX:', v.join(' | '));
      }
    }
    try {
      const c = pDb.exec("SELECT COUNT(*), COUNT(DISTINCT from_currency) FROM exchange_rates");
      if (c.length) console.log('prices.db.exchange_rates TOTAL ROWS / DISTINCT FROM_CURRENCY:', c[0].values[0].join(' / '));
    } catch (e) { console.log('Count error:', e.message); }
    pDb.close();
    const deBuf = fs.readFileSync(path.join(DB_DIR, 'data_engine.db'));
    const deDb = new SQL.Database(deBuf);
    try {
      const c = deDb.exec("SELECT COUNT(*), COUNT(DISTINCT currency) FROM exchange_rates");
      if (c.length) console.log('data_engine.db.exchange_rates TOTAL ROWS / DISTINCT CURRENCY:', c[0].values[0].join(' / '));
    } catch (e) { console.log('Count error:', e.message); }
    deDb.close();
  }

  // Python code: check if vps-service is running / writing to crypto.db
  console.log('\n=== Python files that READ/WRITE crypto.db (not just refs) ===');
  // Check if any cron / scheduler actively writes
  // The grep above already showed many .py files referencing crypto.db — let me look at lightweight_server.py specifically since it has writes
}

main().catch(e => { console.error(e); process.exit(1); });

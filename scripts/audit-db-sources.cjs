const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_DIR = '/home/z/my-project/db';

async function main() {
  const SQL = await initSqlJs();

  // Distribution of sources in price_history.db
  console.log('=== price_history.db.source distribution ===');
  {
    const buf = fs.readFileSync(path.join(DB_DIR, 'price_history.db'));
    const db = new SQL.Database(buf);
    try {
      const r = db.exec("SELECT source, COUNT(*) as cnt, COUNT(DISTINCT ticker) as tickers FROM price_history GROUP BY source ORDER BY cnt DESC");
      if (r.length) {
        console.log('SOURCE | COUNT | DISTINCT TICKERS');
        for (const v of r[0].values) {
          console.log('  ', v.join(' | '));
        }
      }
    } catch (e) { console.log('Error:', e.message); }

    // Date ranges per source
    try {
      const r = db.exec("SELECT source, MIN(date), MAX(date) FROM price_history GROUP BY source");
      if (r.length) {
        console.log('\nDATE RANGES PER SOURCE:');
        for (const v of r[0].values) {
          console.log('  ', v.join(' | '));
        }
      }
    } catch (e) { console.log('Error:', e.message); }
    db.close();
  }

  // Check if egksco_price_history in data_engine.db has yahoo_clean source at all (it doesn't have a source column)
  // Check if stock_daily_prices in stocks.db has source column / yahoo_clean data
  console.log('\n=== stocks.db.stock_daily_prices — any source column? ===');
  {
    const buf = fs.readFileSync(path.join(DB_DIR, 'stocks.db'));
    const db = new SQL.Database(buf);
    try {
      const r = db.exec("SELECT name FROM pragma_table_info('stock_daily_prices')");
      if (r.length) {
        console.log('COLUMNS:', r[0].values.map(v => v[0]).join(', '));
      }
    } catch (e) { console.log('Error:', e.message); }
    db.close();
  }

  // Find yahoo_clean samples in price_history.db
  console.log('\n=== price_history.db yahoo_clean samples ===');
  {
    const buf = fs.readFileSync(path.join(DB_DIR, 'price_history.db'));
    const db = new SQL.Database(buf);
    try {
      const r = db.exec("SELECT ticker, date, close_price, source FROM price_history WHERE source = 'yahoo_clean' ORDER BY date DESC LIMIT 5");
      if (r.length) {
        for (const v of r[0].values) {
          console.log('  ', v.join(' | '));
        }
      } else {
        console.log('No yahoo_clean rows found');
      }
    } catch (e) { console.log('Error:', e.message); }
    db.close();
  }

  // Cross-check if egksco rows from price_history.db are also in data_engine.db.egksco_price_history (full overlap?)
  console.log('\n=== CROSS-CHECK: top 5 egksco rows from price_history.db vs data_engine.db.egksco_price_history ===');
  {
    const phBuf = fs.readFileSync(path.join(DB_DIR, 'price_history.db'));
    const phDb = new SQL.Database(phBuf);
    const r = phDb.exec("SELECT ticker, date, close_price, volume, source FROM price_history WHERE source = 'egksco' ORDER BY ticker ASC, date ASC LIMIT 5");
    if (r.length) {
      console.log('Top 5 egksco rows in price_history.db:');
      for (const v of r[0].values) {
        console.log('  PH:', v.join(' | '));
      }
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
        } catch (e) {
          console.log(`  DE error for ${ticker}/${date}:`, e.message);
        }
      }
      deDb.close();
    }
    phDb.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

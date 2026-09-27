const Database = require('/home/z/my-project/node_modules/better-sqlite3');
const stocksDb = new Database('/home/z/my-project/db/stocks.db', { readonly: true });
console.log('stocks table columns:');
console.log(stocksDb.prepare("PRAGMA table_info(stocks)").all().map(c=>c.name));
const n = stocksDb.prepare("SELECT COUNT(*) AS c FROM stocks").get().c;
console.log('rows:', n);
const sample = stocksDb.prepare("SELECT * FROM stocks LIMIT 3").all();
console.log('sample:', sample);
// Try symbol LIKE
try {
  const r = stocksDb.prepare("SELECT symbol, sector, market_cap FROM stocks LIMIT 5").all();
  console.log('cols sample:', r);
} catch (e) { console.log('err:', e.message); }
stocksDb.close();

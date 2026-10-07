// Verify data_engine.db.stocks symbols are all present in stocks.db.stocks (no data loss check)
const Database = require('better-sqlite3');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '..', 'db');
const de = new Database(path.join(DB_DIR, 'data_engine.db'), { readonly: true });
const st = new Database(path.join(DB_DIR, 'stocks.db'), { readonly: true });

// data_engine.db.stocks has 'symbol' column
// stocks.db.stocks has 'ticker' column
const deSymbols = de.prepare("SELECT DISTINCT symbol FROM stocks WHERE symbol IS NOT NULL").all().map(r => r.symbol);
console.log(`data_engine.db.stocks: ${deSymbols.length} unique symbols`);

const stSymbols = new Set(st.prepare("SELECT DISTINCT ticker FROM stocks WHERE ticker IS NOT NULL").all().map(r => r.ticker));
console.log(`stocks.db.stocks: ${stSymbols.size} unique tickers`);

let missing = 0;
const missingList = [];
for (const sym of deSymbols) {
  if (!stSymbols.has(sym)) {
    missing++;
    missingList.push(sym);
  }
}
console.log(`\nSymbols in data_engine but NOT in stocks.db: ${missing}/${deSymbols.length}`);
if (missing > 0) {
  console.log('Missing symbols (first 20):', missingList.slice(0, 20).join(', '));
}

// Also check which data_engine.stocks rows are stale (last_update older than 7 days)
const staleRows = de.prepare("SELECT COUNT(*) as c FROM stocks WHERE last_update < datetime('now', '-7 days') OR last_update IS NULL").get().c;
const freshRows = de.prepare("SELECT COUNT(*) as c FROM stocks WHERE last_update >= datetime('now', '-7 days')").get().c;
console.log(`\ndata_engine.stocks staleness: ${staleRows} stale (>7d), ${freshRows} fresh (<=7d)`);

de.close();
st.close();

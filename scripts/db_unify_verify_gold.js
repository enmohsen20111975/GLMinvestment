// Verify stocks.db.gold_prices 3 rows aren't unique data (vs data_engine.db.gold_prices)
const Database = require('better-sqlite3');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '..', 'db');
const st = new Database(path.join(DB_DIR, 'stocks.db'), { readonly: true });
const de = new Database(path.join(DB_DIR, 'data_engine.db'), { readonly: true });

const stRows = st.prepare("SELECT * FROM gold_prices").all();
console.log(`stocks.db.gold_prices: ${stRows.length} rows`);
console.log(JSON.stringify(stRows, null, 2));

const deRows = de.prepare("SELECT MAX(timestamp) as max_ts, MIN(timestamp) as min_ts, COUNT(DISTINCT timestamp) as distinct_ts FROM gold_prices").get();
console.log(`\ndata_engine.db.gold_prices: ${deRows.distinct_ts} distinct timestamps, range ${deRows.min_ts} → ${deRows.max_ts}`);

// The 3 rows in stocks.db have last_update='2026-06-03T16:52:36.506Z'
// Check if data_engine has any rows on 2026-06-03 (so the prices are duplicated)
const deJune3 = de.prepare("SELECT timestamp, karat, price_per_gram, country FROM gold_prices WHERE timestamp LIKE '2026-06-03%' LIMIT 5").all();
console.log(`\ndata_engine rows on 2026-06-03: ${deJune3.length} (showing 5)`);
deJune3.forEach(r => console.log(`  ${r.timestamp} ${r.country} ${r.karat} = ${r.price_per_gram}`));

st.close();
de.close();

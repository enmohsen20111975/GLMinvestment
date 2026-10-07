// Verify auth.db.ExpertRecommendation 17 rows are present in stocks.db (no data loss)
const Database = require('better-sqlite3');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '..', 'db');
const auth = new Database(path.join(DB_DIR, 'auth.db'), { readonly: true });
const pred = new Database(path.join(DB_DIR, 'predictions.db'), { readonly: true });
const st = new Database(path.join(DB_DIR, 'stocks.db'), { readonly: true });

const authRows = auth.prepare("SELECT stock_symbol, expert_name, recommendation_date, session_date FROM ExpertRecommendation").all();
console.log(`auth.ExpertRecommendation: ${authRows.length} rows`);

const predRows = pred.prepare("SELECT stock_symbol, expert_name, recommendation_date, session_date FROM ExpertRecommendation").all();
console.log(`predictions.ExpertRecommendation: ${predRows.length} rows`);

// Check if each auth row exists in stocks.db by (symbol, recommendation_date)
let foundInStocks = 0;
let notFoundInStocks = 0;
const notFound = [];
for (const r of authRows) {
  const match = st.prepare("SELECT id FROM ExpertRecommendation WHERE stock_symbol = ? AND recommendation_date = ? LIMIT 1")
    .get(r.stock_symbol, r.recommendation_date);
  if (match) foundInStocks++;
  else {
    notFoundInStocks++;
    notFound.push(`${r.stock_symbol} @ ${r.recommendation_date}`);
  }
}
console.log(`\nauth rows matched in stocks by (symbol, recommendation_date): ${foundInStocks}/${authRows.length}`);
console.log(`auth rows NOT in stocks by same key: ${notFoundInStocks}`);
if (notFound.length > 0) console.log('Not found (first 10):', notFound.slice(0, 10));

// Check stocks.ExpertRecommendation row count by status
const stocksByStatus = st.prepare("SELECT status, COUNT(*) as c FROM ExpertRecommendation GROUP BY status").all();
console.log('\nstocks.ExpertRecommendation by status:');
stocksByStatus.forEach(r => console.log(`  ${r.status}: ${r.c}`));

auth.close();
pred.close();
st.close();

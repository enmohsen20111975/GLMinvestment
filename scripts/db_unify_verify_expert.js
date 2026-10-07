// Verify whether the ExpertRecommendation rows in auth.db + predictions.db are subsets of stocks.db (stale duplicates)
const Database = require('better-sqlite3');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '..', 'db');
const stocks = new Database(path.join(DB_DIR, 'stocks.db'), { readonly: true });
const auth = new Database(path.join(DB_DIR, 'auth.db'), { readonly: true });
const predictions = new Database(path.join(DB_DIR, 'predictions.db'), { readonly: true });

console.log('=== stocks.ExpertRecommendation ===');
const stocksRows = stocks.prepare('SELECT id, stock_symbol, expert_name, recommendation_date, session_date FROM ExpertRecommendation ORDER BY id').all();
console.log(`count: ${stocksRows.length}`);
console.log('ids:', stocksRows.map(r => r.id).join(','));

console.log('\n=== auth.ExpertRecommendation ===');
const authRows = auth.prepare('SELECT id, stock_symbol, expert_name, recommendation_date, session_date FROM ExpertRecommendation ORDER BY id').all();
console.log(`count: ${authRows.length}`);
console.log('ids:', authRows.map(r => r.id).join(','));
console.log('max id:', Math.max(...authRows.map(r => r.id)));
console.log('max recommendation_date:', authRows.map(r => r.recommendation_date).filter(Boolean).sort().pop());

console.log('\n=== predictions.ExpertRecommendation ===');
const predRows = predictions.prepare('SELECT id, stock_symbol, expert_name, recommendation_date, session_date FROM ExpertRecommendation ORDER BY id').all();
console.log(`count: ${predRows.length}`);
console.log('ids:', predRows.map(r => r.id).join(','));
console.log('max id:', Math.max(...predRows.map(r => r.id)));

// Check overlap with stocks (same id+symbol+date)
const stocksSet = new Set(stocksRows.map(r => `${r.id}|${r.stock_symbol}|${r.recommendation_date}`));
const authOverlap = authRows.filter(r => stocksSet.has(`${r.id}|${r.stock_symbol}|${r.recommendation_date}`));
const predOverlap = predRows.filter(r => stocksSet.has(`${r.id}|${r.stock_symbol}|${r.recommendation_date}`));
console.log(`\nauth rows also present in stocks (by id+symbol+date): ${authOverlap.length}/${authRows.length}`);
console.log(`predictions rows also present in stocks (by id+symbol+date): ${predOverlap.length}/${predRows.length}`);

// Check if auth and predictions are identical (same id, same symbol, same date)
console.log('\n=== auth vs predictions identical? ===');
const authSet = new Set(authRows.map(r => `${r.id}|${r.stock_symbol}|${r.recommendation_date}`));
const predInAuth = predRows.filter(r => authSet.has(`${r.id}|${r.stock_symbol}|${r.recommendation_date}`));
console.log(`predictions rows also in auth: ${predInAuth.length}/${predRows.length}`);

// Check max ids in stocks that are < max(auth ids) - so we know if auth/predictions have rows NOT in stocks
const stocksIds = new Set(stocksRows.map(r => r.id));
const authOnlyInAuth = authRows.filter(r => !stocksIds.has(r.id));
const predOnlyInPred = predRows.filter(r => !stocksIds.has(r.id));
console.log(`\nauth rows NOT in stocks by id: ${authOnlyInAuth.length}`);
console.log(authOnlyInAuth.map(r => `  id=${r.id} sym=${r.stock_symbol} date=${r.recommendation_date}`).join('\n'));
console.log(`predictions rows NOT in stocks by id: ${predOnlyInPred.length}`);

stocks.close();
auth.close();
predictions.close();

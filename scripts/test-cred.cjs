const Database = require('better-sqlite3');
const db = new Database('/home/z/my-project/db/predictions.db', { readonly: true });
const rows = db.prepare("SELECT id, ticker, signal, prediction_date, entry_price, target_price, master_score, outcome_date, hit_target, hit_stop, actual_return FROM predictions ORDER BY prediction_date DESC LIMIT 3").all();
console.log('Sample rows:', JSON.stringify(rows, null, 2));
const cnt = db.prepare("SELECT COUNT(*) as c FROM predictions").get();
console.log('Total predictions:', cnt.c);
const statusCnt = db.prepare("SELECT SUM(CASE WHEN outcome_date IS NOT NULL AND hit_target=1 THEN 1 ELSE 0 END) as th, SUM(CASE WHEN outcome_date IS NOT NULL AND hit_stop=1 THEN 1 ELSE 0 END) as st, SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed, SUM(CASE WHEN outcome_date IS NULL THEN 1 ELSE 0 END) as pending FROM predictions").get();
console.log('Status:', statusCnt);
db.close();

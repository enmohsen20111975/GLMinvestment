const Database = require('/home/z/my-project/node_modules/better-sqlite3');
const predDb = new Database('/home/z/my-project/db/predictions.db', { readonly: true });
const dups = predDb.prepare("SELECT id, ticker, signal, signal_type, prediction_date, entry_price, target_price, stop_loss, actual_return, hit_target, hit_stop, status, persona, exit_reason, market FROM predictions WHERE ticker IN ('1150','7020') ORDER BY ticker, prediction_date").all();
console.log(JSON.stringify(dups, null, 2));

// Also check: all distinct personas in persona_predictions vs predictions
console.log('--- persona_predictions personas ---');
console.log(predDb.prepare("SELECT DISTINCT persona FROM persona_predictions").all());
console.log('--- predictions personas ---');
console.log(predDb.prepare("SELECT DISTINCT persona FROM predictions").all());

// Also: distinct tickers in predictions
console.log('--- distinct tickers count ---');
console.log(predDb.prepare("SELECT COUNT(DISTINCT ticker) AS c FROM predictions").get());

// Also: status mix for persona_predictions (all 1390 PENDING is the issue)
console.log('--- persona_predictions: pending vs closed by persona ---');
console.log(predDb.prepare("SELECT persona, status, COUNT(*) AS c FROM persona_predictions GROUP BY persona, status").all());

predDb.close();

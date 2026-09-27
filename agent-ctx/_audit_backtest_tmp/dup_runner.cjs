const Database = require('/home/z/my-project/node_modules/better-sqlite3');
const predDb = new Database('/home/z/my-project/db/predictions.db', { readonly: true });
const dups = predDb.prepare("SELECT id, ticker, signal, signal_type, prediction_date, entry_price, target_price, stop_loss, actual_return, hit_target, hit_stop, status, persona, exit_reason, market FROM predictions WHERE ticker IN ('1150','7020') ORDER BY ticker, prediction_date").all();
console.log(JSON.stringify(dups));
predDb.close();

const Database = require('/home/z/my-project/node_modules/better-sqlite3');
const origDb = new Database('/home/z/my-project/db/predictions.db.original', { readonly: true });
console.log('=== predictions.db.original ===');
try { console.log('tables:', origDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name)); } catch(e){ console.log('err tables:', e.message); }
for (const t of ['predictions','stored_analyses','hunter_pick_tracking','persona_predictions','learned_lessons','exit_notifications','historical_trades']) {
  try { console.log(t, ':', origDb.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c); } catch(e){ console.log(t, ':', e.message); }
}
origDb.close();

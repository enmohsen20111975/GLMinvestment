const Database = require('better-sqlite3');
try {
  const db = new Database('/home/meme/my_apps/GLMinvestment/db/data_engine.db');
  console.log('✅ Node better-sqlite3 SUCCESS! Stocks count:', db.prepare('SELECT COUNT(*) as c FROM stocks').get().c);
} catch (e) {
  console.error('❌ Node better-sqlite3 ERROR:', e.message);
}

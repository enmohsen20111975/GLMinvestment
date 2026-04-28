/**
 * Set admin password in custom.db admin_settings table
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function setAdminPassword() {
  const dbPath = path.join(process.cwd(), 'db', 'custom.db');
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);

  // Check if admin_settings table exists
  const tableExists = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_settings'"
  );

  if (tableExists.length === 0) {
    db.run(`CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    console.log('✅ Created admin_settings table');
  }

  // Set the admin password (plain text — verifyAdminPassword does plain comparison)
  const password = 'M2y@01287644099';
  db.run(
    `INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES ('admin_password', ?, datetime('now'))`,
    [password]
  );
  console.log('✅ Admin password set successfully');

  // Verify
  const result = db.exec("SELECT value FROM admin_settings WHERE key = 'admin_password'");
  if (result.length > 0 && result[0].values[0][0] === password) {
    console.log('✅ Verification: password matches');
  } else {
    console.log('❌ Verification failed');
  }

  // Export and save
  const data = db.export();
  const nodeBuffer = Buffer.from(data);
  fs.writeFileSync(dbPath, nodeBuffer);
  console.log('✅ Database saved');

  db.close();
}

setAdminPassword().catch(console.error);

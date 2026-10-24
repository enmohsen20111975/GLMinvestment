const Database = require("better-sqlite3");
const path = require("path");

console.log("=== CHECKING PREDICTIONS DATABASE (DETAILED) ===\n");

try {
  const dbPath = path.join(__dirname, "../db/predictions.db");
  const db = new Database(dbPath);
  
  // Get all tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log("📋 Tables found:", tables.map(t => t.name).join(", "), "\n");
  
  // Check schema for each table
  for (const table of tables) {
    console.log(`\n=== ${table.name} SCHEMA ===`);
    const schema = db.prepare(`PRAGMA table_info(${table.name})`).all();
    schema.forEach(col => {
      console.log(`  ${col.name} (${col.type})`);
    });
    
    // Get count
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
    console.log(`  Total rows: ${count.count}`);
  }
  
  db.close();
  
} catch (error) {
  console.error("❌ Fatal error:", error.message);
}

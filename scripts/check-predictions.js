const Database = require("better-sqlite3");
const path = require("path");

console.log("=== CHECKING PREDICTIONS DATABASE ===\n");

try {
  const dbPath = path.join(__dirname, "../db/predictions.db");
  const db = new Database(dbPath);
  
  // Get all tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log("📋 Tables found:", tables.map(t => t.name).join(", "), "\n");
  
  // Check each prediction table
  const predictionTables = ["aiPrediction", "real_predictions", "global_predictions"];
  
  for (const tableName of predictionTables) {
    try {
      console.log(`\n=== ${tableName} ===`);
      
      // Get count
      const countResult = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
      console.log(`Total records: ${countResult.count}`);
      
      // Get status distribution
      const statusQuery = `
        SELECT status, COUNT(*) as count 
        FROM ${tableName} 
        GROUP BY status 
        ORDER BY count DESC
      `;
      const statusResults = db.prepare(statusQuery).all();
      console.log("\nStatus distribution:");
      statusResults.forEach(r => {
        console.log(`  ${r.status || 'NULL'}: ${r.count}`);
      });
      
      // Calculate success rate (completed predictions only)
      const completedQuery = `
        SELECT 
          SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) as stopped,
          COUNT(*) as total
        FROM ${tableName}
        WHERE status IN ('TARGET_HIT', 'STOPPED')
      `;
      const completed = db.prepare(completedQuery).get();
      
      if (completed.total > 0) {
        const successRate = ((completed.success / completed.total) * 100).toFixed(1);
        console.log(`\n✅ Completed predictions: ${completed.total}`);
        console.log(`   Success (TARGET_HIT): ${completed.success}`);
        console.log(`   Loss (STOPPED): ${completed.stopped}`);
        console.log(`   Success Rate: ${successRate}%`);
      }
      
    } catch (e) {
      console.log(`❌ Error: ${e.message}`);
    }
  }
  
  // Get overall statistics
  console.log("\n\n=== OVERALL STATISTICS ===");
  
  // Total predictions across all tables
  let totalPredictions = 0;
  let totalSuccess = 0;
  let totalLoss = 0;
  
  for (const tableName of predictionTables) {
    try {
      const completed = db.prepare(`
        SELECT 
          SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) as stopped
        FROM ${tableName}
        WHERE status IN ('TARGET_HIT', 'STOPPED')
      `).get();
      
      const all = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
      totalPredictions += all.count;
      totalSuccess += completed.success || 0;
      totalLoss += completed.stopped || 0;
    } catch (e) {}
  }
  
  const totalCompleted = totalSuccess + totalLoss;
  const overallSuccessRate = totalCompleted > 0 ? ((totalSuccess / totalCompleted) * 100).toFixed(1) : 0;
  
  console.log(`\n📊 ALL TABLES COMBINED:`);
  console.log(`   Total predictions: ${totalPredictions}`);
  console.log(`   Completed: ${totalCompleted}`);
  console.log(`   Success: ${totalSuccess}`);
  console.log(`   Loss: ${totalLoss}`);
  console.log(`   Overall Success Rate: ${overallSuccessRate}%`);
  
  db.close();
  
} catch (error) {
  console.error("❌ Fatal error:", error.message);
}

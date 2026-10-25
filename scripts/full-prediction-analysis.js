const Database = require("better-sqlite3");
const path = require("path");

console.log("=== FULL PREDICTION ANALYSIS ===\n");

try {
  const dbPath = path.join(__dirname, "../db/predictions.db");
  const db = new Database(dbPath);
  
  // ============================================
  // 1. aiPrediction TABLE
  // ============================================
  console.log("═══════════════════════════════════════════");
  console.log("1. aiPrediction TABLE (Current System)");
  console.log("═══════════════════════════════════════════");
  
  const aiPredStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) as stopped,
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) as expired
    FROM aiPrediction
  `).get();
  
  const aiCompleted = aiPredStats.success + aiPredStats.stopped;
  const aiSuccessRate = aiCompleted > 0 ? ((aiPredStats.success / aiCompleted) * 100).toFixed(1) : 0;
  
  console.log(`Total predictions: ${aiPredStats.total}`);
  console.log(`TARGET_HIT (Success): ${aiPredStats.success}`);
  console.log(`STOPPED (Loss): ${aiPredStats.stopped}`);
  console.log(`PENDING: ${aiPredStats.pending}`);
  console.log(`EXPIRED: ${aiPredStats.expired}`);
  console.log(`\nCompleted predictions: ${aiCompleted}`);
  console.log(`Success Rate: ${aiSuccessRate}%`);
  
  // ============================================
  // 2. real_predictions TABLE
  // ============================================
  console.log("\n\n═══════════════════════════════════════════");
  console.log("2. real_predictions TABLE (Historical Data)");
  console.log("═══════════════════════════════════════════");
  
  const realPredStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN hit_stop = 1 THEN 1 ELSE 0 END) as stopped,
      SUM(CASE WHEN hit_target IS NULL AND hit_stop IS NULL THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN hit_target = 0 AND hit_stop = 0 THEN 1 ELSE 0 END) as neither
    FROM real_predictions
  `).get();
  
  const realCompleted = realPredStats.success + realPredStats.stopped;
  const realSuccessRate = realCompleted > 0 ? ((realPredStats.success / realCompleted) * 100).toFixed(1) : 0;
  
  console.log(`Total predictions: ${realPredStats.total}`);
  console.log(`hit_target=1 (Success): ${realPredStats.success}`);
  console.log(`hit_stop=1 (Loss): ${realPredStats.stopped}`);
  console.log(`Neither hit: ${realPredStats.neither}`);
  console.log(`NULL values: ${realPredStats.pending}`);
  console.log(`\nCompleted predictions: ${realCompleted}`);
  console.log(`Success Rate: ${realSuccessRate}%`);
  
  // Show sample data
  console.log("\nSample records:");
  const samples = db.prepare(`SELECT ticker, signal_type, entry_price, target_price, hit_target, hit_stop FROM real_predictions LIMIT 5`).all();
  samples.forEach(s => {
    console.log(`  ${s.ticker}: ${s.signal_type} @ ${s.entry_price} -> target: ${s.target_price} | hit_target=${s.hit_target}, hit_stop=${s.hit_stop}`);
  });
  
  // ============================================
  // 3. global_predictions TABLE
  // ============================================
  console.log("\n\n═══════════════════════════════════════════");
  console.log("3. global_predictions TABLE (Multi-Market)");
  console.log("═══════════════════════════════════════════");
  
  const globalPredStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN hit_stop = 1 THEN 1 ELSE 0 END) as stopped,
      SUM(CASE WHEN hit_target IS NULL AND hit_stop IS NULL THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN hit_target = 0 AND hit_stop = 0 THEN 1 ELSE 0 END) as neither
    FROM global_predictions
  `).get();
  
  const globalCompleted = globalPredStats.success + globalPredStats.stopped;
  const globalSuccessRate = globalCompleted > 0 ? ((globalPredStats.success / globalCompleted) * 100).toFixed(1) : 0;
  
  console.log(`Total predictions: ${globalPredStats.total}`);
  console.log(`hit_target=1 (Success): ${globalPredStats.success}`);
  console.log(`hit_stop=1 (Loss): ${globalPredStats.stopped}`);
  console.log(`Neither hit: ${globalPredStats.neither}`);
  console.log(`NULL values: ${globalPredStats.pending}`);
  console.log(`\nCompleted predictions: ${globalCompleted}`);
  console.log(`Success Rate: ${globalSuccessRate}%`);
  
  // Market breakdown
  console.log("\nBy Market:");
  const marketStats = db.prepare(`
    SELECT market, COUNT(*) as count,
      SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN hit_stop = 1 THEN 1 ELSE 0 END) as stopped
    FROM global_predictions
    GROUP BY market
  `).all();
  marketStats.forEach(m => {
    const completed = m.success + m.stopped;
    const rate = completed > 0 ? ((m.success / completed) * 100).toFixed(1) : 0;
    console.log(`  ${m.market}: ${m.count} total, ${completed} completed, ${rate}% success`);
  });
  
  // ============================================
  // 4. expertRecommendation TABLE
  // ============================================
  console.log("\n\n═══════════════════════════════════════════");
  console.log("4. expertRecommendation TABLE");
  console.log("═══════════════════════════════════════════");
  
  const expertStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN hit_stop_loss = 1 THEN 1 ELSE 0 END) as stopped,
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active
    FROM expertRecommendation
  `).get();
  
  const expertCompleted = expertStats.success + expertStats.stopped;
  const expertSuccessRate = expertCompleted > 0 ? ((expertStats.success / expertCompleted) * 100).toFixed(1) : 0;
  
  console.log(`Total recommendations: ${expertStats.total}`);
  console.log(`Success (hit_target=1): ${expertStats.success}`);
  console.log(`Loss (hit_stop_loss=1): ${expertStats.stopped}`);
  console.log(`PENDING: ${expertStats.pending}`);
  console.log(`ACTIVE: ${expertStats.active}`);
  console.log(`\nCompleted: ${expertCompleted}`);
  console.log(`Success Rate: ${expertSuccessRate}%`);
  
  // ============================================
  // 5. cached_analysis TABLE
  // ============================================
  console.log("\n\n═══════════════════════════════════════════");
  console.log("5. cached_analysis TABLE");
  console.log("═══════════════════════════════════════════");
  
  const cachedStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN signal = 'BUY' THEN 1 ELSE 0 END) as buy_signals,
      SUM(CASE WHEN signal = 'SELL' THEN 1 ELSE 0 END) as sell_signals,
      SUM(CASE WHEN signal = 'HOLD' THEN 1 ELSE 0 END) as hold_signals,
      AVG(confidence) as avg_confidence
    FROM cached_analysis
  `).get();
  
  console.log(`Total cached analyses: ${cachedStats.total}`);
  console.log(`BUY signals: ${cachedStats.buy_signals}`);
  console.log(`SELL signals: ${cachedStats.sell_signals}`);
  console.log(`HOLD signals: ${cachedStats.hold_signals}`);
  console.log(`Avg confidence: ${cachedStats.avg_confidence?.toFixed(2)}`);
  
  // ============================================
  // 6. GRAND TOTAL
  // ============================================
  console.log("\n\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║               📊 GRAND TOTAL - ALL PREDICTIONS               ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  
  const grandTotal = aiPredStats.total + realPredStats.total + globalPredStats.total + expertStats.total;
  const grandSuccess = aiPredStats.success + realPredStats.success + globalPredStats.success + expertStats.success;
  const grandLoss = aiPredStats.stopped + realPredStats.stopped + globalPredStats.stopped + expertStats.stopped;
  const grandCompleted = grandSuccess + grandLoss;
  const grandSuccessRate = grandCompleted > 0 ? ((grandSuccess / grandCompleted) * 100).toFixed(1) : 0;
  
  console.log(`║                                                              ║`);
  console.log(`║  Total Predictions: ${grandTotal.toString().padStart(6)}                                 ║`);
  console.log(`║  Completed:         ${grandCompleted.toString().padStart(6)}                                 ║`);
  console.log(`║  Success:           ${grandSuccess.toString().padStart(6)}                                 ║`);
  console.log(`║  Loss:              ${grandLoss.toString().padStart(6)}                                 ║`);
  console.log(`║                                                              ║`);
  console.log(`║  📈 OVERALL SUCCESS RATE: ${grandSuccessRate}%                            ║`);
  console.log(`║                                                              ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
  
  // Table breakdown
  console.log("\n📋 BY TABLE:");
  console.log("┌─────────────────────┬─────────┬──────────┬────────┬─────────┐");
  console.log("│ Table               │ Total   │ Success  │ Loss   │ Rate    │");
  console.log("├─────────────────────┼─────────┼──────────┼────────┼─────────┤");
  
  const formatRow = (name, total, success, loss, rate) => {
    const namePad = name.padEnd(19);
    const totalPad = total.toString().padStart(7);
    const successPad = success.toString().padStart(8);
    const lossPad = loss.toString().padStart(6);
    const ratePad = rate.padStart(7);
    return `│ ${namePad} │${totalPad} │${successPad} │${lossPad} │${ratePad} │`;
  };
  
  console.log(formatRow("aiPrediction", aiPredStats.total, aiPredStats.success, aiPredStats.stopped, aiSuccessRate + "%"));
  console.log(formatRow("real_predictions", realPredStats.total, realPredStats.success, realPredStats.stopped, realSuccessRate + "%"));
  console.log(formatRow("global_predictions", globalPredStats.total, globalPredStats.success, globalPredStats.stopped, globalSuccessRate + "%"));
  console.log(formatRow("expertRecommendation", expertStats.total, expertStats.success, expertStats.stopped, expertSuccessRate + "%"));
  console.log("├─────────────────────┼─────────┼──────────┼────────┼─────────┤");
  console.log(formatRow("TOTAL", grandTotal, grandSuccess, grandLoss, grandSuccessRate + "%"));
  console.log("└─────────────────────┴─────────┴──────────┴────────┴─────────┘");
  
  db.close();
  
} catch (error) {
  console.error("❌ Fatal error:", error.message);
  console.error(error.stack);
}

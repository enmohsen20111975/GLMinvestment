/**
 * Standalone feedback loop runner — completely standalone, no Next.js deps.
 * Usage: node run-feedback.js
 */
const fs = require('fs');
const path = require('path');

// ============ SQL.JS SETUP ============
let initSqlJs, SQL;

async function initSql() {
  // Use dynamic require to load sql.js
  const sqlJsDistPath = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist');
  const sqlJsEntryPath = path.join(sqlJsDistPath, 'sql-wasm.js');
  const wasmPath = path.join(sqlJsDistPath, 'sql-wasm.wasm');

  // Check for sql-wasm.js
  if (!fs.existsSync(sqlJsEntryPath)) {
    console.error('[ERROR] sql-wasm.js not found at', sqlJsEntryPath);
    process.exit(1);
  }

  // Load sql.js - try different approaches
  try {
    // Approach 1: Direct require (Node.js CJS)
    initSqlJs = require(sqlJsEntryPath);
  } catch {
    // Approach 2: Use createRequire
    const { createRequire } = require('module');
    const req = createRequire(__filename);
    initSqlJs = req(sqlJsEntryPath);
  }

  // Load WASM binary
  let wasmBinary;
  if (fs.existsSync(wasmPath)) {
    console.log('[sqlite] Using local WASM file');
    wasmBinary = fs.readFileSync(wasmPath);
  } else {
    console.log('[sqlite] Local WASM not found, fetching from CDN...');
    const resp = await fetch('https://sql.js.org/dist/sql-wasm.wasm');
    if (!resp.ok) throw new Error(`CDN fetch failed: ${resp.status}`);
    wasmBinary = Buffer.from(await resp.arrayBuffer());
  }

  SQL = await initSqlJs({ wasmBinary });
  console.log('[sqlite] sql.js initialized successfully');
}

// ============ SIMPLE DB WRAPPER ============
function openDb(dbPath, readonly = false) {
  const isReadonly = readonly;
  let dirty = false;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    SQL = globalThis.__egx_sql || SQL; // reuse
    globalThis.__egx_sql = SQL;
    this._db = new SQL.Database(buffer);
  } else if (isReadonly) {
    throw new Error(`DB not found: ${dbPath}`);
  } else {
    this._db = new SQL.Database();
  }

  const save = () => {
    if (isReadonly || !dirty) return;
    try {
      const data = this._db.export();
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dbPath, Buffer.from(data));
      dirty = false;
    } catch (e) { console.error('[db] Save error:', e.message); }
  };

  this.prepare = (sql) => {
    const stmt = this._db.prepare(sql);
    return {
      get: (...params) => {
        try { stmt.bind(params); return stmt.step() ? stmt.getAsObject() : undefined; }
        catch { return undefined; }
        finally { try { stmt.reset(); } catch {} }
      },
      all: (...params) => {
        try {
          stmt.bind(params);
          const r = [];
          while (stmt.step()) r.push(stmt.getAsObject());
          return r;
        }
        finally { try { stmt.reset(); } catch {} }
      },
      run: (...params) => {
        stmt.bind(params);
        stmt.step();
        stmt.reset();
        const changes = this._db.getRowsModified();
        if (changes > 0) { dirty = true; save(); }
        let lastId = 0;
        try {
          const res = this._db.exec('SELECT last_insert_rowid() as id');
          if (res.length && res[0].values.length) lastId = Number(res[0].values[0][0]);
        } catch {}
        return { changes, lastInsertRowid: lastId };
      },
      free: () => { try { stmt.free(); } catch {} }
    };
  };

  this.pragma = (cmd) => {
    try { return this._db.exec(`PRAGMA ${cmd}`); }
    catch { return []; }
  };

  this.close = () => {
    save();
    try { this._db.close(); } catch {}
  };
}

function getWriteDb() {
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
  return new openDb(dbPath, false);
}

function getReadDb() {
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
  return new openDb(dbPath, true);
}

// ============ VALIDATE EXISTING PREDICTIONS ============
function validateExistingPredictions() {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    const cutoff5d = new Date();
    cutoff5d.setDate(cutoff5d.getDate() - 5);
    const cutoff10d = new Date();
    cutoff10d.setDate(cutoff10d.getDate() - 10);
    const cutoff20d = new Date();
    cutoff20d.setDate(cutoff20d.getDate() - 20);

    const unvalidated = db.prepare(`
      SELECT * FROM prediction_logs 
      WHERE validated = 0 AND prediction_date <= ?
      ORDER BY prediction_date ASC
    `).all(cutoff5d.toISOString().split('T')[0]);

    let count = 0;
    const cutoff20dStr = cutoff20d.toISOString().split('T')[0];

    for (const pred of unvalidated) {
      const stockId = pred.stock_id || null;
      const ticker = pred.ticker;
      const predDate = pred.prediction_date;

      let sid = stockId;
      if (!sid) {
        const stockRow = db.prepare('SELECT id, current_price FROM stocks WHERE ticker = ?').get(ticker);
        if (!stockRow) continue;
        sid = stockRow.id;
      }

      const predDateParsed = new Date(predDate);
      const date5d = new Date(predDateParsed); date5d.setDate(date5d.getDate() + 5);
      const date10d = new Date(predDateParsed); date10d.setDate(date10d.getDate() + 10);
      const date20d = new Date(predDateParsed); date20d.setDate(date20d.getDate() + 20);

      const histRows = db.prepare(`
        SELECT date, close_price FROM stock_price_history 
        WHERE stock_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC
      `).all(sid, predDate, date20d.toISOString().split('T')[0]);

      if (histRows.length === 0) continue;

      const entryRow = histRows.find(h => new Date(h.date) >= predDateParsed);
      const entryPrice = entryRow?.close_price || pred.entry_price || histRows[0].close_price;

      let actual5d = null, actual10d = null, actual20d = null;
      const date5dStr = date5d.toISOString().split('T')[0];
      const date10dStr = date10d.toISOString().split('T')[0];
      const date20dStr = date20d.toISOString().split('T')[0];

      for (const row of histRows) {
        const rowDate = row.date.split('T')[0];
        if (!actual5d && rowDate >= date5dStr) actual5d = row.close_price;
        if (!actual10d && rowDate >= date10dStr) actual10d = row.close_price;
        if (!actual20d && rowDate >= date20dStr) actual20d = row.close_price;
      }

      if (!actual5d && !actual10d && !actual20d) continue;

      const direction = pred.predicted_direction;

      const dirCorrect5d = actual5d
        ? ((direction === 'up' && actual5d > entryPrice) || (direction === 'down' && actual5d < entryPrice) || direction === 'neutral') ? 1 : 0 : null;
      const dirCorrect10d = actual10d
        ? ((direction === 'up' && actual10d > entryPrice) || (direction === 'down' && actual10d < entryPrice) || direction === 'neutral') ? 1 : 0 : null;
      const dirCorrect20d = actual20d
        ? ((direction === 'up' && actual20d > entryPrice) || (direction === 'down' && actual20d < entryPrice) || direction === 'neutral') ? 1 : 0 : null;

      const pred5d = Number(pred.predicted_price_5d);
      const pred10d = Number(pred.predicted_price_10d);
      const pred20d = Number(pred.predicted_price_20d);

      const priceErr5d = (actual5d && pred5d > 0) ? Math.round(((actual5d - pred5d) / pred5d) * 10000) / 100 : null;
      const priceErr10d = (actual10d && pred10d > 0) ? Math.round(((actual10d - pred10d) / pred10d) * 10000) / 100 : null;
      const priceErr20d = (actual20d && pred20d > 0) ? Math.round(((actual20d - pred20d) / pred20d) * 10000) / 100 : null;

      const targetPrice = Number(pred.target_price) || 0;
      const stopLoss = Number(pred.stop_loss) || 0;
      let targetReached = null, stopHit = null;

      const allPrices = [actual5d, actual10d, actual20d].filter(p => p !== null);
      if (targetPrice > 0 && allPrices.length > 0) targetReached = allPrices.some(p => p >= targetPrice) ? 1 : 0;
      if (stopLoss > 0 && allPrices.length > 0) stopHit = allPrices.some(p => p <= stopLoss) ? 1 : 0;

      db.prepare(`
        UPDATE prediction_logs SET
          validated = 1, validated_at = datetime('now'),
          actual_price_5d = ?, actual_price_10d = ?, actual_price_20d = ?,
          direction_correct_5d = ?, direction_correct_10d = ?, direction_correct_20d = ?,
          price_error_5d = ?, price_error_10d = ?, price_error_20d = ?,
          target_reached = ?, stop_hit = ?
        WHERE id = ?
      `).run(actual5d, actual10d, actual20d, dirCorrect5d, dirCorrect10d, dirCorrect20d, priceErr5d, priceErr10d, priceErr20d, targetReached, stopHit, pred.id);

      count++;
    }
    return count;
  } finally {
    db.close();
  }
}

// ============ CALCULATE ACCURACY ============
function calculateHorizonAccuracy(db, priceCol, dirCol, errCol) {
  const total = db.prepare(`SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 1 AND ${priceCol} IS NOT NULL`).get();
  if (total.c < 5) return null;

  const correct = db.prepare(`SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 1 AND ${dirCol} = 1`).get();
  const avgErr = db.prepare(`SELECT AVG(${errCol}) as avg FROM prediction_logs WHERE validated = 1 AND ${errCol} IS NOT NULL`).get();

  // By recommendation
  const byRecRows = db.prepare(`
    SELECT recommendation, COUNT(*) as total,
      SUM(CASE WHEN ${dirCol} = 1 THEN 1 ELSE 0 END) as correct
    FROM prediction_logs WHERE validated = 1 AND ${priceCol} IS NOT NULL
    GROUP BY recommendation
  `).all();
  const by_recommendation = {};
  for (const r of byRecRows) {
    by_recommendation[r.recommendation || 'unknown'] = {
      total: r.total, correct: r.correct,
      accuracy: r.total > 0 ? Math.round((r.correct / r.total) * 1000) / 10 : 0
    };
  }

  // By regime
  const byRegimeRows = db.prepare(`
    SELECT market_regime, COUNT(*) as total,
      SUM(CASE WHEN ${dirCol} = 1 THEN 1 ELSE 0 END) as correct
    FROM prediction_logs WHERE validated = 1 AND ${priceCol} IS NOT NULL
    GROUP BY market_regime
  `).all();
  const by_regime = {};
  for (const r of byRegimeRows) {
    by_regime[r.market_regime || 'unknown'] = {
      total: r.total, correct: r.correct,
      accuracy: r.total > 0 ? Math.round((r.correct / r.total) * 1000) / 10 : 0
    };
  }

  // Score correlation
  const scoreRows = db.prepare(`
    SELECT
      AVG(CASE WHEN ${dirCol} = 1 THEN composite_score END) as avg_correct,
      AVG(CASE WHEN ${dirCol} = 0 THEN composite_score END) as avg_incorrect
    FROM prediction_logs WHERE validated = 1 AND ${priceCol} IS NOT NULL AND composite_score IS NOT NULL
  `).get();

  const targetReached = db.prepare(`SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 1 AND target_reached = 1`).get();
  const stopHit = db.prepare(`SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 1 AND stop_hit = 1`).get();

  return {
    total: total.c,
    direction_correct: correct.c,
    direction_accuracy: total.c > 0 ? Math.round((correct.c / total.c) * 1000) / 10 : 0,
    avg_price_error: avgErr?.avg ? Math.round(avgErr.avg * 100) / 100 : 0,
    by_recommendation, by_regime,
    avg_score_correct: scoreRows?.avg_correct ? Math.round(scoreRows.avg_correct * 10) / 10 : 0,
    avg_score_incorrect: scoreRows?.avg_incorrect ? Math.round(scoreRows.avg_incorrect * 10) / 10 : 0,
    target_reached_count: targetReached.c,
    stop_hit_count: stopHit.c,
  };
}

function calculateAccuracyMetrics() {
  const db = getReadDb();
  try {
    const h5d = calculateHorizonAccuracy(db, 'actual_price_5d', 'direction_correct_5d', 'price_error_5d');
    const h10d = calculateHorizonAccuracy(db, 'actual_price_10d', 'direction_correct_10d', 'price_error_10d');
    const h20d = calculateHorizonAccuracy(db, 'actual_price_20d', 'direction_correct_20d', 'price_error_20d');

    const validHorizons = [h5d, h10d, h20d].filter(h => h !== null);
    let overall_direction_accuracy = 0;
    let overall_avg_price_error = 0;
    let total_validated = 0;

    if (validHorizons.length > 0) {
      let totalWeight = 0, weightedAcc = 0, weightedErr = 0;
      for (const h of validHorizons) {
        totalWeight += h.total;
        weightedAcc += h.direction_accuracy * h.total;
        weightedErr += h.avg_price_error * h.total;
        total_validated += h.total;
      }
      overall_direction_accuracy = totalWeight > 0 ? Math.round((weightedAcc / totalWeight) * 10) / 10 : 0;
      overall_avg_price_error = totalWeight > 0 ? Math.round((weightedErr / totalWeight) * 100) / 100 : 0;
    }

    return { horizon_5d: h5d, horizon_10d: h10d, horizon_20d: h20d, overall_direction_accuracy, overall_avg_price_error, total_validated };
  } finally {
    db.close();
  }
}

// ============ WEIGHT TUNING ============
function getWeight(db, paramName, defaultValue) {
  const row = db.prepare('SELECT current_value FROM calculation_weights WHERE parameter_name = ?').get(paramName);
  return row ? Number(row.current_value) : defaultValue;
}

function computeWeightAdjustments(accuracy) {
  const db = getReadDb();
  try {
    const adjustments = [];
    const minPredictions = getWeight(db, 'feedback_min_predictions', 30);
    if (accuracy.total_validated < minPredictions) return adjustments;

    const targetAccuracy = getWeight(db, 'feedback_direction_accuracy_target', 55);
    const boostFactor = getWeight(db, 'feedback_boost_factor', 0.05);
    const decayFactor = getWeight(db, 'feedback_decay_factor', 0.03);
    const maxAdj = getWeight(db, 'feedback_max_weight_adjustment', 15) / 100;

    const h5d = accuracy.horizon_5d;
    if (!h5d) return adjustments;

    // Quality score correlation
    if (h5d.avg_score_correct > h5d.avg_score_incorrect + 5) {
      const qualWeight = getWeight(db, 'weight_profitability', 0.25);
      const newQualWeight = Math.min(qualWeight * (1 + boostFactor), qualWeight * (1 + maxAdj));
      adjustments.push({
        parameter_name: 'weight_profitability',
        old_value: qualWeight,
        new_value: Math.round(newQualWeight * 1000) / 1000,
        reason: `Quality discriminates well (avg correct: ${h5d.avg_score_correct} vs incorrect: ${h5d.avg_score_incorrect}) — boosting profitability weight`,
        accuracy_impact: `${h5d.avg_score_correct - h5d.avg_score_incorrect} point gap`,
      });
    } else if (h5d.avg_score_correct < h5d.avg_score_incorrect - 3) {
      const qualWeight = getWeight(db, 'weight_profitability', 0.25);
      const newQualWeight = Math.max(qualWeight * (1 - decayFactor), qualWeight * (1 - maxAdj));
      adjustments.push({
        parameter_name: 'weight_profitability',
        old_value: qualWeight,
        new_value: Math.round(newQualWeight * 1000) / 1000,
        reason: `Quality NOT discriminating (negative gap) — slightly reducing profitability weight`,
        accuracy_impact: `${h5d.avg_score_correct - h5d.avg_score_incorrect} point gap`,
      });
    }

    // Regime adjustments
    const bullAcc = h5d.by_regime.bull;
    if (bullAcc && bullAcc.accuracy < targetAccuracy - 10) {
      const mult = getWeight(db, 'regime_bull_multiplier', 1.3);
      const newMult = Math.max(mult * (1 - decayFactor), 1.0);
      adjustments.push({
        parameter_name: 'regime_bull_multiplier',
        old_value: mult,
        new_value: Math.round(newMult * 1000) / 1000,
        reason: `Bull market accuracy weak (${bullAcc.accuracy}%) — reducing confidence multiplier`,
        accuracy_impact: `Bull accuracy: ${bullAcc.accuracy}%`,
      });
    }

    const strongBuyAcc = h5d.by_recommendation['Strong Buy'];
    if (strongBuyAcc && strongBuyAcc.accuracy < 50) {
      const threshold = getWeight(db, 'strong_buy_threshold', 65);
      const newThreshold = Math.min(threshold + 2, 85);
      adjustments.push({
        parameter_name: 'strong_buy_threshold',
        old_value: threshold,
        new_value: newThreshold,
        reason: `Strong Buy accuracy low (${strongBuyAcc.accuracy}%) — raising threshold`,
        accuracy_impact: `Strong Buy accuracy: ${strongBuyAcc.accuracy}%`,
      });
    }

    return adjustments;
  } finally {
    db.close();
  }
}

function applyWeightAdjustments(adjustments) {
  if (adjustments.length === 0) return 0;
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    let applied = 0;
    const maxAdjPct = 0.15;

    for (const adj of adjustments) {
      const current = db.prepare('SELECT current_value, min_bound, max_bound FROM calculation_weights WHERE parameter_name = ?').get(adj.parameter_name);
      if (!current) continue;

      const maxAllowed = current.current_value * (1 + maxAdjPct);
      const minAllowed = current.current_value * (1 - maxAdjPct);
      const clampedValue = Math.max(minAllowed, Math.min(maxAllowed, adj.new_value));

      let finalValue = clampedValue;
      if (current.min_bound !== null && finalValue < current.min_bound) continue;
      if (current.max_bound !== null && finalValue > current.max_bound) continue;
      if (Math.abs(finalValue - current.current_value) < 0.0001) continue;

      db.prepare(`UPDATE calculation_weights SET current_value = ?, updated_at = datetime('now'), updated_by = 'auto_feedback' WHERE parameter_name = ?`).run(finalValue, adj.parameter_name);
      db.prepare(`INSERT INTO weight_adjustment_logs (parameter_name, old_value, new_value, requested_value, adjustment_reason, adjusted_by, created_at) VALUES (?, ?, ?, ?, ?, 'auto_feedback', datetime('now'))`).run(adj.parameter_name, current.current_value, finalValue, adj.new_value, adj.reason);
      applied++;
    }
    return applied;
  } finally {
    db.close();
  }
}

function saveAccuracySummary(accuracy) {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    const now = new Date().toISOString();

    for (const [horizon, data] of [['5d', accuracy.horizon_5d], ['10d', accuracy.horizon_10d], ['20d', accuracy.horizon_20d]]) {
      if (!data) continue;
      db.prepare(`
        INSERT INTO feedback_accuracy_summary (
          evaluated_at, model_version, time_horizon,
          total_predictions, direction_correct, direction_accuracy,
          avg_price_error, median_price_error,
          buy_signal_accuracy, sell_signal_accuracy, strong_buy_accuracy, hold_accuracy,
          target_reached_count, stop_hit_count,
          avg_composite_score_correct, avg_composite_score_incorrect,
          regime_bull_accuracy, regime_bear_accuracy, regime_neutral_accuracy,
          details, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        now, '2.0.0', horizon,
        data.total, data.direction_correct, data.direction_accuracy,
        data.avg_price_error, data.avg_price_error,
        data.by_recommendation['Buy']?.accuracy || 0,
        Math.round(((data.by_recommendation['Avoid']?.accuracy || 0) + (data.by_recommendation['Strong Avoid']?.accuracy || 0)) / 2),
        data.by_recommendation['Strong Buy']?.accuracy || 0,
        data.by_recommendation['Hold']?.accuracy || 0,
        data.target_reached_count, data.stop_hit_count,
        data.avg_score_correct, data.avg_score_incorrect,
        data.by_regime.bull?.accuracy || 0,
        data.by_regime.bear?.accuracy || 0,
        data.by_regime.neutral?.accuracy || 0,
        JSON.stringify({ by_recommendation: data.by_recommendation, by_regime: data.by_regime }),
        now,
      );
    }
  } finally {
    db.close();
  }
}

// ============ MAIN ============
async function main() {
  console.log('[Feedback] Starting standalone feedback loop...');
  console.log('[Feedback] Timestamp:', new Date().toISOString());
  console.log('');

  await initSql();

  // Step 1: Validate existing predictions
  console.log('[Step 1] Validating existing predictions...');
  const validated = validateExistingPredictions();
  console.log(`[Step 1] ${validated} predictions validated`);

  // Step 2: Calculate accuracy
  console.log('[Step 2] Calculating accuracy metrics...');
  const accuracy = calculateAccuracyMetrics();
  console.log(`[Step 2] Overall accuracy: ${accuracy.overall_direction_accuracy}% (${accuracy.total_validated} validated)`);

  // Step 3: Compute weight adjustments
  console.log('[Step 3] Computing weight adjustments...');
  const adjustments = computeWeightAdjustments(accuracy);

  let appliedCount = 0;
  if (adjustments.length > 0) {
    console.log(`[Step 4] Applying ${adjustments.length} weight adjustments...`);
    appliedCount = applyWeightAdjustments(adjustments);
    console.log(`[Step 4] Applied ${appliedCount}/${adjustments.length} adjustments`);
  } else {
    console.log('[Step 4] No weight adjustments needed');
  }

  // Step 5: Save accuracy summary
  console.log('[Step 5] Saving accuracy summary...');
  saveAccuracySummary(accuracy);

  // ============ REPORT ============
  console.log('\n========================================');
  console.log('  FEEDBACK LOOP RESULTS');
  console.log('========================================');
  console.log(`Success: true`);
  console.log(`Predictions Validated: ${validated}`);
  console.log(`Overall Direction Accuracy: ${accuracy.overall_direction_accuracy}%`);
  console.log(`Total Validated: ${accuracy.total_validated}`);

  if (accuracy.horizon_5d) {
    console.log(`\n[5-Day] Accuracy: ${accuracy.horizon_5d.direction_accuracy}% | Avg Error: ${accuracy.horizon_5d.avg_price_error}% | Correct: ${accuracy.horizon_5d.direction_correct}/${accuracy.horizon_5d.total}`);
    console.log(`[5-Day] By Rec: ${JSON.stringify(accuracy.horizon_5d.by_recommendation)}`);
    console.log(`[5-Day] By Regime: ${JSON.stringify(accuracy.horizon_5d.by_regime)}`);
    console.log(`[5-Day] Score: correct=${accuracy.horizon_5d.avg_score_correct} vs incorrect=${accuracy.horizon_5d.avg_score_incorrect}`);
  }
  if (accuracy.horizon_10d) {
    console.log(`[10-Day] Accuracy: ${accuracy.horizon_10d.direction_accuracy}% | Avg Error: ${accuracy.horizon_10d.avg_price_error}% | Correct: ${accuracy.horizon_10d.direction_correct}/${accuracy.horizon_10d.total}`);
  }
  if (accuracy.horizon_20d) {
    console.log(`[20-Day] Accuracy: ${accuracy.horizon_20d.direction_accuracy}% | Avg Error: ${accuracy.horizon_20d.avg_price_error}% | Correct: ${accuracy.horizon_20d.direction_correct}/${accuracy.horizon_20d.total}`);
  }

  if (adjustments.length > 0) {
    console.log('\n[Weight Adjustments]');
    for (const adj of adjustments) {
      console.log(`  ${adj.parameter_name}: ${adj.old_value} → ${adj.new_value}`);
      console.log(`    Reason: ${adj.reason}`);
    }
    console.log(`  Applied: ${appliedCount}/${adjustments.length}`);
  } else {
    console.log('\n[Weight Adjustments] None');
  }

  console.log('\n========================================');
  console.log(`Message: Validated ${validated} predictions. Overall accuracy: ${accuracy.overall_direction_accuracy}%. Applied ${appliedCount}/${adjustments.length} weight adjustments.`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

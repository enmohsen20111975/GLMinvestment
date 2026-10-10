#!/usr/bin/env node
/**
 * Close Stale Predictions Script
 * ================================
 * يغلق التوقعات المعلقة اللي مفروض تتقفل:
 *
 * 1. KSE/QSE → REJECTED (مفيش بيانات أسعار حقيقية)
 * 2. رموز أسهم مكسورة (بها أسماء عربية ملصقة) → REJECTED
 * 3. توقعات HOLD بدون هدف/وقف → EXPIRED
 * 4. توقعات أقدم من 60 يوم → EXPIRED (النظام بيشتغل شهرياً)
 * 5. توقعات EGX قديمة في persona_predictions → verify و close
 *
 * الاستخدام: node scripts/close-stale-predictions.js [--dry-run]
 */

const Database = require('better-sqlite3');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const dbPath = path.join(process.cwd(), 'db', 'predictions.db');

// ═══ CONSTANTS ═══
const HIDDEN_MARKETS = ['KSE', 'QSE', 'KUWAIT', 'QATAR', 'الكويت', 'قطر'];
const MAX_AGE_DAYS = 60; // النظام شهري — مفيش توقع يفضل مفتوح أكتر من شهرين
const MAX_SYMBOL_LENGTH = 10; // رمز سهم عادي مش بيزيد عن 10 حروف

let totalClosed = 0;
const stats = {
  hidden_markets: 0,
  broken_symbols: 0,
  hold_no_target: 0,
  too_old: 0,
  ai_hidden_markets: 0,
};

function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔒 Close Stale Predictions ${DRY_RUN ? '(DRY RUN)' : ''}`);
  console.log(`${'═'.repeat(60)}\n`);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  try {
    // ═══ STEP 1: Close KSE/QSE in persona_predictions ═══
    console.log('📍 STEP 1: Closing hidden markets (KSE/QSE) in persona_predictions...');
    const hiddenMarketPreds = db.prepare(`
      SELECT id, ticker, market, persona_type, signal_type, prediction_date
      FROM persona_predictions
      WHERE status = 'PENDING' AND market IN (${HIDDEN_MARKETS.map(() => '?').join(', ')})
    `).all(...HIDDEN_MARKETS);

    console.log(`   Found ${hiddenMarketPreds.length} PENDING predictions from hidden markets`);

    if (!DRY_RUN && hiddenMarketPreds.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE persona_predictions
        SET status = 'REJECTED', final_price = entry_price, profit_loss_percent = 0
        WHERE id = ?
      `);
      const transaction = db.transaction((ids) => {
        for (const id of ids) updateStmt.run(id);
      });
      transaction(hiddenMarketPreds.map(p => p.id));
      stats.hidden_markets = hiddenMarketPreds.length;
      totalClosed += hiddenMarketPreds.length;
      console.log(`   ✅ Closed ${hiddenMarketPreds.length} hidden market predictions`);
    } else if (DRY_RUN) {
      stats.hidden_markets = hiddenMarketPreds.length;
      console.log(`   [DRY RUN] Would close ${hiddenMarketPreds.length} hidden market predictions`);
    }

    // ═══ STEP 2: Close broken stock symbols in persona_predictions ═══
    console.log('\n📍 STEP 2: Closing broken stock symbols (Arabic names concatenated)...');
    const brokenPreds = db.prepare(`
      SELECT id, ticker, market, persona_type, signal_type, prediction_date
      FROM persona_predictions
      WHERE status = 'PENDING' AND LENGTH(ticker) > ?
    `).all(MAX_SYMBOL_LENGTH);

    console.log(`   Found ${brokenPreds.length} PENDING predictions with broken symbols`);

    // But exclude legitimate long tickers like commodities/indices
    const legitLong = brokenPreds.filter(p => {
      const t = p.ticker;
      // TADAWUL .SR suffix or indices like ^DJI are ok
      if (t.endsWith('.SR')) return true;
      if (t.startsWith('^')) return true;
      // Pure number tickers (like 9517) are ok even if long
      if (/^\d+$/.test(t)) return true;
      return false;
    });
    const actuallyBroken = brokenPreds.filter(p => !legitLong.includes(p));

    console.log(`   Legitimate long symbols: ${legitLong.length}, Actually broken: ${actuallyBroken.length}`);

    if (!DRY_RUN && actuallyBroken.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE persona_predictions
        SET status = 'REJECTED', final_price = entry_price, profit_loss_percent = 0
        WHERE id = ?
      `);
      const transaction = db.transaction((ids) => {
        for (const id of ids) updateStmt.run(id);
      });
      transaction(actuallyBroken.map(p => p.id));
      stats.broken_symbols = actuallyBroken.length;
      totalClosed += actuallyBroken.length;
      console.log(`   ✅ Closed ${actuallyBroken.length} broken symbol predictions`);
    } else if (DRY_RUN) {
      stats.broken_symbols = actuallyBroken.length;
      console.log(`   [DRY RUN] Would close ${actuallyBroken.length} broken symbol predictions`);
    }

    // ═══ STEP 3: Close HOLD signals with no target/stop in persona_predictions ═══
    console.log('\n📍 STEP 3: Closing HOLD signals with no target/stop (can never be evaluated)...');
    const holdNoTarget = db.prepare(`
      SELECT id, ticker, market, persona_type, signal_type, prediction_date
      FROM persona_predictions
      WHERE status = 'PENDING'
        AND (signal_type = 'HOLD' OR signal_type = 'WAIT')
        AND (target_price IS NULL OR stop_loss IS NULL)
    `).all();

    console.log(`   Found ${holdNoTarget.length} HOLD/WAIT predictions with no target or stop`);

    if (!DRY_RUN && holdNoTarget.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE persona_predictions
        SET status = 'EXPIRED', final_price = entry_price, profit_loss_percent = 0
        WHERE id = ?
      `);
      const transaction = db.transaction((ids) => {
        for (const id of ids) updateStmt.run(id);
      });
      transaction(holdNoTarget.map(p => p.id));
      stats.hold_no_target = holdNoTarget.length;
      totalClosed += holdNoTarget.length;
      console.log(`   ✅ Closed ${holdNoTarget.length} HOLD predictions`);
    } else if (DRY_RUN) {
      stats.hold_no_target = holdNoTarget.length;
      console.log(`   [DRY RUN] Would close ${holdNoTarget.length} HOLD predictions`);
    }

    // ═══ STEP 4: Close predictions older than MAX_AGE_DAYS in persona_predictions ═══
    console.log(`\n📍 STEP 4: Closing predictions older than ${MAX_AGE_DAYS} days (system works monthly)...`);
    const tooOld = db.prepare(`
      SELECT id, ticker, market, persona_type, signal_type, prediction_date,
             julianday('now') - julianday(prediction_date) as days_old
      FROM persona_predictions
      WHERE status = 'PENDING'
        AND julianday('now') - julianday(prediction_date) > ?
    `).all(MAX_AGE_DAYS);

    console.log(`   Found ${tooOld.length} PENDING predictions older than ${MAX_AGE_DAYS} days`);

    if (!DRY_RUN && tooOld.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE persona_predictions
        SET status = 'EXPIRED', final_price = entry_price, profit_loss_percent = 0
        WHERE id = ?
      `);
      const transaction = db.transaction((ids) => {
        for (const id of ids) updateStmt.run(id);
      });
      transaction(tooOld.map(p => p.id));
      stats.too_old = tooOld.length;
      totalClosed += tooOld.length;
      console.log(`   ✅ Closed ${tooOld.length} too-old predictions`);
    } else if (DRY_RUN) {
      stats.too_old = tooOld.length;
      console.log(`   [DRY RUN] Would close ${tooOld.length} too-old predictions`);
    }

    // ═══ STEP 5: Close KSE/QSE in aiPrediction table ═══
    console.log('\n📍 STEP 5: Closing hidden markets in aiPrediction table...');
    const aiHidden = db.prepare(`
      SELECT id, stock_symbol, market, status
      FROM aiPrediction
      WHERE status = 'PENDING' AND market IN (${HIDDEN_MARKETS.map(() => '?').join(', ')})
    `).all(...HIDDEN_MARKETS);

    console.log(`   Found ${aiHidden.length} PENDING aiPredictions from hidden markets`);

    if (!DRY_RUN && aiHidden.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE aiPrediction
        SET status = 'REJECTED', final_price = entry_price, profit_loss_percent = 0,
            evaluation_date = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `);
      const transaction = db.transaction((ids) => {
        for (const id of ids) updateStmt.run(id);
      });
      transaction(aiHidden.map(p => p.id));
      stats.ai_hidden_markets = aiHidden.length;
      totalClosed += aiHidden.length;
      console.log(`   ✅ Closed ${aiHidden.length} hidden market aiPredictions`);
    } else if (DRY_RUN) {
      stats.ai_hidden_markets = aiHidden.length;
      console.log(`   [DRY RUN] Would close ${aiHidden.length} hidden market aiPredictions`);
    }

    // ═══ FINAL REPORT ═══
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 CLOSING REPORT ${DRY_RUN ? '(DRY RUN - nothing changed)' : ''}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`   Hidden markets (persona):  ${stats.hidden_markets}`);
    console.log(`   Broken symbols (persona):  ${stats.broken_symbols}`);
    console.log(`   HOLD no target (persona):  ${stats.hold_no_target}`);
    console.log(`   Too old (persona):         ${stats.too_old}`);
    console.log(`   Hidden markets (aiPred):   ${stats.ai_hidden_markets}`);
    console.log(`   ─────────────────────────────────`);
    console.log(`   TOTAL CLOSED:              ${totalClosed}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Show remaining pending counts
    console.log('📈 REMAINING PREDICTIONS:');
    const remainingPersona = db.prepare(`
      SELECT market, status, COUNT(*) as cnt
      FROM persona_predictions
      GROUP BY market, status
      ORDER BY market, status
    `).all();
    console.table(remainingPersona);

    const remainingAi = db.prepare(`
      SELECT market, status, COUNT(*) as cnt
      FROM aiPrediction
      GROUP BY market, status
      ORDER BY market, status
    `).all();
    console.table(remainingAi);

  } finally {
    db.close();
  }
}

main();

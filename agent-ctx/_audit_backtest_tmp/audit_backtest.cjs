// AUDIT-BACKTEST script — READ-ONLY queries against SQLite DBs.
'use strict';

const Database = require('/home/z/my-project/node_modules/better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = '/home/z/my-project/db';

function openDb(name) {
  return new Database(path.join(DB_DIR, name), { readonly: true, fileMustExist: true });
}

const predDb = openDb('predictions.db');
const phDb = openDb('price_history.db');
const stocksDb = openDb('stocks.db');
const deDb = openDb('data_engine.db');

const TODAY = '2026-09-27';
const out = { phases: {} };

function safeQuery(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (e) {
    return { __error: e.message };
  }
}
function safeGet(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch (e) {
    return { __error: e.message };
  }
}

// ===== PHASE 1: Database state check =====
const phase1 = {};
phase1.predictions = {};
phase1.predictions.total = safeGet(predDb, "SELECT COUNT(*) AS c FROM predictions").c;
phase1.predictions.latest_date = safeGet(predDb, "SELECT MAX(prediction_date) AS d FROM predictions").d;
phase1.predictions.status_dist = safeQuery(predDb, "SELECT status, COUNT(*) AS c FROM predictions GROUP BY status ORDER BY c DESC");
phase1.predictions.persona_dist = safeQuery(predDb, "SELECT COALESCE(persona,'(null)') AS persona, COUNT(*) AS c FROM predictions GROUP BY persona ORDER BY c DESC");
phase1.predictions.persona_winrate = safeQuery(predDb, "SELECT COALESCE(persona,'(null)') AS persona, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions WHERE COALESCE(status,'') != 'active' GROUP BY persona ORDER BY win_rate_pct DESC");
phase1.predictions.signal_type_dist = safeQuery(predDb, "SELECT COALESCE(signal_type,'(null)') AS signal_type, COUNT(*) AS c FROM predictions GROUP BY signal_type ORDER BY c DESC");

phase1.stored_analyses = safeGet(predDb, "SELECT COUNT(*) AS c FROM stored_analyses");
phase1.stored_analyses_latest = safeGet(predDb, "SELECT MAX(created_at) AS d FROM stored_analyses");

phase1.hunter_pick_tracking = {};
phase1.hunter_pick_tracking.total = safeGet(predDb, "SELECT COUNT(*) AS c FROM hunter_pick_tracking").c;
phase1.hunter_pick_tracking.pending = safeGet(predDb, "SELECT COUNT(*) AS c FROM hunter_pick_tracking WHERE status='pending'").c;
phase1.hunter_pick_tracking.by_status = safeQuery(predDb, "SELECT COALESCE(status,'(null)') AS status, COUNT(*) AS c FROM hunter_pick_tracking GROUP BY status");

phase1.persona_predictions = {};
phase1.persona_predictions.total = safeGet(predDb, "SELECT COUNT(*) AS c FROM persona_predictions").c;
phase1.persona_predictions.status_dist = safeQuery(predDb, "SELECT COALESCE(status,'(null)') AS status, COUNT(*) AS c FROM persona_predictions GROUP BY status ORDER BY c DESC");
phase1.persona_predictions.persona_dist = safeQuery(predDb, "SELECT COALESCE(persona,'(null)') AS persona, COUNT(*) AS c FROM persona_predictions GROUP BY persona ORDER BY c DESC");
phase1.persona_predictions.winrate_by_persona = safeQuery(predDb, "SELECT COALESCE(persona,'(null)') AS persona, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(profit_loss_percent), 2) AS avg_return FROM persona_predictions WHERE COALESCE(status,'') NOT IN ('PENDING','') GROUP BY persona ORDER BY win_rate_pct DESC");

phase1.learned_lessons = {};
phase1.learned_lessons.total = safeGet(predDb, "SELECT COUNT(*) AS c FROM learned_lessons").c;
phase1.learned_lessons.lesson_types = safeQuery(predDb, "SELECT lesson_type, COUNT(*) AS c FROM learned_lessons GROUP BY lesson_type ORDER BY c DESC LIMIT 20");
phase1.learned_lessons.distinct_conditions = safeGet(predDb, "SELECT COUNT(DISTINCT condition) AS c FROM learned_lessons").c;
phase1.learned_lessons.top5_by_occ = safeQuery(predDb, "SELECT lesson_type, condition, outcome, occurrences, ROUND(avg_return,2) AS avg_ret, ROUND(failure_rate,2) AS failure_rate FROM learned_lessons ORDER BY occurrences DESC LIMIT 5");

phase1.exit_notifications = {};
phase1.exit_notifications.total = safeGet(predDb, "SELECT COUNT(*) AS c FROM exit_notifications").c;
phase1.exit_notifications.by_type = safeQuery(predDb, "SELECT COALESCE(notification_type,'(null)') AS t, COUNT(*) AS c FROM exit_notifications GROUP BY notification_type ORDER BY c DESC");

phase1.historical_trades = {};
phase1.historical_trades.total = safeGet(predDb, "SELECT COUNT(*) AS c FROM historical_trades").c;
phase1.historical_trades.winrate = safeGet(predDb, "SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(outcome,'') IN ('win','target_hit','profit') OR pnl_pct > 0 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(outcome,'') IN ('win','target_hit','profit') OR pnl_pct > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(pnl_pct), 2) AS avg_return FROM historical_trades WHERE sell_date IS NOT NULL");
phase1.historical_trades.by_outcome = safeQuery(predDb, "SELECT COALESCE(outcome,'(null)') AS outcome, COUNT(*) AS c, ROUND(AVG(pnl_pct),2) AS avg_ret FROM historical_trades GROUP BY outcome ORDER BY c DESC");
phase1.historical_trades.by_strategy = safeQuery(predDb, "SELECT strategy, COUNT(*) AS c, ROUND(AVG(pnl_pct),2) AS avg_ret, ROUND(100.0*SUM(CASE WHEN pnl_pct>0 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct FROM historical_trades GROUP BY strategy ORDER BY c DESC LIMIT 20");

out.phases.phase1 = phase1;

// ===== PHASE 2: Prediction accuracy on CLOSED predictions =====
const phase2 = {};
phase2.closed_filter = "WHERE COALESCE(status,'') != 'active' AND outcome_date IS NOT NULL AND actual_return IS NOT NULL";

phase2.overall = safeGet(predDb, "SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN COALESCE(hit_stop,0)=1 THEN 1 ELSE 0 END) AS stops, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return, ROUND(MIN(actual_return), 2) AS min_return, ROUND(MAX(actual_return), 2) AS max_return, ROUND(AVG(holding_days), 1) AS avg_holding_days FROM predictions " + phase2.closed_filter);

phase2.closed_broad = safeGet(predDb, "SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN COALESCE(hit_stop,0)=1 THEN 1 ELSE 0 END) AS stops, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions WHERE COALESCE(status,'') != 'active'");

phase2.by_persona = safeQuery(predDb, "SELECT COALESCE(persona,'(null)') AS persona, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN COALESCE(hit_stop,0)=1 THEN 1 ELSE 0 END) AS stops, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return, ROUND(AVG(holding_days), 1) AS avg_hold FROM predictions " + phase2.closed_filter + " GROUP BY persona ORDER BY win_rate_pct DESC");

phase2.by_signal_type = safeQuery(predDb, "SELECT COALESCE(signal_type,'(null)') AS signal_type, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions " + phase2.closed_filter + " GROUP BY signal_type ORDER BY win_rate_pct DESC");

phase2.by_holding_bucket = safeQuery(predDb, "SELECT CASE WHEN holding_days IS NULL OR holding_days=0 THEN 'unknown' WHEN holding_days <= 3 THEN '0-3d' WHEN holding_days <= 7 THEN '4-7d' WHEN holding_days <= 14 THEN '8-14d' WHEN holding_days <= 30 THEN '15-30d' WHEN holding_days <= 60 THEN '31-60d' ELSE '60d+' END AS bucket, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions " + phase2.closed_filter + " GROUP BY bucket ORDER BY bucket");

phase2.worst_5_trades = safeQuery(predDb, "SELECT id, ticker, persona, prediction_date, entry_price, target_price, stop_loss, exit_price, actual_return, hit_target, hit_stop, holding_days, exit_reason FROM predictions " + phase2.closed_filter + " ORDER BY actual_return ASC LIMIT 5");
phase2.best_5_trades = safeQuery(predDb, "SELECT id, ticker, persona, prediction_date, entry_price, target_price, stop_loss, exit_price, actual_return, hit_target, hit_stop, holding_days, exit_reason FROM predictions " + phase2.closed_filter + " ORDER BY actual_return DESC LIMIT 5");

phase2.histogram = safeQuery(predDb, "SELECT CASE WHEN actual_return < -50 THEN 'a_<-50%' WHEN actual_return < -25 THEN 'b_-50%_-25%' WHEN actual_return < 0 THEN 'c_-25%_0%' WHEN actual_return < 25 THEN 'd_0%_25%' WHEN actual_return < 50 THEN 'e_25%_50%' WHEN actual_return < 100 THEN 'f_50%_100%' ELSE 'g_>=100%' END AS bucket, COUNT(*) AS c, ROUND(AVG(actual_return),2) AS avg_ret FROM predictions " + phase2.closed_filter + " GROUP BY bucket ORDER BY bucket");

out.phases.phase2 = phase2;

// ===== PHASE 3: Backtest 30 random closed predictions vs price_history.db =====
const phase3 = {};

const sample30 = safeQuery(predDb, "SELECT id, ticker, persona, prediction_date, entry_price, target_price, stop_loss, outcome_date, exit_price, actual_return, hit_target, hit_stop, holding_days, exit_reason, status, market FROM predictions " + phase2.closed_filter + " ORDER BY RANDOM() LIMIT 30");

phase3.sample = sample30.map(p => {
  const ticker = p.ticker;
  const entryDate = (p.prediction_date || '').slice(0,10);
  let exitDate = (p.outcome_date || '').slice(0,10);
  if (!exitDate || exitDate < entryDate) {
    const d = new Date(entryDate + 'T00:00:00Z');
    if (!isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() + 30);
      exitDate = d.toISOString().slice(0,10);
    }
  }
  let actualHigh = null, actualLow = null, actualClose = null, actualDays = 0, actualHighDate = null, actualLowDate = null, error = null;
  try {
    const rows = phDb.prepare("SELECT date, high_price, low_price, close_price FROM price_history WHERE ticker = ? AND date >= ? AND date <= ? ORDER BY date ASC").all(ticker, entryDate, exitDate);
    actualDays = rows.length;
    if (rows.length > 0) {
      let hi = -Infinity, lo = Infinity;
      for (const r of rows) {
        if (r.high_price != null && r.high_price > hi) { hi = r.high_price; actualHighDate = r.date; }
        if (r.low_price != null && r.low_price < lo) { lo = r.low_price; actualLowDate = r.date; }
      }
      actualHigh = hi === -Infinity ? null : hi;
      actualLow = lo === Infinity ? null : lo;
      actualClose = rows[rows.length-1].close_price;
    }
  } catch (e) { error = e.message; }
  const target_reached = (actualHigh != null && p.target_price != null && actualHigh >= p.target_price);
  const stop_hit = (actualLow != null && p.stop_loss != null && actualLow <= p.stop_loss);
  let recorded_outcome = '';
  if (p.hit_target === 1) recorded_outcome = 'target_hit';
  else if (p.hit_stop === 1) recorded_outcome = 'stop_hit';
  else if (p.exit_reason) recorded_outcome = p.exit_reason;
  else if (p.actual_return != null && p.actual_return > 0) recorded_outcome = 'profit_close';
  else if (p.actual_return != null) recorded_outcome = 'loss_close';
  else recorded_outcome = 'unknown';
  let match = '';
  if (actualDays === 0) match = 'no_price_data';
  else if (recorded_outcome === 'target_hit' && !target_reached) match = 'MISMATCH_target_claimed_but_high_below_target';
  else if (recorded_outcome === 'stop_hit' && !stop_hit) match = 'MISMATCH_stop_claimed_but_low_above_stop';
  else if (recorded_outcome === 'target_hit' && target_reached) match = 'OK_target_verified';
  else if (recorded_outcome === 'stop_hit' && stop_hit) match = 'OK_stop_verified';
  else if (target_reached && recorded_outcome !== 'target_hit') match = 'POSSIBLE_MISS_target_was_reached_but_not_marked';
  else if (stop_hit && recorded_outcome !== 'stop_hit') match = 'POSSIBLE_MISS_stop_was_hit_but_not_marked';
  else match = 'OK_no_target_no_stop';
  return {
    id: p.id, ticker, persona: p.persona, prediction_date: entryDate, entry_price: p.entry_price,
    target_price: p.target_price, stop_loss: p.stop_loss, outcome_date: p.outcome_date,
    exit_price: p.exit_price, actual_return: p.actual_return, recorded_outcome,
    holding_days: p.holding_days, exit_reason: p.exit_reason, exit_window_end: exitDate,
    price_rows_in_window: actualDays, actual_high: actualHigh, actual_low: actualLow,
    actual_close_on_last_day: actualClose, actual_high_date: actualHighDate, actual_low_date: actualLowDate,
    target_reached, stop_hit, match, error
  };
});

phase3.summary = {
  total: phase3.sample.length,
  ok: phase3.sample.filter(s => s.match.startsWith('OK')).length,
  mismatch: phase3.sample.filter(s => s.match.startsWith('MISMATCH')).length,
  possible_miss: phase3.sample.filter(s => s.match.startsWith('POSSIBLE_MISS')).length,
  no_price_data: phase3.sample.filter(s => s.match === 'no_price_data').length,
};
out.phases.phase3 = phase3;

// ===== PHASE 4: Persona comparison (persona_predictions) =====
const phase4 = {};
phase4.by_persona = safeQuery(predDb, "SELECT COALESCE(persona,'(null)') AS persona, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN COALESCE(hit_stop_loss,0)=1 THEN 1 ELSE 0 END) AS stops, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(profit_loss_percent), 2) AS avg_return, ROUND(AVG(CASE WHEN profit_loss_percent > 0 THEN profit_loss_percent END), 2) AS avg_gain, ROUND(AVG(CASE WHEN profit_loss_percent < 0 THEN profit_loss_percent END), 2) AS avg_loss FROM persona_predictions WHERE COALESCE(status,'') NOT IN ('PENDING','') GROUP BY persona ORDER BY win_rate_pct DESC");

phase4.loss_streaks = [];
const personas = phase4.by_persona.map(r => r.persona);
for (const persona of personas) {
  try {
    const rows = predDb.prepare("SELECT prediction_date, profit_loss_percent, hit_target FROM persona_predictions WHERE COALESCE(persona,'(null)') = ?1 AND COALESCE(status,'') NOT IN ('PENDING','') AND profit_loss_percent IS NOT NULL ORDER BY prediction_date ASC, id ASC").all(persona === '(null)' ? null : persona);
    let maxStreak = 0, curStreak = 0;
    for (const r of rows) {
      if ((r.profit_loss_percent ?? 0) < 0) {
        curStreak++;
        if (curStreak > maxStreak) maxStreak = curStreak;
      } else { curStreak = 0; }
    }
    phase4.loss_streaks.push({ persona, max_loss_streak: maxStreak, total_rows: rows.length });
  } catch (e) {
    phase4.loss_streaks.push({ persona, error: e.message });
  }
}
out.phases.phase4 = phase4;

// ===== PHASE 5: Time-based analysis =====
const phase5 = {};
phase5.monthly = safeQuery(predDb, "SELECT substr(prediction_date,1,7) AS month, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions " + phase2.closed_filter + " GROUP BY month ORDER BY month");

phase5.day_of_week = safeQuery(predDb, "SELECT CASE CAST(strftime('%w', prediction_date) AS INTEGER) WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat' END AS dow, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions " + phase2.closed_filter + " GROUP BY dow ORDER BY total DESC");

phase5.regime_dist = safeQuery(stocksDb, "SELECT regime, COUNT(*) AS c, MIN(date) AS first_date, MAX(date) AS last_date FROM market_regime_log GROUP BY regime ORDER BY c DESC");
phase5.regime_dates = safeQuery(stocksDb, "SELECT date, regime FROM market_regime_log ORDER BY date ASC");

try {
  const regimes = stocksDb.prepare("SELECT date, regime FROM market_regime_log ORDER BY date ASC").all();
  const preds = predDb.prepare("SELECT id, prediction_date FROM predictions " + phase2.closed_filter).all();
  const byRegime = {};
  let unmatched = 0;
  for (const p of preds) {
    if (!p.prediction_date) { unmatched++; continue; }
    const pd = p.prediction_date.slice(0,10);
    let r = null;
    for (const x of regimes) {
      if (x.date <= pd) r = x.regime;
      else break;
    }
    if (!r) { unmatched++; continue; }
    if (!byRegime[r]) byRegime[r] = [];
    byRegime[r].push(p.id);
  }
  phase5.by_regime = [];
  for (const [regime, ids] of Object.entries(byRegime)) {
    if (ids.length === 0) continue;
    let total = 0, wins = 0, retSum = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i+500);
      const ph = chunk.map(() => '?').join(',');
      const row = predDb.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN actual_return IS NOT NULL THEN actual_return ELSE 0 END) AS retSum FROM predictions WHERE id IN (" + ph + ")").get(...chunk);
      total += row.total; wins += row.wins; retSum += row.retSum;
    }
    phase5.by_regime.push({ regime, total, wins, win_rate_pct: total > 0 ? Math.round(100 * wins / total * 10) / 10 : null, avg_return: total > 0 ? Math.round(retSum / total * 100) / 100 : null });
  }
  phase5.by_regime.sort((a,b) => (b.win_rate_pct || 0) - (a.win_rate_pct || 0));
  phase5.unmatched_regime_count = unmatched;
} catch (e) { phase5.by_regime = { __error: e.message }; }

try {
  const cutoff_recent = '2026-08-28';
  const cutoff_prev = '2026-07-29';
  phase5.recent_30d = safeGet(predDb, "SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions " + phase2.closed_filter + " AND prediction_date >= ?1", [cutoff_recent]);
  phase5.prev_30d = safeGet(predDb, "SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions " + phase2.closed_filter + " AND prediction_date >= ?1 AND prediction_date < ?2", [cutoff_prev, cutoff_recent]);
} catch (e) {
  phase5.recent_30d = { __error: e.message };
  phase5.prev_30d = { __error: e.message };
}
out.phases.phase5 = phase5;

// ===== PHASE 6: Hidden insights =====
const phase6 = {};
phase6.top_tickers = safeQuery(predDb, "SELECT ticker, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions " + phase2.closed_filter + " GROUP BY ticker HAVING COUNT(*) >= 5 ORDER BY win_rate_pct DESC, total DESC LIMIT 10");

phase6.bottom_tickers = safeQuery(predDb, "SELECT ticker, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions " + phase2.closed_filter + " GROUP BY ticker HAVING COUNT(*) >= 5 ORDER BY win_rate_pct ASC, total DESC LIMIT 10");

try {
  phase6.by_sector = safeQuery(stocksDb, "SELECT s.sector, COUNT(*) AS total, SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(p.actual_return), 2) AS avg_return FROM predictions p INNER JOIN stocks s ON s.symbol = p.ticker WHERE s.sector IS NOT NULL AND s.sector != '' AND COALESCE(p.status,'') != 'active' AND p.outcome_date IS NOT NULL AND p.actual_return IS NOT NULL GROUP BY s.sector ORDER BY win_rate_pct DESC");
} catch (e) { phase6.by_sector = { __error: e.message }; }

phase6.time_to_target = safeGet(predDb, "SELECT COUNT(*) AS n, ROUND(AVG(holding_days),1) AS avg_days, ROUND(MIN(holding_days),0) AS min_days, ROUND(MAX(holding_days),0) AS max_days FROM predictions " + phase2.closed_filter + " AND hit_target=1");
phase6.time_to_stop = safeGet(predDb, "SELECT COUNT(*) AS n, ROUND(AVG(holding_days),1) AS avg_days, ROUND(MIN(holding_days),0) AS min_days, ROUND(MAX(holding_days),0) AS max_days FROM predictions " + phase2.closed_filter + " AND hit_stop=1");

try {
  const returns = predDb.prepare("SELECT actual_return FROM predictions " + phase2.closed_filter).all().map(r => r.actual_return);
  const n = returns.length;
  const meanRet = n > 0 ? returns.reduce((a,b) => a+b, 0) / n : 0;
  const downside = returns.filter(r => r < 0);
  const downsideDev = downside.length > 0 ? Math.sqrt(downside.reduce((s,r) => s + r*r, 0) / downside.length) : 0;
  const std = n > 1 ? Math.sqrt(returns.reduce((s,r) => s + (r - meanRet)*(r - meanRet), 0) / (n-1)) : 0;
  const minRet = n > 0 ? Math.min(...returns) : 0;
  const maxRet = n > 0 ? Math.max(...returns) : 0;
  const sortino = downsideDev > 0 ? (meanRet / downsideDev) : null;
  const sharpe = std > 0 ? (meanRet / std) : null;
  const calmar = minRet < 0 ? (meanRet / Math.abs(minRet)) : null;
  phase6.risk_adjusted = {
    n_returns: n,
    mean_return_pct: Math.round(meanRet * 100) / 100,
    stdev_returns: Math.round(std * 100) / 100,
    downside_dev: Math.round(downsideDev * 100) / 100,
    sharpe_per_trade: sharpe !== null ? Math.round(sharpe * 1000) / 1000 : null,
    sortino_per_trade: sortino !== null ? Math.round(sortino * 1000) / 1000 : null,
    calmar_per_trade: calmar !== null ? Math.round(calmar * 1000) / 1000 : null,
    worst_return: Math.round(minRet * 100) / 100,
    best_return: Math.round(maxRet * 100) / 100,
  };
} catch (e) { phase6.risk_adjusted = { __error: e.message }; }

try {
  phase6.by_marketcap = safeQuery(stocksDb, "SELECT CASE WHEN s.market_cap IS NULL OR s.market_cap = '' THEN 'unknown' WHEN s.market_cap LIKE '%B%' THEN 'large_cap (B)' WHEN s.market_cap LIKE '%M%' THEN 'mid_cap (M)' WHEN s.market_cap LIKE '%K%' THEN 'small_cap (K)' ELSE 'numeric_only' END AS cap_bucket, COUNT(*) AS total, SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(p.actual_return), 2) AS avg_return FROM predictions p INNER JOIN stocks s ON s.symbol = p.ticker WHERE COALESCE(p.status,'') != 'active' AND p.outcome_date IS NOT NULL AND p.actual_return IS NOT NULL GROUP BY cap_bucket ORDER BY win_rate_pct DESC");
} catch (e) { phase6.by_marketcap = { __error: e.message }; }

out.phases.phase6 = phase6;

// ===== PHASE 7: Anomaly detection =====
const phase7 = {};
phase7.impossible_prices = safeQuery(predDb, "SELECT id, ticker, prediction_date, entry_price, target_price, stop_loss, status FROM predictions WHERE entry_price < 0 OR entry_price > 10000 OR (target_price IS NOT NULL AND (target_price < 0 OR target_price > 10000)) OR (stop_loss IS NOT NULL AND (stop_loss < 0 OR stop_loss > 10000)) LIMIT 50");
phase7.future_dates = safeQuery(predDb, "SELECT id, ticker, prediction_date, status FROM predictions WHERE prediction_date > ?1 LIMIT 50", [TODAY]);
phase7.exit_before_entry = safeQuery(predDb, "SELECT id, ticker, prediction_date, outcome_date, status FROM predictions WHERE outcome_date IS NOT NULL AND prediction_date IS NOT NULL AND outcome_date < prediction_date LIMIT 50");
phase7.huge_returns = safeQuery(predDb, "SELECT id, ticker, prediction_date, entry_price, exit_price, actual_return, status FROM predictions WHERE actual_return > 500 LIMIT 50");
phase7.huge_losses = safeQuery(predDb, "SELECT id, ticker, prediction_date, entry_price, exit_price, actual_return, status FROM predictions WHERE actual_return < -90 LIMIT 50");
phase7.dup_diff_outcome = safeQuery(predDb, "SELECT ticker, prediction_date, COUNT(*) AS c, COUNT(DISTINCT COALESCE(hit_target,0)) AS distinct_target, COUNT(DISTINCT COALESCE(actual_return,-999)) AS distinct_ret FROM predictions GROUP BY ticker, prediction_date HAVING COUNT(*) > 1 AND (distinct_target > 1 OR distinct_ret > 1) ORDER BY c DESC LIMIT 30");

phase7.persona_anomalies = {
  impossible_prices: safeQuery(predDb, "SELECT id, ticker, persona, entry_price, target_price, stop_loss FROM persona_predictions WHERE entry_price < 0 OR entry_price > 10000 OR (target_price IS NOT NULL AND target_price < 0) LIMIT 50"),
  future_dates: safeQuery(predDb, "SELECT id, ticker, persona, prediction_date FROM persona_predictions WHERE prediction_date > ?1 LIMIT 50", [TODAY]),
};

phase7.hist_anomalies = {
  impossible_prices: safeQuery(predDb, "SELECT id, ticker, buy_date, buy_price, sell_price FROM historical_trades WHERE buy_price < 0 OR buy_price > 10000 OR (sell_price IS NOT NULL AND (sell_price < 0 OR sell_price > 10000)) LIMIT 30"),
  huge_pnl: safeQuery(predDb, "SELECT id, ticker, buy_date, sell_date, pnl_pct FROM historical_trades WHERE pnl_pct > 500 OR pnl_pct < -90 LIMIT 30"),
  exit_before_entry: safeQuery(predDb, "SELECT id, ticker, buy_date, sell_date FROM historical_trades WHERE sell_date IS NOT NULL AND buy_date > sell_date LIMIT 30"),
};

out.phases.phase7 = phase7;

try {
  out.extra = {
    egksco_price_history_count: deDb.prepare("SELECT COUNT(*) AS c FROM egksco_price_history").get().c,
    egksco_price_history_latest: deDb.prepare("SELECT MAX(date) AS d FROM egksco_price_history").get().d,
    ph_latest_date: phDb.prepare("SELECT MAX(date) AS d FROM price_history").get().d,
    ph_total: phDb.prepare("SELECT COUNT(*) AS c FROM price_history").get().c,
    ph_distinct_tickers: phDb.prepare("SELECT COUNT(DISTINCT ticker) AS c FROM price_history").get().c,
  };
} catch (e) { out.extra = { __error: e.message }; }

predDb.close();
phDb.close();
stocksDb.close();
deDb.close();

console.log(JSON.stringify(out, null, 2));

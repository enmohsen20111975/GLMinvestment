// Extended queries to expand the report
'use strict';
const Database = require('/home/z/my-project/node_modules/better-sqlite3');
const path = require('path');
const DB_DIR = '/home/z/my-project/db';
function openDb(name) { return new Database(path.join(DB_DIR, name), { readonly: true, fileMustExist: true }); }
const predDb = openDb('predictions.db');
const out = {};
function safeQuery(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch (e) { return { __error: e.message }; }
}
function safeGet(db, sql) {
  try { return db.prepare(sql).get(); } catch (e) { return { __error: e.message }; }
}

const CLOSED = "WHERE COALESCE(status,'') != 'active' AND outcome_date IS NOT NULL AND actual_return IS NOT NULL";

// A. Predictions per ticker (top 30 by volume) with detailed stats
out.top30_tickers_by_volume = safeQuery(predDb,
  "SELECT ticker, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return, ROUND(MIN(actual_return),2) AS min_ret, ROUND(MAX(actual_return),2) AS max_ret, ROUND(AVG(holding_days),0) AS avg_hold, MIN(prediction_date) AS first_pred, MAX(prediction_date) AS last_pred FROM predictions " + CLOSED + " GROUP BY ticker ORDER BY total DESC LIMIT 30");

// B. Predictions by exit_reason
out.by_exit_reason = safeQuery(predDb,
  "SELECT COALESCE(exit_reason,'(null)') AS exit_reason, COUNT(*) AS c, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(actual_return),2) AS avg_return FROM predictions " + CLOSED + " GROUP BY exit_reason ORDER BY c DESC");

// C. Predictions by status (closed only) — finer breakdown
out.closed_by_status = safeQuery(predDb,
  "SELECT status, COUNT(*) AS c, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(actual_return),2) AS avg_return, ROUND(AVG(holding_days),1) AS avg_hold FROM predictions " + CLOSED + " GROUP BY status ORDER BY c DESC");

// D. Historical trades by pattern_type
out.hist_by_pattern = safeQuery(predDb,
  "SELECT COALESCE(pattern_type,'(null)') AS pattern_type, COUNT(*) AS c, ROUND(AVG(pnl_pct),2) AS avg_ret, ROUND(100.0*SUM(CASE WHEN pnl_pct>0 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct FROM historical_trades GROUP BY pattern_type ORDER BY c DESC LIMIT 20");

// E. Historical trades by market_condition
out.hist_by_market = safeQuery(predDb,
  "SELECT COALESCE(market_condition,'(null)') AS market_condition, COUNT(*) AS c, ROUND(AVG(pnl_pct),2) AS avg_ret, ROUND(100.0*SUM(CASE WHEN pnl_pct>0 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct FROM historical_trades GROUP BY market_condition ORDER BY c DESC LIMIT 20");

// F. Monthly persona breakdown
out.monthly_persona = safeQuery(predDb,
  "SELECT substr(prediction_date,1,7) AS month, COALESCE(persona,'(null)') AS persona, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(actual_return),2) AS avg_return FROM predictions " + CLOSED + " GROUP BY month, persona ORDER BY month, persona");

// G. Predictions count by weekday x persona
out.weekday_persona = safeQuery(predDb,
  "SELECT CASE CAST(strftime('%w', prediction_date) AS INTEGER) WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat' END AS dow, COALESCE(persona,'(null)') AS persona, COUNT(*) AS total, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct FROM predictions " + CLOSED + " GROUP BY dow, persona ORDER BY dow, persona");

// H. Exit_notification breakdown by gain_pct bucket
out.exit_by_gain_bucket = safeQuery(predDb,
  "SELECT CASE WHEN gain_pct IS NULL THEN 'null' WHEN gain_pct < -10 THEN 'a_<-10%' WHEN gain_pct < 0 THEN 'b_-10%_0%' WHEN gain_pct < 10 THEN 'c_0%_10%' WHEN gain_pct < 25 THEN 'd_10%_25%' WHEN gain_pct < 50 THEN 'e_25%_50%' ELSE 'f_>=50%' END AS bucket, COUNT(*) AS c FROM exit_notifications GROUP BY bucket ORDER BY bucket");

// I. Exit notifications by day_number (which day after entry does the system send notifications)
out.exit_by_day = safeQuery(predDb,
  "SELECT CASE WHEN day_number IS NULL THEN 'null' WHEN day_number <= 3 THEN '1-3d' WHEN day_number <= 7 THEN '4-7d' WHEN day_number <= 14 THEN '8-14d' WHEN day_number <= 30 THEN '15-30d' WHEN day_number <= 60 THEN '31-60d' ELSE '60d+' END AS day_bucket, COUNT(*) AS c FROM exit_notifications GROUP BY day_bucket ORDER BY day_bucket");

// J. Persona predictions over time (per month)
out.persona_pred_monthly = safeQuery(predDb,
  "SELECT substr(prediction_date,1,7) AS month, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN COALESCE(hit_stop_loss,0)=1 THEN 1 ELSE 0 END) AS stops, ROUND(AVG(profit_loss_percent),2) AS avg_return FROM persona_predictions WHERE COALESCE(status,'') NOT IN ('PENDING','') GROUP BY month ORDER BY month");

// K. Learned lessons by lesson_type breakdown with avg_return
out.learned_by_type = safeQuery(predDb,
  "SELECT lesson_type, COUNT(*) AS n, ROUND(AVG(avg_return),2) AS avg_ret, ROUND(AVG(failure_rate),2) AS avg_failure, SUM(occurrences) AS total_occ FROM learned_lessons GROUP BY lesson_type ORDER BY n DESC");

// L. Top 10 worst learned_lessons (highest failure_rate, min 100 occurrences)
out.worst_lessons = safeQuery(predDb,
  "SELECT lesson_type, condition, outcome, occurrences, ROUND(avg_return,2) AS avg_ret, ROUND(failure_rate,2) AS failure_rate FROM learned_lessons WHERE occurrences >= 100 ORDER BY failure_rate DESC LIMIT 10");

// M. Top 10 best learned_lessons (lowest failure_rate, min 100 occurrences)
out.best_lessons = safeQuery(predDb,
  "SELECT lesson_type, condition, outcome, occurrences, ROUND(avg_return,2) AS avg_ret, ROUND(failure_rate,2) AS failure_rate FROM learned_lessons WHERE occurrences >= 100 ORDER BY failure_rate ASC LIMIT 10");

// N. Predictions with very long holding days (>200)
out.long_hold_predictions = safeQuery(predDb,
  "SELECT id, ticker, persona, prediction_date, outcome_date, holding_days, actual_return, hit_target, hit_stop, exit_reason FROM predictions " + CLOSED + " AND holding_days > 200 ORDER BY holding_days DESC LIMIT 20");

// O. All distinct persona values across both tables
out.persona_summary = {
  predictions_table: safeQuery(predDb, "SELECT persona, COUNT(*) AS c FROM predictions GROUP BY persona ORDER BY c DESC"),
  persona_predictions_table: safeQuery(predDb, "SELECT persona, COUNT(*) AS c FROM persona_predictions GROUP BY persona ORDER BY c DESC"),
};

// P. Status of duplicate ticker rows (broader scan: same ticker+date+persona)
out.dup_scan_broad = safeQuery(predDb,
  "SELECT ticker, prediction_date, persona, COUNT(*) AS c, GROUP_CONCAT(status) AS statuses, GROUP_CONCAT(COALESCE(actual_return,'NULL')) AS returns FROM predictions GROUP BY ticker, prediction_date, persona HAVING COUNT(*) > 1 ORDER BY c DESC LIMIT 30");

// Q. Real_evaluated_predictions stats (from stocks.db)
const stocksDb = openDb('stocks.db');
out.real_evaluated_predictions = safeQuery(stocksDb,
  "SELECT COUNT(*) AS c, ROUND(AVG(return_pct),2) AS avg_ret, ROUND(100.0*SUM(CASE WHEN hit_target=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(holding_days),1) AS avg_hold FROM real_evaluated_predictions");
out.real_eval_by_ticker = safeQuery(stocksDb,
  "SELECT ticker, COUNT(*) AS c, ROUND(100.0*SUM(CASE WHEN hit_target=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(return_pct),2) AS avg_ret FROM real_evaluated_predictions GROUP BY ticker ORDER BY c DESC LIMIT 20");
// R. Radar signal tracking stats
out.radar_signal_tracking = safeQuery(stocksDb,
  "SELECT signal_type, COUNT(*) AS c, ROUND(100.0*SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END)/COUNT(*),1) AS verified_pct, ROUND(AVG(outcome_7d),2) AS avg_7d, ROUND(AVG(outcome_14d),2) AS avg_14d, ROUND(AVG(outcome_30d),2) AS avg_30d FROM radar_signal_tracking GROUP BY signal_type ORDER BY c DESC");
// S. market_regime_log detail
out.regime_log = safeQuery(stocksDb, "SELECT date, regime, egx30_close, egx30_change_pct, volume_ratio, adx, rsi FROM market_regime_log ORDER BY date ASC");
// T. analytics_events top events
out.analytics_top = safeQuery(stocksDb, "SELECT type, view, COUNT(*) AS c FROM analytics_events GROUP BY type, view ORDER BY c DESC LIMIT 15");
stocksDb.close();

// U. Daily close ratio (closed vs active per day)
out.daily_closed = safeQuery(predDb,
  "SELECT substr(prediction_date,1,10) AS day, COUNT(*) AS total, SUM(CASE WHEN COALESCE(status,'') != 'active' AND outcome_date IS NOT NULL THEN 1 ELSE 0 END) AS closed, SUM(CASE WHEN COALESCE(status,'') IN ('active','ACTIVE') THEN 1 ELSE 0 END) AS active FROM predictions GROUP BY day ORDER BY day DESC LIMIT 30");

predDb.close();
console.log(JSON.stringify(out, null, 2));

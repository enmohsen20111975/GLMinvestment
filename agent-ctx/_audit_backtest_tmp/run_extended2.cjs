// Extended batch 2 - more queries
'use strict';
const Database = require('/home/z/my-project/node_modules/better-sqlite3');
const path = require('path');
const DB_DIR = '/home/z/my-project/db';
function openDb(name) { return new Database(path.join(DB_DIR, name), { readonly: true, fileMustExist: true }); }
const predDb = openDb('predictions.db');
const stocksDb = openDb('stocks.db');
const out = {};
function safeQuery(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch (e) { return { __error: e.message }; }
}
const CLOSED = "WHERE COALESCE(status,'') != 'active' AND outcome_date IS NOT NULL AND actual_return IS NOT NULL";

// V. Predictions by quarter
out.by_quarter = safeQuery(predDb,
  "SELECT substr(prediction_date,1,4)||'-'||CASE WHEN CAST(substr(prediction_date,6,2) AS INTEGER) <= 3 THEN 'Q1' WHEN CAST(substr(prediction_date,6,2) AS INTEGER) <= 6 THEN 'Q2' WHEN CAST(substr(prediction_date,6,2) AS INTEGER) <= 9 THEN 'Q3' ELSE 'Q4' END AS quarter, COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(actual_return),2) AS avg_return, ROUND(AVG(holding_days),1) AS avg_hold FROM predictions " + CLOSED + " GROUP BY quarter ORDER BY quarter");

// W. Top 20 tickers by avg_return (min 5 preds)
out.top20_avg_return = safeQuery(predDb,
  "SELECT ticker, COUNT(*) AS total, ROUND(AVG(actual_return),2) AS avg_return, ROUND(MAX(actual_return),2) AS best_return, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct FROM predictions " + CLOSED + " GROUP BY ticker HAVING COUNT(*) >= 5 ORDER BY avg_return DESC LIMIT 20");

// X. Bottom 20 tickers by avg_return
out.bottom20_avg_return = safeQuery(predDb,
  "SELECT ticker, COUNT(*) AS total, ROUND(AVG(actual_return),2) AS avg_return, ROUND(MIN(actual_return),2) AS worst_return, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct FROM predictions " + CLOSED + " GROUP BY ticker HAVING COUNT(*) >= 5 ORDER BY avg_return ASC LIMIT 20");

// Y. Risk/Reward distribution
out.risk_reward_dist = safeQuery(predDb,
  "SELECT CASE WHEN risk_reward IS NULL THEN 'null' WHEN risk_reward < 1 THEN 'a_<1.0' WHEN risk_reward < 2 THEN 'b_1.0-2.0' WHEN risk_reward < 3 THEN 'c_2.0-3.0' WHEN risk_reward < 5 THEN 'd_3.0-5.0' ELSE 'e_>=5.0' END AS bucket, COUNT(*) AS c, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(actual_return),2) AS avg_return FROM predictions " + CLOSED + " GROUP BY bucket ORDER BY bucket");

// Z. Score distribution
out.score_dist = safeQuery(predDb,
  "SELECT CASE WHEN maestro_score IS NULL THEN 'null' WHEN maestro_score < 50 THEN 'a_<50' WHEN maestro_score < 60 THEN 'b_50-60' WHEN maestro_score < 70 THEN 'c_60-70' WHEN maestro_score < 80 THEN 'd_70-80' WHEN maestro_score < 90 THEN 'e_80-90' ELSE 'f_>=90' END AS bucket, COUNT(*) AS c, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(actual_return),2) AS avg_return FROM predictions " + CLOSED + " GROUP BY bucket ORDER BY bucket");

// AA. Confidence distribution
out.confidence_dist = safeQuery(predDb,
  "SELECT CASE WHEN confidence IS NULL THEN 'null' WHEN confidence < 50 THEN 'a_<50' WHEN confidence < 60 THEN 'b_50-60' WHEN confidence < 70 THEN 'c_60-70' WHEN confidence < 80 THEN 'd_70-80' WHEN confidence < 90 THEN 'e_80-90' ELSE 'f_>=90' END AS bucket, COUNT(*) AS c, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(actual_return),2) AS avg_return FROM predictions " + CLOSED + " GROUP BY bucket ORDER BY bucket");

// BB. Predictions with NULL exit_price but hit_target=1
out.suspicious_null_exit = safeQuery(predDb,
  "SELECT id, ticker, persona, prediction_date, entry_price, target_price, actual_return, holding_days FROM predictions " + CLOSED + " AND hit_target=1 AND exit_price IS NULL LIMIT 20");

// CC. Predictions where exit_price != entry_price * (1 + actual_return/100) by >5%
out.mismatched_exit_price = safeQuery(predDb,
  "SELECT id, ticker, entry_price, exit_price, actual_return, ROUND((exit_price - entry_price) / entry_price * 100, 2) AS computed_return, ROUND(actual_return - (exit_price - entry_price) / entry_price * 100, 2) AS diff FROM predictions " + CLOSED + " AND exit_price IS NOT NULL AND entry_price > 0 AND ABS(actual_return - (exit_price - entry_price) / entry_price * 100) > 5 ORDER BY diff DESC LIMIT 20");

// DD. Monthly performance for historical_trades
out.hist_monthly = safeQuery(predDb,
  "SELECT substr(buy_date,1,7) AS month, COUNT(*) AS total, ROUND(100.0*SUM(CASE WHEN pnl_pct>0 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(pnl_pct),2) AS avg_return FROM historical_trades WHERE sell_date IS NOT NULL GROUP BY month ORDER BY month");

// EE. Stocks table: top 20 by market_cap (large caps)
out.top20_marketcap = safeQuery(stocksDb, "SELECT ticker, name, sector, market_cap, current_price FROM stocks WHERE market_cap IS NOT NULL ORDER BY market_cap DESC LIMIT 20");

// FF. Stocks table: distribution by sector (full)
out.stocks_by_sector = safeQuery(stocksDb, "SELECT sector, COUNT(*) AS c FROM stocks WHERE sector IS NOT NULL GROUP BY sector ORDER BY c DESC");

// GG. Cached_analysis stats
out.cached_analysis = safeQuery(stocksDb, "SELECT signal, COUNT(*) AS c, ROUND(AVG(composite_score),2) AS avg_score FROM cached_analysis GROUP BY signal ORDER BY c DESC");

// HH. Daily closer tracking — average actual_return by year
out.by_year = safeQuery(predDb, "SELECT substr(prediction_date,1,4) AS year, COUNT(*) AS total, ROUND(100.0*SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END)/COUNT(*),1) AS win_rate_pct, ROUND(AVG(actual_return),2) AS avg_return FROM predictions " + CLOSED + " GROUP BY year ORDER BY year");

predDb.close();
stocksDb.close();
console.log(JSON.stringify(out, null, 2));

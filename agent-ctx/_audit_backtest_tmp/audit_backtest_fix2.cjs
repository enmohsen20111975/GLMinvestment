// AUDIT-BACKTEST fix2: replaces ?1 with ?, uses ATTACH for cross-db queries.
'use strict';
const Database = require('/home/z/my-project/node_modules/better-sqlite3');
const path = require('path');

const DB_DIR = '/home/z/my-project/db';
function openDb(name) { return new Database(path.join(DB_DIR, name), { readonly: true, fileMustExist: true }); }

const predDb = openDb('predictions.db');
const phDb = openDb('price_history.db');
const stocksDb = openDb('stocks.db');
const deDb = openDb('data_engine.db');

const TODAY = '2026-09-27';
const out = { phases: {} };

function safeQuery(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch (e) { return { __error: e.message }; }
}
function safeGet(db, sql, params = []) {
  try { return db.prepare(sql).get(...params); } catch (e) { return { __error: e.message }; }
}

// ===== Phase 4 loss_streaks fix (use ? instead of ?1) =====
const phase4_loss_streaks = [];
const phase4Personas = ['balanced'];
for (const persona of phase4Personas) {
  try {
    const rows = predDb.prepare("SELECT prediction_date, profit_loss_percent FROM persona_predictions WHERE COALESCE(persona,'(null)') = ? AND COALESCE(status,'') NOT IN ('PENDING','') AND profit_loss_percent IS NOT NULL ORDER BY prediction_date ASC, id ASC").all(persona);
    let maxStreak = 0, curStreak = 0;
    for (const r of rows) {
      if ((r.profit_loss_percent ?? 0) < 0) { curStreak++; if (curStreak > maxStreak) maxStreak = curStreak; } else curStreak = 0;
    }
    phase4_loss_streaks.push({ persona, max_loss_streak: maxStreak, total_rows: rows.length });
  } catch (e) {
    phase4_loss_streaks.push({ persona, error: e.message });
  }
}
out.phase4_loss_streaks = phase4_loss_streaks;

// ===== Phase 5 recent_30d / prev_30d fix =====
const cutoff_recent = '2026-08-28';
const cutoff_prev = '2026-07-29';
out.phase5_recent_30d = safeGet(predDb,
  "SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions WHERE COALESCE(status,'') != 'active' AND outcome_date IS NOT NULL AND actual_return IS NOT NULL AND prediction_date >= ?",
  [cutoff_recent]);
out.phase5_prev_30d = safeGet(predDb,
  "SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(actual_return), 2) AS avg_return FROM predictions WHERE COALESCE(status,'') != 'active' AND outcome_date IS NOT NULL AND actual_return IS NOT NULL AND prediction_date >= ? AND prediction_date < ?",
  [cutoff_prev, cutoff_recent]);

// ===== Phase 7 anomalies fix (use ?) =====
out.phase7_future_dates = safeQuery(predDb,
  "SELECT id, ticker, prediction_date, status FROM predictions WHERE prediction_date > ? LIMIT 50",
  [TODAY]);
out.phase7_persona_future_dates = safeQuery(predDb,
  "SELECT id, ticker, persona, prediction_date FROM persona_predictions WHERE prediction_date > ? LIMIT 50",
  [TODAY]);

// ===== Phase 6 by_sector / by_marketcap fix — use ATTACH on stocksDb =====
// ATTACH predictions.db to stocksDb (read-only)
try {
  stocksDb.exec("ATTACH DATABASE '/home/z/my-project/db/predictions.db' AS pred");
  out.phase6_by_sector = safeQuery(stocksDb,
    "SELECT s.sector, COUNT(*) AS total, SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(p.actual_return), 2) AS avg_return FROM pred.predictions p INNER JOIN stocks s ON s.symbol = p.ticker WHERE s.sector IS NOT NULL AND s.sector != '' AND COALESCE(p.status,'') != 'active' AND p.outcome_date IS NOT NULL AND p.actual_return IS NOT NULL GROUP BY s.sector ORDER BY win_rate_pct DESC");
  out.phase6_by_marketcap = safeQuery(stocksDb,
    "SELECT CASE WHEN s.market_cap IS NULL OR s.market_cap = '' THEN 'unknown' WHEN s.market_cap LIKE '%B%' THEN 'large_cap (B)' WHEN s.market_cap LIKE '%M%' THEN 'mid_cap (M)' WHEN s.market_cap LIKE '%K%' THEN 'small_cap (K)' ELSE 'numeric_only' END AS cap_bucket, COUNT(*) AS total, SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(p.actual_return), 2) AS avg_return FROM pred.predictions p INNER JOIN stocks s ON s.symbol = p.ticker WHERE COALESCE(p.status,'') != 'active' AND p.outcome_date IS NOT NULL AND p.actual_return IS NOT NULL GROUP BY cap_bucket ORDER BY win_rate_pct DESC");
  // Also: tickers not in stocks table (unmatched)
  out.phase6_unmatched_tickers = safeQuery(stocksDb,
    "SELECT DISTINCT p.ticker FROM pred.predictions p LEFT JOIN stocks s ON s.symbol = p.ticker WHERE s.symbol IS NULL LIMIT 50");
  stocksDb.exec("DETACH DATABASE pred");
} catch (e) {
  out.phase6_attach_error = e.message;
}

// ===== egksco_price_history schema check =====
try {
  const cols = deDb.prepare("PRAGMA table_info(egksco_price_history)").all();
  out.egksco_cols = cols.map(c => c.name);
  const cnt = deDb.prepare("SELECT COUNT(*) AS c FROM egksco_price_history").get().c;
  out.egksco_count = cnt;
  // try common date columns
  for (const dcol of ['date','trade_date','price_date','d']) {
    if (cols.some(c => c.name === dcol)) {
      try {
        const latest = deDb.prepare(`SELECT MAX(${dcol}) AS d FROM egksco_price_history`).get().d;
        out.egksco_latest = latest;
        out.egksco_date_col = dcol;
        break;
      } catch (e) { out.egksco_err_for = dcol + ': ' + e.message; }
    }
  }
} catch (e) { out.egksco_error = e.message; }

// ===== Phase 3 detail rows — already in main script =====

predDb.close(); phDb.close(); stocksDb.close(); deDb.close();
console.log(JSON.stringify(out, null, 2));

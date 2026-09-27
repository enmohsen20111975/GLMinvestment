// AUDIT-BACKTEST fix3: stocks table has ticker not symbol; ATTACH cross-db.
'use strict';
const Database = require('/home/z/my-project/node_modules/better-sqlite3');
const path = require('path');

const DB_DIR = '/home/z/my-project/db';
function openDb(name) { return new Database(path.join(DB_DIR, name), { readonly: true, fileMustExist: true }); }

const stocksDb = openDb('stocks.db');
const out = {};

function safeQuery(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch (e) { return { __error: e.message }; }
}

try {
  stocksDb.exec("ATTACH DATABASE '/home/z/my-project/db/predictions.db' AS pred");
  out.by_sector = safeQuery(stocksDb,
    "SELECT s.sector, COUNT(*) AS total, SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(p.actual_return), 2) AS avg_return FROM pred.predictions p INNER JOIN stocks s ON s.ticker = p.ticker WHERE s.sector IS NOT NULL AND s.sector != '' AND COALESCE(p.status,'') != 'active' AND p.outcome_date IS NOT NULL AND p.actual_return IS NOT NULL GROUP BY s.sector ORDER BY win_rate_pct DESC");
  out.by_marketcap = safeQuery(stocksDb,
    "SELECT CASE WHEN s.market_cap IS NULL OR s.market_cap = '' THEN 'unknown' WHEN s.market_cap > 50000000000 THEN 'large_cap (>50B EGP)' WHEN s.market_cap > 10000000000 THEN 'mid_cap (10-50B)' WHEN s.market_cap > 1000000000 THEN 'small_cap (1-10B)' ELSE 'micro_cap (<1B)' END AS cap_bucket, COUNT(*) AS total, SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) AS wins, ROUND(100.0 * SUM(CASE WHEN COALESCE(p.hit_target,0)=1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct, ROUND(AVG(p.actual_return), 2) AS avg_return FROM pred.predictions p INNER JOIN stocks s ON s.ticker = p.ticker WHERE COALESCE(p.status,'') != 'active' AND p.outcome_date IS NOT NULL AND p.actual_return IS NOT NULL GROUP BY cap_bucket ORDER BY win_rate_pct DESC");
  out.unmatched_tickers = safeQuery(stocksDb,
    "SELECT DISTINCT p.ticker FROM pred.predictions p LEFT JOIN stocks s ON s.ticker = p.ticker WHERE s.ticker IS NULL LIMIT 50");
  out.stocks_count = stocksDb.prepare("SELECT COUNT(*) AS c FROM stocks").get().c;
  out.sectors_count = stocksDb.prepare("SELECT COUNT(DISTINCT sector) AS c FROM stocks WHERE sector IS NOT NULL").get().c;
  stocksDb.exec("DETACH DATABASE pred");
} catch (e) { out.attach_error = e.message; }

stocksDb.close();
console.log(JSON.stringify(out, null, 2));

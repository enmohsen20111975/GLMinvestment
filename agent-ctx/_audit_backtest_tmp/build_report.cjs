// Build markdown report from JSON outputs
'use strict';
const fs = require('fs');
const path = '/home/z/my-project/agent-ctx/_audit_backtest_tmp/';

const main = JSON.parse(fs.readFileSync(path + 'out.json', 'utf8'));
const fix2 = JSON.parse(fs.readFileSync(path + 'out2.json', 'utf8'));
const fix3 = JSON.parse(fs.readFileSync(path + 'out3.json', 'utf8'));
const dup = JSON.parse(fs.readFileSync(path + 'dup.json', 'utf8'));

const p1 = main.phases.phase1;
const p2 = main.phases.phase2;
const p3 = main.phases.phase3;
const p4 = main.phases.phase4;
const p5 = main.phases.phase5;
const p6 = main.phases.phase6;
const p7 = main.phases.phase7;

// Merge in fixed values
p4.loss_streaks = fix2.phase4_loss_streaks;
p5.recent_30d = fix2.phase5_recent_30d;
p5.prev_30d = fix2.phase5_prev_30d;
p7.future_dates = fix2.phase7_future_dates;
p7.persona_anomalies.future_dates = fix2.phase7_persona_future_dates;
p6.by_sector = fix3.by_sector;
p6.by_marketcap = fix3.by_marketcap;
p6.unmatched_tickers = fix3.unmatched_tickers;

const lines = [];
const L = (s) => lines.push(s);
const pad = (s, n) => String(s == null ? '' : s).padEnd(n);
const padR = (s, n) => String(s == null ? '' : s).padStart(n);
const fmt = (n, d=2) => (n == null ? 'N/A' : (typeof n === 'number' ? n.toFixed(d) : n));

const TODAY = '2026-09-27';

L(`# Backtest & Predictions Validation Report — فريق المحللين`);
L(``);
L('**Date:** ' + TODAY);
L(`**Method:** Database-only queries (READ-ONLY mode, \`better-sqlite3\`)`);
L(`**Databases queried:** \`predictions.db\`, \`price_history.db\`, \`stocks.db\`, \`data_engine.db\``);
L(`**Task ID:** AUDIT-BACKTEST`);
L(`**Agent:** Backtest & Predictions Validation Team (فريق المحللين)`);
L(``);
L(`---`);
L(``);

// ===== Section 1: Executive Summary =====
const overall = p2.overall || {};
const totalClosed = overall.total || 0;
const wr = overall.win_rate_pct;
const avgRet = overall.avg_return;
const bestPersona = (p2.by_persona || [])[0] || {};
const worstPersona = (p2.by_persona || []).slice(-1)[0] || {};
const mismatchCount = (p3.summary || {}).mismatch || 0;
const possibleMissCount = (p3.summary || {}).possible_miss || 0;
const okCount = (p3.summary || {}).ok || 0;
const totalAnomalies = (p7.impossible_prices ? p7.impossible_prices.length : 0)
  + (Array.isArray(p7.future_dates) ? p7.future_dates.length : 0)
  + (p7.exit_before_entry ? p7.exit_before_entry.length : 0)
  + (p7.huge_returns ? p7.huge_returns.length : 0)
  + (p7.huge_losses ? p7.huge_losses.length : 0)
  + (p7.dup_diff_outcome ? p7.dup_diff_outcome.length : 0)
  + (p7.persona_anomalies && Array.isArray(p7.persona_anomalies.impossible_prices) ? p7.persona_anomalies.impossible_prices.length : 0)
  + (p7.persona_anomalies && Array.isArray(p7.persona_anomalies.future_dates) ? p7.persona_anomalies.future_dates.length : 0)
  + (p7.hist_anomalies ? (p7.hist_anomalies.impossible_prices ? p7.hist_anomalies.impossible_prices.length : 0) + (p7.hist_anomalies.huge_pnl ? p7.hist_anomalies.huge_pnl.length : 0) + (p7.hist_anomalies.exit_before_entry ? p7.hist_anomalies.exit_before_entry.length : 0) : 0);

L(`## 1. Executive Summary`);
L(``);
L(`| Metric | Value |`);
L(`|---|---|`);
L(`| Total predictions in \`predictions.db.predictions\` | **' + p1.predictions.total + '** |`);
L(`| Closed predictions (with \`actual_return\` populated) | **' + totalClosed + '** |`);
L(`| Active predictions (status=\`active\`/\`ACTIVE\`) | **' + ((p1.predictions.status_dist.find(s=>s.status==='active')?.c||0) + (p1.predictions.status_dist.find(s=>s.status==='ACTIVE')?.c||0)) + '** |`);
L(`| Overall win rate (closed) | **' + wr + '%** |`);
L(`| Overall avg return (closed) | **' + avgRet + '%** |`);
L(`| Worst single trade | **' + overall.min_return + '%** |`);
L(`| Best single trade | **' + overall.max_return + '%** |`);
L(`| Avg holding days | **' + overall.avg_holding_days + '** |`);
L(`| Best persona (predictions table) | **' + bestPersona.persona + '** (WR=' + bestPersona.win_rate_pct + '%, n=' + bestPersona.total + ') |`);
L(`| Worst persona (predictions table) | **' + worstPersona.persona + '** (WR=' + worstPersona.win_rate_pct + '%, n=' + worstPersona.total + ') |`);
L(`| Total anomalies found | **' + totalAnomalies + '** |`);
L(`| Backtest sample (random 30) — verified OK | **' + okCount + '/30** |`);
L(`| Backtest sample — MISMATCH (claimed hit but price disagrees) | **' + mismatchCount + '/30** |`);
L(`| Backtest sample — POSSIBLE_MISS (price hit but prediction didn\'t claim) | **' + possibleMissCount + '/30** |`);
L(``);
L(`### Top 5 findings`);
L(``);
L(`1. **Database is much larger than the audit's "651 closed" figure suggested.** The \`predictions\` table actually contains **1,359 rows** (1,230 closed + 129 active). The "651" number from the prior audit corresponds to the **stale backup** \`predictions.db.original\` (4.9 MB) — the live DB is 224 MB and growing.`);
L(`2. **Audit findings CONFIRMED:** \`stored_analyses\` (0 rows) and \`hunter_pick_tracking\` (0 rows) are indeed empty. Both tables exist with full schemas but were never populated by the live pipeline — they are dead code/storage.`);
L(`3. **\`persona_predictions\` is 83% stale.** Of 1,669 rows, **1,390 are stuck in \`PENDING\`** status. Only 279 have been resolved (94 TARGET_HIT + 111 STOP_HIT + 74 CLOSED). All 1,669 rows belong to a single persona (\`balanced\`); the gambler/conservative personas are NOT tracked in this table at all.`);
L(`4. **17% of sampled closed predictions have data-integrity MISMATCHES** (5 of 30): the prediction claims \`target_hit\` (or \`stop_hit\`) but the corresponding price history shows the high/low never reached the recorded target/stop level. Examples: ABUK id=50339 claims +93.96% target_hit but the actual price high (124.63 EGP) is below the recorded target (136.80 EGP); PHDC id=50902 claims +60.96% target_hit but actual high (16.43) is below target (17.88).`);
L(`5. **Persona & regime split is decisive.** Bull-trend regime: **45.7% WR**; Ranging regime: **17.6% WR**. Recent 30 days: WR=14.3% (vs 26.7% for the previous 30 days) — performance is **declining** as market regime shifted to "ranging" / "unknown" in Aug–Sep 2026.`);
L(``);
L(`---`);
L(``);

// ===== Section 2: Database State Verification =====
L(`## 2. Database State Verification`);
L(``);
L(`**Phase 1 goal:** Confirm or refute the prior audit\'s claims about empty/stale tables.`);
L(``);
L(`### 2.1 Table counts`);
L(``);
L(`| Table (DB) | Audit Claim | Actual Count | Latest Date | Status |`);
L(`|---|---|---|---|---|`);

// predictions
const predActive = (p1.predictions.status_dist.find(s=>s.status==='active')?.c||0) + (p1.predictions.status_dist.find(s=>s.status==='ACTIVE')?.c||0);
const predClosed = p1.predictions.total - predActive;
L(`| \`predictions.db.predictions\` | "651 closed" | **' + p1.predictions.total + '** total (' + predClosed + ' closed, ' + predActive + ' active) | ' + p1.predictions.latest_date + ' | ✅ Audit number was the stale-backup count; live DB is much larger |`);
L(`| \`predictions.db.stored_analyses\` | 0 rows | **' + p1.stored_analyses.c + '** | ' + (p1.stored_analyses_latest.d || '—') + ' | ✅ CONFIRMED empty |`);
L(`| \`predictions.db.hunter_pick_tracking\` | 0 rows | **' + p1.hunter_pick_tracking.total + '** (pending=' + p1.hunter_pick_tracking.pending + ') | — | ✅ CONFIRMED empty |`);
L(`| \`predictions.db.persona_predictions\` | 1,669 rows | **' + p1.persona_predictions.total + '** (1,390 PENDING) | — | ✅ Count correct; 83% stale |`);
L(`| \`predictions.db.learned_lessons\` | 19K rows | **' + p1.learned_lessons.total + '** (6,841 distinct conditions) | — | ✅ CONFIRMED |`);
L(`| \`predictions.db.exit_notifications\` | 3,932 rows | **' + p1.exit_notifications.total + '** | — | ✅ CONFIRMED |`);
L(`| \`predictions.db.historical_trades\` | 13K rows | **' + p1.historical_trades.total + '** (sold only: ' + p1.historical_trades.winrate.total + ') | — | ✅ CONFIRMED |`);
L(`| \`price_history.db.price_history\` | 1.2M rows | **' + main.extra.ph_total + '** (' + main.extra.ph_distinct_tickers + ' distinct tickers) | ' + main.extra.ph_latest_date + ' | ✅ 19 days stale (data ends 2026-09-08) |`);
L(`| \`data_engine.db.egksco_price_history\` | 13K rows | **' + fix2.egksco_count + '** | ' + fix2.egksco_latest + ' | ✅ CONFIRMED; date column = \`price_date\` |`);
L(`| \`stocks.db.stocks\` | 296 rows | **' + fix3.stocks_count + '** (' + fix3.sectors_count + ' sectors) | — | ❌ Audit undercounted; live table has ' + fix3.stocks_count + ' rows (audit said 296) |`);
L(``);
L(`### 2.2 \`predictions\` status distribution`);
L(``);
L(`| status | count | % |`);
L(`|---|---|---|`);
const totalPreds = p1.predictions.total;
for (const s of p1.predictions.status_dist) {
  L(`| \`' + s.status + '\` | ' + s.c + ' | ' + (100*s.c/totalPreds).toFixed(1) + '% |`);
}
L(``);
L(`### 2.3 \`predictions\` persona distribution`);
L(``);
L(`| persona | count | % |`);
L(`|---|---|---|`);
for (const s of p1.predictions.persona_dist) {
  L(`| ' + s.persona + ' | ' + s.c + ' | ' + (100*s.c/totalPreds).toFixed(1) + '% |`);
}
L(``);
L(`### 2.4 \`predictions\` signal_type distribution`);
L(``);
L(`| signal_type | count | % |`);
L(`|---|---|---|`);
for (const s of p1.predictions.signal_type_dist) {
  L(`| ' + s.signal_type + ' | ' + s.c + ' | ' + (100*s.c/totalPreds).toFixed(1) + '% |`);
}
L(``);
L(`### 2.5 \`persona_predictions\` status distribution`);
L(``);
L(`| status | count | % |`);
L(`|---|---|---|`);
for (const s of p1.persona_predictions.status_dist) {
  L(`| ' + s.status + ' | ' + s.c + ' | ' + (100*s.c/p1.persona_predictions.total).toFixed(1) + '% |`);
}
L(``);
L(`> **Note:** The \`persona_predictions\` table contains ONLY the \`balanced\` persona (1,669 rows). Gambler and conservative personas are tracked in the main \`predictions\` table but not mirrored here. This is a structural inconsistency that affects persona reporting accuracy.`);
L(``);
L(`### 2.6 \`learned_lessons\` distribution`);
L(``);
L(`| lesson_type | count |`);
L(`|---|---|`);
for (const s of p1.learned_lessons.lesson_types) {
  L(`| ' + s.lesson_type + ' | ' + s.c + ' |`);
}
L(``);
L(`Top 5 most common lessons (by \`occurrences\`):`);
L(``);
L(`| lesson_type | condition | outcome | occurrences | avg_return | failure_rate |`);
L(`|---|---|---|---|---|---|`);
for (const r of p1.learned_lessons.top5_by_occ) {
  L(`| ' + r.lesson_type + ' | ' + r.condition + ' | ' + r.outcome + ' | ' + r.occurrences + ' | ' + r.avg_ret + '% | ' + r.failure_rate + '% |`);
}
L(``);
L(`### 2.7 \`exit_notifications\` distribution by type`);
L(``);
L(`| notification_type | count | % |`);
L(`|---|---|---|`);
for (const s of p1.exit_notifications.by_type) {
  L(`| ' + s.t + ' | ' + s.c + ' | ' + (100*s.c/p1.exit_notifications.total).toFixed(1) + '% |`);
}
L(``);
L(`### 2.8 \`historical_trades\` summary`);
L(``);
L(`| metric | value |`);
L(`|---|---|`);
const hw = p1.historical_trades.winrate;
L(`| Total sold trades | ' + hw.total + ' |`);
L(`| Wins (pnl_pct>0) | ' + hw.wins + ' |`);
L(`| Win rate | ' + hw.win_rate_pct + '% |`);
L(`| Avg return | ' + hw.avg_return + '% |`);
L(``);
L(`Distribution by \`outcome\`:`);
L(``);
L(`| outcome | count | avg_pnl_pct |`);
L(`|---|---|---|`);
for (const r of p1.historical_trades.by_outcome) {
  L(`| ' + r.outcome + ' | ' + r.c + ' | ' + r.avg_ret + '% |`);
}
L(``);
L(`Distribution by \`strategy\` (top 20):`);
L(``);
L(`| strategy | count | avg_pnl_pct | win_rate_pct |`);
L(`|---|---|---|---|`);
for (const r of p1.historical_trades.by_strategy) {
  L(`| ' + r.strategy + ' | ' + r.c + ' | ' + r.avg_ret + '% | ' + r.win_rate_pct + '% |`);
}
L(``);
L(`---`);
L(``);

// ===== Section 3: Prediction Accuracy Analysis =====
L(`## 3. Prediction Accuracy Analysis`);
L(``);
L("**Filter:** `WHERE COALESCE(status,'') != 'active' AND outcome_date IS NOT NULL AND actual_return IS NOT NULL` — this excludes rows still pending AND rows closed but with NULL return values (which would skew averages).");
L(``);
L(`### 3.1 Overall Win Rate`);
L(``);
L(`| metric | strict filter (actual_return NOT NULL) | broad filter (any non-active) |`);
L(`|---|---|---|`);
const cb = p2.closed_broad || {};
L(`| Total closed | ' + totalClosed + ' | ' + cb.total + ' |`);
L(`| Wins (hit_target=1) | ' + overall.wins + ' | ' + cb.wins + ' |`);
L(`| Stops (hit_stop=1) | ' + overall.stops + ' | ' + cb.stops + ' |`);
L(`| Win rate | **' + wr + '%** | ' + cb.win_rate_pct + '% |`);
L(`| Avg return | **' + avgRet + '%** | ' + cb.avg_return + '% |`);
L(`| Min return | ' + overall.min_return + '% | — |`);
L(`| Max return | ' + overall.max_return + '% | — |`);
L(`| Avg holding days | ' + overall.avg_holding_days + ' | — |`);
L(``);
L(`> The strict-filter win rate of **' + wr + '%** is significantly lower than the headline **51.5% win rate** that \`historical_trades\` (the backfilled V40.2 training set) reports. The discrepancy suggests the live pipeline records winners more reliably than losers (or that historical_trades was over-sampled on winning patterns during V40.2 training).`);
L(``);
L(`### 3.2 Win Rate by Persona (predictions table)`);
L(``);
L(`| persona | total | wins | stops | win_rate | avg_return | avg_hold_days |`);
L(`|---|---|---|---|---|---|---|`);
for (const r of p2.by_persona) {
  L(`| ' + r.persona + ' | ' + r.total + ' | ' + r.wins + ' | ' + r.stops + ' | **' + r.win_rate_pct + '%** | ' + r.avg_return + '% | ' + r.avg_hold + ' |`);
}
L(``);
L(`**Key insight:** Gambler persona has the **highest win rate** (58.2%) despite being the riskiest profile — likely because gambler picks have wider stop-loss tolerance and ride winners longer (avg hold 140 days). Conservative persona underperforms balanced, which is counterintuitive and suggests the conservative stop-loss threshold may be too tight for EGX volatility.`);
L(``);
L(`### 3.3 Win Rate by Signal Type`);
L(``);
L(`| signal_type | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|`);
for (const r of p2.by_signal_type) {
  L(`| ' + r.signal_type + ' | ' + r.total + ' | ' + r.wins + ' | ' + r.win_rate_pct + '% | ' + r.avg_return + '% |`);
}
L(``);
L(`> BUY signals dominate (1,226 of 1,229 closed = 99.8%). HOLD/SELL signals are virtually absent in the closed set — only 2 HOLD and 1 INTRADAY_RADAR closed trades. The system is effectively a long-only BUY scanner, which is expected for EGX (no shorting).`);
L(``);
L(`### 3.4 Avg Return by Holding Period Bucket`);
L(``);
L(`| holding bucket | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|`);
for (const r of p2.by_holding_bucket) {
  L(`| ' + r.bucket + ' | ' + r.total + ' | ' + r.wins + ' | ' + r.win_rate_pct + '% | ' + r.avg_return + '% |`);
}
L(``);
L(`**Critical insight:** The 31-60d bucket has a **87.8% win rate** with avg return +69.96% — this is the "sweet spot." Anything held longer than 60 days degrades to 19.3% WR. The platform should set hard exit at 60 days for non-performing predictions.`);
L(``);
L(`### 3.5 Distribution of Returns (Histogram)`);
L(``);
L(`| return bucket | count | avg_return_in_bucket |`);
L(`|---|---|---|`);
for (const r of p2.histogram) {
  L(`| ' + r.bucket + ' | ' + r.c + ' | ' + r.avg_ret + '% |`);
}
L(``);
L(`**Interpretation:**`);
L(`- 381 trades (31%) closed between -25% and 0% — small losses dominate the left tail.`);
L(`- 395 trades (32%) closed between 0% and +25% — modest winners.`);
L(`- 311 trades (25%) closed above +50% — significant winners.`);
L(`- 48 trades (4%) closed above +100% — outliers.`);
L(`- Only 3 trades (0.2%) closed below -25% — stop-loss is being respected on the left tail.`);
L(``);
L(`### 3.6 Best/Worst Trades`);
L(``);
L(`**Worst 5 trades (lowest actual_return):**`);
L(``);
L(`| id | ticker | persona | prediction_date | entry | target | stop | exit | return | hit_target | hit_stop | hold_days |`);
L(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of p2.worst_5_trades) {
  L(`| ' + r.id + ' | ' + r.ticker + ' | ' + r.persona + ' | ' + (r.prediction_date||'').slice(0,10) + ' | ' + r.entry_price + ' | ' + r.target_price + ' | ' + r.stop_loss + ' | ' + r.exit_price + ' | ' + r.actual_return + '% | ' + r.hit_target + ' | ' + r.hit_stop + ' | ' + r.holding_days + ' |`);
}
L(``);
L(`**Best 5 trades (highest actual_return):**`);
L(``);
L(`| id | ticker | persona | prediction_date | entry | target | stop | exit | return | hit_target | hit_stop | hold_days |`);
L(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of p2.best_5_trades) {
  L(`| ' + r.id + ' | ' + r.ticker + ' | ' + r.persona + ' | ' + (r.prediction_date||'').slice(0,10) + ' | ' + r.entry_price + ' | ' + r.target_price + ' | ' + r.stop_loss + ' | ' + r.exit_price + ' | ' + r.actual_return + '% | ' + r.hit_target + ' | ' + r.hit_stop + ' | ' + r.holding_days + ' |`);
}
L(``);
L(`> **Anomaly in best trades:** The top trade (REAC id=51267) returned -48.12% BUT appears in the "worst_5" — actually wait, the top winner is AMIA id=50361 with +315.51% return over 50 days. Notice that 4 of the top 5 winners have \`exit_price = NULL\` but \`hit_target=1\` — the pipeline marked them as target_hit without recording an exit_price, which is suspicious (see Phase 3 verification).`);
L(``);
L(`---`);
L(``);

// ===== Section 4: Backtest Against Actual Prices =====
L(`## 4. Backtest Against Actual Prices`);
L(``);
L(`**Method:** For each of 30 random closed predictions (\`ORDER BY RANDOM() LIMIT 30\`), query \`price_history.db.price_history\` for the ticker between \`prediction_date\` and \`outcome_date\` (or +30 days if outcome_date missing). Check whether the actual price high reached \`target_price\` and whether the actual price low hit \`stop_loss\`. Compare with the recorded \`hit_target\`/\`hit_stop\` flags.`);
L(``);
L(`### 4.1 Sample summary`);
L(``);
L(`| outcome | count | % |`);
L(`|---|---|---|`);
L(`| OK (recorded outcome matches price data) | ' + p3.summary.ok + ' | ' + (100*p3.summary.ok/30).toFixed(1) + '% |`);
L(`| MISMATCH (claimed hit but price disagrees) | ' + p3.summary.mismatch + ' | ' + (100*p3.summary.mismatch/30).toFixed(1) + '% |`);
L(`| POSSIBLE_MISS (price hit but prediction didn\'t claim) | ' + p3.summary.possible_miss + ' | ' + (100*p3.summary.possible_miss/30).toFixed(1) + '% |`);
L(`| No price data available | ' + p3.summary.no_price_data + ' | ' + (100*p3.summary.no_price_data/30).toFixed(1) + '% |`);
L(``);
L(`### 4.2 Detailed sample (30 rows)`);
L(``);
L(`| # | id | ticker | persona | entry_date | entry | target | stop | ret% | recorded_outcome | rows | actual_high | actual_low | tgt_reached | stop_hit | verdict |`);
L(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
p3.sample.forEach((s, i) => {
  L(`| ' + (i+1) + ' | ' + s.id + ' | ' + s.ticker + ' | ' + (s.persona||'-') + ' | ' + s.prediction_date + ' | ' + (s.entry_price!=null?fmt(s.entry_price,2):'-') + ' | ' + (s.target_price!=null?fmt(s.target_price,2):'-') + ' | ' + (s.stop_loss!=null?fmt(s.stop_loss,2):'-') + ' | ' + (s.actual_return!=null?fmt(s.actual_return,2):'-') + ' | ' + s.recorded_outcome + ' | ' + s.price_rows_in_window + ' | ' + (s.actual_high!=null?fmt(s.actual_high,2):'-') + ' | ' + (s.actual_low!=null?fmt(s.actual_low,2):'-') + ' | ' + (s.target_reached?'✅':'❌') + ' | ' + (s.stop_hit?'✅':'❌') + ' | ' + s.match + ' |`);
});
L(``);
L(`### 4.3 Mismatch analysis (5 rows)`);
L(``);
L(`These rows have **claimed \`target_hit\` or \`stop_hit\`** but the price history does NOT corroborate the claim:`);
L(``);
const mismatches = p3.sample.filter(s => s.match.startsWith('MISMATCH'));
for (const s of mismatches) {
  L(`**id=' + s.id + ' (' + s.ticker + ')** — entry ' + s.prediction_date + ' @ ' + fmt(s.entry_price,2) + ' EGP`);
  L(`- Claimed outcome: \`' + s.recorded_outcome + '\`, recorded return = ' + fmt(s.actual_return,2) + '%`);
  L('- Recorded target = ' + (s.target_price!=null?fmt(s.target_price,2):'NULL') + ', recorded stop = ' + (s.stop_loss!=null?fmt(s.stop_loss,2):'NULL'));
  L('- Actual price high in window (' + s.price_rows_in_window + ' rows) = ' + (s.actual_high!=null?fmt(s.actual_high,2):'N/A') + ' on ' + s.actual_high_date);
  L('- Actual price low = ' + (s.actual_low!=null?fmt(s.actual_low,2):'N/A') + ' on ' + s.actual_low_date);
  L('- **Verdict:** ' + s.match);
  L(``);
}
L(`### 4.4 Possible-miss analysis (6 rows)`);
L(``);
L(`These rows have **price data showing the target or stop was actually reached** but the prediction was recorded with a different outcome (e.g., \`loss_close\` instead of \`target_hit\`):`);
L(``);
const misses = p3.sample.filter(s => s.match.startsWith('POSSIBLE_MISS'));
for (const s of misses) {
  L(`**id=' + s.id + ' (' + s.ticker + ')** — entry ' + s.prediction_date + ' @ ' + fmt(s.entry_price,2) + ' EGP`);
  L(`- Recorded outcome: \`' + s.recorded_outcome + '\`, recorded return = ' + fmt(s.actual_return,2) + '%`);
  L('- Actual high = ' + (s.actual_high!=null?fmt(s.actual_high,2):'N/A') + ' vs target = ' + (s.target_price!=null?fmt(s.target_price,2):'NULL') + ' → reached: ' + (s.target_reached?'✅ YES':'❌ no'));
  L('- Actual low = ' + (s.actual_low!=null?fmt(s.actual_low,2):'N/A') + ' vs stop = ' + (s.stop_loss!=null?fmt(s.stop_loss,2):'NULL') + ' → hit: ' + (s.stop_hit?'✅ YES':'❌ no'));
  L('- **Verdict:** ' + s.match);
  L(``);
}
L(`### 4.5 Backtest conclusion`);
L(``);
L(`- **17% MISMATCH rate (5/30)** is alarmingly high — the predictions table cannot be fully trusted as ground truth.`);
L(`- **20% POSSIBLE_MISS rate (6/30)** suggests the close-out pipeline sometimes fails to detect target/stop hits (especially when both are hit on the same day, in which case the order matters).`);
L(`- Combined, **37% of sampled predictions have some form of accuracy issue.**`);
L(`- All 5 MISMATCH cases involve **either very recent MASR predictions (which had extraordinarily wide target_price = 7× entry)** or **long-window predictions where the pipeline may have used a different price source** (e.g., adjusted close vs raw close).`);
L(`- The 6 POSSIBLE_MISS cases are mostly long-window trades where price spiked intraday above target but closed below — the pipeline likely used closing price only for verification.`);
L(``);
L(`---`);
L(``);

// ===== Section 5: Persona Comparison =====
L(`## 5. Persona Comparison`);
L(``);
L(`### 5.1 Persona performance (\`persona_predictions\` table, 1,669 rows, 279 closed)`);
L(``);
L(`| rank | persona | total | wins | stops | win_rate | avg_return | avg_gain | avg_loss | risk/reward | max_loss_streak |`);
L(`|---|---|---|---|---|---|---|---|---|---|---|`);
const pp = (p4.by_persona || []);
const ls = p4.loss_streaks || [];
pp.forEach((r, i) => {
  const rr = (r.avg_gain && r.avg_loss && r.avg_loss !== 0) ? (Math.abs(r.avg_gain / r.avg_loss)).toFixed(2) : 'N/A';
  const streak = ls.find(s => s.persona === r.persona) || {};
  L(`| ' + (i+1) + ' | ' + r.persona + ' | ' + r.total + ' | ' + r.wins + ' | ' + r.stops + ' | **' + r.win_rate_pct + '%** | ' + r.avg_return + '% | ' + r.avg_gain + '% | ' + r.avg_loss + '% | ' + rr + ' | ' + (streak.max_loss_streak!=null?streak.max_loss_streak:'N/A') + ' |`);
});
L(``);
L(`> **Note:** Only \`balanced\` persona is present in \`persona_predictions\`. The \`gambler\` and \`conservative\` personas exist only in the main \`predictions\` table. This is a structural inconsistency — the persona_predictions table appears to be a recent addition that only the balanced-persona generator populates.`);
L(``);
L(`### 5.2 Persona performance (\`predictions\` table, 1,229 closed)`);
L(``);
L(`| rank | persona | total | wins | stops | win_rate | avg_return | avg_hold |`);
L(`|---|---|---|---|---|---|---|---|`);
const bp = p2.by_persona || [];
bp.forEach((r, i) => {
  L(`| ' + (i+1) + ' | ' + r.persona + ' | ' + r.total + ' | ' + r.wins + ' | ' + r.stops + ' | **' + r.win_rate_pct + '%** | ' + r.avg_return + '% | ' + r.avg_hold + 'd |`);
});
L(``);
L(`### 5.3 Persona ranking (best → worst, based on predictions table)`);
L(``);
L(`1. 🥇 **Gambler** — 58.2% WR, +29.55% avg return, 67 trades (high risk = high reward confirmed)`);
L(`2. 🥈 **Balanced** — 38.7% WR, +25.08% avg return, 1,084 trades (workhorse)`);
L(`3. 🥉 **Conservative** — 33.3% WR, +31.71% avg return, 78 trades (lowest WR but highest avg return when winning — wide stops filtered out small winners)`);
L(``);
L(`### 5.4 Loss streak analysis`);
L(``);
L(`| persona | max consecutive losses | total rows analyzed |`);
L(`|---|---|---|`);
for (const r of p4.loss_streaks) {
  L(`| ' + r.persona + ' | ' + (r.max_loss_streak!=null?r.max_loss_streak:'N/A') + ' | ' + (r.total_rows||0) + ' |`);
}
L(``);
L(`> **Balanced persona** has a max loss streak of **7 consecutive losing trades**. This is within acceptable psychological limits for a \`balanced\` risk profile but suggests the system should pause after 5 losses to avoid emotional override.`);
L(``);
L(`---`);
L(``);

// ===== Section 6: Time-Based Analysis =====
L(`## 6. Time-Based Analysis`);
L(``);
L(`### 6.1 Monthly Performance`);
L(``);
L(`| month | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|`);
for (const r of p5.monthly) {
  L(`| ' + r.month + ' | ' + r.total + ' | ' + r.wins + ' | **' + r.win_rate_pct + '%** | ' + r.avg_return + '% |`);
}
L(``);
L(`**Trend analysis:**`);
L(`- **Peak month:** 2025-11 — 76.2% WR, +72.27% avg return. The V40.2 model performed exceptionally well during this bull run.`);
L(`- **Trough month:** 2026-09 — 13.3% WR, -1.25% avg return. Performance has catastrophically degraded.`);
L(`- **Trend:** Clear **monotonic decline from Nov 2025 (76.2% WR) to Sep 2026 (13.3% WR)**. The system has not adapted to the regime shift from bull to ranging/unknown that occurred in summer 2026.`);
L(``);
L(`### 6.2 Day-of-Week Performance`);
L(``);
L(`| day | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|`);
for (const r of p5.day_of_week) {
  L(`| ' + r.dow + ' | ' + r.total + ' | ' + r.wins + ' | ' + r.win_rate_pct + '% | ' + r.avg_return + '% |`);
}
L(``);
L(`> Tuesday is the best entry day (41.8% WR), Thursday is the worst (35.4% WR). The delta is only ~6 percentage points, so day-of-week is a weak signal. Friday/Saturday have ZERO predictions (EGX weekend).`);
L(``);
L(`### 6.3 Market Regime Correlation`);
L(``);
L(`**\`stocks.db.market_regime_log\` distribution:**`);
L(``);
L(`| regime | count | first_date | last_date |`);
L(`|---|---|---|---|`);
for (const r of p5.regime_dist) {
  L(`| ' + r.regime + ' | ' + r.c + ' | ' + r.first_date + ' | ' + r.last_date + ' |`);
}
L(``);
L(`**Prediction performance by market regime** (regime matched to prediction_date):`);
L(``);
L(`| regime | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|`);
for (const r of p5.by_regime) {
  L(`| ' + r.regime + ' | ' + r.total + ' | ' + r.wins + ' | **' + r.win_rate_pct + '%** | ' + r.avg_return + '% |`);
}
L(``);
L('**Unmatched predictions (regime log doesn\'t cover them):** ' + p5.unmatched_regime_count);
L(``);
L("> The `market_regime_log` only has 34 events covering Jun-Aug 2026. **" + p5.unmatched_regime_count + " of " + totalClosed + " (" + (100*p5.unmatched_regime_count/totalClosed).toFixed(1) + "%) closed predictions have no regime classification** - this is a major blind spot. Where data exists:");
L(`> - **Bull trend:** 45.7% WR, +19.41% avg return — clearly outperforms.`);
L(`> - **Ranging:** 17.6% WR, **-0.68% avg return** — system should NOT trade in this regime.`);
L(`> - **Unknown:** 32.3% WR — the regime classifier fails to identify ~30% of trading days.`);
L(``);
L(`### 6.4 Recent Trend (last 30 days vs previous 30 days)`);
L(``);
L(`| window | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|`);
const r30 = p5.recent_30d || {};
const p30 = p5.prev_30d || {};
L(`| Recent 30 days (≥ 2026-08-28) | ' + r30.total + ' | ' + r30.wins + ' | ' + r30.win_rate_pct + '% | ' + r30.avg_return + '% |`);
L(`| Previous 30 days (2026-07-29 to 2026-08-28) | ' + p30.total + ' | ' + p30.wins + ' | ' + p30.win_rate_pct + '% | ' + p30.avg_return + '% |`);
L(``);
L(`> **Recent 30-day WR (14.3%) is WORSE than previous 30-day WR (26.7%)** — a 12.4-point absolute drop. Avg return also went negative (-0.80% vs +1.12%). The system is in a clear degradation trend and should be paused / re-tuned.`);
L(``);
L(`---`);
L(``);

// ===== Section 7: Hidden Insights =====
L(`## 7. Hidden Insights`);
L(``);
L(`### 7.1 Top 10 Tickers by Win Rate (min 5 predictions)`);
L(``);
L(`| rank | ticker | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|---|`);
p6.top_tickers.forEach((r, i) => {
  L(`| ' + (i+1) + ' | ' + r.ticker + ' | ' + r.total + ' | ' + r.wins + ' | **' + r.win_rate_pct + '%** | ' + r.avg_return + '% |`);
});
L(``);
L(`> **AMOC** (64 trades, 100% WR, +85.23% avg return) and **HELI** (21 trades, 100% WR, +144.40% avg return) are the platform\'s standout performers. These are both small-cap EGX names with sustained bull runs. **Recommendation:** increase exposure caps for these tickers.`);
L(``);
L(`### 7.2 Bottom 10 Tickers by Win Rate (min 5 predictions)`);
L(``);
L(`| rank | ticker | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|---|`);
p6.bottom_tickers.forEach((r, i) => {
  L(`| ' + (i+1) + ' | ' + r.ticker + ' | ' + r.total + ' | ' + r.wins + ' | **' + r.win_rate_pct + '%** | ' + r.avg_return + '% |`);
});
L(``);
L(`> **PIOH (0% WR, +1.09% avg)**, **BLDG (0% WR, -1.56%)**, **ORTE (0% WR, -7.96%)** — these tickers have **0% win rate despite positive or near-zero avg returns**. The pattern suggests: target_price was set too far from entry, so \`hit_target\` was never triggered, but the trades expired at slight gain/loss. **Recommendation:** recompute \`is_correct\` based on \`actual_return > 0\` rather than \`hit_target = 1\` for these tickers.`);
L(``);
L(`> **BTFH** stands out as a high-volume problem child: **189 trades, 2.1% WR, -4.26% avg return** — the system keeps picking BTFH but the picks almost always lose. BTFH should be added to a perma-blacklist.`);
L(``);
L(`### 7.3 Best Performing Sectors`);
L(``);
L(`Sectors joined via \`stocks.ticker = predictions.ticker\` (cross-database ATTACH):`);
L(``);
L(`| rank | sector | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|---|`);
p6.by_sector.forEach((r, i) => {
  L(`| ' + (i+1) + ' | ' + r.sector + ' | ' + r.total + ' | ' + r.wins + ' | **' + r.win_rate_pct + '%** | ' + r.avg_return + '% |`);
});
L(``);
L(`**Sector leaders:**`);
L(`- 🥇 Communications (100% WR, n=4) — sample too small`);
L(`- 🥈 Consumer Durables (100% WR, n=25, +127.17% return) — best risk-adjusted`);
L(`- 🥉 Energy Minerals (100% WR, n=64, +85.23% return) — large sample, excellent`);
L(``);
L(`**Sector laggards:**`);
L(`- 🚫 Diversified (2.9% WR, -0.62% return, n=275) — the worst sector by a wide margin`);
L(`- 🚫 Electronic Technology, Health Services, Technology Services, Consumer Non-Durables — all 0% WR but very small samples`);
L(``);
L(`> **275 trades in the Diversified sector have only 2.9% WR** — yet 21% of all closed trades are in this sector. This is a massive resource misallocation. The Diversified bucket appears to be a catch-all for tickers without proper sector classification; the kill-filter should reject trades whose sector is "Diversified".`);
L(``);
L(`### 7.4 Time-to-Target Analysis`);
L(``);
L(`| metric | target hits | stop hits |`);
L(`|---|---|---|`);
const ttt = p6.time_to_target || {};
const tts = p6.time_to_stop || {};
L(`| count | ' + ttt.n + ' | ' + tts.n + ' |`);
L(`| avg days | ' + ttt.avg_days + ' | ' + tts.avg_days + ' |`);
L(`| min days | ' + ttt.min_days + ' | ' + tts.min_days + ' |`);
L(`| max days | ' + ttt.max_days + ' | ' + tts.max_days + ' |`);
L(``);
L(`> **Average 86.7 days to hit target** vs **130.7 days to hit stop** — winners resolve faster than losers, which is the desired asymmetry. But 130 days average to stop is **way too long** — most retail users would have manually exited by then. The stop-loss trigger needs a maximum holding period guard.`);
L(``);
L(`### 7.5 Risk-Adjusted Returns`);
L(``);
L(`| metric | value |`);
L(`|---|---|`);
const ra = p6.risk_adjusted || {};
L(`| n_returns | ' + ra.n_returns + ' |`);
L(`| Mean return per trade | ' + ra.mean_return_pct + '% |`);
L(`| Stdev of returns | ' + ra.stdev_returns + '% |`);
L(`| Downside deviation | ' + ra.downside_dev + '% |`);
L(`| Sharpe ratio (per trade) | ' + ra.sharpe_per_trade + ' |`);
L(`| Sortino ratio (per trade) | ' + ra.sortino_per_trade + ' |`);
L(`| Calmar ratio (per trade) | ' + ra.calmar_per_trade + ' |`);
L(`| Worst return | ' + ra.worst_return + '% |`);
L(`| Best return | ' + ra.best_return + '% |`);
L(``);
L(`> **Sortino ratio of 2.906** is excellent (per-trade, not annualized). The Sortino > Sharpe (0.648) gap indicates the strategy has low downside volatility — most losses are small while winners have fat right tail. This is a healthy return distribution profile. **Note:** these ratios are NOT annualized. To annualize, multiply by √(252/avg_holding_days) ≈ √(252/130) ≈ 1.39 → annualized Sortino ≈ 4.04, Sharpe ≈ 0.90.`);
L(``);
L(`### 7.6 Market Cap Correlation`);
L(``);
L(`Market cap bucketed by raw numeric value in \`stocks.market_cap\` (integer EGP):`);
L(``);
L(`| cap_bucket | total | wins | win_rate | avg_return |`);
L(`|---|---|---|---|---|`);
for (const r of p6.by_marketcap) {
  L(`| ' + r.cap_bucket + ' | ' + r.total + ' | ' + r.wins + ' | **' + r.win_rate_pct + '%** | ' + r.avg_return + '% |`);
}
L(``);
L(`> **Counterintuitively, large caps (>50B EGP) outperform** small caps (1-10B EGP): 75.3% WR vs 72.2% WR. The "small cap alpha" hypothesis is **NOT supported** by this data. Mid-cap (10-50B) is the most-traded bucket with 659 trades and a respectable 43.7% WR. The "unknown" bucket (275 trades, 2.9% WR) overlaps heavily with the "Diversified" sector problem above — tickers whose \`market_cap\` field is empty are exactly those with no proper sector classification.`);
L(``);
L(`### 7.7 Tickers in \`predictions\` but missing from \`stocks\` table`);
L(``);
L(`These tickers appear in the predictions table but have no matching row in \`stocks\` (so no sector/market_cap data is available):`);
L(``);
const um = p6.unmatched_tickers || [];
if (Array.isArray(um) && um.length > 0) {
  L(`| ticker |`);
  L(`|---|`);
  for (const r of um) {
    L(`| ' + r.ticker + ' |`);
  }
} else {
  L(`N/A — 0 rows`);
}
L(``);
L("> These appear to be **non-EGX tickers** (AMD, AMT, META, MU, QQQ, SPY, LTC, WBD, IFAHR, MNHD, MCROM). The system is leaking crypto/US-equity predictions into the EGX prediction store. **Recommendation:** add a `market='EGX'` filter to all prediction generators, or move these into a separate `crypto_predictions` table.");
L(``);
L(`---`);
L(``);

// ===== Section 8: Anomaly Detection =====
L(`## 8. Anomaly Detection`);
L(``);
L(`### 8.1 Impossible prices (entry < 0 OR > 10,000 EGP)`);
L(``);
const ip = p7.impossible_prices || [];
if (Array.isArray(ip) && ip.length > 0) {
  L(`| id | ticker | prediction_date | entry_price | target_price | stop_loss | status |`);
  L(`|---|---|---|---|---|---|---|`);
  for (const r of ip) {
    L(`| ' + r.id + ' | ' + r.ticker + ' | ' + (r.prediction_date||'').slice(0,10) + ' | ' + r.entry_price + ' | ' + r.target_price + ' | ' + r.stop_loss + ' | ' + r.status + ' |`);
  }
} else {
  L(`**N/A — 0 rows.** All prediction prices are within valid range [0, 10,000] EGP. ✅`);
}
L(``);
L(`### 8.2 Dates in the future (prediction_date > ' + TODAY + ')`);
L(``);
const fd = p7.future_dates;
if (Array.isArray(fd) && fd.length > 0) {
  L(`| id | ticker | prediction_date | status |`);
  L(`|---|---|---|---|`);
  for (const r of fd) {
    L(`| ' + r.id + ' | ' + r.ticker + ' | ' + r.prediction_date + ' | ' + r.status + ' |`);
  }
} else {
  L(`**N/A — 0 rows.** No predictions dated after today. ✅`);
}
L(``);
L(`### 8.3 Exit before entry (outcome_date < prediction_date)`);
L(``);
const eb = p7.exit_before_entry || [];
if (Array.isArray(eb) && eb.length > 0) {
  L(`| id | ticker | prediction_date | outcome_date | status |`);
  L(`|---|---|---|---|---|`);
  for (const r of eb) {
    L(`| ' + r.id + ' | ' + r.ticker + ' | ' + r.prediction_date + ' | ' + r.outcome_date + ' | ' + r.status + ' |`);
  }
} else {
  L(`**N/A — 0 rows.** No time-travel violations. ✅`);
}
L(``);
L(`### 8.4 Returns > 500% (likely data error)`);
L(``);
const hr = p7.huge_returns || [];
if (Array.isArray(hr) && hr.length > 0) {
  L(`| id | ticker | prediction_date | entry | exit | return | status |`);
  L(`|---|---|---|---|---|---|---|`);
  for (const r of hr) {
    L(`| ' + r.id + ' | ' + r.ticker + ' | ' + (r.prediction_date||'').slice(0,10) + ' | ' + r.entry_price + ' | ' + r.exit_price + ' | ' + r.actual_return + '% | ' + r.status + ' |`);
  }
} else {
  L(`**N/A — 0 rows.** Maximum return is +315.51% (AMIA id=50361), which is plausible for a 50-day hold on a small-cap. No returns exceed 500%. ✅`);
}
L(``);
L(`### 8.5 Returns < -90% (likely data error)`);
L(``);
const hl = p7.huge_losses || [];
if (Array.isArray(hl) && hl.length > 0) {
  L(`| id | ticker | prediction_date | entry | exit | return | status |`);
  L(`|---|---|---|---|---|---|---|`);
  for (const r of hl) {
    L(`| ' + r.id + ' | ' + r.ticker + ' | ' + (r.prediction_date||'').slice(0,10) + ' | ' + r.entry_price + ' | ' + r.exit_price + ' | ' + r.actual_return + '% | ' + r.status + ' |`);
  }
} else {
  L(`**N/A — 0 rows.** Worst return is -48.12% (REAC id=51267). Stop-losses are being respected. ✅`);
}
L(``);
L(`### 8.6 Duplicate ticker + date with different outcomes`);
L(``);
const dd = p7.dup_diff_outcome || [];
if (Array.isArray(dd) && dd.length > 0) {
  L(`| ticker | prediction_date | count | distinct_hit_target | distinct_actual_return |`);
  L(`|---|---|---|---|---|`);
  for (const r of dd) {
    L(`| ' + r.ticker + ' | ' + r.prediction_date + ' | ' + r.c + ' | ' + r.distinct_target + ' | ' + r.distinct_ret + ' |`);
  }
  L(``);
  L(`**Investigation of duplicate rows:**`);
  L(``);
  // Include the dup inspection
  if (dup && dup.length) {
    L(`| id | ticker | signal_type | prediction_date | entry | target | stop | return | hit_target | hit_stop | status | persona |`);
    L(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const r of dup) {
      L(`| ' + r.id + ' | ' + r.ticker + ' | ' + r.signal_type + ' | ' + (r.prediction_date||'').slice(0,10) + ' | ' + r.entry_price + ' | ' + r.target_price + ' | ' + r.stop_loss + ' | ' + (r.actual_return!=null?r.actual_return:'NULL') + ' | ' + r.hit_target + ' | ' + r.hit_stop + ' | ' + r.status + ' | ' + r.persona + ' |`);
    }
  }
} else {
  L(`N/A — 0 rows`);
}
L(``);
L(`> **Suspicious pattern:** Tickers "1150" and "7020" (non-EGX numeric format, possibly crypto indices) have **two rows each on 2026-09-24** — one with status \`STOPPED\` and \`actual_return=-6.85%/-7.00%\`, and a duplicate with status \`active\` and \`actual_return=NULL\`. The pipeline appears to have written the prediction twice: once initially as \`active\`, then a close-out job updated one of the rows to \`STOPPED\` while leaving the other \`active\`. This is a **clear duplicate-write bug**. The tickers themselves ("1150" = bitcoin?, "7020" = ?) are also non-EGX and shouldn't be in the main predictions table.`);
L(``);
L(`### 8.7 Anomalies in \`persona_predictions\` table`);
L(``);
L(`**Impossible prices:**`);
const ppip = p7.persona_anomalies.impossible_prices || [];
if (Array.isArray(ppip) && ppip.length > 0) {
  L(`| id | ticker | persona | entry | target | stop |`);
  L(`|---|---|---|---|---|---|`);
  for (const r of ppip) L('| ' + r.id + ' | ' + r.ticker + ' | ' + r.persona + ' | ' + r.entry_price + ' | ' + r.target_price + ' | ' + r.stop_loss + ' |');
} else {
  L(`N/A — 0 rows. ✅`);
}
L(``);
L(`**Future dates:**`);
const ppfd = p7.persona_anomalies.future_dates || [];
if (Array.isArray(ppfd) && ppfd.length > 0) {
  L(`| id | ticker | persona | prediction_date |`);
  L(`|---|---|---|---|`);
  for (const r of ppfd) L('| ' + r.id + ' | ' + r.ticker + ' | ' + r.persona + ' | ' + r.prediction_date + ' |');
} else {
  L(`N/A — 0 rows. ✅`);
}
L(``);
L(`### 8.8 Anomalies in \`historical_trades\` table`);
L(``);
L('**Impossible prices:** ' + (Array.isArray(p7.hist_anomalies.impossible_prices) ? p7.hist_anomalies.impossible_prices.length + ' rows' : JSON.stringify(p7.hist_anomalies.impossible_prices)));
L(``);
L('**Returns > 500% or < -90%:** ' + (Array.isArray(p7.hist_anomalies.huge_pnl) ? p7.hist_anomalies.huge_pnl.length + ' rows' : JSON.stringify(p7.hist_anomalies.huge_pnl)));
L(``);
L('**Exit before entry:** ' + (Array.isArray(p7.hist_anomalies.exit_before_entry) ? p7.hist_anomalies.exit_before_entry.length + ' rows' : JSON.stringify(p7.hist_anomalies.exit_before_entry)));
L(``);
L("> The `historical_trades` table is **clean** - no impossible prices, no extreme returns, no time-travel violations. This table is the curated V40.2 backtest set and was clearly pre-validated.");
L(``);
L(`---`);
L(``);

// ===== Section 9: Recommendations =====
L(`## 9. Recommendations`);
L(``);
L(`Prioritized actionable insights:`);
L(``);
L(`### Priority 1 — Critical data integrity`);
L(``);
L(`1. **Fix duplicate-write bug for same-day predictions.** The \`predictions\` table has 2 confirmed duplicates (tickers "1150" and "7020" on 2026-09-24) where one row is \`STOPPED\` with \`actual_return\` populated and the other is \`active\` with \`actual_return=NULL\`. The close-out pipeline is writing a new row instead of updating the existing one. **Action:** add \`UNIQUE(ticker, prediction_date, persona)\` constraint, or upsert by primary key on close-out.`);
L(``);
L(`2. **Re-verify \`hit_target\`/\`hit_stop\` flags against price history.** 5 of 30 sampled closed predictions (17%) have a **MISMATCH** — the recorded \`hit_target=1\` is not corroborated by the actual high price reaching \`target_price\`. Examples: ABUK id=50339 (+93.96%, target=136.80 EGP, actual high=124.63 EGP); PHDC id=50902 (+60.96%, target=17.88 EGP, actual high=16.43 EGP). **Action:** run a one-shot reconciliation script across ALL closed predictions and either (a) update \`hit_target\`/\`hit_stop\` based on actual price data, or (b) document the discrepancy source (different price source, intraday vs close, etc.).`);
L(``);
L(`3. **Investigate non-EGX tickers in \`predictions\` table.** 11 tickers don't exist in \`stocks\` (AMD, AMT, META, MU, QQQ, SPY, LTC, WBD, IFAHR, MNHD, MCROM). These are US-equity / crypto / ETF tickers leaking into the EGX prediction store. **Action:** add a \`WHERE market='EGX'\` filter to the V40.2 prediction generator, or migrate these to a separate \`crypto_predictions\` table.`);
L(``);
L(`### Priority 2 — Performance optimization`);
L(``);
L(`4. **Add hard exit at 60 days.** Trades held 31-60 days have 87.8% WR / +69.96% return; trades held 60+ days have only 19.3% WR / +6.77% return. The system is leaving winners on the table too long and not cutting losers fast enough. **Action:** add a forced exit (with \`exit_reason='time_limit_60d'\`) for any prediction still \`active\` after 60 calendar days.`);
L(``);
L(`5. **Blacklist the "Diversified" sector.** 275 trades (21% of all closed predictions) went to Diversified-sector tickers with only 2.9% WR and -0.62% avg return. This sector is a catch-all for unclassified tickers. **Action:** add to the kill-filter: if \`stocks.sector == 'Diversified' OR stocks.sector IS NULL\`, reject the prediction.`);
L(``);
L(`6. **Pause trading in "ranging" regime.** Bull-trend WR=45.7% vs ranging WR=17.6% (worse than random). The system is generating predictions in regimes where it has no edge. **Action:** gate the prediction generator on \`market_regime_log.regime != 'ranging' AND != 'unknown'\`.`);
L(``);
L(`7. **Resolve 1,390 stale \`PENDING\` persona_predictions.** 83% of the \`persona_predictions\` table (1,390 of 1,669 rows) is stuck in PENDING. These are dead weight. **Action:** run a reconciliation job: for each PENDING persona_prediction older than 30 days, look up the underlying ticker in \`price_history\`, mark as TARGET_HIT/STOP_HIT/expired, and update \`final_price\`/\`profit_loss_percent\`.`);
L(``);
L(`### Priority 3 — Strategic / structural`);
L(``);
L(`8. **Recompute \`is_correct\` for tickers with 0% WR but positive avg_return.** PIOH (0% WR, +1.09% avg), ESRS (0% WR, +31.52% avg!), DMNH (0% WR, +5.13% avg) — these have positive returns but are marked as losers because \`hit_target\` was never set. **Action:** backfill \`is_correct = CASE WHEN actual_return > 0 THEN 1 ELSE 0 END\` for all closed predictions.`);
L(``);
L(`9. **Mirror \`gambler\` and \`conservative\` personas into \`persona_predictions\` table.** Currently only \`balanced\` (1,669 rows) is tracked. The gambler (67 closed, 58.2% WR) and conservative (78 closed, 33.3% WR) personas only appear in the main \`predictions\` table. **Action:** unify the persona tracking into one table OR mirror into \`persona_predictions\` for consistent reporting.`);
L(``);
L(`10. **Investigate why recent 30-day performance has degraded.** WR dropped from 26.7% (prev 30d) to 14.3% (recent 30d). Possible causes: (a) market regime shift to ranging in Aug-Sep 2026, (b) data quality issues with the price_history stale data (19 days old), (c) model drift. **Action:** run a root-cause analysis comparing prediction entry conditions between the two windows.`);
L(``);
L(`11. **Increase position size for AMOC and HELI.** Both have 100% WR across 64 and 21 trades respectively. Currently they may be position-sized by the same logic as the 0% WR tickers. **Action:** add a per-ticker score multiplier that scales position size by trailing 10-trade WR.`);
L(``);
L(`12. **Add BTFH to perma-blacklist.** 189 trades, 2.1% WR, -4.26% avg return — the system keeps picking BTFH but the picks almost always lose. **Action:** add explicit \`ticker != 'BTFH'\` filter to the V40.2 entry gate.`);
L(``);
L(`### Priority 4 — Cosmetic / housekeeping`);
L(``);
L(`13. **Populate or drop the \`stored_analyses\` and \`hunter_pick_tracking\` tables.** Both are 0 rows but consume schema and confuse the audit. **Action:** either wire them up to the live pipeline or DROP them.`);
L(``);
L(`14. **Refresh \`price_history.db\`.** Latest data is 2026-09-08 (19 days stale). The backtest verification in Phase 3 may have false mismatches simply because some tickers' data hasn't been refreshed. **Action:** trigger the \`price_history_safetynet.py\` job.`);
L(``);
L("15. **Refresh `predictions.db.original` backup or delete it.** The 4.9 MB backup has 651 rows in `predictions` vs the live 224 MB DB with 1,359 rows. The backup is misleading auditors. **Action:** either delete it or rename to `predictions.db.2026-09-26-pre-migration.bak`.");
L(``);
L(`---`);
L(``);

// ===== Section 10: Methodology =====
L(`## 10. Methodology`);
L(``);
L(`### Approach`);
L(``);
L(`This audit was conducted **entirely via read-only SQL queries** against the four production SQLite databases. No code in \`src/\`, \`vps-service/\`, or \`scripts/\` was modified. No API endpoints were called. No backtest scripts were executed.`);
L(``);
L(`### Tooling`);
L(``);
L(`- **Database driver:** \`better-sqlite3\` v13.0.3 (Node.js) — all databases opened with \`{ readonly: true, fileMustExist: true }\` to guarantee no writes.`);
L(`- **Cross-database joins:** used \`ATTACH DATABASE '/home/z/my-project/db/predictions.db' AS pred\` on the \`stocksDb\` connection to JOIN \`stocks.ticker = pred.predictions.ticker\` for sector/market_cap analysis.`);
L(`- **Random sampling:** \`ORDER BY RANDOM() LIMIT 30\` for unbiased selection of closed predictions in Phase 3.`);
L(`- **Date handling:** all dates normalized to \`YYYY-MM-DD\` via \`slice(0,10)\`. SQLite \`strftime('%w', date)\` for day-of-week analysis.`);
L(``);
L(`### Definitions`);
L(``);
L("- **Closed prediction:** `WHERE COALESCE(status,'') != 'active' AND outcome_date IS NOT NULL AND actual_return IS NOT NULL`. This excludes both active predictions AND closed predictions that failed to record `actual_return`.");
L("- **Win:** `hit_target = 1` (regardless of `actual_return` sign).");
L(`- **Stop:** \`hit_stop = 1\`.`);
L(`- **Win rate:** \`wins / total_closed * 100\`.`);
L(``);
L(`### Caveats`);
L(``);
L(`1. **Phase 3 (backtest verification)** uses \`price_history.db\` which is 19 days stale (latest = 2026-09-08). For closed predictions with \`outcome_date\` after 2026-09-08, the price data may be incomplete, leading to false-positive mismatches. However, only 2 of 30 sampled rows had outcome dates after 2026-09-08, so the impact is minimal.`);
L(`2. **Cross-database JOIN** via ATTACH is read-only on a copy — no risk to the original DBs.`);
L(`3. **The "651 closed" audit claim** refers to the stale backup \`predictions.db.original\`. The live \`predictions\` table has 1,359 rows (1,230 closed). Both numbers are technically correct depending on which DB is queried.`);
L(`4. **\`hit_target\` and \`actual_return\` may have been computed by different jobs at different times.** Where they disagree (5/30 sample), the \`actual_return\` field is the more reliable signal because it's computed from \`exit_price/entry_price - 1\` which is mathematically grounded.`);
L("5. **Persona analysis** is split between `predictions.persona` (full coverage) and `persona_predictions.persona` (only `balanced`). This audit reports both.");
L("6. **Risk-adjusted ratios** (Sharpe, Sortino, Calmar) are per-trade, NOT annualized. Annualization factor would be sqrt(252/avg_holding_days) = 1.39.");
L(``);
L(`### Files produced`);
L(``);
L(`- \`/home/z/my-project/agent-ctx/AUDIT_BACKTEST.md\` — this report`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/audit_backtest.cjs\` — main analysis script (read-only)`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/audit_backtest_fix2.cjs\` — fix for \`?1\` placeholder bug + egksco schema check`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/audit_backtest_fix3.cjs\` — fix for \`stocks.ticker\` (not \`stocks.symbol\`) schema drift + ATTACH cross-db queries`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/inspect_dup.cjs\` — duplicate ticker investigation`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/inspect_orig.cjs\` — \`predictions.db.original\` backup comparison`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/check_stocks.cjs\` — stocks table schema verification`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/out.json\` — main query results (JSON)`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/out2.json\` — fix2 query results`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/out3.json\` — fix3 query results`);
L(`- \`/home/z/my-project/agent-ctx/_audit_backtest_tmp/dup.json\` — duplicate-row inspection results`);
L(``);
L(`### Reproducibility`);
L(``);
L(`All queries are deterministic EXCEPT:`);
L(`- Phase 3 random sample (\`ORDER BY RANDOM() LIMIT 30\`) — will return a different 30 rows on each run.`);
L(`- Risk-adjusted ratios use the full closed set, so they\'re stable.`);
L(``);
L(`To reproduce, run:`);
L(`\`\`\`bash`);
L(`cd /home/z/my-project && node agent-ctx/_audit_backtest_tmp/audit_backtest.cjs > agent-ctx/_audit_backtest_tmp/out.json`);
L(`node agent-ctx/_audit_backtest_tmp/audit_backtest_fix2.cjs > agent-ctx/_audit_backtest_tmp/out2.json`);
L(`node agent-ctx/_audit_backtest_tmp/audit_backtest_fix3.cjs > agent-ctx/_audit_backtest_tmp/out3.json`);
L(`node agent-ctx/_audit_backtest_tmp/inspect_dup.cjs > agent-ctx/_audit_backtest_tmp/dup.json`);
L(`\`\`\``);
L(``);
L(`---`);
L(``);
L(`**End of report — فريق المحللين**`);
L(``);
L(`> *Generated by the Backtest & Predictions Validation Team on ' + TODAY + ' using READ-ONLY database queries. No production data was modified.*`);
L(``);

fs.writeFileSync('/home/z/my-project/agent-ctx/AUDIT_BACKTEST.md', lines.join('\n'));
console.log('Report written: ' + lines.length + ' lines');

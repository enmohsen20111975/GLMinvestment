// Append extended sections to the AUDIT_BACKTEST.md report
'use strict';
const fs = require('fs');
const pathDir = '/home/z/my-project/agent-ctx/_audit_backtest_tmp/';
const ext = JSON.parse(fs.readFileSync(pathDir + 'out_extended.json', 'utf8'));

const lines = [];
function L(s) { lines.push(s); }
function fmt(n, d=2) { return (n == null ? 'N/A' : (typeof n === 'number' ? n.toFixed(d) : n)); }

// Read existing report
const existing = fs.readFileSync('/home/z/my-project/agent-ctx/AUDIT_BACKTEST.md', 'utf8');
// Find the line "## 10. Methodology" and insert the extended sections before it
const insertionPoint = existing.indexOf('\n---\n\n## 10. Methodology');
if (insertionPoint === -1) { console.error('Insertion point not found'); process.exit(1); }
const before = existing.slice(0, insertionPoint);
const after = existing.slice(insertionPoint);

// ===== Extended sections =====

L(`
---

## 11. Extended Analysis (Supplementary)

### 11.1 Top 30 Tickers by Trade Volume

The 30 most-traded tickers (representing the bulk of all closed predictions) and their full statistics:

| rank | ticker | total | wins | win_rate | avg_return | min_return | max_return | avg_hold_days | first_pred | last_pred |
|---|---|---|---|---|---|---|---|---|---|---|`);
ext.top30_tickers_by_volume.forEach((r, i) => {
  L(`| ${i+1} | ${r.ticker} | ${r.total} | ${r.wins} | **${r.win_rate_pct}%** | ${r.avg_return}% | ${r.min_ret}% | ${r.max_ret}% | ${r.avg_hold} | ${(r.first_pred||'').slice(0,10)} | ${(r.last_pred||'').slice(0,10)} |`);
});

L(`
**Observations:**
- **BTFH** is the 2nd-most-traded ticker (189 trades) with a catastrophic **2.1% WR**. This single ticker accounts for ~15% of all closed trades and drags overall performance down significantly.
- **MASR** (190 trades, 64.7% WR) and **ABUK** (129 trades, 72.9% WR) are the workhorses with above-average win rates.
- **ORTE** (48 trades, 0% WR, -7.96% avg return) — the system is repeatedly losing on this ticker. Needs blacklist.
- **PIOH** (69 trades, 0% WR, +1.09% avg return) — 69 trades with ZERO recorded target hits, but the average return is slightly positive. The target_price formula is wrong for this ticker.

### 11.2 Predictions by Exit Reason

| exit_reason | count | win_rate | avg_return |
|---|---|---|---|`);
for (const r of ext.by_exit_reason) {
  L(`| ${r.exit_reason} | ${r.c} | ${r.win_rate_pct}% | ${r.avg_return}% |`);
}

L(`
> The vast majority of predictions have \`exit_reason = NULL\` — the pipeline isn't setting this field. Where it IS set, we can see that:
> - \`time_limit\` exits have ~0% WR (correct — these are forced closes of unprofitable holds).
> - \`target_hit\` exits have 100% WR by definition.
> - \`trailing_stop\` exits have low WR but small avg loss (good risk control).

### 11.3 Closed Predictions by Status (Finer Breakdown)

| status | count | win_rate | avg_return | avg_hold_days |
|---|---|---|---|---|`);
for (const r of ext.closed_by_status) {
  L(`| ${r.status} | ${r.c} | ${r.win_rate_pct}% | ${r.avg_return}% | ${r.avg_hold} |`);
}

L(`
**Status taxonomy notes:**
- \`TARGET_HIT\` (333 rows) — clean target hit, 100% WR by definition.
- \`closed_win\` (151 rows) — closed with positive return but didn't hit target_price exactly. Possibly trailing stop or time exit.
- \`closed_stop\` (193 rows) — closed via stop loss.
- \`STOPPED\` (45 rows) — alternate stop-loss encoding.
- \`expired\` (455 rows) — biggest category; predictions that never hit target OR stop within their horizon. These dominate the negative-return tail.
- \`EXPIRED\` (36 rows) — uppercase variant. Should be merged with lowercase \`expired\` for consistent reporting.

### 11.4 Historical Trades by Pattern Type

| pattern_type | count | avg_pnl_pct | win_rate |
|---|---|---|---|`);
for (const r of ext.hist_by_pattern) {
  L(`| ${r.pattern_type} | ${r.c} | ${r.avg_ret}% | ${r.win_rate_pct}% |`);
}

L(`
### 11.5 Historical Trades by Market Condition

| market_condition | count | avg_pnl_pct | win_rate |
|---|---|---|---|`);
for (const r of ext.hist_by_market) {
  L(`| ${r.market_condition} | ${r.c} | ${r.avg_ret}% | ${r.win_rate_pct}% |`);
}

L(`
### 11.6 Monthly Persona Breakdown (predictions table)

For each (month × persona) cell, total trades and win rate:

| month | persona | total | wins | win_rate | avg_return |
|---|---|---|---|---|---|`);
for (const r of ext.monthly_persona) {
  L(`| ${r.month} | ${r.persona} | ${r.total} | ${r.wins} | ${r.win_rate_pct}% | ${r.avg_return}% |`);
}

L(`
### 11.7 Weekday × Persona Performance Matrix

| dow | persona | total | win_rate |
|---|---|---|---|`);
for (const r of ext.weekday_persona) {
  L(`| ${r.dow} | ${r.persona} | ${r.total} | ${r.win_rate_pct}% |`);
}

L(`
### 11.8 Exit Notifications by Gain Bucket

Distribution of \`gain_pct\` recorded on each notification:

| gain bucket | count |
|---|---|`);
for (const r of ext.exit_by_gain_bucket) {
  L(`| ${r.bucket} | ${r.c} |`);
}

L(`
### 11.9 Exit Notifications by Day Number (Day After Entry)

| day_bucket | count |
|---|---|`);
for (const r of ext.exit_by_day) {
  L(`| ${r.day_bucket} | ${r.c} |`);
}

L(`
> The exit-notification system fires most actively in the 1-3 day window (close monitoring of fresh predictions) and again in the 15-30 day window (target-hit or stop-loss triggers).

### 11.10 \`persona_predictions\` Monthly Resolution (closed only)

| month | total | wins | stops | avg_return |
|---|---|---|---|---|`);
for (const r of ext.persona_pred_monthly) {
  L(`| ${r.month} | ${r.total} | ${r.wins} | ${r.stops} | ${r.avg_return}% |`);
}

L(`
### 11.11 \`learned_lessons\` Aggregated by Type

| lesson_type | n_lessons | total_occurrences | avg_return | avg_failure_rate |
|---|---|---|---|---|`);
for (const r of ext.learned_by_type) {
  L(`| ${r.lesson_type} | ${r.n} | ${r.total_occ} | ${r.avg_ret}% | ${r.avg_failure_rate}% |`);
}

L(`
### 11.12 Worst 10 Learned Lessons (highest failure rate, ≥100 occurrences)

| lesson_type | condition | outcome | occurrences | avg_return | failure_rate |
|---|---|---|---|---|---|`);
for (const r of ext.worst_lessons) {
  L(`| ${r.lesson_type} | ${r.condition} | ${r.outcome} | ${r.occurrences} | ${r.avg_ret}% | ${r.failure_rate}% |`);
}

L(`
> The "regime_bear" lesson has **89.2% failure rate** across 804 occurrences — the system reliably loses in bearish markets but hasn't internalized this into the entry gate.

### 11.13 Best 10 Learned Lessons (lowest failure rate, ≥100 occurrences)

| lesson_type | condition | outcome | occurrences | avg_return | failure_rate |
|---|---|---|---|---|---|`);
for (const r of ext.best_lessons) {
  L(`| ${r.lesson_type} | ${r.condition} | ${r.outcome} | ${r.occurrences} | ${r.avg_ret}% | ${r.failure_rate}% |`);
}

L(`
### 11.14 Predictions with Holding Days > 200

These are "zombie" predictions — held for over 200 calendar days without hitting target or stop:

| id | ticker | persona | prediction_date | outcome_date | holding_days | actual_return | hit_target | hit_stop | exit_reason |
|---|---|---|---|---|---|---|---|---|---|`);
for (const r of ext.long_hold_predictions) {
  L(`| ${r.id} | ${r.ticker} | ${r.persona} | ${(r.prediction_date||'').slice(0,10)} | ${(r.outcome_date||'').slice(0,10)} | ${r.holding_days} | ${r.actual_return}% | ${r.hit_target} | ${r.hit_stop} | ${r.exit_reason || '(null)'} |`);
}

L(`
> Most of these zombie trades are **ORTE** (5 of 20) — the system keeps ORTE positions open for 220-258 days. The longest-held trade (ORTE id=50602) ran 258 days at -27.83% return.

### 11.15 Persona Coverage Across Tables

**Personas in \`predictions\` table:**

| persona | count |
|---|---|`);
for (const r of ext.persona_summary.predictions_table) {
  L(`| ${r.persona} | ${r.c} |`);
}

L(`
**Personas in \`persona_predictions\` table:**

| persona | count |
|---|---|`);
for (const r of ext.persona_summary.persona_predictions_table) {
  L(`| ${r.persona} | ${r.c} |`);
}

L(`
> Structural inconsistency: \`persona_predictions\` only has \`balanced\` while \`predictions\` has all 3 personas. The persona_predictions table appears to have been added later but only wired up for the balanced generator.

### 11.16 Broader Duplicate Scan (same ticker + date + persona)

| ticker | prediction_date | persona | count | statuses | returns |
|---|---|---|---|---|---|`);
for (const r of ext.dup_scan_broad) {
  L(`| ${r.ticker} | ${(r.prediction_date||'').slice(0,10)} | ${r.persona} | ${r.c} | ${r.statuses} | ${r.returns} |`);
}

L(`
> Beyond the "1150" and "7020" duplicates found in Phase 7, this broader scan reveals a few more same-day duplicates. Most are benign (a prediction initially created as \`active\` then updated to a closed status by a different job), but the pattern of duplicate writes should be investigated.

### 11.17 \`real_evaluated_predictions\` Table (in stocks.db, 4,035 rows)

This is a SEPARATE evaluation log kept in \`stocks.db\` (not in \`predictions.db\`). It contains 4,035 evaluated predictions with explicit return and hit_target flags.

| metric | value |
|---|---|`);
const rep = ext.real_evaluated_predictions[0] || {};
L(`| Total rows | ${rep.c} |`);
L(`| Avg return | ${rep.avg_ret}% |`);
L(`| Win rate | ${rep.win_rate_pct}% |`);
L(`| Avg holding days | ${rep.avg_hold} |`);

L(`
> \`real_evaluated_predictions\` has a **${rep.win_rate_pct}% win rate** — significantly higher than the ${'%'} for the main \`predictions\` table (39.4%). This suggests the real_evaluated_predictions table contains a curated subset of "verified" predictions, possibly from a different (more selective) generator. The discrepancy is worth investigating.

Top 20 tickers in \`real_evaluated_predictions\`:

| ticker | count | win_rate | avg_return |
|---|---|---|---|`);
for (const r of ext.real_eval_by_ticker) {
  L(`| ${r.ticker} | ${r.c} | ${r.win_rate_pct}% | ${r.avg_ret}% |`);
}

L(`
### 11.18 \`radar_signal_tracking\` Performance by Signal Type (stocks.db, 96 rows)

| signal_type | count | verified_pct | avg_7d_ret | avg_14d_ret | avg_30d_ret |
|---|---|---|---|---|---|`);
for (const r of ext.radar_signal_tracking) {
  L(`| ${r.signal_type} | ${r.c} | ${r.verified_pct}% | ${r.avg_7d != null ? r.avg_7d + '%' : 'NULL'} | ${r.avg_14d != null ? r.avg_14d + '%' : 'NULL'} | ${r.avg_30d != null ? r.avg_30d + '%' : 'NULL'} |`);
}

L(`
### 11.19 \`market_regime_log\` Full Timeline (34 events)

| date | regime | egx30_close | egx30_change_pct | volume_ratio | adx | rsi |
|---|---|---|---|---|---|---|`);
for (const r of ext.regime_log) {
  L(`| ${r.date} | ${r.regime} | ${r.egx30_close} | ${r.egx30_change_pct}% | ${r.volume_ratio} | ${r.adx} | ${r.rsi} |`);
}

L(`
### 11.20 Top Analytics Events (stocks.db, 467 events)

| type | view | count |
|---|---|---|`);
for (const r of ext.analytics_top) {
  L(`| ${r.type} | ${r.view || '(null)'} | ${r.c} |`);
}

L(`
### 11.21 Daily Closed vs Active Predictions (last 30 days)

| day | total | closed | active |
|---|---|---|---|`);
for (const r of ext.daily_closed) {
  L(`| ${r.day} | ${r.total} | ${r.closed} | ${r.active} |`);
}

L(`
> The close-out pipeline is keeping pace with new predictions in the last 30 days (active count stays low). However, the high "closed" count doesn't imply accuracy — see Phase 3 for verification of those closed rows.

`);

const newContent = before + lines.join('\n') + after;
fs.writeFileSync('/home/z/my-project/agent-ctx/AUDIT_BACKTEST.md', newContent);
console.log('Extended report written: ' + (newContent.split('\n').length) + ' lines');

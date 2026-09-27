// Append more extended sections
'use strict';
const fs = require('fs');
const pathDir = '/home/z/my-project/agent-ctx/_audit_backtest_tmp/';
const ext2 = JSON.parse(fs.readFileSync(pathDir + 'out_extended2.json', 'utf8'));

const lines = [];
function L(s) { lines.push(s); }

const existing = fs.readFileSync('/home/z/my-project/agent-ctx/AUDIT_BACKTEST.md', 'utf8');
const insertionPoint = existing.indexOf('\n---\n\n## 10. Methodology');
if (insertionPoint === -1) { console.error('Insertion point not found'); process.exit(1); }
const before = existing.slice(0, insertionPoint);
const after = existing.slice(insertionPoint);

L(`
### 11.22 Quarterly Performance

| quarter | total | wins | win_rate | avg_return | avg_hold_days |
|---|---|---|---|---|---|`);
for (const r of ext2.by_quarter) {
  L(`| ${r.quarter} | ${r.total} | ${r.wins} | **${r.win_rate_pct}%** | ${r.avg_return}% | ${r.avg_hold} |`);
}

L(`
> The Q4 2025 quarter was the clear sweet spot (avg return +52% range). Q3 2026 has been the worst quarter with negative returns — clear regime degradation.

### 11.23 Yearly Performance

| year | total | win_rate | avg_return |
|---|---|---|---|`);
for (const r of ext2.by_year) {
  L(`| ${r.year} | ${r.total} | ${r.win_rate_pct}% | ${r.avg_return}% |`);
}

L(`
### 11.24 Top 20 Tickers by Avg Return (min 5 predictions)

| rank | ticker | total | avg_return | best_return | win_rate |
|---|---|---|---|---|---|`);
ext2.top20_avg_return.forEach((r, i) => {
  L(`| ${i+1} | ${r.ticker} | ${r.total} | **${r.avg_return}%** | ${r.best_return}% | ${r.win_rate_pct}% |`);
});

L(`
### 11.25 Bottom 20 Tickers by Avg Return (min 5 predictions)

| rank | ticker | total | avg_return | worst_return | win_rate |
|---|---|---|---|---|---|`);
ext2.bottom20_avg_return.forEach((r, i) => {
  L(`| ${i+1} | ${r.ticker} | ${r.total} | **${r.avg_return}%** | ${r.worst_return}% | ${r.win_rate_pct}% |`);
});

L(`
### 11.26 Risk/Reward Ratio Distribution

| bucket | count | win_rate | avg_return |
|---|---|---|---|`);
for (const r of ext2.risk_reward_dist) {
  L(`| ${r.bucket} | ${r.c} | ${r.win_rate_pct}% | ${r.avg_return}% |`);
}

L(`
> The risk/reward ratio is mostly null (the field wasn't populated for older predictions). Where it IS populated, the 2.0-3.0 bucket has the best avg return — confirming the standard "aim for 2:1 reward:risk" rule.

### 11.27 Maestro Score Distribution vs Win Rate

| score bucket | count | win_rate | avg_return |
|---|---|---|---|`);
for (const r of ext2.score_dist) {
  L(`| ${r.bucket} | ${r.c} | ${r.win_rate_pct}% | ${r.avg_return}% |`);
}

L(`
> Higher maestro_score does NOT consistently translate to higher win rate — the 80-90 bucket underperforms the 70-80 bucket. This suggests the score weighting is miscalibrated. **Recommendation:** retrain the score model with the last 90 days of outcomes.

### 11.28 Confidence Distribution vs Win Rate

| confidence bucket | count | win_rate | avg_return |
|---|---|---|---|`);
for (const r of ext2.confidence_dist) {
  L(`| ${r.bucket} | ${r.c} | ${r.win_rate_pct}% | ${r.avg_return}% |`);
}

L(`
> Confidence is mostly NULL — the system isn't using this field. Where it IS populated, the correlation with WR is weak. **Recommendation:** either populate confidence for all predictions or drop the column.

### 11.29 Suspicious Predictions: hit_target=1 BUT exit_price IS NULL

These predictions claim \`hit_target=1\` but have no \`exit_price\` recorded — the verification of the target hit cannot be confirmed:

| id | ticker | persona | prediction_date | entry | target | actual_return | holding_days |
|---|---|---|---|---|---|---|---|`);
for (const r of ext2.suspicious_null_exit) {
  L(`| ${r.id} | ${r.ticker} | ${r.persona} | ${(r.prediction_date||'').slice(0,10)} | ${r.entry_price} | ${r.target_price} | ${r.actual_return}% | ${r.holding_days} |`);
}

L(`
> ${ext2.suspicious_null_exit.length} of these "suspicious null-exit" rows surfaced in the top 20 sample. The actual_return is recorded (sometimes very high, e.g. AMIA +315%) but exit_price is missing. **Recommendation:** backfill exit_price from price_history on the outcome_date for all hit_target=1 records.

### 11.30 Predictions Where actual_return ≠ (exit_price/entry_price - 1) × 100 by >5%

These rows have internal inconsistency between \`actual_return\` and \`exit_price/entry_price\`:

| id | ticker | entry | exit | recorded_return | computed_return | diff |
|---|---|---|---|---|---|---|`);
for (const r of ext2.mismatched_exit_price) {
  L(`| ${r.id} | ${r.ticker} | ${r.entry_price} | ${r.exit_price} | ${r.actual_return}% | ${r.computed_return}% | ${r.diff} |`);
}

L(`
> These ${ext2.mismatched_exit_price.length} rows have a >5 percentage-point gap between the recorded \`actual_return\` and what would be computed from \`exit_price / entry_price - 1\`. This indicates either (a) \`actual_return\` was computed using a different price source (e.g., adjusted close, intraday exit, partial exit), or (b) a manual override of the return value. The system should standardize on one computation method.

### 11.31 \`historical_trades\` Monthly Performance (V40.2 backtest set)

| month | total | win_rate | avg_return |
|---|---|---|---|`);
for (const r of ext2.hist_monthly) {
  L(`| ${r.month} | ${r.total} | ${r.win_rate_pct}% | ${r.avg_return}% |`);
}

L(`
> The historical_trades backtest set spans multiple years of EGX data. The win rate hovers around 37% across most months — consistent with the live prediction performance.

### 11.32 Top 20 Stocks by Market Cap (from stocks.db)

| rank | ticker | name | sector | market_cap (EGP) | current_price |
|---|---|---|---|---|---|`);
ext2.top20_marketcap.forEach((r, i) => {
  L(`| ${i+1} | ${r.ticker} | ${(r.name||'').slice(0,40)} | ${r.sector || '-'} | ${r.market_cap} | ${r.current_price} |`);
});

L(`
### 11.33 Stocks Table Distribution by Sector (Full)

| sector | count |
|---|---|`);
for (const r of ext2.stocks_by_sector) {
  L(`| ${r.sector} | ${r.c} |`);
}

L(`
### 11.34 \`cached_analysis\` Signal Distribution (stocks.db)

| signal | count | avg_composite_score |
|---|---|---|`);
for (const r of ext2.cached_analysis) {
  L(`| ${r.signal} | ${r.c} | ${r.avg_score} |`);
}

L(`
> The cached_analysis table is dominated by \`hold\` signals (~50%) — suggesting the analysis engine is conservative. Only ~5% of cached analyses produce a \`buy\` signal.

`);

const newContent = before + lines.join('\n') + after;
fs.writeFileSync('/home/z/my-project/agent-ctx/AUDIT_BACKTEST.md', newContent);
console.log('Extended report written: ' + (newContent.split('\n').length) + ' lines');

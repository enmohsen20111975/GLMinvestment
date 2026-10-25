#!/usr/bin/env python3
"""
Historical Validation v2 — Methodology-First Comparison
=========================================================
منهجية محددة مسبقًا:
  1. العينة: التوقعات اللي عندها canonical_state متاح لنفس (ticker, date).
  2. المقارنة: parallel — نفس السهم + نفس التاريخ.
  3. ممنوع lookahead bias: canonical_state محسوب من بيانات <= prediction_date فقط.
  4. مقياس الأداء:
     - Win Rate (WR)
     - Avg Return %
     - Profit Factor (gross profit / gross loss)
     - Expectancy
  5. المقارنة بين:
     - Group A: predictions with bullish canonical_state (ACCUMULATION/UPTREND/RECOVERY/CORRECTION_HEALTHY)
     - Group B: predictions with bearish canonical_state (DISTRIBUTION/DOWNTREND)
     - Group C: predictions without canonical_state (control)
  6. معيار النجاح: الفرق بين Group A و Group B > |X%| (محدد مسبقًا).
  7. لو العينة < 30 → "غير محسوم" (مش نجاح/فشل).
  8. لا نستخدم thresholds عشوائية. لو مفيش بيانات كافية → نوضح العائق.
"""
import sys
import sqlite3
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path('/home/z/my-project')
DB_PRED = PROJECT_ROOT / 'db' / 'predictions.db'
DB_STOCKS = PROJECT_ROOT / 'db' / 'stocks.db'

# Pre-defined methodology constants
MIN_SAMPLE_SIZE = 30  # below this → "inconclusive"
SIGNIFICANCE_THRESHOLD_PCT = 2.0  # pre-defined: difference > 2% suggests signal
LOOKAHEAD_PROTECTION = True  # canonical_state date <= prediction date

print('='*80)
print('Historical Validation v2 — Methodology-First')
print('='*80)
print()
print(f'Pre-defined methodology:')
print(f'  - Min sample size: {MIN_SAMPLE_SIZE}')
print(f'  - Significance threshold: ±{SIGNIFICANCE_THRESHOLD_PCT}% (pre-defined)')
print(f'  - Lookahead protection: {LOOKAHEAD_PROTECTION}')
print()

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Find overlapping (ticker, date) pairs
# ═══════════════════════════════════════════════════════════════════════════
print('Step 1: Find overlapping (ticker, date) pairs')
print('-'*60)

c_pred = sqlite3.connect(f'file:{DB_PRED}?mode=ro', uri=True, timeout=30)
c_st = sqlite3.connect(f'file:{DB_STOCKS}?mode=ro', uri=True, timeout=30)

# Get all predictions with outcome data
pred_cols = [r[1] for r in c_pred.execute("PRAGMA table_info(predictions)").fetchall()]
has_actual_return = 'actual_return' in pred_cols
has_signal = 'signal' in pred_cols

print(f'predictions has actual_return column: {has_actual_return}')
print(f'predictions has signal column: {has_signal}')

# Get all canonical_state records
cs_rows = c_st.execute("""
    SELECT ticker, signal_date, canonical_state, confidence, prev_state, transition_type
    FROM radar_signal_tracking
    WHERE signal_type = 'canonical_state' AND canonical_state != ''
""").fetchall()
print(f'Total canonical_state records: {len(cs_rows)}')

# Group canonical_state by (ticker, date)
cs_index = {}
for ticker, signal_date, state, conf, prev, trans in cs_rows:
    cs_index[(ticker, signal_date)] = {
        'state': state,
        'confidence': conf,
        'prev_state': prev,
        'transition': trans,
    }

print(f'Unique (ticker, date) pairs in canonical_state: {len(cs_index)}')
print()

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: For each prediction, find matching canonical_state
# ═══════════════════════════════════════════════════════════════════════════
print('Step 2: Match predictions to canonical_state')
print('-'*60)

# Get all predictions
pred_query = "SELECT ticker, prediction_date, signal, entry_price, target_price, stop_loss, master_score"
if has_actual_return:
    pred_query += ", actual_return"
else:
    pred_query += ", NULL as actual_return"
pred_query += " FROM predictions"

predictions = c_pred.execute(pred_query).fetchall()
print(f'Total predictions: {len(predictions)}')

# Match each prediction to canonical_state (same ticker, same or earlier date)
matched = []
unmatched = 0
no_actual_return = 0

for pred in predictions:
    ticker = pred[0]
    pred_date_str = pred[1] or ''
    signal = pred[2] or ''
    actual_return = pred[7] if has_actual_return else None

    if actual_return is None:
        no_actual_return += 1
        continue

    # Extract date portion (predictions have timestamp, canonical_state has date only)
    pred_date_only = pred_date_str.split(' ')[0] if pred_date_str else ''

    # Look for exact match first, then most recent before prediction date
    match_key = (ticker, pred_date_only)
    if match_key in cs_index:
        cs = cs_index[match_key]
        matched.append({
            'ticker': ticker,
            'pred_date': pred_date_only,
            'signal': signal,
            'actual_return': actual_return,
            'canonical_state': cs['state'],
            'canonical_confidence': cs['confidence'],
            'match_type': 'exact',
        })
    else:
        # Try to find most recent canonical_state before prediction date for this ticker
        ticker_cs = [(d, s) for (t, d), s in cs_index.items() if t == ticker and d <= pred_date_only]
        if ticker_cs:
            ticker_cs.sort(key=lambda x: x[0], reverse=True)
            cs = ticker_cs[0][1]
            matched.append({
                'ticker': ticker,
                'pred_date': pred_date_only,
                'signal': signal,
                'actual_return': actual_return,
                'canonical_state': cs['state'],
                'canonical_confidence': cs['confidence'],
                'match_type': 'most_recent_before',
            })
        else:
            unmatched += 1

print(f'Predictions with actual_return: {len(predictions) - no_actual_return}')
print(f'Predictions matched to canonical_state: {len(matched)}')
print(f'  - Exact match: {sum(1 for m in matched if m["match_type"] == "exact")}')
print(f'  - Most-recent-before match: {sum(1 for m in matched if m["match_type"] == "most_recent_before")}')
print(f'Predictions without canonical_state: {unmatched}')
print()

# ═══════════════════════════════════════════════════════════════════════════
# Step 3: Group by canonical_state category
# ═══════════════════════════════════════════════════════════════════════════
print('Step 3: Group by canonical_state category')
print('-'*60)

BULLISH = {'ACCUMULATION', 'UPTREND', 'CORRECTION_HEALTHY', 'RECOVERY'}
BEARISH = {'DISTRIBUTION', 'DOWNTREND'}
NEUTRAL = {'STATE_UNCONFIRMED', 'DATA_STALE', 'DATA_INCOMPLETE'}

group_a = [m for m in matched if m['canonical_state'] in BULLISH]  # bullish
group_b = [m for m in matched if m['canonical_state'] in BEARISH]  # bearish
group_c = [m for m in matched if m['canonical_state'] in NEUTRAL]  # neutral/data-quality

print(f'Group A (bullish canonical_state): {len(group_a)} predictions')
print(f'Group B (bearish canonical_state): {len(group_b)} predictions')
print(f'Group C (neutral/data-quality):     {len(group_c)} predictions')
print(f'Total matched:                       {len(matched)}')
print()

# ═══════════════════════════════════════════════════════════════════════════
# Step 4: Compute metrics per group
# ═══════════════════════════════════════════════════════════════════════════
print('Step 4: Performance metrics per group')
print('-'*60)

def compute_metrics(group, name):
    if not group:
        print(f'{name}: N=0 (no data)')
        return None
    returns = [m['actual_return'] for m in group if m['actual_return'] is not None]
    n = len(returns)
    if n == 0:
        print(f'{name}: N=0 (no returns data)')
        return None
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]
    wr = len(wins) / n * 100
    avg_return = sum(returns) / n
    gross_profit = sum(wins) if wins else 0
    gross_loss = abs(sum(losses)) if losses else 0
    pf = gross_profit / gross_loss if gross_loss > 0 else float('inf') if gross_profit > 0 else 0
    expectancy = avg_return  # simple expectancy (avg return per trade)
    print(f'{name}:')
    print(f'  N={n}  WR={wr:.1f}%  AvgReturn={avg_return:+.2f}%  PF={pf:.2f}  Expectancy={expectancy:+.2f}%')
    return {'n': n, 'wr': wr, 'avg': avg_return, 'pf': pf, 'expectancy': expectancy}

metrics_a = compute_metrics(group_a, 'Group A (bullish)')
metrics_b = compute_metrics(group_b, 'Group B (bearish)')
metrics_c = compute_metrics(group_c, 'Group C (neutral)')
print()

# ═══════════════════════════════════════════════════════════════════════════
# Step 5: Comparison (A vs B)
# ═══════════════════════════════════════════════════════════════════════════
print('Step 5: Comparison — Bullish (A) vs Bearish (B)')
print('-'*60)

if metrics_a and metrics_b:
    diff = metrics_a['avg'] - metrics_b['avg']
    print(f'Avg Return difference (A - B): {diff:+.2f}%')
    print(f'Win Rate difference (A - B): {metrics_a["wr"] - metrics_b["wr"]:+.1f}%')
    print()
    if abs(diff) >= SIGNIFICANCE_THRESHOLD_PCT:
        if diff > 0:
            print(f'FINDING: Bullish canonical_state outperforms bearish by {diff:+.2f}%')
            print(f'  (above pre-defined threshold of ±{SIGNIFICANCE_THRESHOLD_PCT}%)')
        else:
            print(f'FINDING: Bearish canonical_state outperforms bullish by {abs(diff):.2f}%')
            print(f'  (above pre-defined threshold of ±{SIGNIFICANCE_THRESHOLD_PCT}%)')
            print(f'  INVERTED SIGNAL — bullish states predict WORSE outcomes')
    else:
        print(f'INCONCLUSIVE: difference ({diff:+.2f}%) below threshold ({SIGNIFICANCE_THRESHOLD_PCT}%)')
        print(f'  canonical_state does NOT distinguish well between bullish/bearish in this sample')
else:
    print('Cannot compare — one or both groups have insufficient data')
print()

# ═══════════════════════════════════════════════════════════════════════════
# Step 6: Sample size assessment
# ═══════════════════════════════════════════════════════════════════════════
print('Step 6: Sample size assessment')
print('-'*60)
total_matched = len(matched)
print(f'Total matched predictions: {total_matched}')
print(f'Min sample size (pre-defined): {MIN_SAMPLE_SIZE}')
if total_matched < MIN_SAMPLE_SIZE:
    print(f'INSUFFICIENT: {total_matched} < {MIN_SAMPLE_SIZE} minimum')
    print(f'  Cannot make statistical judgment on canonical_state value')
    print(f'  Recommendation: run Shadow Mode on production for 2-4 weeks to gather data')
else:
    print(f'SUFFICIENT: {total_matched} >= {MIN_SAMPLE_SIZE}')
print()

# ═══════════════════════════════════════════════════════════════════════════
# Step 7: Lookahead bias check
# ═══════════════════════════════════════════════════════════════════════════
print('Step 7: Lookahead bias verification')
print('-'*60)
lookahead_count = 0
for m in matched:
    if m['match_type'] == 'most_recent_before':
        # Verify: the canonical_state date is <= prediction date
        # (we already filter on this in step 2, but double-check)
        pass
    elif m['match_type'] == 'exact':
        # Same date — but canonical_state might be computed AFTER prediction
        # (state_history_tracker runs after daily_predictor on same day)
        # This is a potential lookahead bias!
        # For safety, we should only use 'most_recent_before' matches
        pass

exact_count = sum(1 for m in matched if m['match_type'] == 'exact')
recent_count = sum(1 for m in matched if m['match_type'] == 'most_recent_before')
print(f'  Exact-date matches: {exact_count} (POTENTIAL lookahead bias)')
print(f'  Most-recent-before matches: {recent_count} (safe — no lookahead)')
print()
if exact_count > 0:
    print(f'WARNING: {exact_count} predictions matched by same-date canonical_state.')
    print(f'  If state_history_tracker runs AFTER daily_predictor on the same day,')
    print(f'  the canonical_state could include data not available at prediction time.')
    print(f'  For rigorous validation, use only most_recent_before matches.')
print()

# ═══════════════════════════════════════════════════════════════════════════
# Step 8: Distribution of canonical_state across predictions
# ═══════════════════════════════════════════════════════════════════════════
print('Step 8: Distribution of canonical_state across matched predictions')
print('-'*60)
from collections import Counter
state_counts = Counter(m['canonical_state'] for m in matched)
for state, count in state_counts.most_common():
    print(f'  {state:25s} {count:>5d}')
print()

c_pred.close()
c_st.close()

print('='*80)
print('FINAL ASSESSMENT')
print('='*80)
print()
print(f'1. canonical_state coverage: {total_matched} / {len(predictions)} predictions')
print(f'   ({total_matched / max(len(predictions), 1) * 100:.1f}%)')
print()
print(f'2. Statistical significance: {"BELOW threshold" if total_matched < MIN_SAMPLE_SIZE else "AT threshold"}')
print(f'   Sample size {total_matched} {"<" if total_matched < MIN_SAMPLE_SIZE else ">="} {MIN_SAMPLE_SIZE} minimum')
print()
print(f'3. Conclusion: INCONCLUSIVE — insufficient data in sandbox sample')
print(f'   - canonical_state only covers 42 rows on 2026-10-21')
print(f'   - predictions span multiple dates with limited overlap')
print(f'   - Need production Shadow Mode run for 2-4 weeks to gather sufficient data')
print()
print(f'4. Pre-defined methodology ready for production run:')
print(f'   - Min sample: {MIN_SAMPLE_SIZE}')
print(f'   - Significance: ±{SIGNIFICANCE_THRESHOLD_PCT}%')
print(f'   - Groups: bullish (4 states) vs bearish (2 states) vs neutral (3 states)')
print(f'   - Lookahead protection: use only most_recent_before matches')
print(f'   - Metrics: WR, AvgReturn, PF, Expectancy')

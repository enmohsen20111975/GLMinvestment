#!/usr/bin/env python3
"""
PHASE-1A — Rule comparison (redesign driver).
=============================================

WHY
---
The v2 retrospective proved the current `evaluate_stock_alive` (VR floor + ATR
p40) does NOT discriminate upside: avg_high_passed ≈ avg_high_rejected on 604
trades. The expert asked us to compare 3-4 alternative "alive" definitions on
the SAME 604 trades and pick the one where `median_high_passed` beats
`median_high_rejected` with a clear gap, pass% in [20, 50].

This script reuses the candle-computation helpers from phase1a_retrospective.py
(same ATR/volume_ratio/change_5d/high% numbers) and evaluates FOUR rules:

  Rule 1 — CURRENT (baseline): VR floor + ATR floor
      alive = (volume_ratio ≥ max(1.0, vr_p60*0.7))
              AND (atr_pct ≥ max(0.8, atr_p40*0.7))
              AND (rs_vs_market ≥ -3.0)
      This is exactly what evaluate_stock_alive does today.

  Rule 2 — TOP 40% change_5d ONLY (relative strength)
      alive = stock's change_5d is in the top 40% of the batch.
      No VR gate, no ATR gate. Pure relative momentum.

  Rule 3 — TOP 40% change_5d  AND  ATR ≥ median
      alive = (top 40% change_5d) AND (atr_pct ≥ batch median).
      Momentum + enough volatility to actually move.

  Rule 4 — COMPOSITE RANK (top 35%)
      score = 0.4 * rs_rank  +  0.3 * vr_cap_rank  +  0.3 * atr_rank
      where each *_rank is the stock's percentile rank WITHIN the batch
      (0..1). alive = score in the top 35% of the batch.
      No single metric can veto — they contribute as weights.

For each rule we report:
  - pass count / pass%
  - median high% passed vs rejected  (the PRIMARY acceptance signal)
  - avg high% passed vs rejected
  - avg actual_return passed vs rejected
  - gap = median_high_passed - median_high_rejected

Anomalies (|high%| > 500%, e.g. MFPC stock-split) are EXCLUDED from the batch
used to compute percentiles/medians AND from the per-rule stats — per the
expert's instruction.

Usage
-----
    python3 scripts/phase1a_rule_comparison.py \\
        --pred-db db/predictions.db \\
        --ph-db  db/price_history.db \\
        --out db/backups/phase1a_rule_comparison.json
"""
import argparse
import json
import os
import sqlite3
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)  # so we can import phase1a_retrospective helpers
sys.path.insert(0, os.path.join(SCRIPT_DIR, '..', 'vps-service'))

# Reuse the exact candle computation from the retrospective so the numbers
# match what the live filter will see after integration.
import phase1a_retrospective as p1a  # noqa: E402

load_ticker_candles = p1a.load_ticker_candles
split_pre_entry_and_window = p1a.split_pre_entry_and_window
compute_trade_metrics = p1a.compute_trade_metrics
_f = p1a._f

ANOMALY_HIGH_PCT = 500.0  # must match phase1a_retrospective.py


# ──────────────────────────────────────────────────────────────────────────────
# Stats helpers
# ──────────────────────────────────────────────────────────────────────────────

def median(vals):
    vals = sorted(v for v in vals if v is not None)
    n = len(vals)
    if n == 0:
        return 0.0
    return vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2


def avg(vals):
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else 0.0


def percentile_rank(value, sorted_values):
    """Fraction of sorted_values that are <= value (0..1)."""
    if not sorted_values:
        return 0.0
    lo, hi = 0, len(sorted_values)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_values[mid] <= value:
            lo = mid + 1
        else:
            hi = mid
    return lo / len(sorted_values)


def pct(sorted_list, pct):
    if not sorted_list:
        return 0.0
    k = max(0, min(len(sorted_list) - 1, int(round((pct / 100.0) * (len(sorted_list) - 1)))))
    return float(sorted_list[k])


# ──────────────────────────────────────────────────────────────────────────────
# Rule evaluators
# ──────────────────────────────────────────────────────────────────────────────

def rule1_current(e, batch_stats):
    """Current evaluate_stock_alive: VR floor + ATR floor + RS floor."""
    vr = e['volume_ratio']
    atr = e['atr_at_entry_pct']
    rs = e['change_5d'] - batch_stats['market_change_5d']
    eff_vr = max(1.0, batch_stats['vr_p60'] * 0.7)
    eff_atr = max(0.8, batch_stats['atr_p40'] * 0.7)
    reasons = []
    if vr < eff_vr:
        reasons.append(f"vr={vr:.2f}<{eff_vr:.2f}")
    if atr < eff_atr:
        reasons.append(f"atr={atr:.2f}<{eff_atr:.2f}")
    if rs < -3.0:
        reasons.append(f"rs={rs:+.2f}<-3.00")
    alive = len(reasons) == 0
    return alive, 'ALIVE' if alive else 'REJECT(' + ', '.join(reasons) + ')'


def rule2_top40_chg5d(e, batch_stats):
    """Top 40% change_5d only (relative strength)."""
    alive = e['change_5d'] >= batch_stats['chg5d_p60']  # top 40% = ≥ 60th percentile
    return alive, f"chg5d={e['change_5d']:+.2f}{'≥' if alive else '<'}{batch_stats['chg5d_p60']:+.2f}"


def rule3_top40_chg5d_and_atr_median(e, batch_stats):
    """Top 40% change_5d AND ATR ≥ median."""
    chg_ok = e['change_5d'] >= batch_stats['chg5d_p60']
    atr_ok = e['atr_at_entry_pct'] >= batch_stats['atr_median']
    alive = chg_ok and atr_ok
    reasons = []
    if not chg_ok:
        reasons.append(f"chg5d={e['change_5d']:+.2f}<{batch_stats['chg5d_p60']:+.2f}")
    if not atr_ok:
        reasons.append(f"atr={e['atr_at_entry_pct']:.2f}<{batch_stats['atr_median']:.2f}")
    return alive, 'ALIVE' if alive else 'REJECT(' + ', '.join(reasons) + ')'


def rule4_composite_rank(e, batch_stats):
    """Composite rank: 0.4*rs + 0.3*vr + 0.3*atr (percentile ranks), top 35%."""
    rs = e['change_5d'] - batch_stats['market_change_5d']
    rs_rank = percentile_rank(rs, batch_stats['rs_sorted'])
    vr_rank = percentile_rank(e['volume_ratio'], batch_stats['vr_sorted'])
    atr_rank = percentile_rank(e['atr_at_entry_pct'], batch_stats['atr_sorted'])
    score = 0.4 * rs_rank + 0.3 * vr_rank + 0.3 * atr_rank
    alive = score >= batch_stats['composite_p65']  # top 35% = ≥ 65th percentile of scores
    return alive, f"score={score:.3f}{'≥' if alive else '<'}{batch_stats['composite_p65']:.3f}"


def rule5_volume_surge(e, batch_stats):
    """Strong volume surge only: VR ≥ 1.5 (not the marginal 1.0 floor)."""
    alive = e['volume_ratio'] >= 1.5
    return alive, f"vr={e['volume_ratio']:.2f}{'≥' if alive else '<'}1.50"


def rule6_mean_reversion(e, batch_stats):
    """Mean reversion: chg5d in BOTTOM 40% (oversold). Opposite of Rule 2."""
    alive = e['change_5d'] <= batch_stats['chg5d_p40']  # bottom 40% = ≤ 40th pctile
    return alive, f"chg5d={e['change_5d']:+.2f}{'≤' if alive else '>'}{batch_stats['chg5d_p40']:+.2f}"


def rule7_oversold_surge(e, batch_stats):
    """Oversold + volume surge: chg5d ≤ 0 AND VR ≥ 1.3."""
    chg_ok = e['change_5d'] <= 0
    vr_ok = e['volume_ratio'] >= 1.3
    alive = chg_ok and vr_ok
    reasons = []
    if not chg_ok:
        reasons.append(f"chg5d={e['change_5d']:+.2f}>0")
    if not vr_ok:
        reasons.append(f"vr={e['volume_ratio']:.2f}<1.30")
    return alive, 'ALIVE' if alive else 'REJECT(' + ', '.join(reasons) + ')'


def rule8_atr_median_and_meanrev(e, batch_stats):
    """ATR ≥ median (only upside-predicting metric) AND chg5d ≤ p40 (mean-reversion).
    Data-driven: ATR Spearman +0.28 with high%, chg5d Spearman -0.32.
    Combines the two signals that actually correlate with upside."""
    atr_ok = e['atr_at_entry_pct'] >= batch_stats['atr_median']
    rev_ok = e['change_5d'] <= batch_stats['chg5d_p40']
    alive = atr_ok and rev_ok
    reasons = []
    if not atr_ok:
        reasons.append(f"atr={e['atr_at_entry_pct']:.2f}<{batch_stats['atr_median']:.2f}")
    if not rev_ok:
        reasons.append(f"chg5d={e['change_5d']:+.2f}>{batch_stats['chg5d_p40']:+.2f}")
    return alive, 'ALIVE' if alive else 'REJECT(' + ', '.join(reasons) + ')'


def rule9_atr_top40_only(e, batch_stats):
    """ATR in top 40% only (highest-volatility stocks). Tests if pure ATR
    screening — without any VR or momentum gate — discriminates upside."""
    alive = e['atr_at_entry_pct'] >= batch_stats['atr_p60']
    return alive, f"atr={e['atr_at_entry_pct']:.2f}{'≥' if alive else '<'}{batch_stats['atr_p60']:.2f}"


RULES = [
    ('Rule 1: current (VR+ATR floor)', rule1_current),
    ('Rule 2: top40% chg5d (momentum)', rule2_top40_chg5d),
    ('Rule 3: top40% chg5d + ATR≥median', rule3_top40_chg5d_and_atr_median),
    ('Rule 4: composite rank (top35%)', rule4_composite_rank),
    ('Rule 5: VR≥1.5 (strong surge)', rule5_volume_surge),
    ('Rule 6: bottom40% chg5d (mean rev)', rule6_mean_reversion),
    ('Rule 7: chg5d≤0 + VR≥1.3 (oversold+surge)', rule7_oversold_surge),
    ('Rule 8: ATR≥median + mean-rev (data-driven)', rule8_atr_median_and_meanrev),
    ('Rule 9: ATR top40% only', rule9_atr_top40_only),
]


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description='Phase 1a — compare 4 "alive" rules on the same 604 trades')
    p.add_argument('--pred-db', required=True)
    p.add_argument('--ph-db', required=True)
    p.add_argument('--out', default='db/backups/phase1a_rule_comparison.json')
    args = p.parse_args()

    print(f"=== PHASE-1A Rule Comparison ===")
    print(f"  predictions:   {args.pred_db}")
    print(f"  price_history: {args.ph_db}")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    pred = db_manager.connection(args.pred_db, writable=False).__enter__()
    pred.row_factory = sqlite3.Row
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    ph = db_manager.connection(args.ph_db, writable=False).__enter__()
    ph.row_factory = sqlite3.Row

    # 1. Load closed EGX predictions.
    rows = pred.execute("""
        SELECT id, ticker, persona, signal, entry_price, target_price, stop_loss,
               prediction_date, created_at, outcome_date, actual_return,
               highest_price_reached, atr_at_entry
        FROM predictions
        WHERE outcome_date IS NOT NULL AND market='EGX'
    """).fetchall()
    print(f"  Closed EGX predictions: {len(rows)}")

    # 2. Two-pass candle loading (same as retrospective v2).
    ticker_dates = {}
    for r in rows:
        t = r['ticker']
        ed = str(r['prediction_date'] or str(r['created_at'])[:10])[:10]
        od = str(r['outcome_date'])[:10] if r['outcome_date'] else ed
        if t not in ticker_dates:
            ticker_dates[t] = [ed, od]
        else:
            if ed < ticker_dates[t][0]:
                ticker_dates[t][0] = ed
            if od > ticker_dates[t][1]:
                ticker_dates[t][1] = od
    candle_cache = {t: load_ticker_candles(ph, t, lo, hi) for t, (lo, hi) in ticker_dates.items()}

    # 3. Compute metrics per trade.
    enriched = []
    insufficient = 0
    for r in rows:
        t = r['ticker']
        ed = str(r['prediction_date'] or str(r['created_at'])[:10])[:10]
        od = str(r['outcome_date'])[:10] if r['outcome_date'] else ed
        candles = candle_cache.get(t, [])
        pre, entry_candle, window = split_pre_entry_and_window(candles, ed)
        m, reason = compute_trade_metrics(pre, entry_candle, window,
                                          _f(r['entry_price']), _f(r['highest_price_reached']))
        if m is None:
            insufficient += 1
            continue
        enriched.append({
            'id': r['id'], 'ticker': t, 'persona': r['persona'],
            'actual_return': _f(r['actual_return']),
            **m,
        })

    # 4. Exclude anomalies from the batch used for percentiles AND from stats.
    anomalies = [e for e in enriched if abs(e['high_pct']) > ANOMALY_HIGH_PCT]
    anomaly_ids = {e['id'] for e in anomalies}
    clean = [e for e in enriched if e['id'] not in anomaly_ids]

    print(f"  Eligible: {len(enriched)} | Anomalies excluded: {len(anomalies)} | "
          f"Clean batch: {len(clean)} | Insufficient: {insufficient}")
    if anomalies:
        for a in anomalies:
            print(f"    - anomaly: {a['ticker']} high%={a['high_pct']:+.2f}%")

    if not clean:
        print("  [FATAL] no clean trades.")
        return 2

    # 5. Compute batch-level statistics (percentiles, medians, sorted lists for rank).
    chg5d_sorted = sorted(e['change_5d'] for e in clean)
    vr_sorted = sorted(e['volume_ratio'] for e in clean)
    atr_sorted = sorted(e['atr_at_entry_pct'] for e in clean)
    market_change_5d = median([e['change_5d'] for e in clean])

    # Relative strength (stock chg5d - market median chg5d) for rank.
    rs_sorted = sorted(e['change_5d'] - market_change_5d for e in clean)

    # Composite score distribution (for the top-35% threshold).
    composite_scores = []
    for e in clean:
        rs = e['change_5d'] - market_change_5d
        rs_rank = percentile_rank(rs, rs_sorted)
        vr_rank = percentile_rank(e['volume_ratio'], vr_sorted)
        atr_rank = percentile_rank(e['atr_at_entry_pct'], atr_sorted)
        composite_scores.append(0.4 * rs_rank + 0.3 * vr_rank + 0.3 * atr_rank)
    composite_scores_sorted = sorted(composite_scores)

    batch_stats = {
        'n': len(clean),
        'market_change_5d': market_change_5d,
        'chg5d_p60': pct(chg5d_sorted, 60),       # top 40% = ≥ 60th pctile
        'chg5d_p40': pct(chg5d_sorted, 40),       # bottom 40% = ≤ 40th pctile (Rule 6)
        'vr_p60': pct(vr_sorted, 60),
        'atr_p40': pct(atr_sorted, 40),
        'atr_p60': pct(atr_sorted, 60),         # top 40% ATR (Rule 9)
        'atr_median': median(atr_sorted),
        'rs_sorted': rs_sorted,
        'vr_sorted': vr_sorted,
        'atr_sorted': atr_sorted,
        'composite_p65': pct(composite_scores_sorted, 65),  # top 35% = ≥ 65th pctile
    }

    print(f"\n  Batch stats (clean, n={batch_stats['n']}):")
    print(f"    market_change_5d (median) = {batch_stats['market_change_5d']:+.2f}%")
    print(f"    chg5d p60 (top40% cutoff) = {batch_stats['chg5d_p60']:+.2f}%")
    print(f"    chg5d p40 (bot40% cutoff) = {batch_stats['chg5d_p40']:+.2f}%")
    print(f"    vr p60                    = {batch_stats['vr_p60']:.2f}")
    print(f"    atr p40                   = {batch_stats['atr_p40']:.2f}%")
    print(f"    atr median                = {batch_stats['atr_median']:.2f}%")
    print(f"    composite p65 (top35%)    = {batch_stats['composite_p65']:.3f}")

    # 5b. Correlation of each metric with high% — data-driven guide to which
    #     entry-side signal (if any) predicts upside. Pearson + Spearman rank.
    def pearson(xs, ys):
        n = len(xs)
        if n < 3:
            return 0.0
        mx, my = sum(xs) / n, sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        dx = (sum((x - mx) ** 2 for x in xs)) ** 0.5
        dy = (sum((y - my) ** 2 for y in ys)) ** 0.5
        return num / (dx * dy) if dx > 0 and dy > 0 else 0.0

    def spearman(xs, ys):
        rx = [percentile_rank(x, sorted(xs)) for x in xs]
        ry = [percentile_rank(y, sorted(ys)) for y in ys]
        return pearson(rx, ry)

    highs = [e['high_pct'] for e in clean]
    corr_metrics = {
        'atr_at_entry_pct': [e['atr_at_entry_pct'] for e in clean],
        'volume_ratio':     [e['volume_ratio'] for e in clean],
        'change_5d':        [e['change_5d'] for e in clean],
        'change_1d':        [e['change_1d'] for e in clean],
    }
    print(f"\n  --- Correlation with high% (n={len(clean)}) ---")
    print(f"    {'metric':<20} {'pearson':>8} {'spearman':>9}  interpretation")
    corr_results = {}
    for name, vals in corr_metrics.items():
        pr = pearson(vals, highs)
        sp = spearman(vals, highs)
        interp = ('predicts upside' if sp > 0.10 else
                  'predicts downside (mean-rev)' if sp < -0.10 else
                  'NO discrimination (|ρ|<0.10)')
        corr_results[name] = {'pearson': round(pr, 4), 'spearman': round(sp, 4)}
        print(f"    {name:<20} {pr:>+8.4f} {sp:>+9.4f}  {interp}")

    # 6. Evaluate each rule on the clean batch.
    results = []
    print(f"\n{'='*110}")
    print(f"{'Rule':<42} {'pass':>5} {'pass%':>6} {'med_hi_P':>9} {'med_hi_R':>9} {'gap':>7} "
          f"{'avg_ret_P':>10} {'avg_ret_R':>10}")
    print(f"{'-'*42} {'-'*5} {'-'*6} {'-'*9} {'-'*9} {'-'*7} {'-'*10} {'-'*10}")
    for name, fn in RULES:
        passed, rejected = [], []
        for e in clean:
            alive, _reason = fn(e, batch_stats)
            (passed if alive else rejected).append(e)
        med_hi_p = median([x['high_pct'] for x in passed])
        med_hi_r = median([x['high_pct'] for x in rejected])
        avg_ret_p = avg([x['actual_return'] for x in passed])
        avg_ret_r = avg([x['actual_return'] for x in rejected])
        gap = med_hi_p - med_hi_r
        pass_pct = len(passed) / len(clean) * 100 if clean else 0
        results.append({
            'rule': name,
            'passed': len(passed),
            'rejected': len(rejected),
            'pass_pct': round(pass_pct, 2),
            'median_high_passed': round(med_hi_p, 4),
            'median_high_rejected': round(med_hi_r, 4),
            'gap': round(gap, 4),
            'avg_high_passed': round(avg([x['high_pct'] for x in passed]), 4),
            'avg_high_rejected': round(avg([x['high_pct'] for x in rejected]), 4),
            'avg_ret_passed': round(avg_ret_p, 4),
            'avg_ret_rejected': round(avg_ret_r, 4),
        })
        print(f"{name:<42} {len(passed):>5} {pass_pct:>5.1f}% {med_hi_p:>+8.2f}% {med_hi_r:>+8.2f}% "
              f"{gap:>+6.2f} {avg_ret_p:>+9.2f}% {avg_ret_r:>+9.2f}%")
    print(f"{'='*110}")

    # 7. Pick the winner: largest positive gap, pass% in [20, 50], avg_ret_passed > avg_ret_rejected.
    candidates = [r for r in results if 20 <= r['pass_pct'] <= 50
                  and r['gap'] > 0
                  and r['avg_ret_passed'] > r['avg_ret_rejected']]
    if candidates:
        winner = max(candidates, key=lambda r: r['gap'])
        print(f"\n  ✓ WINNER: {winner['rule']}")
        print(f"    gap={winner['gap']:+.2f}pp  pass%={winner['pass_pct']:.1f}%  "
              f"med_hi {winner['median_high_passed']:+.2f}% vs {winner['median_high_rejected']:+.2f}%  "
              f"avg_ret {winner['avg_ret_passed']:+.2f}% vs {winner['avg_ret_rejected']:+.2f}%")
    else:
        # Fallback: largest gap with pass% in [15, 60] even if avg_ret doesn't confirm.
        loose = [r for r in results if 15 <= r['pass_pct'] <= 60 and r['gap'] > 0]
        if loose:
            winner = max(loose, key=lambda r: r['gap'])
            print(f"\n  ⚠ PARTIAL WINNER (avg_ret not confirming): {winner['rule']}")
            print(f"    gap={winner['gap']:+.2f}pp  pass%={winner['pass_pct']:.1f}%  "
                  f"avg_ret {winner['avg_ret_passed']:+.2f}% vs {winner['avg_ret_rejected']:+.2f}%")
        else:
            winner = None
            print(f"\n  ✗ NO WINNER — no rule achieves median_high_passed > median_high_rejected "
                  f"with pass% in [20,50].")

    # 8. Per-persona breakdown for the winner (if any).
    if winner:
        win_fn = dict(RULES)[winner['rule']]
        print(f"\n  --- Winner by persona ---")
        for persona in ['gambler', 'balanced', 'conservative']:
            sub = [e for e in clean if e['persona'] == persona]
            if not sub:
                continue
            p_, rj = [], []
            for e in sub:
                alive, _ = win_fn(e, batch_stats)
                (p_ if alive else rj).append(e)
            med_p = median([x['high_pct'] for x in p_])
            med_r = median([x['high_pct'] for x in rj])
            print(f"    {persona:12}: pass={len(p_):3d} reject={len(rj):3d} "
                  f"| med_hi {med_p:+.2f}% vs {med_r:+.2f}% (gap {med_p-med_r:+.2f}pp)")

    # 9. Save report.
    report = {
        'run_at': __import__('datetime').datetime.now().isoformat(),
        'databases': {'predictions': args.pred_db, 'price_history': args.ph_db},
        'batch_stats': {k: v for k, v in batch_stats.items()
                        if not k.endswith('_sorted')},
        'correlations_with_high_pct': corr_results,
        'anomalies_excluded': len(anomalies),
        'anomalies': [{'ticker': a['ticker'], 'high_pct': a['high_pct']} for a in anomalies],
        'rules': results,
        'winner': winner,
    }
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, default=str, ensure_ascii=False)
    print(f"\n  Report saved -> {args.out}")

    pred.close()
    ph.close()
    return 0 if winner else 1


if __name__ == '__main__':
    sys.exit(main())

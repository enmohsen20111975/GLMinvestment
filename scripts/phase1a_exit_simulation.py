#!/usr/bin/env python3
"""
PHASE-1A — Exit Simulation (Phase-2 go/no-go decision).
=======================================================

السؤال الواحد اللي لازم نجاوب عليه قبل أي Phase 2 (Trailing):

  لو أخذنا **نفس الدخول** وفرضنا خروجًا مثاليًا عند X% من الطريق لـ high،
  هل expectancy للمرور (PASS) يبقى موجبًا؟

  - إذا **نعم بقوة** على المرور و**لا** على الكل → Phase 2 مبررة (المشكلة = exit).
  - إذا **الكل** يتحسّن بنفس الدرجة والمرور لسه أضعف عائدًا → المشكلة مش
    «نلتقط الحركة»، المشكلة **توقيت/اختيار الصفقة** أعمق من ATR+chg5d.

Method
------
For each clean trade (anomalies |high%|>500% excluded) we simulate "what return
would you get with a GOOD exit rule, holding the same entry":

  capture_fraction f ∈ {0.30, 0.50, 0.70, 1.00}
    - f=0.50 = "exit at half the peak" (the user's stated ideal)
    - f=1.00 = "sold exactly at the peak" (absolute upper bound)

  sim_return(f):
    if high_pct > 0:   sim = high_pct * f        # captured f of the upside
                       floor at stop_pct if a valid BUY stop exists
                       (optimistic: assumes the peak came before any stop hit)
    if high_pct ≤ 0:   sim = stop_pct (if valid) else low_pct
                       # stock never went up → no upside to capture → exit at
                       # the stop (you had one) or at the trough (you didn't)

This is an OPTIMISTIC upper bound by design. If even f=0.50 can't make PASS
positive, then exit is NOT the lever — the entry selection is the problem.

Groups compared: PASS (Rule 8 alive) / REJECT / ALL (clean).
Also broken down by persona for PASS.

Usage
-----
    python3 scripts/phase1a_exit_simulation.py \\
        --pred-db db/predictions.db \\
        --ph-db  db/price_history.db \\
        --out db/backups/phase1a_exit_simulation.json
"""
import argparse
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from phase1a_common import (  # noqa: E402
    load_clean_trades,
    clean_trades,
    classify_alive,
    percentile,
    median,
    avg,
    ANOMALY_HIGH_PCT,
)

# Capture fractions to simulate. f=1.0 = sell at the exact peak (upper bound).
CAPTURE_FRACTIONS = [0.30, 0.50, 0.70, 1.00]


# ──────────────────────────────────────────────────────────────────────────────
# Simulation core
# ──────────────────────────────────────────────────────────────────────────────

def _stop_pct_valid(trade):
    """For a BUY, a valid stop is > 0 and < entry. Returns stop_pct or None."""
    entry = trade.get('entry', 0) or 0
    stop = trade.get('stop', 0) or 0
    if entry <= 0 or stop <= 0 or stop >= entry:
        return None
    return (stop - entry) / entry * 100


def simulate_exit(trade, f):
    """Simulate return under 'capture f of the peak, floored at stop'.

    Optimistic bound (assumes peak reached before any stop hit). This is
    intentional — we're testing whether a BETTER exit could rescue the entry
    selection. If even this can't, exit is not the lever.
    """
    high_pct = trade.get('high_pct', 0) or 0
    stop_pct = _stop_pct_valid(trade)
    low_pct = trade.get('low_pct', 0) or 0

    if high_pct > 0:
        sim = high_pct * f
        # Floor at the stop: you can't do worse than your stop (optimistic:
        # assumes the peak came before the stop was hit).
        if stop_pct is not None and sim < stop_pct:
            sim = stop_pct
        return sim
    else:
        # Stock never went above entry → no upside to capture.
        # Exit at the stop if you had one, else at the trough (honest worst).
        if stop_pct is not None:
            return stop_pct
        return low_pct if low_pct < 0 else 0.0


def group_stats(trades, label):
    """Compute actual + simulated expectancy stats for a group of trades."""
    if not trades:
        return {'label': label, 'n': 0}
    n = len(trades)
    actual = [t['actual_return'] for t in trades]
    highs = [t['high_pct'] for t in trades]
    had_opportunity = [t for t in trades if (t.get('high_pct', 0) or 0) > 0]

    out = {
        'label': label,
        'n': n,
        'actual_expectancy': round(avg(actual), 4),
        'actual_median': round(median(actual), 4),
        'actual_winrate_pct': round(sum(1 for x in actual if x > 0) / n * 100, 2),
        'median_high_pct': round(median(highs), 4),
        'avg_high_pct': round(avg(highs), 4),
        'pct_had_exit_opportunity': round(len(had_opportunity) / n * 100, 2),
    }
    for f in CAPTURE_FRACTIONS:
        sims = [simulate_exit(t, f) for t in trades]
        key = f'{int(f * 100)}'
        out[f'sim_{key}_expectancy'] = round(avg(sims), 4)
        out[f'sim_{key}_median'] = round(median(sims), 4)
        out[f'sim_{key}_winrate_pct'] = round(sum(1 for x in sims if x > 0) / n * 100, 2)
        out[f'sim_{key}_delta_vs_actual'] = round(avg(sims) - avg(actual), 4)
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description='Phase-1a exit simulation (Phase-2 go/no-go)')
    p.add_argument('--pred-db', required=True)
    p.add_argument('--ph-db', required=True)
    p.add_argument('--out', default='db/backups/phase1a_exit_simulation.json')
    args = p.parse_args()

    print("=== PHASE-1A Exit Simulation (Phase-2 go/no-go) ===")
    print(f"  predictions:   {args.pred_db}")
    print(f"  price_history: {args.ph_db}")

    data = load_clean_trades(args.pred_db, args.ph_db)
    cl = clean_trades(data)
    print(f"\n  Closed EGX (BUY): {data['n_total']} | Eligible: {len(data['enriched'])} | "
          f"Anomalies excluded (|high%|>{ANOMALY_HIGH_PCT:.0f}%): {len(data['anomalies'])} | "
          f"Clean batch: {len(cl)} | Insufficient: {len(data['insufficient'])}")

    if not cl:
        print("\n  [FATAL] no clean trades — cannot simulate.")
        return 2

    passed, rejected, dyn = classify_alive(cl)
    print(f"  Rule 8 split: PASS={len(passed)} ({len(passed)/len(cl)*100:.1f}%)  "
          f"REJECT={len(rejected)} ({len(rejected)/len(cl)*100:.1f}%)")
    print(f"\n  Batch thresholds: atr_median={dyn['atr_pct_p50']:.2f}  "
          f"chg5d_p40={dyn['chg5d_p40']:+.2f}  mkt5d={dyn['market_change_5d']:+.2f}")

    # ── Group stats ──
    groups = {
        'PASS (Rule 8 alive)': passed,
        'REJECT': rejected,
        'ALL (clean)': cl,
    }
    stats = {k: group_stats(v, k) for k, v in groups.items()}

    # ── Decision table ──
    print("\n" + "=" * 110)
    print("EXPECTANCY TABLE (avg return %)  —  actual vs simulated ideal exit")
    print("=" * 110)
    hdr = f"{'Group':22} {'n':>5} {'actual':>8} {'cap30':>8} {'cap50':>8} {'cap70':>8} {'peak':>8} {'Δ(50-act)':>10} {'winRt%':>7}"
    print(hdr)
    print("-" * 110)
    for k in ['PASS (Rule 8 alive)', 'REJECT', 'ALL (clean)']:
        s = stats[k]
        if s['n'] == 0:
            print(f"{k:22} {0:>5}")
            continue
        print(f"{k:22} {s['n']:>5} "
              f"{s['actual_expectancy']:>+8.2f} "
              f"{s['sim_30_expectancy']:>+8.2f} "
              f"{s['sim_50_expectancy']:>+8.2f} "
              f"{s['sim_70_expectancy']:>+8.2f} "
              f"{s['sim_100_expectancy']:>+8.2f} "
              f"{s['sim_50_delta_vs_actual']:>+10.2f} "
              f"{s['actual_winrate_pct']:>6.1f}%")
    print("=" * 110)
    print("  cap50 = exit at 50% of the way to peak (the user's stated ideal).")
    print("  peak  = sold exactly at the peak (absolute upper bound).")
    print("  Δ     = sim_50 − actual (how much a better exit would add).")

    # ── The decision question ──
    pass_s = stats['PASS (Rule 8 alive)']
    all_s = stats['ALL (clean)']
    print("\n=== PHASE-2 DECISION QUESTION ===")
    print("  Q: Under ideal exit (cap50), does PASS turn positive while ALL stays weak?")
    if pass_s['n'] == 0 or all_s['n'] == 0:
        print("  [SKIP] one group is empty.")
    else:
        p50 = pass_s['sim_50_expectancy']
        a50 = all_s['sim_50_expectancy']
        pact = pass_s['actual_expectancy']
        aact = all_s['actual_expectancy']
        print(f"  PASS  cap50 expectancy = {p50:+.2f}%   (actual {pact:+.2f}%)")
        print(f"  ALL   cap50 expectancy = {a50:+.2f}%   (actual {aact:+.2f}%)")
        print(f"  PASS gain from better exit (cap50−actual) = {p50-pact:+.2f}pp")
        print(f"  ALL  gain from better exit (cap50−actual) = {a50-aact:+.2f}pp")
        print()
        if p50 > 0 and a50 <= 0:
            print("  → ANSWER: YES (strongly). PASS turns positive under ideal exit, ALL does not.")
            print("           Phase 2 (Trailing) IS justified — exit is the lever for PASS entries.")
        elif p50 > 0 and a50 > 0:
            print("  → ANSWER: BOTH turn positive under ideal exit (improves equally).")
            print("           Exit helps, but is NOT the PASS differentiator → entry/target design")
            print("           is the deeper problem. Reconsider entry rule before Phase 2.")
        elif p50 <= 0:
            print("  → ANSWER: NO. Even capturing 50% of the peak, PASS expectancy stays negative.")
            print("           Exit is NOT the lever — the entry selection is fundamentally bad.")
            print("           Do NOT build Phase 2 Trailing; revisit entry/target design.")
        # delta comparison
        d_pass = p50 - pact
        d_all = a50 - aact
        if abs(d_pass - d_all) < 0.5:
            print(f"  (Δ_PASS {d_pass:+.2f} ≈ Δ_ALL {d_all:+.2f} — both improve equally → exit not the differentiator)")

    # ── PASS by persona ──
    print("\n=== PASS group by persona (cap50) ===")
    print(f"{'persona':14} {'n':>5} {'actual':>8} {'cap50':>8} {'cap70':>8} {'peak':>8} {'hi%>0%':>7} {'hi%>10%':>8}")
    print("-" * 80)
    for persona in ['gambler', 'balanced', 'conservative']:
        pt = [t for t in passed if t['persona'] == persona]
        if not pt:
            continue
        s = group_stats(pt, persona)
        hi_gt_10 = sum(1 for t in pt if (t.get('high_pct', 0) or 0) > 10)
        print(f"{persona:14} {s['n']:>5} "
              f"{s['actual_expectancy']:>+8.2f} "
              f"{s['sim_50_expectancy']:>+8.2f} "
              f"{s['sim_70_expectancy']:>+8.2f} "
              f"{s['sim_100_expectancy']:>+8.2f} "
              f"{s['pct_had_exit_opportunity']:>6.1f}% "
              f"{hi_gt_10/len(pt)*100:>7.1f}%")

    # ── Sample: trades where cap50 rescues a loser ──
    rescued = [t for t in cl if t['actual_return'] < -2 and simulate_exit(t, 0.5) > 3]
    rescued.sort(key=lambda t: simulate_exit(t, 0.5) - t['actual_return'], reverse=True)
    print(f"\n=== SAMPLE 10 'rescued' trades (actual<-2% → cap50>+3%) — n={len(rescued)} ===")
    for t in rescued[:10]:
        print(f"  {t['ticker']:8} {t['persona']:12} entry={t['entry']:8.3f} high%={t['high_pct']:+7.2f}% "
              f"low%={t['low_pct']:+7.2f}% stop%={_stop_pct_valid(t) or 0:+6.2f} "
              f"actual={t['actual_return']:+6.2f}% cap50={simulate_exit(t,0.5):+6.2f}% "
              f"{'PASS' if t.get('alive') else 'REJ'}")

    # ── Save report ──
    report = {
        'run_at': __import__('datetime').datetime.now().isoformat(),
        'purpose': 'Phase-2 go/no-go: does ideal exit rescue PASS entries?',
        'method': 'capture_fraction of peak high, floored at valid BUY stop (optimistic bound)',
        'capture_fractions': CAPTURE_FRACTIONS,
        'anomaly_threshold': ANOMALY_HIGH_PCT,
        'databases': data['databases'],
        'batch': {
            'n_total_closed_egx_buy': data['n_total'],
            'n_eligible': len(data['enriched']),
            'n_anomalies_excluded': len(data['anomalies']),
            'n_clean': len(cl),
            'n_insufficient': len(data['insufficient']),
            'n_pass': len(passed),
            'n_reject': len(rejected),
            'pass_pct': round(len(passed) / len(cl) * 100, 2) if cl else 0,
        },
        'dynamic_thresholds': {k: v for k, v in dyn.items() if k != 'populated'},
        'groups': stats,
        'pass_by_persona': {
            persona: group_stats([t for t in passed if t['persona'] == persona], persona)
            for persona in ['gambler', 'balanced', 'conservative']
        },
    }
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, default=str, ensure_ascii=False)
    print(f"\n  Report saved -> {args.out}")
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""
PHASE-1A — Bucket comparison: momentum vs mean-reversion vs neither.
====================================================================

قرار المالك: "لا تُثبّت mean-reversion كقانون وحيد للمضارب. اختبر مسار ثنائي."

القاعدة 8 الحالية (Rule 8 = ATR≥median AND chg5d≤p40) = mean-reversion فقط.
المشكلة: بت رفض أسهم momentum بـ high% عالي (DMNH +20%…+32%) لأنها «طلعت
بالفعل». ده خطر تاجر: تفوّت أقوى الحركات.

هذا السكربت بيقسّم الـ clean trades لـ 3 buckets متبادلة (mutually exclusive):

  1. mean_reversion : ATR ≥ median  AND  chg5d ≤ p40
                     (== Rule 8 PASS — السهم المتقلب اللي نزل آخر 5 أيام)
  2. momentum       : chg5d ≥ p60   AND  (ATR ≥ p40  OR  VR ≥ p75)
                     (السهم اللي بيكمل صعود + فيه تقلب/سيولة)
  3. neither        : الباقي

ملاحظة: mean_rev و momentum متبادلان بالـ chg5d (مش ممكن chg5d ≤ p40 و ≥ p60
في نفس الوقت)، فمفيش overlap.

لكل bucket نقيس:
  - count, % of clean
  - median high%, avg high% (التوضيح بس)
  - avg/median actual_return
  - % trades بـ high% > 10%  (نسبة الحركات الكبيرة — ده اللي بيخسره mean-rev)
  - avg actual_return للـ subset بـ high%>10% (هل التقاطنا الحركة الكبيرة؟)
  - cap50 expectancy (من محاكاة الخروج — ربط مع phase1a_exit_simulation)

الهدف: نشوف هل momentum bucket بيلتقط الـ DMNH-like big moves، وهل mean-rev
بيقفل الباب على الحركات دي.

Usage
-----
    python3 scripts/phase1a_bucket_compare.py \\
        --pred-db db/predictions.db \\
        --ph-db  db/price_history.db \\
        --out db/backups/phase1a_bucket_compare.json
"""
import argparse
import json
import os
import sys
from datetime import datetime

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

BIG_MOVE_HIGH_PCT = 10.0   # high% > this = "big move" (DMNH-like)


# ──────────────────────────────────────────────────────────────────────────────
# Bucket assignment
# ──────────────────────────────────────────────────────────────────────────────

def assign_buckets(clean, dyn):
    """Assign each clean trade to one mutually-exclusive bucket.

    mean_reversion : ATR ≥ median  AND  chg5d ≤ p40   (== Rule 8 PASS)
    momentum       : chg5d ≥ p60   AND  (ATR ≥ p40 OR VR ≥ p75)
    neither        : everything else

    Returns dict of {bucket_name: [trades]}.
    """
    atr_median = dyn['atr_pct_p50']
    atr_p40 = dyn['atr_pct_p40']
    chg5d_p40 = dyn['chg5d_p40']
    chg5d_p60 = percentile([e['change_5d'] for e in clean], 60)
    vr_p75 = percentile([e['volume_ratio'] for e in clean], 75)

    mean_rev, momentum, neither = [], [], []
    for e in clean:
        atr = e['atr_at_entry_pct']
        chg = e['change_5d']
        vr = e['volume_ratio']
        is_mean_rev = (atr >= atr_median) and (chg <= chg5d_p40)
        is_momentum = (chg >= chg5d_p60) and (atr >= atr_p40 or vr >= vr_p75)
        if is_mean_rev:
            mean_rev.append(e)
        elif is_momentum:
            momentum.append(e)
        else:
            neither.append(e)
    return {
        'mean_reversion': mean_rev,
        'momentum': momentum,
        'neither': neither,
    }, {
        'atr_median': round(atr_median, 4),
        'atr_p40': round(atr_p40, 4),
        'chg5d_p40': round(chg5d_p40, 4),
        'chg5d_p60': round(chg5d_p60, 4),
        'vr_p75': round(vr_p75, 4),
    }


def bucket_stats(trades, label):
    """Compute stats for a bucket."""
    if not trades:
        return {'label': label, 'n': 0}
    n = len(trades)
    highs = [t['high_pct'] for t in trades]
    rets = [t['actual_return'] for t in trades]
    big = [t for t in trades if (t.get('high_pct', 0) or 0) > BIG_MOVE_HIGH_PCT]
    big_rets = [t['actual_return'] for t in big]
    big_highs = [t['high_pct'] for t in big]
    return {
        'label': label,
        'n': n,
        'pct_of_clean': 0.0,  # filled by caller (needs n_clean)
        'median_high_pct': round(median(highs), 4),
        'avg_high_pct': round(avg(highs), 4),
        'avg_actual_return': round(avg(rets), 4),
        'median_actual_return': round(median(rets), 4),
        'winrate_pct': round(sum(1 for x in rets if x > 0) / n * 100, 2),
        'big_move_count': len(big),
        'big_move_pct': round(len(big) / n * 100, 2),
        'big_move_avg_high_pct': round(avg(big_highs), 4) if big else 0,
        'big_move_avg_return': round(avg(big_rets), 4) if big else 0,
        'big_move_winrate_pct': round(sum(1 for x in big_rets if x > 0) / len(big) * 100, 2) if big else 0,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description='Phase-1a bucket comparison (momentum vs mean-rev)')
    p.add_argument('--pred-db', required=True)
    p.add_argument('--ph-db', required=True)
    p.add_argument('--out', default='db/backups/phase1a_bucket_compare.json')
    args = p.parse_args()

    print("=== PHASE-1A Bucket Comparison (momentum vs mean-reversion) ===")
    print(f"  predictions:   {args.pred_db}")
    print(f"  price_history: {args.ph_db}")

    data = load_clean_trades(args.pred_db, args.ph_db)
    cl = clean_trades(data)
    print(f"\n  Closed EGX (BUY): {data['n_total']} | Eligible: {len(data['enriched'])} | "
          f"Anomalies excluded: {len(data['anomalies'])} | Clean: {len(cl)} | "
          f"Insufficient: {len(data['insufficient'])}")

    if not cl:
        print("\n  [FATAL] no clean trades.")
        return 2

    # Classify alive (for cross-reference: mean_rev bucket should == PASS).
    passed, rejected, dyn = classify_alive(cl)

    buckets, bthresh = assign_buckets(cl, dyn)
    print(f"\n  Bucket thresholds (dynamic, from clean batch n={len(cl)}):")
    print(f"    atr_median   = {bthresh['atr_median']:.2f}   (mean-rev ATR gate)")
    print(f"    atr_p40      = {bthresh['atr_p40']:.2f}   (momentum ATR alt-gate)")
    print(f"    chg5d_p40    = {bthresh['chg5d_p40']:+.2f}   (mean-rev chg5d gate)")
    print(f"    chg5d_p60    = {bthresh['chg5d_p60']:+.2f}   (momentum chg5d gate)")
    print(f"    vr_p75       = {bthresh['vr_p75']:.2f}   (momentum VR alt-gate)")

    n_clean = len(cl)
    stats = {}
    for name in ['mean_reversion', 'momentum', 'neither']:
        s = bucket_stats(buckets[name], name)
        s['pct_of_clean'] = round(len(buckets[name]) / n_clean * 100, 2)
        stats[name] = s

    # Cross-check: mean_reversion bucket should == Rule 8 PASS set.
    mr_ids = {t['id'] for t in buckets['mean_reversion']}
    pass_ids = {t['id'] for t in passed}
    overlap = len(mr_ids & pass_ids)
    print(f"\n  Cross-check: mean_reversion bucket == Rule 8 PASS? "
          f"overlap={overlap}/{len(mr_ids)} "
          f"{'✓ (identical)' if mr_ids == pass_ids else '✗ (differs)'}")

    # ── Comparison table ──
    print("\n" + "=" * 130)
    print("BUCKET COMPARISON TABLE")
    print("=" * 130)
    print(f"{'Bucket':16} {'n':>5} {'%cln':>6} {'med_hi%':>8} {'avg_hi%':>8} "
          f"{'avg_ret':>8} {'med_ret':>8} {'winRt%':>7} {'hi%>10%':>8} "
          f"{'big_avg_hi%':>11} {'big_avg_ret':>11} {'big_winRt%':>10}")
    print("-" * 130)
    for name in ['mean_reversion', 'momentum', 'neither']:
        s = stats[name]
        print(f"{name:16} {s['n']:>5} {s['pct_of_clean']:>5.1f}% "
              f"{s['median_high_pct']:>+8.2f} {s['avg_high_pct']:>+8.2f} "
              f"{s['avg_actual_return']:>+8.2f} {s['median_actual_return']:>+8.2f} "
              f"{s['winrate_pct']:>6.1f}% {s['big_move_pct']:>7.1f}% "
              f"{s['big_move_avg_high_pct']:>+10.2f}% {s['big_move_avg_return']:>+10.2f}% "
              f"{s['big_move_winrate_pct']:>9.1f}%")
    print("=" * 130)
    print(f"  big_move = high% > {BIG_MOVE_HIGH_PCT:.0f}%  (DMNH-like strong moves)")
    print(f"  big_avg_hi%  = avg high% among the big-move trades in that bucket")
    print(f"  big_avg_ret  = avg ACTUAL return among those big-move trades")
    print(f"                (low = the system FAILED to capture the big move)")

    # ── Interpretation ──
    mr = stats['mean_reversion']
    mo = stats['momentum']
    print("\n=== INTERPRETATION ===")
    if mo['n'] > 0 and mr['n'] > 0:
        print(f"  mean_reversion: n={mr['n']} ({mr['pct_of_clean']:.1f}%), "
              f"med_hi={mr['median_high_pct']:+.2f}%, big_move%={mr['big_move_pct']:.1f}%, "
              f"avg_ret={mr['avg_actual_return']:+.2f}%")
        print(f"  momentum      : n={mo['n']} ({mo['pct_of_clean']:.1f}%), "
              f"med_hi={mo['median_high_pct']:+.2f}%, big_move%={mo['big_move_pct']:.1f}%, "
              f"avg_ret={mo['avg_actual_return']:+.2f}%")
        print()
        if mo['big_move_pct'] > mr['big_move_pct']:
            print(f"  → momentum bucket captures {mo['big_move_pct']:.1f}% big moves vs "
                  f"mean_rev {mr['big_move_pct']:.1f}%.")
            print(f"    Rule 8 (mean-rev only) leaves {mo['n']} momentum trades on the table, "
                  f"{mo['big_move_count']} of them big moves (avg high% {mo['big_move_avg_high_pct']:+.1f}%).")
            print(f"    BUT actual return on those big moves = {mo['big_move_avg_return']:+.2f}% "
                  f"(winrate {mo['big_move_winrate_pct']:.1f}%) — "
                  f"{'captured' if mo['big_move_avg_return'] > 0 else 'NOT captured (exit problem)'}.")
        if mo['avg_actual_return'] > mr['avg_actual_return']:
            print(f"  → momentum avg_ret ({mo['avg_actual_return']:+.2f}%) > mean_rev ({mr['avg_actual_return']:+.2f}%).")
            print(f"    A mean-reversion-only veto is LEAVING MONEY on the table.")
        else:
            print(f"  → mean_rev avg_ret ({mr['avg_actual_return']:+.2f}%) ≥ momentum ({mo['avg_actual_return']:+.2f}%).")
        print()
        print("  RECOMMENDATION: test a persona-tagged binary path —")
        print("    gambler     → momentum bucket (let it ride the big moves)")
        print("    conservative → mean_reversion bucket (volatility + pullback)")
        print("  instead of a single mean-rev veto on the gambler.")

    # ── Sample big-move trades by bucket ──
    for name in ['mean_reversion', 'momentum', 'neither']:
        big = [t for t in buckets[name] if (t.get('high_pct', 0) or 0) > BIG_MOVE_HIGH_PCT]
        if not big:
            continue
        big.sort(key=lambda t: t['high_pct'], reverse=True)
        print(f"\n  --- SAMPLE 8 big-move trades in '{name}' (high%>{BIG_MOVE_HIGH_PCT:.0f}%) — n={len(big)} ---")
        for t in big[:8]:
            print(f"    {t['ticker']:8} {t['persona']:12} atr%={t['atr_at_entry_pct']:5.2f} "
                  f"vr={t['volume_ratio']:5.2f} chg5d={t['change_5d']:+6.2f} "
                  f"high%={t['high_pct']:+7.2f}% ret={t['actual_return']:+6.2f}%")

    # ── Save report ──
    report = {
        'run_at': datetime.now().isoformat(),
        'purpose': 'momentum vs mean-reversion bucket analysis (avoid single mean-rev veto)',
        'buckets': {
            'mean_reversion': 'ATR >= median AND chg5d <= p40 (== Rule 8 PASS)',
            'momentum': 'chg5d >= p60 AND (ATR >= p40 OR VR >= p75)',
            'neither': 'everything else',
        },
        'big_move_threshold': BIG_MOVE_HIGH_PCT,
        'anomaly_threshold': ANOMALY_HIGH_PCT,
        'databases': data['databases'],
        'batch': {
            'n_total_closed_egx_buy': data['n_total'],
            'n_eligible': len(data['enriched']),
            'n_anomalies_excluded': len(data['anomalies']),
            'n_clean': n_clean,
            'n_insufficient': len(data['insufficient']),
        },
        'bucket_thresholds': bthresh,
        'cross_check_mean_rev_eq_pass': mr_ids == pass_ids,
        'stats': stats,
        'thresholds_source': 'core.opportunity_quality.get_dynamic_thresholds (percentiles over clean batch)',
    }
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, default=str, ensure_ascii=False)
    print(f"\n  Report saved -> {args.out}")
    return 0


if __name__ == '__main__':
    sys.exit(main())

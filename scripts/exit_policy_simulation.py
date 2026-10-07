#!/usr/bin/env python3
"""
Exit Policy Simulation — محاكاة سياسة الخروج (جزء عند 1R + trailing باقي).
================================================================================

قرار المالك (الأولوية 2): "سياسة خروج بسيطة قابلة للقياس (مثلاً: جزء عند 1R
+ trailing باقي) على كل BUY".

ده سكربت قياس بـ يحاكي السياسة الجديدة على نفس 584 صفقة نظيفة (نفس entry)
ونقارن العائد الحالي (actual_return) بالعائد المحاكى:

السياسة المقترحة (partial_1r_trailing):
  1. stop = ATR-based (entry - k×ATR، k حسب persona) — نفس Priority 1
  2. لما high ≥ entry + 1R (= entry + risk): بيع 50% عند 1R
  3. بعد الـ partial: trailing stop = highest - trail_mult × ATR (default 2.0)
  4. لو close < trailing_stop: إغلاق الـ 50% الباقية عند close
  5. لو الـ stop الأصلي اتضرب قبل الـ partial: خسارة كاملة عند الـ stop
  6. لو max_holding_days: إغلاق عند السعر الحالي

الـ return النهائي = 0.5 × partial_return + 0.5 × final_return (لو partial حصل)
                   = final_return (لو لأ — stop أو expired قبل partial)

Groups: PASS (Rule 8 alive) / REJECT / ALL — مع مقارنة current vs simulated.

Usage:
    python3 scripts/exit_policy_simulation.py
    python3 scripts/exit_policy_simulation.py --pred-db db/predictions.db --ph-db db/price_history.db
"""
import argparse
import json
import os
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

VPS_DIR = os.path.join(SCRIPT_DIR, '..', 'vps-service')
if VPS_DIR not in sys.path:
    sys.path.insert(0, VPS_DIR)

from phase1a_common import (  # noqa: E402
    load_clean_trades,
    clean_trades,
    classify_alive,
    median,
    avg,
    ANOMALY_HIGH_PCT,
)
from core.opportunity_quality import (  # noqa: E402
    ATR_STOP_MULTIPLIERS,
    ATR_STOP_MIN_PCT,
    ATR_STOP_MAX_PCT,
    MIN_PLANNED_RR,
)

# ──────────────────────────────────────────────────────────────────────────────
# Exit policy parameters
# ──────────────────────────────────────────────────────────────────────────────

PARTIAL_FRACTION = 0.50       # بيع 50% عند 1R
TRAIL_MULT = 2.0              # trailing stop = highest - 2×ATR
MAX_HOLDING_DAYS = 30         # أقصى مدة احتفاظ (gamler/balanced)
MAX_HOLDING_DAYS_CONS = 60    # للمحافظ (أفق أطول)


# ──────────────────────────────────────────────────────────────────────────────
# ATR-based stop (matches enforce_atr_based_stop in opportunity_quality.py)
# ──────────────────────────────────────────────────────────────────────────────

def compute_atr_stop(entry, atr, persona):
    """احسب ATR-based stop = entry - k×ATR (مع clamp)."""
    if not entry or entry <= 0 or not atr or atr <= 0:
        return None
    p = (persona or 'balanced').lower().strip()
    if p == 'investor':
        p = 'conservative'
    elif p == 'active_trader':
        p = 'gambler'
    k = ATR_STOP_MULTIPLIERS.get(p, 1.5)

    stop_dist = atr * k
    stop_pct = stop_dist / entry * 100.0
    if stop_pct < ATR_STOP_MIN_PCT:
        stop_dist = entry * (ATR_STOP_MIN_PCT / 100.0)
    elif stop_pct > ATR_STOP_MAX_PCT:
        stop_dist = entry * (ATR_STOP_MAX_PCT / 100.0)

    return entry - stop_dist


# ──────────────────────────────────────────────────────────────────────────────
# Simulation core
# ──────────────────────────────────────────────────────────────────────────────

def simulate_partial_trailing(trade, use_atr_stop=True):
    """محاكاة سياسة partial_1r_trailing على صفقة واحدة.

    Returns:
        dict: {
            'sim_return': float,      # العائد المحاكى %
            'actual_return': float,   # العائد الفعلي المسجل %
            'exit_type': str,         # stop_loss / partial_trailing / expired_no_partial / expired
            'partial_done': bool,
            'partial_return': float,  # عائد الـ 50% الأولى (إذا حصل)
            'final_return': float,    # عائد الـ 50% التانية (إذا حصل)
            'days_held': int,
        }
    """
    entry = float(trade.get('entry', 0) or 0)
    atr = float(trade.get('atr_at_entry', 0) or 0)
    persona = trade.get('persona', 'balanced')
    window = trade.get('window', [])

    if entry <= 0 or not window:
        return {'sim_return': 0, 'actual_return': float(trade.get('actual_return', 0) or 0),
                'exit_type': 'no_data', 'partial_done': False, 'partial_return': 0,
                'final_return': 0, 'days_held': 0}

    # الـ stop: ATR-based (لو use_atr_stop) أو الأصلي من الـ DB
    if use_atr_stop:
        stop = compute_atr_stop(entry, atr, persona)
        if stop is None:
            stop = float(trade.get('stop', 0) or 0)
    else:
        stop = float(trade.get('stop', 0) or 0)

    if stop <= 0 or stop >= entry:
        # stop غير صالح — استخدم fallback 3%
        stop = entry * 0.97

    risk = entry - stop  # المكسب/الخسارة عند 1R
    target_1r = entry + risk  # سعر 1R
    max_days = MAX_HOLDING_DAYS_CONS if persona == 'conservative' else MAX_HOLDING_DAYS

    partial_done = False
    partial_return = 0.0
    final_return = 0.0
    highest = entry
    trailing_stop = stop  # قبل الـ partial، الـ stop الثابت هو الحارس
    exit_type = 'expired'

    # window[0] = يوم الدخول؛ نمشي من اليوم اللي بعده
    post_entry = window[1:] if len(window) > 1 else []

    for i, candle in enumerate(post_entry):
        day = i + 1
        high = float(candle.get('high_price', 0) or 0)
        low = float(candle.get('low_price', 0) or 0)
        close = float(candle.get('close_price', 0) or 0)

        if high <= 0 or low <= 0 or close <= 0:
            continue

        # P43-DATA-CLEAN: فلترة الأرقام الفلكية (stock splits)
        if high > entry * 5.0 or low < entry * 0.2:
            continue

        highest = max(highest, high)

        # 1) تحقّق الـ stop أولاً (conservative — قبل الـ partial)
        if not partial_done and low <= stop:
            exit_type = 'stop_loss'
            final_return = (stop - entry) / entry * 100
            return {
                'sim_return': final_return,
                'actual_return': float(trade.get('actual_return', 0) or 0),
                'exit_type': exit_type,
                'partial_done': False,
                'partial_return': 0,
                'final_return': final_return,
                'days_held': day,
            }

        # 2) تحقّق الـ partial trigger (high ≥ 1R)
        if not partial_done and high >= target_1r:
            partial_done = True
            partial_return = (target_1r - entry) / entry * 100  # = risk%
            # فعّل الـ trailing بعد الـ partial
            trailing_stop = highest - TRAIL_MULT * atr if atr > 0 else stop

        # 3) بعد الـ partial: تحقّق الـ trailing stop
        if partial_done:
            # حدّث الـ trailing (يسير مع الـ highest)
            new_trail = highest - TRAIL_MULT * atr if atr > 0 else stop
            trailing_stop = max(trailing_stop, new_trail)
            # لكن مش أعلى من الـ entry (ما نحوّلش ربح لخسارة)
            trailing_stop = min(trailing_stop, entry) if trailing_stop > entry else trailing_stop

            if close < trailing_stop:
                exit_type = 'partial_trailing'
                final_return = (close - entry) / entry * 100
                sim = PARTIAL_FRACTION * partial_return + (1 - PARTIAL_FRACTION) * final_return
                return {
                    'sim_return': sim,
                    'actual_return': float(trade.get('actual_return', 0) or 0),
                    'exit_type': exit_type,
                    'partial_done': True,
                    'partial_return': partial_return,
                    'final_return': final_return,
                    'days_held': day,
                }

        # 4) تحقّق الـ max_holding_days
        if day >= max_days:
            exit_type = 'expired' if not partial_done else 'partial_expired'
            final_return = (close - entry) / entry * 100
            if partial_done:
                sim = PARTIAL_FRACTION * partial_return + (1 - PARTIAL_FRACTION) * final_return
            else:
                sim = final_return
            return {
                'sim_return': sim,
                'actual_return': float(trade.get('actual_return', 0) or 0),
                'exit_type': exit_type,
                'partial_done': partial_done,
                'partial_return': partial_return,
                'final_return': final_return,
                'days_held': day,
            }

    # لو خلصت الـ candles بدون خروج
    last_close = float(post_entry[-1].get('close_price', entry) or entry) if post_entry else entry
    final_return = (last_close - entry) / entry * 100
    if partial_done:
        sim = PARTIAL_FRACTION * partial_return + (1 - PARTIAL_FRACTION) * final_return
        exit_type = 'partial_expired'
    else:
        sim = final_return
        exit_type = 'expired_no_partial'
    return {
        'sim_return': sim,
        'actual_return': float(trade.get('actual_return', 0) or 0),
        'exit_type': exit_type,
        'partial_done': partial_done,
        'partial_return': partial_return,
        'final_return': final_return,
        'days_held': len(post_entry),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Group stats
# ──────────────────────────────────────────────────────────────────────────────

def group_stats(results):
    if not results:
        return None
    actuals = [r['actual_return'] for r in results]
    sims = [r['sim_return'] for r in results]
    n = len(results)
    partials = sum(1 for r in results if r['partial_done'])
    wins_actual = sum(1 for a in actuals if a > 0)
    wins_sim = sum(1 for s in sims if s > 0)
    exit_types = {}
    for r in results:
        exit_types[r['exit_type']] = exit_types.get(r['exit_type'], 0) + 1
    return {
        'n': n,
        'avg_actual': round(avg(actuals), 3),
        'median_actual': round(median(actuals), 3),
        'avg_sim': round(avg(sims), 3),
        'median_sim': round(median(sims), 3),
        'winrate_actual': round(wins_actual / n * 100, 1) if n else 0,
        'winrate_sim': round(wins_sim / n * 100, 1) if n else 0,
        'improvement_avg': round(avg(sims) - avg(actuals), 3),
        'improvement_median': round(median(sims) - median(actuals), 3),
        'partial_rate': round(partials / n * 100, 1) if n else 0,
        'exit_types': exit_types,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Report
# ──────────────────────────────────────────────────────────────────────────────

def print_report(label, stats):
    if not stats:
        print(f"\n  {label}: (no trades)")
        return
    print(f"\n  ── {label} (n={stats['n']}) ──")
    print(f"    avg return:    actual {stats['avg_actual']:+.2f}%  →  sim {stats['avg_sim']:+.2f}%  (Δ {stats['improvement_avg']:+.2f}pp)")
    print(f"    median return: actual {stats['median_actual']:+.2f}%  →  sim {stats['median_sim']:+.2f}%  (Δ {stats['improvement_median']:+.2f}pp)")
    print(f"    winrate:       actual {stats['winrate_actual']:.1f}%  →  sim {stats['winrate_sim']:.1f}%")
    print(f"    partial rate:  {stats['partial_rate']:.1f}%")
    print(f"    exit types:    {stats['exit_types']}")


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Exit Policy Simulation — partial 1R + trailing')
    parser.add_argument('--pred-db', default='db/predictions.db')
    parser.add_argument('--ph-db', default='db/price_history.db')
    parser.add_argument('--out', default=None, help='optional JSON output path')
    parser.add_argument('--no-atr-stop', action='store_true', help='use original DB stop instead of ATR-based')
    args = parser.parse_args()

    print(f"[Exit Policy Sim] pred={args.pred_db} ph={args.ph_db} atr_stop={'NO' if args.no_atr_stop else 'YES'}")
    print(f"  partial_fraction={PARTIAL_FRACTION}  trail_mult={TRAIL_MULT}  min_rr={MIN_PLANNED_RR}")

    data = load_clean_trades(args.pred_db, args.ph_db, include_buy_only=True, include_window=True)
    clean = clean_trades(data)
    passed, rejected, _dyn = classify_alive(clean)

    print(f"\n  Loaded: {data['n_total']} closed EGX BUY predictions")
    print(f"  Eligible (with metrics): {len(data['enriched'])}")
    print(f"  Anomalies excluded (|high%|>{ANOMALY_HIGH_PCT}): {len(data['anomalies'])}")
    print(f"  Clean trades: {len(clean)}")
    print(f"  PASS (alive): {len(passed)}  |  REJECT: {len(rejected)}")

    use_atr = not args.no_atr_stop

    # Simulate ALL clean trades
    all_results = [simulate_partial_trailing(t, use_atr_stop=use_atr) for t in clean]
    pass_results = [simulate_partial_trailing(t, use_atr_stop=use_atr) for t in passed]
    rej_results = [simulate_partial_trailing(t, use_atr_stop=use_atr) for t in rejected]

    # Per-persona breakdown for ALL
    persona_groups = {}
    for t, r in zip(clean, all_results):
        p = t.get('persona', 'unknown')
        persona_groups.setdefault(p, []).append(r)

    print("\n" + "=" * 76)
    print("  EXIT POLICY SIMULATION — partial at 1R (50%) + trailing (2×ATR)")
    print("=" * 76)

    print_report("ALL (clean)", group_stats(all_results))
    print_report("PASS (alive)", group_stats(pass_results))
    print_report("REJECT", group_stats(rej_results))

    print("\n  ── Per-persona (ALL clean) ──")
    for p in sorted(persona_groups.keys()):
        print_report(f"persona={p}", group_stats(persona_groups[p]))

    # Verdict
    all_stats = group_stats(all_results)
    pass_stats = group_stats(pass_results)

    print("\n" + "=" * 76)
    print("  VERDICT")
    print("=" * 76)
    if all_stats and pass_stats:
        if all_stats['avg_sim'] > 0 and all_stats['improvement_avg'] > 2:
            print(f"  ✓ السياسة قلبت الـ expectancy موجبة للكل: "
                  f"{all_stats['avg_actual']:+.2f}% → {all_stats['avg_sim']:+.2f}%")
        elif all_stats['improvement_avg'] > 0:
            print(f"  ~ السياعة حسّنت العائد بس لسه سالب: "
                  f"{all_stats['avg_actual']:+.2f}% → {all_stats['avg_sim']:+.2f}%")
        else:
            print(f"  ✗ السياسة ما حسّنتش: {all_stats['avg_actual']:+.2f}% → {all_stats['avg_sim']:+.2f}%")

        if pass_stats['avg_sim'] > all_stats['avg_sim'] + 1:
            print(f"  ~ PASS أحسن من ALL بـ {pass_stats['avg_sim'] - all_stats['avg_sim']:.2f}pp → الفلتر ليه قيمة مع الـ exit الصح")
        elif all_stats['avg_sim'] > pass_stats['avg_sim'] + 1:
            print(f"  ✓ ALL ≈ PASS → المشكلة exit مش entry (تأكيد تاني)")
        else:
            print(f"  = PASS ≈ ALL → الـ exit policy بتفيد الكل بالتساوي")

    print()

    # JSON output
    if args.out:
        report = {
            'generated_at': datetime.now().isoformat(),
            'parameters': {
                'partial_fraction': PARTIAL_FRACTION,
                'trail_mult': TRAIL_MULT,
                'min_rr': MIN_PLANNED_RR,
                'use_atr_stop': use_atr,
                'max_holding_days': MAX_HOLDING_DAYS,
                'max_holding_days_cons': MAX_HOLDING_DAYS_CONS,
            },
            'all': group_stats(all_results),
            'pass': group_stats(pass_results),
            'reject': group_stats(rej_results),
            'persona': {p: group_stats(r) for p, r in persona_groups.items()},
        }
        os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
        with open(args.out, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        print(f"[JSON] Report saved to {args.out}")


if __name__ == '__main__':
    main()

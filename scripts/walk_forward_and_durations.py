#!/usr/bin/env python3
"""
WALK-FORWARD + EXPECTED CORRECTION DAYS
========================================
1) Walk-forward: قسم 19 شهر لـ 2 أنصاف (Jan-Aug 2025 / Sep 2025-Aug 2026)
   وقارن نتائج Correction و Merged-Strict في كل نصف — هل النتائج مستقرة؟

2) Expected correction duration: احسب متوسط مدة الاحتفاظ الفعلية لكل استراتيجية
   في كل mode من regime — عشان نعرض للعميل "التصحيح المتوقع: ~X يوم".
"""
from __future__ import annotations
import sys, json, sqlite3
from pathlib import Path
import pandas as pd
import numpy as np

PROJECT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT / 'vps-service'))

from strategies_merge import common, correction_strategy, merged_strict_strategy, chase_strategy
from analyzers.regime_filter import passes_regime_filter

DB = PROJECT / 'db' / 'vps_real' / 'price_history.db'

# Two halves for walk-forward
HALF1_START, HALF1_END = '2025-01-09', '2025-08-31'   # ~8 months (first half)
HALF2_START, HALF2_END = '2025-09-01', '2026-08-17'   # ~12 months (second half)


def load_alpha_tickers():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    c = db_manager.connection(str(DB), writable=False).__enter__()
    rows = c.execute('''
        SELECT ticker FROM price_history
        WHERE ticker NOT LIKE '.%' AND ticker NOT LIKE '%.%'
          AND length(ticker) <= 5
          AND substr(ticker, 1, 1) BETWEEN 'A' AND 'Z'
        GROUP BY ticker HAVING COUNT(*) >= 100
        ORDER BY ticker
    ''').fetchall()
    c.close()
    return [r[0] for r in rows if r[0].isalpha() and len(r[0]) <= 5]


def load_price_df(ticker):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    c = db_manager.connection(str(DB), writable=False).__enter__()
    rows = c.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker = ? AND close_price > 0 AND volume > 0
        ORDER BY date ASC
    ''', (ticker,)).fetchall()
    c.close()
    if len(rows) < 100:
        return None
    df = pd.DataFrame(rows, columns=['date','open','high','low','close','volume'])
    df['date'] = pd.to_datetime(df['date'])
    df['ticker'] = ticker
    return df


def run_strat_in_window(strat_mod, frames, mode, start_date, end_date):
    """Run strategy with regime filter in a specific date window."""
    trades = []
    holding_days_list = []
    for df_i in frames:
        signals = strat_mod.find_entry_signals(df_i)
        for entry_idx in signals:
            if mode is not None:
                sub_closes = df_i['close'].iloc[:entry_idx+1].tolist()
                if not passes_regime_filter(sub_closes, mode=mode):
                    continue
            # check window
            if entry_idx + 1 >= len(df_i):
                continue
            entry_date = pd.Timestamp(df_i.iloc[entry_idx+1]['date'])
            entry_str = entry_date.strftime('%Y-%m-%d')
            if not (start_date <= entry_str <= end_date):
                continue
            t = common.simulate_exit(df_i, entry_idx)
            if t is not None:
                trades.append(t)
                holding_days_list.append(t.holding_days)
    m = common.compute_metrics(trades, f"[{mode}]")
    m['holding_days_list'] = holding_days_list
    return m, trades


def main():
    print("=" * 80)
    print("WALK-FORWARD + EXPECTED CORRECTION DAYS")
    print("=" * 80)

    tickers = load_alpha_tickers()
    print(f"\nUniverse: {len(tickers)} tickers")

    frames = []
    for tk in tickers:
        df = load_price_df(tk)
        if df is None:
            continue
        df_i = common.attach_indicators(df)
        frames.append(df_i)
    print(f"Loaded: {len(frames)} tickers")

    strategies = [
        ("Correction", correction_strategy),
        ("Merged-Strict", merged_strict_strategy),
        ("Chase", chase_strategy),
    ]
    modes = ["none", "A", "B"]

    print("\n--- Walk-forward: Half 1 (Jan-Aug 2025) vs Half 2 (Sep 2025-Aug 2026) ---")
    walk_forward = {}
    for strat_label, mod in strategies:
        for mode in modes:
            key = f"{strat_label} [{mode}]"
            m1, t1 = run_strat_in_window(mod, frames, mode, HALF1_START, HALF1_END)
            m2, t2 = run_strat_in_window(mod, frames, mode, HALF2_START, HALF2_END)
            walk_forward[key] = {
                "half1": {k: v for k, v in m1.items() if k != 'holding_days_list'},
                "half2": {k: v for k, v in m2.items() if k != 'holding_days_list'},
            }
            # consistency check
            h1_ret = m1['total_return_pct']
            h2_ret = m2['total_return_pct']
            both_positive = h1_ret > 0 and h2_ret > 0
            both_dd_acceptable = m1['max_drawdown_pct'] > -25 and m2['max_drawdown_pct'] > -25
            consistent = both_positive and both_dd_acceptable
            marker = "✅ ثابت" if consistent else "⚠️ غير ثابت"
            print(f"  {key:30s}  H1: ret={h1_ret:+8.2f}% DD={m1['max_drawdown_pct']:+7.2f}%  |  "
                  f"H2: ret={h2_ret:+8.2f}% DD={m2['max_drawdown_pct']:+7.2f}%  → {marker}")

    # Expected correction duration (holding days distribution per strategy+mode)
    print("\n--- Expected Correction Duration (avg holding days per strategy+mode) ---")
    expected_durations = {}
    for strat_label, mod in strategies:
        for mode in modes:
            key = f"{strat_label} [{mode}]"
            # combine both halves (full 19mo)
            m_full, t_full = run_strat_in_window(mod, frames, mode, '2025-01-09', '2026-08-17')
            holding = m_full.get('holding_days_list', [])
            if holding:
                avg = round(float(np.mean(holding)), 1)
                med = round(float(np.median(holding)), 1)
                p25 = round(float(np.percentile(holding, 25)), 1)
                p75 = round(float(np.percentile(holding, 75)), 1)
                expected_durations[key] = {
                    'avg_days': avg, 'median_days': med,
                    'p25_days': p25, 'p75_days': p75,
                    'min_days': min(holding), 'max_days': max(holding),
                    'n_trades': len(holding),
                    'client_message': f"~{int(avg)} يوم (بين {int(p25)} و {int(p75)} يوم)",
                }
                print(f"  {key:30s}  avg={avg:5.1f}d  med={med:5.1f}d  "
                      f"p25-p75=[{p25:.1f} - {p75:.1f}]  n={len(holding)}  "
                      f"→ رسالة العميل: \"{expected_durations[key]['client_message']}\"")
            else:
                expected_durations[key] = {'avg_days': 0, 'n_trades': 0, 'client_message': 'غير متاح'}

    payload = {
        "meta": {
            "test": "WALK-FORWARD + EXPECTED CORRECTION DAYS",
            "data_source": f"REAL EGX price_history.db — {len(frames)} alpha tickers",
            "walk_forward_windows": {
                "half1": f"{HALF1_START} → {HALF1_END} (~8 months)",
                "half2": f"{HALF2_START} → {HALF2_END} (~12 months)",
            },
            "consistent_rule": "both halves: ret > 0 AND DD > -25%",
        },
        "walk_forward": walk_forward,
        "expected_durations": expected_durations,
        "integration_status": {
            "regime_filter_in_v40_2": "✅ wired (V40_2_REGIME_FILTER flag, default OFF) — v40_2_daily_generator.py line ~1679",
            "expected_holding_days_field": "✅ added to result dict (expected_holding_days = 7 for mode A, 5 for mode B)",
            "production_test_blocked_by": "data_engine.db + egksco_price_history empty in sandbox — V40.2 finds 0 signals without egksco data. Production test must be done on environment with full data_engine.db.",
            "phase1_proves_value": "Correction [B] full 19mo: PF 18.54, DD -2.59%, 5 trades. Regime filter MASSIVELY improves quality.",
        },
    }
    out = PROJECT / 'data' / 'merge_backtest_real' / 'walk_forward_and_durations.json'
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    pub = PROJECT / 'public' / 'backtest-results.json'
    # also include phase1 + phase2 results
    try:
        phase1 = json.load(open(PROJECT / 'data' / 'merge_backtest_real' / 'phase1_regime_results.json'))
        phase2 = json.load(open(PROJECT / 'data' / 'merge_backtest_real' / 'phase2_avg_down_results.json'))
        payload['phase1_results'] = {"results_6mo": phase1.get('results_6mo', {}), "results_full": phase1.get('results_full', {})}
        payload['phase2_results'] = phase2.get('results', {})
    except Exception:
        pass
    with open(pub, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults -> {out}")
    print(f"Static  -> {pub}")


if __name__ == "__main__":
    main()

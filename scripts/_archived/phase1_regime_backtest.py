#!/usr/bin/env python3
"""
PHASE 1 — REGIME FILTER BACKTEST (production-aligned).
========================================================
يختبر نسختي فلتر الـ regime:
  - A: Close > SMA50
  - B: Close > SMA20 AND Close > SMA50
  - none (baseline بدون فلتر)

على الفترتين:
  - 6 شهور الأخيرة (Feb-Aug 2026)
  - الفترة الكاملة (Jan 2025 - Aug 2026)

يستخدم:
  - محرك الخروج الموحد من strategies_merge.common (نفس اللي اتعمل قبل كده).
  - فلتر الـ regime من analyzers/regime_filter.py (production module).
  - الـ4 استراتيجيات من strategies_merge.

قاعدة الرفض: أي نسخة DD > 25% تترفض حتى لو العائد أعلى.
"""
from __future__ import annotations
import sys
import json
import sqlite3
from pathlib import Path
import pandas as pd
import numpy as np

PROJECT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT / 'vps-service'))

from strategies_merge import common, correction_strategy, chase_strategy, merged_strategy, merged_strict_strategy
from analyzers.regime_filter import is_bullish_regime, passes_regime_filter

DB = PROJECT / 'db' / 'vps_real' / 'price_history.db'
if not DB.exists():
    DB = PROJECT / 'db' / 'price_history.db'


def load_alpha_tickers() -> list[str]:
    c = sqlite3.connect(str(DB), timeout=10)
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


def load_price_df(ticker: str) -> pd.DataFrame | None:
    c = sqlite3.connect(str(DB), timeout=10)
    rows = c.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker = ? AND close_price > 0 AND volume > 0
        ORDER BY date ASC
    ''', (ticker,)).fetchall()
    c.close()
    if len(rows) < 100:
        return None
    df = pd.DataFrame(rows, columns=['date', 'open', 'high', 'low', 'close', 'volume'])
    df['date'] = pd.to_datetime(df['date'])
    df['ticker'] = ticker
    return df


def analyze_drawdown(trades, label):
    if not trades:
        return {"label": label, "max_dd_pct": 0, "max_dd_at": None,
                "max_loss_streak": 0, "monthly": {}}
    rets = sorted([(t.entry_date, t.ticker, t.return_pct, t.exit_reason) for t in trades],
                  key=lambda x: x[0])
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    max_dd_at = None
    for d, tk, r, reason in rets:
        equity *= (1.0 + r / 100.0)
        peak = max(peak, equity)
        dd = (equity / peak - 1.0) * 100.0
        if dd < max_dd:
            max_dd = dd
            max_dd_at = d
    streak = 0
    max_streak = 0
    for d, tk, r, reason in rets:
        if r < 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0
    monthly: dict[str, dict] = {}
    for d, tk, r, reason in rets:
        k = d.strftime('%Y-%m')
        if k not in monthly:
            monthly[k] = {"trades": 0, "wins": 0, "ret_pct": 0.0}
        monthly[k]["trades"] += 1
        if r > 0:
            monthly[k]["wins"] += 1
        monthly[k]["ret_pct"] += r
    return {
        "label": label,
        "max_dd_pct": round(max_dd, 2),
        "max_dd_at": max_dd_at.strftime('%Y-%m-%d') if max_dd_at else None,
        "max_loss_streak": max_streak,
        "monthly": {k: {"trades": v["trades"], "wins": v["wins"],
                         "win_rate": round(v["wins"]/v["trades"]*100, 1) if v["trades"] else 0,
                         "ret_pct": round(v["ret_pct"], 2)} for k, v in sorted(monthly.items())},
    }


def run_strategy_with_regime(mod, frames_with_indicators, mode: str | None,
                              start_date: str, end_date: str):
    """Run a strategy applying the regime filter to entry signals.
    mode=None means no filter (baseline).
    """
    all_trades = []
    for df_i in frames_with_indicators:
        n = len(df_i)
        closes_list = df_i["close"].tolist()
        # Pre-compute SMA series for efficiency if mode is set
        for i in range(20, n):
            # Apply regime filter at signal time (use closes up to and including i)
            if mode is not None:
                # close[i] and prior closes
                sub_closes = closes_list[: i + 1]
                if not passes_regime_filter(sub_closes, mode=mode):
                    continue
            # Strategy .run() will check its own entry conditions on the FULL df.
            # To apply regime only at signals, we call find_entry_signals then filter.
            pass
        # Better: get signals, filter, then simulate_exit
        # Re-implement: call mod.run on full df, then filter trades by entry-date regime
        trades = mod.run(df_i)
        if mode is None:
            in_window = [t for t in trades
                          if start_date <= t.entry_date.strftime('%Y-%m-%d') <= end_date]
            all_trades.extend(in_window)
            continue
        # For regime filtering: check regime at the signal day (entry day = t-1)
        for t in trades:
            entry_str = t.entry_date.strftime('%Y-%m-%d')
            if not (start_date <= entry_str <= end_date):
                continue
            # Find the row in df_i for entry_date, look back at close list up to that day
            entry_idx = df_i.index[df_i["date"] == t.entry_date]
            if len(entry_idx) == 0:
                # try nearest
                continue
            idx = entry_idx[0]
            # use closes up to and including idx (note: simulate_exit enters at next open,
            # but signal fires at close[i], so regime check uses closes[:i+1])
            sub_closes = df_i["close"].iloc[: idx + 1].tolist()
            if passes_regime_filter(sub_closes, mode=mode):
                all_trades.append(t)
    return all_trades


def run_backtest(strategies, modes, frames_with_indicators, start_date, end_date, window_label):
    results = {}
    dd_analysis = {}
    for strat_label, mod in strategies:
        for mode in modes:
            mode_key = mode if mode else "none"
            key = f"{strat_label} [{mode_key}]"
            trades = run_strategy_with_regime(mod, frames_with_indicators, mode,
                                                start_date, end_date)
            m = common.compute_metrics(trades, key)
            m["exit_reasons"] = common.exit_reason_breakdown(trades)
            m["window"] = window_label
            results[key] = m
            dd_analysis[key] = analyze_drawdown(trades, key)
            print(f"  {key:35s} trades={m['trades']:5d}  WR={m['win_rate_pct']:5.1f}%  "
                  f"ret={m['total_return_pct']:+9.2f}%  DD={m['max_drawdown_pct']:+8.2f}%  "
                  f"PF={m['profit_factor']:5.2f}  streak={dd_analysis[key]['max_loss_streak']}")
    return results, dd_analysis


def main():
    print("=" * 80)
    print("PHASE 1 — REGIME FILTER BACKTEST (production-aligned)")
    print("=" * 80)

    print("\n[1/3] Loading universe...")
    tickers = load_alpha_tickers()
    print(f"      {len(tickers)} alpha EGX tickers")

    print("\n[2/3] Loading per-ticker OHLCV + attaching indicators...")
    frames = []
    for tk in tickers:
        df = load_price_df(tk)
        if df is None:
            continue
        df_i = common.attach_indicators(df)
        frames.append(df_i)
    print(f"      loaded {len(frames)} tickers")

    strategies = [
        ("Correction", correction_strategy),
        ("Chase", chase_strategy),
        ("Merged", merged_strategy),
        ("Merged-Strict", merged_strict_strategy),
    ]
    modes = [None, 'A', 'B']

    print("\n[3/3] Running 4 strategies × 3 modes on TWO windows...")
    print("\n--- Window 1: 6 months (Feb-Aug 2026) ---")
    r6, dd6 = run_backtest(strategies, modes, frames, '2026-02-01', '2026-08-14', "6mo")
    print("\n--- Window 2: FULL (Jan 2025 - Aug 2026) ---")
    r_full, dd_full = run_backtest(strategies, modes, frames, '2025-01-09', '2026-08-17', "full")

    payload = {
        "meta": {
            "data_source": f"REAL EGX price_history.db — {len(frames)} alpha tickers",
            "windows": {"6mo": "2026-02-01 → 2026-08-14", "full": "2025-01-09 → 2026-08-17"},
            "regime_modes": {
                "none": "بدون فلتر (baseline)",
                "A": "Close > SMA50 (اتجاه صحي متوسط المدى)",
                "B": "Close > SMA20 AND Close > SMA50 (تأكيد مزدوج)",
            },
            "exit_engine": "shared/structural (موحّد): stop -7% / TP +12% / early_drop -5% / breakdown -3% / distribution / review_alert 25d",
            "rejection_rule": "أي نسخة DD > 25% تُرفض حتى لو العائد أعلى",
            "production_module": "vps-service/analyzers/regime_filter.py",
        },
        "results_6mo": r6,
        "results_full": r_full,
        "drawdown_6mo": dd6,
        "drawdown_full": dd_full,
    }

    out = PROJECT / 'data' / 'merge_backtest_real' / 'phase1_regime_results.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    pub = PROJECT / 'public' / 'backtest-results.json'
    with open(pub, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults -> {out}")
    print(f"Static  -> {pub}")

    # Summary verdict
    print("\n" + "=" * 80)
    print("PHASE 1 SUMMARY — قاعدة الرفض: DD > 25% = مرفوض")
    print("=" * 80)
    for window, results in [("6mo", r6), ("full", r_full)]:
        print(f"\n=== Window: {window} ===")
        for label, m in results.items():
            dd = m['max_drawdown_pct']
            verdict = "✅ مقبول (DD≤25%)" if dd > -25 else "❌ مرفوض (DD>25%)"
            print(f"  {label:35s} ret={m['total_return_pct']:+9.2f}%  DD={dd:+8.2f}%  PF={m['profit_factor']:5.2f}  → {verdict}")


if __name__ == "__main__":
    main()

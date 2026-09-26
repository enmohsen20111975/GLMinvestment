#!/usr/bin/env python3
"""
MERGE BACKTEST — على بيانات EGX الحقيقية.
=================================================================
يجرّب فرضية الدمج: Correction يحدد «أين» + Chase يحدد «متى».

يستخدم:
- قاعدة بيانات price_history.db الحقيقية (442 سهم EGX alpha tickers).
- نفس 4 استراتيجيات من vps-service/strategies_merge/.
- نفس محرك الخروج الهيكلي (موحّد لكل الاستراتيجيات).
- no lookahead: دخول عند OPEN اليوم التالي للإشارة.

الفترة: 2026-02-01 → 2026-08-14 (6 شهور) — نفس نافذة correction_backtest.py.

Output:
- /home/z/my-project/data/merge_backtest_real/merge_results.json
- /home/z/my-project/public/backtest-results.json  (static copy for the dashboard)
"""
from __future__ import annotations
import sys
import json
import time
import sqlite3
from pathlib import Path
import pandas as pd
import numpy as np

PROJECT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT / 'vps-service'))

from strategies_merge import common, correction_strategy, chase_strategy, merged_strategy, merged_strict_strategy

DB = PROJECT / 'db' / 'vps_real' / 'price_history.db'
if not DB.exists():
    DB = PROJECT / 'db' / 'price_history.db'

START_DATE = '2026-02-01'
END_DATE = '2026-08-14'
MIN_BARS = 100
MAX_TICKERS = 442  # كل alpha tickers


# ---------------------------------------------------------------- loaders
def load_alpha_tickers() -> list[str]:
    c = sqlite3.connect(str(DB), timeout=10)
    rows = c.execute('''
        SELECT ticker FROM price_history
        WHERE ticker NOT LIKE '.%' AND ticker NOT LIKE '%.%'
          AND length(ticker) <= 5
          AND substr(ticker, 1, 1) BETWEEN 'A' AND 'Z'
        GROUP BY ticker HAVING COUNT(*) >= ?
        ORDER BY ticker LIMIT ?
    ''', (MIN_BARS, MAX_TICKERS)).fetchall()
    c.close()
    return [r[0] for r in rows if r[0].isalpha() and len(r[0]) <= 5]


def load_price_df(ticker: str) -> pd.DataFrame | None:
    c = sqlite3.connect(str(DB), timeout=10)
    rows = c.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        WHERE ticker = ? AND close_price > 0 AND volume > 0
        ORDER BY date ASC
    ''', (ticker,)).fetchall()
    c.close()
    if len(rows) < MIN_BARS:
        return None
    df = pd.DataFrame(rows, columns=['date', 'open', 'high', 'low', 'close', 'volume'])
    df['date'] = pd.to_datetime(df['date'])
    df['ticker'] = ticker
    return df


# ---------------------------------------------------------------- runner
def run_all():
    print(f"[1/3] Loading universe from {DB}")
    tickers = load_alpha_tickers()
    print(f"      {len(tickers)} alpha EGX tickers with >= {MIN_BARS} bars")
    print(f"      window: {START_DATE} → {END_DATE}")

    print("[2/3] Loading per-ticker OHLCV + attaching indicators...")
    frames = []
    skipped = 0
    for tk in tickers:
        df = load_price_df(tk)
        if df is None:
            skipped += 1
            continue
        # filter to backtest window (with lookback for indicators)
        df = df[df['date'] >= '2025-11-01'].reset_index(drop=True)
        if len(df) < 60:
            skipped += 1
            continue
        frames.append(df)
    print(f"      loaded {len(frames)} tickers, skipped {skipped}")

    print("[3/3] Running 4 strategies on REAL EGX data...")
    results = {}
    for label, mod in [
        ("Correction", correction_strategy),
        ("Chase", chase_strategy),
        ("Merged", merged_strategy),
        ("Merged-Strict", merged_strict_strategy),
    ]:
        all_trades = []
        t0 = time.time()
        for df in frames:
            df_i = common.attach_indicators(df)
            # filter to backtest window for ENTRY only (so we don't enter before START_DATE)
            df_bt = df_i[(df_i['date'] >= START_DATE) & (df_i['date'] <= END_DATE)].reset_index(drop=True)
            # but keep enough lookback by reattaching the slice WITH prior data for exit simulation
            # Strategy .run() needs full per-ticker df; pass the windowed slice
            # However indicators need 20-day lookback: pass df_i but signals only fire in window
            # Simpler: pass df_i (full) to .run(); the entry filter is on rows in window
            mask = (df_i['date'] >= START_DATE) & (df_i['date'] <= END_DATE)
            # Run only on window rows but include lookback by passing df_i and filtering inside
            # Since strategies iterate i in range(20, n), we restrict by passing the full df_i
            # but then manually post-filter trades to those with entry_date in window
            trades = mod.run(df_i)
            in_window = [t for t in trades if START_DATE <= t.entry_date.strftime('%Y-%m-%d') <= END_DATE]
            all_trades.extend(in_window)
        dt = time.time() - t0
        m = common.compute_metrics(all_trades, label)
        m["exit_reasons"] = common.exit_reason_breakdown(all_trades)
        m["runtime_sec"] = round(dt, 2)
        results[label] = m
        print(f"   - {label:13s} trades={m['trades']:5d}  WR={m['win_rate_pct']:5.1f}%  "
              f"avgRet={m['avg_return_pct']:+6.2f}%  totalRet={m['total_return_pct']:+9.2f}%  "
              f"maxDD={m['max_drawdown_pct']:+8.2f}%  PF={m['profit_factor']:5.2f}  "
              f"hold={m['avg_holding_days']}d  ({dt:.1f}s)")

    # sample trades for dashboard (first 12 tickers)
    sample_trades = {"Correction": [], "Chase": [], "Merged": [], "Merged-Strict": []}
    for label, mod in [("Correction", correction_strategy), ("Chase", chase_strategy),
                       ("Merged", merged_strategy), ("Merged-Strict", merged_strict_strategy)]:
        collected = []
        for df in frames[:30]:
            df_i = common.attach_indicators(df)
            for t in mod.run(df_i):
                if START_DATE <= t.entry_date.strftime('%Y-%m-%d') <= END_DATE:
                    collected.append({
                        "ticker": t.ticker,
                        "entry_date": t.entry_date.strftime("%Y-%m-%d"),
                        "entry_price": round(t.entry_price, 3),
                        "exit_date": t.exit_date.strftime("%Y-%m-%d"),
                        "exit_price": round(t.exit_price, 3),
                        "return_pct": round(t.return_pct, 2),
                        "exit_reason": t.exit_reason,
                        "holding_days": t.holding_days,
                    })
        sample_trades[label] = collected[:30]

    return {
        "meta": {
            "data_source": f"REAL EGX price_history.db ({DB.name}) — 442 alpha tickers, "
                           f"daily OHLCV, {START_DATE} → {END_DATE}.",
            "seed": "N/A (real data, no RNG)",
            "n_tickers": len(frames),
            "n_days": f"{START_DATE} → {END_DATE}",
            "total_bars": sum(len(df) for df in frames),
            "trading_days_window": f"~6 months ({START_DATE} to {END_DATE})",
            "exit_engine": "shared/structural: stop_loss(-7%), take_profit(+12%), early_drop(-5% in 3d), "
                           "breakdown(<-3% vs MA20), distribution(3 lower closes+rising vol), review_alert(safety cap 25d)",
            "note": "Only the ENTRY condition differs across strategies. Exit + metrics identical. No lookahead (enter next open).",
        },
        "results": results,
        "sample_trades": sample_trades,
    }


def main():
    payload = run_all()
    out = PROJECT / 'data' / 'merge_backtest_real' / 'merge_results.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    # static copy for dashboard
    pub = Path('/home/z/my-project/public/backtest-results.json')
    pub.parent.mkdir(parents=True, exist_ok=True)
    with open(pub, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults written -> {out}")
    print(f"Static copy     -> {pub}")
    print("\n=== HEADLINE (numbers are the judge) — REAL EGX DATA ===")
    for label, m in payload["results"].items():
        print(f"{label:13s}: trades={m['trades']:5d}  WR={m['win_rate_pct']:5.1f}%  "
              f"avgRet={m['avg_return_pct']:+6.2f}%  totalRet={m['total_return_pct']:+9.2f}%  "
              f"maxDD={m['max_drawdown_pct']:+8.2f}%  PF={m['profit_factor']:5.2f}  "
              f"hold={m['avg_holding_days']}d")


if __name__ == "__main__":
    main()

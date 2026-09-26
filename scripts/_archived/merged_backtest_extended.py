#!/usr/bin/env python3
"""
MERGE BACKTEST — Extended window (full available data).
=================================================================
نفس 4 الاستراتيجيات، لكن على كامل البيانات المتاحة في price_history.db
(2025-01-09 → 2026-08-17 = ~19 شهر) عشان نختبر الثبات على فترة أطول.

كمان بـ يحلل الـ Drawdown: إمتى حصل، أي صفقات سببته.
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

DB = PROJECT / 'db' / 'vps_real' / 'price_history.db'
if not DB.exists():
    DB = PROJECT / 'db' / 'price_history.db'

# النافذة الكاملة المتاحة
START_DATE = '2025-01-09'
END_DATE = '2026-08-17'
MIN_BARS = 100


def load_alpha_tickers() -> list[str]:
    c = sqlite3.connect(str(DB), timeout=10)
    rows = c.execute('''
        SELECT ticker FROM price_history
        WHERE ticker NOT LIKE '.%' AND ticker NOT LIKE '%.%'
          AND length(ticker) <= 5
          AND substr(ticker, 1, 1) BETWEEN 'A' AND 'Z'
        GROUP BY ticker HAVING COUNT(*) >= ?
        ORDER BY ticker
    ''', (MIN_BARS,)).fetchall()
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


def analyze_drawdown(trades, label):
    """تحليل تفصيلي للـ Drawdown: إمتى حصل، أكبر خسارة مفردة، توزيع الخسائر."""
    if not trades:
        return {"label": label, "max_dd": 0, "worst_trades": [], "loss_streak": 0}
    rets = [(t.entry_date, t.ticker, t.return_pct, t.exit_reason) for t in trades]
    rets.sort(key=lambda x: x[0])

    # equity curve
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    max_dd_at = None
    dd_curve = []
    for d, tk, r, reason in rets:
        equity *= (1.0 + r / 100.0)
        peak = max(peak, equity)
        dd = (equity / peak - 1.0) * 100.0
        dd_curve.append((d, equity, dd))
        if dd < max_dd:
            max_dd = dd
            max_dd_at = d

    # worst individual trades
    worst = sorted(rets, key=lambda x: x[2])[:8]

    # loss streak
    streak = 0
    max_streak = 0
    for d, tk, r, reason in rets:
        if r < 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0

    # monthly breakdown
    monthly = {}
    for d, tk, r, reason in rets:
        key = d.strftime('%Y-%m')
        if key not in monthly:
            monthly[key] = {"trades": 0, "wins": 0, "ret_pct": 0.0}
        monthly[key]["trades"] += 1
        if r > 0:
            monthly[key]["wins"] += 1
        monthly[key]["ret_pct"] += r

    return {
        "label": label,
        "max_dd_pct": round(max_dd, 2),
        "max_dd_at": max_dd_at.strftime('%Y-%m-%d') if max_dd_at else None,
        "worst_trades": [{"date": d.strftime('%Y-%m-%d'), "ticker": tk, "ret": round(r, 2), "reason": reason}
                          for d, tk, r, reason in worst],
        "max_loss_streak": max_streak,
        "monthly": {k: {"trades": v["trades"], "wins": v["wins"],
                         "win_rate": round(v["wins"]/v["trades"]*100, 1) if v["trades"] else 0,
                         "ret_pct": round(v["ret_pct"], 2)} for k, v in sorted(monthly.items())},
    }


def run_all():
    print(f"[1/3] Loading universe from {DB}")
    tickers = load_alpha_tickers()
    print(f"      {len(tickers)} alpha EGX tickers, window: {START_DATE} → {END_DATE}")

    print("[2/3] Loading per-ticker OHLCV...")
    frames = []
    for tk in tickers:
        df = load_price_df(tk)
        if df is None:
            continue
        frames.append(df)
    print(f"      loaded {len(frames)} tickers")

    print("[3/3] Running 4 strategies on FULL data window...")
    results = {}
    dd_analysis = {}
    for label, mod in [
        ("Correction", correction_strategy),
        ("Chase", chase_strategy),
        ("Merged", merged_strategy),
        ("Merged-Strict", merged_strict_strategy),
    ]:
        all_trades = []
        for df in frames:
            df_i = common.attach_indicators(df)
            for t in mod.run(df_i):
                if START_DATE <= t.entry_date.strftime('%Y-%m-%d') <= END_DATE:
                    all_trades.append(t)
        m = common.compute_metrics(all_trades, label)
        m["exit_reasons"] = common.exit_reason_breakdown(all_trades)
        results[label] = m
        dd_analysis[label] = analyze_drawdown(all_trades, label)
        print(f"   - {label:13s} trades={m['trades']:5d}  WR={m['win_rate_pct']:5.1f}%  "
              f"avgRet={m['avg_return_pct']:+6.2f}%  totalRet={m['total_return_pct']:+9.2f}%  "
              f"maxDD={m['max_drawdown_pct']:+8.2f}%  PF={m['profit_factor']:5.2f}  "
              f"hold={m['avg_holding_days']}d")

    return {
        "meta": {
            "data_source": f"REAL EGX price_history.db — {len(frames)} alpha tickers",
            "window": f"{START_DATE} → {END_DATE} (~19 months FULL)",
            "n_tickers": len(frames),
            "total_bars": sum(len(df) for df in frames),
            "exit_engine": "shared/structural: stop_loss(-7%), take_profit(+12%), early_drop(-5% in 3d), breakdown(<-3% vs MA20), distribution, review_alert(25d cap)",
            "note": "Same exit engine for all 4 strategies. Only ENTRY differs. No lookahead (enter next open).",
        },
        "results": results,
        "drawdown_analysis": dd_analysis,
    }


def main():
    payload = run_all()
    out = PROJECT / 'data' / 'merge_backtest_real' / 'merge_results_extended.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    # also publish to dashboard static
    pub = Path('/home/z/my-project/public/backtest-results.json')
    with open(pub, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults -> {out}")
    print(f"Static  -> {pub}")
    print("\n=== HEADLINE (extended window) ===")
    for label, m in payload["results"].items():
        dd = payload["drawdown_analysis"][label]
        print(f"{label:13s}: trades={m['trades']:5d}  WR={m['win_rate_pct']:5.1f}%  "
              f"totalRet={m['total_return_pct']:+9.2f}%  maxDD={m['max_drawdown_pct']:+8.2f}%  "
              f"PF={m['profit_factor']:5.2f}  worstStreak={dd['max_loss_streak']}  "
              f"maxDD_at={dd['max_dd_at']}")


if __name__ == "__main__":
    main()

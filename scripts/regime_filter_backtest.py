#!/usr/bin/env python3
"""
REGIME FILTER BACKTEST — قياس أثر فلتر الـ Regime على الـ DD والـ PF.
=================================================================
يقارن كل استراتيجية في 3 أوضاع:
  - "none":   بدون فلتر regime (الـbaseline اللي شغلناه قبل كده)
  - "stock":  فلتر per-stock (close > MA50 للسهم نفسه)
  - "both":   فلتر مزدوج (stock MA50 + market proxy MA50)

الهدف: هل الفلتر بيقلل الـ DD بدون ما يقتل العائد؟
الفترة: كامل البيانات (Jan 2025 → Aug 2026) — 19 شهر.
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

from strategies_merge import common, correction_strategy, chase_strategy, merged_strategy, merged_strict_strategy, regime_filter

DB = PROJECT / 'db' / 'vps_real' / 'price_history.db'
if not DB.exists():
    DB = PROJECT / 'db' / 'price_history.db'

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
        FROM price_history WHERE ticker = ? AND close_price > 0 AND volume > 0
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
    if not trades:
        return {"label": label, "max_dd": 0, "worst_trades": [], "max_loss_streak": 0, "monthly": {}}
    rets = [(t.entry_date, t.ticker, t.return_pct, t.exit_reason) for t in trades]
    rets.sort(key=lambda x: x[0])
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
    worst = sorted(rets, key=lambda x: x[2])[:5]
    streak = 0
    max_streak = 0
    for d, tk, r, reason in rets:
        if r < 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0
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
    print(f"[1/4] Loading universe from {DB}")
    tickers = load_alpha_tickers()
    print(f"      {len(tickers)} alpha EGX tickers, window: {START_DATE} → {END_DATE}")

    print("[2/4] Loading per-ticker OHLCV + attaching indicators...")
    frames_raw = []
    for tk in tickers:
        df = load_price_df(tk)
        if df is None:
            continue
        frames_raw.append(df)
    print(f"      loaded {len(frames_raw)} tickers")

    print("[3/4] Computing market proxy (equal-weighted EGX index)...")
    all_df = pd.concat(frames_raw, ignore_index=True)
    market_df = common.compute_market_proxy(all_df)
    # show market regime stats
    total_days = len(market_df)
    bull_days = int(market_df["market_above_ma50"].sum())
    print(f"      market proxy: {total_days} days, {bull_days} bullish ({bull_days/total_days*100:.1f}%), "
          f"{total_days - bull_days} bearish ({(total_days-bull_days)/total_days*100:.1f}%)")

    print("[4/4] Running 4 strategies × 3 regime modes on full window...")
    # attach indicators + market regime to each ticker df
    frames = []
    for df in frames_raw:
        df_i = common.attach_indicators(df)
        df_i = common.attach_market_regime(df_i, market_df)
        frames.append(df_i)

    strategies = [
        ("Correction", correction_strategy),
        ("Chase", chase_strategy),
        ("Merged", merged_strategy),
        ("Merged-Strict", merged_strict_strategy),
    ]
    modes = [("none", None), ("stock", "stock"), ("both", "both")]
    results = {}
    dd_analysis = {}

    for label, mod in strategies:
        for mode_name, mode_val in modes:
            key = f"{label} [{mode_name}]"
            all_trades = []
            for df_i in frames:
                if mode_val is None:
                    trades = mod.run(df_i)
                else:
                    trades = regime_filter.run_with_regime(mod, df_i, mode=mode_val)
                for t in trades:
                    if START_DATE <= t.entry_date.strftime('%Y-%m-%d') <= END_DATE:
                        all_trades.append(t)
            m = common.compute_metrics(all_trades, key)
            m["exit_reasons"] = common.exit_reason_breakdown(all_trades)
            results[key] = m
            dd_analysis[key] = analyze_drawdown(all_trades, key)
            print(f"   - {key:30s} trades={m['trades']:5d}  WR={m['win_rate_pct']:5.1f}%  "
                  f"totalRet={m['total_return_pct']:+9.2f}%  maxDD={m['max_drawdown_pct']:+8.2f}%  "
                  f"PF={m['profit_factor']:5.2f}  streak={dd_analysis[key]['max_loss_streak']}")

    return {
        "meta": {
            "data_source": f"REAL EGX price_history.db — {len(frames)} alpha tickers",
            "window": f"{START_DATE} → {END_DATE} (~19 months FULL)",
            "n_tickers": len(frames),
            "total_bars": sum(len(df) for df in frames),
            "market_regime": f"{bull_days}/{total_days} bullish days ({bull_days/total_days*100:.1f}%)",
            "exit_engine": "shared/structural: stop_loss(-7%), take_profit(+12%), early_drop, breakdown, distribution, review_alert(25d)",
            "regime_filter": "stock=per-stock close>MA50; both=stock MA50 AND market proxy MA50",
            "note": "Same exit engine for all variants. Only ENTRY regime filter differs. No lookahead.",
        },
        "results": results,
        "drawdown_analysis": dd_analysis,
        "market_proxy": {
            "dates": market_df["date"].dt.strftime('%Y-%m-%d').tolist(),
            "market_close": [round(x, 2) for x in market_df["market_close"].tolist()],
            "market_ma50": [round(x, 2) if not pd.isna(x) else None for x in market_df["market_ma50"].tolist()],
            "above_ma50": [bool(x) for x in market_df["market_above_ma50"].tolist()],
        },
    }


def main():
    payload = run_all()
    out = PROJECT / 'data' / 'merge_backtest_real' / 'regime_filter_results.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    pub = PROJECT / 'public' / 'backtest-results.json'
    with open(pub, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults -> {out}")
    print(f"Static  -> {pub}")
    print("\n=== HEADLINE: regime filter impact ===")
    for label in ["Correction", "Chase", "Merged", "Merged-Strict"]:
        print(f"\n--- {label} ---")
        for mode in ["none", "stock", "both"]:
            key = f"{label} [{mode}]"
            m = payload["results"][key]
            dd = payload["drawdown_analysis"][key]
            print(f"  {mode:5s}: trades={m['trades']:5d}  WR={m['win_rate_pct']:5.1f}%  "
                  f"ret={m['total_return_pct']:+9.2f}%  DD={m['max_drawdown_pct']:+8.2f}%  "
                  f"PF={m['profit_factor']:5.2f}  streak={dd['max_loss_streak']}")


if __name__ == "__main__":
    main()
